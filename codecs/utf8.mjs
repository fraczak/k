#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { encodeText, decodeText } from "./string-codec.mjs";

function usage(stream = console.error) {
  stream(`Usage: ${argv[1]} --parse | --print`);
  stream("  --parse      Read UTF-8 text from stdin, write binary pattern+value stream of k string.");
  stream("  --print      Read binary pattern+value stream of k string, write UTF-8 text.");
  stream("  -h, --help   Show this help.");
}

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
    stdout.write(encodeText(text));
  } else {
    stdout.write(decodeText(buf));
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  exit(1);
});
