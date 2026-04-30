#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout } from "node:process";
import { decodeInput } from "./runtime/prefix-codec.mjs";

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
  let debug = false;
  let fileArg = null;

  for (const arg of args) {
    if (arg === "--debug") {
      debug = true;
    } else if (fileArg == null) {
      fileArg = arg;
    } else {
      throw new Error("Usage: k-print [--debug] [file]");
    }
  }

  const input = fileArg ? fs.createReadStream(fileArg) : stdin;
  const buffer = await readAll(input);
  const { pattern, value } = decodeInput(buffer);

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
