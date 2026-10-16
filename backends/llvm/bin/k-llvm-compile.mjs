#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import {
  compileProgramInputToObject,
  parseCompileOptions,
  resolveProgramInput
} from "../src/cli.mjs";
import {
  compileObjectToLLVM,
  compileLLVMArtifactFromKVM,
  compileLLVMArtifactFromPKIR
} from "../src/llvm.mjs";
import { inputPatternForObjectRelation } from "../src/executable.mjs";

function helpText() {
  const prog = argv[1] || "k-llvm-compile.mjs";
  return [
    "Compile a k .ko/.klib object, source, .kvm, or .pkir into LLVM IR.",
    "",
    `Usage: ${prog} [options]`,
    "       [source-snippet | input-file [output.ll]]",
    "",
    "Arguments:",
    "  source-snippet   Inline k source snippet (in the style of k.mjs).",
    "  input-file       Source .k, .ko, .klib, .kvm, or .pkir file.",
    "                   Reads UTF-8 source from stdin when omitted.",
    "  output.ll        Output LLVM IR path (default: stdout).",
    "",
    "Options:",
    "  -o, --output path  Specify output file path explicitly.",
    "  --pkir             Lower via Polymorphic K IR (PKIR).",
    "  --retype rel       Relation to compile (default: object main).",
    "  --lib file         Load one .klib or .k library before compiling.",
    "  --export spec      Export library alias into scope. Repeatable.",
    "                     spec is 'name' or 'libname:localname'.",
    "  -h, --help         Show this help.",
    "",
    "Examples:",
    `  ${prog} 'x = |x; x x' program.ll`,
    `  ${prog} program.k -o program.ll`,
    `  ${prog} --pkir program.k -o program.ll`,
    `  ${prog} --lib core.klib --export add program.k program.ll`
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
  let relation = null;
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "-o" || arg === "--output") {
      args.shift();
      explicitOutput = args.shift();
      if (!explicitOutput) {
        throw new Error("-o/--output requires a file argument");
      }
    } else if (arg === "--retype") {
      args.shift();
      relation = args.shift();
      if (!relation) {
        throw new Error("--retype requires a relation name");
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

  let llvm;
  if (input.kind === "pkir") {
    const pkir = JSON.parse(fs.readFileSync(input.path, "utf8"));
    const entry = relation || pkir.entry || pkir.name || "__main__";
    llvm = compileLLVMArtifactFromPKIR(pkir, {
      relation: entry,
      inputPattern: pkir.inputPattern,
      outputPattern: pkir.outputPattern
    });
  } else if (input.kind === "kvm") {
    const kvm = JSON.parse(fs.readFileSync(input.path, "utf8"));
    const entry = relation || kvm.entry || kvm.relation || "__main__";
    const mainFunc = kvm.functions?.[entry];
    const artifact = compileLLVMArtifactFromKVM(kvm, {
      relation: entry,
      inputPattern: mainFunc?.inputPattern || kvm.inputPattern,
      outputPattern: mainFunc?.outputPattern || kvm.outputPattern
    });
    llvm = typeof artifact === "string" ? artifact : artifact.llvm;
  } else {
    const object = await compileProgramInputToObject(input, {
      libraries,
      exportSpecs,
      stdin
    });

    const targetRel = relation || object.main;
    const res = compileObjectToLLVM(object, {
      relation: targetRel,
      inputPattern: inputPatternForObjectRelation(object, targetRel),
      usePKIR
    });
    llvm = res.llvm;
  }

  if (outputPath == null) {
    stdout.write(llvm);
  } else {
    fs.writeFileSync(outputPath, llvm, "utf8");
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  exit(1);
}
