import { Product, Variant, withPattern } from "../../Value.mjs";
import { refinePatternForValue, coerceValueForPattern, NODE_KIND } from "./codec.mjs";
import { patternToPropertyList, propertyListToPattern } from "./pattern-json.mjs";
import { textToStringValue, stringValueToText } from "./unicode-string.mjs";

const CORE_PATTERN_PROPERTY_LIST = [
  ["closed-union", [["cons", 1], ["nil", 3]]],
  ["closed-product", [["car", 2], ["cdr", 0]]],
  ["closed-union", [["any", 3], ["closed-product", 4], ["closed-union", 4], ["open-product", 4], ["open-union", 4]]],
  ["closed-product", []],
  ["closed-union", [["cons", 5], ["nil", 3]]],
  ["closed-product", [["car", 6], ["cdr", 4]]],
  ["closed-product", [["label", 7], ["target", 25]]],
  ["closed-union", [["cons", 8], ["nil", 3]]],
  ["closed-product", [["car", 9], ["cdr", 7]]],
  ["closed-union", [["ascii", 10], ["bmp_common", 12], ["bmp_private_use", 17], ["plane0", 20], ["supplementary_plane1", 21], ["supplementary_planes2_16", 22]]],
  ["closed-product", [["0", 11], ["1", 11], ["2", 11], ["3", 11], ["4", 11], ["5", 11], ["6", 11]]],
  ["closed-union", [["0", 3], ["1", 3]]],
  ["closed-product", [["hi", 13], ["lo", 16]]],
  ["closed-union", [["h08_0F", 14], ["h10_7F", 10], ["h80_CF", 10], ["hD0_D7", 14], ["hF9", 3], ["hFA_FB", 15], ["hFC_FD", 15], ["hFE_FF", 15]]],
  ["closed-product", [["0", 11], ["1", 11], ["2", 11]]],
  ["closed-product", [["0", 11]]],
  ["closed-product", [["0", 11], ["1", 11], ["2", 11], ["3", 11], ["4", 11], ["5", 11], ["6", 11], ["7", 11]]],
  ["closed-product", [["hi", 18], ["lo", 16]]],
  ["closed-union", [["hE0_EF", 19], ["hF0_F7", 14], ["hF8", 3]]],
  ["closed-product", [["0", 11], ["1", 11], ["2", 11], ["3", 11]]],
  ["closed-product", [["0", 11], ["1", 11], ["10", 11], ["2", 11], ["3", 11], ["4", 11], ["5", 11], ["6", 11], ["7", 11], ["8", 11], ["9", 11]]],
  ["closed-product", [["lo", 16], ["mid", 16]]],
  ["closed-product", [["lo", 16], ["mid", 16], ["plane", 23]]],
  ["closed-union", [["p02_03", 15], ["p04_07", 24], ["p08_0F", 14], ["p10", 3]]],
  ["closed-product", [["0", 11], ["1", 11]]],
  ["closed-union", [["0", 25], ["1", 25], ["_", 3]]]
];

const CORE_PATTERN_PATTERN = propertyListToPattern(CORE_PATTERN_PROPERTY_LIST);
const UNIT = new Product({});

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.bitCount = 0;
  }

  writeBit(bit) {
    this.current = (this.current << 1) | (bit ? 1 : 0);
    this.bitCount += 1;
    if (this.bitCount === 8) {
      this.bytes.push(this.current);
      this.current = 0;
      this.bitCount = 0;
    }
  }

  writeBits(value, width) {
    if (!Number.isInteger(width) || width < 0) {
      throw new Error(`Invalid bit width ${width}`);
    }
    if (width === 0) return;
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) {
      throw new Error(`Value ${value} does not fit in ${width} bits`);
    }
    for (let i = width - 1; i >= 0; i--) {
      this.writeBit((value >> i) & 1);
    }
  }

  toBuffer() {
    if (this.bitCount > 0) {
      this.bytes.push(this.current << (8 - this.bitCount));
    }
    return Buffer.from(this.bytes);
  }
}

class BitReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.byteOffset = 0;
    this.bitOffset = 0;
  }

  readBit() {
    if (this.byteOffset >= this.buffer.length) {
      throw new Error("Unexpected end of bitstream");
    }
    const byte = this.buffer[this.byteOffset];
    const bit = (byte >> (7 - this.bitOffset)) & 1;
    this.bitOffset += 1;
    if (this.bitOffset === 8) {
      this.byteOffset += 1;
      this.bitOffset = 0;
    }
    return bit;
  }

  readBits(width) {
    let value = 0;
    for (let i = 0; i < width; i++) {
      value = (value << 1) | this.readBit();
    }
    return value;
  }

  assertZeroPadding() {
    while (this.byteOffset < this.buffer.length) {
      if (this.readBit() !== 0) {
        throw new Error("Non-zero trailing padding bits");
      }
    }
  }
}

