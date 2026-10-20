#!/usr/bin/env node

/**
 * Dynamic JSON Patricia/Radix Trie (djson-ptrie) codec.
 *
 * Implements the trie-array data structure for both JSON arrays (list)
 * and JSON objects (object):
 *
 * - `list`: Radix/Patricia bit-trie with compressed bit `prefix` and
 *   subtree `size`:
 *     LIST = <
 *       {} nil,
 *       {
 *         BITS prefix,
 *         BITS size,
 *         < {} nil, JSON val > val,
 *         LIST 0,
 *         LIST 1
 *       } trie
 *     >
 *
 * - `object`: Character-level Radix/Patricia trie (trie-array over
 *   Unicode characters) with compressed `prefix` string, `size`, `val`,
 *   and sorted `dict` of `{ CHAR char, OBJ trie }` branches:
 *     OBJ = <
 *       {} nil,
 *       {
 *         Str prefix,
 *         BITS size,
 *         < {} nil, JSON val > val,
 *         < {} nil, { { CHAR char, OBJ trie } car, DICT cdr } cons >=DICT dict
 *       } trie
 *     >
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
import { indexToBitPath, bitPathToIndex } from "./djson-btrie.mjs";

export const doc = `
Dynamic JSON Patricia/Radix Trie (djson-ptrie) codec (trie-array style).

Represents JSON arrays with a compressed bit-radix trie (with prefix &
size) and JSON objects with a character-level radix trie (with prefix,
size, val, and sorted dict).
`;

export const DJSON_PTRIE_PATTERN = patternFromFilter(`
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
      >=CHAR car,
      Str cdr
    } cons
  > = Str string,

  < {} true, {} false > bool,
  {} null,

  <
    {} nil,
    {
      < {} _, BITS 0, BITS 1 >=BITS prefix,
      BITS size,
      < {} nil, JSON val > val,
      LIST 0,
      LIST 1
    } trie
  > = LIST list,

  <
    {} nil,
    {
      Str prefix,
      BITS size,
      < {} nil, JSON val > val,
      <
        {} nil,
        {
          { CHAR char, OBJ trie } car,
          DICT cdr
        } cons
      >=DICT dict
    } trie
  > = OBJ object
> = JSON
`);

const UNIT = Value.product({});
const NIL = Value.variant("nil", UNIT);
const BITS_EMPTY = Value.variant("_", UNIT);

function requireProduct(value, where) {
  if (!isProduct(value)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

/**
 * Encode an array of bits [b0, b1, ..., bk-1] into a `bits?` chain
 * where b0 is the outermost tag (`|0` or `|1`) and `_` is at the base.
 */
function bitArrayToBitsK(bits) {
  let out = BITS_EMPTY;
  for (let i = bits.length - 1; i >= 0; i--) {
    out = Value.variant(bits[i] === 1 ? "1" : "0", out);
  }
  return out;
}

function bitsKToBitArray(val) {
  const out = [];
  let cur = val;
  while (true) {
    if (!isVariant(cur)) {
      throw new Error("djson-ptrie.bits: expected variant");
    }
    if (cur.tag === "_") return out;
    if (cur.tag === "0") {
      out.push(0);
      cur = cur.value;
    } else if (cur.tag === "1") {
      out.push(1);
      cur = cur.value;
    } else {
      throw new Error(`djson-ptrie.bits: unexpected tag ${cur.tag}`);
    }
  }
}

function natToBitsK(n) {
  return bitArrayToBitsK(indexToBitPath(n));
}

// ============================================================================
// 1. Patricia Bit-Trie for `list` (trie-array over bits)
// ============================================================================

