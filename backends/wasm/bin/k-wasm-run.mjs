#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";

import { runWasmArtifact } from "../src/wasm.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-wasm-run.mjs";
  stream(`Usage: node ${prog} wasm-file [ input-file ]`);
  stream("Run a standalone k WebAssembly artifact over a binary pattern+value stream.");
  stream("");
  stream("Arguments:");
  stream("  wasm-file   Input .wasm artifact produced by k-wasm-compile.");
  stream("  input-file  Optional binary input stream. Reads stdin when omitted.");
  stream("");
  stream("Options:");
  stream("  -h, --help  Show this help.");
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  const wasmPath = args.shift();
  if (!wasmPath) throw new Error("Missing .wasm artifact path");
  const inputPath = args.shift();
  if (args.length > 0) throw new Error("Too many arguments");

  const artifact = fs.readFileSync(wasmPath);
  const input = await readAll(inputPath == null ? stdin : fs.createReadStream(inputPath));
  stdout.write(await runWasmArtifact(artifact, input));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
});
