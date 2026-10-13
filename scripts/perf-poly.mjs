import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wabtFactory from "wabt";

import {
  codes,
  decodeWire,
  encodeToWire,
  executeKVM,
  exportPatternGraph,
  patternToPropertyList,
  propertyListToPattern,
  run,
  run_converged,
  valueForCode,
  Value
} from "@fraczak/k/backend-api.mjs";
import { compileLibrary, loadLibrary } from "@fraczak/k/object.mjs";
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
  toPlainObject,
  safeDeepEqual,
  tryCompileCase,
  wireInput,
  PersistentExecutable
} from "../backends/llvm/tests/perf-support.mjs";

import {
  cleanName,
  instantiateWasmModule,
  readArenaValue,
  readWasmProfile,
  resetWasmProfile,
  writeValueToArena
} from "../backends/wasm/tests/perf-support.mjs";

import { compileWasmArtifactFromObject } from "../backends/wasm/src/wasm.mjs";
import { inputPatternForObjectRelation } from "../backends/llvm/src/executable.mjs";

function printHelp() {
  console.log(`Usage: node scripts/perf-poly.mjs [options]

Polymorphic List Operations Benchmark Harness.
Benchmarks reverse, concat, split_by, get_nth, and length on
Examples/poly.k across Native JS, kVM interpreter, LLVM, Wasm, and PKIR.

Options:
  --trace
      Enable 7-phase nanosecond execution timing.
  --profile
      Enable per-function call count profiling.
  --wasm-in-process
      Run WebAssembly in-process instead of persistent subprocess runner.
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
  LIST_LENGTH
      Workload size for list operations (default: 40).
  ITERATIONS
      Measured iterations per benchmark (default: 3).
  TRACE, K_TRACE
      Enable nanosecond execution tracing ('1' to enable).
  PROFILE, K_PROFILE
      Enable per-function call count profiling ('1' to enable).
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
      Run WebAssembly in-process ('1' to enable).`);
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
const llvmPkirOnly = process.env.LLVM_PKIR_ONLY === "1"
  || (backendsList && backendsList.length === 1 &&
      backendsList[0] === "llvm-pkir")
  || process.argv.includes("--llvm-pkir-only");
const llvmUsePKIR = llvmPkirOnly
  || (backendsList && backendsList.includes("llvm-pkir"))
  || process.argv.includes("--llvm-pkir");
const pkirOnly = !llvmPkirOnly && (
  process.env.PKIR_ONLY === "1"
  || (backendsList && backendsList.length === 1 &&
      backendsList[0] === "pkir")
  || process.argv.includes("--pkir-only")
);
const llvmOnly = !pkirOnly && !llvmPkirOnly && (
  process.env.LLVM_ONLY === "1"
  || (backendsList && backendsList.length === 1 &&
      backendsList[0] === "llvm")
);
const wasmOnly = !pkirOnly && !llvmPkirOnly && (
  process.env.WASM_ONLY === "1"
  || (backendsList && backendsList.length === 1 &&
      backendsList[0] === "wasm")
);
const runLLVM = backendsList
  ? (backendsList.includes("llvm") ||
     backendsList.includes("llvm-pkir"))
  : !wasmOnly && !pkirOnly;
const runWasm = backendsList
  ? backendsList.includes("wasm")
  : !llvmOnly && !pkirOnly && !llvmPkirOnly;
const runPKIR = backendsList
  ? backendsList.includes("pkir")
  : !llvmOnly && !wasmOnly && !llvmPkirOnly;
const runBaselines = !process.env.BACKENDS_ONLY
  && (backendsList == null || backendsList.includes("kvm") ||
      backendsList.includes("js"))
  && !llvmOnly && !wasmOnly && !pkirOnly && !llvmPkirOnly;

function activeLlvmLaneName() {
  const base = llvmLaneName();
  return llvmUsePKIR ? base.replace("LLVM", "LLVM-PKIR") : base;
}

const ops = ["reverse", "concat", "split_by", "get_nth", "length"];
const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));
const listLength = parsePositiveIntEnv("LIST_LENGTH", 40);
const iterations = parsePositiveIntEnv("ITERATIONS", 3);
const runTrace = process.argv.includes("--trace") || process.env.TRACE === "1" || process.env.K_TRACE === "1";
const runProfile = runTrace || process.argv.includes("--profile") || process.env.K_PROFILE === "1" || process.env.PROFILE === "1";

