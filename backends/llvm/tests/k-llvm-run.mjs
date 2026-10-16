#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { decodeObject } from "@fraczak/k/object.mjs";
import { parseValue } from "@fraczak/k/valueIO.mjs";
import { compileObjectAndRun } from "../src/executable.mjs";

function helpText() {
  const prog = argv[1] || "k-llvm-run.mjs";
  return [
    "Compile and execute a k .ko/.klib object through LLVM.",
    "",
    `Usage: ${prog} [options] object-file [input.kv]`,
    "",
    "Arguments:",
    "  object-file     Input .ko or .klib file.",
    "  input.kv        Input value. Reads text from stdin when omitted.",
    "",
    "Options:",
    "  --retype rel            Relation to specialize (default: main).",
    "  --input-pattern value   Input pattern property-list JSON or file.",
    "  --expect value          Expected output value JSON/text or file.",
    "  --pkir                  Lower via Polymorphic K IR (PKIR).",
    "  -h, --help              Show this help.",
    "",
    "Without --expect, the runner prints the result as compact JSON.",
    "",
    "Examples:",
    `  ${prog} program.ko input.kv`,
    `  ${prog} --expect expected.kv program.ko input.kv`,
    `  echo '{"x":"left"}' | ${prog} program.ko`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readMaybeFile(textOrPath) {
  return fs.existsSync(textOrPath)
    ? fs.readFileSync(textOrPath, "utf8")
    : textOrPath;
}

function readPattern(inputPattern) {
  if (inputPattern == null) return null;
  return JSON.parse(readMaybeFile(inputPattern));
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let relation = null;
  let inputPattern = null;
  let expectedText = null;
  let usePKIR = false;
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--retype") {
      relation = args.shift();
      if (!relation) throw new Error("--retype requires a relation name");
    } else if (option === "--input-pattern") {
      inputPattern = args.shift();
      if (!inputPattern) {
        throw new Error("--input-pattern requires JSON or a file path");
      }
    } else if (option === "--expect") {
      expectedText = args.shift();
      if (!expectedText) {
        throw new Error("--expect requires a value or file path");
      }
    } else if (option === "--pkir") {
      usePKIR = true;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const objectPath = args.shift() || null;
  const inputPath = args.shift() || null;
  if (objectPath == null) throw new Error("object-file is required");
  if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);

  const object = decodeObject(fs.readFileSync(objectPath));
  const inputText = inputPath == null
    ? await readStdinText()
    : fs.readFileSync(inputPath, "utf8");
  const input = parseValue(inputText);
  const expected = expectedText == null
    ? null
    : parseValue(readMaybeFile(expectedText));
  const result = compileObjectAndRun(object, {
    relation: relation || object.main,
    input,
    expected,
    inputPattern: readPattern(inputPattern),
    usePKIR
  });
  stdout.write(expected == null ? result.stdout : "OK\n");
} catch (error) {
  console.error(error.stack || error.message || String(error));
  exit(1);
}
