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
  Value
} from "@fraczak/k/backend-api.mjs";
import { parse as parseFloatValue } from "@fraczak/k/codecs/ieee.mjs";
import { inputPatternForObjectRelation } from "../backends/llvm/src/executable.mjs";

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
  PersistentExecutable,
  runExecutable,
  runTimedIterations,
  runTimedIterationsAsync,
  shouldStrictFail,
  toPlainObject,
  tryCompileCase,
  wireInput
} from "../backends/llvm/tests/perf-support.mjs";

import {
  cleanName,
  instantiateWasmModule,
  readArenaValue,
  writeValueToArena
} from "../backends/wasm/tests/perf-support.mjs";

import { compileWasmArtifactFromObject } from "../backends/wasm/src/wasm.mjs";

function printHelp() {
  console.log(`Usage: node scripts/perf-ieee.mjs [options]

IEEE 754 Floating-Point Arithmetic Benchmark Harness.
Benchmarks add, sub, mul, and div on Examples/ieee.k across
Native JS, kVM interpreter, LLVM, Wasm, and PKIR backends.

Options:
  --opt=<levels>, --opts=<levels>
      Comma-separated Clang optimization levels for LLVM (e.g. -O1,-O2).
  --O0, --O1, --O2, --O3
      Direct Clang optimization level flags for LLVM.
  --full
      Run full LLVM optimization sweep (-O0, -O1, -O2).
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
  VALUES
      Comma-separated float values to benchmark
      (default: 0.5,-4,0,Infinity,-Infinity,NaN).
  ITERATIONS
      Measured iterations per benchmark (default: 3).
  LLVM_WARMUP_ITERATIONS
      Warmup iterations for LLVM backend (default: 1).
  LLVM_SPAWN_PER_CALL
      Spawn process per LLVM call instead of persistent ('1' or '0').
  LLVM_PIPELINE
      Use persistent pipelined runner for LLVM ('1' or '0').
  LLVM_OPTS
      Comma-separated Clang optimization levels for LLVM.
  K_LLVM_IEEE_RUNTIME_MODE
      LLVM runtime compilation mode for IEEE (default: fast).
  K_LLVM_IEEE_CLANG_OPT
      Clang optimization levels for IEEE LLVM (default: -O1).
  K_LLVM_CACHE_DIR
      Directory to cache compiled LLVM executable binaries.
  PERF_FULL
      Set to '1' to test multiple LLVM optimization levels
      (-O0, -O1, -O2).
  WASM_WARMUP_ITERATIONS
      Warmup iterations for WebAssembly backend (default: 10).
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

const ops = ["add", "sub", "mul", "div"];
const values = csvEnv("VALUES", "0.5,-4,0,Infinity,-Infinity,NaN");
const iterations = parsePositiveIntEnv("ITERATIONS", 3);

// LLVM options
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const llvmRuntimeMode = process.env.K_LLVM_IEEE_RUNTIME_MODE || "fast";

function getClangOptLevels() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--opt=") || arg.startsWith("--opts=")) {
      return arg.split("=")[1].split(",").map(s => s.trim()).filter(Boolean);
    }
  }
  const optIdx = process.argv.findIndex(arg => arg === "--opt" || arg === "--opts");
  if (optIdx !== -1 && process.argv[optIdx + 1]) {
    return process.argv[optIdx + 1].split(",").map(s => s.trim()).filter(Boolean);
  }
  const directFlags = [];
  for (const flag of ["--O0", "--O1", "--O2", "--O3"]) {
    if (process.argv.includes(flag)) {
      directFlags.push(`-${flag.slice(2)}`);
    }
  }
  if (directFlags.length > 0) return directFlags;
  if (process.argv.includes("--full") || process.env.PERF_FULL === "1") {
    return ["-O0", "-O1", "-O2"];
  }
  if (process.env.LLVM_OPTS) {
    return csvEnv("LLVM_OPTS", "");
  }
  if (process.env.K_LLVM_IEEE_CLANG_OPT) {
    return csvEnv("K_LLVM_IEEE_CLANG_OPT", "");
  }
  return ["-O1"];
}

const llvmOptLevels = getClangOptLevels();
const cacheDir = makeCacheDir("k-llvm-ieee-perf-");

// Wasm options
const wasmWarmupIterations = parseNonNegativeIntEnv("WASM_WARMUP_ITERATIONS", 10);
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

console.log("==> Initializing state and loading @fraczak/k/Examples/ieee.k");
const state = createState();
const ieeePath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/ieee.k"));
await evaluateInput(`:load ${ieeePath}`, state);

function generatePerfK(values) {
  const lines = [];
  for (const op of ops) {
    lines.push(`perf_${op} =`);
    lines.push("  {");
    const cases = [];
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values.length; j++) {
        cases.push(`    {.p${i} x, .p${j} y} ${op} r_${i}_${j}`);
      }
    }
    lines.push(cases.join(",\n"));
    lines.push("  };");
  }
  lines.push("perf_ieee =");
  lines.push("  {");
  lines.push("    perf_add add,");
  lines.push("    perf_sub sub,");
  lines.push("    perf_mul mul,");
  lines.push("    perf_div div");
  lines.push("  };");
  return lines.join("\n");
}

const perfKSource = generatePerfK(values);
await evaluateInput(perfKSource, state);

const ieeeRaw = fs.readFileSync(ieeePath, "utf8");
// Exclude trailing unassigned expression and comment block to ensure
// clean parse.
const endIdx = ieeeRaw.indexOf("\n()\n");
const ieeeBase = endIdx !== -1 ? ieeeRaw.slice(0, endIdx) : ieeeRaw;
const fullSource = `${ieeeBase}\n${perfKSource}\nperf_ieee`;

console.log("==> Preparing relation perf_ieee");
const relation = prepareRelation(state, "perf_ieee", {
  source: fullSource,
  sourceLabel: "@fraczak/k/Examples/ieee.k#perf_ieee"
});
codes.load(state.codes);

const paramsObj = {};
for (let i = 0; i < values.length; i++) {
  paramsObj[`p${i}`] = parseFloatValue(values[i]);
}
const inputVal = Value.product(paramsObj);
const inferredPattern = inputPatternForObjectRelation(
  relation.object,
  relation.relationName
);
const { inputWire, inputPattern } = wireInput(inputVal, inferredPattern);

console.log("==> Computing expected results via Native JS");
run_converged.defs = state;
run.defs = state;
const expected = run_converged(codes.find, relation.relDef.def, inputVal, relation.relDef.typePatternGraph);
assert.ok(expected !== undefined, "Failed to compute expected results for perf_ieee");
const totalOps = ops.length * values.length * values.length;

// Setup LLVM
const llvmCasesByOpt = new Map();
if (runLLVM) {
  for (const opt of llvmOptLevels) {
    console.log(`==> Compiling LLVM executable (${opt})...`);
    const llvm = tryCompileCase({
      object: relation.object,
      relationName: relation.relationName,
      relHash: relation.relHash,
      inputPattern,
      cacheDir,
      sourceLabel: "@fraczak/k/Examples/ieee.k#perf_ieee",
      runtimeMode: llvmRuntimeMode,
      clangOpt: opt,
      usePKIR: llvmUsePKIR
    });
    const singleCase = [{
      op: "perf_ieee",
      label: "params",
      inputVal,
      inputWire,
      inputPattern,
      expected,
      llvm
    }];
    llvmCasesByOpt.set(opt, singleCase);
    printCompileFailures(singleCase);
  }
  codes.load(state.codes);
}

// Setup Wasm
let wasmExports = null;
let wasmPtrIn = null;
let wasmOutputPattern = null;
let wasmOutputPatternPropertyList = null;
let wasmFuncName = null;
let wasmExePath = null;
let wasmCompileError = null;

if (runWasm) {
  if (wasmPipe) {
    console.log("==> Compiling WebAssembly executable (persistent runner)...");
    try {
      const wasmPath = path.join(cacheDir, "perf_ieee_wasm.wasm");
      wasmExePath = path.join(cacheDir, "perf_ieee_wasm.exe");
      const wasmBuf = await compileWasmArtifactFromObject(relation.object, {
        entry: "__main__"
      });
      fs.writeFileSync(wasmPath, wasmBuf);
      const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
      fs.writeFileSync(wasmExePath, `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`, { mode: 0o755 });
    } catch (error) {
      wasmCompileError = error.stack || error.message || String(error);
      console.log("WebAssembly compilation failed:");
      console.log(wasmCompileError.split("\n").slice(0, 8).join("\n"));
    }
  } else {
    console.log("==> Compiling WebAssembly module...");
    const wabtInstance = await wabtFactory();
    const wasmModule = await instantiateWasmModule([state.relAliases.perf_ieee], state, wabtInstance);
    wasmExports = wasmModule.exports;

    const relDef = relation.relDef;
    const graph = relDef.typePatternGraph;

    const outputPatternNodeId = graph.find(relDef.def.patterns[1]);
    wasmOutputPatternPropertyList = patternToPropertyList(exportPatternGraph(graph, outputPatternNodeId));
    wasmOutputPattern = propertyListToPattern(wasmOutputPatternPropertyList);

    wasmPtrIn = writeValueToArena(wasmExports, inputVal, propertyListToPattern(inputPattern), 0);
    wasmFuncName = cleanName(state.relAliases.perf_ieee);
  }
}

// Setup PKIR
let pkirExePath = null;
let pkirCompileError = null;
if (runPKIR) {
  console.log("==> Compiling PKIR executable (persistent runner)...");
  try {
    const pkirPath = path.join(cacheDir, "perf_ieee_pkir.wasm");
    pkirExePath = path.join(cacheDir, "perf_ieee_pkir.exe");
    const wasmBuf = await compileWasmArtifactFromObject(relation.object, {
      entry: "__main__",
      usePKIR: true
    });
    fs.writeFileSync(pkirPath, wasmBuf);
    const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
    fs.writeFileSync(pkirExePath, `#!/bin/sh\nexec node "${runBin}" "${pkirPath}" "$@"\n`, { mode: 0o755 });
  } catch (error) {
    pkirCompileError = error.stack || error.message || String(error);
    console.log("PKIR compilation failed:");
    console.log(pkirCompileError.split("\n").slice(0, 8).join("\n"));
  }
}

