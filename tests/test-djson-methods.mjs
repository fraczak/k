// tests/test-djson-methods.mjs
// Test suite for standard dynamic JSON methods working on json? type.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import k from "../index.mjs";
import { Value } from "../Value.mjs";
import {
  fromJsonValue,
  toJsonValue
} from "../codecs/djson-btrie.mjs";
import {
  textToStringValue,
  stringValueToText
} from "../codecs/runtime/unicode-string.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const libPath = path.join(root, "Examples", "djson-btrie.k");
const djsonK = readFileSync(libPath, "utf8");

function compileOp(op) {
  return k.compile(`${djsonK}\n${op}\n`);
}

function makeIndex(n) {
  if (n === 0) {
    return Value.variant(
      "0",
      Value.variant("_", Value.product({}))
    );
  }
  const s = n.toString(2);
  let v = Value.variant("_", Value.product({}));
  for (let i = s.length - 1; i >= 0; i--) {
    v = Value.variant(s[i], v);
  }
  return v;
}

console.log("==> Running Dynamic JSON (json?) Methods Test Suite");

// Test 1: Object Accessors (get, has?, set, del)
console.log("--> Test 1: Object Accessors (get, has?, set, del)");
{
  const fnGet = compileOp("get");
  const fnHas = compileOp("has?");
  const fnSet = compileOp("set");
  const fnDel = compileOp("del");

  const doc = {
    name: "Alice",
    age: 30,
    tags: ["developer", "k"]
  };
  const kDoc = fromJsonValue(doc);

  // get "name"
  const resName = fnGet(Value.product({
    key: textToStringValue("name"),
    json: kDoc
  }));
  assert.equal(toJsonValue(resName), "Alice");

  // get "age"
  const resAge = fnGet(Value.product({
    key: textToStringValue("age"),
    json: kDoc
  }));
  assert.equal(toJsonValue(resAge), 30);

  // has? hit
  const hit = fnHas(Value.product({
    key: textToStringValue("name"),
    json: kDoc
  }));
  assert.ok(hit);

  // has? miss
  const miss = fnHas(Value.product({
    key: textToStringValue("missing"),
    json: kDoc
  }));
  assert.equal(miss, undefined);

  // set "city" = "Paris"
  const withCity = fnSet(Value.product({
    key: textToStringValue("city"),
    val: fromJsonValue("Paris"),
    json: kDoc
  }));
  assert.equal(toJsonValue(withCity).city, "Paris");
  assert.equal(toJsonValue(withCity).name, "Alice");

  // del "age"
  const withoutAge = fnDel(Value.product({
    key: textToStringValue("age"),
    json: withCity
  }));
  assert.equal(toJsonValue(withoutAge).age, undefined);
  assert.equal(toJsonValue(withoutAge).city, "Paris");

  console.log("    Passed: Object get, has?, set, del on json?.");
}

// Test 2: List Accessors (nth, has_index?, set_nth, del_nth, push)
console.log("--> Test 2: List Accessors (nth, set_nth, del_nth, push)");
{
  const fnNth = compileOp("nth");
  const fnHasIdx = compileOp("has_index?");
  const fnSetNth = compileOp("set_nth");
  const fnDelNth = compileOp("del_nth");
  const fnPush = compileOp("push");

  const list = [10, 20, 30];
  const kList = fromJsonValue(list);

  // nth 0, 1, 2
  assert.equal(
    toJsonValue(fnNth(Value.product({
      index: makeIndex(0),
      json: kList
    }))),
    10
  );
  assert.equal(
    toJsonValue(fnNth(Value.product({
      index: makeIndex(1),
      json: kList
    }))),
    20
  );
  assert.equal(
    toJsonValue(fnNth(Value.product({
      index: makeIndex(2),
      json: kList
    }))),
    30
  );

  // has_index? hit and miss
  assert.ok(fnHasIdx(Value.product({
    index: makeIndex(1),
    json: kList
  })));
  assert.equal(
    fnHasIdx(Value.product({
      index: makeIndex(99),
      json: kList
    })),
    undefined
  );

  // set_nth 1 -> 99
  const updatedList = fnSetNth(Value.product({
    index: makeIndex(1),
    val: fromJsonValue(99),
    json: kList
  }));
  assert.deepEqual(toJsonValue(updatedList), [10, 99, 30]);

  // del_nth 1
  const delList = fnDelNth(Value.product({
    index: makeIndex(1),
    json: updatedList
  }));
  assert.deepEqual(toJsonValue(delList), [10, 30]);
  assert.equal(
    fnHasIdx(Value.product({
      index: makeIndex(1),
      json: delList
    })),
    undefined
  );

  // push 40
  const pushed = fnPush(Value.product({
    val: fromJsonValue(40),
    json: kList
  }));
  assert.deepEqual(toJsonValue(pushed), [10, 20, 30, 40]);

  console.log("    Passed: List nth, set_nth, del_nth, push on json?.");
}

