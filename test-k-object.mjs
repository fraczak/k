import assert from "node:assert";
import fs from "node:fs";
import k from "./index.mjs";
import { parseValue } from "./valueIO.mjs";
import { decodeWire, encodeToWire, CORE_PATTERN_PROPERTY_LIST } from "./codecs/runtime/prefix-codec.mjs";
import { Product, Variant } from "./Value.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

const value = parseValue("{a:{b:x,c:{}}}");
const wire = encodeToWire(value, null);
const decodedWire = decodeWire(wire);
assert.deepEqual(decodedWire.pattern, [
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]);
assert.deepEqual(decodedWire.value.toJSON(), value.toJSON());

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
