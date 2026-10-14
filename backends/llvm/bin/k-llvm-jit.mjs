#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { argv, exit, stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { decodeObject } from "@fraczak/k/object.mjs";
import { decodeWire } from "@fraczak/k/codecs/runtime/prefix-codec.mjs";
import { compileObjectToExecutable } from "../src/executable.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function helpText() {
  const prog = argv[1] || "k-llvm-jit.mjs";
  return [
    "Compile and execute a k .ko/.klib object against",
    "the stdin binary envelope.",
    "",
    `Usage: ${prog} [options] object-file`,
    "",
    "The runner reads a binary k pattern+value envelope from stdin,",
    "specializes the object with that pattern, then writes a binary",
    "envelope to stdout.",
    "",
    "Arguments:",
    "  object-file       Input .ko or .klib file.",
    "",
    "Options:",
    "  --retype rel      Relation to specialize (default: object main).",
    "  --cache-dir path  Directory for compiled native executables.",
    "  --no-cache        Compile in a temporary directory and discard.",
    "  --opt flag        Clang optimization level (-O0, -O1, -O2, -O3).",
    "  --pkir            Lower via Polymorphic K IR (PKIR).",
    "  -h, --help        Show this help.",
    "",
    "Environment Variables:",
    "  K_LLVM_CACHE_DIR  Default cache directory for executables.",
    "  K_LLVM_CLANG_OPT  Default Clang optimization flag (default: -O1).",
    "  CLANG, CC         Path to Clang compiler binary (default: clang).",
    "  K_TRACE, TRACE    When '1', output phase tracing to stderr.",
    "",
    "Examples:",
    `  cat input.wire | ${prog} program.ko > output.wire`,
    `  cat input.wire | ${prog} --cache-dir /tmp/cache program.ko`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

async function readStdinBuffer() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

let cachedBackendFingerprint = null;

function backendFingerprint() {
  if (cachedBackendFingerprint != null) return cachedBackendFingerprint;
  const hash = crypto.createHash("sha256");
  for (const relPath of [
    "src/llvm.mjs",
    "src/kvm2llvm.mjs",
    "src/executable.mjs",
    "runtime/krt.c",
    "runtime/krt.h"
  ]) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relPath)));
    hash.update("\0");
  }
  cachedBackendFingerprint = hash.digest("hex").slice(0, 16);
  return cachedBackendFingerprint;
}

function cacheKey({
  objectBuffer,
  relation,
  inputPattern,
  clangOpt,
  usePKIR
}) {
  const hash = crypto.createHash("sha256");
  hash.update("k-llvm-jit-v3\0");
  hash.update(backendFingerprint());
  hash.update("\0");
  hash.update(relation);
  hash.update("\0");
  hash.update(clangOpt);
  hash.update("\0");
  hash.update(usePKIR ? "pkir\0" : "direct\0");
  hash.update(JSON.stringify(inputPattern));
  hash.update("\0");
  hash.update(objectBuffer);
  return hash.digest("hex");
}

function runExecutable(exePath, inputBuffer) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(
          new Error(
            `${exePath} failed with status ${status}` +
              (stderr ? `\n${stderr}` : "")
          )
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    child.stdin.end(inputBuffer);
  });
}

function compileCached({
  object,
  objectBuffer,
  relation,
  inputPattern,
  cacheDir,
  clangOpt,
  usePKIR
}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = cacheKey({
    objectBuffer,
    relation,
    inputPattern,
    clangOpt,
    usePKIR
  });
  const exePath = path.join(cacheDir, `${key}.exe`);
  if (!fs.existsSync(exePath)) {
    const tmpPath = path.join(cacheDir, `${key}.${process.pid}.tmp`);
    compileObjectToExecutable(object, tmpPath, {
      relation,
      inputPattern,
      clangOpt,
      usePKIR
    });
    fs.renameSync(tmpPath, exePath);
  }
  return exePath;
}

function compileTemporary({
  object,
  relation,
  inputPattern,
  clangOpt,
  usePKIR
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-llvm-jit-"));
  const exePath = path.join(tmpDir, "program");
  compileObjectToExecutable(object, exePath, {
    relation,
    inputPattern,
    clangOpt,
    usePKIR
  });
  return { exePath, tmpDir };
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let relation = null;
  let cacheDir =
    process.env.K_LLVM_CACHE_DIR ||
    path.join(os.tmpdir(), "k-llvm-jit-cache");
  let clangOpt = process.env.K_LLVM_CLANG_OPT || "-O1";
  let useCache = true;
  let usePKIR = false;
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--retype") {
      relation = args.shift();
      if (!relation) throw new Error("--retype requires a relation name");
    } else if (option === "--cache-dir") {
      cacheDir = args.shift();
      if (!cacheDir) throw new Error("--cache-dir requires a path");
    } else if (option === "--no-cache") {
      useCache = false;
    } else if (option === "--opt") {
      clangOpt = args.shift();
      if (!clangOpt) {
        throw new Error("--opt requires an optimization flag");
      }
    } else if (option === "--pkir") {
      usePKIR = true;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const objectPath = args.shift() || null;
  if (objectPath == null) throw new Error("object-file is required");
  if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);

  const objectBuffer = fs.readFileSync(objectPath);
  const object = decodeObject(objectBuffer);
  const relationName = relation || object.main;
  const inputBuffer = await readStdinBuffer();
  const { pattern: inputPattern } = decodeWire(inputBuffer);

  let tmpDir = null;
  try {
    const exePath = useCache
      ? compileCached({
          object,
          objectBuffer,
          relation: relationName,
          inputPattern,
          cacheDir,
          clangOpt,
          usePKIR
        })
      : (() => {
          const compiled = compileTemporary({
            object,
            relation: relationName,
            inputPattern,
            clangOpt,
            usePKIR
          });
          tmpDir = compiled.tmpDir;
          return compiled.exePath;
        })();
    stdout.write(await runExecutable(exePath, inputBuffer));
  } finally {
    if (tmpDir != null) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  exit(1);
}