function commonBitPrefixLen(a, b) {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

function splitBitTrieNode(x, n) {
  const bitAtN = x.prefix[n];
  const y = {
    size: x.size - 1,
    prefix: x.prefix.slice(n + 1),
    val: x.val,
    b0: x.b0,
    b1: x.b1
  };
  x.prefix = x.prefix.slice(0, n);
  x.val = null;
  x.b0 = bitAtN === 0 ? y : null;
  x.b1 = bitAtN === 1 ? y : null;
}

function addToBitTrie(t, bits, kVal) {
  let curr = t;
  let s = bits;
  while (true) {
    curr.size++;
    const pLen = commonBitPrefixLen(curr.prefix, s);
    if (pLen === s.length && pLen === curr.prefix.length) {
      curr.val = kVal;
      return;
    }
    if (pLen === s.length) {
      splitBitTrieNode(curr, pLen);
      curr.val = kVal;
      return;
    }
    if (pLen !== curr.prefix.length) {
      splitBitTrieNode(curr, pLen);
      const nextBit = s[pLen];
      const newChild = {
        size: 1,
        prefix: s.slice(pLen + 1),
        val: kVal,
        b0: null,
        b1: null
      };
      if (nextBit === 0) curr.b0 = newChild;
      else curr.b1 = newChild;
      return;
    }
    const nextBit = s[pLen];
    const q = nextBit === 0 ? curr.b0 : curr.b1;
    if (!q) {
      const newChild = {
        size: 1,
        prefix: s.slice(pLen + 1),
        val: kVal,
        b0: null,
        b1: null
      };
      if (nextBit === 0) curr.b0 = newChild;
      else curr.b1 = newChild;
      return;
    }
    curr = q;
    s = s.slice(pLen + 1);
  }
}

function bitTrieNodeToK(node) {
  if (!node) return NIL;
  return Value.variant("trie", Value.product({
    prefix: bitArrayToBitsK(node.prefix),
    size: natToBitsK(node.size),
    val: node.val !== null ? Value.variant("val", node.val) : NIL,
    0: bitTrieNodeToK(node.b0),
    1: bitTrieNodeToK(node.b1)
  }));
}

function collectBitTrieEntries(kNode, pathBits = [], entries = []) {
  if (!isVariant(kNode)) {
    throw new Error("djson-ptrie.list: expected variant");
  }
  if (kNode.tag === "nil") return entries;
  if (kNode.tag !== "trie") {
    throw new Error(`djson-ptrie.list: unexpected tag ${kNode.tag}`);
  }
  const prod = requireProduct(kNode.value, "djson-ptrie.list.trie");
  const nodePrefix = bitsKToBitArray(prod.prefix);
  const fullPrefix = pathBits.concat(nodePrefix);
  if (isVariant(prod.val) && prod.val.tag === "val") {
    entries.push({ bits: fullPrefix, val: prod.val.value });
  }
  collectBitTrieEntries(prod[0], fullPrefix.concat([0]), entries);
  collectBitTrieEntries(prod[1], fullPrefix.concat([1]), entries);
  return entries;
}

// ============================================================================
// 2. Character-Level Radix Trie for `object` (trie-array over Unicode chars)
// ============================================================================

function commonCharPrefixLen(a, b) {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

function splitCharTrieNode(x, n) {
  const charAtN = x.prefix[n];
  const y = {
    size: x.size - 1,
    prefix: x.prefix.slice(n + 1),
    val: x.val,
    dict: x.dict,
    order: x.order
  };
  x.dict = new Map([[charAtN, y]]);
  x.order = [charAtN];
  x.prefix = x.prefix.slice(0, n);
  x.val = null;
}

function addToCharTrie(t, cpArray, kVal) {
  let curr = t;
  let s = cpArray;
  while (true) {
    curr.size++;
    const pLen = commonCharPrefixLen(curr.prefix, s);
    if (pLen === s.length && pLen === curr.prefix.length) {
      curr.val = kVal;
      return;
    }
    if (pLen === s.length) {
      splitCharTrieNode(curr, pLen);
      curr.val = kVal;
      return;
    }
    if (pLen !== curr.prefix.length) {
      splitCharTrieNode(curr, pLen);
      const c = s[pLen];
      curr.dict.set(c, {
        size: 1,
        prefix: s.slice(pLen + 1),
        val: kVal,
        dict: new Map(),
        order: []
      });
      curr.order.push(c);
      curr.order.sort((a, b) => a - b);
      return;
    }
    const c = s[pLen];
    const q = curr.dict.get(c);
    if (!q) {
      curr.dict.set(c, {
        size: 1,
        prefix: s.slice(pLen + 1),
        val: kVal,
        dict: new Map(),
        order: []
      });
      curr.order.push(c);
      curr.order.sort((a, b) => a - b);
      return;
    }
    curr = q;
    s = s.slice(pLen + 1);
  }
}

function cpArrayToStringK(cpArray) {
  let out = NIL;
  for (let i = cpArray.length - 1; i >= 0; i--) {
    out = Value.variant("cons", Value.product({
      car: codePointToUnicodeValue(cpArray[i]),
      cdr: out
    }));
  }
  return out;
}

function charTrieNodeToK(node) {
  if (!node) return NIL;
  let dictK = NIL;
  for (let i = node.order.length - 1; i >= 0; i--) {
    const cp = node.order[i];
    const child = node.dict.get(cp);
    dictK = Value.variant("cons", Value.product({
      car: Value.product({
        char: codePointToUnicodeValue(cp),
        trie: charTrieNodeToK(child)
      }),
      cdr: dictK
    }));
  }
  return Value.variant("trie", Value.product({
    prefix: cpArrayToStringK(node.prefix),
    size: natToBitsK(node.size),
    val: node.val !== null ? Value.variant("val", node.val) : NIL,
    dict: dictK
  }));
}

function collectCharTrieEntries(kNode, prefixStr = "", entries = []) {
  if (!isVariant(kNode)) {
    throw new Error("djson-ptrie.object: expected variant");
  }
  if (kNode.tag === "nil") return entries;
  if (kNode.tag !== "trie") {
    throw new Error(`djson-ptrie.object: unexpected tag ${kNode.tag}`);
  }
  const prod = requireProduct(kNode.value, "djson-ptrie.object.trie");
  const nodePrefix = stringValueToText(prod.prefix);
  const fullPrefix = prefixStr + nodePrefix;
  if (isVariant(prod.val) && prod.val.tag === "val") {
    entries.push({ key: fullPrefix, val: prod.val.value });
  }
  let curDict = prod.dict;
  while (true) {
    if (!isVariant(curDict)) {
      throw new Error("djson-ptrie.object.dict: expected variant");
    }
    if (curDict.tag === "nil") break;
    if (curDict.tag !== "cons") {
      throw new Error(`djson-ptrie.object.dict: unexpected tag ${curDict.tag}`);
    }
    const pair = requireProduct(curDict.value, "djson-ptrie.object.dict.cons");
    const entry = requireProduct(pair.car, "djson-ptrie.object.dict.car");
    const ch = String.fromCodePoint(unicodeValueToCodePoint(entry.char));
    collectCharTrieEntries(entry.trie, fullPrefix + ch, entries);
    curDict = pair.cdr;
  }
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
    const firstBits = indexToBitPath(0);
    const root = {
      size: 1,
      prefix: firstBits,
      val: fromJsonValue(value[0]),
      b0: null,
      b1: null
    };
    for (let i = 1; i < value.length; i++) {
      addToBitTrie(root, indexToBitPath(i), fromJsonValue(value[i]));
    }
    return Value.variant("list", bitTrieNodeToK(root));
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return Value.variant("object", NIL);
    }
    const firstCps = Array.from(keys[0]).map((c) => c.codePointAt(0));
    const root = {
      size: 1,
      prefix: firstCps,
      val: fromJsonValue(value[keys[0]]),
      dict: new Map(),
      order: []
    };
    for (let i = 1; i < keys.length; i++) {
      const cps = Array.from(keys[i]).map((c) => c.codePointAt(0));
      addToCharTrie(root, cps, fromJsonValue(value[keys[i]]));
    }
    return Value.variant("object", charTrieNodeToK(root));
  }
  throw new Error(`Unsupported JSON value: ${value}`);
}

