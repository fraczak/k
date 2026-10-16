import assert from "node:assert/strict";
import { buildAccessTable } from "../access-table.mjs";

console.log("==> Running Access Table Tests (tests/test-access-table.mjs)");

// --------------------------------------------------------------------
// Test 1: Access Table for 'search' on Disparate Schema
// --------------------------------------------------------------------
{
  console.log("--> Test 1: Access Table for 'search' on Disparate Schema");

  // Input Schema S: list of { data, flag, id }
  const S_list = [
    ["closed-union", [["cons", 1], ["nil", 2]]],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-product", []],
    ["closed-product", [["data", 4], ["flag", 5], ["id", 6]]],
    ["any", []],
    ["closed-union", [["false", 2], ["true", 2]]],
    ["any", []]
  ];

  // Function Pattern P: list of { flag: <true, ...> }
  const P_search = [
    ["closed-union", [["cons", 1], ["nil", 2]]],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-product", []],
    ["open-product", [["flag", 4]]],
    ["open-union", [["true", 2]]],
  ];

  const table = buildAccessTable(S_list, P_search, { wordSize: 8 });
  assert.equal(table.stateCount, 7);

  // 1a: Check list union resolution (State 0)
  const consVariant = table.resolveVariant(0, "cons");
  assert.equal(consVariant.tagId, 0);
  assert.equal(consVariant.branchId, 0);
  assert.equal(consVariant.childState, 1);

  const nilVariant = table.resolveVariant(0, "nil");
  assert.equal(nilVariant.tagId, 1);
  assert.equal(nilVariant.branchId, 1);
  assert.equal(nilVariant.childState, 2);

  // 1b: Check cons product resolution (State 1)
  const carField = table.resolveField(1, "car");
  assert.equal(carField.physicalSlot, 0);
  assert.equal(carField.byteOffset, 0);
  assert.equal(carField.childState, 3);

  const cdrField = table.resolveField(1, "cdr");
  assert.equal(cdrField.physicalSlot, 1);
  assert.equal(cdrField.byteOffset, 8);
  assert.equal(cdrField.childState, 0);

  // 1c: Check item product resolution (State 3: { data, flag, id })
  // In alphabetical order: data = 0, flag = 1, id = 2
  const flagField = table.resolveField(3, "flag");
  assert.equal(flagField.physicalSlot, 1);
  assert.equal(flagField.byteOffset, 8);
  assert.equal(flagField.skipCount, 1);
  assert.equal(flagField.childState, 5); // points to boolean union

  // Logical slot access (by numeric slot 0)
  const flagBySlot = table.resolveField(3, 0);
  assert.equal(flagBySlot.byteOffset, 8);
  assert.equal(flagBySlot.childState, 5);
  assert.equal(flagBySlot.skipCount, 1);

  console.log("    Passed: AccessTable correctly resolves fields and variants.");
}