// Test 3: Keys and Values (keys, keys_raw, values, values_raw)
console.log("--> Test 3: Keys and Values (keys, values)");
{
  const fnKeys = compileOp("keys");
  const fnKeysRaw = compileOp("keys_raw");
  const fnValues = compileOp("values");
  const fnValuesRaw = compileOp("values_raw");

  const doc = { b: 2, a: 1, c: 3 };
  const kDoc = fromJsonValue(doc);

  // keys (json? list of string)
  const resKeys = fnKeys(kDoc);
  assert.deepEqual(toJsonValue(resKeys), ["a", "b", "c"]);

  // keys_raw (raw K cons-list of strings)
  const resKeysRaw = fnKeysRaw(kDoc);
  const rawKeyStrings = [];
  let curr = resKeysRaw;
  while (curr && curr.type === "<>" && curr.tag === "cons") {
    rawKeyStrings.push(stringValueToText(curr.value.product.car));
    curr = curr.value.product.cdr;
  }
  assert.deepEqual(rawKeyStrings, ["a", "b", "c"]);

  // values on object (json? list of values)
  const resValues = fnValues(kDoc);
  assert.deepEqual(toJsonValue(resValues), [1, 2, 3]);

  // values on list (json? identity)
  const listJson = fromJsonValue([100, 200]);
  assert.deepEqual(toJsonValue(fnValues(listJson)), [100, 200]);

  console.log("    Passed: Keys and values extraction on json?.");
}

// Test 4: Cardinality and Length (length, length_nat)
console.log("--> Test 4: Cardinality and Length (length, length_nat)");
{
  const fnLength = compileOp("length");

  const kObj = fromJsonValue({ x: 1, y: 2, z: 3, w: 4 });
  const kArr = fromJsonValue(["a", "b", "c"]);
  const kStr = fromJsonValue("hello");

  // length returns json? number (float64)
  assert.equal(toJsonValue(fnLength(kObj)), 4);
  assert.equal(toJsonValue(fnLength(kArr)), 3);
  assert.equal(toJsonValue(fnLength(kStr)), 5);

  console.log(
    "    Passed: Length queries on json? object, list, string."
  );
}

// Test 5: Type Predicates and type_of
console.log("--> Test 5: Type Predicates and type_of");
{
  const fnTypeOf = compileOp("type_of");
  const fnIsObj = compileOp("is_object?");
  const fnIsList = compileOp("is_list?");
  const fnIsStr = compileOp("is_string?");
  const fnIsNum = compileOp("is_number?");
  const fnIsBool = compileOp("is_bool?");
  const fnIsNull = compileOp("is_null?");

  const kObj = fromJsonValue({ a: 1 });
  const kArr = fromJsonValue([1, 2]);
  const kStr = fromJsonValue("hi");
  const kNum = fromJsonValue(3.14);
  const kBool = fromJsonValue(true);
  const kNull = fromJsonValue(null);

  assert.equal(fnTypeOf(kObj).tag, "object");
  assert.equal(fnTypeOf(kArr).tag, "list");
  assert.equal(fnTypeOf(kStr).tag, "string");
  assert.equal(fnTypeOf(kNum).tag, "number");
  assert.equal(fnTypeOf(kBool).tag, "bool");
  assert.equal(fnTypeOf(kNull).tag, "null");

  assert.ok(fnIsObj(kObj));
  assert.equal(fnIsObj(kArr), undefined);

  assert.ok(fnIsList(kArr));
  assert.equal(fnIsList(kObj), undefined);

  assert.ok(fnIsStr(kStr));
  assert.ok(fnIsNum(kNum));
  assert.ok(fnIsBool(kBool));
  assert.ok(fnIsNull(kNull));

  console.log("    Passed: Type predicates and type_of inspection.");
}

console.log("==> All Dynamic JSON Methods Tests Passed Successfully!");
