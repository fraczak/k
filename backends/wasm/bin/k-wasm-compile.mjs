#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";

import {
  compileProgramInput,
  parseCompileOptions,
  resolveProgramInput
} from "../src/cli.mjs";

function helpText() {
  const prog = argv[1] || "k-wasm-compile.mjs";
  return [
    "Compile k source, .ko, .kvm, or .pkir into a WebAssembly (.wasm)",
    "artifact.",
    "",
    `Usage: ${prog} [options]`,
    "       [source-snippet | input-file [output-wasm]]",
    "",
    "Arguments:",
    "  source-snippet   Inline k source snippet (in the style of k.mjs).",
    "  input-file       Source .k, .ko, .kvm, or .pkir file.",
    "                   Reads UTF-8 source from stdin when omitted.",
    "  output-wasm      Output .wasm path. Writes to stdout if omitted.",
    "",
    "Options:",
    "  -o, --output path  Specify output file path explicitly.",
    "  --pkir             Lower via Polymorphic K IR (PKIR).",
    "  --lib file         Load one .klib or .k library before compiling.",
    "  --export spec      Export library alias into scope. Repeatable.",
    "                     spec is 'name' or 'libname:localname'.",
    "  -h, --help         Show this help.",
    "",
    "Examples:",
    `  ${prog} 'x = |x; x x' program.wasm`,
    `  ${prog} program.k -o program.wasm`,
    `  ${prog} --pkir program.k -o program.wasm`,
    `  ${prog} --lib core.klib --export add program.k program.wasm`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let explicitOutput = null;
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "-o" || arg === "--output") {
      args.shift();
      explicitOutput = args.shift();
      if (!explicitOutput) {
        throw new Error("-o/--output requires a file argument");
      }
    } else {
      remainingArgs.push(args.shift());
    }
  }

  const { libraries, exportSpecs, usePKIR } =
    parseCompileOptions(remainingArgs);
  const input = resolveProgramInput(remainingArgs, {
    allowStdinSource: true
  });
  const positionalOutput = remainingArgs.shift();
  if (remainingArgs.length > 0) throw new Error("Too many arguments");
  const outputPath = explicitOutput || positionalOutput || null;
  const artifact = await compileProgramInput(input, {
    libraries,
    exportSpecs,
    stdin,
    usePKIR
  });
  if (outputPath == null) {
    stdout.write(artifact);
  } else {
    fs.writeFileSync(outputPath, artifact);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  exit(1);
}
