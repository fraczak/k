#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout, stderr } from "node:process";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
import { decodeWire } from "./runtime/prefix-codec.mjs";
import { propertyListToFilter, valueToK } from "./runtime/show-value.mjs";

function helpText() {
  const prog = argv[1] || "show.mjs";
  return [
    "Pass a binary wire stream through unchanged on stdout while",
    "printing the decoded value and filter to stderr.",
    "",
    `Usage: ${prog} [wire-file]`,
    "",
    "Arguments:",
    "  wire-file    Input binary wire file (default: stdin).",
    "",
    "Options:",
    "  -h, --help   Show this help.",
    "",
    "Examples:",
    `  echo '"hello"' | k-parse | ${prog} | k-print`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

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
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  let fileArg = null;
  for (const arg of args) {
    if (fileArg == null) fileArg = arg;
    else { usage(); process.exit(1); }
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

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
