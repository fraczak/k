#!/usr/bin/env node

/**
 * Tail-Modulo-Constructor (TMC) & Direct Natural Karatsuba Conformance + A/B Benchmark Suite.
 *
 * Compares `lib/integer.k` (strict tail recursion + manual `_k_stack[]` continuation stack)
 * against `experiments/transducer/v4/integer-streaming.k` (TMC guarded streaming loops +
 * direct 3-way Karatsuba without `_k_stack[]`) on the strict `k-wire` V4 bit-chunk runtime.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import k from "../../../index.mjs";
import { Value } from "../../../Value.mjs";
import { compileLibrary, loadLibrary } from "../../../object.mjs";
import { parseIntStr, print as printInt } from "../../../codecs/int.mjs";
import {
  encodeToWire,
  decodeLazyNode,
  fastSkipSubtree,
  readBitsAt,
  propertyListToPattern,
  CORE_PATTERN_PROPERTY_LIST
} from "../../../codecs/runtime/prefix-codec.mjs";

import { BlueprintRegistryV2 } from "../v2/blueprint.mjs";
import { TransducerCompilerV3 } from "../v3/fsm-compiler.mjs";
import { CompiledTransducerNetworkV3 } from "../v3/network-v3.mjs";
import { serializeValue, deserializeTokens } from "../v2/wires.mjs";
import { BitCodec } from "./bit-codec.mjs";
import { BitChunkCompilerV4 } from "./bit-chunk-compiler.mjs";
import { BitPackedTransducerNetworkV4 } from "./network-v4.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

const origSrc = fs.readFileSync(path.join(root, "lib/integer.k"), "utf8");
const strmSrc = fs.readFileSync(path.join(__dirname, "integer-streaming.k"), "utf8");

const origLib = loadLibrary(compileLibrary(origSrc, { source: "lib/integer.k" }));
const strmLib = loadLibrary(compileLibrary(strmSrc, { source: "integer-streaming.k" }));

const codec = new BitCodec();

function makeRunner(lib) {
  const reg = new BlueprintRegistryV2(lib);
  const compV3 = new TransducerCompilerV3(reg);
  const chunk = new BitChunkCompilerV4(compV3, codec);
  const runV4 = (name, val, opts = {}) => {
    const hash = lib.relAlias[name];
    const t0 = performance.now();
    const net = new BitPackedTransducerNetworkV4(reg, {
      codec,
      compilerV3: compV3,
      chunkCompiler: chunk,
      ...opts
    });
    const res = net.runValue(hash, val);
    return { ...res, ms: performance.now() - t0 };
  };
  const runV3 = (name, val) => {
    const hash = lib.relAlias[name];
    const bp = reg.getBlueprint(hash);
    const inTokens = serializeValue(val, bp.inPlist);
    const net = new CompiledTransducerNetworkV3(reg, { compiler: compV3 });
    const res = net.run(hash, inTokens);
    if (!res.ok) return { ok: false, value: undefined };
    return { ok: true, value: deserializeTokens(res.tokens, bp.outPlist) };
  };
  return { reg, compV3, chunk, runV4, runV3 };
}

const origR = makeRunner(origLib);
const strmR = makeRunner(strmLib);

function bitsFromStr(str) {
  let v = Value.variant("_", Value.product({}));
  for (let i = str.length - 1; i >= 0; i--) v = Value.variant(str[i], v);
  return v;
}

function stripVal(v) {
  if (v === undefined) return undefined;
  if (v.type === "{}") {
    const o = {};
    for (const key of Object.keys(v.product).sort()) o[key] = stripVal(v.product[key]);
    return { t: "{}", p: o };
  }
  return { t: "<>", tag: v.tag, v: stripVal(v.value) };
}

// === 1. Regression checks for the 3 latent V3/V4 bugs ===
console.log("=== 1. Latent V3/V4 Bug-Fix Verification ===");
for (const [s, okExp] of [["", true], ["0", true], ["1", true], ["00", false], ["10", false], ["101", false]]) {
  const r = origR.runV4("_le1_bit?", bitsFromStr(s));
  assert.equal(r.ok, okExp, `standalone _le1_bit?("${s}") ok`);
  if (okExp) assert.deepEqual(stripVal(r.value), stripVal(bitsFromStr(s)));
}
console.log("  1a. Standalone `_le1_bit?` (product shared-port PEEK vs SHIFT): ok");

// === 2. TMC Compilation & Bit-Chunk Catalog ===
console.log("\n=== 2. TMC Compilation & Bit-Chunk Catalog (`integer-streaming.k`) ===");
const catalogNames = [
  "_lsb_shl_nz", "_lsb_add", "half_max_tally", "_lsb_split_raw", "_lsb_trim",
  "trim_bits", "_rev_bits", "_cmp_msb", "_lsb_sub",
  "_nat_divmod", "lsb_mul"
];
for (const name of catalogNames) {
  const h = strmLib.relAlias[name];
  const c = strmR.compV3.getCompiled(h);
  const ch = c ? strmR.chunk.getChunkTable(h) : null;
  const br = strmR.reg.isBranchingRecursive(h);
  const evBase = c ? strmR.chunk.evaluateThroughput(c, null) : null;
  const evCh = ch ? strmR.chunk.evaluateThroughput(c, ch) : null;
  const wDesc = ch
    ? (ch.kind === "loop"
      ? (ch.arity === 2 ? `${ch.W_raw0}bx${ch.W_raw1}b` : `${ch.W_raw0}b`)
      : (ch.kind === "stack-loop" ? `${ch.W_raw0}b/${ch.W_flush}b` : `${ch.W_raw0}b`))
    : "—";
  const kindStr = c ? (c.isLoop ? (c.hasTmcEmit ? "TMC_LOOP" : "TAIL_LOOP") : "FSM") : "JIT";
  const rhoStr = evBase
    ? `${evBase.rhoStream.toFixed(1)} -> ${evCh ? evCh.rhoStream.toFixed(1) : evBase.rhoStream.toFixed(1)} b/rd`
    : "—";
  console.log(
    `  ${name.padEnd(16)} ${kindStr.padEnd(9)} chunk=${wDesc.padEnd(9)} tmcChunk=${String(Boolean(ch?.isTmc)).padEnd(5)} branchRec=${String(br).padEnd(5)} rho*=${rhoStr}`
  );
}
assert.equal(strmR.chunk.getChunkTable(strmLib.relAlias["_lsb_shl_nz"])?.isTmc, true);
assert.equal(strmR.chunk.getChunkTable(strmLib.relAlias["_lsb_add"])?.isTmc, true);
assert.equal(strmR.chunk.getChunkTable(strmLib.relAlias["half_max_tally"])?.isTmc, true);
assert.equal(strmR.chunk.getChunkTable(strmLib.relAlias["_lsb_split_raw"])?.isTmc, true);
assert.equal(strmR.chunk.getChunkTable(strmLib.relAlias["_lsb_trim"])?.kind, "stack-loop");
assert.equal(strmR.chunk.getChunkTable(strmLib.relAlias["_lsb_trim"])?.isTmc, true);
assert.equal(strmR.reg.isBranchingRecursive(strmLib.relAlias["lsb_mul"]), true);
assert.equal(strmR.reg.isBranchingRecursive(strmLib.relAlias["_nat_divmod"]), false);

// === 3. Full Conformance (V3 + V4 + k.compile + Bit-Exact k-wire) ===
console.log("\n=== 3. Full Conformance (V3, V4, k.compile, and bit-exact k-wire) ===");
const CORE_PAT = propertyListToPattern(CORE_PATTERN_PROPERTY_LIST);
function verifyKWire(label, plist, val, outBytes, outBits) {
  const pat = propertyListToPattern(plist);
  const officialWire = encodeToWire(val, plist);
  const startBit = fastSkipSubtree(officialWire, 0, CORE_PAT, 0);
  const endBit = fastSkipSubtree(officialWire, startBit, pat, 0);
  assert.equal(outBits, endBit - startBit, `k-wire bit length mismatch on ${label}`);
  for (let i = 0; i < outBits; i++) {
    assert.equal(readBitsAt(outBytes, i, 1), readBitsAt(officialWire, startBit + i, 1), `k-wire bit ${i} on ${label}`);
  }
  const decoded = decodeLazyNode(Buffer.from(outBytes), 0, pat, 0);
  assert.deepEqual(stripVal(decoded), stripVal(val), `decodeLazyNode mismatch on ${label}`);
}

for (const s of [
  "", "0", "0000", "1", "10", "1000", "001", "00100", "101001000", "01010101",
  "0".repeat(20) + "1" + "0".repeat(15),
  "0".repeat(40),
  "1".repeat(40),
  "0".repeat(30) + "1" + "0".repeat(25) + "1" + "0".repeat(19),
  "100000100000100000",
  "01".repeat(50) + "0"
]) {
  const inp = bitsFromStr(s);
  const exp = k.compile(origLib.relAlias["lsb_trim"], { libraries: [origLib] })(inp);
  const rs4 = strmR.runV4("lsb_trim", inp);
  const rs3 = strmR.runV3("lsb_trim", inp);
  assert.equal(rs4.ok, true);
  assert.equal(rs3.ok, true);
  assert.deepEqual(stripVal(rs4.value), stripVal(exp), `V4 lsb_trim(${s})`);
  assert.deepEqual(stripVal(rs3.value), stripVal(exp), `V3 lsb_trim(${s})`);
}
for (const [x, y] of [
  ["", ""], ["1", ""], ["", "1"], ["1011", "101"], ["101", "101"], ["101", "1011"],
  ["0000001", "1"], ["111111111111", "1"], ["000000000001", "11111111111"],
  ["1", "111111111111"], ["010101011", "101010101"]
]) {
  const inp = Value.product({ x: bitsFromStr(x), y: bitsFromStr(y) });
  for (const fn of ["lsb_add", "half_max_tally"]) {
    const exp = k.compile(origLib.relAlias[fn], { libraries: [origLib] })(inp);
    const rs4 = strmR.runV4(fn, inp);
    const rs3 = strmR.runV3(fn, inp);
    assert.equal(rs4.ok, true);
    assert.equal(rs3.ok, true);
    assert.deepEqual(stripVal(rs4.value), stripVal(exp), `V4 ${fn}(${x},${y})`);
    assert.deepEqual(stripVal(rs3.value), stripVal(exp), `V3 ${fn}(${x},${y})`);
  }
}
for (const [x, kStr] of [
  ["110101", "000"], ["101", "00000"], ["", "00"], ["10110011", ""],
  ["000001", "000"], ["100001", "000"], ["001001", "0000"], ["00001", "00000"],
  ["101101011010101", "0".repeat(12)], ["", "0".repeat(10)]
]) {
  const inp = Value.product({ x: bitsFromStr(x), k: bitsFromStr(kStr) });
  for (const fn of ["lsb_split", "lsb_shl"]) {
    const exp = k.compile(origLib.relAlias[fn], { libraries: [origLib] })(inp);
    const rs4 = strmR.runV4(fn, inp);
    const rs3 = strmR.runV3(fn, inp);
    assert.equal(rs4.ok, true);
    assert.equal(rs3.ok, true);
    assert.deepEqual(stripVal(rs4.value), stripVal(exp), `V4 ${fn}(${x}@${kStr.length})`);
    assert.deepEqual(stripVal(rs3.value), stripVal(exp), `V3 ${fn}(${x}@${kStr.length})`);
  }
}
const intPairs = [
  [0n, 0n], [0n, 7n], [7n, 0n], [13n, 5n], [-13n, 5n], [13n, -5n], [-13n, -5n],
  [5n, 13n], [13n, 13n], [-13n, 13n], [42n, 6n], [256n, 16n], [255n, 16n],
  [1000n, 37n], [12345n, 97n], [-12345n, -97n],
  [(1n << 16n) - 1n, (1n << 16n) - 1n], [(1n << 16n) + 1n, (1n << 16n) + 3n],
  [(1n << 17n) + 5n, (1n << 18n) - 7n], [1000003n, -999983n],
  [1n << 40n, (1n << 40n) - 1n]
];
for (const [x, y] of intPairs) {
  const inp = Value.product({ x: parseIntStr(x.toString()), y: parseIntStr(y.toString()) });
  for (const fn of ["plus", "minus", "divmod", "div", "mod", "times"]) {
    const ro = origR.runV4(fn, inp);
    const rs = strmR.runV4(fn, inp);
    assert.equal(rs.ok, ro.ok, `${fn}(${x},${y}) ok`);
    if (ro.ok) {
      assert.deepEqual(stripVal(rs.value), stripVal(ro.value), `${fn}(${x},${y})`);
      if ((x === 1000003n && y === -999983n) || (x === 12345n && y === 97n)) {
        verifyKWire(`${fn}(${x},${y})`, strmR.reg.getBlueprint(strmLib.relAlias[fn]).outPlist, rs.value, rs.outBytes, rs.outBits);
      }
    }
  }
}
for (const [x, y] of [[48n, 18n], [1071n, 462n], [123456n, 7890n], [0n, 15n]]) {
  const inp = Value.product({ x: parseIntStr(x.toString()), y: parseIntStr(y.toString()) });
  for (const fn of ["gcd", "lcm"]) {
    const ro = origR.runV4(fn, inp);
    const rs = strmR.runV4(fn, inp);
    assert.equal(rs.ok, ro.ok);
    assert.deepEqual(stripVal(rs.value), stripVal(ro.value));
  }
}
console.log("  All V3, V4, k.compile, and bit-exact k-wire conformance checks passed: ok");

// Warm up V8
for (let i = 0; i < 3; i++) {
  const wIn = Value.product({ x: parseIntStr("1000003"), y: parseIntStr("999983") });
  origR.runV4("times", wIn);
  strmR.runV4("times", wIn);
  origR.runV4("mod", wIn);
  strmR.runV4("mod", wIn);
}

// === 4. Individual Relations A/B Benchmark ===
console.log("\n=== 4. Streaming Relations A/B Benchmark (`lib/integer.k` vs `integer-streaming.k`) ===");
const microCases = [
  ["lsb_add(512b)", "lsb_add", Value.product({ x: bitsFromStr("10".repeat(255) + "1"), y: bitsFromStr("01".repeat(255) + "1") })],
  ["lsb_add(512b+8b)", "lsb_add", Value.product({ x: bitsFromStr("10".repeat(255) + "1"), y: bitsFromStr("10101011") })],
  ["lsb_shl(512b<<256)", "lsb_shl", Value.product({ x: bitsFromStr("10".repeat(255) + "1"), k: bitsFromStr("0".repeat(256)) })],
  ["half_max_tally(512b)", "half_max_tally", Value.product({ x: bitsFromStr("10".repeat(255) + "1"), y: bitsFromStr("01".repeat(255) + "1") })],
  ["lsb_split(512b@256)", "lsb_split", Value.product({ x: bitsFromStr("10".repeat(255) + "1"), k: bitsFromStr("0".repeat(256)) })],
  ["lsb_trim(512b)", "lsb_trim", bitsFromStr("1010".repeat(100) + "0".repeat(112))],
  ["divmod(256b)", "divmod", Value.product({ x: parseIntStr(String(10n ** 76n)), y: parseIntStr(String(10n ** 38n + 7n)) })],
  ["divmod(512b)", "divmod", Value.product({ x: parseIntStr(String(10n ** 153n)), y: parseIntStr(String(10n ** 76n + 19n)) })],
  ["mod(512b)", "mod", Value.product({ x: parseIntStr(String(10n ** 153n)), y: parseIntStr(String(10n ** 76n + 19n)) })],
  ["plus(512b)", "plus", Value.product({ x: parseIntStr(String(10n ** 153n + 7n)), y: parseIntStr(String(10n ** 153n + 13n)) })]
];
for (const [label, fn, inp] of microCases) {
  const ro = origR.runV4(fn, inp);
  const rs = strmR.runV4(fn, inp);
  assert.equal(rs.ok, true);
  assert.deepEqual(stripVal(rs.value), stripVal(ro.value));
  const to = ro.telemetry, ts = rs.telemetry;
  console.log(
    `  ${label.padEnd(21)} | ORIG: ${ro.ms.toFixed(2).padStart(6)}ms, ${String(to.totalBitsTransferred).padStart(7)}b, ${String(Math.ceil(to.peakFifoBits / 8)).padStart(4)}B, ${String(to.peakActiveNodes).padStart(2)}n` +
    ` | TMC: ${rs.ms.toFixed(2).padStart(6)}ms, ${String(ts.totalBitsTransferred).padStart(7)}b (${(ts.totalBitsTransferred / to.totalBitsTransferred).toFixed(2)}x), ${String(Math.ceil(ts.peakFifoBits / 8)).padStart(4)}B, ${String(ts.peakActiveNodes).padStart(2)}n`
  );
}

// === 5. Karatsuba `times` Scaling (16b to 2048b = 4,096-bit product) ===
console.log("\n=== 5. Karatsuba `times` Scaling: ORIG(_k_stack) vs NAT(noSeq) vs NAT(TMC+seq) ===");
const mulCases = [
  ["16b   L0", 65521n, 65519n],
  ["32b   L1", 3000000000n, 2147483647n],
  ["64b   L2", 10000000000000000003n, 9876543210987654321n],
  ["128b  L3", 10n ** 38n + 7n, 10n ** 38n + 9n],
  ["256b  L4", 10n ** 76n + 13n, 10n ** 76n + 17n],
  ["512b  L5", 10n ** 153n + 19n, 10n ** 153n + 23n],
  ["1024b L6", 10n ** 307n + 29n, 10n ** 307n + 31n],
  ["2048b L7", 10n ** 615n + 37n, 10n ** 615n + 41n]
];
let prevOrigBits = null;
let prevNatBits = null;
for (const [label, x, y] of mulCases) {
  const inp = Value.product({ x: parseIntStr(x.toString()), y: parseIntStr(y.toString()) });
  const exp = String(x * y);
  const ro = origR.runV4("times", inp);
  const rn = strmR.runV4("times", inp, { sequentialBranchingStubs: false });
  const rs = strmR.runV4("times", inp, { sequentialBranchingStubs: true });
  assert.equal(printInt(ro.value), exp);
  assert.equal(printInt(rn.value), exp);
  assert.equal(printInt(rs.value), exp);
  const to = ro.telemetry, tn = rn.telemetry, ts = rs.telemetry;
  const isPow = !label.startsWith("16b");
  const natRatio = isPow && prevNatBits ? `${(ts.totalBitsTransferred / prevNatBits).toFixed(2)}x` : "  —  ";
  if (isPow) {
    prevOrigBits = to.totalBitsTransferred;
    prevNatBits = ts.totalBitsTransferred;
  }
  console.log(
    `  ${label} | ORIG(stack): ${ro.ms.toFixed(1).padStart(6)}ms, ${String(to.totalBitsTransferred).padStart(8)}b, ${String(to.peakActiveNodes).padStart(3)}n, ${String(Math.ceil(to.peakFifoBits / 8)).padStart(5)}B` +
    ` | NAT(noSeq): ${rn.ms.toFixed(1).padStart(6)}ms, ${String(tn.peakActiveNodes).padStart(4)}n, ${String(Math.ceil(tn.peakFifoBits / 8)).padStart(5)}B` +
    ` | NAT(TMC+seq): ${rs.ms.toFixed(1).padStart(6)}ms (${(ro.ms / rs.ms).toFixed(2)}x), ${String(ts.totalBitsTransferred).padStart(8)}b (${(ts.totalBitsTransferred / to.totalBitsTransferred).toFixed(2)}x, dbl=${natRatio}), ${String(ts.peakActiveNodes).padStart(3)}n, ${String(Math.ceil(ts.peakFifoBits / 8)).padStart(5)}B`
  );
}
console.log("\nAll TMC & Natural Karatsuba tests and benchmarks passed!");
