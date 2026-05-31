import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wabtFactory from "wabt";

import { createState, evaluateInput } from "../repl.mjs";
import { lowerToKVM, executeKVM } from "../kvm.mjs";
import { lowerToWasm, getTagId, getTagFromId } from "../kvm2wasm.mjs";
import { patternToPropertyList, propertyListToPattern } from "../codecs/runtime/pattern-json.mjs";
import { exportPatternGraph } from "../codecs/runtime/codec.mjs";
import codes from "../codes.mjs";
import { Product, Variant } from "../Value.mjs";
import { parse as parseFloat64, print as printFloat64 } from "../codecs/ieee.mjs";
import { valueForCode } from "../repl-codecs.mjs";
import run, { run_converged } from "../run.mjs";

console.log("==> Initializing state and loading Examples/ieee.k");
const state = createState();
await evaluateInput(":load Examples/ieee.k", state);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWat = fs.readFileSync(path.join(__dirname, "../runtime.wat"), "utf8");
const wabtInstance = await wabtFactory();

function compileWat(watText) {
  const watModule = wabtInstance.parseWat("ieee_perf.wat", watText, {
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
    
    for (const inst of kvmFunc.body) {
      if (inst.op === "call") {
        if (!compiled.has(inst.func) && !queue.includes(inst.func)) {
          queue.push(inst.func);
        }
      }
      if (inst.branches) {
        const scan = (insts) => {
          for (const sub of insts) {
            if (sub.op === "call") {
              if (!compiled.has(sub.func) && !queue.includes(sub.func)) {
                queue.push(sub.func);
              }
            }
            if (sub.branches) {
              for (const br of sub.branches) {
                scan(br.body);
              }
            }
          }
        };
        for (const br of inst.branches) {
          scan(br.body);
        }
      }
    }
    
    kvmFunc.name = cleanName(hash);
    const cleanInsts = (insts) => {
      for (const inst of insts) {
        if (inst.op === "call") {
          inst.func = cleanName(inst.func);
        }
        if (inst.branches) {
          for (const br of inst.branches) {
            cleanInsts(br.body);
          }
        }
      }
    };
    cleanInsts(kvmFunc.body);
    
    const wat = lowerToWasm(kvmFunc, kvmFunc.name);
    wats.push(wat);
  }
  
  return wats.join("\n\n");
}

function readArenaValue(exports, ptr, pattern, patternNodeId, patternPropertyList) {
  const patternNode = pattern.nodes[patternNodeId];
  const view = new DataView(exports.memory.buffer);
  
  if (patternNode.kind === 1 || patternNode.kind === 3) {
    const size = view.getUint32(ptr, true);
    const N = view.getUint32(ptr + 4, true);
    const productObj = {};
    
    for (let i = 0; i < N; i++) {
      const edge = patternNode.edges[i];
      const offsetVal = view.getUint32(ptr + 8 + 4 * i, true);
      const childPtr = view.getUint32(ptr + offsetVal, true);
      productObj[edge.label] = readArenaValue(exports, childPtr, pattern, edge.target, patternPropertyList);
    }
    return new Product(productObj, patternPropertyList);
  } else if (patternNode.kind === 2 || patternNode.kind === 4) {
    const size = view.getUint32(ptr, true);
    const tagId = view.getUint32(ptr + 4, true);
    const payloadPtr = view.getUint32(ptr + 8, true);
    
    const tag = getTagFromId(tagId);
    const edge = patternNode.edges.find(e => e.label === tag);
    if (!edge) {
      throw new Error(`Variant tag '${tag}' not found in pattern edges`);
    }
    const payloadVal = readArenaValue(exports, payloadPtr, pattern, edge.target, patternPropertyList);
    return new Variant(tag, payloadVal, patternPropertyList);
  }
  throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
}

function writeValueToArena(exports, value, pattern, patternNodeId) {
  const patternNode = pattern.nodes[patternNodeId];
  
  if (value instanceof Product) {
    const keys = Object.keys(value.product).sort();
    const N = keys.length;
    const totalSize = 8 + 8 * N;
    const ptr = exports.alloc(totalSize);
    
    // Evaluate and allocate all children first
    const childPtrs = [];
    for (let i = 0; i < N; i++) {
      const label = keys[i];
      const edge = patternNode.edges.find(e => e.label === label);
      const childPtr = writeValueToArena(exports, value.product[label], pattern, edge.target);
      childPtrs.push(childPtr);
    }
    
    // All allocations/grows are done; now create the DataView
    const view = new DataView(exports.memory.buffer);
    view.setUint32(ptr, totalSize, true);
    view.setUint32(ptr + 4, N, true);
    
    for (let i = 0; i < N; i++) {
      const offsetVal = 8 + 4 * N + 4 * i;
      view.setUint32(ptr + 8 + 4 * i, offsetVal, true);
      view.setUint32(ptr + offsetVal, childPtrs[i], true);
    }
    return ptr;
  } else if (value instanceof Variant) {
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

const ops = ["add", "sub", "mul", "div"];

console.log("==> Compiling WebAssembly module...");
const opHashes = ops.map(op => state.relAliases[op]);
const wats = compileMultiModule(opHashes, state);
const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + wats + "\n)";
const binary = compileWat(fullWat);
const module = await WebAssembly.compile(binary);
const instance = await WebAssembly.instantiate(module);
const exports = instance.exports;

const float64Hash = state.typeAliases.float64;
const floatPairHash = state.typeAliases.float_pair;

function float64(text) {
  return valueForCode(parseFloat64(text), float64Hash, codes.find);
}

function floatPair(x, y) {
  return valueForCode(new Product({
    x: float64(x),
    y: float64(y)
  }), floatPairHash, codes.find);
}

const values = ["0.5", "-4", "0", "Infinity", "-Infinity", "NaN"];

// Compile all operations
const relDefs = {};
const kvmFuncs = {};
for (const op of ops) {
  const hash = state.relAliases[op];
  const relDef = state.rels[hash];
  relDefs[op] = relDef;
  kvmFuncs[op] = lowerToKVM(relDef, op);
}

// Generate the test matrix (6 * 6 * 4 = 144 cases)
console.log("==> Generating test cases and caching expected results");
const testSuite = [];
for (const op of ops) {
  for (const x of values) {
    for (const y of values) {
      const inputVal = floatPair(x, y);
      const relDef = relDefs[op];
      
      // Compute the native expected result
      run.defs = state;
      run_converged.defs = state;
      const expected = run(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
      if (expected === undefined) continue;
      
      testSuite.push({
        op,
        x,
        y,
        inputVal,
        expected
      });
    }
  }
}

// Cache Wasm pointers and output patterns for benchmark
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

// Define context options
const contextAware = {
  rels: state.rels,
  findCode: codes.find,
  options: { envelopeFree: false }
};

const contextFree = {
  rels: state.rels,
  findCode: codes.find,
  options: { envelopeFree: true }
};

// Default to 3 iterations for execution
// Set WASM_ONLY=1 WASM_PROFILE=1 for allocation stats. WASM_RESET=0 and
// WASM_WARMUP_ITERATIONS=0 reproduce the retained-arena and cold-start costs.
const ITERATIONS = process.env.ITERATIONS ? parseInt(process.env.ITERATIONS, 10) : 3;
const WASM_ONLY = process.env.WASM_ONLY === "1";
const WASM_PROFILE = process.env.WASM_PROFILE === "1";
const WASM_RESET = process.env.WASM_RESET !== "0";
const WASM_WARMUP_ITERATIONS = process.env.WASM_WARMUP_ITERATIONS
  ? parseInt(process.env.WASM_WARMUP_ITERATIONS, 10)
  : 10;

console.log(`==> Running Performance Test (${testSuite.length} cases, Iterations: ${ITERATIONS})...`);

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
    const iterationStartedAt = profile ? performance.now() : 0;
    for (const tc of testSuite) {
      const mark = resetArena || profile ? exports.arena_mark() : 0;
      const callStartedAt = profile ? performance.now() : 0;
      const funcName = cleanName(state.relAliases[tc.op]);
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
    if (profile) {
      iterationTimes.push(performance.now() - iterationStartedAt);
    }
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

// 1. Native JS Envelope-Aware
let timeNativeAware;
let timeNativeFree;
let timeKVMAware;
let timeKVMFree;

if (!WASM_ONLY) {
  const t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const tc of testSuite) {
      const relDef = relDefs[tc.op];
      const res = run(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
      assert.ok(res !== undefined);
    }
  }
  timeNativeAware = performance.now() - t0;

  // 2. Native JS Envelope-Free
  const t1 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const tc of testSuite) {
      const relDef = relDefs[tc.op];
      const res = run_converged(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
      assert.ok(res !== undefined);
    }
  }
  timeNativeFree = performance.now() - t1;

  // 3. kVM Envelope-Aware
  const t2 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const tc of testSuite) {
      const kvmFunc = kvmFuncs[tc.op];
      const res = executeKVM(kvmFunc, tc.inputVal, contextAware);
      assert.ok(res !== undefined);
    }
  }
  timeKVMAware = performance.now() - t2;

  // 4. kVM Envelope-Free
  const t3 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const tc of testSuite) {
      const kvmFunc = kvmFuncs[tc.op];
      const res = executeKVM(kvmFunc, tc.inputVal, contextFree);
      assert.ok(res !== undefined);
    }
  }
  timeKVMFree = performance.now() - t3;
}

