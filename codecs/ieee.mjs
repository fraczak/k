#!/usr/bin/env node

import { Value, isProduct, isVariant, withPattern, patternFromFilter, runCodecCLI } from "./runtime/codec-sdk.mjs";

export const doc = `
IEEE 754 64-bit float codec.

Parses decimal floats, Infinity, -Infinity, NaN to 64-bit IEEE products.
`;

const FLOAT64_PATTERN = patternFromFilter(`
$bit  = < {} 0, {} 1 >;
$sign = < {} "+", {} "-" >;
$exp11  = {bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9, bit 10};
$frac52 = {bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9,
           bit 10, bit 11, bit 12, bit 13, bit 14, bit 15, bit 16, bit 17, bit 18, bit 19,
           bit 20, bit 21, bit 22, bit 23, bit 24, bit 25, bit 26, bit 27, bit 28, bit 29,
           bit 30, bit 31, bit 32, bit 33, bit 34, bit 35, bit 36, bit 37, bit 38, bit 39,
           bit 40, bit 41, bit 42, bit 43, bit 44, bit 45, bit 46, bit 47, bit 48, bit 49,
           bit 50, bit 51};
$float64 = {sign sign, exp11 exponent, frac52 fraction};
?$float64
`);

const UNIT = Value.product({});

function bitValue(bit) {
  return Value.variant(bit === 0 ? "0" : "1", UNIT);
}

function bitsProduct(width, value) {
  const big = BigInt(value);
  const product = {};
  for (let i = width - 1; i >= 0; i--) {
    product[String(i)] = bitValue(Number((big >> BigInt(i)) & 1n));
  }
  return Value.product(product);
}

const floatView = new DataView(new ArrayBuffer(8));

export function encodeNumberToValue(number) {
  floatView.setFloat64(0, number, false);
  const bits = floatView.getBigUint64(0, false);
  const sign = Number((bits >> 63n) & 1n);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);

  return Value.product({
    sign: Value.variant(sign === 0 ? "+" : "-", UNIT),
    exponent: bitsProduct(11, exponent),
    fraction: bitsProduct(52, fraction)
  });
}

function requireProduct(value, where) {
  if (!isProduct(value)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

function requireVariant(value, where) {
  if (!isVariant(value)) {
    throw new Error(`${where}: expected Variant`);
  }
  return value;
}

function parseBitsProduct(value, maxBit, where) {
  const product = requireProduct(value, where);
  let n = 0n;
  for (let i = maxBit; i >= 0; i--) {
    const entry = requireVariant(product[String(i)], `${where}.bit${i}`);
    if (entry.tag !== "0" && entry.tag !== "1") {
      throw new Error(`${where}.bit${i}: expected tag 0 or 1`);
    }
    n = (n << 1n) | BigInt(entry.tag === "1" ? 1 : 0);
  }
  return n;
}

export function decodeValueToNumber(value) {
  const product = requireProduct(value, "float64");
  const sign = requireVariant(product.sign, "float64.sign");
  if (sign.tag !== "+" && sign.tag !== "-") {
    throw new Error(`float64.sign: expected + or -, got ${sign.tag}`);
  }
  const exponent = parseBitsProduct(product.exponent, 10, "float64.exponent");
  const fraction = parseBitsProduct(product.fraction, 51, "float64.fraction");

  const bits =
    (BigInt(sign.tag === "-" ? 1 : 0) << 63n) |
    (exponent << 52n) |
    fraction;

  floatView.setBigUint64(0, bits, false);
  return floatView.getFloat64(0, false);
}

function parseFloatText(text) {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("Expected a floating-point literal");
  }

  if (/^[+-]?nan$/i.test(trimmed)) return NaN;
  if (/^[+]?inf(inity)?$/i.test(trimmed)) return Infinity;
  if (/^[-](inf|infinity)$/i.test(trimmed)) return -Infinity;

  const n = Number(trimmed);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid float literal ${JSON.stringify(trimmed)}`);
  }
  return n;
}

function printFloatText(n) {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "Infinity";
  if (n === -Infinity) return "-Infinity";
  if (Object.is(n, -0)) return "-0";
  return String(n);
}

export function parse(text) {
  const n = parseFloatText(text);
  const value = encodeNumberToValue(n);
  return withPattern(value, FLOAT64_PATTERN);
}

export function print(value) {
  return printFloatText(decodeValueToNumber(value));
}

runCodecCLI(import.meta.url, { parse, print, doc });

export {
  FLOAT64_PATTERN
};
