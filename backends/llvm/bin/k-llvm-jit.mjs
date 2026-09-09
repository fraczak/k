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

function usage(stream = console.error) {
  const prog = argv[1] || "k-llvm-jit.mjs";
  stream(`Usage: node ${prog} [options] object-file`);
  stream("Compile and execute a k .ko/.klib object against the stdin binary envelope.");
  stream("");
  stream("The runner reads a binary k pattern+value envelope from stdin, specializes");
  stream("the object with that envelope pattern, then writes a binary envelope to stdout.");
  stream("");
  stream("Options:");
  stream("  --retype rel            Relation to specialize. Defaults to object main.");
  stream("  --cache-dir path        Directory for compiled native executables.");
  stream("  --no-cache              Compile in a temporary directory and remove it after execution.");
  stream("  -h, --help              Show this help.");
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
  for (const relPath of ["src/llvm.mjs", "src/executable.mjs", "runtime/krt.c", "runtime/krt.h"]) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relPath)));
    hash.update("\0");
  }
  cachedBackendFingerprint = hash.digest("hex").slice(0, 16);
  return cachedBackendFingerprint;
}

function cacheKey({ objectBuffer, relation, inputPattern }) {
  const hash = crypto.createHash("sha256");
  hash.update("k-llvm-jit-v2\0");
  hash.update(backendFingerprint());
  hash.update("\0");
  hash.update(relation);
  hash.update("\0");
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
        reject(new Error(`${exePath} failed with status ${status}${stderr ? `\n${stderr}` : ""}`));
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    child.stdin.end(inputBuffer);
  });
}

function compileCached({ object, objectBuffer, relation, inputPattern, cacheDir }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = cacheKey({ objectBuffer, relation, inputPattern });
  const exePath = path.join(cacheDir, `${key}.exe`);
  if (!fs.existsSync(exePath)) {
    const tmpPath = path.join(cacheDir, `${key}.${process.pid}.tmp`);
    compileObjectToExecutable(object, tmpPath, { relation, inputPattern });
    fs.renameSync(tmpPath, exePath);
  }
  return exePath;
}

function compileTemporary({ object, relation, inputPattern }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-llvm-jit-"));
  const exePath = path.join(tmpDir, "program");
  compileObjectToExecutable(object, exePath, { relation, inputPattern });
  return { exePath, tmpDir };
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let relation = null;
  let cacheDir = path.join(os.tmpdir(), "k-llvm-jit-cache");
  let useCache = true;
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
      ? compileCached({ object, objectBuffer, relation: relationName, inputPattern, cacheDir })
      : (() => {
          const compiled = compileTemporary({ object, relation: relationName, inputPattern });
          tmpDir = compiled.tmpDir;
          return compiled.exePath;
        })();
    stdout.write(await runExecutable(exePath, inputBuffer));
  } finally {
    if (tmpDir != null) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
