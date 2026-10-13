import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wabtFactory from "wabt";

import {
  codes,
  createState,
  decodeWire,
  evaluateInput,
  executeKVM,
  exportPatternGraph,
  patternToPropertyList,
  propertyListToPattern,
  run,
  run_converged,
  valueForCode
} from "@fraczak/k/backend-api.mjs";
import { parse as parseIntValue } from "@fraczak/k/codecs/int.mjs";

import {
  csvEnv,
  formatTiming,
  createLLVMRunner,
  llvmLaneName,
  makeCacheDir,
  parseNonNegativeIntEnv,
  parsePositiveIntEnv,
  prepareRelation,
  printCompileFailures,
  runExecutable,
  runKVMCase,
  runKVMIterations,
  runNativeAwareIterations,
  runNativeFreeIterations,
  runTimedIterations,
  runTimedIterationsAsync,
  shouldStrictFail,
  safeDeepEqual,
  toPlainObject,
  tryCompileCase,
  wireInput,
  PersistentExecutable
} from "../backends/llvm/tests/perf-support.mjs";

import {
  cleanName,
  instantiateWasmModule,
  readArenaValue,
  writeValueToArena
} from "../backends/wasm/tests/perf-support.mjs";

import { compileWasmArtifactFromObject } from "../backends/wasm/src/wasm.mjs";

function printHelp() {
  console.log(`Usage: node scripts/perf-int.mjs [options]

Big Integer Arithmetic Performance Benchmark Harness.
Benchmarks plus, minus, times, and squaring scale on arithmetics.k
across Native JS, kVM interpreter, LLVM, Wasm, and PKIR backends.

Options:
  --wasm-in-process
      Run WebAssembly in-process instead of persistent subprocess runner.
  --squaring-llvm-only
      Run squaring benchmark on LLVM only.
  --pkir-only
      Run only PKIR backend.
  -h, --help
      Show this help message and exit.

Environment Variables:
  BACKENDS
      Target backend to run: 'llvm', 'wasm', or 'pkir'.
  LLVM_ONLY
      Run only LLVM backend ('1' to enable).
  WASM_ONLY
      Run only WebAssembly backend ('1' to enable).
  PKIR_ONLY
      Run only PKIR backend ('1' to enable).
  BACKENDS_ONLY
      Skip JS and kVM interpreter baselines ('1' to enable).
  SQUARING_LLVM_ONLY
      Run squaring benchmark on LLVM only ('1' to enable).
  INPUTS
      Comma-separated integer strings to benchmark.
  ITERATIONS
      Measured iterations per benchmark (default: 3).
  LLVM_WARMUP_ITERATIONS
      Warmup iterations for LLVM backend (default: 1).
  LLVM_SPAWN_PER_CALL
      Spawn process per LLVM call instead of persistent ('1' or '0').
  LLVM_PIPELINE
      Use persistent pipelined runner for LLVM ('1' or '0').
  K_LLVM_CACHE_DIR
      Directory to cache compiled LLVM executable binaries.
  WASM_WARMUP_ITERATIONS
      Warmup iterations for WebAssembly backend (default: 3).
  WASM_RESET
      Reset WebAssembly memory between iterations (default: 1).
  WASM_PIPE
      Use persistent subprocess for Wasm (default: 1, '0': in-process).
  WASM_IN_PROCESS
      Run WebAssembly in-process ('1' to enable).
  SQUARING_INPUT
      Initial integer for squaring benchmark (default: 987654321).
  SQUARING_STEPS
      Number of squaring steps (default: 10).
  SQUARING_STEP_TIMEOUT_MS
      Timeout per squaring step in milliseconds (default: 60000).
  K_ARENA_CAPACITY_MB
      Memory arena capacity in MB (default: 4096).`);
}

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

// Backend selection
const backendsEnv = process.env.BACKENDS?.toLowerCase();
const backendsList = backendsEnv
  ? backendsEnv.split(",").map(s => s.trim())
  : null;
const pkirOnly = process.env.PKIR_ONLY === "1"
  || (backendsList && backendsList.length === 1 && backendsList[0] === "pkir")
  || process.argv.includes("--pkir-only");
const llvmOnly = !pkirOnly && (
  process.env.LLVM_ONLY === "1"
  || (backendsList && backendsList.length === 1 && backendsList[0] === "llvm")
  || process.argv.includes("--llvm-only")
);
const wasmOnly = !pkirOnly && (
  process.env.WASM_ONLY === "1"
  || (backendsList && backendsList.length === 1 && backendsList[0] === "wasm")
  || process.argv.includes("--wasm-only")
);
const runLLVM = backendsList
  ? backendsList.includes("llvm")
  : !wasmOnly && !pkirOnly;
const runWasm = backendsList
  ? backendsList.includes("wasm")
  : !llvmOnly && !pkirOnly;
const runPKIR = backendsList
  ? backendsList.includes("pkir")
  : !llvmOnly && !wasmOnly;
const runBaselines = !process.env.BACKENDS_ONLY
  && (backendsList == null || backendsList.includes("kvm") || backendsList.includes("js"))
  && !llvmOnly && !wasmOnly && !pkirOnly;
const squaringLlvmOnly = llvmOnly
  || process.env.SQUARING_LLVM_ONLY === "1"
  || process.argv.includes("--squaring-llvm-only");

