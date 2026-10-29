import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createState, evaluateInput } from "../repl.mjs";
import k from "../index.mjs";
import { resolvePatternCanonicalInfo } from "../canonical-pattern.mjs";
import { valueToK } from "../codecs/runtime/show-value.mjs";

const source = readFileSync(new URL("../paper/k-paper.tex", import.meta.url), "utf8");
const listings = [...source.matchAll(/\\begin\{lstlisting\}(?:\[[^\]]*\])?\s*([\s\S]*?)\\end\{lstlisting\}/g)]
  .map((match) => match[1]);
function listing(needle) {
  const source = listings.find((source) => source.includes(needle));
  assert.ok(source, `paper listing containing ${needle}`);
  return source.split("\n").filter((line) => !line.trimStart().startsWith("--"))
    .join("\n").trim();
}

// Section 2: combinators and constant relations.
{
  const state = createState();
  for (const [source, expected] of [
    ["{}", "{}"], ["()", "{}"], ["<>", undefined],
    ["{} |true", "{}|true"], ["{} |zero", "{}|zero"]
  ]) {
    const output = await evaluateInput(source, state);
    if (expected === undefined) assert.ok(output.some((line) => line.includes("undefined")));
    else assert.equal(valueToK(state.value), expected, source);
  }
}

// Sections 4–6: published declarations, exact hashes, and routing.
const declarations = listing("-- Arity-0 leaf patterns:");
const pairs = listing("closed_same_pair[]");
{
  const state = createState();
  await evaluateInput(declarations, state);
  const output = (await evaluateInput(":patterns", state)).join("\n");
  for (const name of ["bit[]", "bits[]", "pair[A,B]", "list[X]"]) {
    assert.ok(output.includes(name), name);
  }

  const { defs: { patterns } } = k.parse(pairs + "\n()");
  for (const [name, args] of [
    ["pair", ["A", "B"]], ["same_pair", ["T", "T"]],
    ["closed_same_pair", ["T", "T"]], ["any_pair", ["(...)", "(...)"]]
  ]) {
    const info = resolvePatternCanonicalInfo(name, patterns[name], { patterns });
    assert.deepEqual([info.hash, info.def, info.aliasArgs],
      ["@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm",
        "{X0 first, X1 second}", args], name);
  }
}
{
  const state = createState();
  await evaluateInput(declarations, state);
  await evaluateInput(pairs, state);
  await evaluateInput("{({} |0) first, ({} |1) second} ?same_pair[bit[]]", state);
  assert.equal(valueToK(state.value), "{{}|0 first, {}|1 second}");
  await assert.rejects(() =>
    evaluateInput("{({} |0) first, {} second} ?same_pair[bit[]]", state), /Type Error/);

  await evaluateInput("nil = {} |nil ?list[bit[]];", state);
  await evaluateInput("cons = {({} |0) car, nil cdr} |cons ?list[bit[]];", state);
  await evaluateInput("cons", state);
  assert.equal(valueToK(state.value), "{{}|0 car, {}|nil cdr}|cons");
}

// Section 7: execute the actual half-adder listing through Wasm.
{
  const state = createState();
  await evaluateInput(listing("half_add ="), state);
  for (const [a, b, sum, carry] of [
    [0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1]
  ]) {
    await evaluateInput(`{${a} a, ${b} b} half_add`, state);
    assert.deepEqual([state.value.product.sum.tag, state.value.product.carry.tag],
      [String(sum), String(carry)], `${a} + ${b}`);
  }
}

// Appendix: verify the publication's pattern schema against the real Unicode core.
{
  const state = createState();
  await evaluateInput(":load core.k", state);
  const expected = await evaluateInput(":pattern pattern", state);
  await evaluateInput(listing("edge[]"), state);
  assert.deepEqual(await evaluateInput(":pattern pattern", state), expected);
}

console.log("paper examples: ok");
