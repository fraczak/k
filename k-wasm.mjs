#!/usr/bin/env node

import fs from "node:fs";
import { stdin, stdout, argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import wabtFactory from "wabt";
import { annotate } from "./index.mjs";
import { lowerToKVM } from "./kvm.mjs";
import { lowerToWasm, getTagId, getTagFromId } from "./kvm2wasm.mjs";
import { decodeWire, encodeToWire } from "./codecs/runtime/prefix-codec.mjs";
import { decodeObject, loadLibrary } from "./object.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList, propertyListToPattern } from "./codecs/runtime/pattern-json.mjs";
import { Product, Variant } from "./Value.mjs";
import codes from "./codes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wabtInstance = await wabtFactory();

function usage() {
  const prog = argv[1] || "k-wasm.mjs";
  console.error(`Usage: node ${prog} [ options ] ( k-expr | -k file ) [ input-file ]`);
  console.error("Options:");
  console.error("  --lib file          Load a .klib dependency before compiling. May be repeated.");
  console.error("  -h, --help          Show this help.");
}

function compileWat(watText) {
  const watModule = wabtInstance.parseWat("k_wasm.wat", watText, {
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

const cleanName = (h) => "rel_" + h.replace(/[^a-zA-Z0-9_]/g, "_");

function compileModule(mainRelName, defs) {
  const compiled = new Set();
  const queue = [mainRelName];
  const wats = [];
  
  while (queue.length > 0) {
    const name = queue.shift();
    if (compiled.has(name)) continue;
    compiled.add(name);
    
    const relDef = defs.rels[name];
    if (!relDef) {
      throw new Error(`Relation ${name} not found`);
    }
    
    const kvmFunc = lowerToKVM(relDef, name);
    kvmFunc.typePatternGraph = relDef.typePatternGraph;
    
    // Scan for call dependencies using raw hashes/names
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
    
    // Rename functions in KVM IR to valid Wasm identifiers
    kvmFunc.name = cleanName(name);
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

function getPattern(graph, patternId) {
  const nodeId = graph.find(patternId);
  return propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, nodeId)));
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
    
    // Evaluate and allocate all children first
    const childPtrs = [];
    for (let i = 0; i < N; i++) {
      const label = keys[i];
      const edge = patternNode.edges.find(e => e.label === label);
      const childPtr = writeValueToArena(exports, value.product[label], pattern, edge.target);
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

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return exit(0);
  }

  const libraries = [];

  // Parse options
  while (args.length > 0) {
    if (args[0] === "--lib") {
      args.shift();
      const libPath = args.shift();
      if (!libPath) throw new Error("--lib requires a file argument");
      const libBuffer = fs.readFileSync(libPath);
      libraries.push(loadLibrary(decodeObject(libBuffer)));
    } else {
      break;
    }
  }

  let kScriptStr = (function (arg) {
    if (arg == null) {
      throw new Error("Missing script argument");
    }
    if (arg === "-k") {
      const fileArg = args.shift();
      if (!fileArg) throw new Error("-k requires a file argument");
      return fs.readFileSync(fileArg, "utf8");
    } else {
      return arg;
    }
  })(args.shift());

  const inputStream = (function (arg) {
    if (arg == null) {
      return stdin;
    }
    return fs.createReadStream(arg);
  })(args.shift());

  const defs = annotate(kScriptStr, { libraries });
  const mainRel = defs.rels.__main__;
  if (!mainRel) {
    throw new Error("No main relation (__main__) defined in script");
  }

  // Compile relation graph to Wasm
  const moduleWatBody = compileModule("__main__", defs);
  const runtimeWatPath = path.join(__dirname, "runtime.wat");
  const runtimeWat = fs.readFileSync(runtimeWatPath, "utf8");
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + moduleWatBody + "\n)";
  
  const binary = compileWat(fullWat);
  const module = await WebAssembly.compile(binary);
  const instance = await WebAssembly.instantiate(module);
  const exports = instance.exports;

  // Read stdin buffer
  const buffer = [];
  inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
  inputStream.on("end", () => {
    try {
      const inputBuffer = Buffer.concat(buffer);
      const { pattern: inputWirePattern, value } = decodeWire(inputBuffer);
      
      const graph = mainRel.typePatternGraph;
      
      const inputPatternNodeId = graph.find(mainRel.def.patterns[0]);
      const inputPattern = propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, inputPatternNodeId)));
      
      const outputPatternNodeId = graph.find(mainRel.def.patterns[1]);
      const outputPatternPropertyList = patternToPropertyList(exportPatternGraph(graph, outputPatternNodeId));
      const outputPattern = propertyListToPattern(outputPatternPropertyList);
      
      // Write input to the arena
      const ptrIn = writeValueToArena(exports, value, inputPattern, 0);
      
      // Call main Wasm function
      const result = exports.rel___main__(ptrIn);
      if (result[1] !== 1) {
        throw new Error("Wasm relation execution failed (returned false)");
      }
      
      // Decode return value
      const resVal = readArenaValue(exports, result[0], outputPattern, 0, outputPatternPropertyList);
      
      // Output wire format
      stdout.write(encodeToWire(resVal, resVal.pattern));
    } catch (error) {
      console.error(error.stack || error.message || String(error));
      exit(1);
    }
  });
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  exit(1);
});
