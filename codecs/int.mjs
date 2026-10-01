#!/usr/bin/env node

/**
 * int: parse/print integers and integer lists in the k 'int' binary pattern+value stream.
 *
 * $ bits = < {} _, bits 0, bits 1 >;
 * $ int  = < bits '+', bits '-' >;
 * list   = < {} nil, {int car, list cdr} cons >;
 *
 * Bits are stored MSB-outermost (remove_leading_zeros strips outermost 0s).
 *
 * Usage:
 *   echo "-21"     | int.mjs --parse   # decimal → binary pattern+value stream
 *   echo "[0,1,2]" | int.mjs --parse   # integer list → binary pattern+value stream
 *   <wire>         | int.mjs --print   # binary pattern+value stream → decimal / list
 */

import { stdin, stdout, argv, exit } from "node:process";
import { Value, isProduct, isVariant } from "../Value.mjs";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";

function usage(stream = console.error) {
  stream(`Usage: ${argv[1]} --parse | --print`);
  stream("  --parse      Read a decimal integer or list from stdin, write binary pattern+value stream.");
  stream("  --print      Read binary pattern+value stream from stdin, write decimal integer or list.");
  stream("  -h, --help   Show this help.");
}

// Closed pattern for $ int = < bits '+', bits '-' >
// with $ bits = < {} _, bits 0, bits 1 >
const INT_PATTERN = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];

// Closed pattern for list of int:
// list = < {} nil, {int car, list cdr} cons >
const INT_LIST_PATTERN = [
  ["closed-union", [["cons", 1], ["nil", 4]]],
  ["closed-product", [["car", 2], ["cdr", 0]]],
  ["closed-union", [["+", 3], ["-", 3]]],
  ["closed-union", [["0", 3], ["1", 3], ["_", 4]]],
  ["closed-product", []]
];

const name = "int";
const patterns = [INT_PATTERN, INT_LIST_PATTERN];

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
  let v = Value.variant("_", Value.product({}));
  for (let i = bitChars.length - 1; i >= 0; i--) {
    v = Value.variant(bitChars[i], v);
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
  return Value.variant(sign, buildBits(n));
}

// Parse a list of decimal integers, e.g. "[0,1,2]" or "[]"
function parseIntListStr(str) {
  str = str.trim();
  if (!str.startsWith("[") || !str.endsWith("]")) {
    throw new Error(`Invalid integer list syntax: ${JSON.stringify(str)}`);
  }
  const inner = str.slice(1, -1).trim();
  if (inner === "") {
    return Value.variant("nil", Value.product({}));
  }
  const parts = inner.split(",");
  const items = parts.map((part) => parseIntStr(part));
  let result = Value.variant("nil", Value.product({}));
  for (let i = items.length - 1; i >= 0; i--) {
    result = Value.variant("cons", Value.product({
      car: items[i],
      cdr: result
    }));
  }
  return result;
}

// Parse a decimal integer string or integer list into a k Value.
function parse(str) {
  str = str.trim();
  const raw = str.startsWith("[") ? parseIntListStr(str) : parseIntStr(str);
  const pattern = isVariant(raw) && (raw.tag === "nil" || raw.tag === "cons")
    ? INT_LIST_PATTERN
    : INT_PATTERN;
  return decodeWire(encodeToWire(raw, pattern)).value;
}

// Walk a decoded int Value (Variant sign → bits) and return a decimal string.
function printSingleInt(value) {
  if (!isVariant(value) || (value.tag !== "+" && value.tag !== "-")) {
    throw new Error("Not a valid k int value");
  }
  const sign = value.tag;
  let bits = "";
  let node = value.value;
  while (isVariant(node) && node.tag !== "_") {
    bits += node.tag;
    node = node.value;
  }
  // bits is MSB-first binary string (may be empty for zero represented as "0")
  const n = bits === "" ? 0n : BigInt("0b" + bits);
  const digits = n.toString(10);
  if (n === 0n) return "0";
  return (sign === "-" ? "-" : "") + digits;
}

// Walk a decoded int list Value and return a bracketed string like "[0,1,2]".
function printIntList(value) {
  const items = [];
  let node = value;
  while (isVariant(node) && node.tag === "cons") {
    const product = isProduct(node.value) ? node.value.product : null;
    if (!product || !product.car || !product.cdr) {
      throw new Error("Invalid list cons node");
    }
    items.push(printSingleInt(product.car));
    node = product.cdr;
  }
  if (!isVariant(node) || node.tag !== "nil") {
    throw new Error("Not a valid k int list: does not terminate in nil");
  }
  return `[${items.join(",")}]`;
}

// Walk a decoded int or int list Value and return a formatted string.
function printIntValue(value) {
  if (isVariant(value)) {
    if (value.tag === "nil" || value.tag === "cons") {
      return printIntList(value);
    }
    if (value.tag === "+" || value.tag === "-") {
      return printSingleInt(value);
    }
  }
  throw new Error("Not a valid k int or int list value");
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    usage();
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const text = buf.toString("utf8").trim();
    const value = parse(text);
    const pattern = isVariant(value) && (value.tag === "nil" || value.tag === "cons")
      ? INT_LIST_PATTERN
      : INT_PATTERN;
    stdout.write(encodeToWire(value, pattern));
  } else {
    const { value } = decodeWire(buf);
    stdout.write(printIntValue(value) + "\n");
  }
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch(err => {
    console.error(err.message || String(err));
    exit(1);
  });
}

export {
  INT_PATTERN,
  INT_LIST_PATTERN,
  name,
  patterns,
  parse,
  printIntValue as print,
  parseIntStr,
  parseIntListStr
};

