#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { compileObjectBuffer, decodeObject, loadLibrary } from "../object.mjs";

function helpText() {
  return [
    "Compile a k source file into an executable .ko object.",
    "",
    `Usage: ${argv[1]} [ --lib lib-file ]... [ k-file [ object-file ] ]`,
    "",
    "Arguments:",
    "  k-file       Source .k file to compile. Reads UTF-8 source from stdin when omitted.",
    "  object-file  Output .ko path. Writes binary object data to stdout when omitted.",
    "",
    "Options:",
    "  --lib file   Load a .klib dependency before compiling. May be repeated.",
    "  -h, --help   Show this help.",
    "",
    "Example:",
    `  ${argv[1]} --lib core.klib program.k program.ko`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
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
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

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
  const objectBuffer = compileObjectBuffer(source, { source: sourcePath || "<stdin>", libraries });
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
