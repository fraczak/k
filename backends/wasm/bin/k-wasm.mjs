#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { decodeWire } from "@fraczak/k/backend-api.mjs";

import {
  compileProgramInput,
  parseCompileOptions,
  readAll,
  resolveProgramInput
} from "../src/cli.mjs";
import { runWasmArtifact } from "../src/wasm.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-wasm.mjs";
  stream(`Usage: node ${prog} [options] ( source-snippet | input-file ) [ input-file ]`);
  stream("Compile k source, .ko, or .kvm input to WebAssembly in memory and run it over a binary pattern+value stream.");
  stream("");
  stream("Options:");
  stream("  --lib file       Load one .klib dependency before compiling.");
  stream("  --export spec    Export a library alias into source scope. May be repeated.");
  stream("                   spec is 'name' or 'libname:localname'.");
  stream("  -h, --help       Show this help.");
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  const { libraries, exportSpecs } = parseCompileOptions(args);
  const programInput = resolveProgramInput(args);
  const inputPath = args.shift();
  if (args.length > 0) throw new Error("Too many arguments");

  const inputBuffer = await readAll(inputPath == null ? stdin : fs.createReadStream(inputPath));
  const { pattern: inputEnvelopePattern } = decodeWire(inputBuffer);
  const artifact = await compileProgramInput(programInput, { libraries, exportSpecs, inputEnvelopePattern });
  stdout.write(await runWasmArtifact(artifact, inputBuffer));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
});
