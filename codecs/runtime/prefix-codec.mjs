import { Product, Variant } from "../../Value.mjs";
import { refinePatternForValue, coerceValueForPattern, NODE_KIND } from "./codec.mjs";
import { patternToPropertyList, propertyListToPattern } from "./pattern-json.mjs";

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

function encodeToEnvelope(value, propertyList) {
  const basePattern = propertyList ? propertyListToPattern(propertyList) : deriveClosedPatternFromValue(value);
  const coercedValue = propertyList ? coerceValueForPattern(basePattern, value) : value;
  const refinedPattern = refinePatternForValue(basePattern, coercedValue);
  const writer = new BitWriter();
  encodeNode(writer, coercedValue, refinedPattern, 0);
  return {
    pattern: patternToPropertyList(refinedPattern),
    value_bits: writer.toBuffer().toString("base64")
  };
}

function decodeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Envelope must be an object");
  }
  const pattern = propertyListToPattern(envelope.pattern);
  if (typeof envelope.value_bits !== "string") {
    throw new Error("Envelope value_bits must be a string");
  }
  const reader = new BitReader(Buffer.from(envelope.value_bits, "base64"));
  const value = decodeNode(reader, pattern, 0);
  reader.assertZeroPadding();
  return { pattern: envelope.pattern, value };
}

export { encodeToEnvelope, decodeEnvelope, propertyListToPattern, patternToPropertyList, choiceWidth };
export default { encodeToEnvelope, decodeEnvelope, propertyListToPattern, patternToPropertyList, choiceWidth };
