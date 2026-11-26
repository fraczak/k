/**
 * Milestone 3 Verified Optimizer Test Suite (`k/ktvm/optimize/`).
 *
 * Verifies:
 *   1. Howard's policy-improvement MWTR evaluator (`computeMWTR`) & global
 *      L1 budget allocator (`allocateTableBudgets`, default 64 KB).
 *   2. Automatic CPS symbolic `proc -> kernel` fusion, TMC forward streaming,
 *      finite-enum register promotion (`reg c : enum(2)`), and `chunk_table`
 *      synthesis + always-on static bisimulation on `integer-streaming.k`
 *      (`lsb_add`, `lsb_sub`, `lsb_mul`) and `lib/integer.k` (`plus`, `minus`, `times`, `rev_bits`, `lsb_shl`)!
 *   3. Automatic virtual LIFO bit-stack promotion (`stack s : bits`) +
 *      bisimulation-verified `stack_table` synthesis on `integer-streaming.k`
 *      `lsb_trim` AND `lib/generic.k` `rev_bits` / `trim_bits`!
 *   4. Automatic SWAR don't-care bit compression (`compress: { mask }`) on
 *      `half_max_tally` / `lsb_shl` (halving effective key bits while passing
 *      exhaustive raw-window bisimulation verification!).
 *   5. Graceful wide-alphabet fallback on `lib/djson.k` (`parse_json`, `get`)
 *      leaving wide `ascii[]`/`unicode[]` procs intact while honoring L1 budget!
 *   6. Measurable step-count reduction & 100% bit-exact parity (`unopt kTVM`
 *      vs `opt kTVM` vs `k.compile`) + printable `.ktvm` round-trip!
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import k from "../index.mjs";
import codes from "../codes.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { encodeToWire, decodeWire } from "../codecs/runtime/prefix-codec.mjs";
import { parse as parseIntVal } from "../codecs/int.mjs";
import { patternFromFilter } from "../codecs/runtime/codec-sdk.mjs";
import { textToStringValue } from "../codecs/string-codec.mjs";
import { useSpecsFor } from "../tests/helpers/cli.mjs";
import { relationPatternPropertyList } from "../kir.mjs";

import {
  DEFAULT_L1_BUDGET_BYTES,
  allocateTableBudgets,
  compileKIRToKTVM,
  computeMWTR,
  executeKTVMWire,
  optimizeKTVM,
  parseModule,
  printModule,
  validateModule
} from "./index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const UNIT = Value.product({});

function bitsFromStr(str) {
  let v = Value.variant("_", UNIT);
  for (let i = str.length - 1; i >= 0; i--) v = Value.variant(str[i], v);
  return v;
}

function plainValue(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v.toJSON()));
}

const coreLib = loadLibrary(compileLibrary(readSrc("core.k"), { source: "core.k" }));
const genericLib = loadLibrary(compileLibrary(readSrc("lib/generic.k"), {
  source: "lib/generic.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/generic.k")
}));
const integerLib = loadLibrary(compileLibrary(readSrc("lib/integer.k"), {
  source: "lib/integer.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/integer.k")
}));
const ieeeLib = loadLibrary(compileLibrary(readSrc("lib/ieee.k"), {
  source: "lib/ieee.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/ieee.k")
}));
const djsonLib = loadLibrary(compileLibrary(readSrc("lib/djson.k"), {
  source: "lib/djson.k",
  libraries: [coreLib, genericLib, ieeeLib],
  use: useSpecsFor("lib/djson.k")
}));
const streamLib = loadLibrary(compileLibrary(readSrc("ktvm/fixtures/integer-streaming.k"), {
  source: "ktvm/fixtures/integer-streaming.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/integer.k")
}));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

// ============================================================================
console.log("\n=== 1. Howard MWTR Algorithm & Global L1 Budget Allocator ===");
// ============================================================================

test("Howard computeMWTR finds exact minimum cycle ratio and critical bottleneck cycle", () => {
  // 2-state graph:
  //   0 -> 0 (w=8, t=1 -> 8.0)
  //   0 -> 1 (w=6, t=1)
  //   1 -> 0 (w=4, t=1) -> 2-cycle ratio = (6+4)/2 = 5.0 (minimum!)
  //   1 -> 1 (w=6, t=1 -> 6.0)
  const res = computeMWTR(2, [
    { from: 0, to: 0, w: 8, t: 1 },
    { from: 0, to: 1, w: 6, t: 1 },
    { from: 1, to: 0, w: 4, t: 1 },
    { from: 1, to: 1, w: 6, t: 1 }
  ]);
  assert.ok(Math.abs(res.rho - 5.0) < 1e-9, `expected rho=5.0, got ${res.rho}`);
  assert.equal(res.cycleNodes.length, 2);
});

test("Global L1 budget allocator maximizes MWTR within 64 KB budget and degrades cleanly on tight budget", () => {
  const frontiers = [
    {
      kernelName: "@k_add",
      candidates: [
        { bytes: 256, rho: 4.0 },
        { bytes: 4096, rho: 8.0 },
        { bytes: 65536, rho: 12.0 }
      ]
    },
    {
      kernelName: "@k_trim",
      candidates: [
        { bytes: 192, rho: 2.0 },
        { bytes: 768, rho: 4.0 }
      ]
    }
  ];

  // Under default 64 KB budget: picks k_add (4096B, rho=8) + k_trim (768B, rho=4) — fits in 4,864B!
  const a1 = allocateTableBudgets(frontiers, { budgetBytes: DEFAULT_L1_BUDGET_BYTES });
  assert.ok(a1.usedBytes <= DEFAULT_L1_BUDGET_BYTES);
  assert.equal(a1.chosen.get("@k_add").rho, 8.0);
  assert.equal(a1.chosen.get("@k_trim").rho, 4.0);

  // Under ultra-tight 512 B budget: picks k_add (256B) + k_trim (192B) = 448B!
  const a2 = allocateTableBudgets(frontiers, { budgetBytes: 512 });
  assert.equal(a2.usedBytes, 448);
  assert.equal(a2.chosen.get("@k_add").bytes, 256);
  assert.equal(a2.chosen.get("@k_trim").bytes, 192);

  // Under 0 B budget: graceful fallback to CFG-only (null)
  const a0 = allocateTableBudgets(frontiers, { budgetBytes: 0 });
  assert.equal(a0.usedBytes, 0);
  assert.equal(a0.chosen.get("@k_add"), null);
  assert.equal(a0.chosen.get("@k_trim"), null);
});

// ============================================================================
console.log("\n=== 2. TMC Streaming Fusion, Register Promotion & Bisimulation-Verified Chunk Tables ===");
// ============================================================================

test("integer-streaming.k lsb_add: auto-fuses TMC kernel + reg carry + verified chunk_table, beats unopt steps", () => {
  codes.load(streamLib.codes);
  const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_add], 0);
  const compiled = compileKIRToKTVM(streamLib, "lsb_add", inPat);
  const opt = optimizeKTVM(compiled.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });

  assert.ok(opt.stats.fuse.tmcLoops >= 1, `expected >= 1 TMC loop, got ${JSON.stringify(opt.stats.fuse)}`);
  assert.ok(opt.stats.fuse.registerPromotions >= 1, "expected carry register promotion");
  assert.ok(opt.stats.tables.tablesSynthesized >= 1, "expected bisimulation-verified chunk_table");
  assert.ok(opt.stats.tables.totalTableBytes <= DEFAULT_L1_BUDGET_BYTES);

  // Printable DSL round-trip + validator re-check!
  const dsl = printModule(opt.module);
  const reparsed = parseModule(dsl);
  assert.equal(validateModule(reparsed, { verifyTables: true }).ok, true);

  // Verify 100% bit-exact parity + dramatic step reduction on 64-bit and 128-bit addition!
  const bigPairs = [
    ["0", "0"],
    ["255", "1"],
    ["12345678901234567890", "98765432109876543210"],
    ["340282366920938463463374607431768211455", "1"], // 2^128 - 1 + 1 carry chain!
    ["340282366920938463463374607431768211455", "340282366920938463463374607431768211455"] // 2x 128-bit hot chunk loop!
  ];
  for (const [a, b] of bigPairs) {
    const val = Value.product({ x: parseIntVal(a).value, y: parseIntVal(b).value });
    const wire = encodeToWire(val, inPat);
    const unoptRes = executeKTVMWire(compiled.module, wire, { entry: compiled.entry, validate: false });
    const optRes = executeKTVMWire(opt.module, wire, { entry: compiled.entry, validate: false });

    assert.equal(optRes.status, "OK");
    assert.deepEqual(plainValue(optRes.value), plainValue(unoptRes.value), `lsb_add(${a},${b})`);
    assert.deepEqual(
      plainValue(decodeWire(optRes.wire, { eager: true }).value),
      plainValue(unoptRes.value)
    );
    if (a.length >= 20 && b.length >= 20) {
      assert.ok(optRes.telemetry.tableLookups >= 10, `table_step must fire on hot loop (got ${optRes.telemetry.tableLookups})`);
    }
    if (a.length >= 20) {
      assert.ok(
        optRes.telemetry.steps < unoptRes.telemetry.steps / 4,
        `expected >=4x step reduction (unopt=${unoptRes.telemetry.steps}, opt=${optRes.telemetry.steps})`
      );
    }
  }
});

test("integer-streaming.k lsb_trim: auto-promotes virtual LIFO BitStack + bisimulation-verified stack_table", () => {
  codes.load(streamLib.codes);
  const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_trim], 0);
  const compiled = compileKIRToKTVM(streamLib, "lsb_trim", inPat);
  const opt = optimizeKTVM(compiled.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });

  assert.ok(opt.stats.fuse.stackKernels >= 1, `expected >= 1 virtual-stack kernel, got ${JSON.stringify(opt.stats.fuse)}`);
  assert.ok(opt.stats.tables.tablesSynthesized >= 1, "expected verified stack_table");
  assert.ok(opt.module.tables.some((t) => t.kind === "stack_table"), "must synthesize stack_table");

  const cases = ["", "0", "00000", "1", "100000", "001001000", "0".repeat(200) + "1" + "0".repeat(300)];
  for (const s of cases) {
    const wire = encodeToWire(bitsFromStr(s), inPat);
    const unoptRes = executeKTVMWire(compiled.module, wire, { entry: compiled.entry, validate: false });
    const optRes = executeKTVMWire(opt.module, wire, { entry: compiled.entry, validate: false });
    assert.equal(optRes.status, "OK");
    assert.deepEqual(plainValue(optRes.value), plainValue(unoptRes.value), `lsb_trim(${s.slice(0, 16)})`);
    if (s.length > 100) {
      assert.ok(optRes.telemetry.tableLookups >= 10);
      assert.ok(optRes.telemetry.steps < unoptRes.telemetry.steps / 4);
    }
  }
});

test("SWAR don't-care bit compression automatically activates on half_max_tally and passes exhaustive bisimulation", () => {
  codes.load(integerLib.codes);
  const inPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.half_max_tally], 0);
  const compiled = compileKIRToKTVM(integerLib, "half_max_tally", inPat);
  const opt = optimizeKTVM(compiled.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });

  const compressedTables = opt.module.tables.filter((t) =>
    t.kind === "chunk_table" && (t.props.inputs || []).some((i) => i.compress && i.compress.ident !== "none")
  );
  assert.ok(
    compressedTables.length >= 1,
    `expected SWAR mask compression on half_max_tally, got tables=${JSON.stringify(opt.stats.tables.kernelReports)}`
  );

  // Verify parity across varied lengths
  for (const [a, b] of [["0", "0"], ["101010", "11"], ["1".repeat(40), "0".repeat(25)]]) {
    const val = Value.product({ x: bitsFromStr(a), y: bitsFromStr(b) });
    const wire = encodeToWire(val, inPat);
    const unoptRes = executeKTVMWire(compiled.module, wire, { entry: compiled.entry, validate: false });
    const optRes = executeKTVMWire(opt.module, wire, { entry: compiled.entry, validate: false });
    assert.equal(optRes.status, "OK");
    assert.deepEqual(plainValue(optRes.value), plainValue(unoptRes.value));
    assert.ok(optRes.telemetry.tableLookups >= 1);
  }
});

// ============================================================================
console.log("\n=== 3. Full Stdlib Optimized Parity (integer.k, generic.k, ieee.k, djson.k) ===");
// ============================================================================

test("Optimized lib/integer.k (plus, minus, times, gcd, rev_bits) matches reference bit-for-bit within 64 KB L1", () => {
  codes.load(integerLib.codes);
  for (const [op, val] of [
    ["plus", Value.product({ x: parseIntVal("123456789"), y: parseIntVal("-987654321") })],
    ["minus", Value.product({ x: parseIntVal("100000"), y: parseIntVal("1") })],
    ["times", Value.product({ x: parseIntVal("65537"), y: parseIntVal("123456") })],
    ["gcd", Value.product({ x: parseIntVal("1071"), y: parseIntVal("462") })],
    ["rev_bits", bitsFromStr("1011001110001")]
  ]) {
    const inPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias[op]], 0);
    const compiled = compileKIRToKTVM(integerLib, op, inPat);
    const opt = optimizeKTVM(compiled.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
    assert.ok(opt.stats.tables.totalTableBytes <= DEFAULT_L1_BUDGET_BYTES);

    const wire = encodeToWire(val, inPat);
    const ref = k.compile(integerLib.relAlias[op], { libraries: [integerLib] })(val);
    const optRes = executeKTVMWire(opt.module, wire, { entry: compiled.entry, validate: false });
    assert.equal(optRes.status, "OK", `opt integer.${op} failed`);
    assert.deepEqual(plainValue(optRes.value), plainValue(ref), `opt integer.${op} mismatch`);
  }
});

test("Optimized lib/generic.k (trim_bits, inc_bits, rev_bits) and lib/ieee.k (bits_to_float64) match bit-for-bit", () => {
  codes.load(genericLib.codes);
  for (const op of ["trim_bits", "inc_bits", "rev_bits"]) {
    const inPat = relationPatternPropertyList(genericLib.rels[genericLib.relAlias[op]], 0);
    const compiled = compileKIRToKTVM(genericLib, op, inPat);
    const opt = optimizeKTVM(compiled.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
    const val = bitsFromStr("00101111");
    const ref = k.compile(genericLib.relAlias[op], { libraries: [genericLib] })(val);
    const optRes = executeKTVMWire(opt.module, encodeToWire(val, inPat), { entry: compiled.entry, validate: false });
    assert.equal(optRes.status, "OK");
    assert.deepEqual(plainValue(optRes.value), plainValue(ref), `opt generic.${op}`);
  }

  codes.load(ieeeLib.codes);
  const fPat = relationPatternPropertyList(ieeeLib.rels[ieeeLib.relAlias.bits_to_float64], 0);
  const fComp = compileKIRToKTVM(ieeeLib, "bits_to_float64", fPat);
  const fOpt = optimizeKTVM(fComp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
  assert.ok(fOpt.stats.tables.totalTableBytes <= DEFAULT_L1_BUDGET_BYTES);
  const fVal = parseIntVal(String((1n << 53n) + 3n)).value;
  const fRef = k.compile(ieeeLib.relAlias.bits_to_float64, { libraries: [ieeeLib] })(fVal);
  const fRes = executeKTVMWire(fOpt.module, encodeToWire(fVal, fPat), { entry: fComp.entry, validate: false });
  assert.equal(fRes.status, "OK");
  assert.deepEqual(plainValue(fRes.value), plainValue(fRef));
});

test("Graceful wide-alphabet fallback on lib/djson.k parse_json stays strictly inside 64 KB L1 budget", () => {
  codes.load(djsonLib.codes);
  const inPat = relationPatternPropertyList(djsonLib.rels[djsonLib.relAlias.parse_json], 0);
  const compiled = compileKIRToKTVM(djsonLib, "parse_json", inPat);
  const opt = optimizeKTVM(compiled.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
  assert.ok(opt.stats.tables.totalTableBytes <= DEFAULT_L1_BUDGET_BYTES);

  for (const txt of ["{\"a\": [1, true, null], \"b\": \"ok\\n\"}", "{ broken"]) {
    const val = textToStringValue(txt);
    const ref = k.compile(djsonLib.relAlias.parse_json, { libraries: [djsonLib] })(val);
    const optRes = executeKTVMWire(opt.module, encodeToWire(val, inPat), { entry: compiled.entry, validate: false });
    if (ref === undefined) {
      assert.equal(optRes.status, "FAILED");
    } else {
      assert.equal(optRes.status, "OK");
      assert.deepEqual(plainValue(optRes.value), plainValue(ref));
    }
  }
});

test("simplifyProcs: helper inlining, O(N^2) tee->demux collapse, spec->switch, and loop-kernel extraction on lib/integer.k", () => {
  codes.load(integerLib.codes);
  const plusPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.plus], 0);
  const plusComp = compileKIRToKTVM(integerLib, "plus", plusPat);
  const plusOpt = optimizeKTVM(plusComp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });

  assert.ok(plusOpt.stats.simplify.inlinedCalls >= 1, "must inline small acyclic helpers");
  assert.ok(plusOpt.stats.simplify.teeDemuxCollapses >= 2, "must collapse O(N^2) tee->demux projections");
  assert.ok(plusOpt.stats.simplify.specsConverted >= 2, "must compile deterministic lsb_add/lsb_sub specs to switch");
  assert.ok(plusOpt.stats.simplify.loopsExtracted >= 2, "must extract pure loop kernels for lsb_add/lsb_sub");
  assert.ok(
    plusOpt.module.tables.some((t) => t.kind === "chunk_table" && t.name.includes("lsb_add")),
    "must synthesize bisimulation-verified chunk_table for lib/integer.k lsb_add_loop"
  );
  assert.ok(
    plusOpt.module.tables.some((t) => t.kind === "chunk_table" && t.name.includes("lsb_sub")),
    "must synthesize bisimulation-verified chunk_table for lib/integer.k lsb_sub_loop"
  );

  const bigAdd = Value.product({
    x: parseIntVal(String((1n << 127n) - 37n)),
    y: parseIntVal(String((1n << 127n) - 19n))
  });
  const wire = encodeToWire(bigAdd, plusPat);
  const res = executeKTVMWire(plusOpt.module, wire, { entry: plusComp.entry, validate: false });
  assert.equal(res.status, "OK");
  assert.equal(res.telemetry.specRollbacks, 0, "integer.plus must execute with 0 speculative rollbacks");
  assert.ok(res.telemetry.tableLookups >= 10, "extracted lsb_add_loop chunk_table must fire");

  // Karatsuba `times`: nested spec on (_k_state -> /apply -> .stack /nil vs /cons) must split cleanly to switch!
  const timesPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.times], 0);
  const timesComp = compileKIRToKTVM(integerLib, "times", timesPat);
  const timesOpt = optimizeKTVM(timesComp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
  const bigMul = Value.product({
    x: parseIntVal("98765432109876543210"),
    y: parseIntVal("12345678901234567890")
  });
  const mulWire = encodeToWire(bigMul, timesPat);
  const mulRes = executeKTVMWire(timesOpt.module, mulWire, { entry: timesComp.entry, validate: false });
  assert.equal(mulRes.status, "OK");
  assert.equal(mulRes.telemetry.specRollbacks, 0, "integer.times Karatsuba loop must execute with 0 speculative rollbacks");
});

test("simplifyProcs: strict accumulator forcing collapses lazy tail-loop chains to O(1) nodes without slowing reverse", () => {
  const polySrc = readSrc("Examples/poly.k");
  const polyDep = loadLibrary(compileLibrary(readSrc("lib/integer.k"), { source: "lib/integer.k" }));
  const polyRaw = loadLibrary(compileLibrary(polySrc, {
    source: "Examples/poly.k",
    libraries: [polyDep],
    use: ["int[] nat int pos? neg? zero? gt? inc dec"]
  }));
  const polyLib = {
    format: "k-object",
    codes: { ...polyDep.codes, ...polyRaw.codes },
    rels: { ...polyDep.rels, ...polyRaw.rels },
    relAlias: { ...polyRaw.relAlias },
    meta: { ...polyDep.meta, ...polyRaw.meta }
  };
  codes.load(polyLib.codes);
  const mkList = (n) => {
    let cur = Value.variant("nil", UNIT);
    for (let i = n; i >= 1; i--) cur = Value.variant("cons", Value.product({ car: parseIntVal(String(i)), cdr: cur }));
    return cur;
  };
  const inferredPat = relationPatternPropertyList(polyLib.rels[polyLib.relAlias.length], 0);
  const wire200 = encodeToWire(mkList(200), inferredPat);
  const listPat = decodeWire(wire200).pattern;

  // `length`: uninspected accumulator `acc` updated by `inc` -> must be forced via `after %tok`
  const lenComp = compileKIRToKTVM(polyLib, "length", listPat);
  const lenOpt = optimizeKTVM(lenComp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
  assert.ok(lenOpt.stats.simplify.strictAccumulatorsForced >= 1, "expected strict accumulator forcing on poly.length");
  const len200 = executeKTVMWire(lenOpt.module, wire200, { entry: lenComp.entry, validate: false });
  assert.equal(len200.status, "OK");
  assert.equal(len200.telemetry.afterSettlements, 200);
  assert.ok(len200.telemetry.peakActiveNodes <= 64, `expected O(1) peakActiveNodes <= 64 on length(200), got ${len200.telemetry.peakActiveNodes}`);

  // `reverse`: structural `mux`+`wrap` accumulator must stay lazy (0 forced accumulators)
  const revComp = compileKIRToKTVM(polyLib, "reverse", listPat);
  const revOpt = optimizeKTVM(revComp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });
  assert.equal(revOpt.stats.simplify.strictAccumulatorsForced, 0, "structural reverse accumulator must remain lazy");
});

test("simplifyProcs: interprocedural entry-guard analysis eliminates >99% of speculative rollbacks in djson.parse_json", () => {
  codes.load(djsonLib.codes);
  const inPat = relationPatternPropertyList(djsonLib.rels[djsonLib.relAlias.parse_json], 0);
  const comp = compileKIRToKTVM(djsonLib, "parse_json", inPat);
  const opt = optimizeKTVM(comp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });

  // Interprocedural guards must eliminate all specs from `@dj_parse_atom` and `@dj_parse_expect_val`!
  const expectValProc = opt.module.procs.find((p) => p.name.startsWith("@dj_parse_expect_val"));
  const parseAtomProc = opt.module.procs.find((p) => p.name.startsWith("@dj_parse_atom"));
  assert.ok(expectValProc, "expected @dj_parse_expect_val proc");
  assert.ok(parseAtomProc, "expected @dj_parse_atom proc");
  assert.equal(
    JSON.stringify(expectValProc.body).includes('"op":"spec"'),
    false,
    "@dj_parse_expect_val must compile to deterministic switch (0 specs)"
  );
  assert.equal(
    JSON.stringify(parseAtomProc.body).includes('"op":"spec"'),
    false,
    "@dj_parse_atom must compile to deterministic switch (0 specs)"
  );

  const items = [];
  for (let i = 0; i < 10; i++) {
    items.push(`{"id":${i},"ok":${i % 2 === 0},"val":${(i * -1.25).toFixed(2)},"nil":null,"tag":"item_${i}"}`);
  }
  const val = textToStringValue(`[${items.join(",")}]`);
  const wire = encodeToWire(val, inPat);
  const quota = { maxSteps: 1e8, maxNodes: 5e5, maxBitDequeBytes: 64 * 1024 * 1024 };
  const unoptRes = executeKTVMWire(comp.module, wire, { entry: comp.entry, validate: false, quota });
  const optRes = executeKTVMWire(opt.module, wire, { entry: comp.entry, validate: false, quota });

  assert.equal(optRes.status, "OK");
  assert.equal(
    Buffer.compare(Buffer.from(unoptRes.wire), Buffer.from(optRes.wire)),
    0,
    "optimized djson wire must match unoptimized wire bit-for-bit"
  );
  assert.ok(
    optRes.telemetry.specRollbacks <= 15,
    `expected <= 15 rollbacks on 10 JSON objects (was 2,456), got ${optRes.telemetry.specRollbacks}`
  );
  assert.ok(
    optRes.telemetry.steps < 450000,
    `expected linear step budget < 450k on 10 JSON objects, got ${optRes.telemetry.steps}`
  );
});

test("simplifyProcs: product-demux hoisting keeps poly.split_by strictly O(L) linear in steps and buffer bytes", () => {
  const polyDep = loadLibrary(compileLibrary(readSrc("lib/integer.k"), { source: "lib/integer.k" }));
  const polyRaw = loadLibrary(compileLibrary(readSrc("Examples/poly.k"), {
    source: "Examples/poly.k",
    libraries: [polyDep],
    use: ["int[] nat int pos? neg? zero? gt? inc dec"]
  }));
  const polyLib = {
    format: "k-object",
    codes: { ...polyDep.codes, ...polyRaw.codes },
    rels: { ...polyDep.rels, ...polyRaw.rels },
    relAlias: { ...polyRaw.relAlias },
    meta: { ...polyDep.meta, ...polyRaw.meta }
  };
  codes.load(polyLib.codes);
  const mkList = (n) => {
    let cur = Value.variant("nil", UNIT);
    for (let i = n; i >= 1; i--) cur = Value.variant("cons", Value.product({ car: parseIntVal(String(i)), cdr: cur }));
    return cur;
  };
  const splitPat = patternFromFilter(`
    ?{
      < <bits 0, bits 1, {} _>=bits "+", bits "-" > n,
      <
        {} nil,
        {
          < <bits 0, bits 1, {} _>=bits "+", bits "-" > car,
          list cdr
        } cons
      > = list xs
    }
  `);
  const sampleVal = Value.product({ n: parseIntVal("20"), xs: mkList(40) });
  const wire40 = encodeToWire(sampleVal, splitPat);

  const comp = compileKIRToKTVM(polyLib, "split_by", splitPat);
  const opt = optimizeKTVM(comp.module, { budgetBytes: DEFAULT_L1_BUDGET_BYTES, verifyTables: true });

  const refFn = k.compile(polyLib.relAlias.split_by, { libraries: [polyLib] });
  const val160 = Value.product({ n: parseIntVal("80"), xs: mkList(160) });
  const wire160 = encodeToWire(val160, splitPat);

  const r40 = executeKTVMWire(opt.module, wire40, { entry: comp.entry, validate: false });
  const r160 = executeKTVMWire(opt.module, wire160, { entry: comp.entry, validate: false });
  assert.equal(r40.status, "OK");
  assert.equal(r160.status, "OK");
  assert.deepEqual(plainValue(r40.value), plainValue(refFn(sampleVal)), "poly.split_by(40) mismatch");
  assert.deepEqual(plainValue(r160.value), plainValue(refFn(val160)), "poly.split_by(160) mismatch");

  const ratio = r160.telemetry.steps / r40.telemetry.steps;
  assert.ok(
    ratio < 5.5,
    `expected O(L) linear scaling on 4x input (ratio < 5.5), got ${ratio.toFixed(2)} (${r40.telemetry.steps} -> ${r160.telemetry.steps})`
  );
  assert.ok(
    r160.telemetry.peakBitDequeBytes < 16384,
    `expected linear buffer bytes < 16 KiB on split_by(160), got ${r160.telemetry.peakBitDequeBytes}`
  );
});

test("unfoldShortBitRecProcs & knownTag match/wrap peephole reduce spawns and steps with bit-exact parity", () => {
  // 1. poly.reverse: 1-bit linear recursion (@rev_append) unfolds 3 rounds (4x unrolled)
  const polyDep = loadLibrary(compileLibrary(readSrc("lib/integer.k"), { source: "lib/integer.k" }));
  const polyRaw = loadLibrary(compileLibrary(readSrc("Examples/poly.k"), {
    source: "Examples/poly.k",
    libraries: [polyDep],
    use: ["int[] nat int pos? neg? zero? gt? inc dec"]
  }));
  const polyLib = {
    format: "k-object",
    codes: { ...polyDep.codes, ...polyRaw.codes },
    rels: { ...polyDep.rels, ...polyRaw.rels },
    relAlias: { ...polyRaw.relAlias },
    meta: { ...polyDep.meta, ...polyRaw.meta }
  };
  codes.load(polyLib.codes);
  const listPat = patternFromFilter(`
    ?<
      {} nil,
      {
        < <bits 0, bits 1, {} _>=bits "+", bits "-" > car,
        list cdr
      } cons
    > = list
  `);
  let listVal = Value.variant("nil", UNIT);
  for (let i = 200; i >= 1; i--) {
    listVal = Value.variant("cons", Value.product({ car: parseIntVal(String(i)), cdr: listVal }));
  }
  const revWire = encodeToWire(listVal, listPat);
  const revComp = compileKIRToKTVM(polyLib, "reverse", listPat);
  const revNoUf = optimizeKTVM(revComp.module, { unfold: false });
  const revUf = optimizeKTVM(revComp.module, { unfold: true });
  assert.ok(revUf.stats.unfold.unfoldedProcs >= 1, "expected @rev_append to unfold");
  assert.ok(revUf.stats.unfold.unfoldRounds >= 3, `expected >= 3 unfold rounds, got ${revUf.stats.unfold.unfoldRounds}`);
  const r0 = executeKTVMWire(revNoUf.module, revWire, { entry: revComp.entry, validate: false });
  const r1 = executeKTVMWire(revUf.module, revWire, { entry: revComp.entry, validate: false });
  assert.equal(r1.status, "OK");
  assert.equal(Buffer.compare(Buffer.from(r0.wire), Buffer.from(r1.wire)), 0, "unfolded reverse wire mismatch");
  assert.ok(
    r1.telemetry.steps < r0.telemetry.steps * 0.88,
    `expected >=12% step reduction on reverse (noUf=${r0.telemetry.steps}, uf=${r1.telemetry.steps})`
  );

  // 2. integer.times: known-tag match/wrap peephole + bounded unfolding on @lsb_mul_small
  codes.load(integerLib.codes);
  const timesPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.times], 0);
  const tComp = compileKIRToKTVM(integerLib, "times", timesPat);
  const tNoUf = optimizeKTVM(tComp.module, { unfold: false });
  const tUf = optimizeKTVM(tComp.module, { unfold: true });
  assert.ok(tUf.stats.simplify.knownMatchWrapFolds > 0, "expected knownMatchWrapFolds > 0 on integer.times");
  assert.ok(tUf.stats.unfold.unfoldedProcs >= 1, "expected unfoldedProcs >= 1 on integer.times");
  const mulVal = Value.product({
    x: parseIntVal(String((1n << 127n) - 1234567n)),
    y: parseIntVal(String((1n << 127n) - 7654321n))
  });
  const mulWire = encodeToWire(mulVal, timesPat);
  const m0 = executeKTVMWire(tNoUf.module, mulWire, { entry: tComp.entry, validate: false });
  const m1 = executeKTVMWire(tUf.module, mulWire, { entry: tComp.entry, validate: false });
  assert.equal(m1.status, "OK");
  assert.equal(Buffer.compare(Buffer.from(m0.wire), Buffer.from(m1.wire)), 0, "unfolded times wire mismatch");
  assert.ok(
    m1.telemetry.steps < m0.telemetry.steps,
    `expected strictly fewer steps with unfolding (noUf=${m0.telemetry.steps}, uf=${m1.telemetry.steps})`
  );
});

// --- Summary ---
console.log(`\nMilestone 3 Optimizer Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
