#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { compileBufferToLLVM } from "../src/llvm.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-llvm-compile.mjs";
  stream(`Usage: node ${prog} [options] object-file [output.ll]`);
  stream("Compile a k .ko/.klib object into prototype LLVM IR.");
  stream("");
  stream("Arguments:");
  stream("  object-file     Input .ko or .klib file. Reads bytes from stdin when omitted.");
  stream("  output.ll       Output LLVM IR path. Writes to stdout when omitted.");
  stream("");
  stream("Options:");
  stream("  --retype rel            Relation to specialize. Defaults to object main.");
  stream("  --input-pattern value   Input pattern property-list JSON, or a file containing it.");
  stream("  -h, --help              Show this help.");
}

async function readStdinBytes() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let relation = null;
  let inputPattern = null;
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--retype") {
      relation = args.shift();
      if (!relation) throw new Error("--retype requires a relation name");
    } else if (option === "--input-pattern") {
      inputPattern = args.shift();
      if (!inputPattern) throw new Error("--input-pattern requires JSON or a file path");
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  if (inputPattern == null) throw new Error("--input-pattern is required");

  const inputPath = args.shift() || null;
  const outputPath = args.shift() || null;
  if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);

  const input = inputPath == null ? await readStdinBytes() : fs.readFileSync(inputPath);
  const { llvm } = compileBufferToLLVM(input, { relation, inputPattern });
  if (outputPath == null) {
    stdout.write(llvm);
  } else {
    fs.writeFileSync(outputPath, llvm);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
