#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout } from "node:process";
import { decodeWire } from "./runtime/prefix-codec.mjs";

function usage(stream = console.error) {
  stream(`Usage: ${argv[1]} [--debug] [file]`);
  stream("  Read a binary pattern+value stream and print the decoded textual value.");
  stream("");
  stream("Options:");
  stream("  --debug      Print decoded pattern and value as JSON.");
  stream("  -h, --help   Show this help.");
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)))));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  let debug = false;
  let fileArg = null;

  for (const arg of args) {
    if (arg === "--debug") {
      debug = true;
    } else if (fileArg == null) {
      fileArg = arg;
    } else {
      usage();
      process.exit(1);
    }
  }

  const input = fileArg ? fs.createReadStream(fileArg) : stdin;
  const buffer = await readAll(input);
  const { pattern, value } = decodeWire(buffer);

  if (debug) {
    stdout.write(`${JSON.stringify({ pattern, value })}\n`);
    return;
  }

  stdout.write(`${JSON.stringify(value)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
