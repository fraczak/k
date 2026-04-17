#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { Product } from "../Value.mjs";
import { encodeWithPattern, NODE_KIND } from "./runtime/codec.mjs";

const UNIT_PATTERN = {
  dictionary: [],
  nodes: [
    {
      kind: NODE_KIND.ANY,
      edges: []
    }
  ]
};

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function unitEncoding() {
  return encodeWithPattern(new Product({}), UNIT_PATTERN);
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: unit.mjs --parse | --print");
    console.error("  --parse  ignore stdin and write the unit binary encoding");
    console.error("  --print  validate the unit binary encoding and write {}");
    exit(1);
  }

  const expected = unitEncoding();

  if (args[0] === "--parse") {
    stdout.write(expected);
    return;
  }

  const input = await readAll(stdin);
  if (!input.equals(expected)) {
    throw new Error("Input is not the canonical unit encoding");
  }
  stdout.write("{}");
}

main().catch((error) => {
  console.error(error.message || String(error));
  exit(1);
});