function printBenchmarkDescription() {
  const lanes = [];
  if (runBaselines) {
    lanes.push("Native JS (Envelope-Aware)");
    lanes.push("Native JS (Envelope-Free)");
    lanes.push("kVM Interpreter (Env-Free)");
  }
  if (runLLVM) {
    for (const opt of llvmOptLevels) {
      const mode = activeLlvmLaneName()
        .replace(/^LLVM(?:-PKIR)? Executable\s*\((.*)\)$/, "$1");
      const prefix = llvmUsePKIR ? "LLVM-PKIR" : "LLVM";
      lanes.push(
        llvmOptLevels.length > 1
          ? `${prefix} ${opt} (${mode})`
          : activeLlvmLaneName()
      );
    }
  }
  if (runWasm) lanes.push(wasmLaneName());
  if (runPKIR) lanes.push(pkirLaneName());

  console.log("==> Benchmark description");
  console.log("    source: @fraczak/k/Examples/ieee.k#perf_ieee (single program)");
  console.log(`    operations: ${ops.join(", ")}`);
  console.log(`    values: ${values.join(", ")}`);
  console.log(`    evaluation: 1 program call evaluating all ${totalOps} operations`);
  if (runLLVM) {
    console.log(`    llvm warmup iterations: ${llvmWarmupIterations}`);
    console.log(`    llvm runtime mode: ${llvmRuntimeMode}`);
    console.log(`    llvm clang opts: ${llvmOptLevels.join(", ")}`);
    console.log(`    llvm cache dir: ${cacheDir}`);
  }
  if (runWasm) {
    console.log(`    wasm runner mode: ${wasmPipe ? "persistent pipe" : "in-process"}`);
    console.log(`    wasm warmup iterations: ${wasmWarmupIterations}`);
    if (!wasmPipe) {
      console.log(`    wasm arena reset: ${wasmReset ? "yes" : "no"}`);
    }
  }
  if (runPKIR) {
    console.log(`    pkir warmup iterations: ${wasmWarmupIterations}`);
  }
  console.log(`    iterations: ${iterations}`);
  console.log(`    benchmark lanes: ${lanes.join("; ")}`);
  console.log("    conformance: all outputs are compared to native expected values");
}

