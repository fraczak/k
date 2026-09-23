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
  parseFloat64,
  patternToPropertyList,
  propertyListToPattern,
  run,
  run_converged,
  valueForCode,
  Value
} from "@fraczak/k/backend-api.mjs";

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

const ops = ["add", "sub", "mul", "div"];
const values = csvEnv("VALUES", "0.5,-4,0,Infinity,-Infinity,NaN");
const iterations = parsePositiveIntEnv("ITERATIONS", 3);

// ARM64 options
const arm64WarmupIterations = parseNonNegativeIntEnv("ARM64_WARMUP_ITERATIONS", 1);
const arm64OptLevel = process.env.ARM64_OPT || "-O2";

// LLVM options
const llvmWarmupIterations = parseNonNegativeIntEnv("LLVM_WARMUP_ITERATIONS", 1);
const llvmRuntimeMode = process.env.K_LLVM_IEEE_RUNTIME_MODE || "compact";

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

console.log("==> Initializing state and loading @fraczak/k/Examples/ieee.k");
const state = createState();
const ieeePath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/ieee.k"));
await evaluateInput(`:load ${ieeePath}`, state);

function generatePerfK(values) {
  const paramFields = values.map((_, i) => `  float64 p${i}`).join(",\n");
  const lines = [
    `$params = {\n${paramFields}\n};`
  ];
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
  lines.push("perf_ieee = ?params");
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
// Exclude trailing unassigned expression and comment block to ensure clean parse
const endIdx = ieeeRaw.indexOf("\n()\n");
const ieeeBase = endIdx !== -1 ? ieeeRaw.slice(0, endIdx) : ieeeRaw;
const fullSource = `${ieeeBase}\n${perfKSource}\nperf_ieee`;

console.log("==> Preparing relation perf_ieee");
const relation = prepareRelation(state, "perf_ieee", {
  source: fullSource,
  sourceLabel: "@fraczak/k/Examples/ieee.k#perf_ieee"
});
codes.load(state.codes);

const float64Hash = state.typeAliases.float64;
function float64(text) {
  return valueForCode(parseFloat64(text), float64Hash, codes.find);
}

const paramsObj = {};
for (let i = 0; i < values.length; i++) {
  paramsObj[`p${i}`] = float64(values[i]);
}
const rawProduct = Value.product(paramsObj);
const inputVal = valueForCode(rawProduct, state.typeAliases.params, codes.find);
const { inputWire, inputPattern } = wireInput(inputVal);

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
      clangOpt: opt
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

    const inputPatternNodeId = graph.find(relDef.def.patterns[0]);
    const inputPat = propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, inputPatternNodeId)));

    const outputPatternNodeId = graph.find(relDef.def.patterns[1]);
    wasmOutputPatternPropertyList = patternToPropertyList(exportPatternGraph(graph, outputPatternNodeId));
    wasmOutputPattern = propertyListToPattern(wasmOutputPatternPropertyList);

    wasmPtrIn = writeValueToArena(wasmExports, inputVal, inputPat, 0);
    wasmFuncName = cleanName(state.relAliases.perf_ieee);
  }
}

// Setup ARM64
let arm64ExePath = null;
let arm64CompileError = null;

if (runARM64) {
  console.log(`==> Compiling Linux ARM64 executable (${arm64OptLevel})...`);
  try {
    arm64ExePath = path.join(cacheDir, "perf_ieee_arm64");
    compileARM64ArtifactFromObject(relation.object, {
      entry: "__main__",
      inputPattern,
      outputPath: arm64ExePath,
      optLevel: arm64OptLevel
    });
  } catch (error) {
    arm64CompileError = error.stack || error.message || String(error);
    console.log("Linux ARM64 compilation failed:");
    console.log(arm64CompileError.split("\n").slice(0, 8).join("\n"));
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
      const mode = llvmLaneName().replace(/^LLVM Executable\\s*\\((.*)\\)$/, "$1");
      lanes.push(llvmOptLevels.length > 1 ? `LLVM ${opt} (${mode})` : llvmLaneName());
    }
  }
  if (runWasm) lanes.push(wasmLaneName());
  if (runARM64) lanes.push(arm64LaneName(arm64OptLevel));

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
  if (runARM64) {
    console.log(`    arm64 warmup iterations: ${arm64WarmupIterations}`);
    console.log(`    arm64 opt level: ${arm64OptLevel}`);
    console.log(`    arm64 runner mode: ${process.env.ARM64_SPAWN_PER_CALL === "1" ? "spawn per call" : "persistent"}`);
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

// 4. Linux ARM64 lane
let arm64Result = null;
if (runARM64 && arm64ExePath) {
  const arm64Runner = createARM64Runner([{
    op: "perf_ieee",
    inputWire,
    arm64: { status: "ok", exePath: arm64ExePath }
  }]);
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
    const title = llvmOptLevels.length > 1
      ? `LLVM ${opt} (${llvmLaneName().replace(/^LLVM Executable\\s*\\((.*)\\)$/, "$1")})`
      : llvmLaneName();
    console.log(`${laneIndex++}. ${title.padEnd(29)} ${formatTiming(llvmResults.get(opt))}`);
  }
}
if (runWasm) {
  const timingStr = wasmResult ? formatTiming(wasmResult) : "compile failed";
  console.log(`${laneIndex++}. ${wasmLaneName().padEnd(29)} ${timingStr}`);
}
if (runARM64) {
  const timingStr = arm64Result ? formatTiming(arm64Result) : "compile failed";
  console.log(`${laneIndex++}. ${arm64LaneName(arm64OptLevel).padEnd(29)} ${timingStr}`);
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

let arm64Ok = false;
if (runARM64) {
  if (!arm64ExePath) {
    console.log("Linux ARM64 conformance failure: executable was not compiled");
  } else {
    try {
      const outputWire = await runExecutable(arm64ExePath, inputWire);
      const actual = decodeWire(outputWire).value;
      assert.deepEqual(toPlainObject(actual), toPlainObject(expected));
      arm64Ok = true;
    } catch (error) {
      console.log("Linux ARM64 conformance failure:", error.message || error);
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
if (runARM64) {
  validationSummary.push(`Linux ARM64 (${arm64Ok ? `all ${totalOps} ops` : "failed"})`);
}

console.log(`Conformance validation: ${validationSummary.join(", ")} match expected values.`);
if (runLLVM) {
  for (const opt of llvmOptLevels) {
    const casesForOpt = llvmCasesByOpt.get(opt);
    if (shouldStrictFail(casesForOpt)) process.exitCode = 1;
  }
}
if (runWasm && !wasmOk) process.exitCode = 1;
if (runARM64 && !arm64Ok) process.exitCode = 1;
