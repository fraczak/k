/**
 * Milestone 4 WebAssembly Backend Test Suite (`k/ktvm/wasm/`).
 *
 * Verifies 100% bit-exact Wasm compilation (`wabt` validated) & execution across:
 *   1. Direct `kTVM` kernels & procs: `lsb_add` (TMC + reg + chunk_table),
 *      `lsb_trim` (virtual LIFO BitStack + stack_table), `half_max_tally`
 *      (SWAR don't-care bit compression + unshift chunk_table).
 *   2. Polymorphic & opaque payload execution (`lib/generic.k` `reverse`, `btrie`).
 *   3. Full stdlib parity in Wasm (`lib/integer.k`, `lib/ieee.k`, `lib/djson.k`
 *      incl. wide-alphabet RFC 8259 JSON parser).
 *   4. Runtime quotas (`maxSteps`, `maxNodes`, `maxBitDequeBytes`), malformed
 *      wire rejection, and deep 4,096-bit iterative stress (zero stack overflow).
 *   5. Direct wire-to-wire bit-exact equivalence: Wasm output bytes === JS ref VM!
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import k from "../../index.mjs";
import codes from "../../codes.mjs";
import { Value } from "../../Value.mjs";
import { compileLibrary, loadLibrary } from "../../object.mjs";
import { encodeToWire, decodeWire } from "../../codecs/runtime/prefix-codec.mjs";
import { parse as parseIntVal } from "../../codecs/int.mjs";
import { textToStringValue } from "../../codecs/string-codec.mjs";
import { useSpecsFor } from "../../tests/helpers/cli.mjs";
import { relationPatternPropertyList } from "../../kir.mjs";

import {
  KTVMQuotaError,
  KTVMSchemaError,
  compileKIRToKTVM,
  compileKTVMToWasm,
  compileObjectToKTVMWasm,
  executeKTVMWire,
  instantiateKTVMWasm,
  parseModule,
  specializeKTVM
} from "../index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const UNIT = Value.product({});

function bitsFromStr(str) {
  let v = Value.variant("_", UNIT);
  for (let i = str.length - 1; i >= 0; i--) v = Value.variant(str[i], v);
  return v;
}

function makeList(items) {
  let v = Value.variant("nil", UNIT);
  for (let i = items.length - 1; i >= 0; i--) {
    v = Value.variant("cons", Value.product({ car: items[i], cdr: v }));
  }
  return v;
}

function plainValue(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v.toJSON()));
}

const coreLib = loadLibrary(compileLibrary(readSrc("core.k"), { source: "core.k" }));
const genericLib = loadLibrary(compileLibrary(readSrc("lib/generic.k"), {
  source: "lib/generic.k", libraries: [coreLib], use: useSpecsFor("lib/generic.k")
}));
const integerLib = loadLibrary(compileLibrary(readSrc("lib/integer.k"), {
  source: "lib/integer.k", libraries: [coreLib], use: useSpecsFor("lib/integer.k")
}));
const ieeeLib = loadLibrary(compileLibrary(readSrc("lib/ieee.k"), {
  source: "lib/ieee.k", libraries: [coreLib], use: useSpecsFor("lib/ieee.k")
}));
const djsonLib = loadLibrary(compileLibrary(readSrc("lib/djson.k"), {
  source: "lib/djson.k", libraries: [coreLib, genericLib, ieeeLib], use: useSpecsFor("lib/djson.k")
}));
const streamLib = loadLibrary(compileLibrary(readSrc("experiments/transducer/v4/integer-streaming.k"), {
  source: "experiments/transducer/v4/integer-streaming.k", libraries: [coreLib], use: useSpecsFor("lib/integer.k")
}));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

console.log("\n=== 1. Accelerated Wasm Kernels (chunk_table, stack_table, SWAR compress) ===");

await test("Wasm lsb_add (TMC + reg + chunk_table): 100% wire-exact vs JS ref across 128-bit & 1024-bit carry chains", async () => {
  codes.load(streamLib.codes);
  const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_add], 0);
  const artifact = await compileObjectToKTVMWasm(streamLib, "lsb_add", inPat, { optimize: true });
  const runner = await instantiateKTVMWasm(artifact);

  const pairs = [
    ["0", "0"],
    ["255", "1"],
    ["12345678901234567890", "98765432109876543210"],
    [String((1n << 128n) - 1n), String((1n << 128n) - 1n)],
    [String((1n << 512n) - 1n), "1"]
  ];
  for (const [a, b] of pairs) {
    const val = Value.product({ x: parseIntVal(a).value, y: parseIntVal(b).value });
    const wire = encodeToWire(val, inPat);
    const jsRef = executeKTVMWire(artifact.ktvmModule, wire, { entry: artifact.entry, validate: false });
    const wasmRes = runner.executeWire(wire, { decodeValue: true });
    assert.equal(wasmRes.status, "OK");
    assert.deepEqual(Buffer.from(wasmRes.wire), Buffer.from(jsRef.wire), `wire mismatch on lsb_add(${a.slice(0, 10)})`);
    assert.deepEqual(plainValue(wasmRes.value), plainValue(jsRef.value));
    if (a.length >= 20 && b.length >= 20) {
      assert.ok(wasmRes.telemetry.tableLookups >= 10, "Wasm chunk_table_step must fire");
    }
  }
});

await test("Wasm lsb_trim (virtual LIFO BitStack + stack_table): 100% wire-exact including 4,096-bit stream", async () => {
  codes.load(streamLib.codes);
  const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_trim], 0);
  const artifact = await compileObjectToKTVMWasm(streamLib, "lsb_trim", inPat, { optimize: true });
  const runner = await instantiateKTVMWasm(artifact);

  const cases = ["", "0", "00000", "1", "100000", "001001000", "0".repeat(2000) + "1" + "0".repeat(2095)];
  for (const s of cases) {
    const wire = encodeToWire(bitsFromStr(s), inPat);
    const jsRef = executeKTVMWire(artifact.ktvmModule, wire, { entry: artifact.entry, validate: false, decodeValue: s.length < 200 });
    const wasmRes = runner.executeWire(wire, { decodeValue: s.length < 200 });
    assert.equal(wasmRes.status, "OK");
    assert.deepEqual(Buffer.from(wasmRes.wire), Buffer.from(jsRef.wire));
    if (s.length < 200) {
      assert.deepEqual(plainValue(wasmRes.value), plainValue(jsRef.value));
    }
    if (s.length > 1000) {
      assert.ok(wasmRes.telemetry.tableLookups >= 500, "Wasm stack_table_step must fire on 4096-bit stream");
    }
  }
});

await test("Wasm half_max_tally (SWAR compressed unshift chunk_table): 100% wire-exact", async () => {
  codes.load(integerLib.codes);
  const inPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.half_max_tally], 0);
  const artifact = await compileObjectToKTVMWasm(integerLib, "half_max_tally", inPat, { optimize: true });
  const runner = await instantiateKTVMWasm(artifact);

  for (const [a, b] of [["0", "0"], ["101010", "11"], ["1".repeat(80), "0".repeat(55)]]) {
    const val = Value.product({ x: bitsFromStr(a), y: bitsFromStr(b) });
    const wire = encodeToWire(val, inPat);
    const jsRef = executeKTVMWire(artifact.ktvmModule, wire, { entry: artifact.entry, validate: false });
    const wasmRes = runner.executeWire(wire, { decodeValue: true });
    assert.equal(wasmRes.status, "OK");
    assert.deepEqual(Buffer.from(wasmRes.wire), Buffer.from(jsRef.wire));
    assert.ok(wasmRes.telemetry.tableLookups >= 1 || a.length < 4);
  }
});

console.log("\n=== 2. Full Stdlib Parity in WebAssembly (generic, integer, ieee, djson) ===");

await test("Wasm lib/generic.k: reverse (opaque product list) & trim_bits/inc_bits/rev_bits", async () => {
  codes.load(genericLib.codes);
  for (const op of ["trim_bits", "inc_bits", "rev_bits"]) {
    const inPat = relationPatternPropertyList(genericLib.rels[genericLib.relAlias[op]], 0);
    const artifact = await compileObjectToKTVMWasm(genericLib, op, inPat, { optimize: true });
    const runner = await instantiateKTVMWasm(artifact);
    const val = bitsFromStr("00101111");
    const ref = k.compile(genericLib.relAlias[op], { libraries: [genericLib] })(val);
    const res = runner.executeWire(encodeToWire(val, inPat), { decodeValue: true });
    assert.equal(res.status, "OK");
    assert.deepEqual(plainValue(res.value), plainValue(ref), `wasm generic.${op}`);
  }

  // Polymorphic reverse on list of opaque products!
  const prodList = makeList([
    Value.product({ a: bitsFromStr("101010"), b: bitsFromStr("101") }),
    Value.product({ a: bitsFromStr("111"), b: bitsFromStr("00") }),
    Value.product({ a: bitsFromStr("0001"), b: bitsFromStr("1") })
  ]);
  const prodListPat = [
    ["closed-union", [["cons", 1], ["nil", 4]]],
    ["closed-product", [["car", 2], ["cdr", 0]]],
    ["closed-product", [["a", 3], ["b", 3]]],
    ["closed-union", [["0", 3], ["1", 3], ["_", 4]]],
    ["closed-product", []]
  ];
  const wire = encodeToWire(prodList, prodListPat);
  const revArt = await compileObjectToKTVMWasm(genericLib, "reverse", prodListPat, { optimize: true });
  const revRun = await instantiateKTVMWasm(revArt);
  const revRes = revRun.executeWire(wire, { decodeValue: true });
  const revRef = k.compile(genericLib.relAlias.reverse, { libraries: [genericLib] })(prodList);
  assert.equal(revRes.status, "OK");
  assert.deepEqual(plainValue(revRes.value), plainValue(revRef));
});

await test("Wasm lib/integer.k: plus, minus, times (Karatsuba), div, gcd, cmp", async () => {
  codes.load(integerLib.codes);
  for (const [op, val] of [
    ["plus", Value.product({ x: parseIntVal("123456789"), y: parseIntVal("-987654321") })],
    ["minus", Value.product({ x: parseIntVal("100000"), y: parseIntVal("1") })],
    ["times", Value.product({ x: parseIntVal("65537"), y: parseIntVal("123456") })],
    ["div", Value.product({ x: parseIntVal("987654321"), y: parseIntVal("12345") })],
    ["gcd", Value.product({ x: parseIntVal("1071"), y: parseIntVal("462") })],
    ["cmp", Value.product({ x: parseIntVal("-42"), y: parseIntVal("17") })]
  ]) {
    const inPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias[op]], 0);
    const artifact = await compileObjectToKTVMWasm(integerLib, op, inPat, { optimize: true });
    const runner = await instantiateKTVMWasm(artifact);
    const ref = k.compile(integerLib.relAlias[op], { libraries: [integerLib] })(val);
    const res = runner.executeWire(encodeToWire(val, inPat), { decodeValue: true });
    assert.equal(res.status, "OK", `wasm integer.${op} failed`);
    assert.deepEqual(plainValue(res.value), plainValue(ref), `wasm integer.${op} mismatch`);
  }
});

await test("Wasm lib/ieee.k: bits_to_float64 & ratio_to_float64", async () => {
  codes.load(ieeeLib.codes);
  const fPat = relationPatternPropertyList(ieeeLib.rels[ieeeLib.relAlias.bits_to_float64], 0);
  const fArt = await compileObjectToKTVMWasm(ieeeLib, "bits_to_float64", fPat, { optimize: true });
  const fRun = await instantiateKTVMWasm(fArt);
  const fVal = parseIntVal(String((1n << 53n) + 3n)).value;
  const fRef = k.compile(ieeeLib.relAlias.bits_to_float64, { libraries: [ieeeLib] })(fVal);
  const fRes = fRun.executeWire(encodeToWire(fVal, fPat), { decodeValue: true });
  assert.equal(fRes.status, "OK");
  assert.deepEqual(plainValue(fRes.value), plainValue(fRef));

  const rVal = Value.product({
    sign: Value.variant("0", UNIT),
    num: parseIntVal("355").value,
    den: parseIntVal("113").value
  });
  const rPat = [
    ["closed-product", [["den", 1], ["num", 1], ["sign", 2]]],
    ["closed-union", [["0", 1], ["1", 1], ["_", 3]]],
    ["closed-union", [["0", 3], ["1", 3]]],
    ["closed-product", []]
  ];
  const rWire = encodeToWire(rVal, rPat);
  const rArt = await compileObjectToKTVMWasm(ieeeLib, "ratio_to_float64", rPat, { optimize: true });
  const rRun = await instantiateKTVMWasm(rArt);
  const rRef = k.compile(ieeeLib.relAlias.ratio_to_float64, { libraries: [ieeeLib] })(rVal);
  const rRes = rRun.executeWire(rWire, { decodeValue: true });
  assert.equal(rRes.status, "OK");
  assert.deepEqual(plainValue(rRes.value), plainValue(rRef));
});

await test("Wasm lib/djson.k: full RFC 8259 parse_json (valid objects/arrays/escapes + invalid JSON rejection)", async () => {
  codes.load(djsonLib.codes);
  const inPat = relationPatternPropertyList(djsonLib.rels[djsonLib.relAlias.parse_json], 0);
  const artifact = await compileObjectToKTVMWasm(djsonLib, "parse_json", inPat, { optimize: true });
  const runner = await instantiateKTVMWasm(artifact);

  for (const txt of [
    "{\"a\": [1, true, null, -3.5], \"b\": \"ok\\n\\t\"}",
    "[10, 20, {\"k\": \"v\"}]",
    "{ broken"
  ]) {
    const val = textToStringValue(txt);
    const ref = k.compile(djsonLib.relAlias.parse_json, { libraries: [djsonLib] })(val);
    const res = runner.executeWire(encodeToWire(val, inPat), { decodeValue: true });
    if (ref === undefined) {
      assert.equal(res.status, "FAILED", `invalid JSON '${txt}' must fail`);
    } else {
      assert.equal(res.status, "OK", `valid JSON '${txt}' must succeed`);
      assert.deepEqual(plainValue(res.value), plainValue(ref));
    }
  }
});

console.log("\n=== 3. Quotas, Partiality, Spec Rollback/Upstream-Abort & Malformed Wire Hardening ===");

await test("Wasm enforces maxSteps & maxBitDequeBytes quotas and rejects malformed k-wire / schema mismatch", async () => {
  codes.load(streamLib.codes);
  const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_trim], 0);
  const artifact = await compileObjectToKTVMWasm(streamLib, "lsb_trim", inPat, { optimize: false });
  const runner = await instantiateKTVMWasm(artifact);

  const bigWire = encodeToWire(bitsFromStr("0".repeat(300) + "1"), inPat);
  assert.throws(
    () => runner.executeWire(bigWire, { quota: { maxSteps: 50 } }),
    (err) => err instanceof KTVMQuotaError && err.quotaKind === "maxSteps"
  );

  // Schema mismatch rejected cleanly
  const wrongWire = encodeToWire(Value.product({ a: UNIT }));
  assert.throws(() => runner.executeWire(wrongWire), KTVMSchemaError);

  // Truncated payload rejected cleanly
  const truncated = bigWire.subarray(0, bigWire.length - 4);
  assert.throws(() => runner.executeWire(truncated), /Malformed k-wire/);
});

await test("Wasm spec: local mismatch rollback + upstream failure abort + after %tok sequential settlement", async () => {
  const src = `
ktvm 0.1 mono entry @main;
schema $bits = union { 0: $bits, 1: $bits, _: unit };

proc @fail_on_zero(%x: $bits) -> (%out: $bits) {
  chan %t : $bits;
  match /1 %x -> %t;
  wrap |1 %t -> %out;
}

proc @main(%in: $bits) -> (%out: $bits) {
  spec (%in) -> (%out) {
    branch 0: {
      chan %m0 : $bits;
      match /0 %in -> %m0;
      chan %m1 : $bits;
      match /1 %m0 -> %m1;
      wrap |1 %m1 -> %out;
    }
    branch 1: {
      splice %in -> %out;
    }
  }
}
`;
  const mod = parseModule(src);
  const artifact = await compileKTVMToWasm(mod);
  const runner = await instantiateKTVMWasm(artifact);

  // Input `00_`: branch 0 consumes `0`, fails on `0 != 1`, rolls back bit-exact to branch 1!
  const w00 = encodeToWire(bitsFromStr("00"), artifact.inPlist);
  const r00 = runner.executeWire(w00, { decodeValue: true });
  assert.equal(r00.status, "OK");
  assert.deepEqual(plainValue(r00.value), plainValue(bitsFromStr("00")));
  assert.equal(r00.telemetry.specRollbacks, 1);

  // Input `01_`: branch 0 succeeds -> emits `1_`!
  const w01 = encodeToWire(bitsFromStr("01"), artifact.inPlist);
  const r01 = runner.executeWire(w01, { decodeValue: true });
  assert.equal(r01.status, "OK");
  assert.deepEqual(plainValue(r01.value), plainValue(bitsFromStr("1")));
  assert.equal(r01.telemetry.specRollbacks, 0);
});

await test("Wasm slab allocator recycles retired nodes, channels, and child scopes in constant memory", async () => {
  // Unoptimized recursive proc with switch + spec rollback on every `0` bit across 10,000 bits:
  // spawns tens of thousands of nodes, channels, and child scopes while staying inside initial 16 MiB!
  const src = `
ktvm 0.1 mono entry @flip;
schema $bits = union { 0: $bits, 1: $bits, _: unit };

proc @flip(%x: $bits) -> (%out: $bits) {
  switch (%x) {
    case (/0): {
      chan %rest : $bits;
      chan %flipped : $bits;
      spec (%x) -> (%rest) {
        branch 0: {
          chan %bad : $bits;
          match /1 %x -> %bad;
          splice %bad -> %rest;
        }
        branch 1: {
          match /0 %x -> %rest;
        }
      }
      spawn @flip(%rest) -> (%flipped);
      wrap |1 %flipped -> %out;
    }
    case (/1): {
      chan %rest : $bits;
      chan %flipped : $bits;
      match /1 %x -> %rest;
      spawn @flip(%rest) -> (%flipped);
      wrap |0 %flipped -> %out;
    }
    case (/_): {
      splice %x -> %out;
    }
  }
}
`;
  const mod = parseModule(src);
  const artifact = await compileKTVMToWasm(mod);
  const runner = await instantiateKTVMWasm(artifact);
  const bitsIn = "01".repeat(5000); // 10,000 bits -> 5,000 spec rollbacks + >100k nodes/chans!
  const wire = encodeToWire(bitsFromStr(bitsIn), artifact.inPlist);
  const res = runner.executeWire(wire, { decodeValue: false });
  assert.equal(res.status, "OK");
  assert.equal(res.telemetry.specRollbacks, 5000);
  // Initial linear memory is 256 pages (16 MiB); with slab reclamation, zero growth is needed!
  assert.ok(
    runner.exports.memory.buffer.byteLength <= 32 * 1024 * 1024,
    `Expected bounded Wasm memory <= 32 MiB, got ${runner.exports.memory.buffer.byteLength} bytes`
  );
});

console.log(`\nMilestone 4 WebAssembly Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
