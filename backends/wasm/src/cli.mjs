import fs from "node:fs";
import path from "node:path";

import {
  compileLibrary,
  decodeObject,
  loadLibrary
} from "@fraczak/k/backend-api.mjs";
import {
  compileWasmArtifact,
  compileWasmArtifactFromKVM,
  compileWasmArtifactFromObject,
  compileWasmArtifactFromPKIR
} from "./wasm.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      );
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export function buildExportPreamble(exports = [], libraries = []) {
  if (exports.length === 0) return "";
  const aliasMap = {};
  for (const lib of libraries) {
    for (const [name, hash] of Object.entries(lib.relAlias || {})) {
      if (name !== "__main__") aliasMap[name] = hash;
    }
    for (const [hash, entry] of Object.entries(lib.meta || {})) {
      if (entry?.type !== "rel") continue;
      for (const origin of entry?.origins || []) {
        if (origin?.name && origin.name !== "__main__") {
          aliasMap[origin.name] = hash;
        }
      }
    }
  }
  const lines = [];
  for (const spec of exports) {
    const [libName, localName] = spec.includes(":")
      ? spec.split(":", 2)
      : [spec, spec];
    const hash = aliasMap[libName];
    if (!hash) {
      throw new Error(
        `--export: '${libName}' not found in loaded libraries`
      );
    }
    const body = hash.startsWith("@") ? hash.slice(1) : hash;
    lines.push(`${localName} = @${body};`);
  }
  return lines.join("\n") + "\n";
}

export function loadLibraryFromPath(libPath) {
  const ext = path.extname(libPath).toLowerCase();
  if (ext === ".klib" || ext === ".ko") {
    return loadLibrary(decodeObject(fs.readFileSync(libPath)));
  }
  if (ext === ".k") {
    let depLibs = [];
    const baseName = path.basename(libPath);
    if (baseName === "poly.k") {
      const dir = path.dirname(libPath);
      const arithPath = path.join(dir, "arithmetics.k");
      if (fs.existsSync(arithPath)) {
        const arithLib = loadLibrary(
          compileLibrary(fs.readFileSync(arithPath, "utf8"), {
            source: arithPath
          })
        );
        depLibs.push(arithLib);
      }
    }
    const rawSource = fs.readFileSync(libPath, "utf8");
    if (depLibs.length > 0) {
      const neededExports = [
        "0", "int", "inc", "dec", "nat", "zero_int?", "neg?", "GT"
      ];
      const preamble = buildExportPreamble(neededExports, depLibs);
      const compiled = compileLibrary(preamble + rawSource, {
        source: libPath,
        libraries: depLibs
      });
      const mergedLib = loadLibrary(compiled);
      for (const dep of depLibs) {
        for (const [k, v] of Object.entries(dep.relAlias || {})) {
          if (!mergedLib.relAlias[k]) mergedLib.relAlias[k] = v;
        }
      }
      return mergedLib;
    }
    return loadLibrary(compileLibrary(rawSource, { source: libPath }));
  }
  throw new Error(`Unsupported library extension: ${ext}`);
}

function parseCompileOptions(args) {
  const libraries = [];
  const exportSpecs = [];
  let loadedLibrary = false;
  let usePKIR = false;

  while (args.length > 0) {
    if (args[0] === "--") {
      args.shift();
      break;
    }
    if (args[0] === "--lib") {
      if (loadedLibrary) {
        throw new Error("--lib may only be specified once");
      }
      args.shift();
      const libPath = args.shift();
      if (!libPath) throw new Error("--lib requires a file argument");
      libraries.push(loadLibraryFromPath(libPath));
      loadedLibrary = true;
    } else if (args[0] === "--export") {
      args.shift();
      const spec = args.shift();
      if (!spec) {
        throw new Error(
          "--export requires a spec argument (name or libname:localname)"
        );
      }
      exportSpecs.push(spec);
    } else if (args[0] === "--pkir") {
      args.shift();
      usePKIR = true;
    } else if (args[0].startsWith("--")) {
      break;
    } else {
      break;
    }
  }

  return { libraries, exportSpecs, usePKIR };
}

function fileInputType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ko") return "ko";
  if (ext === ".kvm") return "kvm";
  if (ext === ".klib") return "klib";
  if (ext === ".pkir") return "pkir";
  return "source-file";
}

function resolveProgramInput(args, { allowStdinSource = false } = {}) {
  const inputArg = args.shift() ?? null;
  if (inputArg == null) {
    if (!allowStdinSource) throw new Error("Missing script argument");
    return { kind: "stdin-source", sourceName: "<stdin>" };
  }

  const ext = path.extname(inputArg).toLowerCase();
  if (fs.existsSync(inputArg)) {
    const kind = fileInputType(inputArg);
    if (kind === "klib") {
      throw new Error(
        "Cannot compile a .klib library to WebAssembly without a main " +
          "relation; load it with --lib."
      );
    }
    return { kind, path: inputArg, sourceName: inputArg };
  }

  if ([".k", ".ko", ".kvm", ".klib", ".wasm", ".pkir"].includes(ext)) {
    throw new Error(`Input file not found: ${inputArg}`);
  }

  return {
    kind: "inline-source",
    source: inputArg,
    sourceName: "<inline>"
  };
}

async function compileProgramInput(
  input,
  {
    libraries = [],
    exportSpecs = [],
    stdin = null,
    inputEnvelopePattern = null,
    usePKIR = false
  } = {}
) {
  if (input.kind === "inline-source") {
    return compileWasmArtifact(input.source, {
      libraries,
      exports: exportSpecs,
      source: input.sourceName,
      inputEnvelopePattern,
      usePKIR
    });
  }

  if (input.kind === "stdin-source") {
    if (!stdin) {
      throw new Error("stdin source requested without a stdin stream");
    }
    return compileWasmArtifact((await readAll(stdin)).toString("utf8"), {
      libraries,
      exports: exportSpecs,
      source: input.sourceName,
      inputEnvelopePattern,
      usePKIR
    });
  }

  if (input.kind === "source-file") {
    return compileWasmArtifact(fs.readFileSync(input.path, "utf8"), {
      libraries,
      exports: exportSpecs,
      source: input.sourceName,
      inputEnvelopePattern,
      usePKIR
    });
  }

  if (input.kind === "ko") {
    const obj = decodeObject(fs.readFileSync(input.path));
    return compileWasmArtifactFromObject(obj, {
      inputEnvelopePattern,
      usePKIR
    });
  }

  if (input.kind === "pkir") {
    const pkir = JSON.parse(fs.readFileSync(input.path, "utf8"));
    return compileWasmArtifactFromPKIR(pkir);
  }

  if (input.kind === "kvm") {
    const kvm = JSON.parse(fs.readFileSync(input.path, "utf8"));
    return compileWasmArtifactFromKVM(kvm);
  }

  throw new Error(`Unsupported input kind: ${input.kind}`);
}

export {
  compileProgramInput,
  parseCompileOptions,
  readAll,
  resolveProgramInput
};
