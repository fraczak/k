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

function decodeUtf16Input(buf) {
  if (buf.length === 0) return "";

  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const src = buf.subarray(2);
    if (src.length % 2 !== 0) throw new Error("UTF-16BE payload has odd byte length");
    const le = Buffer.alloc(src.length);
    for (let i = 0; i < src.length; i += 2) {
      le[i] = src[i + 1];
      le[i + 1] = src[i];
    }
    return le.toString("utf16le");
  }

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const src = buf.subarray(2);
    if (src.length % 2 !== 0) throw new Error("UTF-16LE payload has odd byte length");
    return src.toString("utf16le");
  }

  if (buf.length % 2 !== 0) throw new Error("UTF-16 input without BOM has odd byte length");
  return buf.toString("utf16le");
}

function encodeUtf16Output(text) {
  const bomLe = Buffer.from([0xff, 0xfe]);
  return Buffer.concat([bomLe, Buffer.from(text, "utf16le")]);
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: utf16.mjs --parse | --print");
    console.error("  --parse  read UTF-16 text from stdin (BOM-aware), write binary pattern+value stream of k string");
    console.error("  --print  read binary pattern+value stream of k string, write UTF-16LE text with BOM");
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const text = decodeUtf16Input(buf);
    stdout.write(encodeText(text));
  } else {
    stdout.write(encodeUtf16Output(decodeText(buf)));
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  exit(1);
});
