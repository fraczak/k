import assert from "node:assert/strict";

import { createState, evaluateInput } from "../repl.mjs";
import { Value, isProduct } from "../Value.mjs";
import codes from "../codes.mjs";
import { parse as parseFloat64, print as printFloat64 } from "../codecs/ieee.mjs";
import { closedPatternToCodeHash, valueForCode } from "../repl-codecs.mjs";

const state = createState();
await evaluateInput(":load Examples/ieee.k", state);

for (const name of ["add", "sub", "mul", "div"]) {
  assert.ok(state.relAliases[name], `Expected public IEEE relation '${name}'`);
}

const float64Hash = state.typeAliases.float64;
const floatPairHash = state.typeAliases.float_pair;

function float64(text) {
  return valueForCode(parseFloat64(text), float64Hash, codes.find);
}

function floatPair(x, y) {
  return valueForCode(Value.product({
    x: float64(x),
    y: float64(y)
  }), floatPairHash, codes.find);
}

async function runOperation(op, x, y) {
  state.value = floatPair(x, y);
  await evaluateInput(op, state);
  return state.value;
}

async function runProjectedResult(op, x, y) {
  state.value = floatPair(x, y);
  await evaluateInput(`${op}.result`, state);
  return state.value;
}

function assertFloatResult(value, expected, label) {
  assert.equal(closedPatternToCodeHash(value.pattern), float64Hash, `${label}: result should keep float64 envelope`);
  assert.equal(printFloat64(value), expected, label);
}

async function assertOperation({ op, x, y, result, flags = null, projection = false }) {
  const bundle = await runOperation(op, x, y);
  assert.ok(isProduct(bundle), `${op} should return a result bundle`);
  assert.deepEqual(Object.keys(bundle.product).sort(), ["flags", "result"]);
  assertFloatResult(bundle.product.result, result, `${op}(${x}, ${y}).result`);
  if (flags != null) {
    assert.equal(bundle.product.flags.tag, flags, `${op}(${x}, ${y}).flags`);
  }

  if (projection) {
    const projected = await runProjectedResult(op, x, y);
    assertFloatResult(projected, result, `${op}(${x}, ${y}).result projection`);
  }
}

const cases = [
  // Keep this as a fast smoke matrix. Examples/ieee.k has detailed relation-level coverage.
  { op: "add", x: "0.5", y: "0.25", result: "0.75", flags: "none", projection: true },
  { op: "add", x: "Infinity", y: "-Infinity", result: "NaN", flags: "invalid" },

  // Cover each finite arithmetic implementation, including sign and fractional results.
  { op: "sub", x: "2", y: "4", result: "-2", flags: "none" },
  { op: "mul", x: "-2", y: "4", result: "-8", flags: "none" },
  { op: "mul", x: "Infinity", y: "0", result: "NaN", flags: "invalid" },
  { op: "div", x: "1", y: "2", result: "0.5" },
  { op: "div", x: "1", y: "0", result: "Infinity", flags: "div_by_zero" },
  { op: "div", x: "0", y: "0", result: "NaN", flags: "invalid" }
];

for (const testCase of cases) {
  await assertOperation(testCase);
}

console.log("OK");
