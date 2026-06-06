import assert from "node:assert/strict";
import { Value } from "../Value.mjs";
import { decodeWire, encodeToWire } from "../codecs/runtime/prefix-codec.mjs";

const depth = 12000;
const pattern = [
  ["closed-union", [["+", 1]]],
  ["closed-union", [["_", 2], ["1", 1]]],
  ["closed-product", []]
];

let bits = Value.variant("_", Value.product({}));
for (let i = 0; i < depth; i++) {
  bits = Value.variant("1", bits);
}

const wire = encodeToWire(Value.variant("+", bits), pattern);
const decoded = decodeWire(wire).value;
assert.equal(decoded.tag, "+");

bits = decoded.value;
for (let i = 0; i < depth; i++) {
  assert.equal(bits.tag, "1");
  bits = bits.value;
}
assert.equal(bits.tag, "_");
assert.deepEqual(bits.value.product, {});

console.log("deep wire value: ok");
