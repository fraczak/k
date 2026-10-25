import assert from "node:assert/strict";
import { evaluateInput, createState } from "../repl.mjs";
import { parse } from "../parser.mjs";
import { resolvePatternCanonicalInfo } from "../canonical-pattern.mjs";
import k from "../index.mjs";
import { Value } from "../Value.mjs";

console.log("==> Running Paper Examples Test Suite");

// Test 1: Elementary combinators and constant relations (Section 2.2)
console.log("--> Test 1: Elementary combinators & constants");
{
  const state = createState();
  const out1 = await evaluateInput("{}", state);
  assert.ok(out1.some(line => line.includes("{}")));

  const out2 = await evaluateInput("()", state);
  assert.ok(out2.some(line => line.includes("{}")));

  const out3 = await evaluateInput("<>", state);
  assert.ok(out3.some(line => line.includes("undefined")));

  const out4 = await evaluateInput("{} | true", state);
  assert.ok(out4.some(line => line.includes("{}|true")));

  const out5 = await evaluateInput("{} | zero", state);
  assert.ok(out5.some(line => line.includes("{}|zero")));
  console.log("    Passed: Section 2.2 combinators and constants.");
}

// Test 2: Section 4 Named Patterns (bit, bits, pair, list)
console.log("--> Test 2: Section 4 Named Patterns");
{
  const state = createState();
  await evaluateInput("bit[]  = < {} 0, {} 1 >;", state);
  await evaluateInput("bits[] = < {} _, B 0, B 1 > = B;", state);
  await evaluateInput("pair[A, B] = { A first, B second };", state);
  await evaluateInput("list[X] = < {} nil, { X car, Y cdr } cons > = Y;", state);

  const patterns = await evaluateInput(":patterns", state);
  assert.ok(patterns.some(l => l.includes("bit[]")));
  assert.ok(patterns.some(l => l.includes("bits[]")));
  assert.ok(patterns.some(l => l.includes("pair[A,B]")));
  assert.ok(patterns.some(l => l.includes("list[X]")));
  console.log("    Passed: Section 4 named patterns defined successfully.");
}

// Test 3: Section 5 Linear Canonical Normalization & Skeletons
console.log("--> Test 3: Section 5 Canonical Skeletons & Hashing");
{
  const ast = parse(`
    pair[A, B]         = { A first, B second };
    same_pair[T]       = { T first, T second };
    closed_same_pair[] = { T first, T second };
    any_pair[]         = { (...) first, (...) second };
    ()
  `);
  const pairInfo = resolvePatternCanonicalInfo("pair", ast.defs.patterns.pair, { patterns: ast.defs.patterns });
  const sameInfo = resolvePatternCanonicalInfo("same_pair", ast.defs.patterns.same_pair, { patterns: ast.defs.patterns });
  const closedSameInfo = resolvePatternCanonicalInfo("closed_same_pair", ast.defs.patterns.closed_same_pair, { patterns: ast.defs.patterns });
  const anyInfo = resolvePatternCanonicalInfo("any_pair", ast.defs.patterns.any_pair, { patterns: ast.defs.patterns });

  const canonicalHash = "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm";
  assert.equal(pairInfo.hash, canonicalHash);
  assert.equal(sameInfo.hash, canonicalHash);
  assert.equal(closedSameInfo.hash, canonicalHash);
  assert.equal(anyInfo.hash, canonicalHash);

  assert.equal(pairInfo.def, "{X0 first, X1 second}");
  assert.equal(sameInfo.def, "{X0 first, X1 second}");
  assert.equal(closedSameInfo.def, "{X0 first, X1 second}");
  assert.equal(anyInfo.def, "{X0 first, X1 second}");

  assert.deepEqual(pairInfo.aliasArgs, ["A", "B"]);
  assert.deepEqual(sameInfo.aliasArgs, ["T", "T"]);
  assert.deepEqual(closedSameInfo.aliasArgs, ["T", "T"]);
  assert.deepEqual(anyInfo.aliasArgs, ["(...)", "(...)"]);
  console.log("    Passed: Section 5 canonical skeletons & hash match paper exactly.");
}

