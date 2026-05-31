import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createState, evaluateInput } from "../repl.mjs";
import { lowerToKVM, executeKVM } from "../kvm.mjs";
import codes from "../codes.mjs";
import { Product } from "../Value.mjs";
import { parse as parseFloat64, print as printFloat64 } from "../codecs/ieee.mjs";
import { valueForCode } from "../repl-codecs.mjs";
import run, { run_converged } from "../run.mjs";

console.log("==> Initializing state and loading Examples/ieee.k");
const state = createState();
await evaluateInput(":load Examples/ieee.k", state);

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

const ops = ["add", "sub", "mul", "div"];
const x = "2";
const y = "4";

// Compile all operations and precompute expected results
const relDefs = {};
const kvmFuncs = {};
const expectedResults = {};
const inputVal = floatPair(x, y);

for (const op of ops) {
  const hash = state.relAliases[op];
  const relDef = state.rels[hash];
  relDefs[op] = relDef;
  kvmFuncs[op] = lowerToKVM(relDef, op);
  
  // Get expected result once
  run.defs = state;
  run_converged.defs = state;
  expectedResults[op] = run(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
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

// Allow custom iteration count via environment variable (default to 5 for fast test validation)
const ITERATIONS = process.env.ITERATIONS ? parseInt(process.env.ITERATIONS, 10) : 5;

console.log(`==> Running Performance Test (Operations: [${ops.join(", ")}], Input: ${x} op ${y}, Iterations: ${ITERATIONS})...`);

// 1. Native JS Envelope-Aware
const t0 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  for (const op of ops) {
    const relDef = relDefs[op];
    const res = run(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
    assert.ok(res !== undefined);
  }
}
const timeNativeAware = performance.now() - t0;

// 2. Native JS Envelope-Free
const t1 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  for (const op of ops) {
    const relDef = relDefs[op];
    const res = run_converged(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
    assert.ok(res !== undefined);
  }
}
const timeNativeFree = performance.now() - t1;

// 3. kVM Envelope-Aware
const t2 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  for (const op of ops) {
    const kvmFunc = kvmFuncs[op];
    const res = executeKVM(kvmFunc, inputVal, contextAware);
    assert.ok(res !== undefined);
  }
}
const timeKVMAware = performance.now() - t2;

// 4. kVM Envelope-Free
const t3 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  for (const op of ops) {
    const kvmFunc = kvmFuncs[op];
    const res = executeKVM(kvmFunc, inputVal, contextFree);
    assert.ok(res !== undefined);
  }
}
const timeKVMFree = performance.now() - t3;

console.log("\n=================== BENCHMARK RESULTS ===================");
console.log(`Total Operations evaluated: ${ITERATIONS * ops.length} (${ops.length} ops * ${ITERATIONS} iterations)`);
console.log("---------------------------------------------------------");
console.log(`1. Native JS (Envelope-Aware):   ${timeNativeAware.toFixed(2)} ms`);
console.log(`2. Native JS (Envelope-Free):    ${timeNativeFree.toFixed(2)} ms`);
console.log(`3. kVM Interpreter (Env-Aware):  ${timeKVMAware.toFixed(2)} ms`);
console.log(`4. kVM Interpreter (Env-Free):   ${timeKVMFree.toFixed(2)} ms`);
console.log("=========================================================\n");

// Conformance check
for (const op of ops) {
  const kvmFunc = kvmFuncs[op];
  const resAware = executeKVM(kvmFunc, inputVal, contextAware);
  const resFree = executeKVM(kvmFunc, inputVal, contextFree);
  assert.deepEqual(JSON.stringify(resAware), JSON.stringify(expectedResults[op]));
  assert.deepEqual(JSON.stringify(resFree), JSON.stringify(expectedResults[op]));
}
console.log("Conformance validation: ALL RESULTS MATCH EXPECTED VALUES!");
