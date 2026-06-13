#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import k from "../index.mjs";
import { parseValue } from "../valueIO.mjs";
import { compileObjectBuffer, decodeObject, objectToFunction } from "../object.mjs";
import { objectToKIRP } from "../kir.mjs";
import { validateKIRP } from "../objects/validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conformanceRoot = path.join(root, "conformance");
const DEFAULT_MODES = ["source", "object", "kir"];

function helpText() {
  return [
    "Run k conformance fixtures.",
    "",
    `Usage: ${argv[1]} [options] [fixture-dir ...]`,
    "",
    "Options:",
    "  --mode list    Comma-separated modes: source, object, kir.",
    "  -h, --help     Show this help.",
    "",
    "With no fixture dirs, every directory under conformance/ with a case.json is run."
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
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
    modes: spec.modes || DEFAULT_MODES,
    program: fs.readFileSync(path.join(dir, spec.program || "program.k"), "utf8"),
    input: parseValue(fs.readFileSync(path.join(dir, spec.input || "input.kv"), "utf8")),
    expected: parseValue(fs.readFileSync(path.join(dir, spec.expected || "expected.kv"), "utf8"))
  };
}

function assertSameValue(actual, expected, label) {
  const actualJson = JSON.stringify(actual.toJSON());
  const expectedJson = JSON.stringify(expected.toJSON());
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function runSource(fixture) {
  const result = k.compile(fixture.program)(fixture.input);
  assertSameValue(result, fixture.expected, `${fixture.name}/source`);
}

function runObject(fixture) {
  const object = decodeObject(compileObjectBuffer(fixture.program, {
    source: path.relative(root, fixture.dir)
  }));
  const result = objectToFunction(object)(fixture.input);
  assertSameValue(result, fixture.expected, `${fixture.name}/object`);
}

function runKIR(fixture) {
  const object = decodeObject(compileObjectBuffer(fixture.program, {
    source: path.relative(root, fixture.dir)
  }));
  const kir = validateKIRP(objectToKIRP(object));
  if (kir.kind !== "executable") throw new Error(`${fixture.name}/kir: expected executable KIR`);
  if (!kir.rels[kir.main]) throw new Error(`${fixture.name}/kir: main relation missing`);
}

function runMode(mode, fixture) {
  if (mode === "source") return runSource(fixture);
  if (mode === "object") return runObject(fixture);
  if (mode === "kir") return runKIR(fixture);
  throw new Error(`Unknown conformance mode '${mode}'`);
}

function parseArgs() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let modes = DEFAULT_MODES;
  const dirs = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--mode") {
      const value = args.shift();
      if (!value) throw new Error("--mode requires a comma-separated list");
      modes = value.split(",").map((mode) => mode.trim()).filter(Boolean);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      dirs.push(arg);
    }
  }
  return { modes, dirs };
}

try {
  const { modes, dirs } = parseArgs();
  const fixtures = fixtureDirs(dirs).map(readFixture);
  let count = 0;
  for (const fixture of fixtures) {
    const fixtureModes = modes.filter((mode) => fixture.modes.includes(mode));
    for (const mode of fixtureModes) {
      runMode(mode, fixture);
      count++;
      console.log(`ok ${fixture.name}/${mode}`);
    }
  }
  console.log(`OK ${count} checks`);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
