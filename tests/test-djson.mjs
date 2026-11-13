import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import k from "../index.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { createState, evaluateInput } from "../repl.mjs";
import { Value } from "../Value.mjs";
import { compileWasmArtifact, instantiateWasmArtifact } from "../backends/wasm/src/wasm.mjs";
import { fromJsonValue, toJsonValue } from "../codecs/djson.mjs";
import { parse as parseIntVal } from "../codecs/int.mjs";
import { stringValueToText, textToStringValue } from "../codecs/string-codec.mjs";
import { withCompiledLibrary, useSpecsFor } from "./helpers/cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// 1. Dependency chain & convergence along core.k -> generic.k -> ieee.k -> djson.k
const coreSource = readSrc("core.k");
const genericSource = readSrc("lib/generic.k");
const ieeeSource = readSrc("lib/ieee.k");
const djsonSource = readSrc("lib/djson.k");

const coreLib = loadLibrary(compileLibrary(coreSource, { source: "core.k" }));
const genericLib = loadLibrary(compileLibrary(genericSource, {
  source: "lib/generic.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/generic.k")
}));
const ieeeLib = loadLibrary(compileLibrary(ieeeSource, {
  source: "lib/ieee.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/ieee.k")
}));
const djsonLib = loadLibrary(compileLibrary(djsonSource, {
  source: "lib/djson.k",
  libraries: [coreLib, genericLib, ieeeLib],
  use: useSpecsFor("lib/djson.k")
}));

for (const [hash, rel] of Object.entries(djsonLib.rels)) {
  assert.equal(
    rel.typeDerivation?.status,
    "converged",
    `lib/djson.k relation ${hash} did not converge: ${JSON.stringify(rel.typeDerivation)}`
  );
}

const runRel = (name, input) => {
  const alias = djsonLib.relAlias[name];
  assert.ok(alias, `missing exported relation '${name}' in lib/djson.k`);
  return k.compile(alias, { libraries: [djsonLib] })(input);
};

// 2. REPL sequential :load contract
{
  const state = createState();
  for (const f of ["core.k", "lib/generic.k", "lib/ieee.k", "lib/djson.k"]) {
    const out = await evaluateInput(`:load ${f}`, state);
    assert.equal(out[0], `loaded ${f}`);
  }
  await evaluateInput(":codec codecs/utf8.mjs", state);
  await evaluateInput(":codec codecs/djson.mjs", state);
  await evaluateInput(':input utf8.mjs {"é":42,"😀":[true,null]}', state);
  const res = await evaluateInput("parse_json", state);
  assert.ok(!String(res[0]).startsWith("Error:"), `REPL parse_json failed: ${res}`);
  assert.deepEqual(toJsonValue(state.value), { "é": 42, "😀": [true, null] });
}

// 3. Variant filters
for (const [filterName, jsonVal] of [
  ["null?", null],
  ["bool?", false],
  ["number?", 3.5],
  ["string?", "hi"],
  ["list?", [1, 2]],
  ["object?", { a: 1 }]
]) {
  assert.ok(runRel("json?", fromJsonValue(jsonVal)), `json? failed for ${JSON.stringify(jsonVal)}`);
  assert.ok(runRel(filterName, fromJsonValue(jsonVal)), `${filterName} failed for ${JSON.stringify(jsonVal)}`);
}
assert.equal(runRel("null?", fromJsonValue(0)), undefined);
assert.equal(runRel("object?", fromJsonValue([])), undefined);

// 4. Container methods: Unicode object keys, array order >=5, push after del_nth
{
  const objDoc = {
    "": 0,
    "a": 1,
    "é": 2,
    "語": 3,
    "\uE123": 4,
    "😀": 5,
    "\u{21234}": 6
  };
  let objVal = fromJsonValue(objDoc);
  for (const [key, expected] of Object.entries(objDoc)) {
    const got = runRel("get", Value.product({ key: textToStringValue(key), json: objVal }));
    assert.equal(toJsonValue(got), expected, `get failed for key ${JSON.stringify(key)}`);
  }
  assert.equal(
    runRel("get", Value.product({ key: textToStringValue("missing"), json: objVal })),
    undefined
  );

  // `keys`, `keys_raw`, `values` work across all Unicode planes
  const ks = toJsonValue(runRel("keys", objVal));
  const vs = toJsonValue(runRel("values", objVal));
  assert.equal(ks.length, Object.keys(objDoc).length);
  assert.deepEqual(new Set(ks), new Set(Object.keys(objDoc)));
  const byKey = Object.fromEntries(ks.map((kStr, i) => [kStr, vs[i]]));
  assert.deepEqual(byKey, objDoc);

  const rawKeys = [];
  let cursor = runRel("keys_raw", objVal);
  while (cursor.tag === "cons") {
    rawKeys.push(stringValueToText(cursor.value.product.car));
    cursor = cursor.value.product.cdr;
  }
  assert.equal(cursor.tag, "nil");
  assert.deepEqual(rawKeys, ks);

  objVal = runRel("set", Value.product({
    key: textToStringValue("🔑"),
    val: fromJsonValue("ok"),
    json: objVal
  }));
  assert.equal(
    toJsonValue(runRel("get", Value.product({ key: textToStringValue("🔑"), json: objVal }))),
    "ok"
  );
  objVal = runRel("del", Value.product({ key: textToStringValue("😀"), json: objVal }));
  assert.equal(
    runRel("get", Value.product({ key: textToStringValue("😀"), json: objVal })),
    undefined
  );

  // Array `values` respects numerical index order even >= 5 elements
  const arr5 = fromJsonValue([10, 20, 30, 40, 50]);
  assert.deepEqual(toJsonValue(runRel("values", arr5)), [10, 20, 30, 40, 50]);

  // `del_nth` followed by `push` appends at max_index + 1 instead of overwriting index 4 (`50`)
  const sparse = runRel("del_nth", Value.product({
    index: parseIntVal("1").value,
    json: arr5
  }));
  assert.equal(
    runRel("nth", Value.product({ index: parseIntVal("1").value, json: sparse })),
    undefined
  );
  const pushed = runRel("push", Value.product({
    val: fromJsonValue(99),
    json: sparse
  }));
  assert.deepEqual(toJsonValue(pushed), [10, 30, 40, 50, 99]);
  assert.deepEqual(
    toJsonValue(runRel("push", Value.product({ val: fromJsonValue(7), json: fromJsonValue([]) }))),
    [7]
  );

  const updated = runRel("set_nth", Value.product({
    index: parseIntVal("2").value,
    val: fromJsonValue(300),
    json: arr5
  }));
  assert.deepEqual(toJsonValue(updated), [10, 20, 300, 40, 50]);
}

