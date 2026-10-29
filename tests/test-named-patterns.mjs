import assert from "node:assert/strict";
import k from "../index.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, extractAliasesFromObject } from "../object.mjs";
import { validateObjectPayload } from "../objects/validate.mjs";
import { buildExportPreamble, resolvePatternCanonicalInfo } from "../canonical-pattern.mjs";

const BIT = "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg";
const LIST = "@JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe";
const PAIR = "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm";
const XY = "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x";
const BASE = `
  bit[] = <{} 0, {} 1>;
  list[X] = <{} nil, {X car, Y cdr} cons> = Y;
`;
const evaluate = (source, options) => k.compile(source, options)(Value.product({}));

function patterns(source) {
  const { defs: { patterns } } = k.parse(source + "\n()");
  return Object.fromEntries(Object.entries(patterns).map(([name, def]) =>
    [name, resolvePatternCanonicalInfo(name, def, { patterns })]));
}
function check(info, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(info[key], value, key);
  }
}

// Runtime template applications: products, lists, dictionaries, sharing, knots.
{
  const out = evaluate(BASE + `
    byte[] = {bit[] b0, bit[] b1, bit[] b2, bit[] b3,
              bit[] b4, bit[] b5, bit[] b6, bit[] b7};
    is_byte = ?byte[];
    {{}|0 b0, {}|1 b1, {}|0 b2, {}|1 b3,
     {}|0 b4, {}|1 b5, {}|0 b6, {}|1 b7} is_byte
  `);
  assert.deepEqual([out.type, out.product.b0.tag, out.product.b1.tag], ["{}", "0", "1"]);
}
{
  const out = evaluate(BASE + `
    is_bit_list = ?list[bit[]];
    empty = {}|nil is_bit_list;
    one = {{}|1 car, {}|nil cdr}|cons is_bit_list;
    two = {{}|0 car, {{}|1 car, {}|nil cdr}|cons cdr}|cons is_bit_list;
    {empty empty, one one, two two}
  `);
  assert.deepEqual([
    out.product.empty.tag, out.product.one.tag, out.product.one.value.product.car.tag,
    out.product.two.tag, out.product.two.value.product.car.tag
  ], ["nil", "cons", "1", "cons", "0"]);
}
{
  const out = evaluate(BASE + `
    pair[A,B] = {A key, B val};
    dict[K,V] = list[pair[K,V]];
    is_dict = ?dict[bit[],bit[]];
    entry = {{}|0 key, {}|1 val};
    {entry car, {}|nil cdr}|cons is_dict
  `);
  assert.deepEqual([out.tag, out.value.product.car.product.key.tag,
    out.value.product.car.product.val.tag], ["cons", "0", "1"]);
}
{
  const out = evaluate(`same_pair[] = {T first, T second};
    {{}|0 first, {}|1 second} ?same_pair[]`);
  assert.deepEqual([out.product.first.tag, out.product.second.tag], ["0", "1"]);
}
{
  const out = evaluate(BASE + `
    tree[X] = <{} nil, {X val, list[T] children} node> = T;
    is_tree = ?tree[bit[]];
    leaf = {{}|1 val, {}|nil children}|node is_tree;
    root = {{}|0 val, {leaf car, {}|nil cdr}|cons children}|node is_tree;
    {leaf leaf, root root}
  `);
  assert.deepEqual([out.product.leaf.tag, out.product.leaf.value.product.val.tag,
    out.product.root.tag, out.product.root.value.product.val.tag], ["node", "1", "node", "0"]);
}
assert.equal(evaluate(BASE + `
  head = ?{X car, list[X] cdr} .car;
  {{}|1 car, {}|nil cdr} head
`).tag, "1");

// Used and unused definitions must both be validated eagerly.
for (const [source, error] of [
  ["check = ?missing[]; ()", /Unknown pattern template 'missing\[\]'/],
  ["list[X] = {}; check = ?list[]; ()", /Pattern 'list' expects 1 argument, got 0/],
  ["pair[A,B] = {}; check = ?pair[{}]; ()", /Pattern 'pair' expects 2 arguments, got 1/],
  ["a[] = b[]; b[] = a[]; check = ?a[]; ()", /Cyclic pattern template dependency detected/],
  ["dupe[X,X] = {}; ()", /Duplicate parameter 'X' in pattern 'dupe'/],
  ["p[] = {missing[] x}; ()", /Unknown pattern template 'missing\[\]'/],
  ["p[] = missing[]; ()", /Unknown pattern template 'missing\[\]'/],
  ["a[] = b[]; b[] = a[]; ()", /Cyclic pattern template dependency detected/],
  ["list[X,Y] = <{} nil,{X car,Y cdr} cons>=Y; ()", /conflicts with knot 'Y'/],
  ["same_pair[] = {T first,T second}; {{} first,{}|0 second} ?same_pair[]", /Cannot unify/],
  [`is_bit = ?${BIT}; ()`, /Parse error[\s\S]*Expecting 'LB'/],
  [`my_bit[] = ${BIT}; ()`, /Parse error[\s\S]*Expecting 'LB'/]
]) assert.throws(() => k.compile(source), error, source);

// Canonical applications, alias export, metadata, and library consumption.
const library = compileLibrary(BASE + "pair[A,B] = {A first,B second};", {
  exports: ["bit", "list", "pair"]
});
validateObjectPayload(library);
assert.deepEqual([library.patternAlias.bit, library.patternAlias.list,
  library.patternAlias.pair], [BIT, LIST, PAIR]);
