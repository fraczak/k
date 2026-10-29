import assert from "node:assert/strict";
import { withCompiledLibrary, runLibrary, integer, succeeds } from "./helpers/cli.mjs";

const large = "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555";

withCompiledLibrary("Examples/arithmetics.k", (library) => {
  const run = (aliases, source, input) => runLibrary(library, aliases, source, input);
  const n = BigInt(large);
  for (const [op, expected] of [
    ["plus", n + n + 1n], ["minus", 1n], ["times", n * (n + 1n)]
  ]) {
    assert.equal(integer(run([`${op}:o`, "inc"], "{inc x, () y} o", large), op),
      String(expected), op);
  }

  succeeds(run(["dec", "zero_int?"], "dec dec zero_int?", "2"),
    "decrement normalization");
  for (const [x, divisor] of [
    ["0", "7"], ["3", "7"], ["4", "1"], ["10", "2"], ["12", "3"],
    ["11", "3"], ["12", "12"], ["100", "7"], ["-100", "7"], ["1000", "10"]
  ]) {
    const a = BigInt(x), b = BigInt(divisor);
    const aliases = ["div", "int", `${divisor}:divisor`];
    for (const [projection, expected] of [
      [".div", a / b], [".rem int", (a < 0n ? -a : a) % b]
    ]) {
      const source = `{() x, divisor int y} div ${projection}`;
      assert.equal(integer(run(aliases, source, x), source), String(expected),
        `div(${x}, ${divisor}) ${projection}`);
    }
  }

  for (const [aliases, source] of [
    [["EQ", "int", "2:two"], "{two x, two y} EQ .x int"],
    [["pos?", "int", "2:two"], "two int pos?"]
  ]) succeeds(run(aliases, source), source);

  for (const [aliases, source] of [
    [["EQ", "int", "2:two", "3:three"], "{two x, three y} EQ .x int"],
    [["pos?", "int", "0:zero"], "zero int pos?"]
  ]) {
    const result = run(aliases, source);
    assert.notEqual(result.status, 0, source);
    assert.match(result.stderr.toString(), /undefined/, source);
  }

  for (const [aliases, source, expected] of [
    [["mod", "int", "10:ten", "3:three"], "{ten x, three y} mod int", "1"],
    [["gcd", "int", "12:twelve", "8:eight"], "{twelve x, eight y} gcd int", "4"],
    [["gcd", "int", "4:four", "_:zero_b"], "{four x, zero_b y} gcd int", "4"],
    [["lcm", "int", "4:four", "6:six"], "{four x, six y} lcm int", "12"]
  ]) assert.equal(integer(run(aliases, source), source), expected, source);
});

console.log("arithmetic CLI and BigInt oracles: ok");
