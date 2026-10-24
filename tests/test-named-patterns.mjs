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

  assert.throws(
    () => k.compile("p[] = { missing[] x }; ()"),
    /Unknown pattern template 'missing\[\]'/
  );

  assert.throws(
    () => k.compile("p[] = missing[]; ()"),
    /Unknown pattern template 'missing\[\]'/
  );

  assert.throws(
    () => k.compile("a[] = b[]; b[] = a[]; ()"),
    /Cyclic pattern template dependency detected/
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

// Test 10: Canonical pattern sharing & parameter aliasing
console.log(
  "--> Test 10: Canonical pattern sharing (a[], b[X], c[X,Y], d[Y,X])"
);
{
  const { resolvePatternCanonicalInfo } =
    await import("../canonical-pattern.mjs");
  const { parse } = await import("../parser.mjs");

  const ast = parse(`
    a[] = {X x, Y y};
    b[X] = {X x, Y y};
    c[X,Y] = {X x, Y y};
    d[Y,X] = {X x, Y y};
    ()
  `);
  const aInfo = resolvePatternCanonicalInfo(
    "a",
    ast.defs.patterns.a,
    { patterns: ast.defs.patterns }
  );
  const bInfo = resolvePatternCanonicalInfo(
    "b",
    ast.defs.patterns.b,
    { patterns: ast.defs.patterns }
  );
  const cInfo = resolvePatternCanonicalInfo(
    "c",
    ast.defs.patterns.c,
    { patterns: ast.defs.patterns }
  );
  const dInfo = resolvePatternCanonicalInfo(
    "d",
    ast.defs.patterns.d,
    { patterns: ast.defs.patterns }
  );

  const sharedHash = "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x";
  assert.equal(aInfo.hash, sharedHash);
  assert.equal(bInfo.hash, sharedHash);
  assert.equal(cInfo.hash, sharedHash);
  assert.equal(dInfo.hash, sharedHash);

  assert.equal(aInfo.def, "{X0 x, X1 y}");
  assert.equal(bInfo.def, "{X0 x, X1 y}");
  assert.equal(cInfo.def, "{X0 x, X1 y}");
  assert.equal(dInfo.def, "{X0 x, X1 y}");

  assert.deepEqual(aInfo.aliasArgs, ["(...)", "(...)"]);
  assert.deepEqual(bInfo.aliasArgs, ["X", "(...)"]);
  assert.deepEqual(cInfo.aliasArgs, ["X", "Y"]);
  assert.deepEqual(dInfo.aliasArgs, ["X", "Y"]);

  assert.deepEqual(aInfo.params, []);
  assert.deepEqual(bInfo.params, ["X0"]);
  assert.deepEqual(cInfo.params, ["X0", "X1"]);
  assert.deepEqual(dInfo.params, ["X1", "X0"]);
  console.log(
    "    Passed: Canonical pattern sharing & parameter aliasing."
  );
}

// Test 11: Knot parameter conflict rejection and canonical patterns
console.log(
  "--> Test 11: Knot conflict rejection & direct canonical patterns"
);
{
  assert.throws(
    () =>
      k.compile("list[X,Y] = <{}nil,{X car, Y cdr} cons> = Y; ()"),
    /conflicts with knot 'Y'/
  );

  const directDefSource = `
    @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[X, Y] = {
      X x, Y y, Y z
    };
    is_p = ? @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[
      {}, {}
    ];
    { {} x, {} y, {} z } is_p
  `;
  const fnDirect = k.compile(directDefSource);
  const outDirect = fnDirect(Value.product({}));
  assert.equal(outDirect != null, true);
  console.log(
    "    Passed: Knot conflict rejection and canonical patterns."
  );
}

// Test 12: Unrestricted pattern (...) unification with variable ports
console.log(
  "--> Test 12: Wildcard (...) unification with canonical variables"
);
{
  const { resolvePatternCanonicalInfo } =
    await import("../canonical-pattern.mjs");
  const { parse } = await import("../parser.mjs");

  const ast = parse(`
    c[X,Y] = {X x, Y y};
    p[X] = {X x, (...) y};
    q[X,Y,Z] = {X x, Y y, Z z};
    t[] = {(...) x, (...) y, (...) z};
    ()
  `);
  const cInfo = resolvePatternCanonicalInfo(
    "c",
    ast.defs.patterns.c,
    { patterns: ast.defs.patterns }
  );
  const pInfo = resolvePatternCanonicalInfo(
    "p",
    ast.defs.patterns.p,
    { patterns: ast.defs.patterns }
  );
  const qInfo = resolvePatternCanonicalInfo(
    "q",
    ast.defs.patterns.q,
    { patterns: ast.defs.patterns }
  );
  const tInfo = resolvePatternCanonicalInfo(
    "t",
    ast.defs.patterns.t,
    { patterns: ast.defs.patterns }
  );

  assert.equal(cInfo.hash, pInfo.hash);
  assert.equal(qInfo.hash, tInfo.hash);

  assert.equal(pInfo.def, "{X0 x, X1 y}");
  assert.equal(tInfo.def, "{X0 x, X1 y, X2 z}");

  assert.deepEqual(pInfo.aliasArgs, ["X", "(...)"]);
  assert.deepEqual(tInfo.aliasArgs, ["(...)", "(...)", "(...)"]);
  console.log(
    "    Passed: Wildcard (...) unification with canonical variables."
  );
}

// Test 13: Nested template composition & parameter routing
console.log(
  "--> Test 13: Nested composition & parameter routing"
);
{
  const { resolvePatternCanonicalInfo } =
    await import("../canonical-pattern.mjs");
  const { parse } = await import("../parser.mjs");

  const ast = parse(`
    pair[A, B] = { A a, B b };
    flip[Y, X] = pair[X, Y];
    outer[Z] = pair[pair[Z, (...)], (...)];
    deep[] = pair[pair[(...), (...)], (...)];
    ()
  `);
  const flipInfo = resolvePatternCanonicalInfo(
    "flip",
    ast.defs.patterns.flip,
    { patterns: ast.defs.patterns }
  );
  const pairInfo = resolvePatternCanonicalInfo(
    "pair",
    ast.defs.patterns.pair,
    { patterns: ast.defs.patterns }
  );
  const outerInfo = resolvePatternCanonicalInfo(
    "outer",
    ast.defs.patterns.outer,
    { patterns: ast.defs.patterns }
  );
  const deepInfo = resolvePatternCanonicalInfo(
    "deep",
    ast.defs.patterns.deep,
    { patterns: ast.defs.patterns }
  );

  assert.equal(flipInfo.hash, pairInfo.hash);
  assert.deepEqual(flipInfo.params, ["X1", "X0"]);
  assert.deepEqual(flipInfo.aliasArgs, ["X", "Y"]);

  assert.equal(outerInfo.hash, deepInfo.hash);
  assert.equal(outerInfo.def, "{{X0 a, X1 b} a, X2 b}");
  assert.deepEqual(outerInfo.params, ["X0"]);
  assert.deepEqual(outerInfo.aliasArgs, ["Z", "(...)", "(...)"]);
  assert.deepEqual(deepInfo.params, []);
  assert.deepEqual(deepInfo.aliasArgs, ["(...)", "(...)", "(...)"]);
  console.log(
    "    Passed: Nested composition and parameter routing."
  );
}

// Test 14: Repeated variable unification with wildcards
console.log(
  "--> Test 14: Repeated existential variable wildcard constraints"
);
{
  const { resolvePatternCanonicalInfo } =
    await import("../canonical-pattern.mjs");
  const { parse } = await import("../parser.mjs");

  const ast = parse(`
    pair_equal[Z] = { Z a, Y b, Y c };
    full_equal[A, B] = { A a, B b, B c };
    ()
  `);
  const peInfo = resolvePatternCanonicalInfo(
    "pair_equal",
    ast.defs.patterns.pair_equal,
    { patterns: ast.defs.patterns }
  );
  const feInfo = resolvePatternCanonicalInfo(
    "full_equal",
    ast.defs.patterns.full_equal,
    { patterns: ast.defs.patterns }
  );

  assert.equal(peInfo.hash, feInfo.hash);
  assert.equal(peInfo.def, "{X0 a, X1 b, X2 c}");
  assert.deepEqual(peInfo.params, ["X0"]);
  assert.deepEqual(peInfo.aliasArgs, ["Z", "Y", "Y"]);
  assert.deepEqual(feInfo.params, ["X0", "X1"]);
  assert.deepEqual(feInfo.aliasArgs, ["A", "B", "B"]);

  // Verify that pair_equal enforces equality between b and c
  const fnOk = k.compile(`
    pair_equal[Z] = { Z a, Y b, Y c };
    check = ? pair_equal[{}];
    { {} a, {} b, {} c } check
  `);
  assert.doesNotThrow(() => fnOk());

  assert.throws(
    () =>
      k.compile(`
        pair_equal[Z] = { Z a, Y b, Y c };
        check = ? pair_equal[{}];
        { {} a, {} b, {}|0 c } check
      `),
    /Cannot unify/
  );
  console.log(
    "    Passed: Repeated existential variable wildcard constraints."
  );
}

// Test 15: Diagonalized leaves share canonical linear skeleton
console.log(
  "--> Test 15: Diagonalized leaves share canonical linear skeleton"
);
{
  const { resolvePatternCanonicalInfo } =
    await import("../canonical-pattern.mjs");
  const { parse } = await import("../parser.mjs");

  const ast = parse(`
    pair[A, B] = { A first, B second };
    same_pair[T] = { T first, T second };
    closed_same_pair[] = { T first, T second };
    any_pair[] = { (...) first, (...) second };
    diag_p[] = { X x, X y };
    ()
  `);
  const pairInfo = resolvePatternCanonicalInfo(
    "pair",
    ast.defs.patterns.pair,
    { patterns: ast.defs.patterns }
  );
  const sameInfo = resolvePatternCanonicalInfo(
    "same_pair",
    ast.defs.patterns.same_pair,
    { patterns: ast.defs.patterns }
  );
  const closedSameInfo = resolvePatternCanonicalInfo(
    "closed_same_pair",
    ast.defs.patterns.closed_same_pair,
    { patterns: ast.defs.patterns }
  );
  const anyInfo = resolvePatternCanonicalInfo(
    "any_pair",
    ast.defs.patterns.any_pair,
    { patterns: ast.defs.patterns }
  );
  const diagPInfo = resolvePatternCanonicalInfo(
    "diag_p",
    ast.defs.patterns.diag_p,
    { patterns: ast.defs.patterns }
  );

  const pairHash = "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm";
  assert.equal(pairInfo.hash, pairHash);
  assert.equal(sameInfo.hash, pairHash);
  assert.equal(closedSameInfo.hash, pairHash);
  assert.equal(anyInfo.hash, pairHash);

  assert.equal(pairInfo.def, "{X0 first, X1 second}");
  assert.equal(sameInfo.def, "{X0 first, X1 second}");
  assert.equal(closedSameInfo.def, "{X0 first, X1 second}");
  assert.equal(anyInfo.def, "{X0 first, X1 second}");

  assert.deepEqual(pairInfo.aliasArgs, ["A", "B"]);
  assert.deepEqual(sameInfo.aliasArgs, ["T", "T"]);
  assert.deepEqual(closedSameInfo.aliasArgs, ["T", "T"]);
  assert.deepEqual(anyInfo.aliasArgs, ["(...)", "(...)"]);

  assert.deepEqual(pairInfo.params, ["X0", "X1"]);
  assert.deepEqual(sameInfo.params, ["X0"]);
  assert.deepEqual(closedSameInfo.params, []);
  assert.deepEqual(anyInfo.params, []);

  // diag_p[] shares canonical skeleton with a, b, c, d
  const xyHash = "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x";
  assert.equal(diagPInfo.hash, xyHash);
  assert.equal(diagPInfo.def, "{X0 x, X1 y}");
  assert.deepEqual(diagPInfo.params, []);
  assert.deepEqual(diagPInfo.aliasArgs, ["X", "X"]);

  console.log(
    "    Passed: Diagonalized leaves share canonical linear skeleton."
  );
}

console.log("==> All Named Patterns Tests Passed Successfully!");
