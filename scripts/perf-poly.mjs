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
  createARM64Runner,
  arm64LaneName,
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

import { compileARM64ArtifactFromObject } from "../backends/arm64/src/arm64.mjs";
import { compileWasmArtifactFromObject } from "../backends/wasm/src/wasm.mjs";
import { inputPatternForObjectRelation } from "../backends/llvm/src/executable.mjs";

// Backend selection
const backendsEnv = process.env.BACKENDS?.toLowerCase();
const llvmOnly = process.env.LLVM_ONLY === "1" || backendsEnv === "llvm";
const wasmOnly = process.env.WASM_ONLY === "1" || backendsEnv === "wasm";
const arm64Only = process.env.ARM64_ONLY === "1" || backendsEnv === "arm64";

const isArm64Host = process.arch === "arm64" && process.platform === "linux";
const runARM64 = !wasmOnly && !llvmOnly && (isArm64Host || arm64Only);
const runLLVM = !wasmOnly && !arm64Only;
const runWasm = !llvmOnly && !arm64Only;
const runBaselines = !process.env.BACKENDS_ONLY && (process.env.LLVM_ONLY !== "1") && (process.env.WASM_ONLY !== "1") && (process.env.ARM64_ONLY !== "1");

const ops = ["reverse", "concat", "split_by", "get_nth", "length"];
const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));
const listLength = parsePositiveIntEnv("LIST_LENGTH", 40);
const iterations = parsePositiveIntEnv("ITERATIONS", 3);
const runTrace = process.argv.includes("--trace") || process.env.TRACE === "1" || process.env.K_TRACE === "1";
const runProfile = runTrace || process.argv.includes("--profile") || process.env.K_PROFILE === "1" || process.env.PROFILE === "1";

// ARM64 options
const arm64WarmupIterations = parseNonNegativeIntEnv("ARM64_WARMUP_ITERATIONS", 1);
const arm64OptLevel = process.env.ARM64_OPT || "-O2";

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

const neededExports = ["0", "int", "inc", "dec", "nat", "zero_int?", "nil", "cons", "car", "cdr"];
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
  return valueForCode(parseIntValue(text), state.typeAliases.int, codes.find);
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
      sourceLabel: `@fraczak/k/Examples/poly.k#${relation.relationName}`
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

