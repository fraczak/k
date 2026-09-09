import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  codes,
  createState,
  decodeWire,
  evaluateInput,
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
  runLLVMMainBench,
  runNativeAwareIterations,
  runNativeFreeIterations,
  shouldStrictFail,
  toPlainObject,
  tryCompileCase,
  wireInput
} from "./perf-support.mjs";

console.log("==> Initializing state and loading @fraczak/k/Examples/arithmetics.k");
const state = createState();
const arithmeticsPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/arithmetics.k"));
await evaluateInput(`:load ${arithmeticsPath}`, state);

const ops = ["plus", "minus", "times"];
const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));
for (const op of ops) {
  await evaluateInput(`${benchNames[op]} = {inc x, () y} ${op};`, state);
}

function intValue(text) {
  return valueForCode(parseIntValue(text), state.typeAliases.int, codes.find);
}

const inputTexts = csvEnv(
  "INPUTS",
  "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555"
);
const iterations = parsePositiveIntEnv("ITERATIONS", 3);
const llvmOnly = process.env.LLVM_ONLY === "1";
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const llvmProfileMainCalls = parseNonNegativeIntEnv("LLVM_PROFILE_MAIN_CALLS", 0);
const cacheDir = makeCacheDir("k-llvm-int-perf-");

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

console.log("==> Compiling LLVM executables");
for (const tc of testSuite) {
  const relation = relations[tc.op];
  tc.llvm = tryCompileCase({
    object: relation.object,
    relationName: relation.relationName,
    relHash: relation.relHash,
    inputPattern: tc.inputPattern,
    cacheDir,
    sourceLabel: "@fraczak/k/Examples/arithmetics.k"
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
  console.log("    source: @fraczak/k/Examples/arithmetics.k");
  console.log(`    benchmark relations: ${ops.map(op => benchNames[op]).join(", ")}`);
  console.log(`    operations: ${ops.join(", ")}`);
  console.log(`    decimal inputs: ${inputTexts.join(", ")}`);
  console.log(`    cases: ${testSuite.length} operation/input pairs`);
  console.log(`    llvm-ready cases: ${testSuite.filter(tc => tc.llvm.status === "ok").length}`);
  console.log(`    iterations: ${iterations}`);
  console.log(`    llvm warmup iterations: ${llvmWarmupIterations}`);
  console.log(`    llvm cache dir: ${cacheDir}`);
  console.log(`    benchmark lanes: ${lanes.join("; ")}`);
  console.log("    conformance: kVM env-free and LLVM outputs are compared to native expected values");
}

printBenchmarkDescription();
console.log(`==> Running Integer Performance Test (${testSuite.length} cases, Iterations: ${iterations})...`);

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

console.log("\n=================== INTEGER BENCHMARK RESULTS ===================");
console.log(`Operation calls per iteration: ${testSuite.length}`);
console.log(`LLVM operation calls per iteration: ${testSuite.filter(tc => tc.llvm.status === "ok").length}`);
console.log(`Total requested operation calls: ${iterations * testSuite.length}`);
console.log("-----------------------------------------------------------------");
if (!llvmOnly) {
  console.log(`1. Native JS (Envelope-Aware):   ${formatTiming(nativeAwareResult)}`);
  console.log(`2. Native JS (Envelope-Free):    ${formatTiming(nativeFreeResult)}`);
  console.log(`3. kVM Interpreter (Env-Free):   ${formatTiming(kvmFreeResult)}`);
}
console.log(`4. ${llvmLaneName().padEnd(29)} ${formatTiming(llvmResult)}`);
console.log("=================================================================\n");

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
