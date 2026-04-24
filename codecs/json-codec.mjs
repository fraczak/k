import { Product, Variant } from "../Value.mjs";
import { STRING_PATTERN_PROPERTY_LIST, textToStringValue, stringValueToText } from "./string-codec.mjs";
import { FLOAT64_PATTERN } from "./runtime/ieee-pattern.mjs";

const UNIT = new Product({});
const BOOL_PATTERN = [
  ["closed-union", [["false", 1], ["true", 1]]],
  ["closed-product", []]
];
const NULL_PATTERN = [
  ["closed-union", [["null", 1]]],
  ["closed-product", []]
];

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
  const product = requireProduct(value, "json.number");
  const sign = requireVariant(product.sign, "json.number.sign");
  if (sign.tag !== "+" && sign.tag !== "-") {
    throw new Error(`json.number.sign: expected + or -, got ${sign.tag}`);
  }
  const exponent = parseBitsProduct(product.exponent, 10, "json.number.exponent");
  const fraction = parseBitsProduct(product.fraction, 51, "json.number.fraction");

  const bits =
    (BigInt(sign.tag === "-" ? 1 : 0) << 63n) |
    (exponent << 52n) |
    fraction;

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(bits, 0);
  return buf.readDoubleBE(0);
}

function fromJsonValue(value) {
  if (value === null) {
    return new Variant("null", UNIT);
  }
  if (typeof value === "boolean") {
    return new Variant(value ? "true" : "false", UNIT);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JSON numbers must be finite");
    }
    return encodeNumberToValue(value);
  }
  if (typeof value === "string") {
    return textToStringValue(value);
  }
  if (Array.isArray(value)) {
    return new Product(
      value.reduce((product, item, index) => {
        product[String(index)] = fromJsonValue(item);
        return product;
      }, {})
    );
  }
  if (value && typeof value === "object") {
    return new Product(
      Object.keys(value).reduce((product, key) => {
        product[key] = fromJsonValue(value[key]);
        return product;
      }, {})
    );
  }
  throw new Error(`Unsupported JSON value: ${value}`);
}

function composePattern(kind, entries) {
  const result = [[kind, []]];

  for (const [label, childPattern] of entries) {
    const offset = result.length;
    result[0][1].push([label, offset]);
    for (const [childKind, childEdges] of childPattern) {
      result.push([
        childKind,
        childEdges.map(([edgeLabel, target]) => [edgeLabel, target + offset])
      ]);
    }
  }

  return result;
}

function patternFromJsonValue(value) {
  if (value === null) return NULL_PATTERN;
  if (typeof value === "boolean") return BOOL_PATTERN;
  if (typeof value === "number") return FLOAT64_PATTERN;
  if (typeof value === "string") return STRING_PATTERN_PROPERTY_LIST;
  if (Array.isArray(value)) {
    return composePattern(
      "closed-product",
      value.map((item, index) => [String(index), patternFromJsonValue(item)])
    );
  }
  if (value && typeof value === "object") {
    return composePattern(
      "closed-product",
      Object.keys(value)
        .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")))
        .map((key) => [key, patternFromJsonValue(value[key])])
    );
  }
  throw new Error(`Unsupported JSON value: ${value}`);
}

function toJsonValue(value) {
  if (value instanceof Variant) {
    if (value.tag === "null") {
      requireProduct(value.value, "json.null");
      return null;
    }
    if (value.tag === "true") {
      requireProduct(value.value, "json.true");
      return true;
    }
    if (value.tag === "false") {
      requireProduct(value.value, "json.false");
      return false;
    }
    return stringValueToText(value);
  }

  const product = requireProduct(value, "json.value");
  const keys = Object.keys(product);
  const isArray = keys.every((key, index) => key === String(index));

  if (isArray) {
    return keys.map((key) => {
      const child = product[key];
      if (child instanceof Variant) return toJsonValue(child);
      if (child instanceof Product) {
        try {
          return decodeValueToNumber(child);
        } catch {}
      }
      return toJsonValue(child);
    });
  }

  // Distinguish object from number by shape first.
  const numberKeys = ["exponent", "fraction", "sign"];
  if (keys.length === numberKeys.length && numberKeys.every((key) => key in product)) {
    return decodeValueToNumber(value);
  }

  // Distinguish object from string list by trying the string decoder.
  try {
    return stringValueToText(value);
  } catch {}

  return keys.reduce((result, key) => {
    result[key] = toJsonValue(product[key]);
    return result;
  }, {});
}

export { fromJsonValue, toJsonValue, patternFromJsonValue, encodeNumberToValue, decodeValueToNumber, BOOL_PATTERN, NULL_PATTERN };
export default { fromJsonValue, toJsonValue, patternFromJsonValue, encodeNumberToValue, decodeValueToNumber, BOOL_PATTERN, NULL_PATTERN };
