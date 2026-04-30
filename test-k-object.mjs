import assert from "node:assert";
import fs from "node:fs";
import k from "./index.mjs";
import { parseValue } from "./valueIO.mjs";
import { decodeInput, decodeWire, encodeToEnvelope, encodeToWire, CORE_PATTERN_PROPERTY_LIST } from "./codecs/runtime/prefix-codec.mjs";
import { envelopeToK, patternPropertyListToK } from "./codecs/runtime/k-object.mjs";
import { Product, Variant } from "./Value.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

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

const wire = encodeToWire(value, null);
const decodedWire = decodeWire(wire);
assert.deepEqual(decodedWire.pattern, envelope.pattern);
assert.deepEqual(decodedWire.value.toJSON(), value.toJSON());
assert.deepEqual(decodeInput(wire).value.toJSON(), value.toJSON());
assert.deepEqual(decodeInput(Buffer.from(JSON.stringify(envelope))).value.toJSON(), value.toJSON());

const unicodeLabelValue = new Product({
  "é": new Variant("🙂", new Product({})),
  "𐐷": new Product({})
});
const unicodeWire = encodeToWire(unicodeLabelValue, null);
const decodedUnicode = decodeWire(unicodeWire);
assert.deepEqual(decodedUnicode.value.toJSON(), unicodeLabelValue.toJSON());
assert(decodedUnicode.pattern.some(([, edges]) => edges.some(([label]) => label === "é")));
assert(decodedUnicode.pattern.some(([, edges]) => edges.some(([label]) => label === "🙂")));
assert(decodedUnicode.pattern.some(([, edges]) => edges.some(([label]) => label === "𐐷")));

const core = k.annotate(fs.readFileSync("core.k", "utf8"));
const coreMain = core.rels.__main__;
const corePatternId = coreMain.typePatternGraph.find(coreMain.def.patterns[0]);
const corePattern = patternToPropertyList(exportPatternGraph(coreMain.typePatternGraph, corePatternId));
assert.deepEqual(CORE_PATTERN_PROPERTY_LIST, corePattern);

console.log("OK");