export function toJsonValue(value) {
  if (!isVariant(value)) {
    throw new Error("djson-ptrie: expected top-level Variant");
  }
  if (value.tag === "null") {
    requireProduct(value.value, "djson-ptrie.null");
    return null;
  }
  if (value.tag === "bool") {
    if (!isVariant(value.value)) {
      throw new Error("djson-ptrie.bool: expected variant");
    }
    if (value.value.tag === "true") return true;
    if (value.value.tag === "false") return false;
    throw new Error(`djson-ptrie.bool: invalid tag ${value.value.tag}`);
  }
  if (value.tag === "number") {
    return decodeValueToNumber(value.value);
  }
  if (value.tag === "string") {
    return stringValueToText(value.value);
  }
  if (value.tag === "list") {
    const entries = collectBitTrieEntries(value.value);
    entries.sort((a, b) => bitPathToIndex(a.bits) - bitPathToIndex(b.bits));
    return entries.map((e) => toJsonValue(e.val));
  }
  if (value.tag === "object") {
    const entries = collectCharTrieEntries(value.value);
    const result = {};
    for (const e of entries) {
      result[e.key] = toJsonValue(e.val);
    }
    return result;
  }
  throw new Error(`djson-ptrie: unsupported tag ${value.tag}`);
}

export const pattern = DJSON_PTRIE_PATTERN;

export function parse(rawText) {
  const text = String(rawText).trim();
  if (!text) throw new Error("Empty JSON input");
  const parsed = JSON.parse(text);
  const val = fromJsonValue(parsed);
  return withPattern(val, DJSON_PTRIE_PATTERN);
}

export function print(value) {
  return JSON.stringify(toJsonValue(value));
}

export const codec = {
  name: "djson-ptrie",
  doc,
  pattern: DJSON_PTRIE_PATTERN,
  parse,
  print
};

export default codec;

runCodecCLI(import.meta.url, { parse, print, doc });
