import fs from "node:fs";
import assert from "node:assert/strict";
import wabtFactory from "wabt";
import { createState, evaluateInput } from "./repl.mjs";
import { lowerToKVM } from "./kvm.mjs";
import { lowerToWasm, getTagId, getTagFromId, getFuncNameFromId } from "./kvm2wasm.mjs";
import { parse as parseFloat64, print as printFloat64 } from "./codecs/ieee.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList, propertyListToPattern } from "./codecs/runtime/pattern-json.mjs";
import { Product, Variant, fromObject } from "./Value.mjs";
import { valueForCode } from "./repl-codecs.mjs";
import codes from "./codes.mjs";

console.log("==> Starting Wasm IEEE-754 Square Demo");

// Initialize WABT
const wabtInstance = await wabtFactory();

function compileWat(filename, watText) {
  const watModule = wabtInstance.parseWat(filename, watText, {
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    multi_value: true,
    bulk_memory: true,
    reference_types: true
  });
  watModule.resolveNames();
  watModule.validate();
  const binary = watModule.toBinary({
    log: false,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: true
  });
  return binary.buffer;
}

// 1. Create REPL state and load ieee.k library
console.log("Loading IEEE-754 arithmetic library (Examples/ieee.k)...");
const state = createState();
await evaluateInput(":load Examples/ieee.k", state);

// 2. Define the squaring relation: square = { () x, () y } mul;
console.log("Defining relation: square = { () x, () y } mul;");
await evaluateInput("square = { () x, () y } mul;", state);
await evaluateInput("get_sign = $float64 .sign;", state);

// 3. Compile and Link relations recursively starting from square
console.log("Compiling and linking Wasm module...");

const cleanName = (h) => "rel_" + h.replace(/[^a-zA-Z0-9_]/g, "_");

function compileModule(mainRelHash) {
  const compiled = new Set();
  const queue = [mainRelHash];
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
    
    // Scan for call dependencies using raw hashes
    for (const inst of kvmFunc.body) {
      if (inst.op === "call") {
        if (!compiled.has(inst.func) && !queue.includes(inst.func)) {
          queue.push(inst.func);
        }
      }
      if (inst.op === "call_intrinsic") {
        console.log(`FOUND INTRINSIC: ${inst.symbol} in relation ${hash}`);
      }
      if (inst.branches) {
        const scan = (insts) => {
          for (const sub of insts) {
            if (sub.op === "call") {
              if (!compiled.has(sub.func) && !queue.includes(sub.func)) {
                queue.push(sub.func);
              }
            }
            if (sub.op === "call_intrinsic") {
              console.log(`FOUND INTRINSIC: ${sub.symbol} in relation ${hash}`);
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
    
    // Rename functions in KVM IR to valid Wasm identifiers
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
    
    const wat = lowerToWasm(kvmFunc, kvmFunc.name, { trace: true });
    if (hash === squareHash) {
      console.log("==> KVM IR for square:", JSON.stringify(kvmFunc.body, null, 2));
      console.log("==> Compiled WAT for square:\n", wat);
    }
    wats.push(wat);
  }
  
  return wats.join("\n\n");
}

const squareHash = state.relAliases["square"];
const getSignHash = state.relAliases["get_sign"];
const moduleWatBody = compileModule(squareHash);
const getSignWat = lowerToWasm(state.rels[getSignHash], "get_sign", { trace: true });
console.log("==> Compiled WAT for get_sign:\n", getSignWat);
const runtimeWat = fs.readFileSync("runtime.wat", "utf8");

// Combine Wasm runtime and compiled relations
const declarations = `
  (import "env" "log_call" (func $log_call (param i32 i32)))
  (import "env" "log_ret" (func $log_ret (param i32 i32 i32)))
`;
const runtimeWatWithImports = runtimeWat.replace("(module", "(module\n" + declarations);
const fullWat = runtimeWatWithImports.trim().slice(0, -1) + "\n" + moduleWatBody + "\n" + getSignWat + "\n)";
fs.writeFileSync("debug_full.wat", fullWat);
const binary = compileWat("square_demo.wat", fullWat);
const module = await WebAssembly.compile(binary);
const imports = {
  env: {
    log_call: (funcId, ptrIn) => {
      const funcName = getFuncNameFromId(funcId);
      console.log(`[Wasm Trace] Calling ${funcName} with input ptr ${ptrIn}`);
    },
    log_ret: (funcId, ptrOut, ok) => {
      const funcName = getFuncNameFromId(funcId);
      console.log(`[Wasm Trace] Returned from ${funcName} -> ptr ${ptrOut}, ok ${ok}`);
    }
  }
};
const instance = await WebAssembly.instantiate(module, imports);
const exports = instance.exports;

// JS Arena helpers
function readArenaValue(exports, ptr, pattern, patternNodeId) {
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
      productObj[edge.label] = readArenaValue(exports, childPtr, pattern, edge.target);
    }
    return new Product(productObj, pattern);
  } else if (patternNode.kind === 2 || patternNode.kind === 4) {
    const size = view.getUint32(ptr, true);
    const tagId = view.getUint32(ptr + 4, true);
    const payloadPtr = view.getUint32(ptr + 8, true);
    
    const tag = getTagFromId(tagId);
    console.log(`[Debug Arena] Read Variant at ptr=${ptr}: size=${size}, tagId=${tagId}, tag=${tag}`);
    const edge = patternNode.edges.find(e => e.label === tag);
    if (!edge) {
      throw new Error(`Variant tag '${tag}' not found in pattern edges`);
    }
    const payloadVal = readArenaValue(exports, payloadPtr, pattern, edge.target);
    return new Variant(tag, payloadVal, pattern);
  }
  throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
}

function writeValueToArena(value, pattern, patternNodeId) {
  const patternNode = pattern.nodes[patternNodeId];
  
  if (value instanceof Product) {
    const keys = Object.keys(value.product).sort();
    const N = keys.length;
    const totalSize = 8 + 8 * N;
    
    // Evaluate and allocate all children first
    const childPtrs = [];
    for (let i = 0; i < N; i++) {
      const label = keys[i];
      const edge = patternNode.edges.find(e => e.label === label);
      const childPtr = writeValueToArena(value.product[label], pattern, edge.target);
      childPtrs.push(childPtr);
    }
    
    const ptr = exports.alloc(totalSize);
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
    const childPtr = writeValueToArena(value.value, pattern, edge.target);
    
    const ptr = exports.alloc(12);
    const view = new DataView(exports.memory.buffer);
    
    view.setUint32(ptr, 12, true);
    view.setUint32(ptr + 4, tagId, true);
    view.setUint32(ptr + 8, childPtr, true);
    console.log(`[Debug Arena] Wrote Variant at ptr=${ptr}: tag=${value.tag}, tagId=${tagId}`);
    return ptr;
  }
  throw new Error(`Unsupported value type: ${value}`);
}

function getPattern(graph, patternId) {
  const nodeId = graph.find(patternId);
  return propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, nodeId)));
}