const ops = ["plus", "minus", "times"];
const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));
const inputTexts = csvEnv(
  "INPUTS",
  "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555"
);
const iterations = parsePositiveIntEnv("ITERATIONS", 3);

if (!process.env.K_ARENA_CAPACITY_MB && !process.env.K_ARENA_MB) {
  process.env.K_ARENA_CAPACITY_MB = "4096";
}

// LLVM options
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const cacheDir = makeCacheDir("k-llvm-int-perf-");

// Wasm options
const wasmWarmupIterations = parseNonNegativeIntEnv("WASM_WARMUP_ITERATIONS", 3);
const wasmReset = process.env.WASM_RESET !== "0";
const wasmPipe = process.env.WASM_PIPE === "0" || process.env.WASM_IN_PROCESS === "1" || process.argv.includes("--wasm-in-process")
  ? false
  : true;
function wasmLaneName() {
  const mode = wasmPipe ? "persistent" : "in-process";
  return `WebAssembly (${mode})`;
}
function pkirLaneName() {
  return "PKIR (Wasm persistent)";
}

console.log("==> Initializing state and loading @fraczak/k/Examples/arithmetics.k");
const state = createState();
const arithmeticsPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/arithmetics.k"));
await evaluateInput(`:load ${arithmeticsPath}`, state);

for (const op of ops) {
  await evaluateInput(`${benchNames[op]} = {inc x, () y} ${op};`, state);
}

function intValue(text) {
  return parseIntValue(text);
}

console.log("==> Preparing relations");
const relations = {};
const arithmeticsSource = fs.readFileSync(arithmeticsPath, "utf8");
const arithmeticsLibrarySource = arithmeticsSource.replace(/\s*\(\)\s*$/, "\n");
for (const op of ops) {
  const name = benchNames[op];
  relations[op] = prepareRelation(state, name, {
    source: `${arithmeticsLibrarySource}\n${name} = {inc x, () y} ${op};\n${name}`,
    sourceLabel: `@fraczak/k/Examples/arithmetics.k#${name}`
  });
}
codes.load(state.codes);

console.log("==> Generating test cases and caching expected results");
const testSuite = [];
for (const op of ops) {
  for (const inputText of inputTexts) {
    const inputVal = intValue(inputText);
    const relation = relations[op];

    run.defs = state;
    run_converged.defs = state;
    const expected = run(codes.find, relation.relDef.def, inputVal, relation.relDef.typePatternGraph);
    assert.ok(expected !== undefined, `${op}(${inputText}) should produce a value`);

    const { inputWire, inputPattern } = wireInput(inputVal);
    testSuite.push({
      op,
      label: inputText,
      inputText,
      inputVal,
      inputWire,
      inputPattern,
      expected
    });
  }
}

// Setup LLVM
if (runLLVM) {
  console.log("==> Compiling LLVM executables");
  for (const tc of testSuite) {
    const relation = relations[tc.op];
    tc.llvm = tryCompileCase({
      object: relation.object,
      relationName: relation.relationName,
      relHash: relation.relHash,
      inputPattern: tc.inputPattern,
      cacheDir,
      sourceLabel: `@fraczak/k/Examples/arithmetics.k#${relation.relationName}`
    });
  }
  codes.load(state.codes);
  printCompileFailures(testSuite);
}

// Setup Wasm
let wasmExports = null;
const wasmExes = new Map();
if (runWasm) {
  if (wasmPipe) {
    console.log("==> Compiling WebAssembly executables (persistent runner)...");
    for (const op of ops) {
      const relation = relations[op];
      try {
        const wasmPath = path.join(cacheDir, `perf_int_wasm_${op}.wasm`);
        const exePath = path.join(cacheDir, `perf_int_wasm_${op}.exe`);
        const wasmBuf = await compileWasmArtifactFromObject(relation.object, {
          entry: "__main__"
        });
        fs.writeFileSync(wasmPath, wasmBuf);
        const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
        fs.writeFileSync(exePath, `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`, { mode: 0o755 });
        wasmExes.set(op, { status: "ok", exePath, wasmPath });
      } catch (error) {
        wasmExes.set(op, {
          status: "failed",
          error: error.stack || error.message || String(error)
        });
      }
    }
    for (const tc of testSuite) {
      tc.wasm = wasmExes.get(tc.op);
    }
  } else {
    console.log("==> Compiling WebAssembly module...");
    const wabtInstance = await wabtFactory();
    const opHashes = ops.map(op => state.relAliases[benchNames[op]]);
    const wasmModule = await instantiateWasmModule(opHashes, state, wabtInstance);
    wasmExports = wasmModule.exports;

    for (const tc of testSuite) {
      const relDef = relations[tc.op].relDef;
      const graph = relDef.typePatternGraph;

      const inputPatternNodeId = graph.find(relDef.def.patterns[0]);
      const inputPattern = propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, inputPatternNodeId)));

      const outputPatternNodeId = graph.find(relDef.def.patterns[1]);
      const outputPatternPropertyList = patternToPropertyList(exportPatternGraph(graph, outputPatternNodeId));
      const outputPattern = propertyListToPattern(outputPatternPropertyList);

      tc.wasmPtrIn = writeValueToArena(wasmExports, tc.inputVal, inputPattern, 0);
      tc.wasmOutputPattern = outputPattern;
      tc.wasmOutputPatternPropertyList = outputPatternPropertyList;
    }
  }
}

