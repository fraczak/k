import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  compileARM64Artifact,
  compileARM64ArtifactFromKVM,
  compileARM64ArtifactFromObject,
  runARM64Artifact
} from "../src/arm64.mjs";
import {
  compileKVMModuleToARM64,
  emitMetadataC,
  getTagEntries,
  resetTagIds
} from "../src/kvm2arm64.mjs";
import { compileObjectBuffer, decodeObject } from "../../../object.mjs";
import { objectToKVMArtifact } from "../../../kvm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

console.log("==> Running ARM64 Backend Test Suite");

// Helper to convert JSON value to wire buffer via codecs/k-parse.mjs
function jsonToWire(jsonObj) {
  const jsonStr = typeof jsonObj === "string" ? jsonObj : JSON.stringify(jsonObj);
  return execFileSync("node", [path.join(ROOT, "codecs/k-parse.mjs")], {
    input: jsonStr
  });
}

// Helper to convert wire buffer to JSON value via codecs/k-print.mjs
function wireToJSON(wireBuf) {
  const outputStr = execFileSync("node", [path.join(ROOT, "codecs/k-print.mjs")], {
    input: wireBuf,
    encoding: "utf8"
  });
  return JSON.parse(outputStr.trim());
}

// 1. Identity / Unit Relation
console.log("==> Test 1: Identity / Unit Relation");
{
  const source = `()`;
  const artifact = compileARM64Artifact(source);
  const inputWire = jsonToWire({});
  const outWire = runARM64Artifact(artifact, inputWire);
  const outJSON = wireToJSON(outWire);
  assert.deepEqual(outJSON, {}, "Unit relation must return empty object {}");

  // Test --json mode
  const outJsonStr = runARM64Artifact(artifact, inputWire, { json: true });
  assert.equal(outJsonStr.trim(), "{}", "--json mode must return {}");
  console.log("  Passed!");
}

// 2. Boolean Negation (Variant Projection & Creation)
console.log("==> Test 2: Boolean Negation (Variants)");
{
  const source = `
    true = {} | true;
    false = {} | false;
    neg = < /true false, /false true >;
    neg
  `;
  const artifact = compileARM64Artifact(source);

  // Test neg(true) -> false
  const trueWire = jsonToWire({ true: {} });
  const falseWireOut = runARM64Artifact(artifact, trueWire);
  assert.deepEqual(wireToJSON(falseWireOut), "false");

  // Test neg(false) -> true
  const falseWire = jsonToWire({ false: {} });
  const trueWireOut = runARM64Artifact(artifact, falseWire);
  assert.deepEqual(wireToJSON(trueWireOut), "true");

  // Test --json mode
  const jsonOut = runARM64Artifact(artifact, trueWire, { json: true });
  assert.equal(jsonOut.trim(), '"false"');
  console.log("  Passed!");
}

// 3. Product Projection and Field Swapping
console.log("==> Test 3: Product Projection and Record Construction");
{
  const source = `
    swap = { .y x, .x y };
    swap
  `;
  const artifact = compileARM64Artifact(source);
  const inWire = jsonToWire({ x: "a", y: "b" });
  const outWire = runARM64Artifact(artifact, inWire);
  assert.deepEqual(wireToJSON(outWire), { x: "b", y: "a" });
  console.log("  Passed!");
}

// 4. Multi-branch Union with Backtracking
console.log("==> Test 4: Multi-branch Union with Backtracking");
{
  const source = `
    $ t = < {} a, {} b, {} c >;
    classify = <
      /a ({} | first),
      /b ({} | second),
      /c ({} | third)
    >;
    classify
  `;
  const artifact = compileARM64Artifact(source);

  assert.deepEqual(wireToJSON(runARM64Artifact(artifact, jsonToWire({ a: {} }))), "first");
  assert.deepEqual(wireToJSON(runARM64Artifact(artifact, jsonToWire({ b: {} }))), "second");
  assert.deepEqual(wireToJSON(runARM64Artifact(artifact, jsonToWire({ c: {} }))), "third");
  console.log("  Passed!");
}