function choiceWidth(cardinality) {
  if (!Number.isInteger(cardinality) || cardinality < 0) {
    throw new Error(`Invalid cardinality ${cardinality}`);
  }
  if (cardinality <= 1) return 0;
  return Math.ceil(Math.log2(cardinality));
}

function encodeNode(writer, value, pattern, patternNodeId) {
  const patternNode = pattern.nodes[patternNodeId];
  if (!patternNode) {
    throw new Error(`Unknown pattern node ${patternNodeId}`);
  }

  switch (patternNode.kind) {
    case NODE_KIND.ANY:
      throw new Error("Pattern node 'any' is not directly encodable");

    case NODE_KIND.OPEN_PRODUCT:
    case NODE_KIND.CLOSED_PRODUCT: {
      if (!(value instanceof Product)) {
        throw new Error(`Expected Product for pattern node ${patternNodeId}`);
      }
      const actual = Object.keys(value.product).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
      const expected = patternNode.edges.map((edge) => edge.label);
      if (actual.length !== expected.length || actual.some((label, i) => label !== expected[i])) {
        throw new Error(`Product fields do not match pattern node ${patternNodeId}`);
      }
      for (const edge of patternNode.edges) {
        encodeNode(writer, value.product[edge.label], pattern, edge.target);
      }
      return;
    }

    case NODE_KIND.OPEN_UNION:
    case NODE_KIND.CLOSED_UNION: {
      if (!(value instanceof Variant)) {
        throw new Error(`Expected Variant for pattern node ${patternNodeId}`);
      }
      const tagOrdinal = patternNode.edges.findIndex((edge) => edge.label === value.tag);
      if (tagOrdinal === -1) {
        throw new Error(`Variant tag '${value.tag}' is not present in pattern node ${patternNodeId}`);
      }
      const width = choiceWidth(patternNode.edges.length);
      writer.writeBits(tagOrdinal, width);
      encodeNode(writer, value.value, pattern, patternNode.edges[tagOrdinal].target);
      return;
    }

    default:
      throw new Error(`Unsupported pattern node kind ${patternNode.kind}`);
  }
}

function decodeNode(reader, pattern, patternNodeId) {
  const patternNode = pattern.nodes[patternNodeId];
  if (!patternNode) {
    throw new Error(`Unknown pattern node ${patternNodeId}`);
  }

  switch (patternNode.kind) {
    case NODE_KIND.ANY:
      throw new Error("Pattern node 'any' is not directly decodable");

    case NODE_KIND.OPEN_PRODUCT:
    case NODE_KIND.CLOSED_PRODUCT: {
      const product = {};
      for (const edge of patternNode.edges) {
        product[edge.label] = decodeNode(reader, pattern, edge.target);
      }
      return new Product(product);
    }

    case NODE_KIND.OPEN_UNION:
    case NODE_KIND.CLOSED_UNION: {
      if (patternNode.edges.length === 0) {
        throw new Error(`Union pattern node ${patternNodeId} has no tags`);
      }
      const width = choiceWidth(patternNode.edges.length);
      const tagOrdinal = reader.readBits(width);
      if (tagOrdinal >= patternNode.edges.length) {
        throw new Error(`Choice ${tagOrdinal} is out of range for pattern node ${patternNodeId}`);
      }
      const edge = patternNode.edges[tagOrdinal];
      return new Variant(edge.label, decodeNode(reader, pattern, edge.target));
    }

    default:
      throw new Error(`Unsupported pattern node kind ${patternNode.kind}`);
  }
}

function preparePatternAndValue(value, propertyList) {
  const valuePattern = propertyList || value.pattern;
  const basePattern = valuePattern ? propertyListToPattern(valuePattern) : deriveClosedPatternFromValue(value);
  const coercedValue = valuePattern ? coerceValueForPattern(basePattern, value) : value;
  const refinedPattern = refinePatternForValue(basePattern, coercedValue);
  return { coercedValue, refinedPattern, propertyList: patternToPropertyList(refinedPattern) };
}

function deriveClosedPatternFromValue(value) {
  const nodes = [];

  function visit(node) {
    const nodeId = nodes.length;
    if (node instanceof Product) {
      const placeholder = { kind: NODE_KIND.CLOSED_PRODUCT, edges: [] };
      nodes.push(placeholder);
      const labels = Object.keys(node.product).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
      placeholder.edges = labels.map((label) => ({
        label,
        symbolId: 0,
        target: visit(node.product[label])
      }));
      return nodeId;
    }
    if (node instanceof Variant) {
      const placeholder = { kind: NODE_KIND.OPEN_UNION, edges: [] };
      nodes.push(placeholder);
      placeholder.edges = [{
        label: node.tag,
        symbolId: 0,
        target: visit(node.value)
      }];
      return nodeId;
    }
    throw new Error(`Unsupported runtime value node: ${node?.constructor?.name || typeof node}`);
  }

  visit(value);
  const dictionary = [...new Set(nodes.flatMap((node) => node.edges.map((edge) => edge.label)))]
    .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));

  return {
    dictionary,
    nodes: nodes.map((node) => ({
      kind: node.kind,
      edges: node.edges
        .map((edge) => ({ ...edge, symbolId: symbolIds.get(edge.label) }))
        .sort((a, b) => a.symbolId - b.symbolId)
    }))
  };
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