printBenchmarkDescription();
console.log(`==> Running IEEE Performance Test (1 program call / iteration, Iterations: ${iterations})...`);

// 1. Common baseline lanes (only run once!)
let nativeAwareResult = null;
let nativeFreeResult = null;
let kvmFreeResult = null;

if (runBaselines) {
  console.log("==> Running Native JS (Envelope-Aware)...");
  nativeAwareResult = runTimedIterations(iterations, () => {
    const res = run(codes.find, relation.relDef.def, inputVal, relation.relDef.typePatternGraph);
    if (res === undefined) throw new Error("Native JS (Envelope-Aware) returned undefined");
  });

  console.log("==> Running Native JS (Envelope-Free)...");
  nativeFreeResult = runTimedIterations(iterations, () => {
    const res = run_converged(codes.find, relation.relDef.def, inputVal, relation.relDef.typePatternGraph);
    if (res === undefined) throw new Error("Native JS (Envelope-Free) returned undefined");
  });

  console.log("==> Running kVM Interpreter (Env-Free)...");
  const contextFree = {
    rels: state.rels,
    findCode: codes.find,
    options: { envelopeFree: true }
  };
  kvmFreeResult = runTimedIterations(iterations, () => {
    const res = executeKVM(relation.kvmFunc, inputVal, contextFree);
    if (res === undefined) throw new Error("kVM Interpreter returned undefined");
  });
}