// --------------------------------------------------------------------
// Test 2: Access Table for Multi-Variant Dispatch ('extract_id')
// --------------------------------------------------------------------
{
  console.log("--> Test 2: Access Table for Multi-Variant Dispatch");

  const P_extract = [
    ["closed-union", [["click", 1], ["ping", 2], ["sensor", 3]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["open-product", [["id", 4]]],
    ["any", []]
  ];

  // Click: { active, id } -> id is at physical slot 1
  const S_click = [
    ["closed-union", [["click", 1]]],
    ["closed-product", [["active", 2], ["id", 3]]],
    ["any", []],
    ["any", []]
  ];

  // Sensor: { battery_low, id, reading } -> id is at physical slot 1
  const S_sensor = [
    ["closed-union", [["sensor", 1]]],
    ["closed-product", [["battery_low", 2], ["id", 3], ["reading", 4]]],
    ["any", []],
    ["any", []],
    ["any", []]
  ];

  // Ping: { id } -> id is at physical slot 0
  const S_ping = [
    ["closed-union", [["ping", 1]]],
    ["closed-product", [["id", 2]]],
    ["any", []]
  ];

  const tClick = buildAccessTable(S_click, P_extract, { wordSize: 8 });
  const tSensor = buildAccessTable(S_sensor, P_extract, { wordSize: 8 });
  const tPing = buildAccessTable(S_ping, P_extract, { wordSize: 8 });

  // In click, id is at offset 8 (after active)
  assert.equal(tClick.resolveField(1, "id").byteOffset, 8);
  assert.equal(tClick.resolveField(1, "id").skipCount, 1);

  // In sensor, id is at offset 8 (after battery_low)
  assert.equal(tSensor.resolveField(1, "id").byteOffset, 8);
  assert.equal(tSensor.resolveField(1, "id").skipCount, 1);

  // In ping, id is at offset 0
  assert.equal(tPing.resolveField(1, "id").byteOffset, 0);
  assert.equal(tPing.resolveField(1, "id").skipCount, 0);

  console.log("    Passed: Variable offsets resolved per variant schema.");
}

// --------------------------------------------------------------------
// Test 3: Simulating In-Memory Payload Navigation via AccessTable
// --------------------------------------------------------------------
{
  console.log("--> Test 3: Simulating In-Memory Payload Navigation");

  // S: list of { data, flag, id }
  const S = [
    ["closed-union", [["cons", 1], ["nil", 2]]],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-product", []],
    ["closed-product", [["data", 4], ["flag", 5], ["id", 6]]],
    ["any", []],
    ["closed-union", [["false", 2], ["true", 2]]],
    ["any", []]
  ];

  const P = [
    ["closed-union", [["cons", 1], ["nil", 2]]],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-product", []],
    ["open-product", [["flag", 4]]],
    ["open-union", [["true", 2]]],
  ];

  const table = buildAccessTable(S, P, { wordSize: 8 });

  // Mock in-memory value representation:
  // Node representation in word arrays:
  // Item 1: { data: 'blob1', flag: 'true', id: 'alpha' }
  // Sorted physical layout: slot 0 = data, slot 1 = flag, slot 2 = id
  const item1 = {
    tag: null,
    words: [
      { text: "blob1" }, // offset 0
      { tag: 1, text: "true" }, // offset 8 (true is tag 1 in {false:0, true:1})
      { text: "alpha" } // offset 16
    ]
  };

  // Cons cell: slot 0 = car, slot 1 = cdr
  const nilCell = { tag: 1, words: [] }; // tag 1 = nil
  const consCell = {
    tag: 0, // tag 0 = cons
    words: [item1, nilCell]
  };

  // Navigate using table and word indices (zero string comparisons):
  let state = table.rootState; // 0
  assert.equal(state, 0);

  // Step 1: Match union at root
  const unionDesc = table.getDescriptor(state);
  const tag = consCell.tag; // 0
  const branch = unionDesc.branchMap[tag]; // 0 (cons)
  assert.equal(branch, 0);
  state = unionDesc.childStateMap[tag]; // state 1 (cons product)
  assert.equal(state, 1);

  // Step 2: Project .car (slot 0)
  const carMeta = table.resolveField(state, 0);
  assert.equal(carMeta.byteOffset, 0);
  const carNode = consCell.words[carMeta.byteOffset / 8];
  state = carMeta.childState; // state 3 (item product)
  assert.equal(state, 3);

  // Step 3: Project .flag (slot 0 in P's view of car)
  const flagMeta = table.resolveField(state, 0);
  assert.equal(flagMeta.byteOffset, 8); // correctly jumps to slot 1!
  const flagVal = carNode.words[flagMeta.byteOffset / 8];
  state = flagMeta.childState; // state 5 (boolean union)
  assert.equal(state, 5);

  // Step 4: Check if flag is 'true'
  const boolDesc = table.getDescriptor(state);
  const flagTag = flagVal.tag; // 1 ('true')
  const flagBranch = boolDesc.branchMap[flagTag];
  assert.equal(flagBranch, 0); // matches P's only branch ('true')

  console.log("    Passed: Zero-string navigation simulation successful.");
}

console.log("\n==> All Access Table Tests Passed Successfully!");
