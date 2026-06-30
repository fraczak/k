import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wabtFactory from "wabt";

import {
  codes,
  createState,
  evaluateInput,
  executeKVM,
  exportPatternGraph,
  isProduct,
  isVariant,
  lowerToKVM,
  patternToPropertyList,
  propertyListToPattern,
  run,
  run_converged,
  valueForCode,
  Value
} from "@fraczak/k/backend-api.mjs";
import { parse as parseIntValue } from "@fraczak/k/codecs/int.mjs";
import { lowerToWasm, getTagId, getTagFromId } from "../src/kvm2wasm.mjs";

console.log("==> Initializing state and loading @fraczak/k/Examples/arithmetics.k");
const state = createState();
const arithmeticsPath = fileURLToPath(import.meta.resolve("@fraczak/k/Examples/arithmetics.k"));
await evaluateInput(`:load ${arithmeticsPath}`, state);

const ops = ["plus", "minus", "times"];
const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));
for (const op of ops) {
  await evaluateInput(`${benchNames[op]} = {inc x, () y} ${op};`, state);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWat = fs.readFileSync(path.join(__dirname, "../runtime.wat"), "utf8");
const wabtInstance = await wabtFactory();

function compileWat(watText) {
  const watModule = wabtInstance.parseWat("int_perf.wat", watText, {
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    multi_value: true,
    bulk_memory: true,
    reference_types: true
  });
  watModule.resolveNames();
  watModule.validate();
  return watModule.toBinary({
    log: false,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: true
  }).buffer;
}

const cleanName = (h) => "rel_" + h.replace(/[^a-zA-Z0-9_]/g, "_");

function scanCalls(insts, compiled, queue) {
  for (const inst of insts) {
    if (inst.op === "call" && !compiled.has(inst.func) && !queue.includes(inst.func)) {
      queue.push(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        scanCalls(branch.body, compiled, queue);
      }
    }
  }
}

function cleanInsts(insts) {
  for (const inst of insts) {
    if (inst.op === "call") {
      inst.func = cleanName(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        cleanInsts(branch.body);
      }
    }
  }
}

function compileMultiModule(mainHashes, state) {
  const compiled = new Set();
  const queue = [...mainHashes];
  const wats = [];

  while (queue.length > 0) {
    const hash = queue.shift();
    if (compiled.has(hash)) continue;
    compiled.add(hash);

    const relDef = state.rels[hash];
    if (!relDef) {
      throw new Error(`Relation hash ${hash} not found`);
    }

    const kvmFunc = lowerToKVM(relDef, hash);
    kvmFunc.typePatternGraph = relDef.typePatternGraph;
    scanCalls(kvmFunc.body, compiled, queue);

    kvmFunc.name = cleanName(hash);
    cleanInsts(kvmFunc.body);
    wats.push(lowerToWasm(kvmFunc, kvmFunc.name));
  }

  return wats.join("\n\n");
}

function readArenaValue(exports, ptr, pattern, patternNodeId, patternPropertyList) {
  const patternNode = pattern.nodes[patternNodeId];
  const view = new DataView(exports.memory.buffer);

  if (patternNode.kind === 1 || patternNode.kind === 3) {
    const N = view.getUint32(ptr + 4, true);
    const productObj = {};

    for (let i = 0; i < N; i++) {
      const edge = patternNode.edges[i];
      const offsetVal = view.getUint32(ptr + 8 + 4 * i, true);
      const childPtr = view.getUint32(ptr + offsetVal, true);
      productObj[edge.label] = readArenaValue(exports, childPtr, pattern, edge.target, patternPropertyList);
    }
    return Value.product(productObj, patternPropertyList);
  }

  if (patternNode.kind === 2 || patternNode.kind === 4) {
    const tagId = view.getUint32(ptr + 4, true);
    const payloadPtr = view.getUint32(ptr + 8, true);
    const tag = getTagFromId(tagId);
    const edge = patternNode.edges.find(e => e.label === tag);
    if (!edge) {
      throw new Error(`Variant tag '${tag}' not found in pattern edges`);
    }
    const payloadVal = readArenaValue(exports, payloadPtr, pattern, edge.target, patternPropertyList);
    return Value.variant(tag, payloadVal, patternPropertyList);
  }

  throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
}

function writeValueToArena(exports, value, pattern, patternNodeId) {
  const patternNode = pattern.nodes[patternNodeId];

  if (isProduct(value)) {
    const keys = Object.keys(value.product).sort();
    const N = keys.length;
    const totalSize = 8 + 8 * N;
    const ptr = exports.alloc(totalSize);
    const childPtrs = [];

    for (let i = 0; i < N; i++) {
      const label = keys[i];
      const edge = patternNode.edges.find(e => e.label === label);
      const childPtr = writeValueToArena(exports, value.product[label], pattern, edge.target);
      childPtrs.push(childPtr);
    }

    const view = new DataView(exports.memory.buffer);
    view.setUint32(ptr, totalSize, true);
    view.setUint32(ptr + 4, N, true);

    for (let i = 0; i < N; i++) {
      const offsetVal = 8 + 4 * N + 4 * i;
      view.setUint32(ptr + 8 + 4 * i, offsetVal, true);
      view.setUint32(ptr + offsetVal, childPtrs[i], true);
    }
    return ptr;
  }

  if (isVariant(value)) {
    const tagId = getTagId(value.tag);
    const edge = patternNode.edges.find(e => e.label === value.tag);
    const childPtr = writeValueToArena(exports, value.value, pattern, edge.target);
    const ptr = exports.alloc(12);
    const view = new DataView(exports.memory.buffer);

    view.setUint32(ptr, 12, true);
    view.setUint32(ptr + 4, tagId, true);
    view.setUint32(ptr + 8, childPtr, true);
    return ptr;
  }

  throw new Error(`Unsupported value type: ${value}`);
}

console.log("==> Compiling WebAssembly module...");
const benchHashes = ops.map(op => state.relAliases[benchNames[op]]);
const wats = compileMultiModule(benchHashes, state);
const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + wats + "\n)";
const binary = compileWat(fullWat);
const module = await WebAssembly.compile(binary);
const instance = await WebAssembly.instantiate(module);
const exports = instance.exports;

const intHash = state.typeAliases.int;
function intValue(text) {
  return valueForCode(parseIntValue(text), intHash, codes.find);
}

const inputTexts = (process.env.INPUTS || process.env.INPUT ||
  "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555")
  .split(",")
  .map(text => text.trim())
  .filter(Boolean);

const relDefs = {};
const kvmFuncs = {};
for (const op of ops) {
  const name = benchNames[op];
  const hash = state.relAliases[name];
  const relDef = state.rels[hash];
  relDefs[op] = relDef;
  kvmFuncs[op] = lowerToKVM(relDef, name);
}

console.log("==> Generating test cases and caching expected results");
const testSuite = [];
for (const op of ops) {
  for (const inputText of inputTexts) {
    const inputVal = intValue(inputText);
    const relDef = relDefs[op];

    run.defs = state;
    run_converged.defs = state;
    const expected = run(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
    assert.ok(expected !== undefined, `${op}(${inputText}) should produce a value`);

    testSuite.push({
      op,
      inputText,
      inputVal,
      expected
    });
  }
}

for (const tc of testSuite) {
  const relDef = relDefs[tc.op];
  const graph = relDef.typePatternGraph;

  const inputPatternNodeId = graph.find(relDef.def.patterns[0]);
  const inputPattern = propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, inputPatternNodeId)));

  const outputPatternNodeId = graph.find(relDef.def.patterns[1]);
  const outputPatternPropertyList = patternToPropertyList(exportPatternGraph(graph, outputPatternNodeId));
  const outputPattern = propertyListToPattern(outputPatternPropertyList);

  tc.wasmPtrIn = writeValueToArena(exports, tc.inputVal, inputPattern, 0);
  tc.wasmOutputPattern = outputPattern;
  tc.wasmOutputPatternPropertyList = outputPatternPropertyList;
}

