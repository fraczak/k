#!/usr/bin/env node

/**
 * int: parse/print integers and integer lists as enveloped k values.
 *
 * $ bits = < {} _, bits 0, bits 1 >;
 * $ int  = < bits '+', bits '-' >;
 * list   = < {} nil, {int car, list cdr} cons >;
 */

import { Value, isProduct, isVariant, withPattern, patternFromFilter, runCodecCLI } from "./runtime/codec-sdk.mjs";

export const doc = `
Decimal integers and integer lists.

Syntax:
  Decimal integer (e.g. 42, -15) or bracketed integer list
  (e.g. [0, 1, 2], []).
`;

// Closed pattern for $ int = < bits '+', bits '-' >
// with $ bits = < {} _, bits 0, bits 1 >
const INT_PATTERN = patternFromFilter('?< <bits 0, bits 1, {} _>=bits "+", bits "-">');

const INT_LIST_PATTERN = patternFromFilter(`
  ?<
    {} nil,
    {
      < <bits 0, bits 1, {} _>=bits "+", bits "-" > car,
      list cdr
    } cons
  > = list
`);

const DEC_BASE = 1_000_000_000;
const DEC_CHUNK = 9;
const BIT_CHUNK = 20;
const BIT_BASE = 1 << BIT_CHUNK; // 2^20 * 10^9 < Number.MAX_SAFE_INTEGER

// Build bits Value (MSB outermost) directly from a validated non-negative decimal string.
function decimalToBits(str) {
  let v = Value.variant("_", Value.product({}));
  if (str === "0") return v;
  const limbs = [];
  const firstLen = str.length % DEC_CHUNK || DEC_CHUNK;
  limbs.push(Number(str.slice(0, firstLen)));
  for (let i = firstLen; i < str.length; i += DEC_CHUNK) {
    limbs.push(Number(str.slice(i, i + DEC_CHUNK)));
  }
  let start = 0;
  while (start < limbs.length) {
    let rem = 0;
    for (let i = start; i < limbs.length; i++) {
      const cur = rem * DEC_BASE + limbs[i];
      const q = Math.floor(cur / BIT_BASE);
      limbs[i] = q;
      rem = cur - q * BIT_BASE;
    }
    while (start < limbs.length && limbs[start] === 0) start++;
    if (start < limbs.length) {
      for (let b = 0; b < BIT_CHUNK; b++) {
        v = Value.variant((rem & 1) === 1 ? "1" : "0", v);
        rem >>>= 1;
      }
    } else {
      while (rem > 0) {
        v = Value.variant((rem & 1) === 1 ? "1" : "0", v);
        rem >>>= 1;
      }
    }
  }
  return v;
}

// Parse a decimal integer string into a k int Value.
function parseIntStr(str) {
  str = str.trim();
  let sign = "+";
  if (str[0] === "-") { sign = "-"; str = str.slice(1).replace(/\s+/g, ""); }
  else if (str[0] === "+") { str = str.slice(1).replace(/\s+/g, ""); }
  if (!/^(0|[1-9][0-9]*)$/.test(str)) {
    throw new Error(`Invalid integer syntax: ${JSON.stringify(str)}`);
  }
  if (str === "0") sign = "+";
  return Value.variant(sign, decimalToBits(str));
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

// Parse a decimal integer string or integer list into an enveloped k Value.
export function parse(str) {
  str = str.trim();
  const raw = str.startsWith("[") ? parseIntListStr(str) : parseIntStr(str);
  const pattern = isVariant(raw) && (raw.tag === "nil" || raw.tag === "cons")
    ? INT_LIST_PATTERN
    : INT_PATTERN;
  return withPattern(raw, pattern);
}

// Walk a decoded int Value and return a decimal string.
function printSingleInt(value) {
  if (!isVariant(value) || (value.tag !== "+" && value.tag !== "-")) {
    throw new Error("Not a valid k int value");
  }
  const sign = value.tag;
  const limbs = []; // base-10^9, least-significant limb at index 0
  let node = value.value;
  while (isVariant(node) && node.tag !== "_") {
    let chunkVal = 0;
    let chunkBits = 0;
    while (chunkBits < BIT_CHUNK && isVariant(node) && node.tag !== "_") {
      if (node.tag !== "0" && node.tag !== "1") {
        throw new Error("Not a valid k int value");
      }
      chunkVal = (chunkVal << 1) | (node.tag === "1" ? 1 : 0);
      chunkBits++;
      node = node.value;
    }
    const mult = 1 << chunkBits;
    let carry = chunkVal;
    for (let i = 0; i < limbs.length; i++) {
      const cur = limbs[i] * mult + carry;
      carry = Math.floor(cur / DEC_BASE);
      limbs[i] = cur - carry * DEC_BASE;
    }
    if (carry > 0) {
      limbs.push(carry);
    }
  }
  if (!isVariant(node) || node.tag !== "_" || !isProduct(node.value) || Object.keys(node.value.product).length !== 0) {
    throw new Error("Not a valid k int value");
  }
  if (limbs.length === 0) return "0";
  let digits = String(limbs[limbs.length - 1]);
  for (let i = limbs.length - 2; i >= 0; i--) {
    digits += String(limbs[i]).padStart(DEC_CHUNK, "0");
  }
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
export function print(value) {
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

runCodecCLI(import.meta.url, { parse, print, doc });

export {
  INT_PATTERN,
  INT_LIST_PATTERN,
  parseIntStr,
  parseIntListStr
};
