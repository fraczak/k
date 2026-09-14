import fs from "node:fs";
import path from "node:path";

import { compileLibrary, decodeObject, loadLibrary } from "../../../backend-api.mjs";
import {
  compileARM64Artifact,
  compileARM64ArtifactFromKVM,
  compileARM64ArtifactFromObject
} from "./arm64.mjs";

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
    if (kind === "klib") {
      throw new Error("Cannot compile a .klib library to ARM64 without a main relation; load it with --lib.");
    }
    return { kind, path: inputArg, sourceName: inputArg };
  }

  if ([".k", ".ko", ".kvm", ".klib"].includes(ext)) {
    throw new Error(`Input file not found: ${inputArg}`);
  }

  return { kind: "inline-source", source: inputArg, sourceName: "<inline>" };
}

export async function compileProgramInput(
  input,
  {
    libraries = [],
    exportSpecs = [],
    stdin = null,
    inputEnvelopePattern = null,
    entry = null,
    emit = null,
    outputPath = null
  } = {}
) {
  const compileOptions = {
    libraries,
    exports: exportSpecs,
    inputEnvelopePattern,
    entry,
    emit,
    outputPath
  };

  if (input.kind === "inline-source") {
    return compileARM64Artifact(input.source, {
      ...compileOptions,
      source: input.sourceName
    });
  }

  if (input.kind === "stdin-source") {
    if (!stdin) throw new Error("stdin source requested without a stdin stream");
    const source = (await readAll(stdin)).toString("utf8");
    return compileARM64Artifact(source, {
      ...compileOptions,
      source: input.sourceName
    });
  }

  if (input.kind === "source-file") {
    return compileARM64Artifact(fs.readFileSync(input.path, "utf8"), {
      ...compileOptions,
      source: input.sourceName
    });
  }

  if (input.kind === "ko") {
    return compileARM64ArtifactFromObject(
      decodeObject(fs.readFileSync(input.path)),
      compileOptions
    );
  }

  if (input.kind === "kvm") {
    return compileARM64ArtifactFromKVM(
      JSON.parse(fs.readFileSync(input.path, "utf8")),
      compileOptions
    );
  }

  throw new Error(`Unsupported input kind: ${input.kind}`);
}

export default {
  compileProgramInput,
  fileInputType,
  parseCompileOptions,
  readAll,
  resolveProgramInput
};