// LLVM options
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const cacheDir = makeCacheDir("k-poly-perf-");

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


console.log("==> Loading @fraczak/k/Examples/arithmetics.k as library");
const arithmeticsPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/arithmetics.k"));
const arithmeticsSource = fs.readFileSync(arithmeticsPath, "utf8");
const arithmeticsLib = loadLibrary(compileLibrary(arithmeticsSource, { source: arithmeticsPath }));

console.log("==> Compiling @fraczak/k/Examples/poly.k with explicit library exports");
const polyPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/poly.k"));
const polySource = fs.readFileSync(polyPath, "utf8");

function buildExportPreamble(exports, libraries) {
  const aliasMap = {};
  for (const lib of libraries) {
    for (const [name, hash] of Object.entries(lib.relAlias || {})) {
      if (name !== "__main__") aliasMap[name] = hash;
    }
  }
  const lines = [];
  for (const spec of exports) {
    const [libName, localName] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
    const hash = aliasMap[libName];
    if (!hash) throw new Error(`--export: '${libName}' not found in loaded libraries`);
    const body = hash.startsWith("@") ? hash.slice(1) : hash;
    lines.push(`${localName} = @${body};`);
  }
  return lines.join("\n") + "\n";
}

const neededExports = ["0", "int", "inc", "dec", "nat", "zero_int?", "neg?", "GT"];
const exportPreamble = buildExportPreamble(neededExports, [arithmeticsLib]);
const polyLib = loadLibrary(compileLibrary(exportPreamble + polySource, {
  source: polyPath,
  libraries: [arithmeticsLib]
}));

const state = {
  codes: { ...arithmeticsLib.codes, ...polyLib.codes },
  rels: { ...arithmeticsLib.rels, ...polyLib.rels },
  typeAliases: {},
  relAliases: { ...polyLib.relAlias },
  meta: { ...arithmeticsLib.meta, ...polyLib.meta }
};
for (const [hash, entry] of Object.entries(arithmeticsLib.meta)) {
  if (entry.type === "code") {
    for (const origin of entry.origins || []) {
      if (origin.name) state.typeAliases[origin.name] = hash;
    }
  }
}
for (const op of ops) {
  state.relAliases[benchNames[op]] = polyLib.relAlias[op];
}

function intValue(text) {
  return parseIntValue(text);
}

function makeList(elements) {
  let curr = Value.variant("nil", Value.product({}));
  for (let i = elements.length - 1; i >= 0; i--) {
    curr = Value.variant("cons", Value.product({
      car: elements[i],
      cdr: curr
    }));
  }
  return curr;
}

console.log("==> Preparing relations");
const relations = {};
for (const op of ops) {
  const name = benchNames[op];
  relations[op] = prepareRelation(state, name);
}
codes.load(state.codes);

console.log(`==> Generating test cases for list length ${listLength}`);
const intElements = Array.from({ length: listLength }, (_, i) => intValue(String(i + 1)));
const fullList = makeList(intElements);
const halfLen = Math.floor(listLength / 2);
const firstHalf = makeList(intElements.slice(0, halfLen));
const secondHalf = makeList(intElements.slice(halfLen));
const midIdx = intValue(String(halfLen));

const rawCases = [
  { op: "reverse", label: `len ${listLength}`, inputVal: fullList },
  { op: "concat", label: `2x len ${halfLen}`, inputVal: Value.product({ xs: firstHalf, ys: secondHalf }) },
  { op: "split_by", label: `at ${halfLen} of ${listLength}`, inputVal: Value.product({ n: midIdx, xs: fullList }) },
  { op: "get_nth", label: `idx ${halfLen} of ${listLength}`, inputVal: Value.product({ n: midIdx, xs: fullList }) },
  { op: "length", label: `len ${listLength}`, inputVal: fullList }
];

