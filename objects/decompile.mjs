#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { decompileObjectBuffer } from "../object.mjs";

function usage() {
  console.error(`Usage: ${argv[1]} [ object-file [ k-file ] ]`);
}

async function readStdinBuffer() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

try {
  const [, , objectPath, outputPath] = argv;
  const objectBuffer = objectPath == null ? await readStdinBuffer() : fs.readFileSync(objectPath);
  const source = decompileObjectBuffer(objectBuffer);
  if (outputPath == null) {
    stdout.write(source);
  } else {
    fs.writeFileSync(outputPath, source);
  }
} catch (error) {
  console.error(error);
  usage();
  exit(1);
}
