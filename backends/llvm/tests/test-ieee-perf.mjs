import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  codes,
  createState,
  decodeWire,
  evaluateInput,
  parseFloat64,
  run,
  run_converged,
  valueForCode,
  Value
} from "@fraczak/k/backend-api.mjs";

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
  runLLVMMainBench,
  runNativeAwareIterations,
  runNativeFreeIterations,
  shouldStrictFail,
  toPlainObject,
  tryCompileCase,
  wireInput
} from "./perf-support.mjs";

console.log("==> Initializing state and loading @fraczak/k/Examples/ieee.k");
const state = createState();
const ieeePath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/ieee.k"));
await evaluateInput(`:load ${ieeePath}`, state);

const ops = ["add", "sub", "mul", "div"];
const values = csvEnv("VALUES", "0.5,-4,0,Infinity,-Infinity,NaN");
const iterations = parsePositiveIntEnv("ITERATIONS", 3);
const llvmOnly = process.env.LLVM_ONLY === "1";
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const llvmProfileMainCalls = parseNonNegativeIntEnv("LLVM_PROFILE_MAIN_CALLS", 0);
const llvmRuntimeMode = process.env.K_LLVM_IEEE_RUNTIME_MODE || "compact";
const llvmClangOpt = process.env.K_LLVM_IEEE_CLANG_OPT || "-O0";
const cacheDir = makeCacheDir("k-llvm-ieee-perf-");

const float64Hash = state.typeAliases.float64;
const floatPairHash = state.typeAliases.float_pair;

function float64(text) {
  return valueForCode(parseFloat64(text), float64Hash, codes.find);
}

function floatPair(x, y) {
  return valueForCode(Value.product({
    x: float64(x),
    y: float64(y)
  }), floatPairHash, codes.find);
}

console.log("==> Preparing relations");
const relations = {};
const ieeeSource = fs.readFileSync(ieeePath, "utf8");
for (const op of ops) {
  relations[op] = prepareRelation(state, op, {
    source: `${ieeeSource}\n${op}`,
    sourceLabel: `@fraczak/k/Examples/ieee.k#${op}`
  });
}
codes.load(state.codes);

console.log("==> Generating test cases and caching expected results");
const testSuite = [];
for (const op of ops) {
  for (const x of values) {
    for (const y of values) {
      const inputVal = floatPair(x, y);
      const relation = relations[op];

      run.defs = state;
      run_converged.defs = state;
      const expected = run(codes.find, relation.relDef.def, inputVal, relation.relDef.typePatternGraph);
      if (expected === undefined) continue;

      const { inputWire, inputPattern } = wireInput(inputVal);
      testSuite.push({
        op,
        label: `${x},${y}`,
        x,
        y,
        inputVal,
        inputWire,
        inputPattern,
        expected
      });
    }
  }
}

console.log("==> Compiling LLVM executables");
for (const tc of testSuite) {
  const relation = relations[tc.op];
  tc.llvm = tryCompileCase({
    object: relation.object,
    relationName: relation.relationName,
    relHash: relation.relHash,
    inputPattern: tc.inputPattern,
    cacheDir,
    sourceLabel: "@fraczak/k/Examples/ieee.k",
    runtimeMode: llvmRuntimeMode,
    clangOpt: llvmClangOpt
  });
}
codes.load(state.codes);
printCompileFailures(testSuite);

function printBenchmarkDescription() {
  const llvmLane = llvmLaneName();
  const lanes = llvmOnly
    ? [llvmLane]
    : [
        "Native JS (Envelope-Aware)",
        "Native JS (Envelope-Free)",
        "kVM Interpreter (Env-Free)",
        llvmLane
      ];

  console.log("==> Benchmark description");
  console.log("    source: @fraczak/k/Examples/ieee.k");
  console.log(`    operations: ${ops.join(", ")}`);
  console.log(`    values: ${values.join(", ")}`);
  console.log(`    cases: ${testSuite.length} operation/input pairs`);
  console.log(`    llvm-ready cases: ${testSuite.filter(tc => tc.llvm.status === "ok").length}`);
  console.log(`    iterations: ${iterations}`);
  console.log(`    llvm warmup iterations: ${llvmWarmupIterations}`);
  console.log(`    llvm runtime mode: ${llvmRuntimeMode}`);
  console.log(`    llvm clang opt: ${llvmClangOpt}`);
  console.log(`    llvm cache dir: ${cacheDir}`);
  console.log(`    benchmark lanes: ${lanes.join("; ")}`);
  console.log("    conformance: kVM env-free and LLVM outputs are compared to native expected values");
}

printBenchmarkDescription();
console.log(`==> Running IEEE Performance Test (${testSuite.length} cases, Iterations: ${iterations})...`);

let nativeAwareResult = null;
let nativeFreeResult = null;
let kvmFreeResult = null;

if (!llvmOnly) {
  nativeAwareResult = runNativeAwareIterations(iterations, testSuite, relations, state, codes);
  nativeFreeResult = runNativeFreeIterations(iterations, testSuite, relations, state, codes);
  kvmFreeResult = runKVMIterations(iterations, testSuite, relations, state, codes);
}

const llvmRunner = createLLVMRunner(testSuite);
let llvmResult = null;
try {
  if (llvmWarmupIterations > 0) {
    console.log(`==> Warming LLVM executables (${llvmWarmupIterations} iterations)...`);
    await llvmRunner.run(llvmWarmupIterations);
  }
  llvmResult = await llvmRunner.run(iterations);
} finally {
  llvmRunner.close();
}

console.log("\n=================== IEEE BENCHMARK RESULTS ===================");
console.log(`Operation calls per iteration: ${testSuite.length}`);
console.log(`LLVM operation calls per iteration: ${testSuite.filter(tc => tc.llvm.status === "ok").length}`);
console.log(`Total requested operation calls: ${iterations * testSuite.length}`);
console.log("--------------------------------------------------------------");
if (!llvmOnly) {
  console.log(`1. Native JS (Envelope-Aware):   ${formatTiming(nativeAwareResult)}`);
  console.log(`2. Native JS (Envelope-Free):    ${formatTiming(nativeFreeResult)}`);
  console.log(`3. kVM Interpreter (Env-Free):   ${formatTiming(kvmFreeResult)}`);
}
console.log(`4. ${llvmLaneName().padEnd(29)} ${formatTiming(llvmResult)}`);
console.log("==============================================================\n");

if (llvmProfileMainCalls > 0) {
  const mainBench = await runLLVMMainBench(testSuite, llvmProfileMainCalls);
  console.log("================ LLVM k_main PROFILE =================");
  console.log(`Profile calls per case:          ${mainBench.calls}`);
  console.log(`LLVM-ready cases:                ${mainBench.cases}`);
  console.log(`Equivalent iteration time:       ${mainBench.perIterationMs.toFixed(2)} ms/iteration`);
  console.log("=======================================================\n");
}

for (const tc of testSuite) {
  if (!llvmOnly) {
    const kvmActual = runKVMCase(tc, relations, state, codes);
    assert.deepEqual(toPlainObject(kvmActual), toPlainObject(tc.expected));
  }

  if (tc.llvm.status !== "ok") {
    tc.llvmConformance = "compile-failed";
    continue;
  }

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

const llvmOk = testSuite.filter(tc => tc.llvmConformance === "ok").length;
console.log(`Conformance validation: LLVM ${llvmOk}/${testSuite.length} cases match expected values.`);
if (shouldStrictFail(testSuite)) process.exitCode = 1;
