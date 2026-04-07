#!/usr/bin/env node

import fs from "node:fs";
import { compileFrontend } from "./frontend.mjs";
import { compileIR } from "./ir.mjs";
import { compileToC } from "./backend_c.mjs";
import { compileToLLVM } from "./backend_llvm.mjs";

function parseArgs(argv) {
  const args = {
    stage: "ir",
    file: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stage") {
      args.stage = argv[i + 1];
      i += 1;
    } else if (!args.file) {
      args.file = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.file
    ? fs.readFileSync(args.file, "utf8")
    : fs.readFileSync(0, "utf8");

  const frontend = compileFrontend(source);
  const ir = compileIR(frontend);

  if (args.stage === "frontend") {
    process.stdout.write(`${JSON.stringify(frontend, null, 2)}\n`);
    return;
  }
  if (args.stage === "ir") {
    process.stdout.write(`${JSON.stringify(ir, null, 2)}\n`);
    return;
  }
  if (args.stage === "c") {
    process.stdout.write(`${compileToC(ir)}\n`);
    return;
  }
  if (args.stage === "llvm") {
    process.stdout.write(`${compileToLLVM(ir)}\n`);
    return;
  }

  throw new Error(`Unknown stage: ${args.stage}`);
}

main();
