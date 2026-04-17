import { Product, Variant } from "../Value.mjs";
import { encodeWithPattern, decode, NODE_KIND } from "./runtime/codec.mjs";

const UNIT = new Product({});
const BIT0 = new Variant("0", UNIT);
const BIT1 = new Variant("1", UNIT);

function bitValue(bit) {
  return bit === 0 ? BIT0 : BIT1;
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

function bitsProduct(width, n) {
  const product = {};
  for (let i = width - 1; i >= 0; i--) {
    product[String(i)] = bitValue((n >> i) & 1);
  }
  return new Product(product);
}

function parseBitsProduct(value, maxBit, where) {
  const product = requireProduct(value, where);
  let n = 0;
  for (let i = maxBit; i >= 0; i--) {
    const entry = requireVariant(product[String(i)], `${where}.bit${i}`);
    if (entry.tag !== "0" && entry.tag !== "1") {
      throw new Error(`${where}.bit${i}: expected tag 0 or 1`);
    }
    n = (n << 1) | (entry.tag === "1" ? 1 : 0);
  }
  return n;
}

function byteProduct(n) {
  return bitsProduct(8, n);
}

function parseByteProduct(value, where) {
  return parseBitsProduct(value, 7, where);
}

function encodeBmpCommonHi(hi) {
  if (hi >= 0x08 && hi <= 0x0f) return new Variant("h08_0F", bitsProduct(3, hi - 0x08));
  if (hi >= 0x10 && hi <= 0x7f) return new Variant("h10_7F", bitsProduct(7, hi - 0x10));
  if (hi >= 0x80 && hi <= 0xcf) return new Variant("h80_CF", bitsProduct(7, hi - 0x80));
  if (hi >= 0xd0 && hi <= 0xd7) return new Variant("hD0_D7", bitsProduct(3, hi - 0xd0));
  if (hi === 0xf9) return new Variant("hF9", UNIT);
  if (hi >= 0xfa && hi <= 0xfb) return new Variant("hFA_FB", bitsProduct(1, hi - 0xfa));
  if (hi >= 0xfc && hi <= 0xfd) return new Variant("hFC_FD", bitsProduct(1, hi - 0xfc));
  if (hi >= 0xfe && hi <= 0xff) return new Variant("hFE_FF", bitsProduct(1, hi - 0xfe));
  throw new Error(`Unsupported BMP common hi byte: 0x${hi.toString(16)}`);
}

function decodeBmpCommonHi(value) {
  const v = requireVariant(value, "bmp_common.hi");
  if (v.tag === "h08_0F") return 0x08 + parseBitsProduct(v.value, 2, "h08_0F");
  if (v.tag === "h10_7F") return 0x10 + parseBitsProduct(v.value, 6, "h10_7F");
  if (v.tag === "h80_CF") return 0x80 + parseBitsProduct(v.value, 6, "h80_CF");
  if (v.tag === "hD0_D7") return 0xd0 + parseBitsProduct(v.value, 2, "hD0_D7");
  if (v.tag === "hF9") return 0xf9;
  if (v.tag === "hFA_FB") return 0xfa + parseBitsProduct(v.value, 0, "hFA_FB");
  if (v.tag === "hFC_FD") return 0xfc + parseBitsProduct(v.value, 0, "hFC_FD");
  if (v.tag === "hFE_FF") return 0xfe + parseBitsProduct(v.value, 0, "hFE_FF");
  throw new Error(`Unsupported bmp_common.hi tag: ${v.tag}`);
}

function encodeBmpPrivateHi(hi) {
  if (hi >= 0xe0 && hi <= 0xef) return new Variant("hE0_EF", bitsProduct(4, hi - 0xe0));
  if (hi >= 0xf0 && hi <= 0xf7) return new Variant("hF0_F7", bitsProduct(3, hi - 0xf0));
  if (hi === 0xf8) return new Variant("hF8", UNIT);
  throw new Error(`Unsupported BMP private-use hi byte: 0x${hi.toString(16)}`);
}

function decodeBmpPrivateHi(value) {
  const v = requireVariant(value, "bmp_private_use.hi");
  if (v.tag === "hE0_EF") return 0xe0 + parseBitsProduct(v.value, 3, "hE0_EF");
  if (v.tag === "hF0_F7") return 0xf0 + parseBitsProduct(v.value, 2, "hF0_F7");
  if (v.tag === "hF8") return 0xf8;
  throw new Error(`Unsupported bmp_private_use.hi tag: ${v.tag}`);
}

function encodePlane2To16(plane) {
  if (plane >= 2 && plane <= 3) return new Variant("p02_03", bitsProduct(1, plane - 2));
  if (plane >= 4 && plane <= 7) return new Variant("p04_07", bitsProduct(2, plane - 4));
  if (plane >= 8 && plane <= 15) return new Variant("p08_0F", bitsProduct(3, plane - 8));
  if (plane === 16) return new Variant("p10", UNIT);
  throw new Error(`Plane out of range for supplementary_planes2_16: ${plane}`);
}

function decodePlane2To16(value) {
  const v = requireVariant(value, "supplementary_planes2_16.plane");
  if (v.tag === "p02_03") return 2 + parseBitsProduct(v.value, 0, "p02_03");
  if (v.tag === "p04_07") return 4 + parseBitsProduct(v.value, 1, "p04_07");
  if (v.tag === "p08_0F") return 8 + parseBitsProduct(v.value, 2, "p08_0F");
  if (v.tag === "p10") return 16;
  throw new Error(`Unsupported supplementary plane tag: ${v.tag}`);
}

function codePointToUnicodeValue(cp) {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) {
    throw new Error(`Code point out of Unicode range: ${cp}`);
  }
  if (cp >= 0xd800 && cp <= 0xdfff) {
    throw new Error(`Surrogate code point is not a scalar value: U+${cp.toString(16).toUpperCase()}`);
  }

  if (cp <= 0x7f) {
    return new Variant("ascii", bitsProduct(7, cp));
  }

  if (cp <= 0x7ff) {
    return new Variant("plane0", bitsProduct(11, cp));
  }

  if (cp <= 0xffff) {
    const hi = (cp >> 8) & 0xff;
    const lo = cp & 0xff;
    if (hi >= 0xe0 && hi <= 0xf8) {
      return new Variant("bmp_private_use", new Product({ hi: encodeBmpPrivateHi(hi), lo: byteProduct(lo) }));
    }
    return new Variant("bmp_common", new Product({ hi: encodeBmpCommonHi(hi), lo: byteProduct(lo) }));
  }

  const mid = (cp >> 8) & 0xff;
  const lo = cp & 0xff;

  if (cp <= 0x1ffff) {
    return new Variant("supplementary_plane1", new Product({
      mid: byteProduct(mid),
      lo: byteProduct(lo)
    }));
  }

  const plane = cp >> 16;
  return new Variant("supplementary_planes2_16", new Product({
    plane: encodePlane2To16(plane),
    mid: byteProduct(mid),
    lo: byteProduct(lo)
  }));
}

