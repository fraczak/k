#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { decodeInput, encodeToEnvelope } from "./runtime/prefix-codec.mjs";
import { fromJsonValue, toJsonValue, patternFromJsonValue } from "./json-codec.mjs";

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
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: json.mjs --parse | --print");
    console.error("  --parse  read JSON from stdin, write JSON envelope");
    console.error("  --print  read JSON envelope from stdin, write JSON");
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const json = JSON.parse(buf.toString("utf8"));
    const value = fromJsonValue(json);
    stdout.write(`${JSON.stringify(encodeToEnvelope(value, patternFromJsonValue(json)))}\n`);
  } else {
    const { value } = decodeInput(buf);
    stdout.write(`${JSON.stringify(toJsonValue(value))}\n`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  exit(1);
});
