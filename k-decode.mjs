#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout } from "node:process";
import { decode } from "./codecs/runtime/codec.mjs";
import { unpackEnvelope } from "./codecs/runtime/envelope.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)))));
    stream.on("error", reject);
  });
}

async function main() {
  const fileArg = argv[2];
  const input = fileArg ? fs.createReadStream(fileArg) : stdin;
  const buffer = await readAll(input);

  const { types, payload } = unpackEnvelope(buffer);
  const resolveType = (typeName) => {
    const code = types[typeName];
    if (!code) {
      throw new Error(`Unknown type in envelope: ${typeName}`);
    }
    return code;
  };

  const { value } = decode(payload, resolveType);
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
