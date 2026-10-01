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

const { INT_LIST_PATTERN, parse: parseIntCodec } = await import("../codecs/int.mjs");
const { valueWithEnvelopeToK } = await import("../codecs/runtime/show-value.mjs");

const parsedList = parseIntCodec("[0,1,2]");
const listWire = encodeToWire(parsedList, INT_LIST_PATTERN);
const decodedList = decodeWire(listWire).value;
assert.equal(
  valueWithEnvelopeToK(decodedList),
  "{{}|_|0|+ car, {{}|_|1|+ car, {{}|_|0|1|+ car, {}|nil cdr}|cons cdr}|cons cdr}|cons ?<{<<X1 0, X1 1, {}=X2 _>=X1 +, X1 -> car, X0 cdr} cons, X2 nil>=X0"
);
assert.equal(printInt(decodedList), "[0,1,2]");

const emptyList = parseIntCodec("[]");
const emptyWire = encodeToWire(emptyList, INT_LIST_PATTERN);
const decodedEmpty = decodeWire(emptyWire).value;
assert.equal(printInt(decodedEmpty), "[]");
