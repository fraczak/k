#!/usr/bin/env node

/**
 * Dynamic JSON (djson) codec with universal singleton pattern.
 *
 * Translates arbitrary JSON data to/from self-describing enveloped k
 * values using a single recursive AST pattern:
 *
 *   JSON = <
 *     float64 number,
 *     str string,
 *     <{} true, {} false> bool,
 *     {} null,
 *     <{} nil, {JSON car, LIST cdr} cons> = LIST list,
 *     <{} nil, {{str key, JSON val} car, OBJ cdr} cons> = OBJ object
 *   >
 */

import {
  Value,
  isProduct,
  isVariant,
  withPattern,
  patternFromFilter,
  runCodecCLI
} from "./runtime/codec-sdk.mjs";
import { encodeNumberToValue, decodeValueToNumber } from "./ieee.mjs";
import {
  textToStringValue,
  stringValueToText
} from "./runtime/unicode-string.mjs";

export const doc = `
Dynamic JSON (djson) codec with universal singleton pattern.

Translates any JSON value to/from self-describing enveloped k values
conforming to the universal recursive JSON AST type:
  JSON = <
    float64 number,
    str string,
    <{} true, {} false> bool,
    {} null,
    <{} nil, {JSON car, LIST cdr} cons> = LIST list,
    <{} nil, {{str key, JSON val} car, OBJ cdr} cons> = OBJ object
  >
`;

export const DJSON_PATTERN = patternFromFilter(`
? <
  {
    < {} "+", {} "-" > sign,
    {
      < {} 0, {} 1 >=Bit 0,
      Bit 1, Bit 2, Bit 3, Bit 4, Bit 5,
      Bit 6, Bit 7, Bit 8, Bit 9, Bit 10
    } exponent,
    {
      Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5,
      Bit 6, Bit 7, Bit 8, Bit 9, Bit 10, Bit 11,
      Bit 12, Bit 13, Bit 14, Bit 15, Bit 16, Bit 17,
      Bit 18, Bit 19, Bit 20, Bit 21, Bit 22, Bit 23,
      Bit 24, Bit 25, Bit 26, Bit 27, Bit 28, Bit 29,
      Bit 30, Bit 31, Bit 32, Bit 33, Bit 34, Bit 35,
      Bit 36, Bit 37, Bit 38, Bit 39, Bit 40, Bit 41,
      Bit 42, Bit 43, Bit 44, Bit 45, Bit 46, Bit 47,
      Bit 48, Bit 49, Bit 50, Bit 51
    } fraction
  } number,

  <
    {} nil,
    {
      <
        {
          < {} 0, {} 1 >=Bit7 0,
          Bit7 1, Bit7 2, Bit7 3, Bit7 4, Bit7 5, Bit7 6
        }=Bits7 ascii,
        {
          <
            { Bit7 0, Bit7 1, Bit7 2 }=Bits3 h08_0F,
            Bits7 h10_7F,
            Bits7 h80_CF,
            Bits3 hD0_D7,
            {} hF9,
            { Bit7 0 }=Bits1 hFA_FB,
            Bits1 hFC_FD,
            Bits1 hFE_FF
          > hi,
          {
            Bit7 0, Bit7 1, Bit7 2, Bit7 3,
            Bit7 4, Bit7 5, Bit7 6, Bit7 7
          }=Bits8 lo
        } bmp_common,
        {
          <
            { Bit7 0, Bit7 1, Bit7 2, Bit7 3 } hE0_EF,
            Bits3 hF0_F7,
            {} hF8
          > hi,
          Bits8 lo
        } bmp_private_use,
        {
          Bit7 0, Bit7 1, Bit7 2, Bit7 3, Bit7 4, Bit7 5,
          Bit7 6, Bit7 7, Bit7 8, Bit7 9, Bit7 10
        } plane0,
        { Bits8 mid, Bits8 lo } supplementary_plane1,
        {
          <
            Bits1 p02_03,
            { Bit7 0, Bit7 1 } p04_07,
            Bits3 p08_0F,
            {} p10
          > plane,
          Bits8 mid,
          Bits8 lo
        } supplementary_planes2_16
      > car,
      Str cdr
    } cons
  > = Str string,

  < {} true, {} false > bool,
  {} null,

  < {} nil, { JSON car, LIST cdr } cons > = LIST list,

  < {} nil, { { Str key, JSON val } car, OBJ cdr } cons > = OBJ object
> = JSON
`);

