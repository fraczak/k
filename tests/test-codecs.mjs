#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as SDK from "../codecs/runtime/codec-sdk.mjs";
import * as IntCodec from "../codecs/int.mjs";
import * as JsonCodec from "../codecs/json.mjs";
import * as DjsonCodec from "../codecs/djson.mjs";
import * as DjsonBtrieCodec from "../codecs/djson-btrie.mjs";
import * as DjsonPtrieCodec from "../codecs/djson-ptrie.mjs";
import * as Utf8Codec from "../codecs/utf8.mjs";
import * as Utf16Codec from "../codecs/utf16.mjs";
import * as IeeeCodec from "../codecs/ieee.mjs";
import * as UnitCodec from "../codecs/unit.mjs";
import {
  valueToK,
  valueWithEnvelopeToK
} from "../codecs/runtime/show-value.mjs";

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
  ["djson.mjs", DjsonCodec, '{"x": 1, "arr": [true, null, "hi"]}'],
  ["djson-btrie.mjs", DjsonBtrieCodec, '{"x": 1, "arr": [true, null, "hi"]}'],
  ["djson-ptrie.mjs", DjsonPtrieCodec, '{"x": 1, "arr": [true, null, "hi"]}'],
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
  "codecs/djson.mjs",
  "codecs/djson-btrie.mjs",
  "codecs/djson-ptrie.mjs",
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

