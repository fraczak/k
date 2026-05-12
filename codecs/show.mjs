#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout, stderr } from "node:process";
import { decodeWire } from "./runtime/prefix-codec.mjs";
import { propertyListToFilter, valueToK } from "./runtime/show-value.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  let fileArg = null;
  for (const arg of args) {
    if (fileArg == null) fileArg = arg;
    else { console.error("Usage: show.mjs [wire-file]"); process.exit(1); }
  }

  const buffer = fileArg ? fs.readFileSync(fileArg) : await readAll(stdin);

  // forward unchanged to stdout
  stdout.write(buffer);

  // decode and print: value filter
  const { pattern, value } = decodeWire(buffer);

  const valueStr = valueToK(value);
  const filterStr = propertyListToFilter(pattern);
  stderr.write(`${valueStr} ?${filterStr}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
