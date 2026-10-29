import assert from "node:assert/strict";
import { withCompiledLibrary, runLibrary, integer } from "./helpers/cli.mjs";

const large = "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555";

withCompiledLibrary("Examples/karatsuba-mult.k", (library) => {
  const multiply = (source, input) =>
    integer(runLibrary(library, ["karatsuba"], source, input), source);

  for (const input of [
    "0", "1", "-1", "7", "-7", "42", "-42", "123456789", "-123456789",
    "987654321987654321", "-987654321987654321", large, `-${large}`
  ]) {
    const n = BigInt(input);
    assert.equal(multiply("{() x, () y} karatsuba", input), String(n * n),
      `karatsuba square(${input})`);
  }

  assert.equal(multiply("/cons { .car x, .cdr /cons .car y } karatsuba",
    "[12345678901234567890, -98765432109876543210]"),
  String(12345678901234567890n * -98765432109876543210n),
  "asymmetric mixed-sign multiplication");
});

console.log("Karatsuba CLI and BigInt oracles: ok");
