import fs from "node:fs";
import path from "node:path";
import { compileLibrary, compileObjectBuffer, decodeObject, loadLibrary } from "@fraczak/k/object.mjs";

export function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export function parseCompileOptions(args) {
  const libraries = [];
  const exportSpecs = [];
  let loadedLibrary = false;

  while (args.length > 0) {
    if (args[0] === "--") {
      args.shift();
      break;
    }
    if (args[0] === "--lib") {
      if (loadedLibrary) throw new Error("--lib may only be specified once");
      args.shift();
      const libPath = args.shift();
      if (!libPath) throw new Error("--lib requires a file argument");
      const ext = path.extname(libPath).toLowerCase();
      if (ext === ".k") {
        libraries.push(loadLibrary(compileLibrary(fs.readFileSync(libPath, "utf8"), { source: libPath })));
      } else {
        libraries.push(loadLibrary(decodeObject(fs.readFileSync(libPath))));
      }
      loadedLibrary = true;
    } else if (args[0] === "--export") {
      args.shift();
      const spec = args.shift();
      if (!spec) throw new Error("--export requires a spec argument (name or libname:localname)");
      exportSpecs.push(spec);
    } else if (args[0].startsWith("--")) {
      break;
    } else {
      break;
    }
  }

  return { libraries, exportSpecs };
}

export function fileInputType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ko") return "ko";
  if (ext === ".kvm") return "kvm";
  if (ext === ".klib") return "klib";
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

  if ([".k", ".ko", ".kvm", ".klib"].includes(ext)) {
    throw new Error(`Input file not found: ${inputArg}`);
  }

  return { kind: "inline-source", source: inputArg, sourceName: "<inline>" };
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
    const [libName, localName] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
    const hash = aliasMap[libName];
    if (!hash) throw new Error(`--export: '${libName}' not found in loaded libraries`);
    const body = hash.startsWith("@") ? hash.slice(1) : hash;
    lines.push(`${localName} = @${body};`);
  }
  return lines.join("\n") + "\n";
}

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
    if (!stdin) throw new Error("stdin source requested without a stdin stream");
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
    throw new Error("Compiling directly from .kvm to LLVM is not yet supported; use .k or .ko input.");
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
