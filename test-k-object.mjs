import assert from "node:assert";
import { parseValue } from "./valueIO.mjs";
import { encodeToEnvelope } from "./codecs/runtime/prefix-codec.mjs";
import { envelopeToK, patternPropertyListToK } from "./codecs/runtime/k-object.mjs";
import { Product, Variant } from "./Value.mjs";

function listToArray(value) {
  const result = [];
  let cursor = value;
  while (cursor instanceof Variant && cursor.tag === "cons") {
    result.push(cursor.value.product.car);
    cursor = cursor.value.product.cdr;
  }
  assert(cursor instanceof Variant);
  assert.equal(cursor.tag, "nil");
  return result;
}

function bitsFromK(value) {
  return listToArray(value).map((bit) => {
    assert(bit instanceof Variant);
    assert(bit.tag === "0" || bit.tag === "1");
    return Number(bit.tag);
  });
}

function binaryTreeLookup(tree, path) {
  let cursor = tree;
  for (const bit of path) {
    assert(cursor instanceof Variant);
    assert.equal(cursor.tag, "tree");
    cursor = cursor.value.product[String(bit)];
  }
  assert(cursor instanceof Variant);
  assert.equal(cursor.tag, "leaf");
  return cursor.value;
}

const value = parseValue("{a:{b:x,c:{}}}");
const envelope = encodeToEnvelope(value, null);
const kEnvelope = envelopeToK(envelope);

assert(kEnvelope instanceof Product);
assert(kEnvelope.product.pattern instanceof Variant);
assert(kEnvelope.product["value-bits"] instanceof Variant);

const rootNode = binaryTreeLookup(kEnvelope.product.pattern, [0, 0]);
assert.equal(rootNode.tag, "open-union");

const firstEdge = binaryTreeLookup(rootNode.value, []);
assert(firstEdge instanceof Product);
assert.deepEqual(bitsFromK(firstEdge.product.target), [0, 1]);

const directPattern = patternPropertyListToK(envelope.pattern);
assert.deepEqual(directPattern.toJSON(), kEnvelope.product.pattern.toJSON());

console.log("OK");
