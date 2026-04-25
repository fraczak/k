import assert from 'assert';
import { parseValue } from '../valueIO.mjs';
import { encodeToEnvelope, decodeEnvelope } from '../codecs/runtime/prefix-codec.mjs';
import { Product, Variant } from '../Value.mjs';

const value = parseValue('{a:{b:x,c:{}}}');
const repeatedClosedValue = parseValue('{a:{m:{},n:{}},b:{m:{},n:{}}}');
const repeatedOpenValue = parseValue('{a:x,b:x}');

const defaultEnvelope = encodeToEnvelope(value, null);
assert.deepEqual(defaultEnvelope.pattern, [
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]);

const explicitProductEnvelope = encodeToEnvelope(value, [
  ["open-product", [["a", 1]]],
  ["any", []]
]);
assert.deepEqual(explicitProductEnvelope.pattern, [
  ["open-product", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]);

const decoded = decodeEnvelope(explicitProductEnvelope).value;
assert(decoded instanceof Product);
assert(decoded.product.a instanceof Product);
assert(decoded.product.a.product.b instanceof Variant);
assert.equal(decoded.product.a.product.b.tag, "x");

const repeatedClosedEnvelope = encodeToEnvelope(repeatedClosedValue, null);
assert.deepEqual(repeatedClosedEnvelope.pattern, [
  ["closed-product", [["a", 1], ["b", 1]]],
  ["closed-product", [["m", 2], ["n", 2]]],
  ["closed-product", []]
]);

const repeatedOpenEnvelope = encodeToEnvelope(repeatedOpenValue, null);
assert.deepEqual(repeatedOpenEnvelope.pattern, [
  ["closed-product", [["a", 1], ["b", 3]]],
  ["open-union", [["x", 2]]],
  ["closed-product", []],
  ["open-union", [["x", 2]]]
]);

console.log("OK");
