import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import k from "../index.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { fromJsonValue, toJsonValue } from "../codecs/djson.mjs";
import { textToStringValue, stringValueToText } from "../codecs/runtime/unicode-string.mjs";
import { parse as parseInt } from "../codecs/int.mjs";

const source = readFileSync(new URL("../Examples/djson.k", import.meta.url), "utf8");
const core = loadLibrary(compileLibrary(readFileSync(new URL("../core.k", import.meta.url), "utf8")));
const ieee = loadLibrary(compileLibrary(readFileSync(new URL("../Examples/ieee.k", import.meta.url), "utf8"), {
  libraries: [core]
}));
// Resolve dependencies by hash even when the provider's friendly aliases are absent.
const canonicalTypes = {
  ...ieee,
  patternAlias: {},
  patterns: Object.fromEntries(Object.entries(ieee.patterns).filter(([name]) => name.startsWith("@")))
};
const library = loadLibrary(compileLibrary(source, { libraries: [canonicalTypes] }));
const run = (op, value) => k.compile(library.relAlias[op], { libraries: [library] })(value);

function method(op, json, { key, index, val } = {}) {
  const fields = { json: fromJsonValue(json) };
  if (key !== undefined) fields.key = textToStringValue(key);
  if (index !== undefined) fields.index = parseInt(String(index)).value;
  if (val !== undefined) fields.val = fromJsonValue(val);
  return run(op, Value.product(fields));
}
const result = (...args) => toJsonValue(method(...args));

// Object access, missing keys, updates and preservation.
const doc = { name: "Alice", age: 30, tags: ["developer", "k"] };
for (const key of ["name", "age"]) {
  assert.equal(result("get", doc, { key }), doc[key], key);
}
assert.ok(method("has?", doc, { key: "name" }));
assert.equal(method("has?", doc, { key: "missing" }), undefined);
const withCity = result("set", doc, { key: "city", val: "Paris" });
assert.deepEqual(withCity, { ...doc, city: "Paris" });
const withoutAge = result("del", withCity, { key: "age" });
assert.deepEqual(withoutAge, { name: "Alice", tags: doc.tags, city: "Paris" });

// Array lookup and sparse index membership after deletion.
const list = [10, 20, 30];
for (const [index, expected] of list.entries()) {
  assert.equal(result("nth", list, { index }), expected, `index ${index}`);
}
assert.ok(method("has_index?", list, { index: 1 }));
assert.equal(method("has_index?", list, { index: 99 }), undefined);
const updated = method("set_nth", list, { index: 1, val: 99 });
assert.deepEqual(toJsonValue(updated), [10, 99, 30]);
const deleted = run("del_nth", Value.product({
  json: updated, index: parseInt("1").value
}));
assert.deepEqual(toJsonValue(deleted), [10, 30]);
assert.equal(run("has_index?", Value.product({
  json: deleted, index: parseInt("1").value
})), undefined);
assert.deepEqual(result("push", list, { val: 40 }), [10, 20, 30, 40]);

// Ordered keys/values, including the raw cons-list boundary.
const record = fromJsonValue({ b: 2, a: 1, c: 3 });
assert.deepEqual(toJsonValue(run("keys", record)), ["a", "b", "c"]);
const keys = [];
let cursor = run("keys_raw", record);
while (cursor.tag === "cons") {
  keys.push(stringValueToText(cursor.value.product.car));
  cursor = cursor.value.product.cdr;
}
assert.equal(cursor.tag, "nil");
assert.deepEqual(keys, ["a", "b", "c"]);
assert.deepEqual(toJsonValue(run("values", record)), [1, 2, 3]);
assert.deepEqual(toJsonValue(run("values", fromJsonValue([100, 200]))), [100, 200]);

for (const [value, expected] of [
  [{ x: 1, y: 2, z: 3, w: 4 }, 4], [["a", "b", "c"], 3], ["hello", 5]
]) assert.equal(toJsonValue(run("length", fromJsonValue(value))), expected);

for (const [type, value] of [
  ["object", { a: 1 }], ["list", [1, 2]], ["string", "hi"],
  ["number", 3.14], ["bool", true], ["null", null]
]) {
  const input = fromJsonValue(value);
  assert.equal(run("type_of", input).tag, type);
  assert.ok(run(`is_${type}?`, input), type);
}
assert.equal(run("is_object?", fromJsonValue([1, 2])), undefined);
assert.equal(run("is_list?", fromJsonValue({ a: 1 })), undefined);
console.log("dynamic JSON methods: ok");
