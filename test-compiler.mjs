import assert from "node:assert/strict";
import fs from "node:fs";
import { Product, TypedValue, Variant } from "./TypedValue.mjs";
import { compileFrontend } from "./k_compiler/frontend.mjs";
import { compileIR } from "./k_compiler/ir.mjs";
import {
  deserializeTypedValue,
  serializeTypedValue,
  typedValueFromJson,
  typedValueToJson,
} from "./k_compiler/adaptors.mjs";

const script = fs.readFileSync("./Examples/nat.k", "utf8");
const frontend = compileFrontend(script);
const ir = compileIR(frontend);

assert.equal(frontend.format, "k-compiler-frontend-v1");
assert.equal(ir.format, "k-compiler-ir-v1");
assert.ok(ir.functions.add);
assert.equal(ir.functions.add.body.op, "SEQ");

const natType = frontend.representatives.nat;
const zero = new Variant("zero", new Product({}));
const two = new Variant("succ", new Variant("succ", zero));
const typedTwo = new TypedValue(natType, two);

const jsonValue = typedValueToJson(typedTwo);
assert.deepEqual(jsonValue, { succ: { succ: "zero" } });

const restoredFromJson = typedValueFromJson(natType, jsonValue, frontend.registry);
assert.equal(restoredFromJson.toString(), typedTwo.toString());

const serializedJson = serializeTypedValue(typedTwo, frontend.registry, "json");
const deserializedJson = deserializeTypedValue(serializedJson, frontend.registry, "json");
assert.equal(deserializedJson.toString(), typedTwo.toString());

const serializedTyped = serializeTypedValue(typedTwo, frontend.registry, "typed");
const deserializedTyped = deserializeTypedValue(serializedTyped, frontend.registry, "typed");
assert.equal(deserializedTyped.toString(), typedTwo.toString());

const encodedKvbf = serializeTypedValue(typedTwo, frontend.registry, "kvbf");
const decodedKvbf = deserializeTypedValue(encodedKvbf, frontend.registry, "kvbf");
assert.equal(decodedKvbf.toString(), typedTwo.toString());

console.log("compiler pipeline ok");