// 5. WebAssembly Option B
if (WASM_WARMUP_ITERATIONS > 0) {
  console.log(`==> Warming WebAssembly (${WASM_WARMUP_ITERATIONS} iterations)...`);
  runWasmIterations(WASM_WARMUP_ITERATIONS, { resetArena: true });
}

const wasmResult = runWasmIterations(ITERATIONS, {
  profile: WASM_PROFILE,
  resetArena: WASM_RESET
});

console.log("\n=================== BENCHMARK RESULTS ===================");
console.log(`Total Operations evaluated: ${ITERATIONS * testSuite.length}`);
console.log("---------------------------------------------------------");
if (!WASM_ONLY) {
  console.log(`1. Native JS (Envelope-Aware):   ${timeNativeAware.toFixed(2)} ms`);
  console.log(`2. Native JS (Envelope-Free):    ${timeNativeFree.toFixed(2)} ms`);
  console.log(`3. kVM Interpreter (Env-Aware):  ${timeKVMAware.toFixed(2)} ms`);
  console.log(`4. kVM Interpreter (Env-Free):   ${timeKVMFree.toFixed(2)} ms`);
}
console.log(`5. WebAssembly (Option B):       ${wasmResult.time.toFixed(2)} ms`);
console.log("=========================================================\n");