const testSuite = [];
for (const tc of rawCases) {
  const relation = relations[tc.op];
  let expected;
  if (!runBaselines || listLength > 400) {
    expected = executeKVM(relation.kvmFunc, tc.inputVal, {
      rels: state.rels,
      codes: state.codes,
      options: { envelopeFree: true }
    });
  } else {
    try {
      run.defs = state;
      run_converged.defs = state;
      expected = run_converged(codes.find, relation.relDef.def, tc.inputVal, relation.relDef.typePatternGraph);
    } catch (err) {
      if (err instanceof RangeError) {
        expected = executeKVM(relation.kvmFunc, tc.inputVal, {
          rels: state.rels,
          codes: state.codes,
          options: { envelopeFree: true }
        });
      } else {
        throw err;
      }
    }
  }
  assert.ok(expected !== undefined, `${tc.op} should produce a value`);

  const inferredPat = inputPatternForObjectRelation(relation.object, relation.relationName);
  const inputWire = encodeToWire(tc.inputVal, inferredPat);
  const inputPattern = decodeWire(inputWire).pattern;

  const outWire = encodeToWire(expected);
  const outputPattern = decodeWire(outWire).pattern;

  testSuite.push({
    op: tc.op,
    label: tc.label,
    inputVal: tc.inputVal,
    inputWire,
    inputPattern,
    outputPattern,
    expected
  });
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
      sourceLabel:
        `@fraczak/k/Examples/poly.k#${relation.relationName}`,
      usePKIR: llvmUsePKIR
    });
  }
  codes.load(state.codes);
  printCompileFailures(testSuite);
}

// Setup Wasm
let wasmExports = null;
let wasmProfileFunctions = [];
const wasmExes = new Map();
if (runWasm) {
  if (wasmPipe) {
    console.log("==> Compiling WebAssembly executables (persistent runner)...");
    for (const tc of testSuite) {
      const relation = relations[tc.op];
      try {
        const wasmPath = path.join(cacheDir, `perf_poly_wasm_${tc.op}.wasm`);
        const exePath = path.join(cacheDir, `perf_poly_wasm_${tc.op}.exe`);
        const wasmBuf = await compileWasmArtifactFromObject(relation.object, {
          entry: relation.relHash
        });
        fs.writeFileSync(wasmPath, wasmBuf);
        const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
        fs.writeFileSync(exePath, `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`, { mode: 0o755 });
        tc.wasm = { status: "ok", exePath, wasmPath };
        wasmExes.set(tc.op, tc.wasm);
      } catch (error) {
        tc.wasm = {
          status: "failed",
          error: error.stack || error.message || String(error)
        };
        wasmExes.set(tc.op, tc.wasm);
      }
    }
  } else {
    console.log("==> Compiling WebAssembly module...");
    const wabtInstance = await wabtFactory();
    const opHashes = ops.map(op => state.relAliases[benchNames[op]]);
    const wasmModule = await instantiateWasmModule(opHashes, state, wabtInstance, { profile: runProfile });
    wasmExports = wasmModule.exports;
    wasmProfileFunctions = wasmModule.profileFunctions || [];

    for (const tc of testSuite) {
      tc.wasmPtrIn = writeValueToArena(wasmExports, tc.inputVal, propertyListToPattern(tc.inputPattern), 0);
    }
  }
}

