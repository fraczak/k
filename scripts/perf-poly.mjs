import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wabtFactory from "wabt";

import {
  codes,
  createState,
  decodeWire,
  encodeToWire,
  evaluateInput,
  exportPatternGraph,
  patternToPropertyList,
  propertyListToPattern,
  run,
  run_converged,
  valueForCode,
  Value
} from "@fraczak/k/backend-api.mjs";
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
  tryCompileCase,
  wireInput
} from "../backends/llvm/tests/perf-support.mjs";

import {
  cleanName,
  instantiateWasmModule,
  readArenaValue,
  writeValueToArena
} from "../backends/wasm/tests/perf-support.mjs";

import { compileARM64ArtifactFromObject } from "../backends/arm64/src/arm64.mjs";
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

// ARM64 options
const arm64WarmupIterations = parseNonNegativeIntEnv("ARM64_WARMUP_ITERATIONS", 1);
const arm64OptLevel = process.env.ARM64_OPT || "-O2";

// LLVM options
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const cacheDir = makeCacheDir("k-poly-perf-");

// Wasm options
const wasmWarmupIterations = parseNonNegativeIntEnv("WASM_WARMUP_ITERATIONS", 3);
const wasmReset = process.env.WASM_RESET !== "0";

console.log("==> Initializing state and loading @fraczak/k/Examples/arithmetics.k & poly.k");
const state = createState();
const arithmeticsPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/arithmetics.k"));
const polyPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/poly.k"));
await evaluateInput(`:load ${arithmeticsPath}`, state);
await evaluateInput(`:load ${polyPath}`, state);

for (const op of ops) {
  await evaluateInput(`${benchNames[op]} = ${op};`, state);
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
const arithmeticsSource = fs.readFileSync(arithmeticsPath, "utf8").replace(/\s*\(\)\s*$/, "\n");
const polySource = fs.readFileSync(polyPath, "utf8");
const combinedLibrarySource = `${arithmeticsSource}\n${polySource}`;

for (const op of ops) {
  const name = benchNames[op];
  relations[op] = prepareRelation(state, name, {
    source: `${combinedLibrarySource}\n${name} = ${op};\n${name}`,
    sourceLabel: `@fraczak/k/Examples/poly.k#${name}`
  });
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
  run.defs = state;
  run_converged.defs = state;
  const expected = run_converged(codes.find, relation.relDef.def, tc.inputVal, relation.relDef.typePatternGraph);
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
if (runWasm) {
  console.log("==> Compiling WebAssembly module...");
  const wabtInstance = await wabtFactory();
  const opHashes = ops.map(op => state.relAliases[benchNames[op]]);
  const wasmModule = await instantiateWasmModule(opHashes, state, wabtInstance);
  wasmExports = wasmModule.exports;

  for (const tc of testSuite) {
    tc.wasmPtrIn = writeValueToArena(wasmExports, tc.inputVal, propertyListToPattern(tc.inputPattern), 0);
  }
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
        entry: "__main__",
        inputPattern: tc.inputPattern,
        outputPattern: tc.outputPattern,
        outputPath: exePath,
        optLevel: arm64OptLevel
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
  if (runWasm) lanes.push("WebAssembly");
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
    console.log(`    wasm warmup iterations: ${wasmWarmupIterations}`);
    console.log(`    wasm arena reset: ${wasmReset ? "yes" : "no"}`);
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
  console.log(`${laneIndex++}. ${"WebAssembly".padEnd(29)} ${formatTiming(wasmResult)}`);
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
        console.log(`LLVM conformance failure for ${tc.op}:`, tc.llvm.error.split("\n")[0]);
      }
    }
  }

  if (runWasm) {
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
      assert.deepEqual(toPlainObject(actual), toPlainObject(tc.expected));
      if (wasmReset) wasmExports.arena_reset(mark);
      tc.wasmConformance = "ok";
    } catch (error) {
      tc.wasmConformance = "failed";
      console.log(`Wasm conformance failure for ${tc.op}:`, error);
    }
  }

  if (runARM64) {
    if (tc.arm64?.status !== "ok") {
      tc.arm64Conformance = "compile-failed";
    } else {
      try {
        const outputWire = await runExecutable(tc.arm64.exePath, tc.inputWire);
        const actual = decodeWire(outputWire).value;
        assert.deepEqual(toPlainObject(actual), toPlainObject(tc.expected));
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
