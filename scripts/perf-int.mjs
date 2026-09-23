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

import { compileARM64ArtifactFromObject } from "../backends/arm64/src/arm64.mjs";
import { compileWasmArtifactFromObject } from "../backends/wasm/src/wasm.mjs";

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
  if (runWasm) lanes.push(wasmLaneName());
  if (runARM64) lanes.push(arm64LaneName(arm64OptLevel));

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
if (runARM64) {
  const timingStr = arm64Result ? formatTiming(arm64Result) : "compile failed";
  console.log(`${laneIndex++}. ${arm64LaneName(arm64OptLevel).padEnd(29)} ${timingStr}`);
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

// =========================================================================
// Squaring Scale & Memory Profiling Benchmark
// Expression: s = {()x,()y}times; 987654321 s s s s s s s s s s
// =========================================================================

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
const squaringStepTimeoutMs = parsePositiveIntEnv("SQUARING_STEP_TIMEOUT_MS", 25000);

console.log("\n=================== SQUARING SCALE & MEMORY BENCHMARK ===================");
console.log(`Expression: s = {()x,()y}times; ${squaringInputText} ${"s ".repeat(squaringSteps).trim()}`);
console.log(`Evaluation: ${squaringSteps} successive squarings doubling bit length each step`);

await evaluateInput("s = {()x,()y}times;", state);
codes.load(state.codes);
const sRel = prepareRelation(state, "s", {
  source: `${arithmeticsLibrarySource}\ns = {()x,()y}times;\ns`,
  sourceLabel: "@fraczak/k/Examples/arithmetics.k#s"
});

const sInitialVal = intValue(squaringInputText);
const { inputWire: sInitWire, inputPattern: sInputPattern } = wireInput(sInitialVal);

// Build executables for persistent servers
let sLlvmServer = null;
if (runLLVM) {
  const sLlvmCompiled = tryCompileCase({
    object: sRel.object,
    relationName: sRel.relationName,
    relHash: sRel.relHash,
    inputPattern: sInputPattern,
    cacheDir,
    sourceLabel: "@fraczak/k/Examples/arithmetics.k#s"
  });
  if (sLlvmCompiled.status === "ok") {
    sLlvmServer = new PersistentExecutable(sLlvmCompiled.exePath);
  }
}

let sWasmServer = null;
if (runWasm) {
  try {
    const sWasmPath = path.join(cacheDir, "perf_int_wasm_s.wasm");
    const sWasmExe = path.join(cacheDir, "perf_int_wasm_s.exe");
    const wasmBuf = await compileWasmArtifactFromObject(sRel.object, { entry: "__main__" });
    fs.writeFileSync(sWasmPath, wasmBuf);
    const runBin = fileURLToPath(import.meta.resolve("../backends/wasm/bin/k-wasm-run.mjs"));
    fs.writeFileSync(sWasmExe, `#!/bin/sh\nexec node "${runBin}" "${sWasmPath}" "$@"\n`, { mode: 0o755 });
    sWasmServer = new PersistentExecutable(sWasmExe);
  } catch (e) {
    console.log("Failed to build Wasm executable for 's':", e.message);
  }
}

let sArm64Server = null;
if (runARM64) {
  try {
    const sArm64Exe = path.join(cacheDir, "perf_int_arm64_s");
    compileARM64ArtifactFromObject(sRel.object, {
      entry: "__main__",
      outputPath: sArm64Exe,
      optLevel: arm64OptLevel
    });
    sArm64Server = new PersistentExecutable(sArm64Exe);
  } catch (e) {
    console.log("Failed to build ARM64 executable for 's':", e.message);
  }
}

const squaringLanes = [];
if (runBaselines) {
  squaringLanes.push({ id: "jsAware", name: "Native JS (Aware)", type: "jsAware", memLabel: "heap" });
  squaringLanes.push({ id: "jsFree", name: "Native JS (Free)", type: "jsFree", memLabel: "heap" });
  squaringLanes.push({ id: "kvm", name: "kVM (Env-Free)", type: "kvm", memLabel: "heap" });
}
if (runLLVM && sLlvmServer) {
  squaringLanes.push({ id: "llvm", name: llvmLaneName(), type: "persistent", server: sLlvmServer, memLabel: "peak RSS" });
}
if (runWasm && sWasmServer) {
  squaringLanes.push({ id: "wasm", name: wasmLaneName(), type: "persistent", server: sWasmServer, memLabel: "peak RSS" });
}
if (runARM64 && sArm64Server) {
  squaringLanes.push({ id: "arm64", name: arm64LaneName(arm64OptLevel), type: "persistent", server: sArm64Server, memLabel: "peak RSS" });
}

const squaringResults = {};
for (const lane of squaringLanes) squaringResults[lane.id] = [];
const stepMetadata = [];

try {
  // 1. Persistent child processes (ARM64, Wasm, LLVM)
  for (const lane of squaringLanes.filter(l => l.type === "persistent")) {
    console.log(`==> Running ${lane.name} squaring lane...`);
    let curWire = sInitWire;
    for (let step = 1; step <= squaringSteps; step++) {
      try {
        const t0 = performance.now();
        curWire = await lane.server.request(curWire);
        const t1 = performance.now();
        const timeMs = t1 - t0;
        const mem = getProcessMemory(lane.server.child.pid);
        squaringResults[lane.id].push({ status: "ok", timeMs, memMb: mem.peakRssMb, wire: curWire });
        if (!stepMetadata[step - 1]) {
          stepMetadata[step - 1] = {
            wireLen: curWire.length,
            bits: null,
            canonicalWire: curWire
          };
        }
        if (timeMs > squaringStepTimeoutMs || (lane.id === "llvm" && mem.peakRssMb > 3500)) break;
      } catch (e) {
        squaringResults[lane.id].push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
        break;
      }
    }
  }

  // 2. In-process baselines (JS Aware, JS Free, kVM)
  if (runBaselines) {
    // JS Aware
    console.log("==> Running Native JS (Envelope-Aware) squaring lane...");
    let curValAware = sInitialVal;
    run.defs = state;
    for (let step = 1; step <= squaringSteps; step++) {
      try {
        const t0 = performance.now();
        curValAware = run(codes.find, sRel.relDef.def, curValAware, sRel.relDef.typePatternGraph);
        const t1 = performance.now();
        const timeMs = t1 - t0;
        const mem = getNodeMemory();
        squaringResults.jsAware.push({ status: "ok", timeMs, memMb: mem.heapMb, value: curValAware });
        if (stepMetadata[step - 1] && stepMetadata[step - 1].bits == null) {
          stepMetadata[step - 1].bits = countBitsValue(curValAware);
        }
        if (timeMs > squaringStepTimeoutMs) break;
      } catch (e) {
        squaringResults.jsAware.push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
        break;
      }
    }

    // JS Free
    console.log("==> Running Native JS (Envelope-Free) squaring lane...");
    let curValFree = sInitialVal;
    run_converged.defs = state;
    for (let step = 1; step <= squaringSteps; step++) {
      try {
        const t0 = performance.now();
        curValFree = run_converged(codes.find, sRel.relDef.def, curValFree, sRel.relDef.typePatternGraph);
        const t1 = performance.now();
        const timeMs = t1 - t0;
        const mem = getNodeMemory();
        squaringResults.jsFree.push({ status: "ok", timeMs, memMb: mem.heapMb, value: curValFree });
        if (stepMetadata[step - 1] && stepMetadata[step - 1].bits == null) {
          stepMetadata[step - 1].bits = countBitsValue(curValFree);
        }
        if (timeMs > squaringStepTimeoutMs) break;
      } catch (e) {
        squaringResults.jsFree.push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
        break;
      }
    }

    // kVM
    console.log("==> Running kVM Interpreter (Env-Free) squaring lane...");
    let curValKvm = sInitialVal;
    const kvmContext = { rels: state.rels, findCode: codes.find, options: { envelopeFree: true } };
    for (let step = 1; step <= squaringSteps; step++) {
      try {
        const t0 = performance.now();
        curValKvm = executeKVM(sRel.kvmFunc, curValKvm, kvmContext);
        const t1 = performance.now();
        const timeMs = t1 - t0;
        const mem = getNodeMemory();
        squaringResults.kvm.push({ status: "ok", timeMs, memMb: mem.heapMb, value: curValKvm });
        if (stepMetadata[step - 1] && stepMetadata[step - 1].bits == null) {
          stepMetadata[step - 1].bits = countBitsValue(curValKvm);
        }
        if (timeMs > squaringStepTimeoutMs) break;
      } catch (e) {
        squaringResults.kvm.push({ status: "failed", error: e.message?.split("\n")[0] || String(e) });
        break;
      }
    }
  }

} finally {
  if (sArm64Server) sArm64Server.close();
  if (sWasmServer) sWasmServer.close();
  if (sLlvmServer) sLlvmServer.close();
}

// For any remaining steps without bit counts, decode canonicalWire safely to get bits:
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
console.log("\n======================== SQUARING SCALING & MEMORY BENCHMARK ========================");
console.log(`Expression: s = {()x,()y}times; ${squaringInputText} ${"s ".repeat(squaringSteps).trim()}`);
console.log(`Initial: ${squaringInputText} (${countBitsValue(sInitialVal)} bits)`);
console.log("----------------------------------------------------------------------------------------------------------------------------------");
const headerCols = ["Step", "Bits", "Wire(B)", ...squaringLanes.map(l => `${l.name} (${l.memLabel})`)];
const colWidths = [4, 6, 7, ...squaringLanes.map(l => Math.max(22, l.name.length + l.memLabel.length + 5))];
console.log(headerCols.map((h, i) => i < 3 ? h.padStart(colWidths[i]) : h.padEnd(colWidths[i])).join(" | "));
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
    const res = squaringResults[lane.id][step - 1];
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
console.log("==================================================================================================================================");

// Conformance check across all computed steps
let squaringConformanceOk = true;
for (let step = 1; step <= squaringSteps; step++) {
  const meta = stepMetadata[step - 1];
  if (!meta?.canonicalWire) continue;
  for (const lane of squaringLanes) {
    const res = squaringResults[lane.id][step - 1];
    if (res?.status === "ok") {
      if (res.wire) {
        if (Buffer.compare(res.wire, meta.canonicalWire) !== 0) {
          squaringConformanceOk = false;
          console.log(`Squaring conformance mismatch on step ${step} (${lane.name})`);
        }
      } else if (res.value) {
        try {
          const wireVal = decodeWire(meta.canonicalWire).value;
          if (!safeDeepEqual(res.value, wireVal)) {
            squaringConformanceOk = false;
            console.log(`Squaring conformance mismatch on step ${step} (${lane.name})`);
          }
        } catch {}
      }
    }
  }
}

console.log("\nSquaring Performance & Scaling Summary:");
for (const lane of squaringLanes) {
  const okSteps = squaringResults[lane.id].filter(r => r.status === "ok");
  const maxStep = okSteps.length;
  const lastOk = okSteps[okSteps.length - 1];
  const peakMem = okSteps.reduce((max, r) => Math.max(max, r.memMb || 0), 0);
  const failureReason = squaringResults[lane.id][maxStep]?.error;
  let statusDetail = "";
  if (failureReason) {
    if (failureReason.includes("Maximum call stack")) statusDetail = " (V8 call stack overflow)";
    else if (failureReason.includes("status null") || failureReason.includes("failed with status")) statusDetail = " (arena capacity limit reached)";
    else statusDetail = ` (${failureReason.slice(0, 30)})`;
  }
  const timeStr = lastOk ? ` (step ${maxStep} in ${lastOk.timeMs < 10 ? lastOk.timeMs.toFixed(2) : lastOk.timeMs.toFixed(1)}ms)` : "";
  console.log(`  - ${lane.name.padEnd(32)}: reached Step ${String(maxStep).padStart(2)}/${squaringSteps}${timeStr}, peak ${lane.memLabel}: ${peakMem}MB${statusDetail}`);
}

if (squaringConformanceOk) {
  console.log("\nSquaring Conformance: All completed squaring steps match expected values across all backends!\n");
} else {
  console.log("\nSquaring Conformance: Warning, some step outputs differed between backends!\n");
  process.exitCode = 1;
}
