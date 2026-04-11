import assert from "assert";
import { annotate } from "../index.mjs";

const script = `
  f = .x;
  g = f;
  g
`;

const autoAnnotated = annotate(script);
assert.deepEqual(
  autoAnnotated.compileStats.sccs.map(({ strategy }) => strategy),
  ["single_pass", "single_pass", "single_pass"]
);

const fixedPointAnnotated = annotate(script, {
  convergence: { strategy: "fixed_point" }
});
assert.deepEqual(
  fixedPointAnnotated.compileStats.sccs.map(({ strategy }) => strategy),
  ["fixed_point", "fixed_point", "fixed_point"]
);

console.log("OK");
