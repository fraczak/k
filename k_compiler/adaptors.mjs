import { Product, TypedValue, Variant } from "../TypedValue.mjs";
import { decodeKVBF, encodeKVBF } from "../KVBF/kvbf.mjs";
import { formatTypedLiteral } from "../KVBF/kvalue-text.mjs";

function typeEntry(typeId, registry) {
  const entry = registry[typeId];
  if (!entry) {
    throw new Error(`Unknown type id: ${typeId}`);
  }
  return entry;
}

function sortLabels(labels) {
  return labels.slice().sort((a, b) => {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

function valueFromJson(typeId, jsonValue, registry) {
  const entry = typeEntry(typeId, registry);

  if (entry.code === "product") {
    const labels = sortLabels(Object.keys(entry.product));
    if (jsonValue === null || typeof jsonValue !== "object" || Array.isArray(jsonValue)) {
      throw new Error(`Expected JSON object for product type ${typeId}`);
    }
    const fields = labels.reduce((result, label) => {
      if (!(label in jsonValue)) {
        throw new Error(`Missing field '${label}' for product type ${typeId}`);
      }
      result[label] = valueFromJson(entry.product[label], jsonValue[label], registry);
      return result;
    }, {});
    return new Product(fields);
  }

  if (entry.code === "union") {
    if (typeof jsonValue === "string" && entry.union[jsonValue] !== undefined) {
      return new Variant(jsonValue, new Product({}));
    }
    if (jsonValue === null || typeof jsonValue !== "object" || Array.isArray(jsonValue)) {
      throw new Error(`Expected tagged JSON object for union type ${typeId}`);
    }
    const labels = Object.keys(jsonValue);
    if (labels.length !== 1) {
      throw new Error(`Expected single tag for union type ${typeId}`);
    }
    const [tag] = labels;
    if (entry.union[tag] === undefined) {
      throw new Error(`Unknown variant '${tag}' for union type ${typeId}`);
    }
    return new Variant(tag, valueFromJson(entry.union[tag], jsonValue[tag], registry));
  }

  throw new Error(`Unsupported registry entry code for ${typeId}: ${entry.code}`);
}

function typedValueFromJson(typeId, jsonValue, registry) {
  return new TypedValue(typeId, valueFromJson(typeId, jsonValue, registry));
}

function typedValueToJson(typedValue) {
  return typedValue.value.toJSON();
}

function tokenizeNativeValue(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const ch = source[index];
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    if ("{}|,".includes(ch)) {
      tokens.push({ type: ch, value: ch });
      index += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === ch && source[end - 1] !== "\\") break;
        end += 1;
      }
      if (end >= source.length) {
        throw new Error("Unterminated string in typed adapter");
      }
      tokens.push({
        type: "label",
        value: JSON.parse(source.slice(index, end + 1).replace(/^'/, "\"").replace(/'$/, "\"")),
      });
      index = end + 1;
      continue;
    }
    const match = source.slice(index).match(/^[a-zA-Z0-9_+\-][a-zA-Z0-9_?!+\-]*/);
    if (!match) {
      throw new Error(`Unexpected token in typed adapter near '${source.slice(index, index + 16)}'`);
    }
    tokens.push({ type: "label", value: match[0] });
    index += match[0].length;
  }

  return tokens;
}

function parseNativeValue(source) {
  const tokens = tokenizeNativeValue(source);
  let index = 0;

  function peek() {
    return tokens[index] || null;
  }

  function consume(type) {
    const token = peek();
    if (!token || token.type !== type) {
      throw new Error(`Expected '${type}' in typed adapter`);
    }
    index += 1;
    return token;
  }

  function parseLabel() {
    return consume("label").value;
  }

  function parseProduct() {
    consume("{");
    if (peek()?.type === "}") {
      consume("}");
      return new Product({});
    }

    const entries = [];
    while (true) {
      const child = parseValueNode();
      const label = parseLabel();
      entries.push({ label, child });
      if (peek()?.type === ",") {
        consume(",");
        continue;
      }
      break;
    }
    consume("}");

    if (entries.length === 1) {
      return new Variant(entries[0].label, entries[0].child);
    }

    return new Product(entries.reduce((result, entry) => {
      result[entry.label] = entry.child;
      return result;
    }, {}));
  }

  function parseValueNode() {
    let value = parseProduct();
    while (peek()?.type === "|") {
      consume("|");
      value = new Variant(parseLabel(), value);
    }
    return value;
  }

  const result = parseValueNode();
  if (index !== tokens.length) {
    throw new Error("Unexpected trailing tokens in typed adapter");
  }
  return result;
}

function serializeTypedValue(typedValue, registry, adapter, options = {}) {
  switch (adapter) {
    case "json":
      return JSON.stringify({
        type: typedValue.type,
        value: typedValueToJson(typedValue),
      }, null, options.pretty ? 2 : 0);
    case "kvbf":
      return encodeKVBF(typedValue, registry, options);
    case "typed":
      return formatTypedLiteral(typedValue);
    default:
      throw new Error(`Unknown adapter: ${adapter}`);
  }
}

function deserializeTypedValue(input, registry, adapter, options = {}) {
  switch (adapter) {
    case "json": {
      const parsed = typeof input === "string" ? JSON.parse(input) : input;
      if (!parsed || typeof parsed !== "object" || !parsed.type) {
        throw new Error("JSON adapter expects { type, value }");
      }
      return typedValueFromJson(parsed.type, parsed.value, registry);
    }
    case "kvbf": {
      const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
      return decodeKVBF(buffer, registry, options);
    }
    case "typed": {
      if (typeof input !== "string") {
        return input;
      }
      const match = input.match(/^(@\S+)\s+([\s\S]+)$/);
      if (!match) {
        throw new Error("Typed adapter expects '@type <value>'");
      }
      return new TypedValue(match[1], parseNativeValue(match[2]));
    }
    default:
      throw new Error(`Unknown adapter: ${adapter}`);
  }
}

export {
  deserializeTypedValue,
  serializeTypedValue,
  typedValueFromJson,
  typedValueToJson,
  valueFromJson,
};
export default {
  deserializeTypedValue,
  serializeTypedValue,
  typedValueFromJson,
  typedValueToJson,
  valueFromJson,
};
