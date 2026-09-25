#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";

import {
  compileProgramInput,
  parseCompileOptions,
  resolveProgramInput
} from "../src/cli.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-arm64-compile.mjs";
  stream(`Usage: node ${prog} [options] [source-snippet | input-file [output-file]]`);
  stream("Compile k source, .ko, or .kvm input into a standalone Linux ARM64 executable or assembly.");
  stream("");
  stream("Arguments:");
  stream("  source-snippet  Inline k source, in the same style as k.mjs.");
  stream("  input-file      Source .k, .ko, or .kvm file. Reads UTF-8 source from stdin when omitted.");
  stream("  output-file     Output file path. Writes to stdout when omitted and --assembly is set.");
  stream("");
  stream("Options:");
  stream("  -S, --assembly   Emit GNU ARM64 assembly (.s) instead of an executable binary.");
  stream("  -o, --output     Specify output file path explicitly.");
  stream("  --lib file       Load one .klib dependency before compiling.");
  stream("  --export spec    Export a library alias into source scope. May be repeated.");
  stream("                   spec is 'name' or 'libname:localname'.");
  stream("  -h, --help       Show this help.");
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let emitAssembly = false;
  let explicitOutput = null;
  // Extract ARM64-specific flags
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "-S" || arg === "--assembly") {
      emitAssembly = true;
      args.shift();
    } else if (arg === "-o" || arg === "--output") {
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

  const result = await compileProgramInput(input, {
    libraries,
    exportSpecs,
    stdin,
    emit: emitAssembly ? "assembly" : null,
    outputPath: (!emitAssembly && outputPath) ? outputPath : null
  });

  if (emitAssembly) {
    const asmText = typeof result === "string" ? result : result.assembly;
    if (outputPath == null) {
      stdout.write(asmText);
    } else {
      fs.writeFileSync(outputPath, asmText, "utf8");
    }
  } else {
    if (outputPath == null) {
      if (Buffer.isBuffer(result)) {
        stdout.write(result);
      } else if (typeof result === "string") {
        stdout.write(fs.readFileSync(result));
      }
    } else if (Buffer.isBuffer(result)) {
      fs.writeFileSync(outputPath, result, { mode: 0o755 });
    }
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
