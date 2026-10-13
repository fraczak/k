import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createState, evaluateInput } from "../backend-api.mjs";
import {
  compileRelationToPKIR,
  executePKIR,
  specializePKIR,
  valueToKVal,
  kvalToValue,
  PKIR_FORMAT,
  PKIR_VERSION
} from "../pkir.mjs";
import { buildAccessTable } from "../access-table.mjs";
import { Value } from "../Value.mjs";
import {
  compileWasmArtifactFromPKIR,
  instantiateWasmArtifact
} from "../backends/wasm/src/wasm.mjs";
import {
  compileLLVMArtifactFromPKIR
} from "../backends/llvm/src/llvm.mjs";
import {
  compilePKIRAndRun,
  compilePKIRToExecutable
} from "../backends/llvm/src/executable.mjs";

console.log("==> Running PKIR Test Suite (tests/test-pkir.mjs)");

// --------------------------------------------------------------------
// Helper to parse and type a relation in K state
// --------------------------------------------------------------------
async function compileKRel(script, relName) {
  const state = createState();
  await evaluateInput(script, state);
  const hashKey = state.relAliases[relName];
  assert.ok(hashKey, `Relation ${relName} not found in state aliases`);
  const relDef = state.rels[hashKey];
  return { relDef, hashKey, state };
}

// --------------------------------------------------------------------
// Test 1: compileRelationToPKIR on extract_id
// --------------------------------------------------------------------
{
  console.log("--> Test 1: compileRelationToPKIR on extract_id");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");

  const pkir = compileRelationToPKIR(relDef, "extract_id");
  assert.equal(pkir.format, PKIR_FORMAT);
  assert.equal(pkir.version, PKIR_VERSION);
  assert.equal(pkir.name, "extract_id");
  assert.equal(pkir.inputReg, "%v0");
  assert.ok(pkir.outputReg);
  assert.equal(pkir.instructions.length, 1);
  assert.equal(pkir.instructions[0].op, "union");
  assert.equal(pkir.instructions[0].branches.length, 3);

  // Check accessProfile records queried fields and tags
  assert.ok(pkir.accessProfile);
  const allFields = Object.values(pkir.accessProfile)
    .flatMap((p) => p.fields);
  const allVariants = Object.values(pkir.accessProfile)
    .flatMap((p) => p.variants);
  assert.ok(allFields.includes("id"));
  assert.ok(allVariants.includes("click"));
  assert.ok(allVariants.includes("sensor"));
  assert.ok(allVariants.includes("ping"));
  console.log("    Passed: extract_id lowered to valid PKIR structure.");
}

// --------------------------------------------------------------------
// Test 2: compileRelationToPKIR on recursive search_
// --------------------------------------------------------------------
{
  console.log("--> Test 2: compileRelationToPKIR on recursive search_");
  const script = `
    search_ = ?{X list, X result} 
    < 
      {.list/nil if, .result then}.then, 
      < 
        {.list/cons.car.flag/true if, {.list/cons.cdr list, {.list/cons.car car, .result cdr}|cons result} then} .then,
        {.list/cons.cdr list, .result result}
      > search_
    >;
  `;
  const { relDef } = await compileKRel(script, "search_");
  const pkir = compileRelationToPKIR(relDef, "search_");

  assert.equal(pkir.format, PKIR_FORMAT);
  assert.equal(pkir.name, "search_");
  assert.equal(pkir.instructions[0].op, "union");

  // Verify recursive call_rel instruction is emitted
  const jsonStr = JSON.stringify(pkir.instructions);
  assert.ok(jsonStr.includes('"op":"call_rel"'));
  console.log("    Passed: Recursive search_ compiled to PKIR.");
}

