import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import k from "../index.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { compileWasmArtifact, instantiateWasmArtifact } from "../backends/wasm/src/wasm.mjs";
import { encodeNumberToValue, decodeValueToNumber } from "../codecs/ieee.mjs";
import { textToStringValue, stringValueToText } from "../codecs/runtime/unicode-string.mjs";

const core = loadLibrary(compileLibrary(readFileSync(new URL("../core.k", import.meta.url), "utf8")));
const ieee = loadLibrary(compileLibrary(readFileSync(new URL("../Examples/ieee.k", import.meta.url), "utf8"), {
  libraries: [core]
}));
assert.equal(ieee.relAlias.add, undefined, "Text conversion must not load IEEE arithmetic");
const parser = await instantiateWasmArtifact(await compileWasmArtifact(ieee.relAlias.parseFloat64, { libraries: [ieee] }));
const printer = await instantiateWasmArtifact(await compileWasmArtifact(ieee.relAlias.printFloat64, { libraries: [ieee] }));
const parse = text => parser.executeValue(textToStringValue(text));
const print = number => stringValueToText(printer.executeValue(encodeNumberToValue(number)));
const js = (name, value) => k.compile(ieee.relAlias[name], { libraries: [ieee] })(value);

for (const [text, number] of [
  ["  +12.5\n", 12.5], ["-0", -0], ["0.1", 0.1], ["1e309", Infinity],
  ["-1e999999999", -Infinity], ["+Infinity", Infinity], ["-Infinity", -Infinity]
]) {
  assert.equal(decodeValueToNumber(parse(text)), number, text);
}
assert.ok(Number.isNaN(decodeValueToNumber(parse("NaN"))));
for (const text of ["", " ", ".1", "1.", "01", "1e", "1e+", "Infinityx", "NaNx", "1 2", "--1"]) {
  assert.equal(parse(text), undefined, text);
}
for (const [number, text] of [
  [0, "0"], [-0, "-0"], [1.5, "1.5"], [-12.5, "-12.5"],
  [Infinity, "Infinity"], [-Infinity, "-Infinity"], [NaN, "NaN"],
  [0.1, "0.1000000000000000055511151231257827021181583404541015625"]
]) assert.equal(print(number), text);

// Round-trip representative extremes and deterministic binary64 bit patterns.
const numbers = [
  Number.MIN_VALUE, -Number.MIN_VALUE, 2.2250738585072014e-308,
  Number.MAX_VALUE, -Number.MAX_VALUE, 1 / 3, 9007199254740992,
  1e-100, 1e100, 1e20, -0
];
const view = new DataView(new ArrayBuffer(8));
let bits = 0x123456789abcdefn;
for (let i = 0; i < 16; i++) {
  bits = BigInt.asUintN(64, bits * 6364136223846793005n + 1442695040888963407n);
  view.setBigUint64(0, bits);
  const value = view.getFloat64(0);
  if (Number.isFinite(value)) numbers.push(value);
}
for (const number of numbers) {
  const text = print(number);
  assert.equal(Number(text), number, `Native round-trip: ${number}`);
  assert.equal(decodeValueToNumber(parse(text)), number, `k round-trip: ${number}`);
}
for (const [text, number] of [["1.5", 1.5], ["-0", -0], ["Infinity", Infinity]]) {
  assert.equal(decodeValueToNumber(js("parseFloat64", textToStringValue(text))), number);
  assert.equal(stringValueToText(js("printFloat64", encodeNumberToValue(number))), text);
}
console.log("IEEE text: parsing, exact printing, special values and binary64 round-trips passed");
