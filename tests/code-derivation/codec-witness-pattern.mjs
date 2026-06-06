import assert from 'assert';
import { parseValue } from '../../valueIO.mjs';
import { encodeToWire, decodeWire } from '../../codecs/runtime/prefix-codec.mjs';
import { isProduct, isVariant } from '../../Value.mjs';

const value = parseValue('{a:{b:x,c:{}}}');
const repeatedClosedValue = parseValue('{a:{m:{},n:{}},b:{m:{},n:{}}}');
const repeatedOpenValue = parseValue('{a:x,b:x}');

const defaultWire = decodeWire(encodeToWire(value, null));
assert.deepEqual(defaultWire.pattern, [
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]);

const explicitProductWire = decodeWire(encodeToWire(value, [
  ["open-product", [["a", 1]]],
  ["any", []]
]));
assert.deepEqual(explicitProductWire.pattern, [
  ["closed-product", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]);

const decoded = explicitProductWire.value;
assert(isProduct(decoded));
assert(isProduct(decoded.product.a));
assert(isVariant(decoded.product.a.product.b));
assert.equal(decoded.product.a.product.b.tag, "x");

const repeatedClosedWire = decodeWire(encodeToWire(repeatedClosedValue, null));
assert.deepEqual(repeatedClosedWire.pattern, [
  ["closed-product", [["a", 1], ["b", 1]]],
  ["closed-product", [["m", 2], ["n", 2]]],
  ["closed-product", []]
]);

const repeatedOpenWire = decodeWire(encodeToWire(repeatedOpenValue, null));
assert.deepEqual(repeatedOpenWire.pattern, [
  ["closed-product", [["a", 1], ["b", 3]]],
  ["open-union", [["x", 2]]],
  ["closed-product", []],
  ["open-union", [["x", 2]]]
]);

console.log("OK");
