import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import k from "../index.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { Value } from "../Value.mjs";
import { compileWasmArtifact, instantiateWasmArtifact } from "../backends/wasm/src/wasm.mjs";
import { decodeValueToNumber, encodeNumberToValue } from "../codecs/ieee.mjs";
import { parseIntStr } from "../codecs/int.mjs";
import { withCompiledLibrary, useSpecsFor } from "./helpers/cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreSource = fs.readFileSync(path.join(root, "core.k"), "utf8");
const ieeeSource = fs.readFileSync(path.join(root, "lib/ieee.k"), "utf8");

const coreLib = loadLibrary(compileLibrary(coreSource, { source: "core.k" }));
const ieeeLib = loadLibrary(compileLibrary(ieeeSource, {
  source: "lib/ieee.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/ieee.k")
}));

for (const [hash, rel] of Object.entries(ieeeLib.rels)) {
  assert.equal(
    rel.typeDerivation?.status,
    "converged",
    `lib/ieee.k relation ${hash} did not converge: ${JSON.stringify(rel.typeDerivation)}`
  );
}

for (const forbidden of ["parseFloat64", "printFloat64", "parse_float64", "print_float64"]) {
  assert.equal(ieeeLib.relAlias[forbidden], undefined, `lib/ieee.k must not define ${forbidden}`);
}

for (const pat of ["sign", "exp11", "frac52", "float64"]) {
  assert.ok(ieeeLib.patternAlias[pat], `missing exported pattern '${pat}' in lib/ieee.k`);
}

const runRel = (name, input) => {
  const alias = ieeeLib.relAlias[name];
  assert.ok(alias, `missing exported relation '${name}' in lib/ieee.k`);
  return k.compile(alias, { libraries: [ieeeLib] })(input);
};

// 1. Constants & classification predicates
const pz = runRel("pos_zero", Value.product({}));
const nz = runRel("neg_zero", Value.product({}));
const pi = runRel("pos_inf", Value.product({}));
const ni = runRel("neg_inf", Value.product({}));
const qn = runRel("qnan", Value.product({}));

assert.ok(Object.is(decodeValueToNumber(pz), 0));
assert.ok(Object.is(decodeValueToNumber(nz), -0));
assert.equal(decodeValueToNumber(pi), Infinity);
assert.equal(decodeValueToNumber(ni), -Infinity);
assert.ok(Number.isNaN(decodeValueToNumber(qn)));

for (const [label, v, z, fin, inf, nan] of [
  ["+0", pz, true, true, false, false],
  ["-0", nz, true, true, false, false],
  ["1", encodeNumberToValue(1), false, true, false, false],
  ["5e-324", encodeNumberToValue(5e-324), false, true, false, false],
  ["MAX_VALUE", encodeNumberToValue(Number.MAX_VALUE), false, true, false, false],
  ["+Inf", pi, false, false, true, false],
  ["-Inf", ni, false, false, true, false],
  ["qNaN", qn, false, false, false, true]
]) {
  assert.equal(Boolean(runRel("zero_float64?", v)), z, `zero_float64?(${label})`);
  assert.equal(Boolean(runRel("finite_float64?", v)), fin, `finite_float64?(${label})`);
  assert.equal(Boolean(runRel("inf_float64?", v)), inf, `inf_float64?(${label})`);
  assert.equal(Boolean(runRel("nan_float64?", v)), nan, `nan_float64?(${label})`);
}

assert.ok(runRel("zero_exponent?", runRel("exp0", Value.product({}))));
assert.equal(runRel("all_ones_exponent?", runRel("exp0", Value.product({}))), undefined);
assert.ok(runRel("all_ones_exponent?", pi.product.exponent));
assert.equal(runRel("zero_exponent?", pi.product.exponent), undefined);

