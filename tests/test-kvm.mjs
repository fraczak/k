import assert from "node:assert";
import k from "../index.mjs";
import { lowerToKVM, executeKVM } from "../kvm.mjs";
import codes from "../codes.mjs";
import { fromObject, Product, Variant } from "../Value.mjs";
import run, { run_converged } from "../run.mjs";

function runKVM(script, data, options = {}) {
  const defs = k.annotate(script, {
    convergence: { strategy: "auto" }
  });
  const mainRel = defs.rels.__main__;
  const kvmFunc = lowerToKVM(mainRel, "__main__");
  const context = { rels: defs.rels, findCode: codes.find, options };
  return executeKVM(kvmFunc, fromObject(data), context);
}

function toJSON(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

console.log("==> Starting kVM Tests");

// Test 1: Identity
{
  const result = runKVM("()", { unit: {} });
  assert.deepEqual(toJSON(result), "unit");
  console.log("Test 1 (Identity): Passed");
}

// Test 2: Product field projection
{
  const result = runKVM(".name", { name: { ala: {} }, age: { twentythree: {} } });
  assert.deepEqual(toJSON(result), "ala");
  console.log("Test 2 (Field projection): Passed");
}

// Test 3: Variant projections and lifting
{
  const result = runKVM("/tag |tag", { tag: { payload: {} } });
  assert.deepEqual(toJSON(result), { tag: "payload" });
  console.log("Test 3 (Variant projection & construction): Passed");
}

// Test 4: Composition
{
  const result = runKVM("(.x .y)", { x: { y: { ok: {}, dummy: {} }, dummy: {} }, dummy: {} });
  assert.deepEqual(toJSON(result), { ok: {}, dummy: {} });
  console.log("Test 4 (Composition): Passed");
}

// Test 5: Union (Speculative choice)
{
  const result1 = runKVM("< /x, /y >", { x: { val: {} } });
  assert.deepEqual(toJSON(result1), "val");

  const result2 = runKVM("< /x, /y >", { y: { val: {} } });
  assert.deepEqual(toJSON(result2), "val");

  const result3 = runKVM("< /x, /y >", { z: { val: {} } });
  assert.equal(result3, undefined);
  console.log("Test 5 (Union / Choice): Passed");
}

// Test 6: Parallel Product
{
  const result = runKVM("{ .x fieldA, .y fieldB }", { x: { valA: {} }, y: { valB: {} } });
  assert.deepEqual(toJSON(result), {
    fieldA: "valA",
    fieldB: "valB"
  });
  console.log("Test 6 (Product): Passed");
}

// Test 7: Filters & Types
{
  const script = `
    $ bool = < {} true, {} false >;
    $ bool
  `;
  const result1 = runKVM(script, { true: {} });
  assert.deepEqual(toJSON(result1), "true");

  const result2 = runKVM(script, { unknown_tag: {} });
  assert.deepEqual(toJSON(result2), "unknown_tag");
  console.log("Test 7 (Filters & Type Guards): Passed");
}

// Test 8: Recursive List traversal (Cons/Nil)
{
  const script = `
    $ bool = < {} true, {} false >;
    true = {} | true $bool;
    false = {} | false $bool;
    
    list? = ?< {} nil, {X car, Y cdr} cons > = Y;
    nil = {}|nil list?;
    nil? = list? /nil nil;
    car = list? /cons .car;
    list? { 
      < nil? true, false > nil_test,
      < car, {}|none >  car 
    }
  `;

  // Test Nil list
  const res1 = runKVM(script, { nil: {} });
  assert.deepEqual(toJSON(res1), { nil_test: "true", car: "none" });

  // Test Cons list
  const res2 = runKVM(script, {
    cons: {
      car: { unit: {} },
      cdr: { nil: {} }
    }
  });
  assert.deepEqual(toJSON(res2), { nil_test: "false", car: "unit" });
  console.log("Test 8 (Recursive lists): Passed");
}

// Test 9: Comparing KVM execution vs Native JS run (Envelope-aware and Envelope-free)
{
  const script = `
    $ nat = < {} 0, nat +1 >;
    0 = {} | 0 $ nat;
    inc = | +1 $ nat;
    dec = $ nat / +1;
    add = $ { nat x, nat y } <
      { . x dec x, . y inc y } add,
      . y
    >;
  `;

  const inputData = {
    x: { "+1": { "+1": { "0": {} } } }, // 2
    y: { "+1": { "0": {} } }            // 1
  };

  // Run in native JS envelope-aware mode
  const nativeAware = k.run(script + " add", inputData);
  // Run in native JS envelope-free mode
  const defs = k.annotate(script + " add", {
    convergence: { strategy: "auto" }
  });
  run.defs = defs;
  run_converged.defs = defs;
  const nativeFree = run_converged(codes.find, defs.rels.__main__.def, fromObject(inputData), defs.rels.__main__.typePatternGraph);

  // Run in kVM envelope-aware mode
  const kvmAware = runKVM(script + " add", inputData, { envelopeFree: false });
  // Run in kVM envelope-free mode
  const kvmFree = runKVM(script + " add", inputData, { envelopeFree: true });

  assert.deepEqual(toJSON(kvmAware), toJSON(nativeAware));
  assert.deepEqual(toJSON(kvmFree), toJSON(nativeFree));
  
  // Verify that the output is 3 (i.e. +1(+1(+1(0))))
  assert.deepEqual(toJSON(kvmAware), { "+1": { "+1": { "+1": "0" } } });
  console.log("Test 9 (KVM vs JS run equivalence & Peano addition): Passed");
}

console.log("==> All kVM Tests Passed!");
