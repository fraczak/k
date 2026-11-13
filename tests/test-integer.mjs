import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import k from "../index.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { Value } from "../Value.mjs";
import { compileWasmArtifact, instantiateWasmArtifact } from "../backends/wasm/src/wasm.mjs";
import { parse as parseIntVal, print as printIntVal } from "../codecs/int.mjs";
import { withCompiledLibrary } from "./helpers/cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integerSource = fs.readFileSync(path.join(root, "lib/integer.k"), "utf8");

// Self-contained module: lib/integer.k compiles standalone and converges completely.
const intLib = loadLibrary(compileLibrary(integerSource, {
  source: "lib/integer.k"
}));

for (const [hash, rel] of Object.entries(intLib.rels)) {
  assert.equal(
    rel.typeDerivation?.status,
    "converged",
    `lib/integer.k relation ${hash} did not converge: ${JSON.stringify(rel.typeDerivation)}`
  );
}

// Karatsuba is implemented directly inside `times`; no separate `karatsuba` export.
assert.equal(intLib.relAlias.karatsuba, undefined, "lib/integer.k must expose `times`, not `karatsuba`");

const compileRel = (name) => {
  const alias = intLib.relAlias[name];
  assert.ok(alias, `missing exported relation '${name}' in lib/integer.k`);
  return k.compile(alias, { libraries: [intLib] });
};

const compiled = {
  zero: compileRel("0"),
  one: compileRel("1"),
  nat: compileRel("nat"),
  int: compileRel("int"),
  isZero: compileRel("zero?"),
  isPos: compileRel("pos?"),
  isNeg: compileRel("neg?"),
  abs: compileRel("abs"),
  negate: compileRel("negate"),
  inc: compileRel("inc"),
  dec: compileRel("dec"),
  cmp: compileRel("cmp"),
  lt: compileRel("lt?"),
  le: compileRel("le?"),
  eq: compileRel("eq?"),
  gt: compileRel("gt?"),
  ge: compileRel("ge?"),
  plus: compileRel("plus"),
  minus: compileRel("minus"),
  times: compileRel("times"),
  divmod: compileRel("divmod"),
  div: compileRel("div"),
  mod: compileRel("mod"),
  gcd: compileRel("gcd"),
  lcm: compileRel("lcm")
};

function bitsFromStr(str) {
  let v = Value.variant("_", Value.product({}));
  for (let i = str.length - 1; i >= 0; i--) {
    v = Value.variant(str[i], v);
  }
  return v;
}

const iVal = (n) => parseIntVal(String(n));
const toBig = (v) => BigInt(printIntVal(v));
const pair = (x, y) => Value.product({ x: iVal(x), y: iVal(y) });

function jsGcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function jsLcm(a, b) {
  if (a === 0n || b === 0n) return 0n;
  const aa = a < 0n ? -a : a;
  const bb = b < 0n ? -b : b;
  return (aa / jsGcd(aa, bb)) * bb;
}

// 1. Constants & normalization
assert.equal(toBig(compiled.zero(Value.product({}))), 0n);
assert.equal(toBig(compiled.one(Value.product({}))), 1n);
assert.equal(toBig(compiled.nat(bitsFromStr("000101"))), 5n);
assert.equal(toBig(compiled.nat(bitsFromStr("000"))), 0n);
assert.deepEqual(
  compiled.int(Value.variant("-", bitsFromStr("000"))).toJSON(),
  iVal(0n).toJSON(),
  "int normalizer must canonicalize -0 to +0"
);

// 2. Predicates & unary relations
const unaryCases = [
  0n,
  1n,
  -1n,
  2n,
  -2n,
  255n,
  -256n,
  (1n << 64n) - 1n,
  1n << 64n,
  -(1n << 64n),
  -((1n << 64n) - 1n)
];

for (const x of unaryCases) {
  const vx = iVal(x);
  assert.equal(Boolean(compiled.isZero(vx)), x === 0n, `zero?(${x})`);
  assert.equal(Boolean(compiled.isPos(vx)), x > 0n, `pos?(${x})`);
  assert.equal(Boolean(compiled.isNeg(vx)), x < 0n, `neg?(${x})`);
  assert.equal(toBig(compiled.abs(vx)), x < 0n ? -x : x, `abs(${x})`);
  assert.equal(toBig(compiled.negate(vx)), -x, `negate(${x})`);
  assert.equal(toBig(compiled.inc(vx)), x + 1n, `inc(${x})`);
  assert.equal(toBig(compiled.dec(vx)), x - 1n, `dec(${x})`);
}

// 3. Ordering & binary arithmetic vs BigInt oracle (small, cross-sign, and large multi-limb)
const operands = [
  0n,
  1n,
  -1n,
  2n,
  -2n,
  3n,
  -3n,
  6n,
  -7n,
  42n,
  -99n,
  12345678901234567890n,
  -98765432109876543210n,
  (1n << 80n) - 3n,
  -((1n << 95n) + 12345n),
  (1n << 160n) + 999999999999999n
];

