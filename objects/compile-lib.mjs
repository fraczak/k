#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { compileLibraryBuffer, decodeObject, loadLibrary } from "../object.mjs";

function usage() {
  console.error(`Usage: ${argv[1]} [ --lib lib-file ]... [ k-file [ lib-file ] ]`);
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const args = argv.slice(2);
  const libraries = [];
  while (args.length > 0 && args[0] === "--lib") {
    args.shift();
    const libPath = args.shift();
    if (!libPath) throw new Error("--lib requires a file argument");
    libraries.push(loadLibrary(decodeObject(fs.readFileSync(libPath))));
  }

  const sourcePath = args.shift();
  const outputPath = args.shift();
  const source = sourcePath == null ? await readStdinText() : fs.readFileSync(sourcePath, "utf8");
  const objectBuffer = compileLibraryBuffer(source, { source: sourcePath || "<stdin>", libraries });
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
