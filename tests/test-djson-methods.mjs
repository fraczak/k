import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import k from "../index.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { useSpecsFor } from "./helpers/cli.mjs";
import { fromJsonValue, toJsonValue } from "../codecs/djson.mjs";
import { textToStringValue, stringValueToText } from "../codecs/runtime/unicode-string.mjs";
import { parse as parseInt } from "../codecs/int.mjs";

const source = readFileSync(new URL("../lib/djson.k", import.meta.url), "utf8");
let prev = null;
for (const file of [
  "core.k",
  "lib/generic.k",
  "lib/ieee.k"
]) {
  const fileSource = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const uses = useSpecsFor(file);
  prev = loadLibrary(compileLibrary(fileSource, {
    source: file,
    libraries: prev ? [prev] : [],
    use: uses
  }));
}
const library = loadLibrary(compileLibrary(source, { source: "lib/djson.k", libraries: [prev], use: useSpecsFor("lib/djson.k") }));
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
assert.ok(method("has_key?", doc, { key: "name" }));
assert.equal(method("has_key?", doc, { key: "missing" }), undefined);
const withCity = result("set", doc, { key: "city", val: "Paris" });
assert.deepEqual(withCity, { ...doc, city: "Paris" });
const withoutAge = result("del", withCity, { key: "age" });
assert.deepEqual(withoutAge, { name: "Alice", tags: doc.tags, city: "Paris" });

// Array lookup and sparse index membership after deletion.
const list = [10, 20, 30];
for (const [index, expected] of list.entries()) {
  assert.equal(result("nth", list, { index }), expected, `index ${index}`);
}
assert.ok(method("has_nth?", list, { index: 1 }));
assert.equal(method("has_nth?", list, { index: 99 }), undefined);
const updated = method("set_nth", list, { index: 1, val: 99 });
assert.deepEqual(toJsonValue(updated), [10, 99, 30]);
const deleted = run("del_nth", Value.product({
  json: updated, index: parseInt("1").value
}));
assert.deepEqual(toJsonValue(deleted), [10, 30]);
assert.equal(run("has_nth?", Value.product({
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

for (const [type, value] of [
  ["object", { a: 1 }], ["list", [1, 2]], ["string", "hi"],
  ["number", 3.14], ["bool", true], ["null", null]
]) {
  const input = fromJsonValue(value);
  assert.ok(run(`${type}?`, input), type);
  assert.ok(run("json?", input), `json? ${type}`);
}
assert.equal(run("object?", fromJsonValue([1, 2])), undefined);
assert.equal(run("list?", fromJsonValue({ a: 1 })), undefined);
console.log("dynamic JSON methods: ok");
