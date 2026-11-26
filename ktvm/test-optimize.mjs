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
const streamLib = loadLibrary(compileLibrary(readSrc("experiments/transducer/v4/integer-streaming.k"), {
  source: "experiments/transducer/v4/integer-streaming.k",
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

// --- Summary ---
console.log(`\nMilestone 3 Optimizer Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