// --------------------------------------------------------------------
// Test 3: executePKIR on extract_id across variants
// --------------------------------------------------------------------
{
  console.log("--> Test 3: executePKIR on extract_id with AccessTable");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  // Schema S1: { id, status } | click
  const S1 = [
    ["closed-union", [["click", 1]]],
    ["closed-product", [["id", 2], ["status", 2]]],
    ["any", []]
  ];
  const P = [
    ["open-union", [["click", 1], ["sensor", 2], ["ping", 3]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["any", []]
  ];
  const table1 = buildAccessTable(S1, P);

  const valClick = Value.variant(
    "click",
    Value.product({
      id: Value.variant("evt_click_id", {}),
      status: Value.variant("active", {})
    })
  );
  const kvalClick = valueToKVal(valClick, table1.rootState);
  const res1 = executePKIR(pkir, kvalClick, table1);
  assert.equal(kvalToValue(res1).tag, "evt_click_id");

  // Schema S2: { battery_low, id, reading } | sensor
  // Sorted field order: battery_low (slot 0), id (slot 1),
  // reading (slot 2)
  const S2 = [
    ["closed-union", [["sensor", 1]]],
    ["closed-product", [["battery_low", 2], ["id", 2], ["reading", 2]]],
    ["any", []]
  ];
  const table2 = buildAccessTable(S2, P);

  const valSensor = Value.variant(
    "sensor",
    Value.product({
      battery_low: Value.variant("warning", {}),
      id: Value.variant("evt_sensor_id", {}),
      reading: Value.variant("val_99", {})
    })
  );
  const kvalSensor = valueToKVal(valSensor, table2.rootState);
  const res2 = executePKIR(pkir, kvalSensor, table2);
  assert.equal(kvalToValue(res2).tag, "evt_sensor_id");

  // Schema S3: { id } | ping
  const S3 = [
    ["closed-union", [["ping", 1]]],
    ["closed-product", [["id", 2]]],
    ["any", []]
  ];
  const table3 = buildAccessTable(S3, P);

  const valPing = Value.variant(
    "ping",
    Value.product({ id: Value.variant("evt_ping_id", {}) })
  );
  const kvalPing = valueToKVal(valPing, table3.rootState);
  const res3 = executePKIR(pkir, kvalPing, table3);
  assert.equal(kvalToValue(res3).tag, "evt_ping_id");

  console.log("    Passed: Multi-variant dispatch executed across layouts.");
}

// --------------------------------------------------------------------
// Test 4: executePKIR on search_ with opaque payloads
// --------------------------------------------------------------------
{
  console.log("--> Test 4: executePKIR on recursive search_");
  const script = `
    search_ = ?{X list, X result} 
    < 
      {.list/nil if, .result then}.then, 
      < 
        {.list/cons.car.flag/true if, {.list/cons.cdr list, {.list/cons.car car, .result cdr}|cons result} then} .then,
        {.list/cons.cdr list, .result result}
      > search_
    >;
  `;
  const { relDef, hashKey } = await compileKRel(script, "search_");
  const pkir = compileRelationToPKIR(relDef, "search_");
  const context = { rels: { [hashKey]: pkir } };

  const item1 = Value.product({
    data: Value.variant("payload_a", {}),
    flag: Value.variant("true", {}),
    id: Value.variant("alpha", {})
  });
  const item2 = Value.product({
    data: Value.variant("payload_b", {}),
    flag: Value.variant("false", {}),
    id: Value.variant("beta", {})
  });
  const item3 = Value.product({
    data: Value.variant("payload_c", {}),
    flag: Value.variant("true", {}),
    id: Value.variant("gamma", {})
  });
  const nilVal = Value.variant("nil", {});

  const listVal = Value.variant(
    "cons",
    Value.product({
      car: item1,
      cdr: Value.variant(
        "cons",
        Value.product({
          car: item2,
          cdr: Value.variant("cons", Value.product({ car: item3, cdr: nilVal }))
        })
      )
    })
  );

  const inputVal = Value.product({ list: listVal, result: nilVal });
  const kval = valueToKVal(inputVal, 0);

  const resKval = executePKIR(pkir, kval, null, context);
  const resVal = kvalToValue(resKval);

  // Result should contain gamma then alpha; beta excluded
  assert.equal(resVal.tag, "cons");
  const firstCar = resVal.value.product.car.product;
  assert.equal(firstCar.id.tag, "gamma");
  assert.equal(firstCar.data.tag, "payload_c");

  const secondCons = resVal.value.product.cdr;
  assert.equal(secondCons.tag, "cons");
  const secondCar = secondCons.value.product.car.product;
  assert.equal(secondCar.id.tag, "alpha");
  assert.equal(secondCar.data.tag, "payload_a");

  assert.equal(secondCons.value.product.cdr.tag, "nil");
  console.log("    Passed: Recursive search executed; payloads preserved.");
}

// --------------------------------------------------------------------
// Test 5: specializePKIR with dead branch elimination
// --------------------------------------------------------------------
{
  console.log("--> Test 5: specializePKIR with dead branch elimination");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  // Schema S only provides the click variant
  const S_click = [
    ["closed-union", [["click", 1]]],
    ["closed-product", [["id", 2], ["status", 2]]],
    ["any", []]
  ];
  const P = [
    ["open-union", [["click", 1], ["sensor", 2], ["ping", 3]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["any", []]
  ];

  const table = buildAccessTable(S_click, P);
  const spec = specializePKIR(pkir, table);

  assert.equal(spec.isSpecialized, true);
  // Dead branch elimination: only 1 branch survives out of 3
  assert.equal(spec.instructions[0].branches.length, 1);

  const branchInsts = spec.instructions[0].branches[0].instructions;
  // First instruction must be match_tag_imm
  assert.equal(branchInsts[0].op, "match_tag_imm");
  assert.equal(branchInsts[0].tag, "click");
  assert.equal(branchInsts[0].tagId, 0);

  // Second instruction must be project_offset with static byte offset
  assert.equal(branchInsts[1].op, "project_offset");
  assert.equal(branchInsts[1].offset, 0);
  assert.equal(branchInsts[1].label, "id");

  // Verify specialized execution without AccessTable
  const valClick = Value.variant(
    "click",
    Value.product({
      id: Value.variant("spec_click_val", {}),
      status: Value.variant("spec_status", {})
    })
  );
  const kval = valueToKVal(valClick, table.rootState);
  const res = executePKIR(spec, kval, null);
  assert.equal(kvalToValue(res).tag, "spec_click_val");
  console.log("    Passed: Dead branches eliminated & offsets baked in.");
}

// --------------------------------------------------------------------
// Test 6: specializePKIR on sensor variant (non-zero offset)
// --------------------------------------------------------------------
{
  console.log("--> Test 6: specializePKIR with non-zero offset inlining");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  // Schema S has battery_low (slot 0), id (slot 1), reading (slot 2)
  const S_sensor = [
    ["closed-union", [["sensor", 1]]],
    ["closed-product", [["battery_low", 2], ["id", 2], ["reading", 2]]],
    ["any", []]
  ];
  const P = [
    ["open-union", [["click", 1], ["sensor", 2], ["ping", 3]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["any", []]
  ];

  const table = buildAccessTable(S_sensor, P);
  const spec = specializePKIR(pkir, table);

  assert.equal(spec.instructions[0].branches.length, 1);
  const branchInsts = spec.instructions[0].branches[0].instructions;
  assert.equal(branchInsts[0].op, "match_tag_imm");
  assert.equal(branchInsts[0].tag, "sensor");

  // In alphabetical order: battery_low = 0, id = 8 bytes offset
  assert.equal(branchInsts[1].op, "project_offset");
  assert.equal(branchInsts[1].offset, 8);
  assert.equal(branchInsts[1].skipCount, 1);

  const valSensor = Value.variant(
    "sensor",
    Value.product({
      battery_low: Value.variant("low", {}),
      id: Value.variant("sensor_target", {}),
      reading: Value.variant("100", {})
    })
  );
  const kval = valueToKVal(valSensor, table.rootState);
  const res = executePKIR(spec, kval, null);
  assert.equal(kvalToValue(res).tag, "sensor_target");
  console.log("    Passed: Static byteOffset=8 inlined and verified.");
}

// --------------------------------------------------------------------
// Test 7: valueToKVal and kvalToValue round-trip fidelity
// --------------------------------------------------------------------
{
  console.log("--> Test 7: valueToKVal and kvalToValue round-trip");
  const original = Value.variant(
    "node",
    Value.product({
      alpha: Value.variant("val_a", {}),
      nested: Value.product({
        inner_1: Value.variant("x", {}),
        inner_2: Value.variant("y", {})
      })
    })
  );

  const kval = valueToKVal(original, 0);
  const reconstructed = kvalToValue(kval);

  assert.equal(reconstructed.tag, "node");
  assert.equal(reconstructed.value.product.alpha.tag, "val_a");
  assert.equal(reconstructed.value.product.nested.product.inner_1.tag, "x");
  assert.equal(reconstructed.value.product.nested.product.inner_2.tag, "y");
  console.log("    Passed: Deep nested structures round-trip losslessly.");
}

// --------------------------------------------------------------------
// Test 8: Partial function failure semantics
// --------------------------------------------------------------------
{
  console.log("--> Test 8: Partial function failure semantics in PKIR");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  // An unexpected variant tag /other should fail gracefully
  const unexpectedVal = Value.variant(
    "other",
    Value.product({ id: Value.variant("val", {}) })
  );
  const kval = valueToKVal(unexpectedVal, 0);
  const res = executePKIR(pkir, kval, null);
  assert.equal(res, null);
  console.log("    Passed: Non-matching variant returns null (fail).");
}

// --------------------------------------------------------------------
// Test 9: WebAssembly compilation via compileWasmArtifactFromPKIR
// --------------------------------------------------------------------
{
  console.log("--> Test 9: WebAssembly compilation from PKIR");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  const wasmBuffer = await compileWasmArtifactFromPKIR(pkir, {
    entry: "extract_id"
  });
  assert.ok(wasmBuffer && wasmBuffer.length > 0);

  const runner = await instantiateWasmArtifact(wasmBuffer);
  const inputClick = Value.variant(
    "click",
    Value.product({ id: Value.variant("123", Value.product({})) })
  );
  const resClick = runner.executeValue(inputClick);
  assert.equal(resClick?.tag, "123");

  const inputSensor = Value.variant(
    "sensor",
    Value.product({ id: Value.variant("sensor_456", Value.product({})) })
  );
  const resSensor = runner.executeValue(inputSensor);
  assert.equal(resSensor?.tag, "sensor_456");

  console.log("    Passed: PKIR lowered to Wasm and executed correctly.");
}

// --------------------------------------------------------------------
// Test 10: LLVM IR compilation via compileLLVMArtifactFromPKIR
// --------------------------------------------------------------------
{
  console.log("--> Test 10: LLVM compilation from PKIR");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  const llvmText = compileLLVMArtifactFromPKIR(pkir, {
    entry: "extract_id"
  });
  assert.ok(typeof llvmText === "string" && llvmText.includes("@k_main"));
  assert.ok(llvmText.includes("@k_union_arm_0"));

  const inputClick = Value.variant(
    "click",
    Value.product({ id: Value.variant("llvm_click_789", Value.product({})) })
  );
  const resClick = compilePKIRAndRun(pkir, { input: inputClick });
  assert.equal(resClick.stdout.trim(), '"llvm_click_789"');

  const inputSensor = Value.variant(
    "sensor",
    Value.product({ id: Value.variant("llvm_sensor_101", Value.product({})) })
  );
  const resSensor = compilePKIRAndRun(pkir, { input: inputSensor });
  assert.equal(resSensor.stdout.trim(), '"llvm_sensor_101"');

  console.log("    Passed: PKIR lowered to LLVM and executed correctly.");
}

// --------------------------------------------------------------------
// Test 11: LLVM executable compilation via compilePKIRToExecutable
// --------------------------------------------------------------------
{
  console.log("--> Test 11: LLVM executable compilation from PKIR");
  const script = "extract_id = </click.id, /sensor.id, /ping.id>;";
  const { relDef } = await compileKRel(script, "extract_id");
  const pkir = compileRelationToPKIR(relDef, "extract_id");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-test-pkir-llvm-"));
  const exePath = path.join(tmpDir, "extract_id_test");
  try {
    compilePKIRToExecutable(pkir, exePath);
    assert.ok(fs.existsSync(exePath));

    const inputPing = Value.variant(
      "ping",
      Value.product({ id: Value.variant("llvm_ping_42", Value.product({})) })
    );
    const res = compilePKIRAndRun(pkir, { input: inputPing });
    assert.equal(res.stdout.trim(), '"llvm_ping_42"');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("    Passed: PKIR compiled to standalone LLVM executable.");
}

// --------------------------------------------------------------------
// Test 12: Recursive polymorphic relation via PKIR on LLVM
// --------------------------------------------------------------------
{
  console.log("--> Test 12: Recursive polymorphic relation on LLVM");
  const script = `
    list? = ?< {} nil, { {} car, list? cdr } cons >;
    rec_copy = list? <
      /nil |nil,
      /cons { .car car, .cdr rec_copy cdr } |cons
    > list?;
  `;
  const { relDef } = await compileKRel(script, "rec_copy");
  const pkirRec = compileRelationToPKIR(relDef, "rec_copy");

  const inputList = Value.variant(
    "cons",
    Value.product({
      car: Value.variant("elem1", Value.product({})),
      cdr: Value.variant(
        "cons",
        Value.product({
          car: Value.variant("elem2", Value.product({})),
          cdr: Value.variant("nil", Value.product({}))
        })
      )
    })
  );

  const res = compilePKIRAndRun(pkirRec, { input: inputList });
  assert.equal(
    res.stdout.trim(),
    '{"cons":{"car":"elem1","cdr":{"cons":{"car":"elem2","cdr":"nil"}}}}'
  );
  console.log("    Passed: Recursive polymorphic relation executed on LLVM.");
}

console.log("\n==> All PKIR Tests Passed Successfully!");
