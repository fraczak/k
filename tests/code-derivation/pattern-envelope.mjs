import assert from "node:assert/strict";
import k from "../../index.mjs";
import { Value, mergePatterns, withPattern } from "../../Value.mjs";
import { decodeWire, encodeToWire } from "../../codecs/runtime/prefix-codec.mjs";
import run from "../../run.mjs";
import codes from "../../codes.mjs";

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

const result = k.compile(script)(Value.product({}));
assert.deepEqual(result.pattern, INT_PATTERN);

const decoded = decodeWire(encodeToWire(result, result.pattern));
assert.deepEqual(decoded.pattern, INT_PATTERN);

const two = Value.variant("+",
  Value.variant("1",
    Value.variant("0",
      Value.variant("_", Value.product({}))
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

const identityResult = k.compile("()")(withPattern(two, INT_PATTERN));
assert.deepEqual(identityResult.pattern, INT_PATTERN);

const wrappedFloatPattern = [
  ["closed-product", [["result", 1], ["flags", 6]]],
  ["closed-product", [["sign", 2], ["exponent", 3], ["fraction", 4]]],
  ["closed-union", [["+", 5], ["-", 5]]],
  ["closed-product", [["0", 2]]],
  ["closed-product", [["0", 2]]],
  ["closed-product", []],
  ["closed-union", [["inexact", 5]]]
];
const wrappedFloat = Value.product({
  result: Value.product({
    sign: Value.variant("+", Value.product({})),
    exponent: Value.product({ 0: Value.variant("1", Value.product({})) }),
    fraction: Value.product({ 0: Value.variant("0", Value.product({})) })
  }),
  flags: Value.variant("inexact", Value.product({}))
});
const resultProjection = k.compile(".result")(withPattern(wrappedFloat, wrappedFloatPattern));
assert.deepEqual(resultProjection.pattern, [
  ["closed-product", [["sign", 1], ["exponent", 3], ["fraction", 4]]],
  ["closed-union", [["+", 2], ["-", 2]]],
  ["closed-product", []],
  ["closed-product", [["0", 1]]],
  ["closed-product", [["0", 1]]]
]);

assert.throws(
  () => k.compile(".x")(withPattern(two, INT_PATTERN)),
  /Type Error in 'comp'.*Value envelope does not intersect expression input pattern/s
);

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
