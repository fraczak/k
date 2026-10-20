#!/usr/bin/env node

/**
 * Dynamic JSON Binary Bit-Trie (djson-btrie) codec.
 *
 * Uses a unified binary bit-trie for both JSON arrays (list) and JSON
 * objects (object):
 *
 *   TRIE = <
 *     {} nil,
 *     {
 *       < {} nil, JSON val > val,
 *       TRIE 0,
 *       TRIE 1
 *     } trie
 *   >
 *
 * - In `list`, element at index i >= 0 is stored at the canonical binary
 *   bit-path of i (0 -> [0], 1 -> [1], 2 -> [1,0], 3 -> [1,1], ...).
 * - In `object`, entry with key k is stored at the prefix-free Unicode
 *   character bit-path of k.
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
  codePointToUnicodeValue,
  unicodeValueToCodePoint,
  textToStringValue,
  stringValueToText
} from "./runtime/unicode-string.mjs";

export const doc = `
Dynamic JSON Binary Bit-Trie (djson-btrie) codec.

Represents both JSON arrays (list) and JSON objects (object) using a
unified binary bit-trie:
  TRIE = <
    {} nil,
    {
      < {} nil, JSON val > val,
      TRIE 0,
      TRIE 1
    } trie
  >
`;

export const DJSON_BTRIE_PATTERN = patternFromFilter(`
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

  <
    {} nil,
    {
      < {} nil, JSON val > val,
      TRIE 0,
      TRIE 1
    } trie
  > = TRIE list,

  TRIE object
> = JSON
`);

const UNIT = Value.product({});
const NIL = Value.variant("nil", UNIT);

function requireProduct(value, where) {
  if (!isProduct(value)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

function pushBitsMSB(out, width, n) {
  for (let i = width - 1; i >= 0; i--) {
    out.push((n >> i) & 1);
  }
}

function readBitsMSB(bits, offset, width) {
  let n = 0;
  for (let i = 0; i < width; i++) {
    n = (n << 1) | bits[offset + i];
  }
  return n;
}

export function indexToBitPath(index) {
  if (index === 0) return [0];
  const bits = [];
  let n = index;
  while (n > 0) {
    bits.push(n & 1);
    n = Math.floor(n / 2);
  }
  bits.reverse();
  return bits;
}

export function bitPathToIndex(bits) {
  if (bits.length === 1 && bits[0] === 0) return 0;
  let n = 0;
  for (const b of bits) {
    n = n * 2 + b;
  }
  return n;
}

export function codePointToBitPath(cp, out = []) {
  if (cp <= 0x7f) {
    out.push(0);
    pushBitsMSB(out, 7, cp);
    return out;
  }
  if (cp <= 0x7ff) {
    out.push(1, 0);
    pushBitsMSB(out, 11, cp);
    return out;
  }
  if (cp <= 0xffff) {
    const hi = (cp >> 8) & 0xff;
    const lo = cp & 0xff;
    if (hi >= 0xe0 && hi <= 0xf8) {
      out.push(1, 1, 1, 0);
      if (hi <= 0xef) {
        out.push(0);
        pushBitsMSB(out, 4, hi - 0xe0);
      } else if (hi <= 0xf7) {
        out.push(1, 0);
        pushBitsMSB(out, 3, hi - 0xf0);
      } else {
        out.push(1, 1);
      }
      pushBitsMSB(out, 8, lo);
      return out;
    }
    out.push(1, 1, 0);
    if (hi >= 0x08 && hi <= 0x0f) {
      out.push(0, 0, 0);
      pushBitsMSB(out, 3, hi - 0x08);
    } else if (hi >= 0x10 && hi <= 0x7f) {
      out.push(0, 0, 1);
      pushBitsMSB(out, 7, hi - 0x10);
    } else if (hi >= 0x80 && hi <= 0xcf) {
      out.push(0, 1, 0);
      pushBitsMSB(out, 7, hi - 0x80);
    } else if (hi >= 0xd0 && hi <= 0xd7) {
      out.push(0, 1, 1);
      pushBitsMSB(out, 3, hi - 0xd0);
    } else if (hi === 0xf9) {
      out.push(1, 0, 0);
    } else if (hi >= 0xfa && hi <= 0xfb) {
      out.push(1, 0, 1);
      pushBitsMSB(out, 1, hi - 0xfa);
    } else if (hi >= 0xfc && hi <= 0xfd) {
      out.push(1, 1, 0);
      pushBitsMSB(out, 1, hi - 0xfc);
    } else if (hi >= 0xfe && hi <= 0xff) {
      out.push(1, 1, 1);
      pushBitsMSB(out, 1, hi - 0xfe);
    } else {
      throw new Error(`Unsupported BMP hi byte: ${hi}`);
    }
    pushBitsMSB(out, 8, lo);
    return out;
  }
  const mid = (cp >> 8) & 0xff;
  const lo = cp & 0xff;
  if (cp <= 0x1ffff) {
    out.push(1, 1, 1, 1, 0);
    pushBitsMSB(out, 8, mid);
    pushBitsMSB(out, 8, lo);
    return out;
  }
  const plane = cp >> 16;
  out.push(1, 1, 1, 1, 1);
  if (plane >= 2 && plane <= 3) {
    out.push(0, 0);
    pushBitsMSB(out, 1, plane - 2);
  } else if (plane >= 4 && plane <= 7) {
    out.push(0, 1);
    pushBitsMSB(out, 2, plane - 4);
  } else if (plane >= 8 && plane <= 15) {
    out.push(1, 0);
    pushBitsMSB(out, 3, plane - 8);
  } else if (plane === 16) {
    out.push(1, 1);
  } else {
    throw new Error(`Unsupported plane: ${plane}`);
  }
  pushBitsMSB(out, 8, mid);
  pushBitsMSB(out, 8, lo);
  return out;
}

export function stringToBitPath(str) {
  const out = [];
  for (const ch of str) {
    codePointToBitPath(ch.codePointAt(0), out);
  }
  return out;
}

export function bitPathToString(bits) {
  let i = 0;
  let out = "";
  while (i < bits.length) {
    if (bits[i] === 0) {
      const cp = readBitsMSB(bits, i + 1, 7);
      out += String.fromCodePoint(cp);
      i += 8;
      continue;
    }
    if (bits[i + 1] === 0) {
      const cp = readBitsMSB(bits, i + 2, 11);
      out += String.fromCodePoint(cp);
      i += 13;
      continue;
    }
    if (bits[i + 2] === 0) {
      i += 3;
      const tag = readBitsMSB(bits, i, 3);
      i += 3;
      let hi;
      if (tag === 0) {
        hi = 0x08 + readBitsMSB(bits, i, 3);
        i += 3;
      } else if (tag === 1) {
        hi = 0x10 + readBitsMSB(bits, i, 7);
        i += 7;
      } else if (tag === 2) {
        hi = 0x80 + readBitsMSB(bits, i, 7);
        i += 7;
      } else if (tag === 3) {
        hi = 0xd0 + readBitsMSB(bits, i, 3);
        i += 3;
      } else if (tag === 4) {
        hi = 0xf9;
      } else if (tag === 5) {
        hi = 0xfa + readBitsMSB(bits, i, 1);
        i += 1;
      } else if (tag === 6) {
        hi = 0xfc + readBitsMSB(bits, i, 1);
        i += 1;
      } else {
        hi = 0xfe + readBitsMSB(bits, i, 1);
        i += 1;
      }
      const lo = readBitsMSB(bits, i, 8);
      i += 8;
      out += String.fromCodePoint((hi << 8) | lo);
      continue;
    }
    if (bits[i + 3] === 0) {
      i += 4;
      let hi;
      if (bits[i] === 0) {
        hi = 0xe0 + readBitsMSB(bits, i + 1, 4);
        i += 5;
      } else if (bits[i + 1] === 0) {
        hi = 0xf0 + readBitsMSB(bits, i + 2, 3);
        i += 5;
      } else {
        hi = 0xf8;
        i += 2;
      }
      const lo = readBitsMSB(bits, i, 8);
      i += 8;
      out += String.fromCodePoint((hi << 8) | lo);
      continue;
    }
    if (bits[i + 4] === 0) {
      i += 5;
      const mid = readBitsMSB(bits, i, 8);
      const lo = readBitsMSB(bits, i + 8, 8);
      i += 16;
      out += String.fromCodePoint((1 << 16) | (mid << 8) | lo);
      continue;
    }
    i += 5;
    let plane;
    if (bits[i] === 0 && bits[i + 1] === 0) {
      plane = 2 + readBitsMSB(bits, i + 2, 1);
      i += 3;
    } else if (bits[i] === 0 && bits[i + 1] === 1) {
      plane = 4 + readBitsMSB(bits, i + 2, 2);
      i += 4;
    } else if (bits[i] === 1 && bits[i + 1] === 0) {
      plane = 8 + readBitsMSB(bits, i + 2, 3);
      i += 5;
    } else {
      plane = 16;
      i += 2;
    }
    const mid = readBitsMSB(bits, i, 8);
    const lo = readBitsMSB(bits, i + 8, 8);
    i += 16;
    out += String.fromCodePoint((plane << 16) | (mid << 8) | lo);
  }
  return out;
}

function makeMutableNode() {
  return { val: null, b0: null, b1: null };
}

function insertMutableTrie(root, bits, kVal) {
  let curr = root;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 0) {
      if (!curr.b0) curr.b0 = makeMutableNode();
      curr = curr.b0;
    } else {
      if (!curr.b1) curr.b1 = makeMutableNode();
      curr = curr.b1;
    }
  }
  curr.val = kVal;
}

function mutableNodeToK(node) {
  if (!node) return NIL;
  const valField = node.val !== null
    ? Value.variant("val", node.val)
    : NIL;
  const b0 = mutableNodeToK(node.b0);
  const b1 = mutableNodeToK(node.b1);
  if (node.val === null && b0 === NIL && b1 === NIL) {
    return NIL;
  }
  return Value.variant("trie", Value.product({
    val: valField,
    0: b0,
    1: b1
  }));
}

function collectTrieEntries(kNode, pathBits = [], entries = []) {
  if (!isVariant(kNode)) {
    throw new Error("djson-btrie: expected variant (nil or trie)");
  }
  if (kNode.tag === "nil") {
    return entries;
  }
  if (kNode.tag !== "trie") {
    throw new Error(`djson-btrie: unexpected tag ${kNode.tag}`);
  }
  const prod = requireProduct(kNode.value, "djson-btrie.trie");
  if (!isVariant(prod.val)) {
    throw new Error("djson-btrie.trie.val: expected variant");
  }
  if (prod.val.tag === "val") {
    entries.push({ bits: pathBits.slice(), val: prod.val.value });
  } else if (prod.val.tag !== "nil") {
    throw new Error(
      `djson-btrie.trie.val: unexpected tag ${prod.val.tag}`
    );
  }
  pathBits.push(0);
  collectTrieEntries(prod[0], pathBits, entries);
  pathBits.pop();
  pathBits.push(1);
  collectTrieEntries(prod[1], pathBits, entries);
  pathBits.pop();
  return entries;
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
    if (value.length === 0) {
      return Value.variant("list", NIL);
    }
    const root = makeMutableNode();
    for (let i = 0; i < value.length; i++) {
      insertMutableTrie(root, indexToBitPath(i), fromJsonValue(value[i]));
    }
    return Value.variant("list", mutableNodeToK(root));
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return Value.variant("object", NIL);
    }
    const root = makeMutableNode();
    for (const k of keys) {
      insertMutableTrie(
        root,
        stringToBitPath(k),
        fromJsonValue(value[k])
      );
    }
    return Value.variant("object", mutableNodeToK(root));
  }
  throw new Error(`Unsupported JSON value: ${value}`);
}

export function toJsonValue(value) {
  if (!isVariant(value)) {
    throw new Error("djson-btrie: expected top-level Variant");
  }
  if (value.tag === "null") {
    requireProduct(value.value, "djson-btrie.null");
    return null;
  }
  if (value.tag === "bool") {
    if (!isVariant(value.value)) {
      throw new Error("djson-btrie.bool: expected variant");
    }
    if (value.value.tag === "true") return true;
    if (value.value.tag === "false") return false;
    throw new Error(`djson-btrie.bool: invalid tag ${value.value.tag}`);
  }
  if (value.tag === "number") {
    return decodeValueToNumber(value.value);
  }
  if (value.tag === "string") {
    return stringValueToText(value.value);
  }
  if (value.tag === "list") {
    const entries = collectTrieEntries(value.value);
    entries.sort((a, b) =>
      bitPathToIndex(a.bits) - bitPathToIndex(b.bits)
    );
    return entries.map((e) => toJsonValue(e.val));
  }
  if (value.tag === "object") {
    const entries = collectTrieEntries(value.value);
    const result = {};
    for (const e of entries) {
      result[bitPathToString(e.bits)] = toJsonValue(e.val);
    }
    return result;
  }
  throw new Error(`djson-btrie: unsupported tag ${value.tag}`);
}

export const pattern = DJSON_BTRIE_PATTERN;

export function parse(rawText) {
  const text = String(rawText).trim();
  if (!text) throw new Error("Empty JSON input");
  const parsed = JSON.parse(text);
  const val = fromJsonValue(parsed);
  return withPattern(val, DJSON_BTRIE_PATTERN);
}

export function print(value) {
  return JSON.stringify(toJsonValue(value));
}

export const codec = {
  name: "djson-btrie",
  doc,
  pattern: DJSON_BTRIE_PATTERN,
  parse,
  print
};

export default codec;

runCodecCLI(import.meta.url, { parse, print, doc });