// 2. Sign negation
assert.ok(Object.is(decodeValueToNumber(runRel("negate_float64", pz)), -0));
assert.ok(Object.is(decodeValueToNumber(runRel("negate_float64", nz)), 0));
assert.equal(decodeValueToNumber(runRel("negate_float64", pi)), -Infinity);
assert.equal(decodeValueToNumber(runRel("negate_float64", ni)), Infinity);
assert.equal(decodeValueToNumber(runRel("negate_float64", encodeNumberToValue(3.25))), -3.25);

// 3. bits_to_float64: integer magnitudes & IEEE round-to-nearest ties-to-even
const bitsCases = [
  [0n, 0],
  [1n, 1],
  [42n, 42],
  [1n << 53n, 9007199254740992],
  [(1n << 53n) + 1n, 9007199254740992], // tie -> even
  [(1n << 53n) + 2n, 9007199254740994],
  [(1n << 53n) + 3n, 9007199254740996], // tie -> even
  [(1n << 1024n) - (1n << 971n), Number.MAX_VALUE],
  [(1n << 1024n) - (1n << 970n), Infinity],
  [1n << 1024n, Infinity]
];

for (const [n, expected] of bitsCases) {
  const actual = decodeValueToNumber(runRel("bits_to_float64", parseIntStr(String(n)).value));
  assert.ok(Object.is(actual, expected), `bits_to_float64(${n}) => ${actual}, expected ${expected}`);
}

// 4. ratio_to_float64: exact fractions, ties-to-even, subnormals, underflow, overflow
const ratio = (sign, num, den) =>
  Value.product({
    sign: Value.variant(sign, Value.product({})),
    num: parseIntStr(String(num)).value,
    den: parseIntStr(String(den)).value
  });

const ratioCases = [
  ["+", 0n, 1n, 0],
  ["-", 0n, 1n, -0],
  ["+", 1n, 2n, 0.5],
  ["-", 5n, 8n, -0.625],
  ["+", 1n, 10n, 0.1],
  ["-", 1n, 3n, -1 / 3],
  ["+", (1n << 53n) + 1n, 2n, 4503599627370496],
  ["+", (1n << 53n) + 3n, 2n, 4503599627370498],
  ["+", 1n, 1n << 1022n, 2 ** -1022],          // smallest normal
  ["+", 1n, 1n << 1074n, 5e-324],               // smallest subnormal
  ["+", 1n, 1n << 1075n, 0],                    // tie at half min-subnormal -> +0 (even)
  ["+", 3n, 1n << 1076n, 5e-324],               // 0.75 * 2^-1074 -> 5e-324
  ["+", 3n, 1n << 1075n, 1e-323],               // 1.5 * 2^-1074 -> 2 * 2^-1074 (tie to even)
  ["-", 1n, 1n << 1100n, -0],                   // underflow preserves sign
  ["+", 1n << 1024n, 1n, Infinity],             // overflow -> +Inf
  ["-", 1n << 1024n, 1n, -Infinity]             // overflow -> -Inf
];

for (const [sign, num, den, expected] of ratioCases) {
  const actual = decodeValueToNumber(runRel("ratio_to_float64", ratio(sign, num, den)));
  assert.ok(
    Object.is(actual, expected),
    `ratio_to_float64(${sign}${num}/${den}) => ${actual}, expected ${expected}`
  );
}
assert.equal(runRel("ratio_to_float64", ratio("+", 1n, 0n)), undefined, "zero denominator must fail");

// 5. Wasm parity & CLI compilation
const wasmNegate = await instantiateWasmArtifact(
  await compileWasmArtifact(ieeeLib.relAlias.negate_float64, { libraries: [ieeeLib] })
);
assert.ok(Object.is(decodeValueToNumber(wasmNegate.executeValue(pz)), -0));
assert.equal(decodeValueToNumber(wasmNegate.executeValue(encodeNumberToValue(2.5))), -2.5);

withCompiledLibrary(["core.k", "lib/ieee.k"], (library) => {
  assert.ok(fs.existsSync(library));
});

console.log("lib/ieee.k specification tests passed");
