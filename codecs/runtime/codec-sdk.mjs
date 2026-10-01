#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout, stderr, exit } from "node:process";
import { Value, isProduct, isVariant, withPattern } from "../../Value.mjs";
import { decodeWire, encodeToWire } from "./prefix-codec.mjs";
import { isMainEntrypoint } from "./cli-entry.mjs";
import { patternFromFilter } from "./pattern-k.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function printUsage(fileName, doc) {
  stdout.write(`Usage: ${fileName} --parse | --print\n\n`);
  if (doc) {
    stdout.write(`${doc.trim()}\n\n`);
  }
  stdout.write("Options:\n");
  stdout.write("  --parse      Read external text from stdin, write binary pattern+value stream to stdout.\n");
  stdout.write("  --print      Read binary pattern+value stream from stdin, write external text to stdout.\n");
  stdout.write("  -h, --help   Show this help.\n");
}

function runCodecCLI(metaUrl, codec) {
  if (typeof process === "undefined" || !process.argv) return;
  if (!isMainEntrypoint(metaUrl, process.argv[1])) return;

  const filePath = fileURLToPath(metaUrl);
  const fileName = path.basename(filePath);
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    printUsage(fileName, codec.doc);
    exit(0);
  }

  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    stderr.write(`Usage: ${fileName} --parse | --print\n`);
    stderr.write("Try '--help' for more information.\n");
    exit(1);
  }

  const mode = args[0];

  (async () => {
    if (mode === "--parse") {
      let parsed;
      if (typeof codec.parse === "function" && codec.parse.length === 0) {
        parsed = codec.parse();
      } else {
        const buf = await readAll(stdin);
        if (codec.readBuffer) {
          parsed = codec.parse(buf);
        } else {
          parsed = codec.parse(buf.toString("utf8"));
        }
      }
      const pattern = parsed?.pattern || codec.pattern || null;
      const wire = encodeToWire(parsed, pattern);
      stdout.write(wire);
    } else {
      const buf = await readAll(stdin);
      const { value } = decodeWire(buf);
      const output = codec.print(value);
      if (Buffer.isBuffer(output) || codec.addNewline === false) {
        stdout.write(output);
      } else {
        stdout.write(`${output}\n`);
      }
    }
  })().catch((err) => {
    stderr.write(`${fileName}: ${err.message || String(err)}\n`);
    exit(1);
  });
}

export {
  Value,
  isProduct,
  isVariant,
  withPattern,
  encodeToWire,
  decodeWire,
  isMainEntrypoint,
  runCodecCLI,
  patternFromFilter
};