// 5. Peano Addition with Tail-Call Optimization
console.log("==> Test 5: Peano Addition with Tail Recursion Optimization");
{
  const source = `
    $ nat = < {} 0, nat +1 >;
    0 = {} | 0 $ nat;
    inc = | +1 $ nat;
    dec = $ nat / +1;
    add = $ { nat x, nat y } <
      { . x dec x, . y inc y } add,
      . y
    >;
    add
  `;
  const artifact = compileARM64Artifact(source);

  // 3 + 2 = 5
  const n0 = "0";
  const n1 = { "+1": n0 };
  const n2 = { "+1": n1 };
  const n3 = { "+1": n2 };
  const n5 = { "+1": { "+1": n3 } };

  const inWire = jsonToWire({ x: n3, y: n2 });
  const outWire = runARM64Artifact(artifact, inWire);
  assert.deepEqual(wireToJSON(outWire), n5);

  // Test 0 + 2 = 2
  const inWireZero = jsonToWire({ x: n0, y: n2 });
  const outWireZero = runARM64Artifact(artifact, inWireZero);
  assert.deepEqual(wireToJSON(outWireZero), n2);
  console.log("  Passed!");
}

// 6. Deep Tail Recursion (testing stack safety with loop)
console.log("==> Test 6: Deep Tail Recursion Loop");
{
  const source = `
    $ nat = < {} 0, nat +1 >;
    0 = {} | 0 $ nat;
    inc = | +1 $ nat;
    dec = $ nat / +1;
    add = $ { nat x, nat y } <
      { . x dec x, . y inc y } add,
      . y
    >;
    add
  `;
  const artifact = compileARM64Artifact(source);

  // Compute 50 + 1 = 51
  let cur = "0";
  for (let i = 0; i < 50; i++) cur = { "+1": cur };
  const one = { "+1": "0" };

  const inWire = jsonToWire({ x: cur, y: one });
  const outWire = runARM64Artifact(artifact, inWire);
  const outJSON = wireToJSON(outWire);

  // Count the +1 depth
  let count = 0;
  let p = outJSON;
  while (p && typeof p === "object" && "+1" in p) {
    count++;
    p = p["+1"];
  }
  assert.equal(count, 51, "50 + 1 must yield depth 51");
  console.log("  Passed!");
}

// 7. Compilation to Assembly Text (-S)
console.log("==> Test 7: Assembly Text Generation");
{
  const source = `true = {} | true; true`;
  const { assembly, entryName } = compileARM64Artifact(source, { emit: "assembly" });
  assert.ok(typeof assembly === "string", "Assembly output must be a string");
  assert.ok(assembly.includes(".arch armv8-a"), "Assembly must target armv8-a");
  assert.ok(assembly.includes(`.global ${entryName}`), "Assembly must export entry symbol");
  assert.ok(assembly.includes("ret"), "Assembly must contain return instructions");
  console.log("  Passed!");
}

// 8. Compilation from .kvm Artifact
console.log("==> Test 8: Compilation from .kvm Artifact");
{
  const script = `
    $ bool = < {} true, {} false >;
    not = $ bool < /true ({} | false), /false ({} | true) >;
    not
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const kvm = objectToKVMArtifact(obj);

  const artifact = compileARM64ArtifactFromKVM(kvm);
  const inWire = jsonToWire({ true: {} });
  const outWire = runARM64Artifact(artifact, inWire);
  assert.deepEqual(wireToJSON(outWire), "false");
  console.log("  Passed!");
}

// 9. Failure Case (Partial Relation Non-Match)
console.log("==> Test 9: Failure Case (Relation Rejection)");
{
  const source = `
    onlyA = /a ({} | success);
    onlyA
  `;
  const artifact = compileARM64Artifact(source);
  const inWireFail = jsonToWire({ b: {} });

  assert.throws(
    () => runARM64Artifact(artifact, inWireFail),
    /failed with exit status 1/,
    "Executable must exit with status 1 on partial relation failure"
  );
  console.log("  Passed!");
}

console.log("==> All ARM64 Backend Unit Tests Passed Successfully!");