const contextFree = {
  rels: state.rels,
  findCode: codes.find,
  options: { envelopeFree: true }
};

const ITERATIONS = process.env.ITERATIONS ? parseInt(process.env.ITERATIONS, 10) : 3;
const WASM_ONLY = process.env.WASM_ONLY === "1";
const WASM_PROFILE = process.env.WASM_PROFILE === "1";
const WASM_RESET = process.env.WASM_RESET !== "0";
const WASM_WARMUP_ITERATIONS = process.env.WASM_WARMUP_ITERATIONS
  ? parseInt(process.env.WASM_WARMUP_ITERATIONS, 10)
  : 3;

assert.ok(Number.isInteger(ITERATIONS) && ITERATIONS > 0, "ITERATIONS must be a positive integer");

function printBenchmarkDescription() {
  const lanes = WASM_ONLY
    ? ["WebAssembly"]
    : [
        "Native JS (Envelope-Aware)",
        "Native JS (Envelope-Free)",
        "kVM Interpreter (Env-Free)",
        "WebAssembly"
      ];

  console.log("==> Benchmark description");
  console.log("    source: @fraczak/k/Examples/arithmetics.k");
  console.log(`    benchmark relations: ${ops.map(op => benchNames[op]).join(", ")}`);
  console.log(`    operations: ${ops.join(", ")}`);
  console.log(`    decimal inputs: ${inputTexts.join(", ")}`);
  console.log(`    cases: ${testSuite.length} operation/input pairs`);
  console.log(`    iterations: ${ITERATIONS}`);
  console.log(`    wasm warmup iterations: ${WASM_WARMUP_ITERATIONS}`);
  console.log(`    wasm arena reset between calls: ${WASM_RESET ? "yes" : "no"}`);
  console.log(`    wasm allocation profile: ${WASM_PROFILE ? "enabled" : "disabled"}`);
  console.log(`    benchmark lanes: ${lanes.join("; ")}`);
  console.log(`    conformance: ${WASM_ONLY ? "Wasm output is" : "kVM env-free and Wasm outputs are"} compared to native expected values`);
}

