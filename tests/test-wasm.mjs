import assert from "node:assert/strict";
import fs from "node:fs";
import wabtFactory from "wabt";

console.log("==> Initializing WebAssembly TDD Harness");

let wabtInstance;
try {
  wabtInstance = await wabtFactory();
} catch (error) {
  console.error("Failed to load WABT:", error);
  process.exit(1);
}

// Helper to compile WAT string to a binary Uint8Array
export function compileWat(filename, watText) {
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

// Helper to instantiate compiled WASM buffer with standard imports
export async function instantiateWasm(binaryBuffer, imports = {}) {
  const module = await WebAssembly.compile(binaryBuffer);
  const instance = await WebAssembly.instantiate(module, imports);
  return instance.exports;
}

console.log("==> Running smoke test: Basic WAT Compilation & Execution");
{
  const smokeWat = `
    (module
      (func (export "add") (param $x i32) (param $y i32) (result i32)
        local.get $x
        local.get $y
        i32.add
      )
    )
  `;

  const binary = compileWat("smoke.wat", smokeWat);
  const exports = await instantiateWasm(binary);

  const res = exports.add(40, 2);
  console.log(`Add output: 40 + 2 = ${res}`);
  assert.equal(res, 42, "Smoke test: 40 + 2 must equal 42");
  console.log("Smoke test passed!");
}

console.log("==> Running runtime.wat Core Allocator Tests");
{
  const runtimeWat = fs.readFileSync("runtime.wat", "utf8");
  const binary = compileWat("runtime.wat", runtimeWat);
  const runtimeExports = await instantiateWasm(binary);

  // Test 1: First allocation starts at 1024 (aligned)
  const ptr1 = runtimeExports.alloc(10);
  assert.equal(ptr1, 1024, "Allocation 1 must start at 1024");
  assert.equal(ptr1 % 8, 0, "Allocation 1 must be 8-byte aligned");

  // Test 2: Second allocation must account for 10 bytes aligned to 16 bytes
  const ptr2 = runtimeExports.alloc(12);
  assert.equal(ptr2, 1040, "Allocation 2 must start at 1040");
  assert.equal(ptr2 % 8, 0, "Allocation 2 must be 8-byte aligned");

  // Test 3: Resetting to a mark must make temporary arena space reusable
  const mark = runtimeExports.arena_mark();
  assert.equal(mark, 1056, "Arena mark must point to the next free byte");
  assert.equal(runtimeExports.alloc(32), mark, "Temporary allocation must start at the mark");
  runtimeExports.arena_reset(mark);
  assert.equal(runtimeExports.alloc(32), mark, "Reset arena space must be reused");

  // Test 4: Large allocation causing memory growth beyond 64KB (page 1 limit)
  const ptr3 = runtimeExports.alloc(70000);
  assert.ok(ptr3 > 1040, "Large allocation must return a valid pointer");
  assert.equal(ptr3 % 8, 0, "Large allocation must be 8-byte aligned");
  console.log("Core Allocator tests passed successfully!");
}

import { lowerToWasm } from "../kvm2wasm.mjs";

console.log("==> Running Compiler Scaffolding Tests (id, fail, return)");
{
  const runtimeWat = fs.readFileSync("runtime.wat", "utf8");

  // Compile Identity function: %v1 = %in; return %v1;
  const kvmIdentity = {
    body: [
      { op: "id", dest: "%v1", src: "%in" },
      { op: "return", src: "%v1" }
    ]
  };
  const identityWat = lowerToWasm(kvmIdentity, "test_identity");
  const fullIdentityWat = runtimeWat.trim().slice(0, -1) + "\n" + identityWat + "\n)";
  const binaryIdentity = compileWat("identity.wat", fullIdentityWat);
  const exportsIdentity = await instantiateWasm(binaryIdentity);

  // Invoke identity: input value 1234 should return (1234, 1) -> success
  const resIdentity = exportsIdentity.test_identity(1234);
  // WebAssembly multi-value returns are returned as array in some JS environments, or directly if supported.
  // Note: Node 16+ supports multi-value return as array.
  assert.deepEqual(resIdentity, [1234, 1], "Identity test: must return [1234, 1]");

  // Compile Failure function: fail;
  const kvmFailure = {
    body: [
      { op: "fail" }
    ]
  };
  const failureWat = lowerToWasm(kvmFailure, "test_failure");
  const fullFailureWat = runtimeWat.trim().slice(0, -1) + "\n" + failureWat + "\n)";
  const binaryFailure = compileWat("failure.wat", fullFailureWat);
  const exportsFailure = await instantiateWasm(binaryFailure);

  // Invoke failure: input value 1234 should return (0, 0) -> failure
  const resFailure = exportsFailure.test_failure(1234);
  assert.deepEqual(resFailure, [0, 0], "Failure test: must return [0, 0]");

  console.log("Compiler Scaffolding tests passed successfully!");
}

import { annotate } from "../index.mjs";
import { getTagId } from "../kvm2wasm.mjs";

console.log("==> Running Product Operations Integration Tests");
{
  const runtimeWat = fs.readFileSync("runtime.wat", "utf8");

  // Compile a relation that creates a product { .x x, .y y } and another that projects .y
  const productDefs = annotate(`
    make_prod = { .x x, .y y };
    proj_y = make_prod .y;
    ()
  `, { convergence: { strategy: "auto" } });

  const makeProdWat = lowerToWasm(productDefs.rels.make_prod, "make_prod");
  const projYWat = lowerToWasm(productDefs.rels.proj_y, "proj_y");

  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + makeProdWat + "\n" + projYWat + "\n)";
  const binary = compileWat("product_tests.wat", fullWat);
  const exports = await instantiateWasm(binary);

  // Helper to write a product to the arena
  function writeProductToArena(fieldsMap) {
    const keys = Object.keys(fieldsMap).sort();
    const N = keys.length;
    const totalSize = 8 + 8 * N;
    const ptr = exports.alloc(totalSize);
    const view = new DataView(exports.memory.buffer);
    
    view.setUint32(ptr, totalSize, true);
    view.setUint32(ptr + 4, N, true);
    
    for (let i = 0; i < N; i++) {
      const offsetVal = 8 + 4 * N + 4 * i;
      const val = fieldsMap[keys[i]];
      view.setUint32(ptr + 8 + 4 * i, offsetVal, true);
      view.setUint32(ptr + offsetVal, val, true);
    }
    return ptr;
  }

  // 1. Test manual product creation & compiled projection
  const ptrIn = writeProductToArena({ x: 101, y: 202 });
  const resProj = exports.proj_y(ptrIn);
  assert.deepEqual(resProj, [202, 1], "Projection of y should return [202, 1]");

  // 2. Test compiled product creation & compiled projection
  // Passing ptrIn to make_prod should construct a new product using make_prod's logic
  const resMake = exports.make_prod(ptrIn);
  assert.equal(resMake[1], 1, "make_prod should succeed");
  const ptrOut = resMake[0];
  
  // Inspect memory of ptrOut
  const view = new DataView(exports.memory.buffer);
  assert.equal(view.getUint32(ptrOut, true), 24, "Product total size should be 24");
  assert.equal(view.getUint32(ptrOut + 4, true), 2, "Product field count should be 2");
  assert.equal(view.getUint32(ptrOut + 8, true), 16, "Offset of first field (x) should be 16");
  assert.equal(view.getUint32(ptrOut + 12, true), 20, "Offset of second field (y) should be 20");
  
  // The first field value should be the projection of x from ptrIn (101)
  const valXPtr = view.getUint32(ptrOut + 16, true);
  assert.equal(valXPtr, 101, "First field value should be 101");
  // The second field value should be the projection of y from ptrIn (202)
  const valYPtr = view.getUint32(ptrOut + 20, true);
  assert.equal(valYPtr, 202, "Second field value should be 202");

  console.log("Product Operations integration tests passed successfully!");
}

console.log("==> Running Variant Operations Integration Tests");
{
  const runtimeWat = fs.readFileSync("runtime.wat", "utf8");

  const variantDefs = annotate(`
    make_foo = |foo;
    proj_foo = /foo;
    proj_bar = /bar;
    ()
  `, { convergence: { strategy: "auto" } });

  const makeFooWat = lowerToWasm(variantDefs.rels.make_foo, "make_foo");
  const projFooWat = lowerToWasm(variantDefs.rels.proj_foo, "proj_foo");
  const projBarWat = lowerToWasm(variantDefs.rels.proj_bar, "proj_bar");

  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + 
    makeFooWat + "\n" + 
    projFooWat + "\n" + 
    projBarWat + "\n)";
  const binary = compileWat("variant_tests.wat", fullWat);
  const exports = await instantiateWasm(binary);

  // 1. Test compilation of variant tag creation
  const resMake = exports.make_foo(999);
  assert.equal(resMake[1], 1, "make_foo should succeed");
  const ptrVar = resMake[0];

  const view = new DataView(exports.memory.buffer);
  assert.equal(view.getUint32(ptrVar, true), 12, "Variant total size should be 12");
  assert.equal(view.getUint32(ptrVar + 4, true), getTagId("foo"), "Variant tagId should match 'foo'");
  assert.equal(view.getUint32(ptrVar + 8, true), 999, "Variant payload should be 999");

  // 2. Test variant projection success
  const resProjSuccess = exports.proj_foo(ptrVar);
  assert.deepEqual(resProjSuccess, [999, 1], "Projecting 'foo' from variant 'foo' should return [999, 1]");

  // 3. Test variant projection failure
  const resProjFail = exports.proj_bar(ptrVar);
  assert.deepEqual(resProjFail, [0, 0], "Projecting 'bar' from variant 'foo' should fail and return [0, 0]");

  console.log("Variant Operations integration tests passed successfully!");
}

console.log("==> Running Union & Choice Integration Tests");
{
  const runtimeWat = fs.readFileSync("runtime.wat", "utf8");

  const unionDefs = annotate(`
    choose = < /x, /y >;
    ()
  `, { convergence: { strategy: "auto" } });

  const chooseWat = lowerToWasm(unionDefs.rels.choose, "choose");
  const chooseWithRollbackWat = lowerToWasm({
    body: [
      {
        op: "union",
        dest: "%v0",
        src: "%in",
        branches: [
          {
            body: [
              { op: "make_variant", dest: "%v1", tag: "temporary", src: "%in" },
              { op: "fail" }
            ]
          },
          {
            body: [
              { op: "id", dest: "%v2", src: "%in" },
              { op: "return", src: "%v2" }
            ]
          }
        ]
      },
      { op: "return", src: "%v0" }
    ]
  }, "choose_with_rollback");
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + chooseWat + "\n" + chooseWithRollbackWat + "\n)";
  const binary = compileWat("union_tests.wat", fullWat);
  const exports = await instantiateWasm(binary);

  // Helper to write a variant to the arena
  function writeVariantToArena(tag, payloadVal) {
    const tagId = getTagId(tag);
    const ptr = exports.alloc(12);
    const view = new DataView(exports.memory.buffer);
    view.setUint32(ptr, 12, true);
    view.setUint32(ptr + 4, tagId, true);
    view.setUint32(ptr + 8, payloadVal, true);
    return ptr;
  }

  // 1. Pass variant with tag 'x': should match branch 1 and succeed
  const ptrX = writeVariantToArena("x", 777);
  const resX = exports.choose(ptrX);
  assert.deepEqual(resX, [777, 1], "choose with tag 'x' should return [777, 1]");

  // 2. Pass variant with tag 'y': should fail branch 1, match branch 2, and succeed
  const ptrY = writeVariantToArena("y", 888);
  const resY = exports.choose(ptrY);
  assert.deepEqual(resY, [888, 1], "choose with tag 'y' should return [888, 1]");

  // 3. Pass variant with tag 'z': should fail both branches and return failure
  const ptrZ = writeVariantToArena("z", 999);
  const resZ = exports.choose(ptrZ);
  assert.deepEqual(resZ, [0, 0], "choose with tag 'z' should return [0, 0]");

  // 4. Failed branches must release scratch allocations before trying the next choice
  const mark = exports.arena_mark();
  assert.deepEqual(exports.choose_with_rollback(999), [999, 1], "Fallback branch should return the input");
  assert.equal(exports.arena_mark(), mark, "Failed union branch allocations must be reclaimed");

  console.log("Union & Choice integration tests passed successfully!");
}

import { exportPatternGraph } from "../codecs/runtime/codec.mjs";
import { patternToPropertyList, propertyListToPattern } from "../codecs/runtime/pattern-json.mjs";
import { Product, Variant, fromObject } from "../Value.mjs";
import { getTagFromId } from "../kvm2wasm.mjs";

console.log("==> Running End-to-End Peano Addition & Serialization Tests");
{
  const runtimeWat = fs.readFileSync("runtime.wat", "utf8");

  const script = `
    $ nat = < {} 0, nat +1 >;
    0 = {} | 0 $ nat;
    inc = | +1 $ nat;
    dec = $ nat / +1;
    add = $ { nat x, nat y } <
      { . x dec x, . y inc y } add,
      . y
    >;
    ()
  `;

  const defs = annotate(script, { convergence: { strategy: "auto" } });

  // Compile relations to WAT
  const incWat = lowerToWasm(defs.rels.inc, "inc");
  const decWat = lowerToWasm(defs.rels.dec, "dec");
  const addWat = lowerToWasm(defs.rels.add, "add");

  // Combine and compile
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + 
    incWat + "\n" + 
    decWat + "\n" + 
    addWat + "\n)";
  const binary = compileWat("add_tests.wat", fullWat);
  const exports = await instantiateWasm(binary);

  // JS reader function for Wasm Execution Arena
  function readArenaValue(ptr, pattern, patternNodeId) {
    const patternNode = pattern.nodes[patternNodeId];
    const view = new DataView(exports.memory.buffer);
    
    if (patternNode.kind === 1 || patternNode.kind === 3) { // OPEN_PRODUCT or CLOSED_PRODUCT
      const size = view.getUint32(ptr, true);
      const N = view.getUint32(ptr + 4, true);
      const productObj = {};
      
      for (let i = 0; i < N; i++) {
        const edge = patternNode.edges[i];
        const offsetVal = view.getUint32(ptr + 8 + 4 * i, true);
        const childPtr = view.getUint32(ptr + offsetVal, true);
        productObj[edge.label] = readArenaValue(childPtr, pattern, edge.target);
      }
      return new Product(productObj, pattern);
    } else if (patternNode.kind === 2 || patternNode.kind === 4) { // OPEN_UNION or CLOSED_UNION
      const size = view.getUint32(ptr, true);
      const tagId = view.getUint32(ptr + 4, true);
      const payloadPtr = view.getUint32(ptr + 8, true);
      
      const tag = getTagFromId(tagId);
      const edge = patternNode.edges.find(e => e.label === tag);
      if (!edge) {
        throw new Error(`Variant tag '${tag}' not found in pattern edges`);
      }
      const payloadVal = readArenaValue(payloadPtr, pattern, edge.target);
      return new Variant(tag, payloadVal, pattern);
    }
    throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
  }

  // JS writer function for Wasm Execution Arena
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
      return ptr;
    }
    throw new Error(`Unsupported value type: ${value}`);
  }

  // Helper to extract property list pattern for a pattern ID in graph
  function getPattern(graph, patternId) {
    const nodeId = graph.find(patternId);
    return propertyListToPattern(patternToPropertyList(exportPatternGraph(graph, nodeId)));
  }

  // Prepare input values: 2 + 1 = 3
  const inputData = {
    x: { "+1": { "+1": { "0": {} } } }, // 2
    y: { "+1": { "0": {} } }            // 1
  };
  const valInput = fromObject(inputData);

  const graph = defs.rels.add.typePatternGraph;
  const inputPattern = getPattern(graph, defs.rels.add.def.patterns[0]);
  const outputPattern = getPattern(graph, defs.rels.add.def.patterns[1]);

  const ptrIn = writeValueToArena(valInput, inputPattern, 0);

  // Call compiled recursive Peano addition
  const res = exports.add(ptrIn);
  assert.equal(res[1], 1, "Peano addition must succeed");

  const valOutput = readArenaValue(res[0], outputPattern, 0);
  
  // Assert equivalence with reference math
  assert.deepEqual(valOutput.toJSON(), { "+1": { "+1": { "+1": "0" } } }, "Addition of 2 and 1 must equal 3");

  console.log("End-to-End Peano Addition & Serialization tests passed successfully!");
}

console.log("==> Harness ready.");
