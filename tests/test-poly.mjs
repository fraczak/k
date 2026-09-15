import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createState, evaluateInput } from "../backend-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arithmeticsPath = path.join(root, "Examples/arithmetics.k");
const polyPath = path.join(root, "Examples/poly.k");

console.log("==> Running Polymorphic List Tests (Examples/poly.k)");

const state = createState();
await evaluateInput(`:load ${arithmeticsPath}`, state);
await evaluateInput(`:load ${polyPath}`, state);

async function evalK(snippet) {
  const res = await evaluateInput(snippet, state);
  assert.ok(res && res.length > 0 && !res[0].includes("undefined"), `Evaluation failed for: ${snippet}`);
  return res[0];
}

// Test 1: Concat
{
  const res = await evalK(`
    l1 = {{}|a car, {{}|b car, nil cdr} cons cdr} cons;
    l2 = {{}|c car, {{}|d car, nil cdr} cons cdr} cons;
    {l1 xs, l2 ys} concat
  `);
  assert.match(res, /\|a car.*\|b car.*\|c car.*\|d car/);
  console.log("Test 1 (concat): Passed");
}

// Test 2: Reverse
{
  const res = await evalK(`
    l = {{}|first car, {{}|second car, {{}|third car, nil cdr} cons cdr} cons cdr} cons;
    l reverse
  `);
  assert.match(res, /\|third car.*\|second car.*\|first car/);
  console.log("Test 2 (reverse): Passed");
}

// Test 3: Length
{
  const res = await evalK(`
    l = {{}|a car, {{}|b car, {{}|c car, nil cdr} cons cdr} cons cdr} cons;
    l length
  `);
  // 3 in LSB-first binary with '+' sign: |_|1|1|+
  assert.match(res, /1.*1.*\+/);
  console.log("Test 3 (length): Passed");
}

// Test 4: Get N-th
{
  const res0 = await evalK(`
    l = {{}|item0 car, {{}|item1 car, {{}|item2 car, nil cdr} cons cdr} cons cdr} cons;
    {0 int n, l xs} get_nth
  `);
  assert.match(res0, /\|item0/);

  const res1 = await evalK(`{1 int n, l xs} get_nth`);
  assert.match(res1, /\|item1/);

  const res2 = await evalK(`{2 int n, l xs} get_nth`);
  assert.match(res2, /\|item2/);
  console.log("Test 4 (get_nth): Passed");
}

// Test 5: Split By
{
  const res = await evalK(`
    l = {{}|a car, {{}|b car, {{}|c car, {{}|d car, nil cdr} cons cdr} cons cdr} cons cdr} cons;
    {2 int n, l xs} split_by
  `);
  assert.match(res, /first/);
  assert.match(res, /second/);
  console.log("Test 5 (split_by): Passed");
}

// Test 6: Take and Drop
{
  const resTake = await evalK(`
    l = {{}|a car, {{}|b car, {{}|c car, nil cdr} cons cdr} cons cdr} cons;
    {2 int n, l xs} take
  `);
  assert.match(resTake, /\|a car.*\|b car/);

  const resDrop = await evalK(`
    {2 int n, l xs} drop
  `);
  assert.match(resDrop, /\|c car/);
  console.log("Test 6 (take & drop): Passed");
}

// Test 7: Repeat
{
  const res = await evalK(`
    {3 int n, {}|val x} repeat
  `);
  assert.match(res, /\|val car.*\|val car.*\|val car/);
  console.log("Test 7 (repeat): Passed");
}

// Test 8: Append
{
  const res = await evalK(`
    l = {{}|a car, {{}|b car, nil cdr} cons cdr} cons;
    {{}|c x, l xs} append
  `);
  assert.match(res, /\|a car.*\|b car.*\|c car/);
  console.log("Test 8 (append): Passed");
}

// Test 9: Zip
{
  const res = await evalK(`
    l1 = {{}|k1 car, {{}|k2 car, nil cdr} cons cdr} cons;
    l2 = {1 int car, {2 int car, nil cdr} cons cdr} cons;
    {l1 xs, l2 ys} zip
  `);
  assert.match(res, /\|k1 x/);
  assert.match(res, /\|k2 x/);
  console.log("Test 9 (zip): Passed");
}

console.log("==> All Polymorphic List Tests Passed Successfully!");
