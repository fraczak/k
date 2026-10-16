#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { argv, exit, stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { decodeWire } from "@fraczak/k/backend-api.mjs";
import {
  compileProgramInputToObject,
  parseCompileOptions,
  readAll,
  resolveProgramInput
} from "../src/cli.mjs";
import {
  compileKVMToExecutable,
  compileObjectToExecutable,
  compilePKIRToExecutable
} from "../src/executable.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function helpText() {
  const prog = argv[1] || "k-llvm.mjs";
  return [
    "Compile k source, .ko, .kvm, or .pkir to native machine code via",
    "LLVM and execute it over a binary pattern+value wire stream.",
    "",
    `Usage: ${prog} [options]`,
    "       ( source-snippet | input-file ) [ input-wire-file ]",
    "",
    "Arguments:",
    "  source-snippet   Inline k source snippet (in the style of k.mjs).",
    "  input-file       Source .k, .ko, .klib, .kvm, or .pkir file.",
    "  input-wire-file  Optional binary wire input (default: stdin).",
    "",
    "Options:",
    "  --lib file        Load one .klib or .k library before compiling.",
    "  --export spec     Export library alias into scope. Repeatable.",
    "                    spec is 'name' or 'libname:localname'.",
    "  --pkir            Lower via Polymorphic K IR (PKIR).",
    "  --retype rel      Relation to specialize (default: object main).",
    "  --cache-dir path  Directory to store compiled native executables.",
    "  --no-cache        Compile in a temporary directory and discard.",
    "  --opt flag        Clang optimization level (-O0, -O1, -O2, -O3).",
    "  -h, --help        Show this help.",
    "",
    "Environment Variables:",
    "  K_LLVM_CACHE_DIR  Default cache directory",
    "                    (default: <tmpdir>/k-llvm-cache).",
    "  K_LLVM_CLANG_OPT  Default Clang optimization flag (default: -O1).",
    "  CLANG, CC         Path to Clang compiler binary (default: clang).",
    "  K_TRACE, TRACE    When '1', output phase tracing to stderr.",
    "",
    "Examples:",
    `  echo '"abc"' | k-parse | ${prog} '{.1 0}' | k-print`,
    `  echo '{"x":1,"y":2}' | k-json --parse | \\`,
    `    ${prog} --lib Examples/poly.k --export concat \\`,
    `      's={()xs,()ys}concat; s' | k-json --print`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

let cachedFingerprint = null;
function getBackendFingerprint() {
  if (cachedFingerprint != null) return cachedFingerprint;
  const hash = crypto.createHash("sha256");
  for (const relPath of [
    "src/llvm.mjs",
    "src/kvm2llvm.mjs",
    "src/executable.mjs",
    "runtime/krt.c",
    "runtime/krt.h"
  ]) {
    const full = path.join(root, relPath);
    if (fs.existsSync(full)) {
      hash.update(relPath);
      hash.update("\0");
      hash.update(fs.readFileSync(full));
      hash.update("\0");
    }
  }
  cachedFingerprint = hash.digest("hex").slice(0, 16);
  return cachedFingerprint;
}

function computeCacheKey({
  fingerprint,
  inputKey,
  relation,
  inputPattern,
  usePKIR,
  clangOpt
}) {
  const hash = crypto.createHash("sha256");
  hash.update("k-llvm-runner-v1\0");
  hash.update(fingerprint);
  hash.update("\0");
  hash.update(String(relation || ""));
  hash.update("\0");
  hash.update(JSON.stringify(inputPattern || null));
  hash.update("\0");
  hash.update(usePKIR ? "pkir\0" : "monomorphic\0");
  hash.update(String(clangOpt || ""));
  hash.update("\0");
  hash.update(inputKey);
  return hash.digest("hex");
}

function runNativeExecutable(exePath, inputBuffer) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [], {
      stdio: ["pipe", "pipe", "inherit"]
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new Error(`${exePath} exited with status ${status}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.end(inputBuffer);
  });
}

async function main() {
  const rawArgs = argv.slice(2);
  if (rawArgs.includes("-h") || rawArgs.includes("--help")) {
    usage(console.log);
    return;
  }

  let cacheDir = process.env.K_LLVM_CACHE_DIR ||
    path.join(os.tmpdir(), "k-llvm-cache");
  let useCache = true;
  let relation = null;
  let clangOpt = process.env.K_LLVM_CLANG_OPT || "-O1";

  const remainingArgs = [];
  while (rawArgs.length > 0) {
    const arg = rawArgs[0];
    if (arg === "--cache-dir") {
      rawArgs.shift();
      cacheDir = rawArgs.shift();
      if (!cacheDir) {
        throw new Error("--cache-dir requires a directory path");
      }
    } else if (arg === "--no-cache") {
      rawArgs.shift();
      useCache = false;
    } else if (arg === "--retype") {
      rawArgs.shift();
      relation = rawArgs.shift();
      if (!relation) {
        throw new Error("--retype requires a relation name");
      }
    } else if (arg === "--opt") {
      rawArgs.shift();
      clangOpt = rawArgs.shift();
      if (!clangOpt) {
        throw new Error("--opt requires a flag (e.g. -O1)");
      }
    } else {
      remainingArgs.push(rawArgs.shift());
    }
  }

  const { libraries, exportSpecs, usePKIR } =
    parseCompileOptions(remainingArgs);
  const programInput = resolveProgramInput(remainingArgs);
  const inputWirePath = remainingArgs.shift();
  if (remainingArgs.length > 0) {
    throw new Error(`Unexpected argument: ${remainingArgs[0]}`);
  }

  const inputBuffer = await readAll(
    inputWirePath == null ? stdin : fs.createReadStream(inputWirePath)
  );
  if (inputBuffer.length === 0) {
    throw new Error("No input wire data received on stdin");
  }

  const { pattern: inputEnvelopePattern } = decodeWire(inputBuffer);

  let exePath;
  let tempExeDir = null;

  if (useCache) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const fingerprint = getBackendFingerprint();
    const inputKey = JSON.stringify({
      programInput,
      libraries: libraries.map((lib) => Object.keys(lib.rels || {})),
      exportSpecs
    });
    const key = computeCacheKey({
      fingerprint,
      inputKey,
      relation,
      inputPattern: inputEnvelopePattern,
      usePKIR,
      clangOpt
    });
    exePath = path.join(cacheDir, `${key}.exe`);
    if (!fs.existsSync(exePath)) {
      const tmpPath = path.join(cacheDir, `${key}.${process.pid}.tmp`);
      if (programInput.kind === "pkir") {
        const pkir = JSON.parse(
          fs.readFileSync(programInput.path, "utf8")
        );
        compilePKIRToExecutable(pkir, tmpPath, {
          inputPattern: inputEnvelopePattern,
          clangOpt
        });
      } else if (programInput.kind === "kvm") {
        const kvm = JSON.parse(
          fs.readFileSync(programInput.path, "utf8")
        );
        compileKVMToExecutable(kvm, tmpPath, {
          inputPattern: inputEnvelopePattern,
          clangOpt,
          usePKIR
        });
      } else {
        const object = await compileProgramInputToObject(programInput, {
          libraries,
          exportSpecs,
          stdin
        });
        compileObjectToExecutable(object, tmpPath, {
          relation: relation || object.main,
          inputPattern: inputEnvelopePattern,
          clangOpt,
          usePKIR
        });
      }
      fs.renameSync(tmpPath, exePath);
    }
  } else {
    tempExeDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-llvm-run-"));
    exePath = path.join(tempExeDir, "prog.exe");
    if (programInput.kind === "pkir") {
      const pkir = JSON.parse(fs.readFileSync(programInput.path, "utf8"));
      compilePKIRToExecutable(pkir, exePath, {
        inputPattern: inputEnvelopePattern,
        clangOpt
      });
    } else if (programInput.kind === "kvm") {
      const kvm = JSON.parse(fs.readFileSync(programInput.path, "utf8"));
      compileKVMToExecutable(kvm, exePath, {
        inputPattern: inputEnvelopePattern,
        clangOpt,
        usePKIR
      });
    } else {
      const object = await compileProgramInputToObject(programInput, {
        libraries,
        exportSpecs,
        stdin
      });
      compileObjectToExecutable(object, exePath, {
        relation: relation || object.main,
        inputPattern: inputEnvelopePattern,
        clangOpt,
        usePKIR
      });
    }
  }

  try {
    const outputBuffer = await runNativeExecutable(exePath, inputBuffer);
    stdout.write(outputBuffer);
  } finally {
    if (tempExeDir) {
      fs.rmSync(tempExeDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  exit(1);
});