function unicodeValueToCodePoint(value) {
  const v = requireVariant(value, "unicode");

  if (v.tag === "ascii") return parseBitsProduct(v.value, 6, "ascii");
  if (v.tag === "plane0") return parseBitsProduct(v.value, 10, "plane0");

  if (v.tag === "bmp_common") {
    const p = requireProduct(v.value, "bmp_common");
    return (decodeBmpCommonHi(p.hi) << 8) | parseByteProduct(p.lo, "bmp_common.lo");
  }

  if (v.tag === "bmp_private_use") {
    const p = requireProduct(v.value, "bmp_private_use");
    return (decodeBmpPrivateHi(p.hi) << 8) | parseByteProduct(p.lo, "bmp_private_use.lo");
  }

  if (v.tag === "supplementary_plane1") {
    const p = requireProduct(v.value, "supplementary_plane1");
    return (1 << 16) | (parseByteProduct(p.mid, "supplementary_plane1.mid") << 8) | parseByteProduct(p.lo, "supplementary_plane1.lo");
  }

  if (v.tag === "supplementary_planes2_16") {
    const p = requireProduct(v.value, "supplementary_planes2_16");
    return (decodePlane2To16(p.plane) << 16) | (parseByteProduct(p.mid, "supplementary_planes2_16.mid") << 8) | parseByteProduct(p.lo, "supplementary_planes2_16.lo");
  }

  throw new Error(`Unsupported unicode tag: ${v.tag}`);
}

