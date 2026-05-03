import assert from "node:assert";
import fs from "node:fs";
import k from "./index.mjs";
import { parseValue } from "./valueIO.mjs";
import { decodeWire, encodeToWire, CORE_PATTERN_PROPERTY_LIST } from "./codecs/runtime/prefix-codec.mjs";
import { Product, Variant } from "./Value.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { compileObjectBuffer, decodeObject, objectToFunction, decompileObjectBuffer } from "./object.mjs";

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

const INT_PATTERN = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];

const objectBuffer = compileObjectBuffer(`
  $ bits = < {} _, bits 0, bits 1 >;
  $ int = < bits +, bits - >;
  {}|_|0|1|+ $int
`);
const objectFn = objectToFunction(decodeObject(objectBuffer));
const objectResult = objectFn(new Product({}));
assert.deepEqual(objectResult.pattern, INT_PATTERN);
assert.deepEqual(objectResult.toJSON(), { "+": { "1": { "0": "_" } } });

const decompiledSource = decompileObjectBuffer(objectBuffer);
const decompiledResult = k.compile(decompiledSource)(new Product({}));
assert.deepEqual(decompiledResult.pattern, INT_PATTERN);
assert.deepEqual(decompiledResult.toJSON(), objectResult.toJSON());
assert.match(decompiledSource, /^----- codes -----$/m);
assert.match(decompiledSource, /^----- rels -----$/m);
assert.match(decompiledSource, /^----- main -----$/m);
assert.match(decompiledSource, /\$ Nws3 =/);
assert.match(decompiledSource, /^7jfi = /m);
assert.match(decompiledSource, /^----- main -----\n\?\(\.\.\.\) 7jfi \$Nws3$/m);

assert.throws(() => k.compile("@A = (); @A"), /Parse error/);
assert.throws(() => k.compile("$ @A = {}; $@A"), /Parse error/);
assert.deepEqual(k.compile("7jfi = ?X0; 7jfi")(new Product({})).toJSON(), {});

const sccSource = decompileObjectBuffer(compileObjectBuffer("c = {}; b = c |x; a = b |y; a"));
assert.match(sccSource, /----- rels -----\nPQgV = .+\n\naQAD = .+\n\nN9UH = /s);
assert.deepEqual(k.compile(sccSource)(new Product({})).toJSON(), { y: "x" });

console.log("OK");