// Test 4: Section 5.2 Zero Loss of Type Safety (instantiation & checking)
console.log("--> Test 4: Section 5.2 Instantiation & Type Safety");
{
  const state = createState();
  await evaluateInput("bit[] = < {} 0, {} 1 >;", state);
  await evaluateInput("same_pair[T] = { T first, T second };", state);

  // Matching pair
  const okOut = await evaluateInput("{ ({} | 0) first, ({} | 1) second } ?same_pair[bit[]]", state);
  assert.ok(okOut.some(l => l.includes("{{}|0 first, {}|1 second}")));

  // Mismatched pair - rejected at compile time
  await assert.rejects(
    () => evaluateInput("{ ({} | 0) first, {} second } ?same_pair[bit[]]", state),
    /Type Error/
  );
  console.log("    Passed: Section 5.2 instantiation enforces equality at call site.");
}

// Test 5: Section 6.1 Recursive Linked List
console.log("--> Test 5: Section 6.1 Recursive Linked List");
{
  const state = createState();
  await evaluateInput("bit[] = < {} 0, {} 1 >;", state);
  await evaluateInput("list[X] = < {} nil, { X car, Y cdr } cons > = Y;", state);
  await evaluateInput("nil = {} | nil ?list[bit[]];", state);
  await evaluateInput("cons = { ({} | 0) car, nil cdr } | cons ?list[bit[]];", state);

  const res = await evaluateInput("cons", state);
  assert.ok(res.some(l => l.includes("{{}|0 car, {}|nil cdr}|cons")));
  console.log("    Passed: Section 6.1 recursive list functions correctly.");
}

// Test 6: Section 7 Complete Bit Arithmetic Example
console.log("--> Test 6: Section 7 Bit Arithmetic & Half Adder");
{
  const state = createState();
  await evaluateInput("bit[] = < {} 0, {} 1 >;", state);
  await evaluateInput("0 = {} | 0 ?bit[];", state);
  await evaluateInput("1 = {} | 1 ?bit[];", state);
  await evaluateInput("not = < /0 1, 0 >;", state);
  await evaluateInput(`
    half_add = ?{ bit[] a, bit[] b }
      < 
        { .a /0 if, { .b sum, 0 carry } then } .then,
        { .b not sum, .b carry }
      >;
  `, state);

  // Test 0 + 0 = sum 0, carry 0
  const out00 = await evaluateInput("{ 0 a, 0 b } half_add", state);
  assert.ok(out00.some(l => l.includes("carry") && l.includes("sum")));
  assert.ok(out00.some(l => l.includes("{}|0 carry") && l.includes("{}|0 sum")));

  // Test 0 + 1 = sum 1, carry 0
  const out01 = await evaluateInput("{ 0 a, 1 b } half_add", state);
  assert.ok(out01.some(l => l.includes("{}|0 carry") && l.includes("{}|1 sum")));

  // Test 1 + 0 = sum 1, carry 0
  const out10 = await evaluateInput("{ 1 a, 0 b } half_add", state);
  assert.ok(out10.some(l => l.includes("{}|0 carry") && l.includes("{}|1 sum")));

  // Test 1 + 1 = sum 0, carry 1
  const out11 = await evaluateInput("{ 1 a, 1 b } half_add", state);
  assert.ok(out11.some(l => l.includes("{}|1 carry") && l.includes("{}|0 sum")));

  console.log("    Passed: Section 7 half adder all 4 cases verified in Wasm.");
}

// Test 7: Appendix Self-Hosted Schema Pattern
console.log("--> Test 7: Appendix pattern[] definition");
{
  const state = createState();
  await evaluateInput("bits[] = < {} _, B 0, B 1 > = B;", state);
  await evaluateInput("unicode[] = < {} _, U 0, U 1 > = U;", state);
  await evaluateInput("string[] = < {} nil, { unicode[] car, S cdr } cons > = S;", state);
  await evaluateInput("edge[]  = { string[] label, bits[] target };", state);
  await evaluateInput("edges[] = < {} nil, { edge[] car, E cdr } cons > = E;", state);
  await evaluateInput(`
    node[]  = <
      {} any,
      edges[] open-product,
      edges[] open-union,
      edges[] closed-product,
      edges[] closed-union
    >;
  `, state);
  await evaluateInput("pattern[] = < {} nil, { node[] car, P cdr } cons > = P;", state);

  const out = await evaluateInput(":pattern pattern", state);
  assert.ok(out.some(l => l.includes("pattern[] = <{} nil, {node[] car, P cdr} cons>=P;")));
  console.log("    Passed: Appendix pattern[] compiles and verifies.");
}

console.log("==> All Paper Examples Passed Successfully!");
