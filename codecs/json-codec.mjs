import { Value, isProduct, isVariant } from "../Value.mjs";
import { patternFromFilter } from "./runtime/codec-sdk.mjs";
import { STRING_PATTERN_PROPERTY_LIST, textToStringValue, stringValueToText } from "./string-codec.mjs";
import { FLOAT64_PATTERN, encodeNumberToValue, decodeValueToNumber } from "./ieee.mjs";

const UNIT = Value.product({});
const BOOL_PATTERN = patternFromFilter("?< {} false, {} true >");
const NULL_PATTERN = patternFromFilter("?< {} null >");

function requireProduct(value, where) {
  if (!isProduct(value)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

function fromJsonValue(value) {
  if (value === null) {
    return Value.variant("null", UNIT);
  }
  if (typeof value === "boolean") {
    return Value.variant(value ? "true" : "false", UNIT);
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
    return Value.product(
      value.reduce((product, item, index) => {
        product[String(index)] = fromJsonValue(item);
        return product;
      }, {})
    );
  }
  if (value && typeof value === "object") {
    return Value.product(
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
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((key) => [key, patternFromJsonValue(value[key])])
    );
  }
  throw new Error(`Unsupported JSON value: ${value}`);
}

function toJsonValue(value) {
  if (isVariant(value)) {
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
      if (isVariant(child)) return toJsonValue(child);
      if (isProduct(child)) {
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
