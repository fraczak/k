#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin } from "node:process";
import {
  compileProgramInputToObject,
  parseCompileOptions,
  resolveProgramInput
} from "../src/cli.mjs";
import {
  compileKVMToExecutable,
  compileObjectToExecutable,
  compilePKIRToExecutable
} from "../src/executable.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-llvm-build.mjs";
  stream(`Usage: node ${prog} [options] [source-snippet | input-file [output-exe]]`);
  stream("Compile k source, .ko, .klib, .kvm, or .pkir into native executable.");
  stream("");
  stream("Arguments:");
  stream("  source-snippet  Inline k source, in the same style as k.mjs.");
  stream("  input-file      Source .k, .ko, .klib, .kvm, or .pkir file.");
  stream("                  Reads UTF-8 source from stdin when omitted.");
  stream("  output-exe      Output executable path.");
  stream("");
  stream("The executable reads a binary k pattern+value envelope from stdin and");
  stream("writes a binary k pattern+value envelope to stdout.");
  stream("The stdin envelope pattern must match the compiled input pattern;");
  stream("stdout is encoded with the compiled output pattern.");
  stream("");
  stream("Options:");
  stream("  -o, --output path        Specify output file path explicitly.");
  stream("  --pkir                   Lower via Polymorphic K IR (PKIR).");
  stream("  --input-pattern pattern  Input pattern JSON or file for spec.");
  stream("  --lib file               Load one .klib dependency before build.");
  stream("  --export spec            Export a library alias into scope.");
  stream("                           spec is 'name' or 'libname:localname'.");
  stream("  -h, --help               Show this help.");
}

function readMaybeFile(textOrPath) {
  return fs.existsSync(textOrPath) ? fs.readFileSync(textOrPath, "utf8") : textOrPath;
}

function readPattern(inputPattern) {
  if (inputPattern == null) return null;
  return JSON.parse(readMaybeFile(inputPattern));
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let explicitOutput = null;
  let rawInputPattern = null;
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "-o" || arg === "--output") {
      args.shift();
      explicitOutput = args.shift();
      if (!explicitOutput) throw new Error("-o/--output requires a file argument");
    } else if (arg === "--input-pattern") {
      args.shift();
      rawInputPattern = args.shift();
      if (!rawInputPattern) throw new Error("--input-pattern requires a JSON or file argument");
    } else {
      remainingArgs.push(args.shift());
    }
  }

  const inputPattern = readPattern(rawInputPattern);

  const { libraries, exportSpecs, usePKIR } = parseCompileOptions(remainingArgs);
  const input = resolveProgramInput(remainingArgs, { allowStdinSource: true });
  const positionalOutput = remainingArgs.shift();
  if (remainingArgs.length > 0) throw new Error("Too many arguments");

  const outputPath = explicitOutput || positionalOutput || null;
  if (outputPath == null) throw new Error("Output executable path is required (pass output-exe or -o/--output)");

  if (input.kind === "pkir") {
    const pkir = JSON.parse(fs.readFileSync(input.path, "utf8"));
    compilePKIRToExecutable(pkir, outputPath, { inputPattern });
  } else if (input.kind === "kvm") {
    const kvm = JSON.parse(fs.readFileSync(input.path, "utf8"));
    compileKVMToExecutable(kvm, outputPath, { inputPattern });
  } else {
    const object = await compileProgramInputToObject(input, {
      libraries,
      exportSpecs,
      stdin
    });

    compileObjectToExecutable(object, outputPath, { inputPattern, usePKIR });
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
