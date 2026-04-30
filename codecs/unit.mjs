#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { Product } from "../Value.mjs";
import { decodeInput, encodeToEnvelope } from "./runtime/prefix-codec.mjs";

const UNIT_PATTERN = [
  ["closed-product", []]
];

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function unitEncoding() {
  return `${JSON.stringify(encodeToEnvelope(new Product({}), UNIT_PATTERN))}\n`;
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: unit.mjs --parse | --print");
    console.error("  --parse  ignore stdin and write the unit JSON envelope");
    console.error("  --print  validate the unit JSON envelope and write {}");
    exit(1);
  }

  const expected = unitEncoding();

  if (args[0] === "--parse") {
    stdout.write(expected);
    return;
  }

  const input = await readAll(stdin);
  const { value } = decodeInput(input);
  if (!(value instanceof Product) || Object.keys(value.product).length !== 0) {
    throw new Error("Input is not a unit value");
  }
  stdout.write("{}");
}

main().catch((error) => {
  console.error(error.message || String(error));
  exit(1);
});