function listToK(items) {
  let result = new Variant("nil", UNIT);
  for (let i = items.length - 1; i >= 0; i--) {
    result = new Variant("cons", new Product({
      car: items[i],
      cdr: result
    }));
  }
  return result;
}

function listFromK(value, where) {
  const result = [];
  let cursor = value;
  for (;;) {
    const variant = requireVariant(cursor, where);
    if (variant.tag === "nil") return result;
    if (variant.tag !== "cons") {
      throw new Error(`${where}: expected nil or cons, got ${variant.tag}`);
    }
    const product = requireProduct(variant.value, `${where}.cons`);
    result.push(product.car);
    cursor = product.cdr;
  }
}

function bitsToInteger(value, where) {
  let cursor = value;
  let place = 1;
  let result = 0;

  for (;;) {
    const variant = requireVariant(cursor, where);
    if (variant.tag === "_") return result;
    if (variant.tag !== "0" && variant.tag !== "1") {
      throw new Error(`${where}: expected bits tag _, 0, or 1, got ${variant.tag}`);
    }
    if (variant.tag === "1") result += place;
    if (result > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${where}: bits value exceeds safe integer range`);
    }
    place *= 2;
    cursor = variant.value;
  }
}

function integerToBits(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`bits target must be a non-negative safe integer, got ${value}`);
  }
  if (value === 0) return new Variant("_", UNIT);

  const bits = [];
  let n = value;
  while (n > 0) {
    bits.push(n & 1);
    n = Math.floor(n / 2);
  }

  let result = new Variant("_", UNIT);
  for (let i = bits.length - 1; i >= 0; i--) {
    result = new Variant(bits[i] ? "1" : "0", result);
  }
  return result;
}

function edgeToK([label, target]) {
  return new Product({
    label: textToStringValue(label),
    target: integerToBits(target)
  });
}

function edgeFromK(value, where) {
  const product = requireProduct(value, where);
  return [
    stringValueToText(product.label),
    bitsToInteger(product.target, `${where}.target`)
  ];
}

function patternToKValue(propertyList) {
  if (!Array.isArray(propertyList)) {
    throw new Error("Pattern must be a property-list array");
  }
  return listToK(propertyList.map((node, nodeIndex) => {
    if (!Array.isArray(node) || node.length !== 2 || !Array.isArray(node[1])) {
      throw new Error(`Pattern node ${nodeIndex} must be [kind, edges]`);
    }
    const [kind, edges] = node;
    if (kind === "any") {
      return new Variant("any", UNIT);
    }
    return new Variant(kind, listToK(edges.map(edgeToK)));
  }));
}

function patternFromKValue(value) {
  const propertyList = listFromK(value, "pattern").map((node, nodeIndex) => {
    const variant = requireVariant(node, `pattern[${nodeIndex}]`);
    if (variant.tag === "any") {
      return ["any", []];
    }
    if (!["open-product", "open-union", "closed-product", "closed-union"].includes(variant.tag)) {
      throw new Error(`pattern[${nodeIndex}]: unknown pattern-node tag ${variant.tag}`);
    }
    return [
      variant.tag,
      listFromK(variant.value, `pattern[${nodeIndex}].edges`).map((edge, edgeIndex) =>
        edgeFromK(edge, `pattern[${nodeIndex}].edges[${edgeIndex}]`)
      )
    ];
  });
  propertyListToPattern(propertyList);
  return propertyList;
}

function encodeToWire(value, propertyList) {
  const { coercedValue, refinedPattern, propertyList: encodedPattern } = preparePatternAndValue(value, propertyList);
  const writer = new BitWriter();
  encodeNode(writer, patternToKValue(encodedPattern), CORE_PATTERN_PATTERN, 0);
  encodeNode(writer, coercedValue, refinedPattern, 0);
  return writer.toBuffer();
}

function decodeWire(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Wire input must be a Buffer");
  }
  const reader = new BitReader(buffer);
  const patternPropertyList = patternFromKValue(decodeNode(reader, CORE_PATTERN_PATTERN, 0));
  const pattern = propertyListToPattern(patternPropertyList);
  const value = decodeNode(reader, pattern, 0);
  reader.assertZeroPadding();
  return { pattern: patternPropertyList, value: withPattern(value, patternPropertyList) };
}

export {
  encodeToWire,
  decodeWire,
  propertyListToPattern,
  patternToPropertyList,
  choiceWidth,
  CORE_PATTERN_PROPERTY_LIST
};
export default {
  encodeToWire,
  decodeWire,
  propertyListToPattern,
  patternToPropertyList,
  choiceWidth,
  CORE_PATTERN_PROPERTY_LIST
};