if (WASM_PROFILE) {
  console.log("================ WEBASSEMBLY ALLOCATION PROFILE ================");
  console.log(`Arena bytes retained:            ${wasmResult.arenaEnd - wasmResult.arenaStart}`);
  console.log(`Linear memory growth:            ${wasmResult.memoryEnd - wasmResult.memoryStart}`);
  console.log(`Linear memory size:              ${wasmResult.memoryEnd}`);
  console.log(`Iteration times:                 ${wasmResult.iterationTimes.map(time => time.toFixed(2)).join(", ")} ms`);
  for (const op of ops) {
    const stats = wasmResult.opStats[op];
    console.log(`${op.padEnd(3)}: calls=${stats.calls}, allocated=${stats.allocatedBytes}, max/call=${stats.maxAllocatedBytes}, time=${stats.time.toFixed(2)} ms`);
  }
  console.log("================================================================\n");
}

// Conformance check
const toPlainObject = val => JSON.parse(JSON.stringify(val));

for (const tc of testSuite) {
  if (!WASM_ONLY) {
    const kvmFunc = kvmFuncs[tc.op];
    const resAware = executeKVM(kvmFunc, tc.inputVal, contextAware);
    const resFree = executeKVM(kvmFunc, tc.inputVal, contextFree);
    assert.deepEqual(toPlainObject(resAware), toPlainObject(tc.expected));
    assert.deepEqual(toPlainObject(resFree), toPlainObject(tc.expected));
  }
  
  const mark = exports.arena_mark();
  const funcName = cleanName(state.relAliases[tc.op]);
  const wasmRes = exports[funcName](tc.wasmPtrIn);
  assert.ok(wasmRes[1] === 1);
  const resWasm = readArenaValue(exports, wasmRes[0], tc.wasmOutputPattern, 0, tc.wasmOutputPatternPropertyList);
  assert.deepEqual(toPlainObject(resWasm), toPlainObject(tc.expected));
  exports.arena_reset(mark);
}
console.log("Conformance validation: ALL RESULTS MATCH EXPECTED VALUES (including Wasm)!");
