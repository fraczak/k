#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import {
  compileProgramInputToObject,
  parseCompileOptions,
  resolveProgramInput
} from "../src/cli.mjs";
import { compileObjectToLLVM } from "../src/llvm.mjs";
import { inputPatternForObjectRelation } from "../src/executable.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-llvm-compile.mjs";
  stream(`Usage: node ${prog} [options] [source-snippet | input-file [output.ll]]`);
  stream("Compile a k .ko/.klib object into prototype LLVM IR.");
  stream("");
  stream("Arguments:");
  stream("  source-snippet  Inline k source, in the same style as k.mjs.");
  stream("  input-file      Source .k, .ko, or .klib file. Reads UTF-8 source from stdin when omitted.");
  stream("  output.ll       Output LLVM IR path. Writes to stdout when omitted.");
  stream("");
  stream("Options:");
  stream("  -o, --output path  Specify output file path explicitly.");
  stream("  --lib file         Load one .klib dependency before compiling.");
  stream("  --export spec      Export a library alias into source scope. May be repeated.");
  stream("                     spec is 'name' or 'libname:localname'.");
  stream("  -h, --help         Show this help.");
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
      if (!explicitOutput) throw new Error("-o/--output requires a file argument");
    } else {
      remainingArgs.push(args.shift());
    }
  }

  const { libraries, exportSpecs } = parseCompileOptions(remainingArgs);
  const input = resolveProgramInput(remainingArgs, { allowStdinSource: true });
  const positionalOutput = remainingArgs.shift();
  if (remainingArgs.length > 0) throw new Error("Too many arguments");

  const outputPath = explicitOutput || positionalOutput || null;

  const object = await compileProgramInputToObject(input, {
    libraries,
    exportSpecs,
    stdin
  });

  const { llvm } = compileObjectToLLVM(object, {
    relation: object.main,
    inputPattern: inputPatternForObjectRelation(object, object.main)
  });

  if (outputPath == null) {
    stdout.write(llvm);
  } else {
    fs.writeFileSync(outputPath, llvm, "utf8");
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
