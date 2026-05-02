#!/usr/bin/env node

/**
 * int: parse/print integers in the k 'int' binary pattern+value stream.
 *
 * $ bits = < {} _, bits 0, bits 1 >;
 * $ int  = < bits '+', bits '-' >;
 *
 * Bits are stored MSB-outermost (remove_leading_zeros strips outermost 0s).
 *
 * Usage:
 *   echo "-21"  | int.mjs --parse   # decimal → binary pattern+value stream
 *   <wire>      | int.mjs --print   # binary pattern+value stream → decimal
 */

import { stdin, stdout, argv, exit } from "node:process";
import { Product, Variant } from "../Value.mjs";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";

// Closed pattern for $ int = < bits '+', bits '-' >
// with $ bits = < {} _, bits 0, bits 1 >
const INT_PATTERN = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// Build bits Value (MSB outermost) from a non-negative BigInt.
function buildBits(n) {
  const bitChars = n === 0n ? ["0"] : n.toString(2).split("");
  let v = new Variant("_", new Product({}));
  for (let i = bitChars.length - 1; i >= 0; i--) {
    v = new Variant(bitChars[i], v);
  }
  return v;
}

// Parse a decimal integer string ([-+]?[ ]*[1-9][0-9]*|0) into a k int Value.
function parseIntStr(str) {
  str = str.trim();
  let sign = "+";
  if (str[0] === "-") { sign = "-"; str = str.slice(1).replace(/\s+/g, ""); }
  else if (str[0] === "+") { str = str.slice(1).replace(/\s+/g, ""); }
  if (!/^(0|[1-9][0-9]*)$/.test(str)) {
    throw new Error(`Invalid integer syntax: ${JSON.stringify(str)}`);
  }
  const n = BigInt(str);
  if (n === 0n) sign = "+"; // zero is always '+'
  return new Variant(sign, buildBits(n));
}

// Walk a decoded int Value (Variant sign → bits) and return a decimal string.
function printIntValue(value) {
  if (!(value instanceof Variant) || (value.tag !== "+" && value.tag !== "-")) {
    throw new Error("Not a valid k int value");
  }
  const sign = value.tag;
  let bits = "";
  let node = value.value;
  while (node instanceof Variant && node.tag !== "_") {
    bits += node.tag;
    node = node.value;
  }
  // bits is MSB-first binary string (may be empty for zero represented as "0")
  const n = bits === "" ? 0n : BigInt("0b" + bits);
  const digits = n.toString(10);
  if (n === 0n) return "0";
  return (sign === "-" ? "-" : "") + digits;
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: int.mjs --parse | --print");
    console.error("  --parse  read a decimal integer from stdin, write binary pattern+value stream");
    console.error("  --print  read binary pattern+value stream from stdin, write decimal integer");
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const text = buf.toString("utf8").trim();
    const value = parseIntStr(text);
    stdout.write(encodeToWire(value, INT_PATTERN));
  } else {
    const { value } = decodeWire(buf);
    stdout.write(printIntValue(value) + "\n");
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  exit(1);
});