for (const x of operands) {
  for (const y of operands) {
    const inp = pair(x, y);
    const expectedOrd = x < y ? "lt" : x > y ? "gt" : "eq";
    assert.equal(compiled.cmp(inp).tag, expectedOrd, `cmp(${x}, ${y})`);
    assert.equal(Boolean(compiled.lt(inp)), x < y, `lt?(${x}, ${y})`);
    assert.equal(Boolean(compiled.le(inp)), x <= y, `le?(${x}, ${y})`);
    assert.equal(Boolean(compiled.eq(inp)), x === y, `eq?(${x}, ${y})`);
    assert.equal(Boolean(compiled.gt(inp)), x > y, `gt?(${x}, ${y})`);
    assert.equal(Boolean(compiled.ge(inp)), x >= y, `ge?(${x}, ${y})`);

    assert.equal(toBig(compiled.plus(inp)), x + y, `plus(${x}, ${y})`);
    assert.equal(toBig(compiled.minus(inp)), x - y, `minus(${x}, ${y})`);
    assert.equal(toBig(compiled.times(inp)), x * y, `times(${x}, ${y})`);
  }
}

// Multi-limb Karatsuba squaring & asymmetric products (256-bit)
const bigA = (1n << 255n) - 19n;
const bigB = (1n << 220n) + 0xdeadbeefcafebaben;
assert.equal(toBig(compiled.times(pair(bigA, bigA))), bigA * bigA);
assert.equal(toBig(compiled.times(pair(bigA, -bigB))), bigA * -bigB);
assert.equal(toBig(compiled.times(pair(-bigA, bigB))), -bigA * bigB);

// 4. Fast binary division (truncating semantics), remainder, gcd, lcm
const divCases = [
  [0n, 3n],
  [0n, -3n],
  [7n, 3n],
  [-7n, 3n],
  [7n, -3n],
  [-7n, -3n],
  [6n, -3n],
  [-6n, 3n],
  [3n, 7n],
  [-3n, 7n],
  [98765432109876543210987654321n, 123456789012345n],
  [-98765432109876543210987654321n, 123456789012345n],
  [(1n << 256n) + 123456789n, (1n << 100n) + 999999999999n],
  [-((1n << 256n) + 123456789n), -((1n << 100n) + 999999999999n)]
];

for (const [x, y] of divCases) {
  const inp = pair(x, y);
  const dm = compiled.divmod(inp);
  const q = toBig(dm.product.q);
  const r = toBig(dm.product.r);
  assert.equal(q, x / y, `divmod.q(${x}, ${y})`);
  assert.equal(r, x % y, `divmod.r(${x}, ${y})`);
  assert.equal(q * y + r, x, `divmod identity(${x}, ${y})`);
  assert.equal(toBig(compiled.div(inp)), x / y, `div(${x}, ${y})`);
  assert.equal(toBig(compiled.mod(inp)), x % y, `mod(${x}, ${y})`);
}

for (const x of [0n, 7n, -7n]) {
  assert.equal(compiled.divmod(pair(x, 0n)), undefined, `divmod(${x}, 0) must fail`);
  assert.equal(compiled.div(pair(x, 0n)), undefined, `div(${x}, 0) must fail`);
  assert.equal(compiled.mod(pair(x, 0n)), undefined, `mod(${x}, 0) must fail`);
}

const gcdCases = [
  [0n, 0n],
  [0n, -18n],
  [-18n, 0n],
  [-48n, 18n],
  [48n, -18n],
  [-12n, -18n],
  [6n << 80n, -9n << 80n],
  [104729n * 999983n, 999983n * 1299709n]
];

for (const [x, y] of gcdCases) {
  const inp = pair(x, y);
  assert.equal(toBig(compiled.gcd(inp)), jsGcd(x, y), `gcd(${x}, ${y})`);
  assert.equal(toBig(compiled.lcm(inp)), jsLcm(x, y), `lcm(${x}, ${y})`);
}

// 5. Wasm & CLI chaining parity
const wasmInc = await instantiateWasmArtifact(
  await compileWasmArtifact(intLib.relAlias.inc, { libraries: [intLib] })
);
assert.equal(toBig(wasmInc.executeValue(iVal(-1n))), 0n);
assert.equal(toBig(wasmInc.executeValue(iVal((1n << 64n) - 1n))), 1n << 64n);

const wasmSquare = await instantiateWasmArtifact(
  await compileWasmArtifact(`{ () x, () y } ${intLib.relAlias.times}`, { libraries: [intLib] })
);
const sqInput = (1n << 140n) - 12345n;
assert.equal(toBig(wasmSquare.executeValue(iVal(sqInput))), sqInput * sqInput);

withCompiledLibrary(["lib/integer.k"], (library) => {
  const parseCli = spawnSync(process.execPath, ["codecs/int.mjs", "--parse"], {
    cwd: root,
    input: "98765432109876543210\n"
  });
  assert.equal(parseCli.status, 0, parseCli.stderr?.toString());
  const runCli = spawnSync(
    process.execPath,
    ["k.mjs", "--lib", library, "--use", "times", "{ () x, () y } times"],
    { cwd: root, input: parseCli.stdout, maxBuffer: 8 * 1024 * 1024 }
  );
  assert.equal(runCli.status, 0, runCli.stderr?.toString());
  const printCli = spawnSync(process.execPath, ["codecs/int.mjs", "--print"], {
    cwd: root,
    input: runCli.stdout
  });
  assert.equal(printCli.status, 0, printCli.stderr?.toString());
  assert.equal(
    printCli.stdout.toString("utf8").trim(),
    String(98765432109876543210n * 98765432109876543210n)
  );
});

console.log("lib/integer.k specification tests passed");
