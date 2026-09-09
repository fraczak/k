#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { decodeObject } from "../object.mjs";
import { objectToKIRP } from "../kir.mjs";

function helpText() {
  return [
    "Inspect a k .ko or .klib object.",
    "",
    `Usage: ${argv[1]} [options] [object-file]`,
    "",
    "Arguments:",
    "  object-file    Input .ko or .klib file. Reads from stdin when omitted.",
    "",
    "Options:",
    "  --kir          Print the KIR-P JSON view.",
    "  --summary      Print a compact section summary. This is the default.",
    "  -h, --help     Show this help.",
    "",
    "KIR-P is an inspection/export view; it does not change the stored object format."
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

async function readStdinBytes() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function inspectSummary(object) {
  const relationEntries = Object.entries(object.rels || {});
  const codeCount = Object.keys(object.codes || {}).length;
  const aliasCount = Object.keys(object.relAlias || {}).length;
  const metaCount = Object.keys(object.meta || {}).length;
  const statuses = new Map();
  for (const [, rel] of relationEntries) {
    const status = rel.typeDerivation?.status || "unknown";
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }

  return [
    `format: ${object.format}`,
    `kind: ${object.main == null ? "library" : "executable"}`,
    `main: ${object.main ?? "null"}`,
    `codes: ${codeCount}`,
    `relations: ${relationEntries.length}`,
    `aliases: ${aliasCount}`,
    `metadata entries: ${metaCount}`,
    `type derivation: ${[...statuses.entries()].map(([status, count]) => `${status}=${count}`).join(", ") || "none"}`
  ].join("\n") + "\n";
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let mode = "summary";
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--kir") {
      mode = "kir";
    } else if (option === "--summary") {
      mode = "summary";
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const inputPath = args.shift() || null;
  if (args.length > 0) {
    throw new Error(`Unexpected argument: ${args[0]}`);
  }

  const buffer = inputPath == null ? await readStdinBytes() : fs.readFileSync(inputPath);
  const object = decodeObject(buffer);
  if (mode === "kir") {
    stdout.write(JSON.stringify(objectToKIRP(object), null, 2) + "\n");
  } else {
    stdout.write(inspectSummary(object));
  }
} catch (error) {
  console.error(error.message || String(error));
  usage();
  exit(1);
}