// 4. Run on an input
const inputValStr = "1.5";
console.log(`\nInput float64 value: ${inputValStr}`);

// Convert input string to IEEE float64 tree
const float64Hash = state.typeAliases.float64;
const parsedFloatVal = valueForCode(parseFloat64(inputValStr), float64Hash, codes.find);

// Resolve patterns
const squareRel = state.rels[squareHash];
const graph = squareRel.typePatternGraph;
const inputPattern = getPattern(graph, squareRel.def.patterns[0]);
const outputPattern = getPattern(graph, squareRel.def.patterns[1]);

// Run the JS interpreter first to check
import { executeKVM } from "./kvm.mjs";
const kvmFuncSquare = lowerToKVM(squareRel, squareHash);
const context = { rels: state.rels, findCode: codes.find, options: { envelopeFree: true, trace: false } };
const jsRes = executeKVM(kvmFuncSquare, parsedFloatVal, context);
console.log("JS Interpreter result:", jsRes ? printFloat64(jsRes.product.result) : "failed");

// Print keys and patterns for debugging
console.log("==> parsedFloatVal keys:", Object.keys(parsedFloatVal.product));
console.log("==> inputPattern node 0:", JSON.stringify(inputPattern.nodes[0], null, 2));
console.log("==> outputPattern node 0:", JSON.stringify(outputPattern.nodes[0], null, 2));

// Write input to the arena
const ptrIn = writeValueToArena(parsedFloatVal, inputPattern, 0);

// Call get_sign to test basic projection
console.log("Calling Wasm function 'get_sign'...");
const getSignRes = exports.get_sign(ptrIn);
if (getSignRes[1] === 1) {
  const getSignRel = state.rels[getSignHash];
  const getSignPattern = getPattern(getSignRel.typePatternGraph, getSignRel.def.patterns[1]);
  const getSignVal = readArenaValue(exports, getSignRes[0], getSignPattern, 0);
  console.log("get_sign output tag:", getSignVal.tag);
} else {
  console.log("get_sign failed!");
}

// Run the Wasm function
console.log("Calling Wasm function 'square'...");
const mainFuncName = cleanName(squareHash);
const result = exports[mainFuncName](ptrIn);

if (result[1] !== 1) {
  console.error("Wasm execution failed!");
  process.exit(1);
}

// Read and decode output from the arena
const outputVal = readArenaValue(exports, result[0], outputPattern, 0);

// Print the result using ieee print float64 codec helper
const outputResultFloat = outputVal.product.result;
const printResult = printFloat64(outputResultFloat);

console.log(`Result of (${inputValStr} * ${inputValStr}): ${printResult}`);
console.log("Flags:", outputVal.product.flags.tag);
console.log("==> Demo finished successfully!");
