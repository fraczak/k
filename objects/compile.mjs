#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { compileObjectBuffer } from "../object.mjs";

function usage() {
  console.error(`Usage: ${argv[1]} [ k-file [ object-file ] ]`);
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const [, , sourcePath, outputPath] = argv;
  const source = sourcePath == null ? await readStdinText() : fs.readFileSync(sourcePath, "utf8");
  const objectBuffer = compileObjectBuffer(source);
  if (outputPath == null) {
    stdout.write(objectBuffer);
  } else {
    fs.writeFileSync(outputPath, objectBuffer);
  }
} catch (error) {
  console.error(error);
  usage();
  exit(1);
}
