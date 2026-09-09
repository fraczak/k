import fs from "node:fs";
import path from "node:path";

import { decodeObject, loadLibrary } from "@fraczak/k/backend-api.mjs";
import {
  compileWasmArtifact,
  compileWasmArtifactFromKVM,
  compileWasmArtifactFromObject
} from "./wasm.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function parseCompileOptions(args) {
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
      libraries.push(loadLibrary(decodeObject(fs.readFileSync(libPath))));
      loadedLibrary = true;
    } else if (args[0] === "--export") {
      args.shift();
      const spec = args.shift();
      if (!spec) throw new Error("--export requires a spec argument (name or libname:localname)");
      exportSpecs.push(spec);
    } else if (args[0].startsWith("--")) {
      throw new Error(`Unknown option: ${args[0]}`);
    } else {
      break;
    }
  }

  return { libraries, exportSpecs };
}

function fileInputType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ko") return "ko";
  if (ext === ".kvm") return "kvm";
  if (ext === ".klib") return "klib";
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
      throw new Error("Cannot compile a .klib library to WebAssembly without a main relation; load it with --lib.");
    }
    return { kind, path: inputArg, sourceName: inputArg };
  }

  if ([".k", ".ko", ".kvm", ".klib", ".wasm"].includes(ext)) {
    throw new Error(`Input file not found: ${inputArg}`);
  }

  return { kind: "inline-source", source: inputArg, sourceName: "<inline>" };
}

async function compileProgramInput(
  input,
  { libraries = [], exportSpecs = [], stdin = null, inputEnvelopePattern = null } = {}
) {
  if (input.kind === "inline-source") {
    return compileWasmArtifact(input.source, {
      libraries,
      exports: exportSpecs,
      source: input.sourceName,
      inputEnvelopePattern
    });
  }

  if (input.kind === "stdin-source") {
    if (!stdin) throw new Error("stdin source requested without a stdin stream");
    return compileWasmArtifact((await readAll(stdin)).toString("utf8"), {
      libraries,
      exports: exportSpecs,
      source: input.sourceName,
      inputEnvelopePattern
    });
  }

  if (input.kind === "source-file") {
    return compileWasmArtifact(fs.readFileSync(input.path, "utf8"), {
      libraries,
      exports: exportSpecs,
      source: input.sourceName,
      inputEnvelopePattern
    });
  }

  if (input.kind === "ko") {
    return compileWasmArtifactFromObject(decodeObject(fs.readFileSync(input.path)), {
      inputEnvelopePattern
    });
  }

  if (input.kind === "kvm") {
    return compileWasmArtifactFromKVM(JSON.parse(fs.readFileSync(input.path, "utf8")));
  }

  throw new Error(`Unsupported input kind: ${input.kind}`);
}

export {
  compileProgramInput,
  parseCompileOptions,
  readAll,
  resolveProgramInput
};
