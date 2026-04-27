import { Product, Variant } from "../../Value.mjs";

const unit = new Product({});

function listToK(items) {
  let result = new Variant("nil", unit);
  for (let i = items.length - 1; i >= 0; i--) {
    result = new Variant("cons", new Product({
      car: items[i],
      cdr: result
    }));
  }
  return result;
}

function bitToK(value) {
  return new Variant(value ? "1" : "0", unit);
}

function bitsToK(bits) {
  return listToK(bits.map(bitToK));
}

function byteToK(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`byte value must be in 0..255, got ${value}`);
  }
  const product = {};
  for (let bit = 7; bit >= 0; bit--) {
    product[String(bit)] = bitToK((value >> bit) & 1);
  }
  return new Product(product);
}

function bytesToK(buffer) {
  return listToK([...buffer].map(byteToK));
}

function utf8StringToKBytes(text) {
  if (typeof text !== "string") {
    throw new Error(`label must be a string, got ${typeof text}`);
  }
  return bytesToK(Buffer.from(text, "utf8"));
}

function asciiCodePointToKUnicode(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x7f) {
    throw new Error(`only ASCII labels are supported in the bootstrap k string bridge, got U+${codePoint.toString(16)}`);
  }
  const product = {};
  for (let bit = 6; bit >= 0; bit--) {
    product[String(bit)] = bitToK((codePoint >> bit) & 1);
  }
  return new Variant("ascii", new Product(product));
}

function utf8StringToKString(text) {
  if (typeof text !== "string") {
    throw new Error(`label must be a string, got ${typeof text}`);
  }
  const chars = [...text].map((char) => asciiCodePointToKUnicode(char.codePointAt(0)));
  return listToK(chars);
}

function bitBufferToKBits(buffer) {
  const bits = [];
  for (const byte of buffer) {
    for (let bit = 7; bit >= 0; bit--) {
      bits.push(bitToK((byte >> bit) & 1));
    }
  }
  return bitsToK(bits);
}

function binaryTreeToK(leaves) {
  if (leaves.length === 0) {
    throw new Error("binary-tree requires at least one leaf");
  }

  if (leaves.length === 1) {
    return new Variant("leaf", leaves[0]);
  }

  const split = Math.ceil(leaves.length / 2);

  return new Variant("tree", new Product({
    0: binaryTreeToK(leaves.slice(0, split)),
    1: binaryTreeToK(leaves.slice(split))
  }));
}

function assignBinaryTreePaths(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`binary-tree leaf count must be positive, got ${count}`);
  }
  const paths = [];

  function visit(start, length, path) {
    if (length === 1) {
      paths[start] = path;
      return;
    }
    const leftLength = Math.ceil(length / 2);
    visit(start, leftLength, [...path, 0]);
    visit(start + leftLength, length - leftLength, [...path, 1]);
  }

  visit(0, count, []);
  return paths;
}

function labelTargetTreeToK(edges, nodePaths) {
  if (edges.length === 0) {
    return new Variant("empty", unit);
  }
  const leaves = edges.map((edge) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new Error("pattern edge must be [label, target]");
    }
    const [label, target] = edge;
    if (!Number.isInteger(target) || target < 0 || target >= nodePaths.length) {
      throw new Error(`pattern edge target out of range: ${target}`);
    }
    return new Product({
      label: utf8StringToKString(label),
      target: bitsToK(nodePaths[target])
    });
  });
  return binaryTreeToK(leaves);
}

function patternNodeToK(node, nodePaths) {
  if (!Array.isArray(node) || node.length !== 2 || !Array.isArray(node[1])) {
    throw new Error("pattern node must be [kind, edges]");
  }
  const [kind, edges] = node;
  if (typeof kind !== "string") {
    throw new Error(`pattern node kind must be a string, got ${typeof kind}`);
  }
  return kind === "any"
    ? new Variant("any", unit)
    : new Variant(kind, labelTargetTreeToK(edges, nodePaths));
}

function patternPropertyListToK(pattern) {
  if (!Array.isArray(pattern)) {
    throw new Error("pattern must be a property-list array");
  }
  const nodePaths = assignBinaryTreePaths(pattern.length);
  return binaryTreeToK(pattern.map((node) => patternNodeToK(node, nodePaths)));
}

function envelopeToK(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("envelope must be an object");
  }
  if (typeof envelope.value_bits !== "string") {
    throw new Error("envelope.value_bits must be a base64 string");
  }
  return new Product({
    pattern: patternPropertyListToK(envelope.pattern),
    "value-bits": bitBufferToKBits(Buffer.from(envelope.value_bits, "base64"))
  });
}

function objectFileToK({ inputPattern, outputPattern, input }) {
  return new Product({
    "input-pattern": patternPropertyListToK(inputPattern),
    "output-pattern": patternPropertyListToK(outputPattern),
    input: envelopeToK(input)
  });
}

export {
  listToK,
  bitToK,
  bitsToK,
  byteToK,
  bytesToK,
  utf8StringToKBytes,
  utf8StringToKString,
  bitBufferToKBits,
  patternPropertyListToK,
  envelopeToK,
  objectFileToK
};

export default {
  listToK,
  bitToK,
  bitsToK,
  byteToK,
  bytesToK,
  utf8StringToKBytes,
  utf8StringToKString,
  bitBufferToKBits,
  patternPropertyListToK,
  envelopeToK,
  objectFileToK
};