// Setup ARM64
const arm64Exes = new Map();
if (runARM64) {
  console.log(`==> Compiling Linux ARM64 executables (${arm64OptLevel})...`);
  for (const tc of testSuite) {
    const relation = relations[tc.op];
    try {
      const exePath = path.join(cacheDir, `perf_poly_arm64_${tc.op}`);
      compileARM64ArtifactFromObject(relation.object, {
        entry: relation.relationName,
        inputPattern: tc.inputPattern,
        outputPattern: tc.outputPattern,
        outputPath: exePath,
        optLevel: arm64OptLevel,
        profile: runProfile
      });
      tc.arm64 = { status: "ok", exePath };
      arm64Exes.set(tc.op, tc.arm64);
    } catch (error) {
      tc.arm64 = {
        status: "failed",
        error: error.stack || error.message || String(error)
      };
      arm64Exes.set(tc.op, tc.arm64);
    }
  }
  const failedOps = [...arm64Exes.entries()].filter(([_, v]) => v.status !== "ok");
  if (failedOps.length > 0) {
    console.log("Linux ARM64 compilation failures:");
    for (const [op, res] of failedOps) {
      console.log(`  ${op}: ${res.error.split("\n")[0]}`);
    }
  }
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
  if (runARM64) lanes.push(arm64LaneName(arm64OptLevel));

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
  if (runARM64) {
    console.log(`    arm64-ready cases: ${testSuite.filter(tc => tc.arm64?.status === "ok").length}`);
    console.log(`    arm64 warmup iterations: ${arm64WarmupIterations}`);
    console.log(`    arm64 opt level: ${arm64OptLevel}`);
    console.log(`    arm64 runner mode: ${process.env.ARM64_SPAWN_PER_CALL === "1" ? "spawn per call" : "persistent"}`);
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

// 4. Linux ARM64 lane
let arm64Result = null;
if (runARM64) {
  const arm64Cases = testSuite.filter(tc => tc.arm64?.status === "ok");
  if (arm64Cases.length === testSuite.length) {
    const arm64Runner = createARM64Runner(testSuite);
    try {
      if (arm64WarmupIterations > 0) {
        console.log(`==> Warming Linux ARM64 (${arm64WarmupIterations} iterations)...`);
        await arm64Runner.run(arm64WarmupIterations);
      }

      console.log(`==> Running Linux ARM64 (${iterations} iterations)...`);
      arm64Result = await arm64Runner.run(iterations);
    } finally {
      arm64Runner.close();
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
  console.log(`${laneIndex++}. ${llvmLaneName().padEnd(29)} ${formatTiming(llvmResult)}`);
}
if (runWasm) {
  console.log(`${laneIndex++}. ${wasmLaneName().padEnd(29)} ${formatTiming(wasmResult)}`);
}
if (runARM64) {
  const timingStr = arm64Result ? formatTiming(arm64Result) : "compile failed";
  console.log(`${laneIndex++}. ${arm64LaneName(arm64OptLevel).padEnd(29)} ${timingStr}`);
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

  if (runARM64) {
    if (tc.arm64?.status !== "ok") {
      tc.arm64Conformance = "compile-failed";
    } else {
      try {
        const outputWire = await runExecutable(tc.arm64.exePath, tc.inputWire);
        const actual = decodeWire(outputWire).value;
        assert.ok(safeDeepEqual(actual, tc.expected), `ARM64 output mismatch for ${tc.op}`);
        tc.arm64Conformance = "ok";
      } catch (error) {
        tc.arm64Conformance = "failed";
        tc.arm64.error = error.stack || error.message || String(error);
        console.log(`Linux ARM64 conformance failure for ${tc.op}:`, tc.arm64.error.split("\n")[0]);
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
if (runARM64) {
  const arm64Ok = testSuite.filter(tc => tc.arm64Conformance === "ok").length;
  validationSummary.push(`Linux ARM64 ${arm64Ok}/${testSuite.length}`);
}

console.log(`Conformance validation: ${validationSummary.join(", ")} cases match expected values.`);
if (runLLVM && shouldStrictFail(testSuite)) process.exitCode = 1;
if (runWasm && testSuite.some(tc => tc.wasmConformance !== "ok")) process.exitCode = 1;
if (runARM64 && testSuite.some(tc => tc.arm64Conformance !== "ok")) process.exitCode = 1;

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

  const arm64Servers = new Map();
  if (runARM64) {
    for (const tc of testSuite) {
      if (tc.arm64?.status === "ok") {
        arm64Servers.set(tc.op, new PersistentExecutable(tc.arm64.exePath));
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

    // 1. ARM64
    if (arm64Servers.has(op)) {
      const server = arm64Servers.get(op);
      for (let i = 0; i < 3; i++) await server.requestWithTrace(tc.inputWire);
      const samples = [];
      let arm64Profile = null;
      for (let i = 0; i < sampleReps; i++) {
        const res = await server.requestWithTrace(tc.inputWire);
        if (res.trace) {
          samples.push(res.trace);
          if (res.trace.profile) arm64Profile = res.trace.profile;
        }
      }
      opData.arm64 = averageTrace(samples);
      if (arm64Profile) {
        if (arm64Profile.__main__ !== undefined) {
          if (arm64Profile[op] !== undefined) {
            arm64Profile[benchNames[op]] = arm64Profile.__main__;
          } else {
            arm64Profile[op] = arm64Profile.__main__;
          }
          delete arm64Profile.__main__;
        }
        opData.arm64Profile = arm64Profile;
      }
    }

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
  for (const s of arm64Servers.values()) s.close();
  for (const s of wasmServers.values()) s.close();

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

  for (const item of phaseResults) {
    console.log(`\n--- Operation: ${item.op} (${item.label}) ---`);
    console.log("Phase                    | Linux ARM64   | LLVM          | WebAssembly   | kVM Interp");
    console.log("-------------------------+---------------+---------------+---------------+---------------");
    for (const phase of phases) {
      if (phase.isTotal) {
        console.log("-------------------------+---------------+---------------+---------------+---------------");
      }
      const pName = phase.name.padEnd(24);
      const arm64Col = formatUs(item.arm64?.[phase.key]);
      const llvmCol = formatUs(item.llvm?.[phase.key]);
      const wasmCol = formatUs(item.wasm?.[phase.key]);
      const kvmCol = formatUs(item.kvm?.[phase.key]);
      console.log(`${pName} | ${arm64Col}  | ${llvmCol}  | ${wasmCol}  | ${kvmCol}`);
    }

    const hasProfile = item.arm64Profile || item.wasmProfile || item.kvmProfile;
    if (hasProfile) {
      const allFuncs = new Set([
        ...Object.keys(item.arm64Profile || {}),
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
      console.log("  Function Name            | Linux ARM64 Calls | WebAssembly Calls | kVM Interp Calls");
      console.log("  -------------------------+-------------------+-------------------+------------------");
      let arm64Total = 0, wasmTotal = 0, kvmTotal = 0;
      for (const fn of sortedFuncs) {
        const aCount = item.arm64Profile?.[fn] ?? 0;
        const wCount = item.wasmProfile?.[fn] ?? 0;
        const kCount = item.kvmProfile?.[fn] ?? 0;
        arm64Total += aCount;
        wasmTotal += wCount;
        kvmTotal += kCount;
        const fnCol = fn.padEnd(24);
        const aStr = (aCount > 0 ? String(aCount) : "-").padStart(17);
        const wStr = (wCount > 0 ? String(wCount) : "-").padStart(17);
        const kStr = (kCount > 0 ? String(kCount) : "-").padStart(16);
        console.log(`  ${fnCol} | ${aStr} | ${wStr} | ${kStr}`);
      }
      console.log("  -------------------------+-------------------+-------------------+------------------");
      const totCol = "Total Calls".padEnd(24);
      const aTotStr = String(arm64Total).padStart(17);
      const wTotStr = String(wasmTotal).padStart(17);
      const kTotStr = String(kvmTotal).padStart(16);
      console.log(`  ${totCol} | ${aTotStr} | ${wTotStr} | ${kTotStr}`);
    }
  }

  console.log(`\n=== AVERAGE ACROSS ALL ${phaseResults.length} OPERATIONS ===`);
  console.log("Phase                    | Linux ARM64   | LLVM          | WebAssembly   | kVM Interp");
  console.log("-------------------------+---------------+---------------+---------------+---------------");
  for (const phase of phases) {
    if (phase.isTotal) {
      console.log("-------------------------+---------------+---------------+---------------+---------------");
    }
    const pName = phase.name.padEnd(24);
    const avg = (backend) => {
      const vals = phaseResults.map(r => r[backend]?.[phase.key]).filter(v => v != null && v > 0);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const arm64Col = formatUs(avg("arm64"));
    const llvmCol = formatUs(avg("llvm"));
    const wasmCol = formatUs(avg("wasm"));
    const kvmCol = formatUs(avg("kvm"));
    console.log(`${pName} | ${arm64Col}  | ${llvmCol}  | ${wasmCol}  | ${kvmCol}`);
  }

  if (phaseResults.some(r => r.arm64Profile || r.wasmProfile || r.kvmProfile)) {
    console.log("\n=== FUNCTION CALL COUNT SUMMARY ACROSS ALL OPERATIONS ===");
    console.log("Operation (Case)         | Linux ARM64 Calls | WebAssembly Calls | kVM Interp Calls");
    console.log("-------------------------+-------------------+-------------------+------------------");
    let arm64Grand = 0, wasmGrand = 0, kvmGrand = 0;
    for (const r of phaseResults) {
      const aSum = Object.values(r.arm64Profile || {}).reduce((a, b) => a + b, 0);
      const wSum = Object.values(r.wasmProfile || {}).reduce((a, b) => a + b, 0);
      const kSum = Object.values(r.kvmProfile || {}).reduce((a, b) => a + b, 0);
      arm64Grand += aSum;
      wasmGrand += wSum;
      kvmGrand += kSum;
      const opCol = `${r.op} (${r.label})`.slice(0, 24).padEnd(24);
      console.log(`${opCol} | ${String(aSum).padStart(17)} | ${String(wSum).padStart(17)} | ${String(kSum).padStart(16)}`);
    }
    console.log("-------------------------+-------------------+-------------------+------------------");
    console.log(`${"Total Calls".padEnd(24)} | ${String(arm64Grand).padStart(17)} | ${String(wasmGrand).padStart(17)} | ${String(kvmGrand).padStart(16)}`);
  }
  console.log("=====================================================================\n");
}
