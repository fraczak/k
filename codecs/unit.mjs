#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { Product } from "../Value.mjs";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";

function usage(stream = console.error) {
  stream(`Usage: ${argv[1]} --parse | --print`);
  stream("  --parse      Ignore stdin and write the unit binary pattern+value stream.");
  stream("  --print      Validate the unit binary pattern+value stream and write {}.");
  stream("  -h, --help   Show this help.");
}

const UNIT_PATTERN = [
  ["closed-product", []]
];
const name = "unit";
const patterns = [UNIT_PATTERN];

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function unitEncoding() {
  return encodeToWire(new Product({}), UNIT_PATTERN);
}

function parse() {
  return new Product({});
}

function print(value) {
  if (!(value instanceof Product) || Object.keys(value.product).length !== 0) {
    throw new Error("Input is not a unit value");
  }
  return "{}";
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

  const expected = unitEncoding();

  if (args[0] === "--parse") {
    stdout.write(expected);
    return;
  }

  const input = await readAll(stdin);
  const { value } = decodeWire(input);
  stdout.write(print(value));
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch((error) => {
    console.error(error.message || String(error));
    exit(1);
  });
}

export { UNIT_PATTERN, name, patterns, parse, print };
