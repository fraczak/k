#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { compileObjectBuffer, decodeObject } from "@fraczak/k/object.mjs";
import { parseValue } from "@fraczak/k/valueIO.mjs";
import { compileObjectAndRun } from "../src/executable.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kRoot = path.resolve(root, "../..");
const conformanceRoot = path.join(kRoot, "conformance");

function helpText() {
  return [
    "Run k-llvm executable conformance fixtures.",
    "",
    `Usage: ${argv[1]} [fixture-dir ...]`,
    "",
    "With no fixture dirs, every supported directory under ../../conformance is run."
  ].join("\n");
}

function fixtureDirs(args) {
  if (args.length > 0) return args.map((arg) => path.resolve(root, arg));
  return fs.readdirSync(conformanceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(conformanceRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "case.json")))
    .sort();
}

function readFixture(dir) {
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "case.json"), "utf8"));
  return {
    dir,
    name: spec.name || path.basename(dir),
    program: fs.readFileSync(path.join(dir, spec.program || "program.k"), "utf8"),
    input: parseValue(fs.readFileSync(path.join(dir, spec.input || "input.kv"), "utf8")),
    expected: parseValue(fs.readFileSync(path.join(dir, spec.expected || "expected.kv"), "utf8"))
  };
}

function runFixture(fixture) {
  const object = decodeObject(compileObjectBuffer(fixture.program, {
    source: path.relative(kRoot, fixture.dir)
  }));
  compileObjectAndRun(object, {
    input: fixture.input,
    expected: fixture.expected
  });
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(helpText());
    exit(0);
  }
  if (args.some((arg) => arg.startsWith("--"))) {
    throw new Error(`Unknown option: ${args.find((arg) => arg.startsWith("--"))}`);
  }

  let count = 0;
  for (const fixture of fixtureDirs(args).map(readFixture)) {
    runFixture(fixture);
    count++;
    console.log(`ok ${fixture.name}`);
  }
  console.log(`OK ${count} fixtures`);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  console.error(helpText());
  exit(1);
}
