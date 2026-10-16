import assert from "node:assert/strict";
import { createState, evaluateInput } from "../backend-api.mjs";

console.log("==> Running Polymorphic TDD Suite (tests/test-polymorphic-tdd.mjs)");

const state = createState();

async function evalK(snippet) {
  const res = await evaluateInput(snippet, state);
  assert.ok(
    res && res.length > 0 && !res[0].includes("undefined"),
    `Evaluation failed for snippet:\n${snippet}`
  );
  const raw = res[0];
  const splitIdx = raw.indexOf(" ?");
  const val = splitIdx !== -1 ? raw.slice(0, splitIdx) : raw;
  const type = splitIdx !== -1 ? raw.slice(splitIdx + 1) : "";
  return { val, type, raw };
}

// --------------------------------------------------------------------
// Test 1: Search - Homogeneous List with Opaque Fields
// --------------------------------------------------------------------
{
  console.log("--> Test 1: Search on Homogeneous List with Opaque Fields");
  const script = `
    search = {()list, {}|nil result} search_; 
    search_ = ?{X list, X result} 
    < 
      {.list/nil if, .result then}.then, 
      < 
        {.list/cons.car.flag/true if, {.list/cons.cdr list, {.list/cons.car car, .result cdr}|cons result} then} .then,
        {.list/cons.cdr list, .result result}
      > search_
    >;

    i1 = {{}|alpha id, {}|true flag, {}|payload_a payload};
    i2 = {{}|beta id, {}|false flag, {}|payload_b payload};
    i3 = {{}|gamma id, {}|true flag, {}|payload_c payload};

    l_homo = {i1 car, {i2 car, {i3 car, {}|nil cdr}|cons cdr}|cons cdr}|cons;
    l_homo search
  `;

  const out = await evalK(script);
  // Expect i3 followed by i1 (accumulator reverses order); i2 is excluded
  assert.match(out.val, /gamma/);
  assert.match(out.val, /alpha/);
  assert.doesNotMatch(out.val, /beta/);
  // Check opaque fields are intact
  assert.match(out.val, /payload_c/);
  assert.match(out.val, /payload_a/);
  console.log("    Passed: Homogeneous list filtered with opaque payload preserved.");
}

// --------------------------------------------------------------------
// Test 2: Search - Pathological Field Ordering & Disparate Field Schemas
// --------------------------------------------------------------------
{
  console.log("--> Test 2: Search with Out-of-Order Fields & Disparate Value Types");
  const script = `
    p1 = {{}|large_blob data, {}|true flag, {}|first id};
    p2 = {{}|false flag, {}|second id, {}|medium_blob data};
    p3 = {{}|third id, {}|tiny_blob data, {}|true flag};

    l_reorder = {p1 car, {p2 car, {p3 car, {}|nil cdr}|cons cdr}|cons cdr}|cons;
    l_reorder search
  `;

  const out = await evalK(script);
  // Expect p3 matching first, then p1 matching; p2 excluded
  assert.match(out.val, /third/);
  assert.match(out.val, /tiny_blob/);
  assert.match(out.val, /first/);
  assert.match(out.val, /large_blob/);
  assert.doesNotMatch(out.val, /second/);
  assert.doesNotMatch(out.val, /medium_blob/);
  console.log("    Passed: Out-of-order fields & disparate value types preserved.");
}

