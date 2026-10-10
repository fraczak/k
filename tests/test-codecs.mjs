#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as SDK from "../codecs/runtime/codec-sdk.mjs";
import * as IntCodec from "../codecs/int.mjs";
import * as JsonCodec from "../codecs/json.mjs";
import * as Utf8Codec from "../codecs/utf8.mjs";
import * as Utf16Codec from "../codecs/utf16.mjs";
import * as IeeeCodec from "../codecs/ieee.mjs";
import * as UnitCodec from "../codecs/unit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runCLI(codecRelPath, args, input = null) {
  const inputBuffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  const res = spawnSync(process.execPath, [path.join(root, codecRelPath), ...args], {
    input: inputBuffer,
    encoding: null
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    stdoutText: res.stdout ? res.stdout.toString("utf8") : "",
    stderrText: res.stderr ? res.stderr.toString("utf8") : ""
  };
}

console.log("=== Testing Codec Architecture & CLI Contract ===");

// 1. SDK Exports
console.log("1. Verifying SDK exports...");
assert.equal(typeof SDK.Value, "function");
assert.equal(typeof SDK.isProduct, "function");
assert.equal(typeof SDK.isVariant, "function");
assert.equal(typeof SDK.withPattern, "function");
assert.equal(typeof SDK.encodeToWire, "function");
assert.equal(typeof SDK.decodeWire, "function");
assert.equal(typeof SDK.runCodecCLI, "function");
assert.equal(typeof SDK.isMainEntrypoint, "function");
assert.equal(typeof SDK.patternFromFilter, "function");

// 2. In-memory Enveloped Value Contract
console.log("2. Verifying in-memory parse -> enveloped value (P, v)...");
for (const [name, codec, sampleInput] of [
  ["int.mjs", IntCodec, "42"],
  ["json.mjs", JsonCodec, '{"x": 1}'],
  ["utf8.mjs", Utf8Codec, "hello"],
  ["utf16.mjs", Utf16Codec, "hello"],
  ["ieee.mjs", IeeeCodec, "3.14"],
  ["unit.mjs", UnitCodec, undefined]
]) {
  assert.equal(typeof codec.parse, "function", `${name} must export parse()`);
  assert.equal(typeof codec.print, "function", `${name} must export print()`);
  const parsed = sampleInput !== undefined ? codec.parse(sampleInput) : codec.parse();
  assert(parsed && typeof parsed === "object", `${name} parse() must return an object`);
  assert(parsed.pattern, `${name} parse() must produce an enveloped value with .pattern`);
  const printed = codec.print(parsed);
  assert(printed !== undefined, `${name} print() must return a formatted result`);
}

// 3. CLI --help Flag
console.log("3. Verifying CLI --help flag...");
for (const relPath of [
  "codecs/int.mjs",
  "codecs/json.mjs",
  "codecs/utf8.mjs",
  "codecs/utf16.mjs",
  "codecs/ieee.mjs",
  "codecs/unit.mjs"
]) {
  const res = runCLI(relPath, ["--help"]);
  assert.equal(res.status, 0, `${relPath} --help should exit 0`);
  assert(res.stdoutText.includes("Usage:"), `${relPath} --help should output usage`);
  assert(res.stdoutText.includes("--parse"), `${relPath} --help should mention --parse`);
  assert(res.stdoutText.includes("--print"), `${relPath} --help should mention --print`);
}

// 4. CLI --parse and --print Pipelines
console.log("4. Verifying CLI --parse and --print pipelines...");

// int.mjs: single integer
{
  const parseRes = runCLI("codecs/int.mjs", ["--parse"], "-12345\n");
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/int.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.equal(printRes.stdout.toString("utf8").trim(), "-12345");
}

// int.mjs: integer list
{
  const parseRes = runCLI("codecs/int.mjs", ["--parse"], "[0, 1, -2, 3]\n");
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/int.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.equal(printRes.stdout.toString("utf8").trim(), "[0,1,-2,3]");
}

// json.mjs: complex JSON
{
  const jsonInput = JSON.stringify({ name: "k", active: true, count: 42, tags: ["fast", "typed"] });
  const parseRes = runCLI("codecs/json.mjs", ["--parse"], jsonInput);
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/json.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.deepEqual(JSON.parse(printRes.stdout.toString("utf8")), JSON.parse(jsonInput));
}

// utf8.mjs: unicode text
{
  const utf8Input = "Hello 🌍, ąęćłó! \nSecond line.";
  const parseRes = runCLI("codecs/utf8.mjs", ["--parse"], utf8Input);
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/utf8.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.equal(printRes.stdout.toString("utf8"), utf8Input);
}

// ieee.mjs: floating point
{
  const parseRes = runCLI("codecs/ieee.mjs", ["--parse"], "2.71828\n");
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/ieee.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.equal(printRes.stdout.toString("utf8").trim(), "2.71828");
}

// unit.mjs: {}
{
  const parseRes = runCLI("codecs/unit.mjs", ["--parse"], "");
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/unit.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.equal(printRes.stdout.toString("utf8").trim(), "{}");
}

// 5. Error Handling
console.log("5. Verifying CLI error handling...");
{
  // Unknown flag
  const res = runCLI("codecs/int.mjs", ["--unknown"]);
  assert.equal(res.status, 1);
  assert(res.stderrText.includes("Usage:"));
}

{
  // Invalid parse syntax
  const res = runCLI("codecs/int.mjs", ["--parse"], "not_a_number");
  assert.equal(res.status, 1);
  assert(res.stderrText.includes("Invalid integer syntax"));
}

{
  // Invalid wire input to --print
  const res = runCLI("codecs/int.mjs", ["--print"], Buffer.from([0x00, 0x01]));
  assert.equal(res.status, 1);
}

// 6. Pattern Derivation via k Type System
console.log("6. Verifying pattern derivation via k type system (patternFromFilter)...");
{
  const intPat = SDK.patternFromFilter('?< <bits 0, bits 1, {} _>=bits "+", bits "-">');
  assert.deepEqual(IntCodec.INT_PATTERN, intPat);

  const unitPat = SDK.patternFromFilter("?{}");
  assert.deepEqual(UnitCodec.UNIT_PATTERN, unitPat);

  const listPat = SDK.patternFromFilter(
    '?< {} nil, { < <bits 0, bits 1, {} _>=bits "+", bits "-" > car, list cdr } cons > = list'
  );
  assert.deepEqual(IntCodec.INT_LIST_PATTERN, listPat);

  // Verify caching returns identical structure
  const cached = SDK.patternFromFilter("?{}");
  assert.deepEqual(cached, unitPat);

  // Verify error when script is not a filter or type expression
  assert.throws(() => SDK.patternFromFilter(".field"), /Main expression must be a filter or a type name/);
}

console.log("OK - All codec tests passed.");
