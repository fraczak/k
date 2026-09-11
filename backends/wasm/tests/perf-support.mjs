import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isProduct,
  isVariant,
  lowerToKVM,
  Value
} from "@fraczak/k/backend-api.mjs";
import { lowerToWasm, getTagId, getTagFromId } from "../src/kvm2wasm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadRuntimeWat() {
  return fs.readFileSync(path.join(__dirname, "../runtime.wat"), "utf8");
}

export const cleanName = (h) => "rel_" + h.replace(/[^a-zA-Z0-9_]/g, "_");

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

export function compileMultiModule(mainHashes, state) {
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

export function compileWat(watText, wabtInstance) {
  const watModule = wabtInstance.parseWat("perf.wat", watText, {
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

export async function instantiateWasmModule(mainHashes, state, wabtInstance) {
  const runtimeWat = loadRuntimeWat();
  const wats = compileMultiModule(mainHashes, state);
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + wats + "\n)";
  const binary = compileWat(fullWat, wabtInstance);
  const module = await WebAssembly.compile(binary);
  const instance = await WebAssembly.instantiate(module);
  return { instance, exports: instance.exports, module };
}

export function readArenaValue(exports, ptr, pattern, patternNodeId, patternPropertyList) {
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
    return Value.product(productObj, patternPropertyList);
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
    return Value.variant(tag, payloadVal, patternPropertyList);
  }
  throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
}

export function writeValueToArena(exports, value, pattern, patternNodeId) {
  const patternNode = pattern.nodes[patternNodeId];

  if (isProduct(value)) {
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
  } else if (isVariant(value)) {
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