// djson.mjs: dynamic JSON AST with singleton pattern
{
  const djsonInput = JSON.stringify({
    name: "k",
    count: 42.5,
    tags: ["fast", "typed"],
    meta: { active: true, extra: null }
  });
  const parseRes = runCLI("codecs/djson.mjs", ["--parse"], djsonInput);
  assert.equal(parseRes.status, 0);
  const printRes = runCLI("codecs/djson.mjs", ["--print"], parseRes.stdout);
  assert.equal(printRes.status, 0);
  assert.deepEqual(
    JSON.parse(printRes.stdout.toString("utf8")),
    JSON.parse(djsonInput)
  );
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

// 7. Lazy Prefix-Free Wire Decoding
console.log("7. Verifying lazy prefix-free wire decoding...");
{
  assert.equal(typeof SDK.decodeWireLazy, "function");

  // Lazy decoding should instantiate root in sub-millisecond time
  const sampleStr = "a".repeat(20000);
  const parsedStr = Utf8Codec.parse(sampleStr);
  const wireStr = SDK.encodeToWire(parsedStr, parsedStr.pattern);

  const t0 = performance.now();
  const decodedLazy = SDK.decodeWire(wireStr);
  const constructMs = performance.now() - t0;
  assert(
    constructMs < 50,
    `Lazy decode took ${constructMs}ms (expected <50ms)`
  );
  assert.equal(decodedLazy.value.tag, "cons");

  // On-demand traversal through print()
  const printedStr = Utf8Codec.print(decodedLazy.value);
  assert.equal(printedStr, sampleStr);

  // Lazy list of integers
  const ints = Array.from({ length: 5000 }, (_, i) => i).join(",");
  const sampleList = `[${ints}]`;
  const parsedList = IntCodec.parse(sampleList);
  const wireList = SDK.encodeToWire(parsedList, parsedList.pattern);
  const decodedList = SDK.decodeWireLazy(wireList);
  assert.equal(IntCodec.print(decodedList.value), sampleList);

  // Verify stack-safe toJSON on deep variant chains
  let deepVal = SDK.Value.product({});
  for (let i = 0; i < 15000; i++) {
    deepVal = SDK.Value.variant("step", deepVal);
  }
  const json = deepVal.toJSON();
  assert(json && typeof json === "object");
}

// 8. High-Speed Direct Bitstream String Decoding & Bounded Rendering
console.log("8. Verifying fast string decoding & bounded rendering...");
{
  const testStrings = [
    "hello world",
    "Zażółć gęślą jaźń",
    "Unicode: 🚀🎉 𝒦-lang π ≈ 3.14159",
    "a".repeat(50000),
    ""
  ];

  for (const s of testStrings) {
    const parsed = Utf8Codec.parse(s);
    const wire = SDK.encodeToWire(parsed, parsed.pattern);
    const decoded = SDK.decodeWire(wire);
    const restored = Utf8Codec.print(decoded.value);
    assert.equal(
      restored,
      s,
      `String round-trip failed for "${s.slice(0, 20)}..."`
    );
  }

  // Fast decoding performance: 50,000 ASCII chars in < 500ms
  const bigAscii = "x".repeat(50000);
  const bigParsed = Utf8Codec.parse(bigAscii);
  const bigWire = SDK.encodeToWire(bigParsed, bigParsed.pattern);
  const tStart = performance.now();
  const bigDecoded = SDK.decodeWire(bigWire);
  const bigRestored = Utf8Codec.print(bigDecoded.value);
  const elapsed = performance.now() - tStart;
  assert.equal(bigRestored.length, 50000);
  assert(
    elapsed < 500,
    `Fast string decoding took ${elapsed}ms (expected < 500ms)`
  );

  // Bounded rendering: valueToK with limit
  let deepVal = SDK.Value.product({});
  for (let i = 0; i < 1000; i++) {
    deepVal = SDK.Value.variant("item", deepVal);
  }
  const preview = valueToK(deepVal, 30);
  assert(preview.endsWith("..."), "Output should end with '...'");
  assert(preview.length <= 35, "Preview length should stay bounded");

  // valueWithEnvelopeToK with limit
  const enveloped = SDK.withPattern(deepVal, [["any", []]]);
  const envPreview = valueWithEnvelopeToK(enveloped, 30);
  assert(envPreview.includes("..."), "Preview should contain '...'");

  // Ensure early termination: evaluating deep chain with limit 20
  let hugeVal = SDK.Value.product({});
  for (let i = 0; i < 50000; i++) {
    hugeVal = SDK.Value.variant("v", hugeVal);
  }
  const tEarly0 = performance.now();
  const earlyPreview = valueToK(hugeVal, 20);
  const tEarlyElapsed = performance.now() - tEarly0;
  assert(earlyPreview.endsWith("..."));
  assert(
    tEarlyElapsed < 50,
    `Early termination took ${tEarlyElapsed}ms (expected < 50ms)`
  );
}

// 9. DJSON Family Singleton Pattern Invariants & Round-Trip
console.log("9. Verifying DJSON family singleton pattern invariants...");
{
  assert(Array.isArray(DjsonCodec.DJSON_PATTERN));
  assert.equal(DjsonCodec.DJSON_PATTERN.length, 29);
  assert(Array.isArray(DjsonBtrieCodec.DJSON_BTRIE_PATTERN));
  assert.equal(DjsonBtrieCodec.DJSON_BTRIE_PATTERN.length, 27);
  assert(Array.isArray(DjsonPtrieCodec.DJSON_PTRIE_PATTERN));
  assert.equal(DjsonPtrieCodec.DJSON_PTRIE_PATTERN.length, 33);

  const samples = [
    null,
    true,
    false,
    123.456,
    "Hello world!",
    [],
    [1, "text", false, null],
    {},
    { key: "value", nested: [1, 2, { deep: true }] }
  ];

  for (const [label, codec, pat, relPath] of [
    ["djson", DjsonCodec, DjsonCodec.DJSON_PATTERN, "codecs/djson.mjs"],
    [
      "djson-btrie",
      DjsonBtrieCodec,
      DjsonBtrieCodec.DJSON_BTRIE_PATTERN,
      "codecs/djson-btrie.mjs"
    ],
    [
      "djson-ptrie",
      DjsonPtrieCodec,
      DjsonPtrieCodec.DJSON_PTRIE_PATTERN,
      "codecs/djson-ptrie.mjs"
    ]
  ]) {
    for (const sample of samples) {
      const jsonStr = JSON.stringify(sample);
      const enveloped = codec.parse(jsonStr);
      assert.strictEqual(
        enveloped.pattern,
        pat,
        `Every ${label} value must share the exact singleton pattern`
      );
      const wire = SDK.encodeToWire(enveloped, enveloped.pattern);
      const decoded = SDK.decodeWire(wire);
      const restored = codec.print(decoded.value);
      assert.deepEqual(
        JSON.parse(restored),
        sample,
        `${label} round-trip mismatch for: ${jsonStr}`
      );
    }
    const cliSample = JSON.stringify({ a: 1, b: [true, "ok"] });
    const parseRes = runCLI(relPath, ["--parse"], cliSample);
    assert.equal(parseRes.status, 0);
    const printRes = runCLI(relPath, ["--print"], parseRes.stdout);
    assert.equal(printRes.status, 0);
    assert.deepEqual(
      JSON.parse(printRes.stdout.toString("utf8")),
      JSON.parse(cliSample)
    );
  }
}

console.log("OK - All codec tests passed.");
