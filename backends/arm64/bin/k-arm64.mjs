#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { decodeWire } from "../../../backend-api.mjs";

import {
  compileProgramInput,
  parseCompileOptions,
  readAll,
  resolveProgramInput
} from "../src/cli.mjs";
import { runARM64Artifact } from "../src/arm64.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-arm64.mjs";
  stream(`Usage: node ${prog} [options] ( source-snippet | input-file ) [ input-file ]`);
  stream("Compile k source, .ko, or .kvm input to ARM64 in memory and run it over a binary pattern+value stream.");
  stream("");
  stream("Options:");
  stream("  --json           Format output as JSON instead of binary wire format.");
  stream("  --entry name     Specify entry relation name.");
  stream("  --lib file       Load one .klib dependency before compiling.");
  stream("  --export spec    Export a library alias into source scope. May be repeated.");
  stream("                   spec is 'name' or 'libname:localname'.");
  stream("  -h, --help       Show this help.");
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  let json = false;
  let entry = null;
  const remainingArgs = [];
  while (args.length > 0) {
    const arg = args[0];
    if (arg === "--json") {
      json = true;
      args.shift();
    } else if (arg === "--entry") {
      args.shift();
      entry = args.shift();
      if (!entry) throw new Error("--entry requires a name argument");
    } else {
      remainingArgs.push(args.shift());
    }
  }

  const { libraries, exportSpecs } = parseCompileOptions(remainingArgs);
  const programInput = resolveProgramInput(remainingArgs);
  const inputPath = remainingArgs.shift();
  if (remainingArgs.length > 0) throw new Error("Too many arguments");

  const inputBuffer = await readAll(inputPath == null ? stdin : fs.createReadStream(inputPath));
  let inputEnvelopePattern = null;
  if (inputBuffer.length > 0) {
    try {
      const decoded = decodeWire(inputBuffer);
      inputEnvelopePattern = decoded.pattern;
    } catch {
      // Not a valid wire buffer or empty
    }
  }

  const artifact = await compileProgramInput(programInput, {
    libraries,
    exportSpecs,
    inputEnvelopePattern,
    entry
  });

  const output = runARM64Artifact(artifact, inputBuffer, { json });
  if (json) {
    stdout.write(output);
  } else {
    stdout.write(output);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
});
