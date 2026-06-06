import assert from "node:assert/strict";

import { Value, isProduct, isVariant, isValue } from "../Value.mjs";
import { INT_PATTERN, print as printInt } from "../codecs/int.mjs";
import { print as printUnit } from "../codecs/unit.mjs";
import { valueToK } from "../codecs/runtime/show-value.mjs";
import { decodeWire, encodeToWire } from "../codecs/runtime/prefix-codec.mjs";

const foreign = await import("../Value.mjs?structural-values-regression");

assert.notEqual(foreign.Value, Value);

const foreignUnit = foreign.Value.product({});
const foreignTwo = foreign.Value.variant("+",
  foreign.Value.variant("1",
    foreign.Value.variant("0",
      foreign.Value.variant("_", foreignUnit))));

assert.equal(isProduct(foreignUnit), true);
assert.equal(isVariant(foreignTwo), true);
assert.equal(isValue(foreignTwo), true);
assert.equal(printUnit(foreignUnit), "{}");
assert.equal(printInt(foreignTwo), "2");
assert.equal(valueToK(foreignTwo), "{}|_|0|1|+");

const decoded = decodeWire(encodeToWire(foreignTwo, INT_PATTERN)).value;
assert.equal(printInt(decoded), "2");