// 2. LLVM lanes
const llvmResults = new Map();
if (runLLVM) {
  for (const opt of llvmOptLevels) {
    const casesForOpt = llvmCasesByOpt.get(opt);
    const llvmRunner = createLLVMRunner(casesForOpt);
    try {
      if (llvmWarmupIterations > 0) {
        console.log(`==> Warming LLVM (${opt}) executable (${llvmWarmupIterations} iterations)...`);
        await llvmRunner.run(llvmWarmupIterations);
      }
      console.log(`==> Running LLVM (${opt}) (${iterations} iterations)...`);
      const result = await llvmRunner.run(iterations);
      llvmResults.set(opt, result);
    } catch (err) {
      console.log(`==> LLVM (${opt}) execution failed: ${err.message?.split("\n")[0]}`);
    } finally {
      llvmRunner.close();
    }
  }
}

// 3. Wasm lane
let wasmResult = null;
if (runWasm) {
  if (wasmPipe) {
    if (wasmExePath) {
      const server = new PersistentExecutable(wasmExePath);
      try {
        if (wasmWarmupIterations > 0) {
          console.log(`==> Warming WebAssembly (${wasmWarmupIterations} iterations)...`);
          for (let i = 0; i < wasmWarmupIterations; i++) {
            await server.request(inputWire);
          }
        }
        console.log(`==> Running WebAssembly (${iterations} iterations)...`);
        wasmResult = await runTimedIterationsAsync(iterations, async () => {
          await server.request(inputWire);
        });
      } finally {
        server.close();
      }
    }
  } else {
    if (wasmWarmupIterations > 0) {
      console.log(`==> Warming WebAssembly (${wasmWarmupIterations} iterations)...`);
      for (let i = 0; i < wasmWarmupIterations; i++) {
        const mark = wasmReset ? wasmExports.arena_mark() : 0;
        const res = wasmExports[wasmFuncName](wasmPtrIn);
        assert.ok(res[1] === 1);
        if (wasmReset) wasmExports.arena_reset(mark);
      }
    }

    console.log(`==> Running WebAssembly (${iterations} iterations)...`);
    wasmResult = runTimedIterations(iterations, () => {
      const mark = wasmReset ? wasmExports.arena_mark() : 0;
      const res = wasmExports[wasmFuncName](wasmPtrIn);
      assert.ok(res[1] === 1);
      if (wasmReset) wasmExports.arena_reset(mark);
    });
  }
}

// 4. PKIR lane
let pkirResult = null;
if (runPKIR) {
  if (pkirExePath) {
    const server = new PersistentExecutable(pkirExePath);
    try {
      if (wasmWarmupIterations > 0) {
        console.log(`==> Warming PKIR (${wasmWarmupIterations} iterations)...`);
        for (let i = 0; i < wasmWarmupIterations; i++) {
          await server.request(inputWire);
        }
      }
      console.log(`==> Running PKIR (${iterations} iterations)...`);
      pkirResult = await runTimedIterationsAsync(iterations, async () => {
        await server.request(inputWire);
      });
    } finally {
      server.close();
    }
  }
}

console.log("\n=================== IEEE BENCHMARK RESULTS ===================");
console.log(`Program calls per iteration: 1 (${totalOps} IEEE operations evaluated inside)`);
console.log(`Total requested program calls: ${iterations} (${iterations * totalOps} equivalent IEEE operations)`);
console.log("--------------------------------------------------------------");
let laneIndex = 1;
if (runBaselines) {
  console.log(`${laneIndex++}. Native JS (Envelope-Aware):   ${formatTiming(nativeAwareResult)}`);
  console.log(`${laneIndex++}. Native JS (Envelope-Free):    ${formatTiming(nativeFreeResult)}`);
  console.log(`${laneIndex++}. kVM Interpreter (Env-Free):   ${formatTiming(kvmFreeResult)}`);
}
if (runLLVM) {
  for (const opt of llvmOptLevels) {
    const mode = activeLlvmLaneName()
      .replace(/^LLVM(?:-PKIR)? Executable\s*\((.*)\)$/, "$1");
    const prefix = llvmUsePKIR ? "LLVM-PKIR" : "LLVM";
    const title = llvmOptLevels.length > 1
      ? `${prefix} ${opt} (${mode})`
      : activeLlvmLaneName();
    console.log(
      `${laneIndex++}. ${title.padEnd(29)} ` +
      `${formatTiming(llvmResults.get(opt))}`
    );
  }
}
if (runWasm) {
  const timingStr = wasmResult ? formatTiming(wasmResult) : "compile failed";
  console.log(`${laneIndex++}. ${wasmLaneName().padEnd(29)} ${timingStr}`);
}
if (runPKIR) {
  const timingStr = pkirResult ? formatTiming(pkirResult) : "compile failed";
  console.log(`${laneIndex++}. ${pkirLaneName().padEnd(29)} ${timingStr}`);
}
console.log("==============================================================\n");