function textToStringValue(text) {
  let out = new Variant("nil", UNIT);
  const chars = Array.from(text);
  for (let i = chars.length - 1; i >= 0; i--) {
    const cp = chars[i].codePointAt(0);
    out = new Variant("cons", new Product({
      car: codePointToUnicodeValue(cp),
      cdr: out
    }));
  }
  return out;
}

function stringValueToText(value) {
  let out = "";
  let cursor = value;

  while (true) {
    const list = requireVariant(cursor, "string");
    if (list.tag === "nil") {
      requireProduct(list.value, "string.nil");
      return out;
    }
    if (list.tag !== "cons") {
      throw new Error(`Unsupported string list tag: ${list.tag}`);
    }
    const pair = requireProduct(list.value, "string.cons");
    out += String.fromCodePoint(unicodeValueToCodePoint(pair.car));
    cursor = pair.cdr;
  }
}

const STRING_PATTERN = {
  dictionary: [
    "0", "1", "10",
    "ascii", "bmp_common", "bmp_private_use",
    "car", "cdr", "cons",
    "h08_0F", "h10_7F", "h80_CF", "hD0_D7", "hE0_EF", "hF0_F7", "hF8", "hF9", "hFA_FB", "hFC_FD", "hFE_FF",
    "hi",
    "lo",
    "mid",
    "nil",
    "p02_03", "p04_07", "p08_0F", "p10",
    "plane", "plane0",
    "supplementary_plane1", "supplementary_planes2_16",
    "2", "3", "4", "5", "6", "7", "8", "9"
  ],
  nodes: [
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "nil", target: 1 }, { label: "cons", target: 2 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "car", target: 3 }, { label: "cdr", target: 0 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [
      { label: "ascii", target: 4 },
      { label: "plane0", target: 6 },
      { label: "bmp_common", target: 7 },
      { label: "bmp_private_use", target: 10 },
      { label: "supplementary_plane1", target: 12 },
      { label: "supplementary_planes2_16", target: 13 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 },
      { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "0", target: 1 }, { label: "1", target: 1 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "10", target: 5 }, { label: "9", target: 5 }, { label: "8", target: 5 }, { label: "7", target: 5 },
      { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 }, { label: "3", target: 5 },
      { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "hi", target: 8 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [
      { label: "h08_0F", target: 15 }, { label: "h10_7F", target: 16 }, { label: "h80_CF", target: 16 },
      { label: "hD0_D7", target: 15 }, { label: "hF9", target: 1 },
      { label: "hFA_FB", target: 17 }, { label: "hFC_FD", target: 17 }, { label: "hFE_FF", target: 17 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "7", target: 5 }, { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 },
      { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "hi", target: 11 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "hE0_EF", target: 18 }, { label: "hF0_F7", target: 15 }, { label: "hF8", target: 1 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "mid", target: 9 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "plane", target: 14 }, { label: "mid", target: 9 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "p02_03", target: 17 }, { label: "p04_07", target: 19 }, { label: "p08_0F", target: 15 }, { label: "p10", target: 1 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 },
      { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "0", target: 5 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "1", target: 5 }, { label: "0", target: 5 } ] }
  ]
};

function encodeText(text) {
  return encodeWithPattern(textToStringValue(text), STRING_PATTERN);
}

function decodeText(buffer) {
  const { value } = decode(buffer);
  return stringValueToText(value);
}

export { STRING_PATTERN, textToStringValue, stringValueToText, encodeText, decodeText };
