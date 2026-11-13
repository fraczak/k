import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import k from "../index.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { useSpecsFor } from "./helpers/cli.mjs";
import { fromJsonValue, toJsonValue } from "../codecs/djson.mjs";
import { textToStringValue } from "../codecs/runtime/unicode-string.mjs";
import { decodeValueToNumber } from "../codecs/ieee.mjs";
import { parse as parseInt, parseIntStr, print as printInt } from "../codecs/int.mjs";

function compileChain(files) {
  const libs = [];
  let current = null;
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const uses = useSpecsFor(file);
    current = loadLibrary(
      compileLibrary(source, { source: file, libraries: current ? [current] : [], use: uses })
    );
    libs.push(current);
  }
  return libs;
}

const [, integerLib] = compileChain(["core.k", "lib/integer.k"]);
const [, genericLib, ieeeLib, djsonLib] = compileChain([
  "core.k",
  "lib/generic.k",
  "lib/ieee.k",
  "lib/djson.k"
]);

const runInt = (op, value) =>
  k.compile(integerLib.relAlias[op], { libraries: [integerLib] })(value);
const runGeneric = (op, value) =>
  k.compile(genericLib.relAlias[op], { libraries: [genericLib] })(value);
const runIeee = (op, value) =>
  k.compile(ieeeLib.relAlias[op], { libraries: [ieeeLib] })(value);
const runDjson = (op, value) =>
  k.compile(djsonLib.relAlias[op], { libraries: [djsonLib] })(value);

// Verify lib/generic.k string_to_bits <-> bits_to_string round-trip.
const encodedStrBits = runGeneric("string_to_bits", textToStringValue("k😀"));
assert.equal(
  runDjson("string?", Value.variant("string", runGeneric("bits_to_string", encodedStrBits)))
    .value.type,
  "<>"
);

// Verify lib/integer.k integer operations (Karatsuba is implemented in times).
assert.equal(
  printInt(runInt("plus", Value.product({ x: parseIntStr("19"), y: parseIntStr("23") }))),
  "42"
);
assert.equal(
  printInt(runInt("times", Value.product({ x: parseIntStr("-6"), y: parseIntStr("7") }))),
  "-42"
);
assert.equal(
  printInt(runInt("times", Value.product({ x: parseIntStr("123456"), y: parseIntStr("-654321") }))),
  String(123456n * -654321n)
);

// Verify lib/ieee.k conversion and negation helpers.
for (const n of [0, 1, 2, 10, 42, 1024, 65535]) {
  const bits = parseInt(String(n)).value;
  const f = decodeValueToNumber(
    runIeee(
      "ratio_to_float64",
      Value.product({
        sign: Value.variant("+", Value.product({})),
        num: bits,
        den: parseInt("1").value
      })
    )
  );
  assert.equal(f, n);
  const posFloat = runIeee("bits_to_float64", bits);
  assert.equal(decodeValueToNumber(posFloat), n);
  assert.equal(
    decodeValueToNumber(runIeee("negate_float64", posFloat)),
    n === 0 ? -0 : -n
  );
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
assert.ok(method("has_key?", doc, { key: "name" }));
assert.equal(method("has_key?", doc, { key: "missing" }), undefined);

const withCity = result("set", doc, { key: "city", val: "Paris" });
assert.deepEqual(withCity, { ...doc, city: "Paris" });
const withoutAge = result("del", withCity, { key: "age" });
assert.deepEqual(withoutAge, { name: "Alice", tags: doc.tags, city: "Paris" });

const arr = [10, 20, 30];
for (const [index, expected] of arr.entries()) {
  assert.equal(result("nth", arr, { index }), expected);
}
assert.ok(method("has_nth?", arr, { index: 1 }));
assert.equal(method("has_nth?", arr, { index: 99 }), undefined);
assert.deepEqual(result("set_nth", arr, { index: 1, val: 99 }), [10, 99, 30]);
assert.deepEqual(result("push", arr, { val: 40 }), [10, 20, 30, 40]);
assert.deepEqual(new Set(toJsonValue(runDjson("keys", fromJsonValue(doc)))), new Set(["name", "age", "tags"]));
assert.deepEqual(toJsonValue(runDjson("values", fromJsonValue(arr))), [10, 20, 30]);

const sampleJson = JSON.stringify({
  nullVal: null,
  bools: [true, false],
  nums: [0, -0, 42, -12.5, 1e5],
  str: "hello\n\t\"world\"\\/\u0041\uD83D\uDE00",
  empty: [{}, []]
});
const parsedJson = toJsonValue(runDjson("parse_json", textToStringValue(sampleJson)));
assert.deepEqual(parsedJson, JSON.parse(sampleJson));
