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

// Test 8: Canonical pattern references and aliasing
console.log("--> Test 8: Canonical pattern references and aliasing");
{
  const { compileLibrary } = await import("../object.mjs");
  const baseLib = compileLibrary(`
    bit[] = < {}0, {}1 >;
    list[X] = < {}nil, { X car, Y cdr } cons > = Y;
  `, { exports: ["bit", "list"] });

  const script1 = `
    -- Canonical hash application with and without arguments
    is_bit = ? @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[];
    is_bit2 = ? @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg;
    is_bit_list = ? @JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe[
      @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[]
    ];

    b0 = {}|0 is_bit;
    b1 = {}|1 is_bit2;
    l = { b1 car, {}|nil cdr }|cons is_bit_list;
    { b0 b0, b1 b1, l l }
  `;
  const fn1 = k.compile(script1, { libraries: [baseLib] });
  const out1 = fn1(Value.product({}));
  assert.equal(out1.product.b0.tag, "0");
  assert.equal(out1.product.b1.tag, "1");
  assert.equal(out1.product.l.tag, "cons");

  // Aliasing canonical patterns
  const script2 = `
    my_bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[];
    my_bit2[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg;
    my_list[T] = @JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe[T];

    is_my_list = ? my_list[my_bit[]];
    val = { {}|0 car, {}|nil cdr }|cons is_my_list;
    val
  `;
  const fn2 = k.compile(script2, { libraries: [baseLib] });
  const out2 = fn2(Value.product({}));
  assert.equal(out2.tag, "cons");
  console.log("    Passed: Canonical pattern references and aliasing.");
}

// Test 9: Library export, validation, and multi-library consumption
console.log("--> Test 9: Library export and canonical pattern metadata");
{
  const { compileLibrary, extractAliasesFromObject } =
    await import("../object.mjs");
  const { validateObjectPayload } =
    await import("../objects/validate.mjs");
  const { buildExportPreamble } =
    await import("../canonical-pattern.mjs");

  const libSource = `
    bit[] = < {}0, {}1 >;
    list[X] = < {}nil, { X car, Y cdr } cons > = Y;
    pair[A, B] = { A first, B second };
  `;
  const lib = compileLibrary(libSource, {
    exports: ["bit", "list", "pair"]
  });

  validateObjectPayload(lib);

  assert.equal(
    lib.patternAlias.bit,
    "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg"
  );
  assert.equal(
    lib.patternAlias.list,
    "@JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe"
  );
  assert.equal(
    lib.patternAlias.pair,
    "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm"
  );

  const bitHash = "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg";
  const listHash = "@JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe";
  assert.equal(lib.meta[bitHash].type, "pattern");
  assert.equal(lib.meta[listHash].type, "pattern");

  const aliases = extractAliasesFromObject(lib);
  assert.match(aliases, /bit\[\] = @Mjusy/);
  assert.match(aliases, /list\[X\] = @JagVex/);
  assert.match(aliases, /pair\[A, B\] = @KqTB/);

  const preamble = buildExportPreamble(
    ["bit", "list:my_list"],
    [lib]
  );
  assert.match(preamble, /bit\[\] = @Mjusy/);
  assert.match(preamble, /my_list\[X\] = @JagVex/);

  const consumerSource = `
    is_bit = ? bit[];
    is_pair = ? @KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[
      bit[], bit[]
    ];
    is_pair_list = ? list[@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[
      bit[], bit[]
    ]];

    b = {}|0 is_bit;
    p = { b first, {}|1 second } is_pair;
    l = { p car, {}|nil cdr }|cons is_pair_list;
    l
  `;
  const fnConsumer = k.compile(consumerSource, {
    libraries: [lib]
  });
  const outConsumer = fnConsumer(Value.product({}));
  assert.equal(outConsumer.tag, "cons");
  console.log("    Passed: Library export and pattern metadata.");
}

console.log("==> All Named Patterns Tests Passed Successfully!");
