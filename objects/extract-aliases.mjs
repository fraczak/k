#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { extractAliasesFromObjectBuffer } from "../object.mjs";

function helpText() {
  const prog = argv[1] || "extract-aliases.mjs";
  return [
    "Extract metadata aliases from a .ko or .klib as valid k source.",
    "",
    `Usage: ${prog} [options] [ object-file [ k-file ] ]`,
    "",
    "Output is grouped by metadata type (code, then rel), then sorted",
    "by alias name and compiledAt. Earlier definitions of the same alias",
    "are commented out so only the latest one remains active.",
    "",
    "Arguments:",
    "  object-file        Input .ko or .klib path.",
    "                     Reads object data from stdin when omitted.",
    "  k-file             Output .k path (default: stdout).",
    "",
    "Options:",
    "  -o, --output path  Specify output file path explicitly.",
    "  -h, --help         Show this help.",
    "",
    "Examples:",
    `  ${prog} core.klib -o aliases.k`,
    `  ${prog} core.klib aliases.k`
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
  const rawArgs = argv.slice(2);
  if (rawArgs.includes("-h") || rawArgs.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let explicitOutput = null;
  const remainingArgs = [];
  while (rawArgs.length > 0) {
    const arg = rawArgs[0];
    if (arg === "-o" || arg === "--output") {
      rawArgs.shift();
      explicitOutput = rawArgs.shift();
      if (!explicitOutput) {
        throw new Error("-o/--output requires a file argument");
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      remainingArgs.push(rawArgs.shift());
    }
  }

  const objectPath = remainingArgs.shift() || null;
  const positionalOutput = remainingArgs.shift() || null;
  if (remainingArgs.length > 0) {
    throw new Error(`Unexpected argument: ${remainingArgs[0]}`);
  }
  const outputPath = explicitOutput || positionalOutput || null;

  const objectBuffer = objectPath == null
    ? await readStdinBuffer()
    : fs.readFileSync(objectPath);
  const source = extractAliasesFromObjectBuffer(objectBuffer);
  if (outputPath == null) {
    stdout.write(source);
  } else {
    fs.writeFileSync(outputPath, source);
  }
} catch (error) {
  console.error(error.message || String(error));
  usage();
  exit(1);
}
