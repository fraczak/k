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
  Decimal integer (e.g. 42, -15) or bracketed integer list (e.g. [0, 1, 2], []).
`;

// Closed pattern for $ int = < bits '+', bits '-' >
// with $ bits = < {} _, bits 0, bits 1 >
const INT_PATTERN = patternFromFilter('?< <bits 0, bits 1, {} _>=bits "+", bits "-">');

// Closed pattern for list of int:
// list = < {} nil, {int car, list cdr} cons >
const INT_LIST_PATTERN = patternFromFilter(
  '$ bits = < bits 0, bits 1, {} _ >; $ int = < bits "+", bits "-" >; ?< {} nil, { $int car, list cdr } cons > = list'
);

// Build bits Value (MSB outermost) from a non-negative BigInt.
function buildBits(n) {
  const bitChars = n === 0n ? ["0"] : n.toString(2).split("");
  let v = Value.variant("_", Value.product({}));
  for (let i = bitChars.length - 1; i >= 0; i--) {
    v = Value.variant(bitChars[i], v);
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
  const n = BigInt(str);
  if (n === 0n) sign = "+";
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
  let bits = "";
  let node = value.value;
  while (isVariant(node) && node.tag !== "_") {
    bits += node.tag;
    node = node.value;
  }
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
