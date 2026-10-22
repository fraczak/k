import fs from "node:fs";
import path from "node:path";
import {
  compileLibrary,
  compileObjectBuffer,
  decodeObject,
  loadLibrary,
  buildExportPreamble
} from "@fraczak/k/object.mjs";

export function readAll(stream) {
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

export function parseCompileOptions(args) {
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

export function fileInputType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ko") return "ko";
  if (ext === ".kvm") return "kvm";
  if (ext === ".klib") return "klib";
  if (ext === ".pkir") return "pkir";
  return "source-file";
}

export function resolveProgramInput(args, { allowStdinSource = false } = {}) {
  const inputArg = args.shift() ?? null;
  if (inputArg == null) {
    if (!allowStdinSource) throw new Error("Missing script argument");
    return { kind: "stdin-source", sourceName: "<stdin>" };
  }

  const ext = path.extname(inputArg).toLowerCase();
  if (fs.existsSync(inputArg)) {
    const kind = fileInputType(inputArg);
    return { kind, path: inputArg, sourceName: inputArg };
  }

  if ([".k", ".ko", ".kvm", ".klib", ".pkir"].includes(ext)) {
    throw new Error(`Input file not found: ${inputArg}`);
  }

  return {
    kind: "inline-source",
    source: inputArg,
    sourceName: "<inline>"
  };
}

export { buildExportPreamble };

export async function compileProgramInputToObject(
  input,
  { libraries = [], exportSpecs = [], stdin = null } = {}
) {
  let object;
  if (input.kind === "inline-source") {
    const preamble = buildExportPreamble(exportSpecs, libraries);
    const objBuffer = compileObjectBuffer(preamble + input.source, {
      libraries,
      source: input.sourceName
    });
    object = decodeObject(objBuffer);
  } else if (input.kind === "stdin-source") {
    if (!stdin) {
      throw new Error("stdin source requested without a stdin stream");
    }
    const source = (await readAll(stdin)).toString("utf8");
    const preamble = buildExportPreamble(exportSpecs, libraries);
    const objBuffer = compileObjectBuffer(preamble + source, {
      libraries,
      source: input.sourceName
    });
    object = decodeObject(objBuffer);
  } else if (input.kind === "source-file") {
    const source = fs.readFileSync(input.path, "utf8");
    const preamble = buildExportPreamble(exportSpecs, libraries);
    const objBuffer = compileObjectBuffer(preamble + source, {
      libraries,
      source: input.sourceName
    });
    object = decodeObject(objBuffer);
  } else if (input.kind === "ko" || input.kind === "klib") {
    object = decodeObject(fs.readFileSync(input.path));
  } else if (input.kind === "kvm") {
    throw new Error(
      "Input is already lowered to .kvm bytecode; use " +
      "compileLLVMArtifactFromKVM or compileKVMToExecutable."
    );
  } else if (input.kind === "pkir") {
    throw new Error(
      "Input is already lowered to .pkir IR; use " +
      "compileLLVMArtifactFromPKIR or compilePKIRToExecutable."
    );
  } else {
    throw new Error(`Unsupported input kind: ${input.kind}`);
  }

  return object;
}

export default {
  buildExportPreamble,
  compileProgramInputToObject,
  fileInputType,
  parseCompileOptions,
  readAll,
  resolveProgramInput
};