// --------------------------------------------------------------------
// Test 3: Search - Boundary Cases (Empty List, All Match, None Match)
// --------------------------------------------------------------------
{
  console.log("--> Test 3: Search Boundary Cases (Empty, None Match, All Match)");

  // 3a: Empty list
  const outEmpty = await evalK(`{}|nil search`);
  assert.match(outEmpty.val, /nil/);

  // 3b: None match (all flag: false)
  const outNone = await evalK(`
    n1 = {{}|f1 id, {}|false flag};
    n2 = {{}|f2 id, {}|false flag};
    l_none = {n1 car, {n2 car, {}|nil cdr}|cons cdr}|cons;
    l_none search
  `);
  assert.match(outNone.val, /nil/);

  // 3c: All match (all flag: true)
  const outAll = await evalK(`
    m1 = {{}|t1 id, {}|true flag};
    m2 = {{}|t2 id, {}|true flag};
    l_all = {m1 car, {m2 car, {}|nil cdr}|cons cdr}|cons;
    l_all search
  `);
  assert.match(outAll.val, /t2.*t1/);
  console.log("    Passed: Boundary cases handled cleanly.");
}

// --------------------------------------------------------------------
// Test 4: Multi-Variant Dispatch with Varying Offsets (extract_id)
// --------------------------------------------------------------------
{
  console.log("--> Test 4: Multi-Variant Dispatch with Varying Offsets");
  const script = `
    extract_id = <
      /click.id,
      /sensor.id,
      /ping.id
    >;

    evt_c = {{}|evt_click id, {}|active status}|click;
    evt_s = {{}|battery_low status, {}|evt_sensor id, {}|reading data}|sensor;
    evt_p = {{}|evt_ping id}|ping;
  `;
  await evalK(script);

  const outC = await evalK("evt_c extract_id");
  assert.match(outC.val, /evt_click/);

  const outS = await evalK("evt_s extract_id");
  assert.match(outS.val, /evt_sensor/);

  const outP = await evalK("evt_p extract_id");
  assert.match(outP.val, /evt_ping/);
  console.log("    Passed: Common field extracted across variants with distinct layouts.");
}

// --------------------------------------------------------------------
// Test 5: Polymorphic Zip - Concurrency of Two Independent Types
// --------------------------------------------------------------------
{
  console.log("--> Test 5: Polymorphic Zip across Independent Types");
  const script = `
    zip = <
      {.xs /nil if, {}|nil then} .then,
      {.ys /nil if, {}|nil then} .then,
      {
        {.xs/cons.car x, .ys/cons.car y} car,
        {.xs/cons.cdr xs, .ys/cons.cdr ys} zip cdr
      }|cons
    >;

    xs = {{}|num1 car, {{}|num2 car, {}|nil cdr}|cons cdr}|cons;
    ys = {
      {{}|rec1_name name, {}|flag_true flag} car,
      {{{}|rec2_name name, {}|flag_false flag} car, {}|nil cdr}|cons cdr
    }|cons;

    {xs xs, ys ys} zip
  `;

  const out = await evalK(script);
  assert.match(out.val, /num1.*rec1_name/);
  assert.match(out.val, /num2.*rec2_name/);
  console.log("    Passed: Independent polymorphic streams paired into product.");
}

// --------------------------------------------------------------------
// Test 6: Polymorphic Reverse with Opaque Records
// --------------------------------------------------------------------
{
  console.log("--> Test 6: Polymorphic Reverse with Opaque Records");
  const script = `
    poly_rev = {()xs, {}|nil acc} _poly_rev;
    _poly_rev = ?{X xs, X acc} <
      {.xs/nil if, .acc then} .then,
      {.xs/cons.cdr xs, {.xs/cons.car car, .acc cdr}|cons acc} _poly_rev
    >;

    r1 = {{}|first item, {}|opaque_1 extra};
    r2 = {{}|second item, {}|opaque_2 extra};
    r3 = {{}|third item, {}|opaque_3 extra};
    list_to_rev = {r1 car, {r2 car, {r3 car, {}|nil cdr}|cons cdr}|cons cdr}|cons;

    list_to_rev poly_rev
  `;

  const out = await evalK(script);
  assert.match(out.val, /third.*second.*first/);
  assert.match(out.val, /opaque_3.*opaque_2.*opaque_1/);
  console.log("    Passed: Polymorphic list reversed with opaque record payloads intact.");
}

console.log("\n==> All Polymorphic TDD Tests Passed Successfully!");
