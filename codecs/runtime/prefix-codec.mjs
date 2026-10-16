import { Value, withPattern, isProduct, isVariant } from "../../Value.mjs";
import {
  refinePatternForValue,
  coerceValueForPattern,
  canonicalizePattern,
  NODE_KIND
} from "./codec.mjs";
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
const UNIT = Value.product({});
const BIT0 = Value.variant("0", UNIT);
const BIT1 = Value.variant("1", UNIT);

class BitWriter {
  constructor(initialCapacity = 4096) {
    this.buffer = new Uint8Array(initialCapacity);
    this.byteLength = 0;
    this.current = 0;
    this.bitCount = 0;
  }

  ensureCapacity(extraBytes) {
    if (this.byteLength + extraBytes > this.buffer.length) {
      const newCap = Math.max(
        this.buffer.length * 2,
        this.byteLength + extraBytes + 1024
      );
      const newBuf = new Uint8Array(newCap);
      newBuf.set(this.buffer.subarray(0, this.byteLength));
      this.buffer = newBuf;
    }
  }

  writeBit(bit) {
    this.current = (this.current << 1) | (bit ? 1 : 0);
    this.bitCount += 1;
    if (this.bitCount === 8) {
      if (this.byteLength >= this.buffer.length) {
        this.ensureCapacity(1);
      }
      this.buffer[this.byteLength++] = this.current;
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
      if (this.byteLength >= this.buffer.length) {
        this.ensureCapacity(1);
      }
      this.buffer[this.byteLength++] =
        this.current << (8 - this.bitCount);
      this.current = 0;
      this.bitCount = 0;
    }
    return Buffer.from(
      this.buffer.buffer,
      this.buffer.byteOffset,
      this.byteLength
    );
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
    if (width === 0) return 0;
    if (width === 1) return this.readBit();
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
  const stack = [{ value, patternNodeId }];

  while (stack.length > 0) {
    const frame = stack.pop();
    const patternNode = pattern.nodes[frame.patternNodeId];
    if (!patternNode) {
      throw new Error(`Unknown pattern node ${frame.patternNodeId}`);
    }

    switch (patternNode.kind) {
      case NODE_KIND.ANY:
        throw new Error("Pattern node 'any' is not directly encodable");

      case NODE_KIND.OPEN_PRODUCT:
      case NODE_KIND.CLOSED_PRODUCT: {
        if (!isProduct(frame.value)) {
          throw new Error(
            `Expected Product for pattern node ${frame.patternNodeId}`
          );
        }
        const p = frame.value.product;
        const edges = patternNode.edges;
        const edgeCount = edges.length;
        if (edgeCount === 0) {
          for (const _ in p) {
            throw new Error(
              `Product fields do not match pattern node ` +
              `${frame.patternNodeId}`
            );
          }
          break;
        }
        for (let i = edgeCount - 1; i >= 0; i--) {
          const edge = edges[i];
          const childVal = p[edge.label];
          if (childVal === undefined) {
            throw new Error(
              `Product fields do not match pattern node ` +
              `${frame.patternNodeId}`
            );
          }
          stack.push({ value: childVal, patternNodeId: edge.target });
        }
        break;
      }

      case NODE_KIND.OPEN_UNION:
      case NODE_KIND.CLOSED_UNION: {
        if (!isVariant(frame.value)) {
          throw new Error(
            `Expected Variant for pattern node ${frame.patternNodeId}`
          );
        }
        const tag = frame.value.tag;
        const edges = patternNode.edges;
        let tagOrdinal = patternNode.tagIndex !== undefined
          ? patternNode.tagIndex[tag]
          : undefined;
        if (tagOrdinal === undefined) {
          tagOrdinal = edges.findIndex((edge) => edge.label === tag);
          if (tagOrdinal === -1) {
            throw new Error(
              `Variant tag '${tag}' is not present in pattern node ` +
              `${frame.patternNodeId}`
            );
          }
        }
        const width = patternNode.choiceBits !== undefined
          ? patternNode.choiceBits
          : choiceWidth(edges.length);
        if (width > 0) {
          writer.writeBits(tagOrdinal, width);
        }
        stack.push({
          value: frame.value.value,
          patternNodeId: edges[tagOrdinal].target
        });
        break;
      }

      default:
        throw new Error(`Unsupported pattern node kind ${patternNode.kind}`);
    }
  }
}

function decodeNode(reader, pattern, rootPatternNodeId) {
  let result;
  const stack = [[rootPatternNodeId, null, null]];

  while (stack.length > 0) {
    const [patternNodeId, parent, key] = stack.pop();
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
        const val = Value.product(product);
        if (parent) {
          parent[key] = val;
        } else {
          result = val;
        }
        const edges = patternNode.edges;
        for (let i = edges.length - 1; i >= 0; i--) {
          const edge = edges[i];
          stack.push([edge.target, product, edge.label]);
        }
        break;
      }

      case NODE_KIND.OPEN_UNION:
      case NODE_KIND.CLOSED_UNION: {
        const edges = patternNode.edges;
        if (edges.length === 0) {
          throw new Error(
            `Union pattern node ${patternNodeId} has no tags`
          );
        }
        const width = patternNode.choiceBits !== undefined
          ? patternNode.choiceBits
          : choiceWidth(edges.length);
        const tagOrdinal = reader.readBits(width);
        if (tagOrdinal >= edges.length) {
          throw new Error(
            `Choice ${tagOrdinal} is out of range for pattern node ` +
            `${patternNodeId}`
          );
        }
        const edge = edges[tagOrdinal];
        const variant = Value.variant(edge.label, undefined);
        if (parent) {
          parent[key] = variant;
        } else {
          result = variant;
        }
        stack.push([edge.target, variant, "value"]);
        break;
      }

      default:
        throw new Error(`Unsupported pattern node kind ${patternNode.kind}`);
    }
  }

  return result;
}