printBenchmarkDescription();
console.log(`==> Running Integer Performance Test (${testSuite.length} cases, Iterations: ${ITERATIONS})...`);

function runWasmIterations(iterations, { profile = false, resetArena = false } = {}) {
  const iterationTimes = [];
  const opStats = Object.fromEntries(ops.map(op => [op, {
    calls: 0,
    allocatedBytes: 0,
    maxAllocatedBytes: 0,
    time: 0
  }]));
  const arenaStart = exports.arena_mark();
  const memoryStart = exports.memory.buffer.byteLength;
  const startedAt = performance.now();

  for (let i = 0; i < iterations; i++) {
    const iterationStartedAt = performance.now();
    for (const tc of testSuite) {
      const mark = resetArena || profile ? exports.arena_mark() : 0;
      const callStartedAt = profile ? performance.now() : 0;
      const funcName = cleanName(state.relAliases[benchNames[tc.op]]);
      const result = exports[funcName](tc.wasmPtrIn);
      assert.ok(result[1] === 1);

      if (profile) {
        const allocatedBytes = exports.arena_mark() - mark;
        const stats = opStats[tc.op];
        stats.calls++;
        stats.allocatedBytes += allocatedBytes;
        stats.maxAllocatedBytes = Math.max(stats.maxAllocatedBytes, allocatedBytes);
        stats.time += performance.now() - callStartedAt;
      }
      if (resetArena) {
        exports.arena_reset(mark);
      }
    }
    iterationTimes.push(performance.now() - iterationStartedAt);
  }

  return {
    time: performance.now() - startedAt,
    arenaStart,
    arenaEnd: exports.arena_mark(),
    memoryStart,
    memoryEnd: exports.memory.buffer.byteLength,
    iterationTimes,
    opStats
  };
}

function runTimedIterations(iterations, body) {
  const iterationTimes = [];
  const startedAt = performance.now();

  for (let i = 0; i < iterations; i++) {
    const iterationStartedAt = performance.now();
    body();
    iterationTimes.push(performance.now() - iterationStartedAt);
  }

  return {
    time: performance.now() - startedAt,
    iterationTimes
  };
}

function average(times) {
  return times.reduce((sum, time) => sum + time, 0) / times.length;
}

