#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { extractAliasesFromObjectBuffer } from "../object.mjs";

function helpText() {
  return [
    "Extract metadata aliases from a .ko or .klib as a valid k source snippet.",
    "",
    `Usage: ${argv[1]} [ object-file [ k-file ] ]`,
    "",
    "Output is grouped by metadata type (code, then rel), then sorted by alias",
    "name and compiledAt. Earlier definitions of the same alias are commented",
    "out so only the latest one remains active.",
    "",
    "Arguments:",
    "  object-file  Input .ko or .klib path. Reads object data from stdin when omitted.",
    "  k-file       Output .k path. Writes source to stdout when omitted.",
    "",
    "Options:",
    "  -h, --help   Show this help.",
    "",
    "Example:",
    `  ${argv[1]} core.klib aliases.k`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
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
  if (objectPath === "-h" || objectPath === "--help") {
    usage(console.log);
    exit(0);
  }

  const objectBuffer = objectPath == null ? await readStdinBuffer() : fs.readFileSync(objectPath);
  const source = extractAliasesFromObjectBuffer(objectBuffer);
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