// Setup PKIR (persistent runner)
const pkirExes = new Map();
if (runPKIR) {
  console.log("==> Compiling PKIR executables (persistent runner)...");
  for (const tc of testSuite) {
    const relation = relations[tc.op];
    try {
      const wasmPath = path.join(cacheDir, `perf_poly_pkir_${tc.op}.wasm`);
      const exePath = path.join(cacheDir, `perf_poly_pkir_${tc.op}.exe`);
      const wasmBuf = await compileWasmArtifactFromObject(relation.object, {
        entry: relation.relHash,
        usePKIR: true
      });
      fs.writeFileSync(wasmPath, wasmBuf);
      const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
      fs.writeFileSync(exePath, `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`, { mode: 0o755 });
      tc.pkir = { status: "ok", exePath, wasmPath };
      pkirExes.set(tc.op, tc.pkir);
    } catch (error) {
      tc.pkir = {
        status: "failed",
        error: error.stack || error.message || String(error)
      };
      pkirExes.set(tc.op, tc.pkir);
    }
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
  if (runLLVM) lanes.push(activeLlvmLaneName());
  if (runWasm) lanes.push(wasmLaneName());
  if (runPKIR) lanes.push(pkirLaneName());

  console.log("==> Benchmark description");
  console.log("    source: @fraczak/k/Examples/poly.k");
  console.log(`    benchmark relations: ${Object.values(benchNames).join(", ")}`);
  console.log(`    operations: ${ops.join(", ")}`);
  console.log(`    list length: ${listLength} elements`);
  console.log(`    cases: ${testSuite.length} polymorphic operations`);
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
console.log(`==> Running Polymorphic Performance Test (${testSuite.length} cases, Iterations: ${iterations})...`);

// 1. Common baseline lanes
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
    console.log(`==> Running LLVM (${iterations} iterations)...`);
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

    console.log(`==> Running WebAssembly (${iterations} iterations)...`);
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

console.log("\n=================== POLYMORPHIC BENCHMARK RESULTS ===================");
console.log(`Polymorphic operations per iteration: ${testSuite.length}`);
console.log(`Total requested operation calls: ${iterations * testSuite.length}`);
console.log("---------------------------------------------------------------------");
let laneIndex = 1;
if (runBaselines) {
  console.log(`${laneIndex++}. Native JS (Envelope-Aware):   ${formatTiming(nativeAwareResult)}`);
  console.log(`${laneIndex++}. Native JS (Envelope-Free):    ${formatTiming(nativeFreeResult)}`);
  console.log(`${laneIndex++}. kVM Interpreter (Env-Free):   ${formatTiming(kvmFreeResult)}`);
}
if (runLLVM) {
  const name = activeLlvmLaneName().padEnd(29);
  console.log(`${laneIndex++}. ${name} ${formatTiming(llvmResult)}`);
}
if (runWasm) {
  console.log(`${laneIndex++}. ${wasmLaneName().padEnd(29)} ${formatTiming(wasmResult)}`);
}
if (runPKIR) {
  console.log(`${laneIndex++}. ${pkirLaneName().padEnd(29)} ${formatTiming(pkirResult)}`);
}
console.log("=====================================================================\n");

// Conformance Validation
for (const tc of testSuite) {
  if (runBaselines) {
    const kvmActual = runKVMCase(tc, relations, state, codes);
    assert.ok(safeDeepEqual(kvmActual, tc.expected), `kVM output mismatch for ${tc.op}`);
  }

  if (runLLVM) {
    if (tc.llvm.status !== "ok") {
      tc.llvmConformance = "compile-failed";
    } else {
      try {
        const outputWire = await runExecutable(tc.llvm.exePath, tc.inputWire);
        const actual = decodeWire(outputWire).value;
        assert.ok(safeDeepEqual(actual, tc.expected), `LLVM output mismatch for ${tc.op}`);
        tc.llvmConformance = "ok";
      } catch (error) {
        tc.llvmConformance = "failed";
        tc.llvm.error = error.stack || error.message || String(error);
        console.log(`LLVM conformance failure for ${tc.op}:`, tc.llvm.error.split("\n")[0]);
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
          assert.ok(safeDeepEqual(actual, tc.expected), `Wasm output mismatch for ${tc.op}`);
          tc.wasmConformance = "ok";
        } catch (error) {
          tc.wasmConformance = "failed";
          tc.wasm.error = error.stack || error.message || String(error);
          console.log(`Wasm conformance failure for ${tc.op}:`, tc.wasm.error.split("\n")[0]);
        }
      }
    } else {
      try {
        const mark = wasmReset ? wasmExports.arena_mark() : 0;
        const funcName = cleanName(state.relAliases[benchNames[tc.op]]);
        const res = wasmExports[funcName](tc.wasmPtrIn);
        assert.ok(res[1] === 1, `Wasm function ${funcName} failed`);
        const actual = readArenaValue(
          wasmExports,
          res[0],
          propertyListToPattern(tc.outputPattern),
          0,
          tc.outputPattern
        );
        assert.ok(safeDeepEqual(actual, tc.expected), `Wasm output mismatch for ${tc.op}`);
        if (wasmReset) wasmExports.arena_reset(mark);
        tc.wasmConformance = "ok";
      } catch (error) {
        tc.wasmConformance = "failed";
        console.log(`Wasm conformance failure for ${tc.op}:`, error);
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
        assert.ok(safeDeepEqual(actual, tc.expected), `PKIR output mismatch for ${tc.op}`);
        tc.pkirConformance = "ok";
      } catch (error) {
        tc.pkirConformance = "failed";
        tc.pkir.error = error.stack || error.message || String(error);
        console.log(`PKIR conformance failure for ${tc.op}:`, tc.pkir.error.split("\n")[0]);
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

if (runTrace && process.exitCode !== 1) {
  console.log("\n=================== RUNNING MACRO-PHASE TRACING ===================");
  const sampleReps = parsePositiveIntEnv("TRACE_SAMPLES", 10);
  console.log(`Collecting phase timings (averaged over 3 warmup + ${sampleReps} sample calls)...`);

  const llvmServers = new Map();
  if (runLLVM) {
    for (const tc of testSuite) {
      if (tc.llvm?.status === "ok") {
        llvmServers.set(tc.op, new PersistentExecutable(tc.llvm.exePath));
      }
    }
  }

  const wasmServers = new Map();
  if (runWasm && wasmPipe) {
    for (const tc of testSuite) {
      if (tc.wasm?.status === "ok") {
        wasmServers.set(tc.op, new PersistentExecutable(tc.wasm.exePath));
      }
    }
  }

  const pkirServers = new Map();
  if (runPKIR) {
    for (const tc of testSuite) {
      if (tc.pkir?.status === "ok") {
        pkirServers.set(tc.op, new PersistentExecutable(tc.pkir.exePath));
      }
    }
  }

  const averageTrace = (samples) => {
    if (!samples || samples.length === 0) return null;
    const avg = {};
    const keys = ["ipcReadNs", "decodeNs", "flatInNs", "evalNs", "flatOutNs", "encodeNs", "ipcWriteNs", "totalNs"];
    for (const key of keys) {
      avg[key] = samples.reduce((sum, s) => sum + (s[key] || 0), 0) / samples.length;
    }
    return avg;
  };

  const kvmHashToName = new Map();
  for (const [alias, h] of Object.entries(state.relAliases)) {
    const current = kvmHashToName.get(h);
    if (!current) {
      kvmHashToName.set(h, alias);
    } else {
      const currentIsBench = current.startsWith("bench_");
      const aliasIsBench = alias.startsWith("bench_");
      if (currentIsBench && !aliasIsBench) {
        kvmHashToName.set(h, alias);
      } else if (currentIsBench === aliasIsBench && alias.length < current.length) {
        kvmHashToName.set(h, alias);
      }
    }
  }

  const phaseResults = [];

  for (const tc of testSuite) {
    const op = tc.op;
    const opData = { op, label: tc.label };

    // 2. LLVM
    if (llvmServers.has(op)) {
      const server = llvmServers.get(op);
      for (let i = 0; i < 3; i++) await server.requestWithTrace(tc.inputWire);
      const samples = [];
      for (let i = 0; i < sampleReps; i++) {
        const res = await server.requestWithTrace(tc.inputWire);
        if (res.trace) samples.push(res.trace);
      }
      opData.llvm = averageTrace(samples);
    }

    // 3. Wasm
    if (runWasm) {
      if (wasmPipe) {
        if (wasmServers.has(op)) {
          const server = wasmServers.get(op);
          for (let i = 0; i < 3; i++) await server.requestWithTrace(tc.inputWire);
          const samples = [];
          for (let i = 0; i < sampleReps; i++) {
            const res = await server.requestWithTrace(tc.inputWire);
            if (res.trace) samples.push(res.trace);
          }
          opData.wasm = averageTrace(samples);
        }
      } else {
        const funcName = cleanName(state.relAliases[benchNames[op]]);
        const samples = [];
        for (let i = 0; i < sampleReps + 3; i++) {
          const t0 = process.hrtime.bigint();
          const wasmPtrIn = writeValueToArena(wasmExports, tc.inputVal, propertyListToPattern(tc.inputPattern), 0);
          const t1 = process.hrtime.bigint();
          const mark = wasmReset ? wasmExports.arena_mark() : 0;
          const res = wasmExports[funcName](wasmPtrIn);
          const t2 = process.hrtime.bigint();
          const actual = readArenaValue(wasmExports, res[0], propertyListToPattern(tc.outputPattern), 0, tc.outputPattern);
          const t3 = process.hrtime.bigint();
          if (wasmReset) wasmExports.arena_reset(mark);
          const t4 = process.hrtime.bigint();

          if (i >= 3) {
            samples.push({
              ipcReadNs: 0,
              decodeNs: 0,
              flatInNs: Number(t1 - t0),
              evalNs: Number(t2 - t1),
              flatOutNs: Number(t3 - t2),
              encodeNs: 0,
              ipcWriteNs: Number(t4 - t3),
              totalNs: Number(t4 - t0)
            });
          }
        }
        opData.wasm = averageTrace(samples);

        if (runProfile && wasmProfileFunctions.length > 0) {
          resetWasmProfile(wasmExports, wasmProfileFunctions);
          const mark = wasmReset ? wasmExports.arena_mark() : 0;
          wasmExports[funcName](tc.wasmPtrIn);
          const wProf = readWasmProfile(wasmExports, wasmProfileFunctions);
          if (wasmReset) wasmExports.arena_reset(mark);
          if (wProf) {
            if (wProf[benchNames[op]] !== undefined && wProf[op] === undefined) {
              wProf[op] = wProf[benchNames[op]];
              delete wProf[benchNames[op]];
            }
            opData.wasmProfile = wProf;
          }
        }
      }
    }

    // PKIR
    if (runPKIR && pkirServers.has(op)) {
      const server = pkirServers.get(op);
      for (let i = 0; i < 3; i++) await server.requestWithTrace(tc.inputWire);
      const samples = [];
      for (let i = 0; i < sampleReps; i++) {
        const res = await server.requestWithTrace(tc.inputWire);
        if (res.trace) samples.push(res.trace);
      }
      opData.pkir = averageTrace(samples);
    }

    // 4. kVM
    if (runBaselines) {
      const relDef = relations[op].relDef;
      const samples = [];
      run_converged.defs = state;
      for (let i = 0; i < sampleReps + 2; i++) {
        const t0 = process.hrtime.bigint();
        const expected = run_converged(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
        const t1 = process.hrtime.bigint();
        if (i >= 2) {
          samples.push({
            ipcReadNs: 0,
            decodeNs: 0,
            flatInNs: 0,
            evalNs: Number(t1 - t0),
            flatOutNs: 0,
            encodeNs: 0,
            ipcWriteNs: 0,
            totalNs: Number(t1 - t0)
          });
        }
      }
      opData.kvm = averageTrace(samples);

      if (runProfile) {
        const kProf = {};
        executeKVM(relations[op].kvmFunc, tc.inputVal, {
          rels: state.rels,
          codes: state.codes,
          findCode: codes.find,
          profile: kProf,
          hashToName: kvmHashToName,
          options: { envelopeFree: true }
        });
        if (kProf[benchNames[op]] !== undefined && kProf[op] === undefined) {
          kProf[op] = kProf[benchNames[op]];
          delete kProf[benchNames[op]];
        }
        opData.kvmProfile = kProf;
      }
    }

    phaseResults.push(opData);
  }

  for (const s of llvmServers.values()) s.close();
  for (const s of wasmServers.values()) s.close();
  for (const s of pkirServers.values()) s.close();

  function formatUs(ns) {
    if (ns == null || ns === 0) return "      -     ";
    const us = ns / 1000;
    return `${us.toFixed(2)} µs`.padStart(12);
  }

  const phases = [
    { name: "1. IPC Read (Pipe In)", key: "ipcReadNs" },
    { name: "2. Wire Decode & Validate", key: "decodeNs" },
    { name: "3. Flat Input Prep (Arena)", key: "flatInNs" },
    { name: "4. Pure Evaluation", key: "evalNs" },
    { name: "5. Flat Output Prep (Arena)", key: "flatOutNs" },
    { name: "6. Wire Encode", key: "encodeNs" },
    { name: "7. IPC Write (Pipe Out)", key: "ipcWriteNs" },
    { name: "Total Request Time", key: "totalNs", isTotal: true }
  ];

  const activeTraceLanes = [];
  if (runLLVM) {
    activeTraceLanes.push({
      id: "llvm",
      label: llvmUsePKIR ? "LLVM-PKIR" : "LLVM"
    });
  }
  if (runWasm) activeTraceLanes.push({ id: "wasm", label: "WebAssembly" });
  if (runPKIR) activeTraceLanes.push({ id: "pkir", label: "PKIR (Wasm)" });
  if (runBaselines) activeTraceLanes.push({ id: "kvm", label: "kVM Interp" });

  const traceHeader = ["Phase                   ", ...activeTraceLanes.map(l => l.label.padEnd(13))].join(" | ");
  const traceDivider = ["------------------------", ...activeTraceLanes.map(() => "-------------")].join("-+-");

  for (const item of phaseResults) {
    console.log(`\n--- Operation: ${item.op} (${item.label}) ---`);
    console.log(traceHeader);
    console.log(traceDivider);
    for (const phase of phases) {
      if (phase.isTotal) {
        console.log(traceDivider);
      }
      const pName = phase.name.padEnd(24);
      const cols = [pName, ...activeTraceLanes.map(l => formatUs(item[l.id]?.[phase.key]))];
      console.log(cols.join(" | "));
    }

    const hasProfile = item.wasmProfile || item.kvmProfile;
    if (hasProfile) {
      const allFuncs = new Set([
        ...Object.keys(item.wasmProfile || {}),
        ...Object.keys(item.kvmProfile || {})
      ]);

      const sortedFuncs = Array.from(allFuncs).sort((a, b) => {
        const bName = benchNames[item.op];
        if (a === bName) return -1;
        if (b === bName) return 1;
        if (a === item.op) return -1;
        if (b === item.op) return 1;
        return a.localeCompare(b);
      });

      console.log(`\n  Function Call Profile: ${item.op}`);
      console.log("  Function Name            | WebAssembly Calls | kVM Interp Calls");
      console.log("  -------------------------+-------------------+------------------");
      let wasmTotal = 0, kvmTotal = 0;
      for (const fn of sortedFuncs) {
        const wCount = item.wasmProfile?.[fn] ?? 0;
        const kCount = item.kvmProfile?.[fn] ?? 0;
        wasmTotal += wCount;
        kvmTotal += kCount;
        const fnCol = fn.padEnd(24);
        const wStr = (wCount > 0 ? String(wCount) : "-").padStart(17);
        const kStr = (kCount > 0 ? String(kCount) : "-").padStart(16);
        console.log(`  ${fnCol} | ${wStr} | ${kStr}`);
      }
      console.log("  -------------------------+-------------------+------------------");
      const totCol = "Total Calls".padEnd(24);
      const wTotStr = String(wasmTotal).padStart(17);
      const kTotStr = String(kvmTotal).padStart(16);
      console.log(`  ${totCol} | ${wTotStr} | ${kTotStr}`);
    }
  }

  console.log(`\n=== AVERAGE ACROSS ALL ${phaseResults.length} OPERATIONS ===`);
  console.log(traceHeader);
  console.log(traceDivider);
  for (const phase of phases) {
    if (phase.isTotal) {
      console.log(traceDivider);
    }
    const pName = phase.name.padEnd(24);
    const avg = (backend) => {
      const vals = phaseResults.map(r => r[backend]?.[phase.key]).filter(v => v != null && v > 0);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const cols = [pName, ...activeTraceLanes.map(l => formatUs(avg(l.id)))];
    console.log(cols.join(" | "));
  }

  if (phaseResults.some(r => r.wasmProfile || r.kvmProfile)) {
    console.log("\n=== FUNCTION CALL COUNT SUMMARY ACROSS ALL OPERATIONS ===");
    console.log("Operation (Case)         | WebAssembly Calls | kVM Interp Calls");
    console.log("-------------------------+-------------------+------------------");
    let wasmGrand = 0, kvmGrand = 0;
    for (const r of phaseResults) {
      const wSum = Object.values(r.wasmProfile || {}).reduce((a, b) => a + b, 0);
      const kSum = Object.values(r.kvmProfile || {}).reduce((a, b) => a + b, 0);
      wasmGrand += wSum;
      kvmGrand += kSum;
      const opCol = `${r.op} (${r.label})`.slice(0, 24).padEnd(24);
      console.log(`${opCol} | ${String(wSum).padStart(17)} | ${String(kSum).padStart(16)}`);
    }
    console.log("-------------------------+-------------------+------------------");
    console.log(`${"Total Calls".padEnd(24)} | ${String(wasmGrand).padStart(17)} | ${String(kvmGrand).padStart(16)}`);
  }
  console.log("=====================================================================\n");
}
