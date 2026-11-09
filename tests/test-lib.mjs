import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import k from "../index.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { fromJsonValue, toJsonValue } from "../codecs/djson.mjs";
import { textToStringValue, stringValueToText } from "../codecs/runtime/unicode-string.mjs";
import { encodeNumberToValue, decodeValueToNumber } from "../codecs/ieee.mjs";
import { parse as parseInt, parseIntStr, print as printInt } from "../codecs/int.mjs";

const libFiles = [
  "lib/bit.k",
  "lib/bits.k",
  "lib/list.k",
  "lib/btrie.k",
  "lib/string.k",
  "lib/ieee.k",
  "lib/djson.k",
  "lib/arithmetics.k"
];

const libs = [];
for (const file of libFiles) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const compiled = loadLibrary(
    compileLibrary(source, { source: file, libraries: libs })
  );
  libs.push(compiled);
}

const ieeeLib = libs[5];
const djsonLib = libs[6];
const arithLib = libs[7];

const runArith = (op, value) =>
  k.compile(arithLib.relAlias[op], { libraries: [arithLib] })(value);
const runIeee = (op, value) =>
  k.compile(ieeeLib.relAlias[op], { libraries: [ieeeLib] })(value);
const runDjson = (op, value) =>
  k.compile(djsonLib.relAlias[op], { libraries: [djsonLib] })(value);

// Verify lib/arithmetics.k integer operations.
assert.equal(
  printInt(runArith("plus", Value.product({ x: parseIntStr("19"), y: parseIntStr("23") }))),
  "42"
);
assert.equal(
  printInt(runArith("times", Value.product({ x: parseIntStr("-6"), y: parseIntStr("7") }))),
  "-42"
);
assert.equal(
  printInt(runArith("karatsuba", Value.product({ x: parseIntStr("123456"), y: parseIntStr("-654321") }))),
  String(123456n * -654321n)
);

// Verify lib/ieee.k text parsing, natural conversion, and exact decimal printing.
for (const num of [0, -0, 1, -1, 3.141592653589793, 1e-10, 1e20, Infinity, -Infinity, NaN]) {
  const val = encodeNumberToValue(num);
  const text = stringValueToText(runIeee("printFloat64", val));
  const parsed = decodeValueToNumber(runIeee("parseFloat64", textToStringValue(text)));
  if (Number.isNaN(num)) {
    assert.ok(Number.isNaN(parsed));
  } else {
    assert.ok(Object.is(parsed, num), `round-trip ${num} via ${text}`);
  }
}

for (const n of [0, 1, 2, 10, 42, 1024, 65535]) {
  const f = decodeValueToNumber(runIeee("natToFloat64", parseInt(String(n)).value));
  assert.equal(f, n);
}

// Verify lib/djson.k methods and RFC 8259 JSON parser.
function method(op, json, { key, index, val } = {}) {
  const fields = { json: fromJsonValue(json) };
  if (key !== undefined) fields.key = textToStringValue(key);
  if (index !== undefined) fields.index = parseInt(String(index)).value;
  if (val !== undefined) fields.val = fromJsonValue(val);
  return runDjson(op, Value.product(fields));
}
const result = (...args) => toJsonValue(method(...args));

const doc = { name: "Alice", age: 30, tags: ["developer", "k"] };
assert.equal(result("get", doc, { key: "name" }), "Alice");
assert.equal(result("get", doc, { key: "age" }), 30);
assert.ok(method("has?", doc, { key: "name" }));
assert.equal(method("has?", doc, { key: "missing" }), undefined);

const withCity = result("set", doc, { key: "city", val: "Paris" });
assert.deepEqual(withCity, { ...doc, city: "Paris" });
const withoutAge = result("del", withCity, { key: "age" });
assert.deepEqual(withoutAge, { name: "Alice", tags: doc.tags, city: "Paris" });

const arr = [10, 20, 30];
for (const [index, expected] of arr.entries()) {
  assert.equal(result("nth", arr, { index }), expected);
}
assert.ok(method("has_index?", arr, { index: 1 }));
assert.equal(method("has_index?", arr, { index: 99 }), undefined);
assert.deepEqual(result("set_nth", arr, { index: 1, val: 99 }), [10, 99, 30]);
assert.equal(toJsonValue(runDjson("length", fromJsonValue(arr))), 3);
assert.equal(toJsonValue(runDjson("length", fromJsonValue(doc))), 3);
assert.equal(toJsonValue(runDjson("length", fromJsonValue("hello"))), 5);
assert.deepEqual(result("push", arr, { val: 40 }), [10, 20, 30, 40]);
assert.deepEqual(new Set(toJsonValue(runDjson("keys", fromJsonValue(doc)))), new Set(["name", "age", "tags"]));

const sampleJson = JSON.stringify({
  nullVal: null,
  bools: [true, false],
  nums: [0, -0, 42, -12.5, 1e5],
  str: "hello\n\t\"world\"\\/\u0041\uD83D\uDE00",
  empty: [{}, []]
});
const parsedJson = toJsonValue(runDjson("parseJson", textToStringValue(sampleJson)));
assert.deepEqual(parsedJson, JSON.parse(sampleJson));
