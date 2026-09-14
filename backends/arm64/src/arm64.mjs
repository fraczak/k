import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  decodeObject,
  decodeWire,
  objectToKVMArtifact,
  specializeKVM
} from "../../../backend-api.mjs";
import { compileLibrary, compileObjectBuffer, loadLibrary } from "../../../object.mjs";

import {
  compileKVMModuleToARM64,
  emitMetadataC,
  getTagEntries,
  resetTagIds
} from "./kvm2arm64.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_C_PATH = path.resolve(__dirname, "runtime.c");
const KRT_C_PATH = path.resolve(__dirname, "../../llvm/runtime/krt.c");
const KRT_H_DIR = path.resolve(__dirname, "../../llvm/runtime");

export const ARTIFACT_FORMAT = "k-arm64";
export const ARTIFACT_VERSION = 1;

function buildExportPreamble(exports = [], libraries = []) {
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

export function compileARM64ArtifactFromKVM(kvmInput, options = {}) {
  let kvm = kvmInput;
  if (kvm?.format === "k-vm") {
    if (kvm.layer === "KVM-P" && options.inputEnvelopePattern) {
      kvm = specializeKVM(kvm, options.inputEnvelopePattern);
    }
  }

  const functions = kvm.functions || (typeof kvm === "object" && !Array.isArray(kvm) ? kvm : null);
  if (!functions || typeof functions !== "object") {
    throw new Error("Expected .kvm input to contain a functions object");
  }

  const entry = options.entry || kvm.entry || "__main__";
  const entryFunc = functions[entry];
  if (!entryFunc) {
    throw new Error(`kVM entry relation '${entry}' not found in program`);
  }

  const inputPattern = options.inputPattern || entryFunc.inputPattern || [];
  const outputPattern = options.outputPattern || entryFunc.outputPattern || [];

  resetTagIds();
  const { assembly, entryName } = compileKVMModuleToARM64(entry, functions, {
    inputPattern,
    outputPattern
  });
  const tags = getTagEntries();
  const metadataC = emitMetadataC(tags, inputPattern, outputPattern);

  if (options.emit === "assembly" || options.assembly) {
    return {
      assembly,
      metadataC,
      entryName,
      tags,
      inputPattern,
      outputPattern
    };
  }

  // Compile to native ELF executable using gcc
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-arm64-"));
  const asmPath = path.join(tmpDir, "prog.s");
  const metaPath = path.join(tmpDir, "meta.c");
  const outPath = options.outputPath || path.join(tmpDir, "prog");

  try {
    fs.writeFileSync(asmPath, assembly, "utf8");
    fs.writeFileSync(metaPath, metadataC, "utf8");

    const gcc = options.gcc || process.env.CC || "gcc";
    const optLevel = options.optLevel ?? "-O2";
    const args = [
      optLevel,
      `-DENTRY_NAME=${entryName}`,
      asmPath,
      metaPath,
      RUNTIME_C_PATH,
      KRT_C_PATH,
      `-I${KRT_H_DIR}`,
      "-o",
      outPath
    ];

    execFileSync(gcc, args, { stdio: "pipe" });

    if (options.outputPath) {
      return outPath;
    }

    const binaryBuffer = fs.readFileSync(outPath);
    return binaryBuffer;
  } finally {
    try {
      if (fs.existsSync(asmPath)) fs.unlinkSync(asmPath);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      if (!options.outputPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
      if (!options.outputPath) fs.rmdirSync(tmpDir);
    } catch {
      // Ignore cleanup errors in temporary directory
    }
  }
}

export function compileARM64ArtifactFromObject(object, options = {}) {
  const kvm = objectToKVMArtifact(object, options.entry, null, options);
  return compileARM64ArtifactFromKVM(kvm, options);
}

export function compileARM64Artifact(source, options = {}) {
  const libraries = (options.libraries || []).map((lib) => {
    if (lib?.rels || lib?.meta || lib?.relAlias) return lib;
    if (typeof lib === "string") {
      const ext = path.extname(lib).toLowerCase();
      if (ext === ".k") {
        return loadLibrary(compileLibrary(fs.readFileSync(lib, "utf8"), { source: lib }));
      }
      return loadLibrary(decodeObject(fs.readFileSync(lib)));
    }
    if (Buffer.isBuffer(lib)) {
      return loadLibrary(decodeObject(lib));
    }
    return lib;
  });
  const preamble = buildExportPreamble(options.exports || options.exportSpecs || [], libraries);
  const fullSource = preamble + source;

  const objBuffer = compileObjectBuffer(fullSource, {
    libraries,
    source: options.source || null
  });
  const object = decodeObject(objBuffer);
  return compileARM64ArtifactFromObject(object, options);
}

export function runARM64Artifact(executablePathOrBuffer, inputBuffer, options = {}) {
  let execPath = executablePathOrBuffer;
  let tmpFile = null;

  if (Buffer.isBuffer(executablePathOrBuffer)) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-arm64-run-"));
    tmpFile = path.join(tmpDir, "k-exec");
    fs.writeFileSync(tmpFile, executablePathOrBuffer, { mode: 0o755 });
    execPath = tmpFile;
  }

  try {
    const args = [];
    if (options.json) {
      args.push("--json");
    }

    const result = spawnSync(execPath, args, {
      input: inputBuffer,
      maxBuffer: options.maxBuffer || 64 * 1024 * 1024
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.toString("utf8") || "";
      throw new Error(`ARM64 executable failed with exit status ${result.status}: ${stderr}`);
    }

    if (options.json) {
      return result.stdout.toString("utf8");
    }
    return result.stdout;
  } finally {
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(path.dirname(tmpFile));
      } catch {
        // Ignore temporary cleanup errors
      }
    }
  }
}

export default {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION,
  compileARM64ArtifactFromKVM,
  compileARM64ArtifactFromObject,
  compileARM64Artifact,
  runARM64Artifact
};
