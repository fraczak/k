#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout } from "node:process";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
import { decodeWire } from "./runtime/prefix-codec.mjs";

function helpText() {
  const prog = argv[1] || "k-print.mjs";
  return [
    "Read a binary pattern+value stream and print the decoded",
    "textual value.",
    "",
    `Usage: ${prog} [options] [file]`,
    "",
    "Arguments:",
    "  file         Input binary wire file (default: stdin).",
    "",
    "Options:",
    "  --debug      Print decoded pattern and value as JSON.",
    "  -h, --help   Show this help.",
    "",
    "Examples:",
    `  echo '"hello"' | k-parse | ${prog}`,
    `  ${prog} input.wire`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
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

  stdout.on("error", (err) => {
    if (err.code === "EPIPE") process.exit(0);
  });

  const input = fileArg ? fs.createReadStream(fileArg) : stdin;
  const buffer = await readAll(input);
  const { pattern, value } = decodeWire(buffer);

  if (debug) {
    stdout.write(`${JSON.stringify({ pattern, value })}\n`);
    return;
  }

  stdout.write(`${JSON.stringify(value)}\n`);
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
