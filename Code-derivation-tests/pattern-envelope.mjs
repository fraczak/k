import assert from "node:assert/strict";
import k from "../index.mjs";
import { Product, Variant, mergePatterns } from "../Value.mjs";
import { decodeWire, encodeToWire } from "../codecs/runtime/prefix-codec.mjs";
import run from "../run.mjs";
import codes from "../codes.mjs";

const INT_PATTERN = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];

const script = `
  $ bits = < {} _, bits 0, bits 1 >;
  $ int = < bits +, bits - >;
  {}|_|0|1|+ $int
`;

const result = k.compile(script)(new Product({}));
assert.deepEqual(result.pattern, INT_PATTERN);

const decoded = decodeWire(encodeToWire(result, result.pattern));
assert.deepEqual(decoded.pattern, INT_PATTERN);

const two = new Variant("+",
  new Variant("1",
    new Variant("0",
      new Variant("_", new Product({}))
    )
  )
);
const witnessPattern = [
  ["closed-union", [["+", 1]]],
  ["closed-union", [["1", 2]]],
  ["closed-union", [["0", 3]]],
  ["closed-union", [["_", 4]]],
  ["closed-product", []]
];
const overExpandedSingleton = mergePatterns(INT_PATTERN, witnessPattern);
const decodedMerged = decodeWire(encodeToWire(two, overExpandedSingleton));
assert.deepEqual(decodedMerged.pattern, INT_PATTERN);

const projectionScript = `
  $ bits = < {} _, bits 0, bits 1 >;
  $ int = < bits +, bits - >;
  $int /+
`;
const annotated = k.annotate(projectionScript);
run.defs = annotated;
const projected = run(
  codes.find,
  annotated.rels.__main__.def,
  two,
  annotated.rels.__main__.typePatternGraph
);
assert.deepEqual(projected.pattern, [
  ["closed-union", [["0", 0], ["1", 0], ["_", 1]]],
  ["closed-product", []]
]);