function isClosedPropertyList(propertyList) {
  if (!Array.isArray(propertyList) || propertyList.length === 0) {
    return false;
  }
  for (let i = 0; i < propertyList.length; i++) {
    const kind = propertyList[i]?.[0];
    if (kind !== "closed-product" && kind !== "closed-union") {
      return false;
    }
  }
  return true;
}

function preparePatternAndValue(value, propertyList) {
  const valuePattern = propertyList || value.pattern;
  if (valuePattern && isClosedPropertyList(valuePattern)) {
    const basePattern = propertyListToPattern(valuePattern);
    const canonical = canonicalizePattern(basePattern);
    return {
      coercedValue: value,
      refinedPattern: canonical,
      propertyList: patternToPropertyList(canonical)
    };
  }
  const basePattern = valuePattern
    ? propertyListToPattern(valuePattern)
    : deriveClosedPatternFromValue(value);
  const coercedValue = valuePattern
    ? coerceValueForPattern(basePattern, value)
    : value;
  const refinedPattern = refinePatternForValue(basePattern, coercedValue);
  return {
    coercedValue,
    refinedPattern,
    propertyList: patternToPropertyList(refinedPattern)
  };
}

function deriveClosedPatternFromValue(value) {
  const nodes = [];

  function visit(node) {
    const nodeId = nodes.length;
    if (isProduct(node)) {
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
    if (isVariant(node)) {
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
  if (!isProduct(value)) {
    throw new Error(`${where}: expected Product`);
  }
  return value.product;
}

function requireVariant(value, where) {
  if (!isVariant(value)) {
    throw new Error(`${where}: expected Variant`);
  }
  return value;
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
  if (value === 0) return Value.variant("_", UNIT);

  const bits = [];
  let n = value;
  while (n > 0) {
    bits.push(n & 1);
    n = Math.floor(n / 2);
  }

  let result = Value.variant("_", UNIT);
  for (let i = bits.length - 1; i >= 0; i--) {
    result = Value.variant(bits[i] ? "1" : "0", result);
  }
  return result;
}

function edgeToK([label, target]) {
  return Value.product({
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
      return Value.variant("any", UNIT);
    }
    return Value.variant(kind, listToK(edges.map(edgeToK)));
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

function readBitsAt(buffer, bitOffset, width) {
  if (width === 0) return 0;
  if ((bitOffset + width - 1) >> 3 >= buffer.length) {
    throw new Error("Unexpected end of bitstream");
  }
  if (width === 1) {
    return (buffer[bitOffset >> 3] >> (7 - (bitOffset & 7))) & 1;
  }
  let v = 0;
  for (let i = 0; i < width; i++) {
    const pos = bitOffset + i;
    v = (v << 1) | ((buffer[pos >> 3] >> (7 - (pos & 7))) & 1);
  }
  return v;
}

const SKIP_STACK = new Int32Array(2048);

function fastSkipSubtree(
  buffer,
  startBitOffset,
  pattern,
  rootPatternNodeId
) {
  let bitOffset = startBitOffset;
  let stack = SKIP_STACK;
  stack[0] = rootPatternNodeId;
  let stackPtr = 1;
  const nodes = pattern.nodes;

  while (stackPtr > 0) {
    const nodeId = stack[--stackPtr];
    const node = nodes[nodeId];
    if (
      node.kind === NODE_KIND.CLOSED_PRODUCT ||
      node.kind === NODE_KIND.OPEN_PRODUCT
    ) {
      const edges = node.edges;
      const count = edges.length;
      if (stackPtr + count > stack.length) {
        const newStack = new Int32Array(stack.length * 2);
        newStack.set(stack);
        stack = newStack;
      }
      for (let i = count - 1; i >= 0; i--) {
        stack[stackPtr++] = edges[i].target;
      }
    } else if (
      node.kind === NODE_KIND.CLOSED_UNION ||
      node.kind === NODE_KIND.OPEN_UNION
    ) {
      const edges = node.edges;
      const width = node.choiceBits !== undefined
        ? node.choiceBits
        : choiceWidth(edges.length);
      const tagOrdinal = width > 0
        ? readBitsAt(buffer, bitOffset, width)
        : 0;
      bitOffset += width;
      if (tagOrdinal >= edges.length) {
        throw new Error(
          `Choice ${tagOrdinal} is out of range for pattern ` +
          `node ${nodeId}`
        );
      }
      if (stackPtr >= stack.length) {
        const newStack = new Int32Array(stack.length * 2);
        newStack.set(stack);
        stack = newStack;
      }
      stack[stackPtr++] = edges[tagOrdinal].target;
    }
  }
  return bitOffset;
}

class LazyVariant extends Value {
  constructor(tag, buffer, bitOffset, pattern, targetId) {
    super();
    this.type = "<>";
    this.tag = tag;
    this.pattern = null;
    this._buffer = buffer;
    this._bitOffset = bitOffset;
    this._pattern = pattern;
    this._targetId = targetId;
    Object.defineProperty(this, "value", {
      get: this._resolveValue,
      set: this._setValue,
      enumerable: true,
      configurable: true
    });
  }

  _resolveValue() {
    const val = decodeLazyNode(
      this._buffer,
      this._bitOffset,
      this._pattern,
      this._targetId
    );
    Object.defineProperty(this, "value", {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true
    });
    return val;
  }

  _setValue(v) {
    Object.defineProperty(this, "value", {
      value: v,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
}

function createLazyVariant(buffer, bitOffset, pattern, patternNodeId) {
  const node = pattern.nodes[patternNodeId];
  const edges = node.edges;
  if (edges.length === 0) {
    throw new Error(`Union pattern node ${patternNodeId} has no tags`);
  }
  const width = node.choiceBits !== undefined
    ? node.choiceBits
    : choiceWidth(edges.length);
  const tagOrdinal = width > 0 ? readBitsAt(buffer, bitOffset, width) : 0;
  if (tagOrdinal >= edges.length) {
    throw new Error(
      `Choice ${tagOrdinal} is out of range for pattern ` +
      `node ${patternNodeId}`
    );
  }
  const edge = edges[tagOrdinal];

  // Fast-path: terminal variant whose target is empty product {}
  const targetNode = pattern.nodes[edge.target];
  if (
    targetNode &&
    (targetNode.kind === NODE_KIND.CLOSED_PRODUCT ||
      targetNode.kind === NODE_KIND.OPEN_PRODUCT) &&
    targetNode.edges.length === 0
  ) {
    if (edge.label === "0") return BIT0;
    if (edge.label === "1") return BIT1;
    return Value.variant(edge.label, UNIT);
  }

  return new LazyVariant(
    edge.label,
    buffer,
    bitOffset + width,
    pattern,
    edge.target
  );
}

class LazyConsProduct extends Value {
  constructor(buffer, bitOffset, pattern, carTarget, cdrTarget) {
    super();
    this.type = "{}";
    this.pattern = null;
    let carVal = undefined;
    let cdrVal = undefined;
    let cdrOffset = -1;

    this.product = {
      get car() {
        if (carVal === undefined) {
          carVal = decodeLazyNode(buffer, bitOffset, pattern, carTarget);
        }
        return carVal;
      },
      set car(v) {
        carVal = v;
      },
      get cdr() {
        if (cdrVal === undefined) {
          if (cdrOffset === -1) {
            cdrOffset = fastSkipSubtree(
              buffer,
              bitOffset,
              pattern,
              carTarget
            );
          }
          cdrVal = decodeLazyNode(buffer, cdrOffset, pattern, cdrTarget);
        }
        return cdrVal;
      },
      set cdr(v) {
        cdrVal = v;
      }
    };
  }
}

class LazyGeneralProduct extends Value {
  constructor(buffer, bitOffset, pattern, patternNodeId) {
    super();
    this.type = "{}";
    this.pattern = null;
    const node = pattern.nodes[patternNodeId];
    const edges = node.edges;
    const edgeCount = edges.length;
    const product = {};
    this.product = product;

    const edgeOffsets = new Array(edgeCount);
    edgeOffsets[0] = bitOffset;
    let nextKnownOffsetIndex = 1;

    function ensureOffset(targetIndex) {
      while (nextKnownOffsetIndex <= targetIndex) {
        const prevIdx = nextKnownOffsetIndex - 1;
        const prevStart = edgeOffsets[prevIdx];
        const prevTargetId = edges[prevIdx].target;
        edgeOffsets[nextKnownOffsetIndex] = fastSkipSubtree(
          buffer,
          prevStart,
          pattern,
          prevTargetId
        );
        nextKnownOffsetIndex++;
      }
      return edgeOffsets[targetIndex];
    }

    for (let i = 0; i < edgeCount; i++) {
      const edge = edges[i];
      const edgeIndex = i;
      let cachedVal = undefined;
      let resolved = false;

      Object.defineProperty(product, edge.label, {
        get() {
          if (!resolved) {
            const start = ensureOffset(edgeIndex);
            cachedVal = decodeLazyNode(
              buffer,
              start,
              pattern,
              edge.target
            );
            resolved = true;
          }
          return cachedVal;
        },
        set(v) {
          cachedVal = v;
          resolved = true;
        },
        enumerable: true,
        configurable: true
      });
    }
  }
}

function decodeLazyNode(buffer, bitOffset, pattern, patternNodeId) {
  const node = pattern.nodes[patternNodeId];
  if (!node) {
    throw new Error(`Unknown pattern node ${patternNodeId}`);
  }
  if (
    node.kind === NODE_KIND.CLOSED_PRODUCT ||
    node.kind === NODE_KIND.OPEN_PRODUCT
  ) {
    if (node.edges.length === 0) return UNIT;
    if (
      node.edges.length === 2 &&
      node.edges[0].label === "car" &&
      node.edges[1].label === "cdr"
    ) {
      return new LazyConsProduct(
        buffer,
        bitOffset,
        pattern,
        node.edges[0].target,
        node.edges[1].target
      );
    }
    return new LazyGeneralProduct(
      buffer,
      bitOffset,
      pattern,
      patternNodeId
    );
  }
  return createLazyVariant(buffer, bitOffset, pattern, patternNodeId);
}

function decodeWire(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Wire input must be a Buffer");
  }
  const reader = new BitReader(buffer);
  const patternPropertyList = patternFromKValue(
    decodeNode(reader, CORE_PATTERN_PATTERN, 0)
  );
  const pattern = propertyListToPattern(patternPropertyList);

  if (options.eager) {
    const value = decodeNode(reader, pattern, 0);
    reader.assertZeroPadding();
    return {
      pattern: patternPropertyList,
      value: withPattern(value, patternPropertyList)
    };
  }

  const valBitOffset = reader.byteOffset * 8 + reader.bitOffset;
  const lazyRoot = decodeLazyNode(buffer, valBitOffset, pattern, 0);
  lazyRoot.pattern = patternPropertyList;
  return {
    pattern: patternPropertyList,
    value: withPattern(lazyRoot, patternPropertyList)
  };
}

function decodeWireLazy(buffer) {
  return decodeWire(buffer, { eager: false });
}

export {
  encodeToWire,
  decodeWire,
  decodeWireLazy,
  decodeLazyNode,
  fastSkipSubtree,
  readBitsAt,
  propertyListToPattern,
  patternToPropertyList,
  choiceWidth,
  CORE_PATTERN_PROPERTY_LIST
};
export default {
  encodeToWire,
  decodeWire,
  decodeWireLazy,
  decodeLazyNode,
  fastSkipSubtree,
  readBitsAt,
  propertyListToPattern,
  patternToPropertyList,
  choiceWidth,
  CORE_PATTERN_PROPERTY_LIST
};
