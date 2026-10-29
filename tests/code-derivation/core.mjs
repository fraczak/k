import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { annotate } from "../../index.mjs";
import hash from "../../hash.mjs";

const bool = "@GWnxJCupZr96BZfdpDsfQQKxKjCbjyDh7Qaur7y9enCY";
const bit = "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg";
const unit = hash("$C0={};");
const cases = [
  ["unit", "{}", { pattern: "(...)" }, { type: unit }],
  ["product", `
    ?<{} true, {} false> {() one, () two}
    ?{<{} true, {} false> one, <{} true, {} false> two}
  `, { type: bool }, { type: "@ZR2yff4pdXTVqZdMu9x3t9GG5rwmhEfQuenbAwFnD2Nk" }],
  ["product projection", `
    1 = {} |1 ?<{} 0, {} 1>;
    ?<{} true, {} false> {1 one, () two, () c} .one
  `, { type: bool }, { type: bit }],
  ["closed variant projection", "?< <{} 0, {} 1> true, <{} 0, {} 1> false> /true",
    { pattern: "type" }, { type: bit }],
  ["composed variant projection", `
    x = /x; xy = x/y;
    f = {{} |y |x xy i, {} |y |x xy b}; f .b
  `, { pattern: "(...)" }, { type: unit }],
  ["recursive open union", `
    B = {}|u A;
    A = ?X < /a, /b ?X A, /c |z ?X A, B >; A
  `, { pattern: "<...>" }, { pattern: "(...)" }],
  ["double negation", `
    true = {} |true; false = {} |false;
    not = ?<{} true, {} false> </true false, /false true> ?<{} true, {} false>;
    not not
  `, { type: bool }, { type: bool }],
  ["leading zero normalization", `
    zero = {}|_|0;
    rlz = ?<X 0, X 1, {} _>=X </0/_ zero, /0 rlz, ()> ?X; rlz
  `, { type: "@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb" },
    { type: "@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb" }],
  ["Peano arithmetic", readFileSync(new URL("../../Examples/nat.k", import.meta.url), "utf8"),
    { type: "@e9WP6QX6URfgnd9hHYrrYUBhiL7UcvbWErVmyQJfFcr8" },
    { type: "@e9WP6QX6URfgnd9hHYrrYUBhiL7UcvbWErVmyQJfFcr8" }]
];

function boundaries(source) {
  const { def, typePatternGraph: graph } = annotate(source).rels.__main__;
  return def.patterns.map((id) => graph.get_pattern(id));
}
for (const [name, source, ...expected] of cases) {
  const actual = boundaries(source);
  expected.forEach((fields, side) => {
    for (const [key, value] of Object.entries(fields)) {
      assert.equal(actual[side][key], value, `${name}: boundary ${side} ${key}`);
    }
  });
}
for (const [source, pattern] of [["</a, ()>", "<...>"], ["<.a, ()>", "{...}"]]) {
  const [input, output] = boundaries(source);
  assert.equal(input.pattern, pattern);
  assert.equal(output, input, source);
}
console.log("core derivation cases: ok");
