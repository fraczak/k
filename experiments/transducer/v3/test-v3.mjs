#!/usr/bin/env node

/**
 * Iteration 3 Conformance Suite, Multi-Generation Benchmark (V1 vs V2 vs V3),
 * Synthesized FSM/Loop Mermaid Gallery, and Report Generator
 * (`experiments/transducer/v3/REPORT.md`).
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

import { BlueprintRegistry as BlueprintRegistryV1 } from "../blueprint.mjs";
import { TransducerNetwork as NetworkV1 } from "../network.mjs";

import { serializeValue, deserializeTokens } from "../v2/wires.mjs";
import { BlueprintRegistryV2 } from "../v2/blueprint.mjs";
import { MultiPortTransducerNetwork } from "../v2/network.mjs";

import { TransducerCompilerV3 } from "./fsm-compiler.mjs";
import { CompiledTransducerNetworkV3 } from "./network-v3.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

const intSource = fs.readFileSync(path.join(root, "lib/integer.k"), "utf8");
const lib = loadLibrary(compileLibrary(intSource, { source: "lib/integer.k" }));

const regV1 = new BlueprintRegistryV1(lib);
const regV2 = new BlueprintRegistryV2(lib);
const compiler = new TransducerCompilerV3(regV2);

const oracle = (name, val) =>
  k.compile(lib.relAlias[name], { libraries: [lib] })(val);

function bitsFromStr(str) {
  let v = Value.variant("_", Value.product({}));
  for (let i = str.length - 1; i >= 0; i--) {
    v = Value.variant(str[i], v);
  }
  return v;
}

function runV1(relName, inputVal) {
  const hash = lib.relAlias[relName];
  const bp = regV1.getBlueprint(hash);
  const inTokens = serializeValue(inputVal, bp.inPlist);
  const t0 = performance.now();
  const net = new NetworkV1(regV1);
  const res = net.run(hash, inTokens);
  return { ...res, ms: performance.now() - t0 };
}

function runV2(relName, inputVal, opts = {}) {
  const hash = lib.relAlias[relName];
  const bp = regV2.getBlueprint(hash);
  const inTokens = serializeValue(inputVal, bp.inPlist);
  const t0 = performance.now();
  const net = new MultiPortTransducerNetwork(regV2, opts);
  const res = net.run(hash, inTokens);
  const ms = performance.now() - t0;
  if (!res.ok) return { ok: false, value: undefined, outTokens: null, telemetry: res.telemetry, ms };
  return { ok: true, value: deserializeTokens(res.tokens, bp.outPlist), outTokens: res.tokens, telemetry: res.telemetry, ms };
}

function runV3(relName, inputVal, opts = {}) {
  const hash = lib.relAlias[relName];
  const bp = regV2.getBlueprint(hash);
  const inTokens = serializeValue(inputVal, bp.inPlist);
  const t0 = performance.now();
  const net = new CompiledTransducerNetworkV3(regV2, { compiler, ...opts });
  const res = net.run(hash, inTokens);
  const ms = performance.now() - t0;
  if (!res.ok) return { ok: false, value: undefined, outTokens: null, telemetry: res.telemetry, ms };
  return { ok: true, value: deserializeTokens(res.tokens, bp.outPlist), outTokens: res.tokens, telemetry: res.telemetry, ms };
}

function checkV3(relName, inputVal, label) {
  const hash = lib.relAlias[relName];
  const bp = regV2.getBlueprint(hash);
  const expected = oracle(relName, inputVal);
  const actual = runV3(relName, inputVal);
  if (expected === undefined) {
    assert.equal(actual.ok, false, `V3 ${relName}(${label}): expected failure`);
  } else {
    assert.equal(actual.ok, true, `V3 ${relName}(${label}): unexpected failure`);
    assert.deepEqual(
      actual.outTokens,
      serializeValue(expected, bp.outPlist),
      `V3 ${relName}(${label}): token stream mismatch`
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual.value)),
      JSON.parse(JSON.stringify(expected)),
      `V3 ${relName}(${label}): value mismatch`
    );
  }
  return actual;
}

// === 1. Compile catalog across entire lib/integer.k ===
console.log("=== 1. Static Auto-Compilation Catalog (lib/integer.k) ===");
const tComp0 = performance.now();
const catalog = [];
for (const [alias, hash] of Object.entries(lib.relAlias)) {
  if (!lib.rels[hash]) continue;
  const c = compiler.getCompiled(hash);
  if (c) {
    catalog.push({
      alias,
      kind: c.isLoop ? "LOOP" : "FSM",
      nodes: c.nodeCount,
      inCount: c.inCount,
      outCount: c.outCount,
      total: !c.hasFail,
      regs: c.registerPorts.map((p) => c.inLeaves[p].pathKey || `p${p}`)
    });
  }
}
const compileMs = performance.now() - tComp0;
console.log(`  Compiled ${compiler.stats.compiledFSMs} FSMs + ${compiler.stats.compiledLoops} Loops (${compiler.stats.fallbackJIT} stay JIT STUBs) in ${compileMs.toFixed(1)} ms`);

// === 2. Full Conformance Suite (mod, divmod, plus, minus, cmp, gcd, times/Karatsuba) ===
console.log("=== 2. Conformance Suite (V3 vs k.compile oracle) ===");
for (const s of ["", "0", "0000", "1", "000101", "1101", "0".repeat(20) + "1011"]) {
  checkV3("trim_bits", bitsFromStr(s), s);
  checkV3("rev_bits", bitsFromStr(s), s);
}
for (const [x, y] of [["", ""], ["1011", "101"], ["101", "101"], ["101", "1011"], ["0000001", "1"]]) {
  checkV3("lsb_try_sub", Value.product({ x: bitsFromStr(x), y: bitsFromStr(y) }), `${x}-${y}`);
  checkV3("lsb_add", Value.product({ x: bitsFromStr(x), y: bitsFromStr(y) }), `${x}+${y}`);
  checkV3("half_max_tally", Value.product({ x: bitsFromStr(x), y: bitsFromStr(y) }), `${x},${y}`);
}
for (const [x, kStr] of [["110101", "000"], ["101", "00000"], ["", "00"], ["10110011", ""]]) {
  checkV3("lsb_split", Value.product({ x: bitsFromStr(x), k: bitsFromStr(kStr) }), `${x}@${kStr.length}`);
}

const intPairs = [
  [0n, 0n], [0n, 7n], [7n, 0n], [13n, 5n], [-13n, 5n], [13n, -5n], [-13n, -5n],
  [5n, 13n], [13n, 13n], [-13n, 13n], [42n, 6n], [-42n, 6n], [256n, 16n], [255n, 16n],
  [1000n, 37n], [-1000n, 37n], [12345n, 97n], [-12345n, -97n],
  [(1n << 16n) - 1n, (1n << 16n) - 1n],
  [(1n << 16n) + 1n, (1n << 16n) + 3n],
  [-(10n ** 19n + 3n), 19n],
  [1000003n, -999983n]
];
for (const [x, y] of intPairs) {
  const input = Value.product({ x: parseIntStr(x.toString()), y: parseIntStr(y.toString()) });
  checkV3("cmp", input, `${x},${y}`);
  checkV3("plus", input, `${x}+${y}`);
  checkV3("minus", input, `${x}-${y}`);
  checkV3("divmod", input, `${x}/${y}`);
  checkV3("mod", input, `${x}%${y}`);
  checkV3("times", input, `${x}*${y}`);
}
for (const [x, y] of [[48n, 18n], [1071n, 462n], [123456n, 7890n], [0n, 15n]]) {
  checkV3("gcd", Value.product({ x: parseIntStr(x.toString()), y: parseIntStr(y.toString()) }), `gcd(${x},${y})`);
}
console.log("  All conformance checks (trim_bits, rev_bits, lsb_try_sub, lsb_add, half_max_tally, lsb_split, cmp, plus, minus, divmod, mod, times, gcd): ok");

// === 3. Head-to-Head rev_bits (V1 vs V2 vs V3) ===
console.log("\n=== 3. Head-to-Head: rev_bits (V1 vs V2 vs V3) ===");
const revRows = [];
for (const len of [4, 8, 16, 32, 64]) {
  const s = "1" + "01".repeat((len - 1) >> 1) + (len % 2 === 0 ? "1" : "");
  const val = bitsFromStr(s);
  const r1 = runV1("rev_bits", val);
  const r2 = runV2("rev_bits", val);
  const r3 = runV3("rev_bits", val);
  assert.deepEqual(r3.outTokens, r1.tokens);
  revRows.push({ len, r1, r2, r3 });
  console.log(
    `  rev_bits(${String(len).padStart(2)}b): V1=${String(r1.telemetry.totalTokensTransferred).padStart(6)}t -> V2=${String(r2.telemetry.totalTokensTransferred).padStart(4)}t (${r2.telemetry.stubsExpanded} stubs) -> V3=${String(r3.telemetry.totalTokensTransferred).padStart(4)}t (${r3.telemetry.stubsExpanded} stubs, ${r3.telemetry.peakActiveNodes} peakNodes, ${r3.telemetry.compiledLoopIterations} iters)`
  );
}

// === 4. Head-to-Head mod (V1 vs V2 vs V3, up to 512-bit!) ===
console.log("\n=== 4. Head-to-Head: mod (V1 vs V2 vs V3, 4-bit to 512-bit!) ===");
const modCases = [
  { label: "4-bit: mod(13, 5)", x: 13n, y: 5n, runV1: true, runV2: true },
  { label: "8-bit: mod(219, 13)", x: 219n, y: 13n, runV1: true, runV2: true },
  { label: "16-bit: mod(50000, 97)", x: 50000n, y: 97n, runV1: true, runV2: true },
  { label: "32-bit: mod(3e9, 65521)", x: 3000000000n, y: 65521n, runV1: true, runV2: true },
  { label: "64-bit: mod(10^19, 10^9+7)", x: 10000000000000000000n, y: 1000000007n, runV1: false, runV2: true },
  { label: "128-bit: mod(10^38, 10^18+3)", x: 10n ** 38n, y: 10n ** 18n + 3n, runV1: false, runV2: true },
  { label: "256-bit: mod(10^76, 10^38+7)", x: 10n ** 76n, y: 10n ** 38n + 7n, runV1: false, runV2: true },
  { label: "512-bit: mod(10^153, 10^76+19)", x: 10n ** 153n, y: 10n ** 76n + 19n, runV1: false, runV2: false }
];
const modRows = [];
for (const sc of modCases) {
  const input = Value.product({ x: parseIntStr(sc.x.toString()), y: parseIntStr(sc.y.toString()) });
  const r3 = runV3("mod", input);
  assert.equal(r3.ok, true);
  assert.equal(printInt(r3.value), String(sc.x % sc.y));
  const r2 = sc.runV2 ? runV2("mod", input) : null;
  if (r2) assert.deepEqual(r3.outTokens, r2.outTokens);
  const r1 = sc.runV1 ? runV1("mod", input) : null;
  if (r1) assert.deepEqual(r3.outTokens, r1.tokens);
  modRows.push({ ...sc, result: String(sc.x % sc.y), r1, r2, r3 });
  const v2Str = r2
    ? `V2=${String(r2.telemetry.totalTokensTransferred).padStart(6)}t/${String(r2.telemetry.stubsExpanded).padStart(6)}st/${r2.ms.toFixed(0).padStart(4)}ms`
    : "V2=(skipped)                ";
  console.log(
    `  ${sc.label.padEnd(32)} ${v2Str} -> V3=${String(r3.telemetry.totalTokensTransferred).padStart(6)}t/${String(r3.telemetry.stubsExpanded).padStart(4)}st/peak=${r3.telemetry.peakActiveNodes}/${r3.ms.toFixed(1)}ms`
  );
}

// === 5. Head-to-Head Karatsuba times (V2 vs V3, 4-bit to 1024-bit!) ===
console.log("\n=== 5. Head-to-Head: Karatsuba times (V2 vs V3, 4-bit to 1024-bit!) ===");
const mulCases = [
  { label: "4-bit (schoolbook)", depth: 0, x: 13n, y: 11n, runV2: true },
  { label: "16-bit (schoolbook)", depth: 0, x: 65521n, y: 65519n, runV2: true },
  { label: "20-bit (Karatsuba L1)", depth: 1, x: 1000003n, y: 999983n, runV2: true },
  { label: "32-bit (Karatsuba L1)", depth: 1, x: 3000000000n, y: 2147483647n, runV2: true },
  { label: "64-bit (Karatsuba L2)", depth: 2, x: 10000000000000000003n, y: 9876543210987654321n, runV2: true },
  { label: "128-bit (Karatsuba L3)", depth: 3, x: 10n ** 38n + 7n, y: 10n ** 38n + 9n, runV2: true },
  { label: "256-bit (Karatsuba L4)", depth: 4, x: 10n ** 76n + 13n, y: 10n ** 76n + 17n, runV2: true },
  { label: "512-bit (Karatsuba L5)", depth: 5, x: 10n ** 153n + 19n, y: 10n ** 153n + 23n, runV2: true },
  { label: "1024-bit (Karatsuba L6)", depth: 6, x: 10n ** 307n + 29n, y: 10n ** 307n + 31n, runV2: false }
];
const mulRows = [];
for (const sc of mulCases) {
  const input = Value.product({ x: parseIntStr(sc.x.toString()), y: parseIntStr(sc.y.toString()) });
  const expected = String(sc.x * sc.y);
  const r3 = runV3("times", input);
  assert.equal(r3.ok, true);
  assert.equal(printInt(r3.value), expected);
  const r2 = sc.runV2 ? runV2("times", input) : null;
  if (r2) assert.deepEqual(r3.outTokens, r2.outTokens);
  mulRows.push({ ...sc, r2, r3 });
  const v2Str = r2
    ? `V2=${String(r2.telemetry.totalTokensTransferred).padStart(7)}t/${r2.telemetry.speculativeRollbacks}rb/${r2.ms.toFixed(0).padStart(4)}ms`
    : "V2=(skipped)                    ";
  console.log(
    `  ${sc.label.padEnd(25)} ${v2Str} -> V3=${String(r3.telemetry.totalTokensTransferred).padStart(7)}t/${r3.telemetry.speculativeRollbacks}rb/peak=${r3.telemetry.peakActiveNodes}/${r3.ms.toFixed(1)}ms`
  );
}

// === 6. Capture Live V3 Hybrid Network Mermaid Snapshots ===
const modSnaps = [];
{
  let subSeen = 0;
  let ndSeen = 0;
  const input = Value.product({ x: parseIntStr("13"), y: parseIntStr("5") });
  runV3("mod", input, {
    onSnapshot(ev, net) {
      let lbl = null;
      if (ev === "expand:_nat_divmod") {
        ndSeen++;
        if (ndSeen === 2) lbl = "expand:_nat_divmod (#2: compiled loop inputs)";
      } else if (ev === "expand:_lsb_sub") {
        subSeen++;
        if (subSeen === 1) lbl = "expand:_lsb_sub (#1: single LOOP(_lsb_sub)[b] node!)";
      } else if (ev === "done:mod") {
        lbl = "done:mod";
      }
      if (lbl) {
        modSnaps.push({
          label: lbl,
          activeNodes: net.nodes.size,
          liveFifos: net.fifos.size,
          stubsExpanded: net.telemetry.stubsExpanded,
          loopIters: net.telemetry.compiledLoopIterations,
          mermaid: net.toMermaid()
        });
      }
    }
  });
}

const mulSnaps = [];
{
  let clsSeen = 0;
  let hmtSeen = 0;
  let splSeen = 0;
  const input = Value.product({ x: parseIntStr("1000003"), y: parseIntStr("999983") });
  runV3("times", input, {
    onSnapshot(ev, net) {
      let lbl = null;
      if (ev === "expand:_classify_bits") {
        clsSeen++;
        if (clsSeen === 1) lbl = "expand:_classify_bits (single FSM(_classify_bits) node!)";
      } else if (ev === "expand:_half_max_tally") {
        hmtSeen++;
        if (hmtSeen === 1) lbl = "expand:_half_max_tally (single 2-tok lookahead LOOP, 0 rollbacks!)";
      } else if (ev === "expand:_lsb_split") {
        splSeen++;
        if (splSeen === 1) lbl = "expand:_lsb_split (single in-place LOOP(_lsb_split) node!)";
      }
      if (lbl) {
        mulSnaps.push({
          label: lbl,
          activeNodes: net.nodes.size,
          liveFifos: net.fifos.size,
          stubsExpanded: net.telemetry.stubsExpanded,
          loopIters: net.telemetry.compiledLoopIterations,
          mermaid: net.toMermaid()
        });
      }
    }
  });
}

// === 7. Generate REPORT.md ===
function buildReport() {
  const lines = [];
  lines.push("# Iteration 3 Report: Static Transducer Compilation (FSM & In-Place Tail-Loop Synthesis)");
  lines.push("");
  lines.push("Iteration 3 (`k/experiments/transducer/v3/`) introduces a **general static symbolic compiler** ([fsm-compiler.mjs](file:///home/wojtek/gits/K/k/experiments/transducer/v3/fsm-compiler.mjs)) that compiles finite sub-relations (`COMPILED_FSM`) and self-recursive tail loops (`COMPILED_LOOP`) from Iteration 2 blueprints into explicit deterministic decision DAGs operating **strictly over abstract union-tag symbol streams** — keeping fixed- vs. variable-size bit-packing 100% orthogonal for Iteration 4.");
  lines.push("");

  lines.push("## 1. How Iteration 3 Fits Into the JIT Transducer Network");
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push('  AST["K AST + Closed Patterns"] --> BP["BlueprintRegistryV2 (usedPaths, leadingGuards, Moore min)"]');
  lines.push('  BP --> COMP{"TransducerCompilerV3 (CPS Symbolic Eval)"}');
  lines.push('  COMP -->|"Acyclic finite"| FSM[["COMPILED_FSM (1 node, 0 stubs)"]]:::compiled');
  lines.push('  COMP -->|"Self-recursive tail loop"| LOOP[["COMPILED_LOOP + in-register states"]]:::compiled');
  lines.push('  COMP -->|"Outer orchestrator (_nat_divmod, _lsb_mul)"| JIT[["JIT STUB (V2 multi-port network)"]]:::stub');
  lines.push('  FSM & LOOP & JIT -->|"Parallel TokenDeque streams (abstract symbols)"| NET["Hybrid Transducer Network"]');
  lines.push('  LOOP -.->|"Explicit Mealy DAGs -> ready for Iteration 4"| V4["Iteration 4: Variable-Size Symbol Lifting"]');
  lines.push("  classDef compiled fill:#ede9fe,color:#4c1d95,stroke:#7c3aed,stroke-width:2px");
  lines.push("  classDef stub fill:#1e1e2e,color:#cdd6f4,stroke:#f38ba8,stroke-width:2px");
  lines.push("```");
  lines.push("");
  lines.push("Key compiler properties (zero relation-specific hardcoding):");
  lines.push("1. **CPS Symbolic Execution (`symEval`)**: Evaluates `div`/`vid`/`dot`/`product`/`comp`/`multi-switch` and inlines finite helper `STUB`s (`_pop_lsb_bit`, `_full_sub_bit`, `_full_add_bit`, `_push_bit_acc`, `_drop16`, `_le1_bit?`) into one fused deterministic `PEEK`/`SHIFT` decision DAG.");
  lines.push("2. **Committed `SHIFT` + CPS-Continuation Memoization**: Keeps `peeks` empty on disjoint guarded switches, collapsing `_drop16` / `_classify_bits` from $2^{16}$ tree paths into **18–21 DAG states** in milliseconds.");
  lines.push("3. **In-Register Finite States**: Any loop port updated purely by closed constants across all loop leaves (`b` in `_lsb_sub`, `c` in `_lsb_add`) automatically stays inside the loop node's local register — **zero per-bit FIFO traffic**.");
  lines.push("4. **Provably Total Exit Continuations**: Exit branches calling provably total relations (`msb_drop_zeros`, `rev_bits`, `_rev_bits`) emit `cont` handoffs directly onto the live output wire and retire the loop node immediately.");
  lines.push("");

  lines.push(`## 2. Auto-Compilation Catalog for \`lib/integer.k\` (${catalog.length} relations compiled in ${compileMs.toFixed(1)} ms)`);
  lines.push("");
  lines.push("| Relation | Target | DAG States | In / Out Ports | Provably Total | In-Register State Ports |");
  lines.push("| --- | --- | ---: | :---: | :---: | --- |");
  for (const c of catalog) {
    lines.push(`| \`${c.alias}\` | **\`${c.kind}\`** | ${c.nodes} | ${c.inCount} / ${c.outCount} | ${c.total ? "✓" : "partial"} | ${c.regs.length ? c.regs.map((r) => `\`${r}\``).join(", ") : "—"} |`);
  }
  lines.push("");

  lines.push("## 3. Benchmark A: `rev_bits` (V1 vs. V2 vs. V3)");
  lines.push("");
  lines.push("| Bits(n) | V1 Tokens | V2 Tokens | **V3 Tokens** | V2 Stubs Expanded | **V3 Stubs Expanded** | **V3 Peak Nodes** | **V3 Loop Iters** |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of revRows) {
    lines.push(
      `| ${r.len} | ${r.r1.telemetry.totalTokensTransferred} | ${r.r2.telemetry.totalTokensTransferred} | **${r.r3.telemetry.totalTokensTransferred}** | ${r.r2.telemetry.stubsExpanded} | **${r.r3.telemetry.stubsExpanded}** | **${r.r3.telemetry.peakActiveNodes}** | ${r.r3.telemetry.compiledLoopIterations} |`
    );
  }
  lines.push("");

  lines.push("## 4. Benchmark B: `mod` (V1 vs. V2 vs. V3, 4-bit up to **512-bit**)");
  lines.push("");
  lines.push("| Scale Case | V1 Tokens | V2 Tokens | **V3 Tokens** | V2 Stubs Exp | **V3 Stubs Exp** | V2 Peak Nodes | **V3 Peak Nodes / FIFOs** | V2 Time | **V3 Time** | **Speedup vs V2** |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | ---: | ---: | ---: |");
  for (const r of modRows) {
    const v1T = r.r1 ? String(r.r1.telemetry.totalTokensTransferred) : "—";
    const v2T = r.r2 ? String(r.r2.telemetry.totalTokensTransferred) : "—";
    const v2S = r.r2 ? String(r.r2.telemetry.stubsExpanded) : "—";
    const v2P = r.r2 ? String(r.r2.telemetry.peakActiveNodes) : "—";
    const v2Ms = r.r2 ? `${r.r2.ms.toFixed(1)} ms` : "—";
    const spd = r.r2 ? `**${(r.r2.ms / r.r3.ms).toFixed(1)}×**` : "—";
    const t3 = r.r3.telemetry;
    lines.push(
      `| ${r.label} | ${v1T} | ${v2T} | **${t3.totalTokensTransferred}** | ${v2S} | **${t3.stubsExpanded}** | ${v2P} | **${t3.peakActiveNodes} / ${t3.peakLiveFifos}** | ${v2Ms} | **${r.r3.ms.toFixed(1)} ms** | ${spd} |`
    );
  }
  lines.push("");

  lines.push("## 5. Benchmark C: Karatsuba `times` (V2 vs. V3, 4-bit up to **1024-bit × 1024-bit = 2,048-bit product**)");
  lines.push("");
  lines.push("| Scale Case | Depth $d$ | V2 Tokens | **V3 Tokens** | **V3 Doubling Ratio** (ideal $3.00\\times$) | V2 Rollbacks | **V3 Rollbacks** | **V3 Peak Nodes** | V2 Time | **V3 Time** | **Speedup vs V2** |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  let prevPow = null;
  for (const r of mulRows) {
    const v2T = r.r2 ? String(r.r2.telemetry.totalTokensTransferred) : "—";
    const v2Rb = r.r2 ? String(r.r2.telemetry.speculativeRollbacks) : "—";
    const v2Ms = r.r2 ? `${r.r2.ms.toFixed(1)} ms` : "—";
    const spd = r.r2 ? `**${(r.r2.ms / r.r3.ms).toFixed(1)}×**` : "—";
    const t3 = r.r3.telemetry;
    const isPow = ["32-bit", "64-bit", "128-bit", "256-bit", "512-bit", "1024-bit"].some((p) => r.label.startsWith(p));
    const ratio = isPow && prevPow !== null ? `**${(t3.totalTokensTransferred / prevPow).toFixed(2)}×**` : "—";
    if (isPow) prevPow = t3.totalTokensTransferred;
    lines.push(
      `| ${r.label} | ${r.depth} | ${v2T} | **${t3.totalTokensTransferred}** | ${ratio} | ${v2Rb} | **${t3.speculativeRollbacks}** | **${t3.peakActiveNodes}** | ${v2Ms} | **${r.r3.ms.toFixed(1)} ms** | ${spd} |`
    );
  }
  lines.push("");

  lines.push("## 6. Synthesized Transducer Gallery (Auto-Generated Directly From K ASTs)");
  lines.push("");
  for (const name of ["_lsb_sub", "_half_max_tally", "_rev_bits", "_classify_bits"]) {
    const c = compiler.getCompiled(lib.relAlias[name]);
    lines.push(`### \`${c.isLoop ? "LOOP" : "FSM"}(${name})\` (${c.nodeCount} states, in=${c.inCount}, out=${c.outCount}, regs=[${c.registerPorts.map((p) => c.inLeaves[p].pathKey).join(",")}])`);
    lines.push("```mermaid");
    lines.push(compiler.toMermaid(c));
    lines.push("```");
    lines.push("");
  }

  lines.push("## 7. Live V3 Hybrid Network Snapshots (`mod(13, 5)` & 20-bit Karatsuba)");
  lines.push("");
  lines.push("Purple double-bordered boxes (`[[LOOP(...)]]` / `[[FSM(...)]]`) are statically compiled transducer nodes running live inside the JIT network alongside `SW`, `TEE`, `MUX`/`DEMUX`, and green `buf:...` FIFO pills:");
  lines.push("");
  for (const s of modSnaps) {
    lines.push(`### \`mod(13, 5)\` — \`${s.label}\` (active nodes: ${s.activeNodes}, FIFOs: ${s.liveFifos}, stubs expanded: ${s.stubsExpanded}, loop iters: ${s.loopIters})`);
    lines.push("```mermaid");
    lines.push(s.mermaid);
    lines.push("```");
    lines.push("");
  }
  for (const s of mulSnaps) {
    lines.push(`### \`times(1000003, 999983)\` — \`${s.label}\` (active nodes: ${s.activeNodes}, FIFOs: ${s.liveFifos}, stubs expanded: ${s.stubsExpanded}, loop iters: ${s.loopIters})`);
    lines.push("```mermaid");
    lines.push(s.mermaid);
    lines.push("```");
    lines.push("");
  }

  lines.push("## 8. Ready for Iteration 4 (Orthogonal Variable-Size Symbol Encoding)");
  lines.push("");
  lines.push("Notice that every hot inner loop (`trim_bits`, `_rev_bits`, `_lsb_sub`, `_lsb_add`, `_lsb_split`, `lsb_shl`, `_half_max_tally`, `_cmp_msb`) is now an **explicit finite-state Mealy DAG over abstract union-tag symbols**, completely decoupled from wire representation:");
  lines.push("- **Orthogonal wire layer**: Swapping `TokenDeque` from 1-symbol-per-entry JS arrays to variable-size bit-packed streams (e.g., prefix-free / variable-length bit codes per union node, where `bits[]` uses 2-bit codes or variable-width `0`/`1`/`_` Huffman codes like `0 -> 10`, `1 -> 11`, `_ -> 0`, and multi-bit chunks inside `bits[]`!) requires **zero changes** to the JIT network topology.");
  lines.push("- **Super-transitions directly from V3 DAGs**: Composing a V3 `COMPILED_LOOP` DAG with itself $k$ times (e.g., $k = 4$ or $k = 8$ bits per step, or variable-length prefix-free symbol blocks stopping cleanly at `\"_\"`!) turns `_lsb_sub`, `_lsb_add`, `_rev_bits`, and `trim_bits` into **multi-bit word/byte-level table transducers** automatically.");
  lines.push("");
  return lines.join("\n");
}

if (process.argv.includes("--write-report")) {
  const reportPath = path.join(__dirname, "REPORT.md");
  fs.writeFileSync(reportPath, buildReport(), "utf8");
  console.log(`\nAll V3 conformance tests & benchmarks passed! Report written to ${reportPath}`);
} else {
  console.log("\nAll V3 conformance tests & benchmarks passed!");
}
