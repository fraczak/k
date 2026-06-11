#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
import { fromJsonValue, toJsonValue, patternFromJsonValue } from "./json-codec.mjs";

const name = "json";
const universal = true;

function usage(stream = console.error) {
  stream(`Usage: ${argv[1]} --parse | --print`);
  stream("  --parse      Read JSON from stdin, write binary pattern+value stream.");
  stream("  --print      Read binary pattern+value stream from stdin, write JSON.");
  stream("  -h, --help   Show this help.");
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function parse(text) {
  return fromJsonValue(JSON.parse(text));
}

function print(value) {
  return JSON.stringify(toJsonValue(value));
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    usage();
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const text = buf.toString("utf8");
    const json = JSON.parse(text);
    const value = fromJsonValue(json);
    stdout.write(encodeToWire(value, patternFromJsonValue(json)));
  } else {
    const { value } = decodeWire(buf);
    stdout.write(`${print(value)}\n`);
  }
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    exit(1);
  });
}

export { name, universal, parse, print };