// Setup PKIR (persistent runner)
const pkirExes = new Map();
if (runPKIR) {
  console.log("==> Compiling PKIR executables (persistent runner)...");
  for (const op of ops) {
    const relation = relations[op];
    try {
      const wasmPath = path.join(cacheDir, `perf_int_pkir_${op}.wasm`);
      const exePath = path.join(cacheDir, `perf_int_pkir_${op}.exe`);
      const wasmBuf = await compileWasmArtifactFromObject(relation.object, {
        entry: "__main__",
        usePKIR: true
      });
      fs.writeFileSync(wasmPath, wasmBuf);
      const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
      fs.writeFileSync(exePath, `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`, { mode: 0o755 });
      pkirExes.set(op, { status: "ok", exePath, wasmPath });
    } catch (error) {
      pkirExes.set(op, {
        status: "failed",
        error: error.stack || error.message || String(error)
      });
    }
  }
  for (const tc of testSuite) {
    tc.pkir = pkirExes.get(tc.op);
  }
}

function createWasmRunner(testSuite) {
  const wasmCases = testSuite.filter(tc => tc.wasm?.status === "ok");
  const servers = new Map();
  function serverFor(exePath) {
    let server = servers.get(exePath);
    if (server == null) {
      server = new PersistentExecutable(exePath);
      servers.set(exePath, server);
    }
    return server;
  }

  return {
    async run(iterations) {
      if (wasmCases.length === 0) return null;
      return runTimedIterationsAsync(iterations, async () => {
        for (const tc of wasmCases) {
          await serverFor(tc.wasm.exePath).request(tc.inputWire);
        }
      });
    },
    serverFor,
    close() {
      for (const server of servers.values()) server.close();
    }
  };
}

function createPKIRRunner(testSuite) {
  const pkirCases = testSuite.filter(tc => tc.pkir?.status === "ok");
  const servers = new Map();
  function serverFor(exePath) {
    let server = servers.get(exePath);
    if (server == null) {
      server = new PersistentExecutable(exePath);
      servers.set(exePath, server);
    }
    return server;
  }

  return {
    async run(iterations) {
      if (pkirCases.length === 0) return null;
      return runTimedIterationsAsync(iterations, async () => {
        for (const tc of pkirCases) {
          await serverFor(tc.pkir.exePath).request(tc.inputWire);
        }
      });
    },
    serverFor,
    close() {
      for (const server of servers.values()) server.close();
    }
  };
}

function printBenchmarkDescription() {
  const lanes = [];
  if (runBaselines) {
    lanes.push("Native JS (Envelope-Aware)");
    lanes.push("Native JS (Envelope-Free)");
    lanes.push("kVM Interpreter (Env-Free)");
  }
  if (runLLVM) lanes.push(llvmLaneName());
  if (runWasm) lanes.push(wasmLaneName());
  if (runPKIR) lanes.push(pkirLaneName());

  console.log("==> Benchmark description");
  console.log("    source: @fraczak/k/Examples/arithmetics.k");
  console.log(`    benchmark relations: ${Object.values(benchNames).join(", ")}`);
  console.log(`    operations: ${ops.join(", ")}`);
  console.log(`    decimal inputs: ${inputTexts.join(", ")}`);
  console.log(`    cases: ${testSuite.length} operation/input pairs`);
  if (runLLVM) {
    console.log(`    llvm-ready cases: ${testSuite.filter(tc => tc.llvm?.status === "ok").length}`);
    console.log(`    llvm warmup iterations: ${llvmWarmupIterations}`);
  }
  if (runWasm) {
    console.log(`    wasm runner mode: ${wasmPipe ? "persistent pipe" : "in-process"}`);
    console.log(`    wasm warmup iterations: ${wasmWarmupIterations}`);
    if (!wasmPipe) console.log(`    wasm arena reset: ${wasmReset ? "yes" : "no"}`);
  }
  if (runPKIR) {
    console.log(`    pkir warmup iterations: ${wasmWarmupIterations}`);
  }
  console.log(`    iterations: ${iterations}`);
  console.log(`    benchmark lanes: ${lanes.join("; ")}`);
  console.log("    conformance: all outputs are compared to native expected values");
}

printBenchmarkDescription();
console.log(`==> Running Integer Performance Test (${testSuite.length} cases, Iterations: ${iterations})...`);

// 1. Common baseline lanes (only run once!)
let nativeAwareResult = null;
let nativeFreeResult = null;
let kvmFreeResult = null;

if (runBaselines) {
  nativeAwareResult = runNativeAwareIterations(iterations, testSuite, relations, state, codes);
  nativeFreeResult = runNativeFreeIterations(iterations, testSuite, relations, state, codes);
  kvmFreeResult = runKVMIterations(iterations, testSuite, relations, state, codes);
}

// 2. LLVM lane
let llvmResult = null;
if (runLLVM) {
  const llvmRunner = createLLVMRunner(testSuite);
  try {
    if (llvmWarmupIterations > 0) {
      console.log(`==> Warming LLVM executables (${llvmWarmupIterations} iterations)...`);
      await llvmRunner.run(llvmWarmupIterations);
    }
    llvmResult = await llvmRunner.run(iterations);
  } finally {
    llvmRunner.close();
  }
}