// 5. RFC 8259 JSON parser (`parse_json`) across Wasm, JS, and CLI
const wasmParse = await instantiateWasmArtifact(
  await compileWasmArtifact(djsonLib.relAlias.parse_json, { libraries: [djsonLib] })
);

const validJsonSamples = [
  "null",
  " \t\n\r true \n",
  "false",
  "0",
  "-0",
  "42",
  "-42",
  "0.1",
  "1e22",
  "1e23",
  "9007199254740992",
  "9007199254740993",
  "9007199254740995",
  "5e-324",
  "1.7976931348623157e+308",
  "1e-400",
  "-1e-400",
  "0.000000000000000000001e20",
  '""',
  '"hello\\n\\t\\"\\\\\\/\\b\\f\\r"',
  '"\\u00e9\\u8a9e\\ue123"',
  '"\\uD83D\\uDE00\\uD844\\uDE34"',
  '{"":0,"a":1,"é":2,"😀":3,"\u{21234}":4,"nested":[true,false,null,{}]}'
];

for (const sample of validJsonSamples) {
  const input = textToStringValue(sample);
  const actual = toJsonValue(wasmParse.executeValue(input));
  const expected = JSON.parse(sample);
  assert.deepEqual(actual, expected, `parse_json mismatch on ${sample}`);
  if (sample === "-0" || sample === "-1e-400") {
    assert.ok(Object.is(actual, -0), `expected negative zero for ${sample}`);
  } else if (sample === "0" || sample === "1e-400") {
    assert.ok(Object.is(actual, 0), `expected positive zero for ${sample}`);
  }
}

// JS execution parity on representative subset
for (const sample of ["null", "true", "-0", "0.1", "9007199254740993", '{"😀":"ok"}']) {
  assert.deepEqual(
    toJsonValue(runRel("parse_json", textToStringValue(sample))),
    JSON.parse(sample)
  );
}

const invalidJsonSamples = [
  "",
  "   ",
  "undefined",
  "NaN",
  "Infinity",
  "-Infinity",
  "1e309",
  "-1e309",
  "1e1000",
  "+1",
  ".5",
  "1.",
  "01",
  "-01",
  "1e",
  "1e+",
  "[1,]",
  '{"a":1,}',
  '"\\x"',
  '"\\uD800"',
  '"\\uDC00"',
  '"\\uD800abc"',
  '"line\nbreak"',
  "1 2",
  "{}[]"
];

for (const bad of invalidJsonSamples) {
  assert.equal(runRel("parse_json", textToStringValue(bad)), undefined, `expected failure for ${bad}`);
}

withCompiledLibrary(["core.k", "lib/generic.k", "lib/ieee.k", "lib/djson.k"], (library) => {
  const utf8Cli = spawnSync(process.execPath, ["codecs/utf8.mjs", "--parse"], {
    cwd: root,
    input: '{"é":[1,"😀"]}\n'
  });
  assert.equal(utf8Cli.status, 0, utf8Cli.stderr?.toString());
  const kCli = spawnSync(
    process.execPath,
    ["k.mjs", "--lib", library, "--use", "parse_json", "parse_json"],
    { cwd: root, input: utf8Cli.stdout, maxBuffer: 8 * 1024 * 1024 }
  );
  assert.equal(kCli.status, 0, kCli.stderr?.toString());
  const djsonCli = spawnSync(process.execPath, ["codecs/djson.mjs", "--print"], {
    cwd: root,
    input: kCli.stdout
  });
  assert.equal(djsonCli.status, 0, djsonCli.stderr?.toString());
  assert.deepEqual(JSON.parse(djsonCli.stdout.toString("utf8")), { "é": [1, "😀"] });
});

console.log("lib/djson.k specification tests passed");