function formatTiming(result) {
  const samples = result.iterationTimes.map(time => time.toFixed(2)).join(", ");
  return `(${samples}) ~ ${average(result.iterationTimes).toFixed(2)} ms/iteration`;
}

let nativeAwareResult;
let nativeFreeResult;
let kvmFreeResult;

if (!WASM_ONLY) {
  nativeAwareResult = runTimedIterations(ITERATIONS, () => {
    for (const tc of testSuite) {
      const relDef = relDefs[tc.op];
      const res = run(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
      assert.ok(res !== undefined);
    }
  });

  nativeFreeResult = runTimedIterations(ITERATIONS, () => {
    for (const tc of testSuite) {
      const relDef = relDefs[tc.op];
      const res = run_converged(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
      assert.ok(res !== undefined);
    }
  });

  kvmFreeResult = runTimedIterations(ITERATIONS, () => {
    for (const tc of testSuite) {
      const kvmFunc = kvmFuncs[tc.op];
      const res = executeKVM(kvmFunc, tc.inputVal, contextFree);
      assert.ok(res !== undefined);
    }
  });
}

if (WASM_WARMUP_ITERATIONS > 0) {
  console.log(`==> Warming WebAssembly (${WASM_WARMUP_ITERATIONS} iterations)...`);
  runWasmIterations(WASM_WARMUP_ITERATIONS, { resetArena: true });
}

const wasmResult = runWasmIterations(ITERATIONS, {
  profile: WASM_PROFILE,
  resetArena: WASM_RESET
});

console.log("\n=================== INTEGER BENCHMARK RESULTS ===================");
console.log(`Operation calls per iteration: ${testSuite.length}`);
console.log(`Total operation calls: ${ITERATIONS * testSuite.length}`);
console.log("-----------------------------------------------------------------");
if (!WASM_ONLY) {
  console.log(`1. Native JS (Envelope-Aware):   ${formatTiming(nativeAwareResult)}`);
  console.log(`2. Native JS (Envelope-Free):    ${formatTiming(nativeFreeResult)}`);
  console.log(`3. kVM Interpreter (Env-Free):   ${formatTiming(kvmFreeResult)}`);
}
console.log(`4. WebAssembly:                  ${formatTiming(wasmResult)}`);
console.log("=================================================================\n");

if (WASM_PROFILE) {
  console.log("================ WEBASSEMBLY ALLOCATION PROFILE ================");
  console.log(`Arena bytes retained:            ${wasmResult.arenaEnd - wasmResult.arenaStart}`);
  console.log(`Linear memory growth:            ${wasmResult.memoryEnd - wasmResult.memoryStart}`);
  console.log(`Linear memory size:              ${wasmResult.memoryEnd}`);
  console.log(`Iteration samples:               ${formatTiming(wasmResult)}`);
  for (const op of ops) {
    const stats = wasmResult.opStats[op];
    console.log(`${op.padEnd(5)}: calls=${stats.calls}, allocated=${stats.allocatedBytes}, max/call=${stats.maxAllocatedBytes}, total_time=${stats.time.toFixed(2)} ms`);
  }
  console.log("================================================================\n");
}

const toPlainObject = val => JSON.parse(JSON.stringify(val));

for (const tc of testSuite) {
  if (!WASM_ONLY) {
    const kvmFunc = kvmFuncs[tc.op];
    const resFree = executeKVM(kvmFunc, tc.inputVal, contextFree);
    assert.deepEqual(toPlainObject(resFree), toPlainObject(tc.expected));
  }

  const mark = exports.arena_mark();
  const funcName = cleanName(state.relAliases[benchNames[tc.op]]);
  const wasmRes = exports[funcName](tc.wasmPtrIn);
  assert.ok(wasmRes[1] === 1);
  const resWasm = readArenaValue(exports, wasmRes[0], tc.wasmOutputPattern, 0, tc.wasmOutputPatternPropertyList);
  assert.deepEqual(toPlainObject(resWasm), toPlainObject(tc.expected));
  exports.arena_reset(mark);
}
console.log("Conformance validation: ALL RESULTS MATCH EXPECTED VALUES (including Wasm)!");
