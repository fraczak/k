import assert from "node:assert/strict";
import { withCompiledLibrary, runLibrary, integer, succeeds } from "./helpers/cli.mjs";

const large = "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555";

function kPosInt(value) {
  const bits = BigInt(value).toString(2);
  let expr = "{} |_";
  for (let i = bits.length - 1; i >= 0; i--) {
    expr += ` |${bits[i]}`;
  }
  return `${expr} |+`;
}

withCompiledLibrary(["lib/integer.k"], (library) => {
  const run = (aliases, source, input) => runLibrary(library, aliases, source, input);
  const n = BigInt(large);
  for (const [op, expected] of [
    ["plus", n + n + 1n], ["minus", 1n], ["times", n * (n + 1n)]
  ]) {
    assert.equal(integer(run([`${op}:o`, "inc"], "{inc x, () y} o", large), op),
      String(expected), op);
  }

  succeeds(run(["dec", "zero?"], "dec dec zero?", "2"),
    "decrement normalization");
  for (const [x, divisor] of [
    ["0", "7"], ["3", "7"], ["4", "1"], ["10", "2"], ["12", "3"],
    ["11", "3"], ["12", "12"], ["100", "7"], ["-100", "7"], ["1000", "10"]
  ]) {
    const a = BigInt(x), b = BigInt(divisor);
    const aliases = ["divmod"];
    for (const [projection, expected] of [
      [".q", a / b], [".r", a % b]
    ]) {
      const source = `{() x, ${kPosInt(divisor)} y} divmod ${projection}`;
      assert.equal(integer(run(aliases, source, x), source), String(expected),
        `divmod(${x}, ${divisor}) ${projection}`);
    }
  }

  for (const [aliases, source] of [
    [["eq?"], `{${kPosInt(2)} x, ${kPosInt(2)} y} eq? .x`],
    [["pos?"], `${kPosInt(2)} pos?`]
  ]) succeeds(run(aliases, source), source);

  for (const [aliases, source] of [
    [["eq?"], `{${kPosInt(2)} x, ${kPosInt(3)} y} eq? .x`],
    [["pos?"], `${kPosInt(0)} pos?`]
  ]) {
    const result = run(aliases, source);
    assert.notEqual(result.status, 0, source);
    assert.match(result.stderr.toString(), /undefined/, source);
  }

  for (const [aliases, source, expected] of [
    [["mod"], `{${kPosInt(10)} x, ${kPosInt(3)} y} mod`, "1"],
    [["gcd"], `{${kPosInt(12)} x, ${kPosInt(8)} y} gcd`, "4"],
    [["gcd"], `{${kPosInt(4)} x, ${kPosInt(0)} y} gcd`, "4"],
    [["lcm"], `{${kPosInt(4)} x, ${kPosInt(6)} y} lcm`, "12"]
  ]) assert.equal(integer(run(aliases, source), source), expected, source);
});

console.log("arithmetic CLI and BigInt oracles: ok");
