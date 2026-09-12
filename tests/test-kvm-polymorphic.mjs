import assert from "node:assert";
import k from "../index.mjs";
import {
  objectToKVMArtifact,
  specializeKVM,
  executeKVM
} from "../kvm.mjs";
import { compileObjectBuffer, decodeObject } from "../object.mjs";
import { objectToKIRP } from "../kir.mjs";
import { fromObject, Value } from "../Value.mjs";
import { lowerToWasm } from "../backends/wasm/src/kvm2wasm.mjs";
import wabtFactory from "wabt";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWat = fs.readFileSync(path.join(__dirname, "../backends/wasm/runtime.wat"), "utf8");

function toJSON(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

console.log("==> Starting Polymorphic kVM & Specialization Tests");

// Test 1: Compile Polymorphic kVM Artifact (AOT) without input pattern
{
  const script = `
    map = { .a first, .b second };
    map
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvmArtifact = objectToKVMArtifact(obj);

  assert.equal(kvmArtifact.format, "k-vm");
  assert.equal(kvmArtifact.layer, "KVM-P");
  assert.equal(kvmArtifact.isPolymorphic, true);
  assert.ok(kvmArtifact.functions["__main__"]);
  assert.ok(Array.isArray(kvmArtifact.inputPattern));
  console.log("Test 1 (Polymorphic kVM AOT Artifact): Passed");
}

// Test 2: Specialize Polymorphic kVM with Conforming Envelope & Subtyping
{
  const script = `
    map = { .a first, .b second };
    map
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvmArtifact = objectToKVMArtifact(obj);

  // Input envelope carries extra field 'extra'
  const inputEnvelope = [
    ["closed-product", [["a", 1], ["b", 2], ["extra", 3]]],
    ["closed-product", []],
    ["closed-union", [["valB", 4]]],
    ["closed-product", []],
    ["closed-product", []]
  ];

  const specialized = specializeKVM(kvmArtifact, inputEnvelope);
  assert.equal(specialized.isSpecialized, true);
  assert.equal(specialized.layer, "KVM-M");

  const specFunc = specialized.functions[specialized.entry];
  assert.ok(specFunc);
  assert.equal(specFunc.isSpecialized, true);

  // Execute in envelopeFree mode
  const val = fromObject({
    a: { unit: {} },
    b: { valB: {} },
    extra: { dummy: {} }
  });

  const res = executeKVM(specFunc, val, {
    rels: kvmArtifact.kir.rels,
    codes: kvmArtifact.codes,
    options: { envelopeFree: true }
  });

  assert.deepEqual(toJSON(res), {
    first: "unit",
    second: "valB"
  });
  console.log("Test 2 (Specialize with Subtyping & Envelope-Free Execution): Passed");
}

// Test 3: Type Error on Envelope Mismatch
{
  const script = `
    $ bool = < {} true, {} false >;
    check = $bool;
    check
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvmArtifact = objectToKVMArtifact(obj);

  // An envelope with variant 'other' does not conform to bool
  const incompatibleEnvelope = [
    ["closed-union", [["other", 1]]],
    ["closed-product", []]
  ];

  assert.throws(
    () => specializeKVM(kvmArtifact, incompatibleEnvelope),
    (err) => {
      assert.ok(err instanceof TypeError);
      assert.ok(err.message.includes("Type Error"));
      return true;
    },
    "Expected TypeError on incompatible envelope"
  );
  console.log("Test 3 (Type Error on Envelope Mismatch): Passed");
}

// Test 4: Dead Branch Elimination in Union Specialization
{
  const script = `
    choose = < /x, /y >;
    choose
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvmArtifact = objectToKVMArtifact(obj);
  const unspecFunc = kvmArtifact.functions[kvmArtifact.entry];
  const unspecUnion = unspecFunc.body.find(inst => inst.op === "union");
  assert.equal(unspecUnion.branches.length, 2, "Unspecialized union has 2 branches");

  // Specialize with envelope containing ONLY variant 'x'
  const xEnvelope = [
    ["closed-union", [["x", 1]]],
    ["closed-product", []]
  ];

  const specialized = specializeKVM(kvmArtifact, xEnvelope);
  const specFunc = specialized.functions[specialized.entry];
  const specUnion = specFunc.body.find(inst => inst.op === "union");

  // The 'y' branch should be pruned!
  assert.equal(specUnion.branches.length, 1, "Specialized union should prune unreachable branch");
  assert.equal(specUnion.branches[0].body[0].tag, "x");

  // Execution on { x: payload }
  const valX = fromObject({ x: { payload: {} } });
  const resX = executeKVM(specFunc, valX, {
    rels: kvmArtifact.kir.rels,
    codes: kvmArtifact.codes,
    options: { envelopeFree: true }
  });
  assert.deepEqual(toJSON(resX), "payload");

  console.log("Test 4 (Dead Branch Elimination in Union): Passed");
}

// Test 5: Redundant Guard Elimination
{
  const script = `
    filterTest = ?{ ... } (.a);
    filterTest
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvmArtifact = objectToKVMArtifact(obj);

  const inputEnvelope = [
    ["closed-product", [["a", 1]]],
    ["closed-product", []]
  ];

  const specialized = specializeKVM(kvmArtifact, inputEnvelope);
  const specFunc = specialized.functions[specialized.entry];

  // The guard_pattern was checking open product, which inputEnvelope already satisfies.
  // It should be simplified to 'id' or eliminated!
  const hasUnsimplifiedGuard = specFunc.body.some(inst => inst.op === "guard_pattern");
  assert.equal(hasUnsimplifiedGuard, false, "Redundant guard should be eliminated or simplified to id");

  console.log("Test 5 (Redundant Guard Elimination): Passed");
}

// Test 6: Fast Compilation to WebAssembly from Specialized kVM
{
  const script = `
    map = { .a first, .b second };
    map
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvmArtifact = objectToKVMArtifact(obj);

  const inputEnvelope = [
    ["closed-product", [["a", 1], ["b", 2], ["extra", 3]]],
    ["closed-product", []],
    ["closed-product", []],
    ["closed-product", []]
  ];

  const specialized = specializeKVM(kvmArtifact, inputEnvelope);
  const specFunc = specialized.functions[specialized.entry];

  // Lower directly to Wasm WAT
  const watBody = lowerToWasm(specFunc, "map_spec");
  assert.ok(watBody.includes("(func $map_spec"));

  // Assemble with wabt to ensure it is 100% valid Wasm
  const wabt = await wabtFactory();
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + watBody + "\n)";
  const wasmModule = wabt.parseWat("test.wat", fullWat, {
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    multi_value: true,
    bulk_memory: true,
    reference_types: true
  });
  wasmModule.resolveNames();
  wasmModule.validate();
  const binary = wasmModule.toBinary({ log: false, write_debug_names: false });
  assert.ok(binary.buffer.byteLength > 0);

  console.log("Test 6 (Direct Lowering to WebAssembly): Passed");
}

console.log("==> All Polymorphic kVM Tests Passed Successfully!");