// Conformance Validation
let kvmOk = false;
if (runBaselines) {
  const contextFree = {
    rels: state.rels,
    findCode: codes.find,
    options: { envelopeFree: true }
  };
  const kvmActual = executeKVM(relation.kvmFunc, inputVal, contextFree);
  assert.deepEqual(toPlainObject(kvmActual), toPlainObject(expected));
  kvmOk = true;
}

if (runLLVM) {
  for (const opt of llvmOptLevels) {
    const casesForOpt = llvmCasesByOpt.get(opt);
    const tc = casesForOpt[0];
    if (tc.llvm.status !== "ok") {
      tc.llvmConformance = "compile-failed";
    } else {
      try {
        const outputWire = await runExecutable(tc.llvm.exePath, tc.inputWire);
        const actual = decodeWire(outputWire).value;
        assert.deepEqual(toPlainObject(actual), toPlainObject(expected));
        tc.llvmConformance = "ok";
      } catch (error) {
        tc.llvmConformance = "failed";
        tc.llvm.error = error.stack || error.message || String(error);
        console.log(`LLVM (${opt}) conformance failure:`);
        console.log(tc.llvm.error.split("\n").slice(0, 8).join("\n"));
      }
    }
  }
}

let wasmOk = false;
if (runWasm) {
  if (wasmPipe) {
    if (!wasmExePath) {
      console.log("Wasm conformance failure: executable was not compiled");
    } else {
      try {
        const outputWire = await runExecutable(wasmExePath, inputWire);
        const actual = decodeWire(outputWire).value;
        assert.deepEqual(toPlainObject(actual), toPlainObject(expected));
        wasmOk = true;
      } catch (error) {
        console.log("Wasm conformance failure:", error.message || error);
      }
    }
  } else {
    try {
      const mark = wasmReset ? wasmExports.arena_mark() : 0;
      const res = wasmExports[wasmFuncName](wasmPtrIn);
      assert.ok(res[1] === 1, `Wasm function ${wasmFuncName} execution failed`);
      const actual = readArenaValue(
        wasmExports,
        res[0],
        wasmOutputPattern,
        0,
        wasmOutputPatternPropertyList
      );
      if (wasmReset) wasmExports.arena_reset(mark);
      assert.deepEqual(toPlainObject(actual), toPlainObject(expected));
      wasmOk = true;
    } catch (error) {
      console.log("Wasm conformance failure:", error);
    }
  }
}

let pkirOk = false;
if (runPKIR) {
  if (!pkirExePath) {
    console.log("PKIR conformance failure: executable was not compiled");
  } else {
    try {
      const outputWire = await runExecutable(pkirExePath, inputWire);
      const actual = decodeWire(outputWire).value;
      assert.deepEqual(toPlainObject(actual), toPlainObject(expected));
      pkirOk = true;
    } catch (error) {
      console.log("PKIR conformance failure:", error.message || error);
    }
  }
}

const validationSummary = [];
if (runBaselines && kvmOk) validationSummary.push(`kVM (all ${totalOps} ops)`);
if (runLLVM) {
  for (const opt of llvmOptLevels) {
    const casesForOpt = llvmCasesByOpt.get(opt);
    const tc = casesForOpt[0];
    validationSummary.push(`LLVM ${opt} (${tc.llvmConformance === "ok" ? `all ${totalOps} ops` : tc.llvmConformance})`);
  }
}
if (runWasm) {
  validationSummary.push(`Wasm (${wasmOk ? `all ${totalOps} ops` : "failed"})`);
}
if (runPKIR) {
  validationSummary.push(`PKIR (${pkirOk ? `all ${totalOps} ops` : "failed"})`);
}

console.log(`Conformance validation: ${validationSummary.join(", ")} match expected values.`);
if (runLLVM) {
  for (const opt of llvmOptLevels) {
    const casesForOpt = llvmCasesByOpt.get(opt);
    if (shouldStrictFail(casesForOpt)) process.exitCode = 1;
  }
}
if (runWasm && !wasmOk) process.exitCode = 1;
if (runPKIR && !pkirOk) process.exitCode = 1;
