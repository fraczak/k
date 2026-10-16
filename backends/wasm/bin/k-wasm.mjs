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

function helpText() {
  const prog = argv[1] || "k-wasm.mjs";
  return [
    "Compile k source, .ko, .kvm, or .pkir to WebAssembly in memory",
    "and run it over a binary pattern+value wire stream.",
    "",
    `Usage: ${prog} [options]`,
    "       ( source-snippet | input-file ) [ input-wire-file ]",
    "",
    "Arguments:",
    "  source-snippet   Inline k source snippet (in the style of k.mjs).",
    "  input-file       Source .k, .ko, .kvm, or .pkir file.",
    "  input-wire-file  Optional binary wire input (default: stdin).",
    "",
    "Options:",
    "  --lib file        Load one .klib or .k library before compiling.",
    "  --export spec     Export library alias into scope. Repeatable.",
    "                    spec is 'name' or 'libname:localname'.",
    "  --pkir            Lower via Polymorphic K IR (PKIR).",
    "  -h, --help        Show this help.",
    "",
    "Environment Variables:",
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

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  const { libraries, exportSpecs, usePKIR } = parseCompileOptions(args);
  const programInput = resolveProgramInput(args);
  const inputPath = args.shift();
  if (args.length > 0) throw new Error("Too many arguments");

  const inputBuffer = await readAll(
    inputPath == null ? stdin : fs.createReadStream(inputPath)
  );
  if (inputBuffer.length === 0) {
    throw new Error("No input wire data received on stdin");
  }

  const { pattern: inputEnvelopePattern } = decodeWire(inputBuffer);
  const artifact = await compileProgramInput(programInput, {
    libraries,
    exportSpecs,
    inputEnvelopePattern,
    usePKIR
  });
  stdout.write(await runWasmArtifact(artifact, inputBuffer));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  exit(1);
});
