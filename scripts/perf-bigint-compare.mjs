#!/usr/bin/env node

/**
 * End-to-End Integer Squaring Benchmark: K vs JS BigInt
 *
 * Compares the full UTF-8 decimal string -> parse -> N squarings -> decimal print
 * pipeline between JavaScript BigInt and K (lib/integer.k) across backends:
 *   llvm, llvm-pkir, wasm, pkir, kvm, js
 *
 * Usage:
 *   node scripts/perf-bigint-compare.mjs [options]
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import k from "../index.mjs";
import {
  codes,
  createState,
  decodeWire,
  encodeToWire,
  evaluateInput,
  executeKVM
} from "../backend-api.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { parse as parseIntVal, print as printIntVal } from "../codecs/int.mjs";
import { compileObjectToExecutable } from "../backends/llvm/src/executable.mjs";
import {
  compileWasmArtifact,
  instantiateWasmArtifact
} from "../backends/wasm/src/wasm.mjs";
import {
  PersistentExecutable,
  makeCacheDir,
  prepareRelation
} from "../backends/llvm/tests/perf-support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

if (args.includes("-h") || args.includes("--help")) {
  console.log(`Usage: node scripts/perf-bigint-compare.mjs [options]

End-to-end decimal parse -> N squarings -> decimal print benchmark comparing
JS BigInt against K (lib/integer.k) across execution backends.

Options:
  --input <decimal>   Starting decimal integer (default: 987654321)
  --steps <n>         Number of consecutive squarings (default: 10)
  --backends <csv>    K backends: llvm,llvm-pkir,wasm,pkir,kvm,js
                      (default: llvm,wasm,pkir)
  --iters <n>         Measured iterations per K backend (default: 3)
  -h, --help          Show this help message and exit`);
  process.exit(0);
}

const INPUT = getArg("--input", "987654321");
const STEPS = Number.parseInt(getArg("--steps", "10"), 10);
const ITERS = Number.parseInt(getArg("--iters", "3"), 10);
const BACKENDS = getArg("--backends", "llvm,wasm,pkir")
  .split(",")
  .map((b) => b.trim().toLowerCase())
  .filter(Boolean);

function fmtMs(ms) {
  if (ms < 0.01) return `${(ms * 1000).toFixed(2)} µs`;
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 100) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// 1. JS BigInt baseline
function benchBigInt(iters = 500) {
  let expected;
  for (let i = 0; i < 20; i++) {
    let x = BigInt(INPUT);
    for (let s = 0; s < STEPS; s++) x = x * x;
    expected = x.toString(10);
  }
  let parseMs = 0;
  let computeMs = 0;
  let printMs = 0;
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    let x = BigInt(INPUT);
    const t1 = performance.now();
    for (let s = 0; s < STEPS; s++) x = x * x;
    const t2 = performance.now();
    const out = x.toString(10);
    const t3 = performance.now();
    if (out.length !== expected.length) throw new Error("BigInt mismatch");
    parseMs += t1 - t0;
    computeMs += t2 - t1;
    printMs += t3 - t2;
  }
  return {
    name: "JS BigInt",
    parseMs: parseMs / iters,
    computeMs: computeMs / iters,
    printMs: printMs / iters,
    totalMs: (parseMs + computeMs + printMs) / iters,
    output: expected
  };
}

const bigRes = benchBigInt();
console.log(
  `Input: "${INPUT}" | Squarings: ${STEPS} | Output: ${bigRes.output.length} decimal digits`
);
console.log(
  `Result: ${bigRes.output.slice(0, 30)}...${bigRes.output.slice(-20)}\n`
);

// 2. Compile sqN in K (both library form for Wasm/JS and REPL state for LLVM/kVM)
const intSource = fs.readFileSync(path.join(root, "lib/integer.k"), "utf8");
const sqDefs = `\nsq = ?int[] { () x, () y } times ?int[];\nsqN = ${Array(STEPS).fill("sq").join(" ")};\n`;
const intLib = loadLibrary(
  compileLibrary(intSource + sqDefs, { source: "lib/integer.k+sqN" })
);
const sqNAlias = intLib.relAlias.sqN;
const intPattern = parseIntVal("0").pattern;

const results = [bigRes];

async function benchInProcess(name, runFn, iters) {
  // Warmup & conformance check
  {
    const val = parseIntVal(INPUT);
    const outStr = printIntVal(runFn(val));
    if (outStr !== bigRes.output) throw new Error(`${name}: output mismatch`);
  }
  let parseMs = 0;
  let computeMs = 0;
  let printMs = 0;
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    const val = parseIntVal(INPUT);
    const t1 = performance.now();
    const outVal = runFn(val);
    const t2 = performance.now();
    const outStr = printIntVal(outVal);
    const t3 = performance.now();
    if (outStr !== bigRes.output) throw new Error(`${name}: output mismatch`);
    parseMs += t1 - t0;
    computeMs += t2 - t1;
    printMs += t3 - t2;
  }
  return {
    name,
    parseMs: parseMs / iters,
    computeMs: computeMs / iters,
    printMs: printMs / iters,
    totalMs: (parseMs + computeMs + printMs) / iters
  };
}

async function benchWireServer(name, server, iters) {
  // Warmup & conformance check
  {
    const val = parseIntVal(INPUT);
    const wire = encodeToWire(val, val.pattern);
    const outWire = await server.request(wire);
    const outStr = printIntVal(decodeWire(outWire).value);
    if (outStr !== bigRes.output) throw new Error(`${name}: output mismatch`);
  }
  let parseMs = 0;
  let computeMs = 0;
  let printMs = 0;
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    const val = parseIntVal(INPUT);
    const wire = encodeToWire(val, val.pattern);
    const t1 = performance.now();
    const outWire = await server.request(wire);
    const t2 = performance.now();
    const outStr = printIntVal(decodeWire(outWire).value);
    const t3 = performance.now();
    if (outStr !== bigRes.output) throw new Error(`${name}: output mismatch`);
    parseMs += t1 - t0;
    computeMs += t2 - t1;
    printMs += t3 - t2;
  }
  return {
    name,
    parseMs: parseMs / iters,
    computeMs: computeMs / iters,
    printMs: printMs / iters,
    totalMs: (parseMs + computeMs + printMs) / iters
  };
}

// Prepare LLVM/kVM relation object if needed
let prepared = null;
let preparedState = null;
let cacheDir = null;
if (BACKENDS.some((b) => b === "llvm" || b === "llvm-pkir" || b === "kvm")) {
  preparedState = createState();
  await evaluateInput(`:load ${path.join(root, "lib/integer.k")}`, preparedState);
  await evaluateInput("sq = ?int[] { () x, () y } times ?int[];", preparedState);
  await evaluateInput(`sqN = ${Array(STEPS).fill("sq").join(" ")};`, preparedState);
  codes.load(preparedState.codes);
  prepared = prepareRelation(preparedState, "sqN", { sourceLabel: "lib/integer.k#sqN" });
  cacheDir = makeCacheDir("k-bigint-cmp-");
}

for (const backend of BACKENDS) {
  try {
    if (backend === "llvm" || backend === "llvm-pkir") {
      const usePKIR = backend === "llvm-pkir";
      const label = usePKIR ? "K LLVM-PKIR (-O3)" : "K LLVM (-O3)";
      const exe = path.join(cacheDir, `sqN_${backend.replace("-", "_")}`);
      compileObjectToExecutable(prepared.object, exe, {
        clangOpt: "-O3",
        inputPattern: intPattern,
        usePKIR
      });
      const srv = new PersistentExecutable(exe, {
        env: { ...process.env, K_ARENA_CAPACITY_MB: "4096" }
      });
      try {
        results.push(await benchWireServer(label, srv, ITERS));
      } finally {
        await srv.close();
      }
    } else if (backend === "wasm" || backend === "pkir") {
      const usePKIR = backend === "pkir";
      const label = usePKIR ? "K PKIR-Wasm" : "K Wasm";
      const artifact = await compileWasmArtifact(sqNAlias, {
        libraries: [intLib],
        usePKIR
      });
      const inst = await instantiateWasmArtifact(artifact);
      results.push(
        await benchInProcess(label, (val) => inst.executeValue(val), ITERS)
      );
    } else if (backend === "kvm") {
      const kvmContext = {
        rels: preparedState.rels,
        findCode: codes.find,
        options: { envelopeFree: true }
      };
      results.push(
        await benchInProcess(
          "K kVM",
          (val) => executeKVM(prepared.kvmFunc, val, kvmContext),
          Math.min(ITERS, 2)
        )
      );
    } else if (backend === "js") {
      const fn = k.compile(sqNAlias, { libraries: [intLib] });
      results.push(await benchInProcess("K JS", fn, Math.min(ITERS, 2)));
    } else {
      console.warn(`[WARN] Unknown backend: ${backend}`);
    }
  } catch (err) {
    console.warn(`[SKIP] ${backend}: ${err.message}`);
  }
}

console.log(
  `| Engine | Parse | Compute (${STEPS}x sq) | Print | Total | vs BigInt (Compute) | vs BigInt (Total) |`
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of results) {
  const cRatio = `${(r.computeMs / bigRes.computeMs).toFixed(1)}x`;
  const tRatio = `${(r.totalMs / bigRes.totalMs).toFixed(1)}x`;
  console.log(
    `| ${r.name} | ${fmtMs(r.parseMs)} | ${fmtMs(r.computeMs)} | ${fmtMs(r.printMs)} | ${fmtMs(r.totalMs)} | ${cRatio} | ${tRatio} |`
  );
}