const UNIT = Value.product({});

function requireProduct(value, where) {
  if (!isProduct(value)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

function listToK(items) {
  let result = Value.variant("nil", UNIT);
  for (let i = items.length - 1; i >= 0; i--) {
    result = Value.variant("cons", Value.product({
      car: items[i],
      cdr: result
    }));
  }
  return result;
}

function listFromK(value, where) {
  const result = [];
  let current = value;
  while (true) {
    if (!isVariant(current)) {
      throw new Error(`${where}: expected list variant (nil or cons)`);
    }
    if (current.tag === "nil") {
      requireProduct(current.value, `${where}.nil`);
      return result;
    }
    if (current.tag !== "cons") {
      throw new Error(
        `${where}: expected nil or cons, got ${current.tag}`
      );
    }
    const pair = requireProduct(current.value, `${where}.cons`);
    result.push(pair.car);
    current = pair.cdr;
  }
}

export function fromJsonValue(value) {
  if (value === null) {
    return Value.variant("null", UNIT);
  }
  if (typeof value === "boolean") {
    return Value.variant(
      "bool",
      Value.variant(value ? "true" : "false", UNIT)
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JSON numbers must be finite");
    }
    return Value.variant("number", encodeNumberToValue(value));
  }
  if (typeof value === "string") {
    return Value.variant("string", textToStringValue(value));
  }
  if (Array.isArray(value)) {
    return Value.variant("list", listToK(value.map(fromJsonValue)));
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map((k) =>
      Value.product({
        key: textToStringValue(k),
        val: fromJsonValue(value[k])
      })
    );
    return Value.variant("object", listToK(entries));
  }
  throw new Error(`Unsupported JSON value: ${value}`);
}

export function toJsonValue(value) {
  if (!isVariant(value)) {
    throw new Error("djson.value: expected top-level Variant");
  }

  if (value.tag === "null") {
    requireProduct(value.value, "djson.null");
    return null;
  }

  if (value.tag === "bool") {
    if (!isVariant(value.value)) {
      throw new Error("djson.bool: expected variant");
    }
    if (value.value.tag === "true") {
      requireProduct(value.value.value, "djson.bool.true");
      return true;
    }
    if (value.value.tag === "false") {
      requireProduct(value.value.value, "djson.bool.false");
      return false;
    }
    throw new Error(`djson.bool: invalid tag ${value.value.tag}`);
  }

  if (value.tag === "number") {
    return decodeValueToNumber(value.value);
  }

  if (value.tag === "string") {
    return stringValueToText(value.value);
  }

  if (value.tag === "list") {
    const items = listFromK(value.value, "djson.list");
    return items.map(toJsonValue);
  }

  if (value.tag === "object") {
    const pairs = listFromK(value.value, "djson.object");
    const result = {};
    for (const pairValue of pairs) {
      const pair = requireProduct(pairValue, "djson.object.pair");
      const key = stringValueToText(pair.key);
      result[key] = toJsonValue(pair.val);
    }
    return result;
  }

  throw new Error(`Unsupported djson tag: ${value.tag}`);
}

export function parse(text) {
  const json = JSON.parse(text);
  const value = fromJsonValue(json);
  return withPattern(value, DJSON_PATTERN);
}

export function print(value) {
  return JSON.stringify(toJsonValue(value));
}

runCodecCLI(import.meta.url, { parse, print, doc });