// 3. Wasm lane
let wasmResult = null;
if (runWasm) {
  if (wasmPipe) {
    const wasmCases = testSuite.filter(tc => tc.wasm?.status === "ok");
    if (wasmCases.length === testSuite.length) {
      const wasmRunner = createWasmRunner(testSuite);
      try {
        if (wasmWarmupIterations > 0) {
          console.log(`==> Warming WebAssembly (${wasmWarmupIterations} iterations)...`);
          await wasmRunner.run(wasmWarmupIterations);
        }
        console.log(`==> Running WebAssembly (${iterations} iterations)...`);
        wasmResult = await wasmRunner.run(iterations);
      } finally {
        wasmRunner.close();
      }
    }
  } else {
    if (wasmWarmupIterations > 0) {
      console.log(`==> Warming WebAssembly (${wasmWarmupIterations} iterations)...`);
      for (let i = 0; i < wasmWarmupIterations; i++) {
        for (const tc of testSuite) {
          const mark = wasmReset ? wasmExports.arena_mark() : 0;
          const funcName = cleanName(state.relAliases[benchNames[tc.op]]);
          const res = wasmExports[funcName](tc.wasmPtrIn);
          assert.ok(res[1] === 1);
          if (wasmReset) wasmExports.arena_reset(mark);
        }
      }
    }

    wasmResult = runTimedIterations(iterations, () => {
      for (const tc of testSuite) {
        const mark = wasmReset ? wasmExports.arena_mark() : 0;
        const funcName = cleanName(state.relAliases[benchNames[tc.op]]);
        const res = wasmExports[funcName](tc.wasmPtrIn);
        assert.ok(res[1] === 1);
        if (wasmReset) wasmExports.arena_reset(mark);
      }
    });
  }
}

// 4. PKIR lane
let pkirResult = null;
if (runPKIR) {
  const pkirCases = testSuite.filter(tc => tc.pkir?.status === "ok");
  if (pkirCases.length === testSuite.length) {
    const pkirRunner = createPKIRRunner(testSuite);
    try {
      if (wasmWarmupIterations > 0) {
        console.log(`==> Warming PKIR (${wasmWarmupIterations} iterations)...`);
        await pkirRunner.run(wasmWarmupIterations);
      }
      console.log(`==> Running PKIR (${iterations} iterations)...`);
      pkirResult = await pkirRunner.run(iterations);
    } finally {
      pkirRunner.close();
    }
  }
}

console.log("\n=================== INTEGER BENCHMARK RESULTS ===================");
console.log(`Operation calls per iteration: ${testSuite.length}`);
console.log(`Total requested operation calls: ${iterations * testSuite.length}`);
console.log("-----------------------------------------------------------------");
let laneIndex = 1;
if (runBaselines) {
  console.log(`${laneIndex++}. Native JS (Envelope-Aware):   ${formatTiming(nativeAwareResult)}`);
  console.log(`${laneIndex++}. Native JS (Envelope-Free):    ${formatTiming(nativeFreeResult)}`);
  console.log(`${laneIndex++}. kVM Interpreter (Env-Free):   ${formatTiming(kvmFreeResult)}`);
}
if (runLLVM) {
  console.log(`${laneIndex++}. ${llvmLaneName().padEnd(29)} ${formatTiming(llvmResult)}`);
}
if (runWasm) {
  console.log(`${laneIndex++}. ${wasmLaneName().padEnd(29)} ${formatTiming(wasmResult)}`);
}
if (runPKIR) {
  console.log(`${laneIndex++}. ${pkirLaneName().padEnd(29)} ${formatTiming(pkirResult)}`);
}
console.log("=================================================================\n");

// Conformance Validation
for (const tc of testSuite) {
  if (runBaselines) {
    const kvmActual = runKVMCase(tc, relations, state, codes);
    assert.deepEqual(toPlainObject(kvmActual), toPlainObject(tc.expected));
  }

  if (runLLVM) {
    if (tc.llvm.status !== "ok") {
      tc.llvmConformance = "compile-failed";
    } else {
      try {
        const outputWire = await runExecutable(tc.llvm.exePath, tc.inputWire);
        const actual = decodeWire(outputWire).value;
        assert.deepEqual(toPlainObject(actual), toPlainObject(tc.expected));
        tc.llvmConformance = "ok";
      } catch (error) {
        tc.llvmConformance = "failed";
        tc.llvm.error = error.stack || error.message || String(error);
        console.log(`LLVM conformance failure for ${tc.op}(${tc.label}):`);
        console.log(tc.llvm.error.split("\n").slice(0, 8).join("\n"));
      }
    }
  }

  if (runWasm) {
    if (wasmPipe) {
      if (tc.wasm?.status !== "ok") {
        tc.wasmConformance = "compile-failed";
      } else {
        try {
          const outputWire = await runExecutable(tc.wasm.exePath, tc.inputWire);
          const actual = decodeWire(outputWire).value;
          assert.deepEqual(toPlainObject(actual), toPlainObject(tc.expected));
          tc.wasmConformance = "ok";
        } catch (error) {
          tc.wasmConformance = "failed";
          tc.wasm.error = error.stack || error.message || String(error);
          console.log(`Wasm conformance failure for ${tc.op}(${tc.label}):`);
          console.log(tc.wasm.error.split("\n").slice(0, 8).join("\n"));
        }
      }
    } else {
      try {
        const funcName = cleanName(state.relAliases[benchNames[tc.op]]);
        const res = wasmExports[funcName](tc.wasmPtrIn);
        assert.ok(res[1] === 1, `Wasm function ${funcName} execution failed`);
        const actual = readArenaValue(
          wasmExports,
          res[0],
          tc.wasmOutputPattern,
          0,
          tc.wasmOutputPatternPropertyList
        );
        assert.deepEqual(toPlainObject(actual), toPlainObject(tc.expected));
        tc.wasmConformance = "ok";
      } catch (error) {
        tc.wasmConformance = "failed";
        console.log(`Wasm conformance failure for ${tc.op}(${tc.label}):`, error);
      }
    }
  }

  if (runPKIR) {
    if (tc.pkir?.status !== "ok") {
      tc.pkirConformance = "compile-failed";
    } else {
      try {
        const outputWire = await runExecutable(tc.pkir.exePath, tc.inputWire);
        const actual = decodeWire(outputWire).value;
        assert.deepEqual(toPlainObject(actual), toPlainObject(tc.expected));
        tc.pkirConformance = "ok";
      } catch (error) {
        tc.pkirConformance = "failed";
        tc.pkir.error = error.stack || error.message || String(error);
        console.log(`PKIR conformance failure for ${tc.op}(${tc.label}):`);
        console.log(tc.pkir.error.split("\n").slice(0, 8).join("\n"));
      }
    }
  }

}

