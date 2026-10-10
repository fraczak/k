#!/usr/bin/env node

import { Value, isProduct, isVariant, withPattern, patternFromFilter, runCodecCLI } from "./runtime/codec-sdk.mjs";

export const doc = `
IEEE 754 64-bit float codec.

Parses decimal floats, Infinity, -Infinity, NaN to 64-bit IEEE products.
`;

const FLOAT64_PATTERN = patternFromFilter(`
? {
  < {} "+", {} "-" > sign,
  {
    < {} 0, {} 1 >=Bit 0,
    Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6, Bit 7, Bit 8, Bit 9, Bit 10
  } exponent,
  {
    Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6, Bit 7, Bit 8, Bit 9,
    Bit 10, Bit 11, Bit 12, Bit 13, Bit 14, Bit 15, Bit 16, Bit 17, Bit 18, Bit 19,
    Bit 20, Bit 21, Bit 22, Bit 23, Bit 24, Bit 25, Bit 26, Bit 27, Bit 28, Bit 29,
    Bit 30, Bit 31, Bit 32, Bit 33, Bit 34, Bit 35, Bit 36, Bit 37, Bit 38, Bit 39,
    Bit 40, Bit 41, Bit 42, Bit 43, Bit 44, Bit 45, Bit 46, Bit 47, Bit 48, Bit 49,
    Bit 50, Bit 51
  } fraction
}
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
