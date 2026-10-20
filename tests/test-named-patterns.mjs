// tests/test-named-patterns.mjs
// Comprehensive test suite for named patterns and type schemes.

import assert from "node:assert/strict";
import k from "../index.mjs";
import { Value } from "../Value.mjs";

console.log("==> Running Named Patterns Test Suite");

// Test 1: 0-arity pattern and composite product
console.log("--> Test 1: 0-arity pattern (bit[]) and product (byte[])");
{
  const script = `
    bit[] = < {}0, {}1 >;
    byte[] = {
      bit[] b0, bit[] b1, bit[] b2, bit[] b3,
      bit[] b4, bit[] b5, bit[] b6, bit[] b7
    };

    is_byte = ? byte[];

    sample = {
      {}|0 b0, {}|1 b1, {}|0 b2, {}|1 b3,
      {}|0 b4, {}|1 b5, {}|0 b6, {}|1 b7
    };

    sample is_byte
  `;
  const fn = k.compile(script);
  const out = fn(Value.product({}));
  assert.equal(out.type, "{}");
  assert.equal(out.product.b0.tag, "0");
  assert.equal(out.product.b1.tag, "1");
  console.log("    Passed: 0-arity patterns and composition.");
}

// Test 2: Parameterized list pattern
console.log("--> Test 2: Parameterized pattern (list[X])");
{
  const script = `
    bit[] = < {}0, {}1 >;
    list[X] = < {}nil, { X car, Y cdr } cons > = Y;

    is_bit_list = ? list[bit[]];

    empty = {}|nil is_bit_list;
    one = { {}|1 car, {}|nil cdr }|cons is_bit_list;
    two = {
      {}|0 car,
      { {}|1 car, {}|nil cdr }|cons cdr
    }|cons is_bit_list;

    { empty empty, one one, two two }
  `;
  const fn = k.compile(script);
  const out = fn(Value.product({}));
  assert.equal(out.product.empty.tag, "nil");
  assert.equal(out.product.one.tag, "cons");
  assert.equal(out.product.one.value.product.car.tag, "1");
  assert.equal(out.product.two.tag, "cons");
  assert.equal(out.product.two.value.product.car.tag, "0");
  console.log("    Passed: Parameterized list pattern.");
}

// Test 3: Multi-parameter templates and composition
console.log("--> Test 3: Multi-parameter templates (pair, dict)");
{
  const script = `
    bit[] = < {}0, {}1 >;
    pair[A, B] = { A key, B val };
    list[X] = < {}nil, { X car, Y cdr } cons > = Y;
    dict[K, V] = list[pair[K, V]];

    is_dict = ? dict[bit[], bit[]];

    entry = { {}|0 key, {}|1 val };
    d = { entry car, {}|nil cdr }|cons is_dict;

    d
  `;
  const fn = k.compile(script);
  const out = fn(Value.product({}));
  assert.equal(out.tag, "cons");
  assert.equal(out.value.product.car.product.key.tag, "0");
  assert.equal(out.value.product.car.product.val.tag, "1");
  console.log("    Passed: Multi-parameter template composition.");
}

// Test 4: Existential internal variables (type unification across fields)
console.log("--> Test 4: Existential variables (same_pair[])");
{
  const scriptOk = `
    same_pair[] = { T first, T second };
    check = ? same_pair[];
    { {}|0 first, {}|1 second } check
  `;
  const fnOk = k.compile(scriptOk);
  const outOk = fnOk(Value.product({}));
  assert.equal(outOk.product.first.tag, "0");
  assert.equal(outOk.product.second.tag, "1");

  const scriptBad = `
    same_pair[] = { T first, T second };
    check = ? same_pair[];
    { {} first, {}|0 second } check
  `;
  assert.throws(
    () => k.compile(scriptBad),
    /Cannot unify/
  );
  console.log("    Passed: Existential variables unified across fields.");
}

// Test 5: Recursive tree with internal knot and list
console.log("--> Test 5: Recursive tree with knot T (tree[X])");
{
  const script = `
    list[X] = < {}nil, { X car, Y cdr } cons > = Y;
    tree[X] = < {}nil, { X val, list[T] children } node > = T;

    bit[] = < {}0, {}1 >;
    is_tree = ? tree[bit[]];

    leaf = { {}|1 val, {}|nil children }|node is_tree;
    root = {
      {}|0 val,
      { leaf car, {}|nil cdr }|cons children
    }|node is_tree;

    { leaf leaf, root root }
  `;
  const fn = k.compile(script);
  const out = fn(Value.product({}));
  assert.equal(out.product.leaf.tag, "node");
  assert.equal(out.product.leaf.value.product.val.tag, "1");
  assert.equal(out.product.root.tag, "node");
  assert.equal(out.product.root.value.product.val.tag, "0");
  console.log("    Passed: Recursive tree template with list port.");
}

// Test 6: Polymorphic relation with shared type variable
console.log("--> Test 6: Polymorphic relation ({ X car, list[X] cdr })");
{
  const script = `
    list[X] = < {}nil, { X car, Y cdr } cons > = Y;
    head = ? { X car, list[X] cdr } .car;

    bit[] = < {}0, {}1 >;
    h1 = { {}|1 car, {}|nil cdr } head;

    h1
  `;
  const fn = k.compile(script);
  const out = fn(Value.product({}));
  assert.equal(out.tag, "1");
  console.log("    Passed: Polymorphic relation head with list[X].");
}

// Test 7: Error handling for templates
console.log("--> Test 7: Error handling (unknown, arity, cycles, dupes)");
{
  assert.throws(
    () => k.compile("check = ? missing[]; ()"),
    /Unknown pattern template 'missing\[\]'/
  );

  assert.throws(
    () => k.compile("list[X] = {}; check = ? list[]; ()"),
    /Pattern 'list' expects 1 argument, got 0/
  );

  assert.throws(
    () => k.compile("pair[A, B] = {}; check = ? pair[{}]; ()"),
    /Pattern 'pair' expects 2 arguments, got 1/
  );

  assert.throws(
    () => k.compile("a[] = b[]; b[] = a[]; check = ? a[]; ()"),
    /Cyclic pattern template dependency detected/
  );

  assert.throws(
    () => k.compile("dupe[X, X] = {}; ()"),
    /Duplicate parameter 'X' in pattern 'dupe'/
  );
  console.log("    Passed: Error conditions correctly handled.");
}

console.log("==> All Named Patterns Tests Passed Successfully!");