const validationSummary = [];
if (runBaselines) validationSummary.push("kVM");
if (runLLVM) {
  const llvmOk = testSuite.filter(tc => tc.llvmConformance === "ok").length;
  validationSummary.push(`LLVM ${llvmOk}/${testSuite.length}`);
}
if (runWasm) {
  const wasmOk = testSuite.filter(tc => tc.wasmConformance === "ok").length;
  validationSummary.push(`Wasm ${wasmOk}/${testSuite.length}`);
}
if (runPKIR) {
  const pkirOk = testSuite.filter(tc => tc.pkirConformance === "ok").length;
  validationSummary.push(`PKIR ${pkirOk}/${testSuite.length}`);
}

console.log(`Conformance validation: ${validationSummary.join(", ")} cases match expected values.`);
if (runLLVM && shouldStrictFail(testSuite)) process.exitCode = 1;
if (runWasm && testSuite.some(tc => tc.wasmConformance !== "ok")) process.exitCode = 1;
if (runPKIR && testSuite.some(tc => tc.pkirConformance !== "ok")) process.exitCode = 1;

// =======================================================================
// Squaring Scale & Memory Profiling Benchmark
// Expressions: s = {()x,()y}times; and s = {()x,()y}karatsuba;
// =======================================================================

function countBitsValue(val) {
  let count = 0;
  let cur = val?.tag === "+" || val?.tag === "-" ? val.value : val;
  while (cur && (cur.tag === "0" || cur.tag === "1")) {
    count++;
    cur = cur.value;
  }
  return count;
}

