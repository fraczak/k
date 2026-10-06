#!/usr/bin/env node

/**
 * Multiplication Algorithm & Multi-Backend Performance Harness
 *
 * Compares multiplication algorithms ('times' vs 'karatsuba')
 * across available execution backends:
 *   - LLVM (native binary via Clang/LLVM)
 *   - WebAssembly (persistent runner via Wasm)
 *   - kVM Interpreter (envelope-free bytecode engine)
 *   - Native JS (envelope-free convergence engine)
 *   - ARM64 (native binary, on supported Linux aarch64 hosts)
 *
 * Modes:
 *   --mode squaring : Successive squarings starting from --input
 *                     (bit length doubles each step)
 *   --mode sizes    : Multiplies pairs of numbers of specific bit sizes
 *                     (--sizes 64,128,256,512,...)
 *
 * Safety features:
 *   - Per-step timeout (--timeout <ms>, default: 30000ms)
 *   - Max RSS memory cap (--max-rss <mb>, default: 1024MB)
 *   - Automated conformance checking against BigInt oracle
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  codes,
  createState,
  decodeWire,
  evaluateInput,
  executeKVM,
  run_converged,
  valueForCode
} from "@fraczak/k/backend-api.mjs";
import { parse as parseIntValue } from "@fraczak/k/codecs/int.mjs";
import { compileObjectBuffer } from "@fraczak/k/object.mjs";
import {
  compileObjectToExecutable
} from "../backends/llvm/src/executable.mjs";
import {
  compileWasmArtifactFromObject
} from "../backends/wasm/src/wasm.mjs";
import {
  PersistentExecutable,
  makeCacheDir,
  prepareRelation,
  wireInput
} from "../backends/llvm/tests/perf-support.mjs";

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(flag) {
  return args.includes(flag);
}

function printHelp() {
  console.log(`Usage: node scripts/perf-multiplication.mjs [options]

Multiplication Algorithm & Multi-Backend Performance Harness.
Compares multiplication algorithms ('times' vs 'karatsuba') across
available execution backends (LLVM, Wasm, kVM, JS, ARM64).

Options:
  --mode <squaring|sizes>
      Benchmark mode: 'squaring' (successive squarings starting from
      --input) or 'sizes' (multiplication of fixed bit-width pairs).
      (default: squaring)
  --backends <csv>
      Comma-separated list of execution backends to test:
      llvm, wasm, kvm, js, arm64. (default: llvm,wasm,kvm,js)
  --algos <csv>
      Comma-separated list of multiplication algorithms to test:
      times, karatsuba. (default: times,karatsuba)
  --steps <n>
      Number of squaring steps in squaring mode. (default: 8)
  --input <int>
      Initial integer operand for squaring mode. (default: 987654321)
  --sizes <csv>
      Comma-separated bit sizes in sizes mode.
      (default: 64,128,256,512,1024,2048)
  --timeout <ms>
      Execution timeout per step in milliseconds. (default: 30000)
  --max-rss <mb>
      Maximum RSS memory limit in MB before stopping. (default: 1024)
  --json
      Emit benchmark results in JSON format.
  -h, --help
      Show this help message and exit.

Environment Variables:
  K_LLVM_CLANG_OPT
      Clang optimization flag for LLVM compilation (e.g. -O3).
  K_LLVM_RUNTIME_MODE
      LLVM runtime compilation mode ('fast' or 'compact').
  K_LLVM_CACHE_DIR
      Directory used to cache compiled LLVM executable binaries.
  LLVM_PIPELINE
      Set to '1' to use persistent pipelined LLVM runner mode.
  LLVM_SPAWN_PER_CALL
      Set to '1' to spawn a new LLVM process on each invocation.
  ARM64_PIPELINE
      Set to '1' to use persistent pipelined ARM64 runner mode.
  ARM64_SPAWN_PER_CALL
      Set to '1' to spawn a new ARM64 process on each invocation.`);
}

if (hasFlag("-h") || hasFlag("--help")) {
  printHelp();
  process.exit(0);
}

const mode = getArg("--mode", "squaring"); // 'squaring' or 'sizes'
const backendsArg = getArg("--backends", "llvm,wasm,kvm,js");
const selectedBackends = backendsArg
  .split(",").map(b => b.trim().toLowerCase()).filter(Boolean);
const algosArg = getArg("--algos", "times,karatsuba");
const selectedAlgos = algosArg
  .split(",").map(a => a.trim().toLowerCase()).filter(Boolean);

const squaringSteps = parseInt(getArg("--steps", "8"), 10);
const squaringInputText = getArg("--input", "987654321");
const sizesList = getArg("--sizes", "64,128,256,512,1024,2048")
  .split(",")
  .map(s => parseInt(s.trim(), 10))
  .filter(n => !isNaN(n) && n > 0);
const stepTimeoutMs = parseInt(getArg("--timeout", "30000"), 10);
const maxRssMb = parseInt(getArg("--max-rss", "1024"), 10);
const outputJson = hasFlag("--json");

// Helper: Inspect process RSS / peak RSS
function getProcessMemory(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const vmrss = status.match(/VmRSS:\s+(\d+)\s+kB/);
    const vmhwm = status.match(/VmHWM:\s+(\d+)\s+kB/);
    const parseMb = (match) =>
      match ? Number((parseInt(match[1], 10) / 1024).toFixed(1)) : null;
    return {
      rssMb: parseMb(vmrss),
      peakRssMb: parseMb(vmhwm)
    };
  } catch {
    return { rssMb: null, peakRssMb: null };
  }
}

function getNodeMemory() {
  const mem = process.memoryUsage();
  return {
    heapMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
    rssMb: Number((mem.rss / (1024 * 1024)).toFixed(1))
  };
}

function countBitsValue(val) {
  let count = 0;
  let cur = val?.tag === "+" || val?.tag === "-" ? val.value : val;
  while (cur && (cur.tag === "0" || cur.tag === "1")) {
    count++;
    cur = cur.value;
  }
  return count;
}

function countBitsWire(wireBuf) {
  try {
    const decoded = decodeWire(wireBuf);
    return countBitsValue(decoded.value);
  } catch {
    return null;
  }
}

async function requestWithTimeout(server, wire, timeoutMs) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([server.request(wire), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// Format numbers
function fmtMs(ms) {
  if (ms == null) return "-";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtSpeedup(baseMs, altMs) {
  if (baseMs == null || altMs == null || altMs === 0) return "-";
  const ratio = baseMs / altMs;
  return `${ratio.toFixed(2)}x`;
}

const sep72 = "=".repeat(72);
console.log(sep72);
console.log("       MULTIPLICATION ALGORITHM & MULTI-BACKEND HARNESS");
console.log(sep72);
console.log(`Mode:            ${mode}`);
console.log(`Algorithms:      ${selectedAlgos.join(", ")}`);
console.log(`Backends:        ${selectedBackends.join(", ")}`);
if (mode === "squaring") {
  console.log(
    `Squaring Steps:  ${squaringSteps} (input: ${squaringInputText})`
  );
} else {
  console.log(`Bit Sizes:       ${sizesList.join(", ")} bits`);
}
console.log(
  `Timeout / step:  ${stepTimeoutMs} ms | Max RSS: ${maxRssMb} MB`
);
console.log("-".repeat(72) + "\n");

// 1. Map algorithms to their source files
const algoFiles = {
  times: fileURLToPath(
    import.meta.resolve("../Examples/arithmetics.k")
  ),
  karatsuba: fileURLToPath(
    import.meta.resolve("../Examples/karatsuba-mult.k")
  )
};

const cacheDir = makeCacheDir("k-mult-perf-");

// 2. Prepare Squaring Relations & Binaries
// For squaring: relation name `s_${algo} = {()x, ()y} ${algo}; s_${algo}`
const algoRelations = {};
const algoServers = { llvm: {}, wasm: {} };

let commonState = null;

for (const algo of selectedAlgos) {
  const filePath = algoFiles[algo] || algoFiles.times;
  const rawSource = fs.readFileSync(filePath, "utf8");
  const libSource = rawSource.replace(/\s*\(\)\s*$/, "\n");

  const algoState = createState();
  await evaluateInput(`:load ${filePath}`, algoState);
  codes.load(algoState.codes);

  if (!commonState) commonState = algoState;

  const relName = `s_${algo}`;
  await evaluateInput(`${relName} = {()x, ()y} ${algo};`, algoState);
  codes.load(algoState.codes);

  const relSource =
    `${libSource}\n${relName} = {()x, ()y} ${algo};\n${relName}`;
  const prepared = prepareRelation(algoState, relName, {
    source: relSource,
    sourceLabel: `${filePath}#${relName}`
  });
  prepared.state = algoState;
  algoRelations[algo] = prepared;

  // LLVM
  if (selectedBackends.includes("llvm")) {
    const exePath = path.join(cacheDir, `perf_mult_llvm_${algo}`);
    try {
      compileObjectToExecutable(
        algoRelations[algo].object, exePath, { clangOpt: "-O2" }
      );
      algoServers.llvm[algo] = new PersistentExecutable(exePath);
    } catch (e) {
      console.warn(
        `[WARN] Failed to compile LLVM for ${algo}: ${e.message}`
      );
    }
  }

  // Wasm
  if (selectedBackends.includes("wasm")) {
    const wasmPath = path.join(cacheDir, `perf_mult_wasm_${algo}.wasm`);
    const exePath = path.join(cacheDir, `perf_mult_wasm_${algo}.exe`);
    try {
      const wasmBuf = await compileWasmArtifactFromObject(
        algoRelations[algo].object, { entry: "__main__" }
      );
      fs.writeFileSync(wasmPath, wasmBuf);
      const runBin = fileURLToPath(
        import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs")
      );
      fs.writeFileSync(
        exePath,
        `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`,
        { mode: 0o755 }
      );
      algoServers.wasm[algo] = new PersistentExecutable(exePath);
    } catch (e) {
      console.warn(
        `[WARN] Failed to compile Wasm for ${algo}: ${e.message}`
      );
    }
  }
}

// 3. Squaring Mode Benchmark
if (mode === "squaring") {
  const sInitVal = valueForCode(
    parseIntValue(squaringInputText),
    commonState.typeAliases.int,
    codes.find
  );
  const { inputWire: sInitWire } = wireInput(sInitVal);

  const results = {};
  for (const backend of selectedBackends) {
    results[backend] = {};
    for (const algo of selectedAlgos) {
      results[backend][algo] = [];
    }
  }

  const stepBits = [];

  try {
    // A. Run persistent backends (LLVM, Wasm)
    const activeBackends = ["llvm", "wasm"]
      .filter(b => selectedBackends.includes(b));
    for (const backend of activeBackends) {
      for (const algo of selectedAlgos) {
        const server = algoServers[backend]?.[algo];
        if (!server) continue;

        console.log(
          `==> Running [${backend.toUpperCase()}] with [${algo}]...`
        );
        let curWire = sInitWire;
        for (let step = 1; step <= squaringSteps; step++) {
          const memBefore = getProcessMemory(server.child.pid);
          if (memBefore.peakRssMb && memBefore.peakRssMb > maxRssMb) {
            console.warn(
              `[ABORT] Step ${step} aborted: peak RSS ` +
              `(${memBefore.peakRssMb}MB) exceeded cap (${maxRssMb}MB)`
            );
            results[backend][algo].push({
              status: "oom-abort",
              timeMs: null
            });
            break;
          }

          try {
            const t0 = performance.now();
            curWire = await requestWithTimeout(
              server, curWire, stepTimeoutMs
            );
            const t1 = performance.now();
            const timeMs = t1 - t0;
            const memAfter = getProcessMemory(server.child.pid);

            if (stepBits[step - 1] == null) {
              stepBits[step - 1] = countBitsWire(curWire);
            }

            results[backend][algo].push({
              status: "ok",
              timeMs,
              peakRssMb: memAfter.peakRssMb,
              wireLen: curWire.length
            });
          } catch (e) {
            console.warn(
              `    ${backend} ${algo} step ${step} stopped: ${e.message}`
            );
            results[backend][algo].push({
              status: "failed",
              error: e.message
            });
            break;
          }
        }
      }
    }

    // B. Run in-process backends (kVM, JS)
    if (selectedBackends.includes("kvm")) {
      for (const algo of selectedAlgos) {
        console.log(`==> Running [kVM] with [${algo}]...`);
        let curVal = sInitVal;
        const kvmContext = {
          rels: algoRelations[algo].state.rels,
          findCode: codes.find,
          options: { envelopeFree: true }
        };
        const kvmFunc = algoRelations[algo].kvmFunc;

        for (let step = 1; step <= squaringSteps; step++) {
          try {
            const t0 = performance.now();
            curVal = executeKVM(kvmFunc, curVal, kvmContext);
            const t1 = performance.now();
            const timeMs = t1 - t0;
            const mem = getNodeMemory();

            if (stepBits[step - 1] == null) {
              stepBits[step - 1] = countBitsValue(curVal);
            }

            results.kvm[algo].push({
              status: "ok",
              timeMs,
              heapMb: mem.heapMb
            });
            if (timeMs > stepTimeoutMs) {
              console.warn(
                `    kVM ${algo} step ${step} exceeded timeout ` +
                `(${fmtMs(timeMs)})`
              );
              break;
            }
          } catch (e) {
            console.warn(
              `    kVM ${algo} step ${step} stopped: ${e.message}`
            );
            results.kvm[algo].push({
              status: "failed",
              error: e.message
            });
            break;
          }
        }
      }
    }

    if (selectedBackends.includes("js")) {
      for (const algo of selectedAlgos) {
        console.log(`==> Running [JS Free] with [${algo}]...`);
        let curVal = sInitVal;
        run_converged.defs = algoRelations[algo].state;
        const relDef = algoRelations[algo].relDef;

        for (let step = 1; step <= squaringSteps; step++) {
          try {
            const t0 = performance.now();
            curVal = run_converged(
              codes.find, relDef.def, curVal, relDef.typePatternGraph
            );
            const t1 = performance.now();
            const timeMs = t1 - t0;
            const mem = getNodeMemory();

            if (stepBits[step - 1] == null) {
              stepBits[step - 1] = countBitsValue(curVal);
            }

            results.js[algo].push({
              status: "ok",
              timeMs,
              heapMb: mem.heapMb
            });
            if (timeMs > stepTimeoutMs) {
              console.warn(
                `    JS ${algo} step ${step} exceeded timeout ` +
                `(${fmtMs(timeMs)})`
              );
              break;
            }
          } catch (e) {
            console.warn(
              `    JS ${algo} step ${step} stopped: ${e.message}`
            );
            results.js[algo].push({
              status: "failed",
              error: e.message
            });
            break;
          }
        }
      }
    }

    // 4. Print Squaring Results Table
    console.log("\n" + sep72);
    console.log("                      SQUARING BENCHMARK RESULTS");
    console.log(sep72);

    for (const backend of selectedBackends) {
      console.log(`\n### Backend: ${backend.toUpperCase()}`);
      const hasTimes = selectedAlgos.includes("times");
      const hasKara = selectedAlgos.includes("karatsuba");

      let header = "Step | Bits  ";
      if (hasTimes) header += "| Times Time  ";
      if (hasKara)  header += "| Karatsuba   ";
      if (hasTimes && hasKara) header += "| Speedup (T/K)";
      if (hasTimes) header += "| Times Mem   ";
      if (hasKara)  header += "| Kara Mem    ";
      console.log(header);
      console.log("-".repeat(header.length));

      for (let s = 1; s <= squaringSteps; s++) {
        const bits = stepBits[s - 1] != null
          ? `${stepBits[s - 1]}b`.padEnd(5)
          : " ?   ";
        const tEntry = results[backend].times?.[s - 1];
        const kEntry = results[backend].karatsuba?.[s - 1];

        if (!tEntry && !kEntry) break;

        const formatEntry = (e) =>
          e?.status === "ok" ? fmtMs(e.timeMs)
            : (e?.error ? "error" : "-");
        const tTime = formatEntry(tEntry);
        const kTime = formatEntry(kEntry);
        const speedup = (tEntry?.status === "ok" &&
                         kEntry?.status === "ok")
          ? fmtSpeedup(tEntry.timeMs, kEntry.timeMs)
          : "-";

        function fmtMem(entry) {
          if (entry?.peakRssMb != null) return `${entry.peakRssMb}MB RSS`;
          if (entry?.heapMb != null) return `${entry.heapMb}MB heap`;
          return "-";
        }

        let row = `${s.toString().padStart(4)} | ${bits} `;
        if (hasTimes) row += `| ${tTime.padStart(11)} `;
        if (hasKara)  row += `| ${kTime.padStart(11)} `;
        if (hasTimes && hasKara) row += `| ${speedup.padStart(13)} `;
        if (hasTimes) row += `| ${fmtMem(tEntry).padStart(11)} `;
        if (hasKara)  row += `| ${fmtMem(kEntry).padStart(11)} `;
        console.log(row);
      }
    }

    console.log();

  } finally {
    // Teardown persistent servers
    for (const backend of ["llvm", "wasm"]) {
      for (const algo of selectedAlgos) {
        algoServers[backend]?.[algo]?.child?.kill();
      }
    }
  }
}

// 4. Bit Sizes Mode (Multiply random N-bit numbers)
if (mode === "sizes") {
  console.log("==> Running Bit Sizes Multiplication Mode...");
  function randomBigIntBits(bits) {
    let hex = "";
    const nibbles = Math.ceil(bits / 4);
    for (let i = 0; i < nibbles; i++) {
      hex += Math.floor(Math.random() * 16).toString(16);
    }
    const val = BigInt(`0x${hex}`) | (1n << BigInt(bits - 1));
    return val.toString();
  }

  const th = "Size (bits) | Backend | Times       " +
             "| Karatsuba   | Speedup (T/K) | Conformance";
  console.log("\n" + th);
  console.log("-".repeat(th.length));

  const relDefTimes = selectedAlgos.includes("times")
    ? prepareRelation(algoRelations.times.state, "times").relDef
    : null;
  const relDefKara = selectedAlgos.includes("karatsuba")
    ? prepareRelation(algoRelations.karatsuba.state, "karatsuba").relDef
    : null;

  for (const bits of sizesList) {
    const strA = randomBigIntBits(bits);
    const strB = randomBigIntBits(bits);

    const valA = valueForCode(
      parseIntValue(strA), commonState.typeAliases.int, codes.find
    );
    const valB = valueForCode(
      parseIntValue(strB), commonState.typeAliases.int, codes.find
    );
    const pairInput = { tag: "product", value: { x: valA, y: valB } };

    for (const backend of selectedBackends) {
      if (backend === "js") {
        let resTimes = null;
        let tTime = null;
        if (relDefTimes) {
          run_converged.defs = algoRelations.times.state;
          const t0_t = performance.now();
          resTimes = run_converged(
            codes.find,
            relDefTimes.def,
            pairInput,
            relDefTimes.typePatternGraph
          );
          tTime = performance.now() - t0_t;
        }

        let resKara = null;
        let kTime = null;
        if (relDefKara) {
          run_converged.defs = algoRelations.karatsuba.state;
          const t0_k = performance.now();
          resKara = run_converged(
            codes.find,
            relDefKara.def,
            pairInput,
            relDefKara.typePatternGraph
          );
          kTime = performance.now() - t0_k;
        }

        const match = (!resTimes || !resKara)
          ? true
          : JSON.stringify(resTimes) === JSON.stringify(resKara);
        const speedup = (tTime != null && kTime != null)
          ? fmtSpeedup(tTime, kTime)
          : "-";
        const colBits = bits.toString().padStart(11);
        const colBe = backend.padEnd(7);
        const colT = fmtMs(tTime).padStart(11);
        const colK = fmtMs(kTime).padStart(11);
        const colSp = speedup.padStart(13);
        const colMatch = match ? "MATCH OK" : "MISMATCH";
        console.log(
          `${colBits} | ${colBe} | ${colT} | ${colK} | ` +
          `${colSp} | ${colMatch}`
        );
      }
    }
  }
}
