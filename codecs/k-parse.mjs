#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import { parseValue } from "../valueIO.mjs";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
import { patternFromFilter } from "./runtime/pattern-k.mjs";
import { encodeToWire } from "./runtime/prefix-codec.mjs";

function usage(prog) {
  console.error(`Usage: ${prog} [--input-type <type-script|type-file> | --input-pattern <pattern-script|pattern-file>] [value-file]`);
  console.error("  Parse a textual k value and emit the self-hosted binary pattern+value stream.");
  console.error("  If no pattern or type is provided, derive a closed pattern from the value.");
}

function maybeReadFile(s) {
  if (!s) return s;
  if (fs.existsSync(s) && fs.statSync(s).isFile()) {
    return fs.readFileSync(s, "utf8");
  }
  return s;
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)))));
    stream.on("error", reject);
  });
}

async function main() {
  const prog = argv[1];
  const args = argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    usage(prog);
    return exit(0);
  }

  let inputTypeArg = null;
  let inputPatternArg = null;
  let valueFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input-type") {
      inputTypeArg = args[++i];
    } else if (args[i] === "--input-pattern") {
      inputPatternArg = args[++i];
    } else if (valueFile == null) {
      valueFile = args[i];
    } else {
      usage(prog);
      return exit(1);
    }
  }

  if (inputTypeArg != null && inputPatternArg != null) {
    usage(prog);
    return exit(1);
  }

  const inputBuffer = valueFile ? fs.readFileSync(valueFile) : await readAll(stdin);
  const inputText = inputBuffer.toString("utf8");
  const value = parseValue(inputText, null, null);

  const propertyList = (() => {
    if (inputTypeArg != null) return patternFromFilter(maybeReadFile(inputTypeArg));
    if (inputPatternArg != null) return patternFromFilter(maybeReadFile(inputPatternArg));
    return null;
  })();

  stdout.write(encodeToWire(value, propertyList));
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