function getProcessMemory(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const vmrss = status.match(/VmRSS:\s+(\d+)\s+kB/);
    const vmhwm = status.match(/VmHWM:\s+(\d+)\s+kB/);
    return {
      rssMb: vmrss ? Number((parseInt(vmrss[1], 10) / 1024).toFixed(1)) : null,
      peakRssMb: vmhwm ? Number((parseInt(vmhwm[1], 10) / 1024).toFixed(1)) : null
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

const squaringSteps = parsePositiveIntEnv("SQUARING_STEPS", 10);
const squaringInputText = process.env.SQUARING_INPUT || "987654321";
const squaringStepTimeoutMs = parsePositiveIntEnv("SQUARING_STEP_TIMEOUT_MS", 60000);

console.log("\n=================== SQUARING SCALE & MEMORY BENCHMARK ===================");
console.log(`Algorithms: times vs karatsuba (${squaringSteps} successive squarings doubling bit length)`);

// Load and initialize Karatsuba multiplication relation
const karatsubaPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/karatsuba-mult.k"));
const karatsubaSource = fs.readFileSync(karatsubaPath, "utf8");
const karatsubaLibrarySource = karatsubaSource.replace(/\s*\(\)\s*$/, "\n");
const stateKara = createState();
await evaluateInput(`:load ${karatsubaPath}`, stateKara);
codes.load(stateKara.codes);

const sInitialVal = intValue(squaringInputText);
const { inputWire: sInitWire, inputPattern: sInputPattern } = wireInput(sInitialVal);

const squaringAlgos = [
  {
    id: "times",
    name: "times",
    title: "Long Multiplication (times)",
    expr: "s = {()x,()y}times;",
    librarySource: arithmeticsLibrarySource,
    sourceLabel: "@fraczak/k/Examples/arithmetics.k#s",
    state: state,
    relName: "s"
  },
  {
    id: "karatsuba",
    name: "karatsuba",
    title: "Karatsuba Multiplication (karatsuba)",
    expr: "s = {()x,()y}karatsuba;",
    librarySource: karatsubaLibrarySource,
    sourceLabel: "@fraczak/k/Examples/karatsuba-mult.k#s",
    state: stateKara,
    relName: "s"
  }
];

// Build executables for persistent servers
for (const algo of squaringAlgos) {
  await evaluateInput(algo.expr, algo.state);
  codes.load(algo.state.codes);
  algo.rel = prepareRelation(algo.state, algo.relName, {
    source: `${algo.librarySource}\n${algo.expr}\n${algo.relName}`,
    sourceLabel: algo.sourceLabel
  });

  algo.llvmServer = null;
  if (runLLVM) {
    const sLlvmCompiled = tryCompileCase({
      object: algo.rel.object,
      relationName: algo.rel.relationName,
      relHash: algo.rel.relHash,
      inputPattern: sInputPattern,
      cacheDir,
      sourceLabel: algo.sourceLabel
    });
    if (sLlvmCompiled.status === "ok") {
      algo.llvmServer = new PersistentExecutable(sLlvmCompiled.exePath);
    }
  }

  algo.wasmServer = null;
  if (runWasm && !squaringLlvmOnly) {
    try {
      const sWasmPath = path.join(cacheDir, `perf_int_wasm_${algo.id}.wasm`);
      const sWasmExe = path.join(cacheDir, `perf_int_wasm_${algo.id}.exe`);
      const wasmBuf = await compileWasmArtifactFromObject(algo.rel.object, { entry: "__main__" });
      fs.writeFileSync(sWasmPath, wasmBuf);
      const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
      fs.writeFileSync(sWasmExe, `#!/bin/sh\nexec node "${runBin}" "${sWasmPath}" "$@"\n`, { mode: 0o755 });
      algo.wasmServer = new PersistentExecutable(sWasmExe);
    } catch (e) {
      console.log(`Failed to build Wasm executable for '${algo.id}':`, e.message);
    }
  }

  algo.pkirServer = null;
  if (runPKIR && !squaringLlvmOnly) {
    try {
      const sPkirPath = path.join(cacheDir, `perf_int_pkir_${algo.id}.wasm`);
      const sPkirExe = path.join(cacheDir, `perf_int_pkir_${algo.id}.exe`);
      const wasmBuf = await compileWasmArtifactFromObject(algo.rel.object, {
        entry: "__main__",
        usePKIR: true
      });
      fs.writeFileSync(sPkirPath, wasmBuf);
      const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
      fs.writeFileSync(sPkirExe, `#!/bin/sh\nexec node "${runBin}" "${sPkirPath}" "$@"\n`, { mode: 0o755 });
      algo.pkirServer = new PersistentExecutable(sPkirExe);
    } catch (e) {
      console.log(`Failed to build PKIR executable for '${algo.id}':`, e.message);
    }
  }

  algo.results = {};
}

const squaringLanes = [];
if (runBaselines && !squaringLlvmOnly) {
  squaringLanes.push({ id: "jsAware", name: "Native JS (Aware)", type: "jsAware", memLabel: "heap" });
  squaringLanes.push({ id: "jsFree", name: "Native JS (Free)", type: "jsFree", memLabel: "heap" });
  squaringLanes.push({ id: "kvm", name: "kVM (Env-Free)", type: "kvm", memLabel: "heap" });
}
if (runLLVM) {
  squaringLanes.push({ id: "llvm", name: llvmLaneName(), type: "persistent", memLabel: "peak RSS" });
}
if (runWasm && !squaringLlvmOnly) {
  squaringLanes.push({ id: "wasm", name: wasmLaneName(), type: "persistent", memLabel: "peak RSS" });
}
if (runPKIR && !squaringLlvmOnly) {
  squaringLanes.push({ id: "pkir", name: pkirLaneName(), type: "persistent", memLabel: "peak RSS" });
}

for (const algo of squaringAlgos) {
  for (const lane of squaringLanes) {
    algo.results[lane.id] = [];
  }
}
const stepMetadata = [];

try {
  // 1. Persistent child processes (Wasm, PKIR, LLVM)
  for (const lane of squaringLanes.filter(l => l.type === "persistent")) {
    for (const algo of squaringAlgos) {
      const server = lane.id === "llvm"
        ? algo.llvmServer
        : lane.id === "pkir"
          ? algo.pkirServer
          : algo.wasmServer;
      if (!server) continue;
      console.log(`==> Running ${lane.name} squaring [${algo.name}]...`);
      let curWire = sInitWire;
      for (let step = 1; step <= squaringSteps; step++) {
        try {
          const t0 = performance.now();
          curWire = await server.request(curWire);
          const t1 = performance.now();
          const timeMs = t1 - t0;
          const mem = getProcessMemory(server.child.pid);
          algo.results[lane.id].push({ status: "ok", timeMs, memMb: mem.peakRssMb, wire: curWire });
          if (!stepMetadata[step - 1]) {
            stepMetadata[step - 1] = {
              wireLen: curWire.length,
              bits: null,
              canonicalWire: curWire
            };
          }
          if (timeMs > squaringStepTimeoutMs) break;
        } catch (e) {
          algo.results[lane.id].push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
          break;
        }
      }
    }
  }

  // 2. In-process baselines (JS Aware, JS Free, kVM)
  if (runBaselines && !squaringLlvmOnly) {
    for (const algo of squaringAlgos) {
      // JS Aware
      console.log(`==> Running Native JS (Aware) squaring [${algo.name}]...`);
      let curValAware = sInitialVal;
      run.defs = algo.state;
      for (let step = 1; step <= squaringSteps; step++) {
        try {
          const t0 = performance.now();
          curValAware = run(codes.find, algo.rel.relDef.def, curValAware, algo.rel.relDef.typePatternGraph);
          const t1 = performance.now();
          const timeMs = t1 - t0;
          const mem = getNodeMemory();
          algo.results.jsAware.push({ status: "ok", timeMs, memMb: mem.heapMb, value: curValAware });
          if (stepMetadata[step - 1] && stepMetadata[step - 1].bits == null) {
            stepMetadata[step - 1].bits = countBitsValue(curValAware);
          }
          if (timeMs > squaringStepTimeoutMs) break;
        } catch (e) {
          algo.results.jsAware.push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
          break;
        }
      }

      // JS Free
      console.log(`==> Running Native JS (Free) squaring [${algo.name}]...`);
      let curValFree = sInitialVal;
      run_converged.defs = algo.state;
      for (let step = 1; step <= squaringSteps; step++) {
        try {
          const t0 = performance.now();
          curValFree = run_converged(codes.find, algo.rel.relDef.def, curValFree, algo.rel.relDef.typePatternGraph);
          const t1 = performance.now();
          const timeMs = t1 - t0;
          const mem = getNodeMemory();
          algo.results.jsFree.push({ status: "ok", timeMs, memMb: mem.heapMb, value: curValFree });
          if (stepMetadata[step - 1] && stepMetadata[step - 1].bits == null) {
            stepMetadata[step - 1].bits = countBitsValue(curValFree);
          }
          if (timeMs > squaringStepTimeoutMs) break;
        } catch (e) {
          algo.results.jsFree.push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
          break;
        }
      }

      // kVM
      console.log(`==> Running kVM Interpreter squaring [${algo.name}]...`);
      let curValKvm = sInitialVal;
      const kvmContext = { rels: algo.state.rels, findCode: codes.find, options: { envelopeFree: true } };
      for (let step = 1; step <= squaringSteps; step++) {
        try {
          const t0 = performance.now();
          curValKvm = executeKVM(algo.rel.kvmFunc, curValKvm, kvmContext);
          const t1 = performance.now();
          const timeMs = t1 - t0;
          const mem = getNodeMemory();
          algo.results.kvm.push({ status: "ok", timeMs, memMb: mem.heapMb, value: curValKvm });
          if (stepMetadata[step - 1] && stepMetadata[step - 1].bits == null) {
            stepMetadata[step - 1].bits = countBitsValue(curValKvm);
          }
          if (timeMs > squaringStepTimeoutMs) break;
        } catch (e) {
          algo.results.kvm.push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
          break;
        }
      }
    }
  }
} finally {
  for (const algo of squaringAlgos) {
    if (algo.wasmServer) algo.wasmServer.close();
    if (algo.pkirServer) algo.pkirServer.close();
    if (algo.llvmServer) algo.llvmServer.close();
  }
}

// For any remaining steps without bit counts, decode canonicalWire safely
for (let step = 1; step <= squaringSteps; step++) {
  const meta = stepMetadata[step - 1];
  if (meta && meta.bits == null && meta.canonicalWire) {
    try {
      const decoded = decodeWire(meta.canonicalWire).value;
      meta.bits = countBitsValue(decoded);
    } catch {}
  }
}

// Display results table
const sep130 = "=".repeat(130);
const line130 = "-".repeat(130);

if (squaringLanes.length === 1 && squaringLanes[0].id === "llvm") {
  // LLVM Only side-by-side comparison table
  console.log(`\n${sep130}`);
  console.log("=================== SQUARING SCALE & ALGORITHM BENCHMARK (LLVM) ===================");
  console.log(`Algorithms: times vs karatsuba on ${squaringLanes[0].name}`);
  console.log(`Initial: ${squaringInputText} (${countBitsValue(sInitialVal)} bits)`);
  console.log(line130);

  const tAlgo = squaringAlgos[0];
  const kAlgo = squaringAlgos[1];
  const colW = [4, 6, 7, 34, 34, 15];
  const hCols = [
    "Step",
    "Bits",
    "Wire(B)",
    "LLVM times (peak RSS)",
    "LLVM karatsuba (peak RSS)",
    "Speedup (T/K)"
  ];
  console.log(hCols.map((h, i) => (i < 3 ? h.padStart(colW[i]) : h.padEnd(colW[i]))).join(" | "));
  console.log(colW.map(w => "-".repeat(w)).join("-|-"));

  for (let step = 1; step <= squaringSteps; step++) {
    const meta = stepMetadata[step - 1] || { bits: "?", wireLen: "?" };
    const tRes = tAlgo.results.llvm[step - 1];
    const kRes = kAlgo.results.llvm[step - 1];

    const formatCell = (res, w) => {
      if (!res) return "-".padEnd(w);
      if (res.status === "ok") {
        const t = res.timeMs < 10 ? `${res.timeMs.toFixed(2)}ms` : `${res.timeMs.toFixed(1)}ms`;
        const m = res.memMb != null ? `${res.memMb}MB` : "";
        return `${t} / ${m}`.padEnd(w);
      }
      let errText = res.error || "error";
      if (errText.includes("Maximum call stack")) errText = "Stack overflow (V8)";
      else if (errText.includes("status null") || errText.includes("failed with status")) errText = "Arena limit reached";
      return errText.slice(0, w - 1).padEnd(w);
    };

    let speedupStr = "-";
    if (tRes?.status === "ok" && kRes?.status === "ok" && kRes.timeMs > 0) {
      speedupStr = `${(tRes.timeMs / kRes.timeMs).toFixed(2)}x`;
    }

    const row = [
      String(step).padStart(colW[0]),
      String(meta.bits ?? "?").padStart(colW[1]),
      String(meta.wireLen ?? "?").padStart(colW[2]),
      formatCell(tRes, colW[3]),
      formatCell(kRes, colW[4]),
      speedupStr.padEnd(colW[5])
    ];
    console.log(row.join(" | "));
  }
  console.log(sep130);
} else {
  // Print each algorithm table
  for (const algo of squaringAlgos) {
    console.log(`\n${sep130}`);
    console.log(`=================== SQUARING SCALE: ${algo.title.toUpperCase()} ===================`);
    console.log(`Expression: ${algo.expr} ${squaringInputText} ${"s ".repeat(squaringSteps).trim()}`);
    console.log(`Initial: ${squaringInputText} (${countBitsValue(sInitialVal)} bits)`);
    console.log(line130);

    const headerCols = ["Step", "Bits", "Wire(B)", ...squaringLanes.map(l => `${l.name} (${l.memLabel})`)];
    const colWidths = [4, 6, 7, ...squaringLanes.map(l => Math.max(22, l.name.length + l.memLabel.length + 5))];
    console.log(headerCols.map((h, i) => (i < 3 ? h.padStart(colWidths[i]) : h.padEnd(colWidths[i]))).join(" | "));
    console.log(colWidths.map(w => "-".repeat(w)).join("-|-"));

    for (let step = 1; step <= squaringSteps; step++) {
      const meta = stepMetadata[step - 1] || { bits: "?", wireLen: "?" };
      const cols = [
        String(step).padStart(colWidths[0]),
        String(meta.bits ?? "?").padStart(colWidths[1]),
        String(meta.wireLen ?? "?").padStart(colWidths[2])
      ];
      for (let li = 0; li < squaringLanes.length; li++) {
        const lane = squaringLanes[li];
        const res = algo.results[lane.id][step - 1];
        const w = colWidths[3 + li];
        if (!res) {
          cols.push("-".padEnd(w));
        } else if (res.status === "ok") {
          const t = res.timeMs < 10 ? `${res.timeMs.toFixed(2)}ms` : `${res.timeMs.toFixed(1)}ms`;
          const m = res.memMb != null ? `${res.memMb}MB` : "";
          cols.push(`${t} / ${m}`.padEnd(w));
        } else {
          let errText = res.error;
          if (errText.includes("Maximum call stack")) {
            errText = "Stack overflow (V8)";
          } else if (errText.includes("status null") || errText.includes("failed with status")) {
            errText = "Arena limit reached";
          }
          cols.push(errText.slice(0, w - 1).padEnd(w));
        }
      }
      console.log(cols.join(" | "));
    }
    console.log(sep130);
  }
}

// Conformance check across all computed steps and algorithms
let squaringConformanceOk = true;
for (let step = 1; step <= squaringSteps; step++) {
  const meta = stepMetadata[step - 1];
  if (!meta?.canonicalWire) continue;
  for (const algo of squaringAlgos) {
    for (const lane of squaringLanes) {
      const res = algo.results[lane.id][step - 1];
      if (res?.status === "ok") {
        if (res.wire) {
          if (Buffer.compare(res.wire, meta.canonicalWire) !== 0) {
            squaringConformanceOk = false;
            console.log(`Squaring conformance mismatch on step ${step} (${algo.name} / ${lane.name})`);
          }
        } else if (res.value) {
          try {
            const wireVal = decodeWire(meta.canonicalWire).value;
            if (!safeDeepEqual(res.value, wireVal)) {
              squaringConformanceOk = false;
              console.log(`Squaring conformance mismatch on step ${step} (${algo.name} / ${lane.name})`);
            }
          } catch {}
        }
      }
    }
  }
}

console.log("\nSquaring Performance & Scaling Summary:");
for (const algo of squaringAlgos) {
  console.log(`  Algorithm: ${algo.title}`);
  for (const lane of squaringLanes) {
    const okSteps = algo.results[lane.id].filter(r => r.status === "ok");
    const maxStep = okSteps.length;
    const lastOk = okSteps[okSteps.length - 1];
    const peakMem = okSteps.reduce((max, r) => Math.max(max, r.memMb || 0), 0);
    const failureReason = algo.results[lane.id][maxStep]?.error;
    let statusDetail = "";
    if (failureReason) {
      if (failureReason.includes("Maximum call stack")) statusDetail = " (V8 call stack overflow)";
      else if (failureReason.includes("status null") || failureReason.includes("failed with status")) statusDetail = " (arena capacity limit reached)";
      else statusDetail = ` (${failureReason.slice(0, 30)})`;
    }
    const timeStr = lastOk ? ` (step ${maxStep} in ${lastOk.timeMs < 10 ? lastOk.timeMs.toFixed(2) : lastOk.timeMs.toFixed(1)}ms)` : "";
    console.log(`    - ${lane.name.padEnd(32)}: reached Step ${String(maxStep).padStart(2)}/${squaringSteps}${timeStr}, peak ${lane.memLabel}: ${peakMem}MB${statusDetail}`);
  }
}

if (squaringConformanceOk) {
  console.log("\nSquaring Conformance: All completed squaring steps match expected values across all backends!\n");
} else {
  console.log("\nSquaring Conformance: Warning, some step outputs differed between backends!\n");
  process.exitCode = 1;
}
