#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { Product, Variant } from "../Value.mjs";
import { decodeEnvelope, encodeToEnvelope } from "./runtime/prefix-codec.mjs";
import { FLOAT64_PATTERN } from "./runtime/ieee-pattern.mjs";
const UNIT = new Product({});

function bitValue(bit) {
  return new Variant(bit === 0 ? "0" : "1", UNIT);
}

function bitsProduct(width, value) {
  const big = BigInt(value);
  const product = {};
  for (let i = width - 1; i >= 0; i--) {
    product[String(i)] = bitValue(Number((big >> BigInt(i)) & 1n));
  }
  return new Product(product);
}

function encodeNumberToValue(number) {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(number, 0);
  const bits = buf.readBigUInt64BE(0);
  const sign = Number((bits >> 63n) & 1n);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);

  return new Product({
    sign: new Variant(sign === 0 ? "+" : "-", UNIT),
    exponent: bitsProduct(11, exponent),
    fraction: bitsProduct(52, fraction)
  });
}

function requireProduct(value, where) {
  if (!(value instanceof Product)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

function requireVariant(value, where) {
  if (!(value instanceof Variant)) {
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

function decodeValueToNumber(value) {
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

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(bits, 0);
  return buf.readDoubleBE(0);
}

function parseFloatText(text) {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("Expected a floating-point literal");
  }

  if (/^[+-]?nan$/i.test(trimmed)) return NaN;
  if (/^[+]?inf(inity)?$/i.test(trimmed)) return Infinity;
  if (/^-inf(inity)?$/i.test(trimmed)) return -Infinity;

  const value = Number(trimmed);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid floating-point literal: ${JSON.stringify(trimmed)}`);
  }
  return value;
}

function printFloatText(number) {
  if (Number.isNaN(number)) return "NaN";
  if (number === Infinity) return "Infinity";
  if (number === -Infinity) return "-Infinity";
  if (Object.is(number, -0)) return "-0";
  return String(number);
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    console.error("Usage: ieee.mjs --parse | --print");
    console.error("  --parse  read a float literal from stdin, write JSON envelope");
    console.error("  --print  read a JSON envelope from stdin, write a float literal");
    exit(1);
  }

  const buf = await readAll(stdin);

  if (args[0] === "--parse") {
    const value = encodeNumberToValue(parseFloatText(buf.toString("utf8")));
    stdout.write(`${JSON.stringify(encodeToEnvelope(value, FLOAT64_PATTERN))}\n`);
  } else {
    const { value } = decodeEnvelope(JSON.parse(buf.toString("utf8")));
    stdout.write(`${printFloatText(decodeValueToNumber(value))}\n`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  exit(1);
});