for (const hash of [BIT, LIST]) assert.equal(library.meta[hash].type, "pattern");

const aliases = extractAliasesFromObject(library);
for (const expected of [/bit\[\] = @Mjusy/, /list\[X\] = @JagVex/, /pair\[A, B\] = @KqTB/]) {
  assert.match(aliases, expected);
}
const preamble = buildExportPreamble(["bit", "list:my_list"], [library]);
assert.match(preamble, /bit\[\] = @Mjusy/);
assert.match(preamble, /my_list\[X\] = @JagVex/);

{
  const out = evaluate(`
    is_bit = ?${BIT}[];
    is_bit_list = ?${LIST}[${BIT}[]];
    b0 = {}|0 is_bit; b1 = {}|1 is_bit;
    l = {b1 car, {}|nil cdr}|cons is_bit_list;
    {b0 b0, b1 b1, l l}
  `, { libraries: [library] });
  assert.deepEqual([out.product.b0.tag, out.product.b1.tag, out.product.l.tag], ["0", "1", "cons"]);
}
assert.equal(evaluate(`
  my_bit[] = ${BIT}[];
  my_list[T] = ${LIST}[T];
  {{}|0 car, {}|nil cdr}|cons ?my_list[my_bit[]]
`, { libraries: [library] }).tag, "cons");
assert.equal(evaluate(`
  is_bit = ?bit[];
  is_pair = ?${PAIR}[bit[],bit[]];
  is_pair_list = ?list[${PAIR}[bit[],bit[]]];
  b = {}|0 is_bit;
  p = {b first, {}|1 second} is_pair;
  {p car, {}|nil cdr}|cons is_pair_list
`, { libraries: [library] }).tag, "cons");
assert.ok(evaluate(`
  @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[X,Y] = {X x,Y y,Y z};
  {{} x,{} y,{} z} ?@A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[{},{}]
`));

// Each alias retains its routing, while all variations share their skeleton.
const shapes = patterns(`
  a[] = {X x,Y y}; b[X] = {X x,Y y};
  c[X,Y] = {X x,Y y}; d[Y,X] = {X x,Y y}; diag_p[] = {X x,X y};
  pair[A,B] = {A first,B second}; same_pair[T] = {T first,T second};
  closed_same_pair[] = {T first,T second}; any_pair[] = {(...) first,(...) second};
`);
for (const [name, params, aliasArgs] of [
  ["a", [], ["(...)", "(...)"]], ["b", ["X0"], ["X", "(...)"]],
  ["c", ["X0", "X1"], ["X", "Y"]], ["d", ["X1", "X0"], ["X", "Y"]],
  ["diag_p", [], ["X", "X"]]
]) check(shapes[name], { hash: XY, def: "{X0 x, X1 y}", params, aliasArgs });
for (const [name, params, aliasArgs] of [
  ["pair", ["X0", "X1"], ["A", "B"]], ["same_pair", ["X0"], ["T", "T"]],
  ["closed_same_pair", [], ["T", "T"]], ["any_pair", [], ["(...)", "(...)"]]
]) check(shapes[name], { hash: PAIR, def: "{X0 first, X1 second}", params, aliasArgs });

const wildcards = patterns(`
  c[X,Y] = {X x,Y y}; p[X] = {X x,(...) y};
  q[X,Y,Z] = {X x,Y y,Z z}; t[] = {(...) x,(...) y,(...) z};
`);
assert.equal(wildcards.c.hash, wildcards.p.hash);
assert.equal(wildcards.q.hash, wildcards.t.hash);
check(wildcards.p, { def: "{X0 x, X1 y}", aliasArgs: ["X", "(...)"] });
check(wildcards.t, { def: "{X0 x, X1 y, X2 z}", aliasArgs: ["(...)", "(...)", "(...)"] });

const nested = patterns(`
  pair[A,B] = {A a,B b}; flip[Y,X] = pair[X,Y];
  outer[Z] = pair[pair[Z,(...)],(...)];
  deep[] = pair[pair[(...),(... )],(...)];
`);
assert.equal(nested.flip.hash, nested.pair.hash);
check(nested.flip, { params: ["X1", "X0"], aliasArgs: ["X", "Y"] });
assert.equal(nested.outer.hash, nested.deep.hash);
check(nested.outer, { def: "{{X0 a, X1 b} a, X2 b}",
  params: ["X0"], aliasArgs: ["Z", "(...)", "(...)"] });
check(nested.deep, { params: [], aliasArgs: ["(...)", "(...)", "(...)"] });

const repeated = patterns(`
  pair_equal[Z] = {Z a,Y b,Y c}; full_equal[A,B] = {A a,B b,B c};
`);
assert.equal(repeated.pair_equal.hash, repeated.full_equal.hash);
check(repeated.pair_equal, { def: "{X0 a, X1 b, X2 c}",
  params: ["X0"], aliasArgs: ["Z", "Y", "Y"] });
check(repeated.full_equal, { params: ["X0", "X1"], aliasArgs: ["A", "B", "B"] });
assert.ok(evaluate(`pair_equal[Z] = {Z a,Y b,Y c}; {{} a,{} b,{} c} ?pair_equal[{}]`));
assert.throws(() => k.compile(`
  pair_equal[Z] = {Z a,Y b,Y c}; {{} a,{} b,{}|0 c} ?pair_equal[{}]
`), /Cannot unify/);

console.log("named patterns: ok");
