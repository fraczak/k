#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit } from "node:process";
import { decodeObject } from "@fraczak/k/object.mjs";
import { compileObjectToExecutable } from "../src/executable.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-llvm-build.mjs";
  stream(`Usage: node ${prog} [options] object-file output-exe`);
  stream("Compile a k .ko/.klib object into a native executable.");
  stream("");
  stream("The executable reads a binary k pattern+value envelope from stdin and");
  stream("writes a binary k pattern+value envelope to stdout.");
  stream("The stdin envelope pattern must match the compiled input pattern;");
  stream("stdout is encoded with the compiled output pattern.");
  stream("");
  stream("Options:");
  stream("  --retype rel            Relation to specialize. Defaults to object main.");
  stream("  --input-pattern value   Required input pattern property-list JSON, or a file containing it.");
  stream("  -h, --help              Show this help.");
}

function readMaybeFile(textOrPath) {
  return fs.existsSync(textOrPath) ? fs.readFileSync(textOrPath, "utf8") : textOrPath;
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
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--retype") {
      relation = args.shift();
      if (!relation) throw new Error("--retype requires a relation name");
    } else if (option === "--input-pattern") {
      inputPattern = args.shift();
      if (!inputPattern) throw new Error("--input-pattern requires JSON or a file path");
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const objectPath = args.shift() || null;
  const outputPath = args.shift() || null;
  if (objectPath == null) throw new Error("object-file is required");
  if (outputPath == null) throw new Error("output-exe is required");
  if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);
  if (inputPattern == null) throw new Error("--input-pattern is required for k-llvm-build");

  const object = decodeObject(fs.readFileSync(objectPath));
  compileObjectToExecutable(object, outputPath, {
    relation: relation || object.main,
    inputPattern: readPattern(inputPattern)
  });
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
