#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin } from "node:process";
import {
  compileProgramInputToObject,
  parseCompileOptions,
  resolveProgramInput
} from "../src/cli.mjs";
import { compileObjectToExecutable } from "../src/executable.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-llvm-build.mjs";
  stream(`Usage: node ${prog} [options] [source-snippet | input-file [output-exe]]`);
  stream("Compile k source, .ko, or .klib input into a native executable.");
  stream("");
  stream("Arguments:");
  stream("  source-snippet  Inline k source, in the same style as k.mjs.");
  stream("  input-file      Source .k, .ko, or .klib file. Reads UTF-8 source from stdin when omitted.");
  stream("  output-exe      Output executable path.");
  stream("");
  stream("The executable reads a binary k pattern+value envelope from stdin and");
  stream("writes a binary k pattern+value envelope to stdout.");
  stream("The stdin envelope pattern must match the compiled input pattern;");
  stream("stdout is encoded with the compiled output pattern.");
  stream("");
  stream("Options:");
  stream("  -o, --output path  Specify output file path explicitly.");
  stream("  --main spec        Relation name or k snippet to specialize as main. Defaults to object main.");
  stream("  --retype spec      Alias for --main.");
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
  let mainSpec = null;
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "-o" || arg === "--output") {
      args.shift();
      explicitOutput = args.shift();
      if (!explicitOutput) throw new Error("-o/--output requires a file argument");
    } else if (arg === "--main" || arg === "--retype") {
      args.shift();
      mainSpec = args.shift();
      if (!mainSpec) throw new Error(`${arg} requires a relation name or k snippet`);
    } else {
      remainingArgs.push(args.shift());
    }
  }

  const { libraries, exportSpecs } = parseCompileOptions(remainingArgs);
  const input = resolveProgramInput(remainingArgs, { allowStdinSource: true });
  const positionalOutput = remainingArgs.shift();
  if (remainingArgs.length > 0) throw new Error("Too many arguments");

  const outputPath = explicitOutput || positionalOutput || null;
  if (outputPath == null) throw new Error("Output executable path is required (pass output-exe or -o/--output)");

  const object = await compileProgramInputToObject(input, {
    libraries,
    exportSpecs,
    stdin,
    main: mainSpec
  });

  compileObjectToExecutable(object, outputPath);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
