#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { encodeText, decodeText } from "./string-codec.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: utf8.mjs --parse | --print");
    console.error("  --parse  read UTF-8 text from stdin, write binary KPV2 encoding of k string");
    console.error("  --print  read binary KPV2 encoding of k string, write UTF-8 text");
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const text = buf.toString("utf8");
    stdout.write(encodeText(text));
  } else {
    stdout.write(decodeText(buf));
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  exit(1);
});
