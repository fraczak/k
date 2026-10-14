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

function helpText() {
  const prog = argv[1] || "k-llvm-build.mjs";
  return [
    "Compile k source, .ko, .klib, .kvm, or .pkir into a native",
    "standalone executable.",
    "",
    `Usage: ${prog} [options]`,
    "       [source-snippet | input-file [output-exe]]",
    "",
    "Arguments:",
    "  source-snippet   Inline k source snippet (in the style of k.mjs).",
    "  input-file       Source .k, .ko, .klib, .kvm, or .pkir file.",
    "                   Reads UTF-8 source from stdin when omitted.",
    "  output-exe       Output executable path.",
    "",
    "The executable reads a binary k pattern+value envelope from stdin",
    "and writes a binary k pattern+value envelope to stdout.",
    "The stdin envelope pattern must match the compiled input pattern;",
    "stdout is encoded with the compiled output pattern.",
    "",
    "Options:",
    "  -o, --output path        Specify output file path explicitly.",
    "  --pkir                   Lower via Polymorphic K IR (PKIR).",
    "  --input-pattern pattern  Input pattern JSON or file for spec.",
    "  --retype rel             Relation to specialize (default: main).",
    "  --lib file               Load .klib or .k library before build.",
    "  --export spec     Export library alias into scope. Repeatable.",
    "                    spec is 'name' or 'libname:localname'.",
    "  --opt flag               Clang optimization flag (default: -O3).",
    "  -h, --help               Show this help.",
    "",
    "Environment Variables:",
    "  CLANG, CC            Path to Clang compiler (default: clang).",
    "  K_LLVM_CLANG_OPT     Default Clang optimization flag.",
    "  K_LLVM_RUNTIME_MODE  Runtime mode (default: fast).",
    "",
    "Examples:",
    `  ${prog} 'x = |x; x x' -o program.exe`,
    `  ${prog} program.k program.exe`,
    `  ${prog} --lib Examples/poly.k --export concat 's' -o s.exe`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

function readMaybeFile(textOrPath) {
  return fs.existsSync(textOrPath)
    ? fs.readFileSync(textOrPath, "utf8")
    : textOrPath;
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
  let relation = null;
  let clangOpt = process.env.K_LLVM_CLANG_OPT || "-O3";
  let runtimeMode = process.env.K_LLVM_RUNTIME_MODE || "fast";
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "-o" || arg === "--output") {
      args.shift();
      explicitOutput = args.shift();
      if (!explicitOutput) {
        throw new Error("-o/--output requires a file argument");
      }
    } else if (arg === "--input-pattern") {
      args.shift();
      rawInputPattern = args.shift();
      if (!rawInputPattern) {
        throw new Error(
          "--input-pattern requires a JSON or file argument"
        );
      }
    } else if (arg === "--retype") {
      args.shift();
      relation = args.shift();
      if (!relation) {
        throw new Error("--retype requires a relation name");
      }
    } else if (arg === "--opt") {
      args.shift();
      clangOpt = args.shift();
      if (!clangOpt) {
        throw new Error("--opt requires a flag (e.g. -O3)");
      }
    } else {
      remainingArgs.push(args.shift());
    }
  }

  const inputPattern = readPattern(rawInputPattern);

  const { libraries, exportSpecs, usePKIR } =
    parseCompileOptions(remainingArgs);
  const input = resolveProgramInput(remainingArgs, {
    allowStdinSource: true
  });
  const positionalOutput = remainingArgs.shift();
  if (remainingArgs.length > 0) throw new Error("Too many arguments");

  const outputPath = explicitOutput || positionalOutput || null;
  if (outputPath == null) {
    throw new Error(
      "Output executable path required (pass output-exe or -o/--output)"
    );
  }

  if (input.kind === "pkir") {
    const pkir = JSON.parse(fs.readFileSync(input.path, "utf8"));
    compilePKIRToExecutable(pkir, outputPath, {
      entry: relation,
      inputPattern,
      clangOpt,
      runtimeMode
    });
  } else if (input.kind === "kvm") {
    const kvm = JSON.parse(fs.readFileSync(input.path, "utf8"));
    compileKVMToExecutable(kvm, outputPath, {
      entry: relation,
      inputPattern,
      clangOpt,
      runtimeMode,
      usePKIR
    });
  } else {
    const object = await compileProgramInputToObject(input, {
      libraries,
      exportSpecs,
      stdin
    });

    compileObjectToExecutable(object, outputPath, {
      relation: relation || object.main,
      inputPattern,
      clangOpt,
      runtimeMode,
      usePKIR
    });
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  exit(1);
}
