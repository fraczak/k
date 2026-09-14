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

const ops = ["plus", "minus", "times"];
const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));
const inputTexts = csvEnv(
  "INPUTS",
  "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555"
);
const iterations = parsePositiveIntEnv("ITERATIONS", 3);

// ARM64 options
const arm64WarmupIterations = parseNonNegativeIntEnv("ARM64_WARMUP_ITERATIONS", 1);
const arm64OptLevel = process.env.ARM64_OPT || "-O2";

// LLVM options
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const cacheDir = makeCacheDir("k-llvm-int-perf-");

// Wasm options
const wasmWarmupIterations = parseNonNegativeIntEnv("WASM_WARMUP_ITERATIONS", 3);
const wasmReset = process.env.WASM_RESET !== "0";

console.log("==> Initializing state and loading @fraczak/k/Examples/arithmetics.k");
const state = createState();
const arithmeticsPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/arithmetics.k"));
await evaluateInput(`:load ${arithmeticsPath}`, state);

for (const op of ops) {
  await evaluateInput(`${benchNames[op]} = {inc x, () y} ${op};`, state);
}

function intValue(text) {
  return valueForCode(parseIntValue(text), state.typeAliases.int, codes.find);
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
if (runWasm) {
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

// Setup ARM64
const arm64Exes = new Map();
if (runARM64) {
  console.log(`==> Compiling Linux ARM64 executables (${arm64OptLevel})...`);
  for (const op of ops) {
    const relation = relations[op];
    try {
      const exePath = path.join(cacheDir, `perf_int_arm64_${op}`);
      compileARM64ArtifactFromObject(relation.object, {
        entry: "__main__",
        outputPath: exePath,
        optLevel: arm64OptLevel
      });
      arm64Exes.set(op, { status: "ok", exePath });
    } catch (error) {
      arm64Exes.set(op, {
        status: "failed",
        error: error.stack || error.message || String(error)
      });
    }
  }
  for (const tc of testSuite) {
    tc.arm64 = arm64Exes.get(tc.op);
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
  if (runARM64) lanes.push(`Linux ARM64 (${arm64OptLevel})`);

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
    console.log(`    wasm warmup iterations: ${wasmWarmupIterations}`);
    console.log(`    wasm arena reset: ${wasmReset ? "yes" : "no"}`);
  }
  if (runARM64) {
    console.log(`    arm64-ready cases: ${testSuite.filter(tc => tc.arm64?.status === "ok").length}`);
    console.log(`    arm64 warmup iterations: ${arm64WarmupIterations}`);
    console.log(`    arm64 opt level: ${arm64OptLevel}`);
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

// 4. Linux ARM64 lane
let arm64Result = null;
if (runARM64) {
  const arm64Cases = testSuite.filter(tc => tc.arm64?.status === "ok");
  if (arm64Cases.length === testSuite.length) {
    if (arm64WarmupIterations > 0) {
      console.log(`==> Warming Linux ARM64 (${arm64WarmupIterations} iterations)...`);
      for (let i = 0; i < arm64WarmupIterations; i++) {
        for (const tc of arm64Cases) {
          await runExecutable(tc.arm64.exePath, tc.inputWire);
        }
      }
    }

    console.log(`==> Running Linux ARM64 (${iterations} iterations)...`);
    arm64Result = await runTimedIterationsAsync(iterations, async () => {
      for (const tc of arm64Cases) {
        await runExecutable(tc.arm64.exePath, tc.inputWire);
      }
    });
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
  console.log(`${laneIndex++}. ${"WebAssembly".padEnd(29)} ${formatTiming(wasmResult)}`);
}
if (runARM64) {
  const timingStr = arm64Result ? formatTiming(arm64Result) : "compile failed";
  console.log(`${laneIndex++}. ${`Linux ARM64 (${arm64OptLevel})`.padEnd(29)} ${timingStr}`);
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
        console.log(`Linux ARM64 conformance failure for ${tc.op}(${tc.label}):`);
        console.log(tc.arm64.error.split("\n").slice(0, 8).join("\n"));
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
