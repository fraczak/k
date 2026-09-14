#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";

import { readAll } from "../src/cli.mjs";
import { runARM64Artifact } from "../src/arm64.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-arm64-run.mjs";
  stream(`Usage: node ${prog} [options] executable-file [input-file]`);
  stream("Run a standalone k Linux ARM64 executable over a binary wire stream.");
  stream("");
  stream("Arguments:");
  stream("  executable-file  Input compiled ELF binary produced by k-arm64-compile.");
  stream("  input-file       Optional binary input wire file. Reads stdin when omitted.");
  stream("");
  stream("Options:");
  stream("  --json           Format output as JSON instead of binary wire format.");
  stream("  -h, --help       Show this help.");
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  let json = false;
  const filteredArgs = [];
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  const execPath = filteredArgs.shift();
  if (!execPath) throw new Error("Missing executable artifact path");
  const inputPath = filteredArgs.shift();
  if (filteredArgs.length > 0) throw new Error("Too many arguments");

  const input = await readAll(inputPath == null ? stdin : fs.createReadStream(inputPath));
  const result = runARM64Artifact(execPath, input, { json });
  if (json) {
    stdout.write(result);
  } else {
    stdout.write(result);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
});
