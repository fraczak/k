/**
 * K Polymorphic Binary Codec Runtime
 *
 * Version 1 of this runtime uses the self-contained package:
 * - header
 * - dictionary
 * - normalized pattern graph
 * - value DAG relative to pattern-node identity
 *
 * For now, encoders derive a closed singleton pattern from the provided root
 * type. No external type hashes or envelope metadata are required to decode.
 */

import { Product, Variant } from "../../Value.mjs";

const MAGIC = Buffer.from("KPV2", "ascii");
const FORMAT_VERSION = 1;
const HEADER_SIZE = MAGIC.length + 2; // magic + version + flags

const NODE_KIND = Object.freeze({
  ANY: 0,
  OPEN_PRODUCT: 1,
  OPEN_UNION: 2,
  CLOSED_PRODUCT: 3,
  CLOSED_UNION: 4
});

class ByteWriter {
  constructor() {
    this.chunks = [];
  }

  writeByte(value) {
    this.chunks.push(Buffer.from([value & 0xff]));
  }

  writeBytes(buffer) {
    this.chunks.push(Buffer.from(buffer));
  }

  writeUvarint(value) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`uvarint expects non-negative integer, got ${value}`);
    }
    let current = value;
    const bytes = [];
    do {
      let byte = current & 0x7f;
      current = Math.floor(current / 128);
      if (current > 0) byte |= 0x80;
      bytes.push(byte);
    } while (current > 0);
    this.writeBytes(Buffer.from(bytes));
  }

  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

class ByteReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readByte() {
    if (this.offset >= this.buffer.length) {
      throw new Error("Unexpected end of buffer");
    }
    return this.buffer[this.offset++];
  }

  readBytes(length) {
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`Invalid byte length ${length}`);
    }
    const end = this.offset + length;
    if (end > this.buffer.length) {
      throw new Error("Unexpected end of buffer");
    }
    const result = this.buffer.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  readUvarint() {
    let shift = 0;
    let result = 0;
    while (true) {
      const byte = this.readByte();
      result += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7;
      if (shift > 53) {
        throw new Error("uvarint exceeds safe integer range");
      }
    }
  }

  isAtEnd() {
    return this.offset === this.buffer.length;
  }
}

function getNodeKindFromType(typeInfo) {
  switch (typeInfo.code) {
    case "product":
      return NODE_KIND.CLOSED_PRODUCT;
    case "union":
      return NODE_KIND.CLOSED_UNION;
    case "ref":
      throw new Error("Unexpected unresolved ref in closed pattern derivation");
    default:
      throw new Error(`Unsupported type code: ${typeInfo.code}`);
  }
}

function resolveConcreteType(typeInfo, resolveType) {
  if (typeof typeInfo === "string") {
    const resolved = resolveType(typeInfo);
    if (!resolved) throw new Error(`Unknown type: ${typeInfo}`);
    return resolved;
  }
  if (!typeInfo || typeof typeInfo !== "object") {
    throw new Error(`Invalid type info: ${typeInfo}`);
  }
  if (typeInfo.code === "ref") {
    return resolveConcreteType(typeInfo.ref, resolveType);
  }
  return typeInfo;
}

function deriveClosedPattern(rootTypeName, rootTypeInfo, resolveType) {
  const keyToId = new Map();
  const nodes = [];

  function visit(typeName, typeInfo) {
    const key = typeName || JSON.stringify(typeInfo);
    if (keyToId.has(key)) return keyToId.get(key);

    const concrete = resolveConcreteType(typeInfo ?? typeName, resolveType);
    const nodeId = nodes.length;
    keyToId.set(key, nodeId);
    const node = { kind: getNodeKindFromType(concrete), edges: [] };
    nodes.push(node);

    const edgeMap = concrete[concrete.code];
    for (const label of Object.keys(edgeMap).sort()) {
      const refName = edgeMap[label];
      const targetInfo = resolveConcreteType(refName, resolveType);
      const targetId = visit(refName, targetInfo);
      node.edges.push({ label, target: targetId });
    }

    return nodeId;
  }

  visit(rootTypeName, rootTypeInfo);

  const dictionary = [...new Set(nodes.flatMap((node) => node.edges.map((edge) => edge.label)))].sort();
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));

  return {
    dictionary,
    nodes: nodes.map((node) => ({
      kind: node.kind,
      edges: node.edges.map((edge) => ({
        symbolId: symbolIds.get(edge.label),
        label: edge.label,
        target: edge.target
      }))
    }))
  };
}

function exportPatternGraph(typePatternGraph, rootPatternId) {
  const tpg = typePatternGraph;
  const cache = new Map();

  function exportFromType(typeName) {
    const key = `type:${typeName}`;
    if (cache.has(key)) return cache.get(key);

    const typeInfo = tpg.findCode(typeName);
    if (!typeInfo || !typeInfo.code) {
      throw new Error(`Unknown type while exporting pattern graph: ${typeName}`);
    }

    const node = {
      kind: typeInfo.code === "product" ? NODE_KIND.CLOSED_PRODUCT : NODE_KIND.CLOSED_UNION,
      edges: []
    };
    cache.set(key, node);

    const edgeMap = typeInfo[typeInfo.code] || {};
    for (const label of Object.keys(edgeMap).sort()) {
      node.edges.push({ label, target: exportAny(edgeMap[label]) });
    }
    return node;
  }

  function exportFromPattern(patternId) {
    const repId = tpg.find(patternId);
    const key = `pattern:${repId}`;
    if (cache.has(key)) return cache.get(key);

    const pattern = tpg.get_pattern(repId);
    if (!pattern) {
      throw new Error(`Unknown pattern node ${patternId}`);
    }

    if (pattern.pattern === "type") {
      return exportFromType(pattern.type);
    }
    if (pattern.pattern === "()") {
      throw new Error("Pattern node '()' is not supported by the binary format");
    }

    const kind = (() => {
      switch (pattern.pattern) {
        case "(...)": return NODE_KIND.ANY;
        case "{...}": return NODE_KIND.OPEN_PRODUCT;
        case "<...>": return NODE_KIND.OPEN_UNION;
        case "{}": return NODE_KIND.CLOSED_PRODUCT;
        case "<>": return NODE_KIND.CLOSED_UNION;
        default:
          throw new Error(`Unsupported pattern node kind '${pattern.pattern}'`);
      }
    })();

    const node = { kind, edges: [] };
    cache.set(key, node);

    const edgeMap = tpg.edges[repId] || {};
    for (const label of Object.keys(edgeMap).sort()) {
      const dests = Array.from(new Set((edgeMap[label] || []).map((dst) => tpg.find(dst))));
      if (dests.length !== 1) {
        throw new Error(`Pattern edge '${label}' from node ${repId} must have exactly one destination`);
      }
      node.edges.push({ label, target: exportFromPattern(dests[0]) });
    }
    return node;
  }

  function exportAny(ref) {
    if (typeof ref === "string") {
      return exportFromType(ref);
    }
    return exportFromPattern(ref);
  }

  const rootNode = exportFromPattern(rootPatternId);

  const discovered = [];
  const assigned = new Map();
  function assign(node) {
    if (assigned.has(node)) return;
    const id = discovered.length;
    assigned.set(node, id);
    discovered.push(node);
    const edges = [...node.edges].sort((a, b) => Buffer.compare(Buffer.from(a.label, "utf8"), Buffer.from(b.label, "utf8")));
    for (const edge of edges) {
      assign(edge.target);
    }
  }
  assign(rootNode);

  const dictionary = [...new Set(discovered.flatMap((node) => node.edges.map((edge) => edge.label)))].sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  );
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));

  return {
    dictionary,
    nodes: discovered.map((node) => ({
      kind: node.kind,
      edges: [...node.edges]
        .sort((a, b) => symbolIds.get(a.label) - symbolIds.get(b.label))
        .map((edge) => ({
          label: edge.label,
          symbolId: symbolIds.get(edge.label),
          target: assigned.get(edge.target)
        }))
    }))
  };
}

function normalizePattern(pattern) {
  const dictionary = [...new Set(pattern.dictionary)].sort();
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));
  const nodes = pattern.nodes.map((node, index) => {
    const edges = (node.edges || []).map((edge) => {
      const label = edge.label ?? dictionary[edge.symbolId];
      if (label == null) {
        throw new Error(`Pattern node ${index} references unknown symbol`);
      }
      return {
        label,
        symbolId: symbolIds.get(label),
        target: edge.target
      };
    }).sort((a, b) => a.symbolId - b.symbolId);

    for (let i = 1; i < edges.length; i++) {
      if (edges[i - 1].symbolId === edges[i].symbolId) {
        throw new Error(`Duplicate edge label in pattern node ${index}`);
      }
    }

    if (node.kind === NODE_KIND.ANY && edges.length > 0) {
      throw new Error("Pattern node (...) cannot have outgoing edges");
    }

    return { kind: node.kind, edges };
  });

  return { dictionary, nodes };
}

function refinePatternForValue(pattern, value) {
  const base = normalizePattern(pattern);
  const occurrences = new Map();
  const extraEdges = new Map();

  function pushOccurrence(patternNodeId, currentValue) {
    if (!occurrences.has(patternNodeId)) occurrences.set(patternNodeId, []);
    occurrences.get(patternNodeId).push(currentValue);
  }

  function pushExtra(patternNodeId, label, currentValue) {
    if (!extraEdges.has(patternNodeId)) extraEdges.set(patternNodeId, new Map());
    const labelMap = extraEdges.get(patternNodeId);
    if (!labelMap.has(label)) labelMap.set(label, []);
    labelMap.get(label).push(currentValue);
  }

  function collect(patternNodeId, currentValue) {
    const patternNode = base.nodes[patternNodeId];
    if (!patternNode) {
      throw new Error(`Unknown pattern node ${patternNodeId}`);
    }
    pushOccurrence(patternNodeId, currentValue);

    switch (patternNode.kind) {
      case NODE_KIND.ANY:
        return;

      case NODE_KIND.CLOSED_PRODUCT:
      case NODE_KIND.OPEN_PRODUCT: {
        if (!(currentValue instanceof Product)) {
          throw new Error(`Expected Product for pattern node ${patternNodeId}`);
        }
        const actualLabels = Object.keys(currentValue.product).sort();
        const explicit = patternNode.edges.map((edge) => edge.label);
        if (patternNode.kind === NODE_KIND.CLOSED_PRODUCT) {
          if (actualLabels.length !== explicit.length || actualLabels.some((label, idx) => label !== explicit[idx])) {
            throw new Error(`Closed product pattern does not match value fields [${actualLabels.join(", ")}]`);
          }
        } else {
          for (const label of explicit) {
            if (!(label in currentValue.product)) {
              throw new Error(`Open product pattern is missing required field '${label}'`);
            }
          }
        }

        const explicitTargets = new Map(patternNode.edges.map((edge) => [edge.label, edge.target]));
        for (const label of actualLabels) {
          if (explicitTargets.has(label)) {
            collect(explicitTargets.get(label), currentValue.product[label]);
          } else if (patternNode.kind === NODE_KIND.OPEN_PRODUCT) {
            pushExtra(patternNodeId, label, currentValue.product[label]);
          } else {
            throw new Error(`Unexpected extra field '${label}' for closed product pattern`);
          }
        }
        return;
      }

      case NODE_KIND.CLOSED_UNION:
      case NODE_KIND.OPEN_UNION: {
        if (!(currentValue instanceof Variant)) {
          throw new Error(`Expected Variant for pattern node ${patternNodeId}`);
        }
        const explicitTargets = new Map(patternNode.edges.map((edge) => [edge.label, edge.target]));
        if (explicitTargets.has(currentValue.tag)) {
          collect(explicitTargets.get(currentValue.tag), currentValue.value);
          return;
        }
        if (patternNode.kind === NODE_KIND.OPEN_UNION) {
          pushExtra(patternNodeId, currentValue.tag, currentValue.value);
          return;
        }
        throw new Error(`Unexpected variant tag '${currentValue.tag}' for closed union pattern`);
      }

      default:
        throw new Error(`Unknown pattern node kind: ${patternNode.kind}`);
    }
  }

  function sameSortedKeys(values, kindName, getter) {
    if (values.length === 0) return [];
    const expected = getter(values[0]).sort();
    for (let i = 1; i < values.length; i++) {
      const actual = getter(values[i]).sort();
      if (actual.length !== expected.length || actual.some((label, idx) => label !== expected[idx])) {
        throw new Error(`Cannot refine shared ${kindName}: observed incompatible shapes`);
      }
    }
    return expected;
  }

  function synthesizeClosed(values) {
    if (values.length === 0) {
      return { kind: NODE_KIND.ANY, edges: [] };
    }

    const allProducts = values.every((node) => node instanceof Product);
    const allVariants = values.every((node) => node instanceof Variant);
    if (!allProducts && !allVariants) {
      throw new Error("Cannot refine pattern from mixed product/union values");
    }

    if (allProducts) {
      const labels = sameSortedKeys(values, "product pattern", (node) => Object.keys(node.product));
      const node = { kind: NODE_KIND.CLOSED_PRODUCT, edges: [] };
      for (const label of labels) {
        node.edges.push({
          label,
          target: synthesizeClosed(values.map((v) => v.product[label]))
        });
      }
      return node;
    }

    const tagSet = [...new Set(values.map((node) => node.tag))].sort((a, b) =>
      Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
    );
    const node = { kind: NODE_KIND.CLOSED_UNION, edges: [] };
    for (const tag of tagSet) {
      node.edges.push({
        label: tag,
        target: synthesizeClosed(values.filter((v) => v.tag === tag).map((v) => v.value))
      });
    }
    return node;
  }

  collect(0, value);

  const memo = new Map();

  function refineExisting(patternNodeId) {
    if (memo.has(patternNodeId)) return memo.get(patternNodeId);
    const baseNode = base.nodes[patternNodeId];
    const result = { kind: baseNode.kind, edges: [] };
    memo.set(patternNodeId, result);

    if (baseNode.kind === NODE_KIND.ANY) {
      const values = occurrences.get(patternNodeId) || [];
      if (values.length === 0) {
        return result;
      }
      const synthesized = synthesizeClosed(values);
      result.kind = synthesized.kind;
      result.edges = synthesized.edges;
      return result;
    }

    if (baseNode.kind === NODE_KIND.CLOSED_PRODUCT || baseNode.kind === NODE_KIND.OPEN_PRODUCT) {
      const values = occurrences.get(patternNodeId) || [];
      const explicit = new Map(baseNode.edges.map((edge) => [edge.label, edge.target]));
      let labels = [...explicit.keys()].sort();
      if (values.length > 0) {
        const actual = sameSortedKeys(values, "product pattern", (node) => {
          if (!(node instanceof Product)) throw new Error("Expected Product while refining product pattern");
          return Object.keys(node.product);
        });
        if (baseNode.kind === NODE_KIND.CLOSED_PRODUCT) {
          if (actual.length !== labels.length || actual.some((label, idx) => label !== labels[idx])) {
            throw new Error("Closed product pattern does not match observed values");
          }
        } else {
          for (const label of labels) {
            if (!actual.includes(label)) {
              throw new Error(`Open product pattern is missing required field '${label}'`);
            }
          }
          labels = actual;
        }
      }
      result.edges = labels.map((label) => ({
        label,
        target: explicit.has(label)
          ? refineExisting(explicit.get(label))
          : synthesizeClosed((extraEdges.get(patternNodeId)?.get(label)) || [])
      }));
      return result;
    }

    if (baseNode.kind === NODE_KIND.CLOSED_UNION || baseNode.kind === NODE_KIND.OPEN_UNION) {
      const values = occurrences.get(patternNodeId) || [];
      const explicit = new Map(baseNode.edges.map((edge) => [edge.label, edge.target]));
      let tags = [...explicit.keys()].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
      if (values.length > 0) {
        const observed = [...new Set(values.map((node) => {
          if (!(node instanceof Variant)) throw new Error("Expected Variant while refining union pattern");
          return node.tag;
        }))].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
        if (baseNode.kind === NODE_KIND.CLOSED_UNION) {
          for (const tag of observed) {
            if (!explicit.has(tag)) {
              throw new Error(`Closed union pattern does not match observed tag '${tag}'`);
            }
          }
        } else {
          tags = [...new Set([...tags, ...observed])].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
        }
      }
      result.edges = tags.map((label) => ({
        label,
        target: explicit.has(label)
          ? refineExisting(explicit.get(label))
          : synthesizeClosed((extraEdges.get(patternNodeId)?.get(label)) || [])
      }));
      return result;
    }

    throw new Error(`Unknown pattern node kind: ${baseNode.kind}`);
  }

  const root = refineExisting(0);

  const discovered = [];
  const assigned = new Map();
  function assign(node) {
    if (assigned.has(node)) return;
    const id = discovered.length;
    assigned.set(node, id);
    discovered.push(node);
    const edges = [...(node.edges || [])].sort((a, b) => Buffer.compare(Buffer.from(a.label, "utf8"), Buffer.from(b.label, "utf8")));
    for (const edge of edges) {
      assign(edge.target);
    }
  }
  assign(root);

  const dictionary = [...new Set(discovered.flatMap((node) => (node.edges || []).map((edge) => edge.label)))].sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  );
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));

  return {
    dictionary,
    nodes: discovered.map((node) => ({
      kind: node.kind,
      edges: [...(node.edges || [])]
        .sort((a, b) => symbolIds.get(a.label) - symbolIds.get(b.label))
        .map((edge) => ({
          label: edge.label,
          symbolId: symbolIds.get(edge.label),
          target: assigned.get(edge.target)
        }))
    }))
  };
}

function encodeStringTable(writer, dictionary) {
  writer.writeUvarint(dictionary.length);
  for (const entry of dictionary) {
    const bytes = Buffer.from(entry, "utf8");
    writer.writeUvarint(bytes.length);
    writer.writeBytes(bytes);
  }
}

function decodeStringTable(reader) {
  const count = reader.readUvarint();
  const dictionary = [];
  for (let i = 0; i < count; i++) {
    const length = reader.readUvarint();
    dictionary.push(reader.readBytes(length).toString("utf8"));
  }
  for (let i = 1; i < dictionary.length; i++) {
    if (Buffer.compare(Buffer.from(dictionary[i - 1], "utf8"), Buffer.from(dictionary[i], "utf8")) >= 0) {
      throw new Error("Dictionary must be sorted and unique");
    }
  }
  return dictionary;
}

function encodePatternSection(writer, pattern) {
  writer.writeUvarint(pattern.nodes.length);
  for (const node of pattern.nodes) {
    writer.writeByte(node.kind);
    writer.writeUvarint(node.edges.length);
    for (const edge of node.edges) {
      writer.writeUvarint(edge.symbolId);
      writer.writeUvarint(edge.target);
    }
  }
}

function decodePatternSection(reader, dictionary) {
  const count = reader.readUvarint();
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const kind = reader.readByte();
    const edgeCount = reader.readUvarint();
    const edges = [];
    let prev = -1;
    for (let j = 0; j < edgeCount; j++) {
      const symbolId = reader.readUvarint();
      const target = reader.readUvarint();
      if (symbolId < 0 || symbolId >= dictionary.length) {
        throw new Error(`Pattern node ${i} references unknown symbol ID ${symbolId}`);
      }
      if (symbolId <= prev) {
        throw new Error(`Pattern node ${i} edges must be strictly sorted by symbol ID`);
      }
      prev = symbolId;
      edges.push({ symbolId, label: dictionary[symbolId], target });
    }
    nodes.push({ kind, edges });
  }

  if (nodes.length === 0) {
    throw new Error("Pattern graph must contain a root node");
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === NODE_KIND.ANY && node.edges.length > 0) {
      throw new Error("Pattern node (...) cannot have outgoing edges");
    }
    for (const edge of node.edges) {
      if (edge.target < 0 || edge.target >= nodes.length) {
        throw new Error(`Pattern node ${i} references invalid target ${edge.target}`);
      }
    }
  }

  return { dictionary, nodes };
}

function assertProductValue(value, patternNode) {
  if (!(value instanceof Product)) {
    throw new Error(`Expected Product for pattern node kind ${patternNode.kind}, got ${value?.constructor?.name}`);
  }
  const expected = patternNode.edges.map((edge) => edge.label);
  const actual = Object.keys(value.product).sort();
  if (expected.length !== actual.length) {
    throw new Error(`Product field mismatch. Expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) {
      throw new Error(`Product field mismatch. Expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
    }
  }
}

function encodeValueSection(writer, value, pattern) {
  const valueNodes = [];
  const memo = new Map();

  function visit(currentValue, patternNodeId) {
    const patternNode = pattern.nodes[patternNodeId];
    if (!patternNode) {
      throw new Error(`Unknown pattern node ${patternNodeId}`);
    }

    switch (patternNode.kind) {
      case NODE_KIND.ANY:
        throw new Error("Values under pattern node (...) are not encodable in version 1");

      case NODE_KIND.CLOSED_PRODUCT:
      case NODE_KIND.OPEN_PRODUCT: {
        assertProductValue(currentValue, patternNode);
        const childIds = patternNode.edges.map((edge) => visit(currentValue.product[edge.label], edge.target));
        const key = `P:${patternNodeId}:${childIds.join(",")}`;
        if (memo.has(key)) return memo.get(key);
        const nodeId = valueNodes.length;
        valueNodes.push({ patternNodeId, body: { childIds } });
        memo.set(key, nodeId);
        return nodeId;
      }

      case NODE_KIND.CLOSED_UNION:
      case NODE_KIND.OPEN_UNION: {
        if (!(currentValue instanceof Variant)) {
          throw new Error(`Expected Variant for pattern node kind ${patternNode.kind}, got ${currentValue?.constructor?.name}`);
        }
        if (patternNode.edges.length === 0) {
          throw new Error("Cannot encode value for empty union pattern node <>");
        }
        const tagOrdinal = patternNode.edges.findIndex((edge) => edge.label === currentValue.tag);
        if (tagOrdinal === -1) {
          throw new Error(`Variant tag ${currentValue.tag} is not present in the pattern node`);
        }
        const childId = visit(currentValue.value, patternNode.edges[tagOrdinal].target);
        const key = `U:${patternNodeId}:${tagOrdinal}:${childId}`;
        if (memo.has(key)) return memo.get(key);
        const nodeId = valueNodes.length;
        valueNodes.push({ patternNodeId, body: { tagOrdinal, childId } });
        memo.set(key, nodeId);
        return nodeId;
      }

      default:
        throw new Error(`Unknown pattern node kind: ${patternNode.kind}`);
    }
  }

  const rootId = visit(value, 0);
  if (rootId !== valueNodes.length - 1) {
    throw new Error("Internal error: root value node must be emitted last");
  }

  writer.writeUvarint(valueNodes.length);
  for (let i = 0; i < valueNodes.length; i++) {
    const node = valueNodes[i];
    const patternNode = pattern.nodes[node.patternNodeId];
    writer.writeUvarint(node.patternNodeId);
    switch (patternNode.kind) {
      case NODE_KIND.CLOSED_PRODUCT:
      case NODE_KIND.OPEN_PRODUCT:
        for (const childId of node.body.childIds) {
          writer.writeUvarint(i - 1 - childId);
        }
        break;
      case NODE_KIND.CLOSED_UNION:
      case NODE_KIND.OPEN_UNION:
        writer.writeUvarint(node.body.tagOrdinal);
        writer.writeUvarint(i - 1 - node.body.childId);
        break;
      default:
        throw new Error(`Unexpected pattern node kind in value section: ${patternNode.kind}`);
    }
  }
}

function decodeValueSection(reader, pattern, { debug = false } = {}) {
  const count = reader.readUvarint();
  const values = [];
  const patternNodeIds = [];
  const valueNodes = [];
  for (let i = 0; i < count; i++) {
    const patternNodeId = reader.readUvarint();
    if (patternNodeId < 0 || patternNodeId >= pattern.nodes.length) {
      throw new Error(`Value node ${i} references invalid pattern node ${patternNodeId}`);
    }
    const patternNode = pattern.nodes[patternNodeId];

    switch (patternNode.kind) {
      case NODE_KIND.ANY:
        throw new Error("Value nodes cannot reference pattern node (...)");

      case NODE_KIND.CLOSED_PRODUCT:
      case NODE_KIND.OPEN_PRODUCT: {
        const product = {};
        const childIds = [];
        for (const edge of patternNode.edges) {
          const childRef = reader.readUvarint();
          const childId = i - 1 - childRef;
          if (childId < 0 || childId >= i) {
            throw new Error(`Invalid child reference ${childRef} in product value node ${i}`);
          }
          childIds.push(childId);
          product[edge.label] = values[childId];
        }
        patternNodeIds.push(patternNodeId);
        values.push(new Product(product));
        if (debug) {
          valueNodes.push({
            id: i,
            patternNodeId,
            kind: "product",
            children: childIds
          });
        }
        break;
      }

      case NODE_KIND.CLOSED_UNION:
      case NODE_KIND.OPEN_UNION: {
        if (patternNode.edges.length === 0) {
          throw new Error("Value nodes cannot reference empty union pattern node <>");
        }
        const tagOrdinal = reader.readUvarint();
        if (tagOrdinal < 0 || tagOrdinal >= patternNode.edges.length) {
          throw new Error(`Invalid tag ordinal ${tagOrdinal} in union value node ${i}`);
        }
        const childRef = reader.readUvarint();
        const childId = i - 1 - childRef;
        if (childId < 0 || childId >= i) {
          throw new Error(`Invalid child reference ${childRef} in union value node ${i}`);
        }
        patternNodeIds.push(patternNodeId);
        values.push(new Variant(patternNode.edges[tagOrdinal].label, values[childId]));
        if (debug) {
          valueNodes.push({
            id: i,
            patternNodeId,
            kind: "union",
            tagOrdinal,
            child: childId
          });
        }
        break;
      }

      default:
        throw new Error(`Unknown pattern node kind: ${patternNode.kind}`);
    }
  }

  if (values.length === 0) {
    throw new Error("Value DAG must contain at least one node");
  }
  if (patternNodeIds[patternNodeIds.length - 1] !== 0) {
    throw new Error("Root value node must reference root pattern node 0");
  }

  const result = { value: values[values.length - 1] };
  if (debug) {
    result.valueDag = {
      root: values.length - 1,
      nodes: valueNodes
    };
  }
  return result;
}

function encode(value, typeName, typeInfo, resolveType) {
  if (typeof resolveType !== "function") {
    throw new Error("Encoding requires a type resolver");
  }

  const rootTypeInfo = resolveConcreteType(typeInfo ?? typeName, resolveType);
  const pattern = deriveClosedPattern(typeName, rootTypeInfo, resolveType);
  const writer = new ByteWriter();

  writer.writeBytes(MAGIC);
  writer.writeByte(FORMAT_VERSION);
  writer.writeByte(0); // flags reserved in v1

  encodeStringTable(writer, pattern.dictionary);
  encodePatternSection(writer, pattern);
  encodeValueSection(writer, value, pattern);

  return writer.toBuffer();
}

function encodeWithPattern(value, pattern) {
  const normalizedPattern = refinePatternForValue(pattern, value);
  const writer = new ByteWriter();

  writer.writeBytes(MAGIC);
  writer.writeByte(FORMAT_VERSION);
  writer.writeByte(0);

  encodeStringTable(writer, normalizedPattern.dictionary);
  encodePatternSection(writer, normalizedPattern);
  encodeValueSection(writer, value, normalizedPattern);

  return writer.toBuffer();
}

function decode(buffer, _resolveType = null) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Decode input must be a Buffer");
  }
  if (buffer.length < HEADER_SIZE) {
    throw new Error("Buffer too short for package header");
  }

  const reader = new ByteReader(buffer);
  const magic = reader.readBytes(MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error(`Invalid package magic. Expected ${MAGIC.toString("ascii")}`);
  }
  const version = reader.readByte();
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported package format version ${version}`);
  }
  const flags = reader.readByte();
  if (flags !== 0) {
    throw new Error(`Unsupported package flags ${flags}`);
  }

  const dictionary = decodeStringTable(reader);
  const pattern = decodePatternSection(reader, dictionary);
  const { value } = decodeValueSection(reader, pattern);

  if (!reader.isAtEnd()) {
    throw new Error("Trailing bytes after value section");
  }

  return { pattern, value };
}

function decodeDebug(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Decode input must be a Buffer");
  }
  if (buffer.length < HEADER_SIZE) {
    throw new Error("Buffer too short for package header");
  }

  const reader = new ByteReader(buffer);
  const magic = reader.readBytes(MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error(`Invalid package magic. Expected ${MAGIC.toString("ascii")}`);
  }
  const version = reader.readByte();
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported package format version ${version}`);
  }
  const flags = reader.readByte();
  if (flags !== 0) {
    throw new Error(`Unsupported package flags ${flags}`);
  }

  const dictionary = decodeStringTable(reader);
  const pattern = decodePatternSection(reader, dictionary);
  const { value, valueDag } = decodeValueSection(reader, pattern, { debug: true });

  if (!reader.isAtEnd()) {
    throw new Error("Trailing bytes after value section");
  }

  return { pattern, value, valueDag };
}

export { encode, encodeWithPattern, decode, decodeDebug, deriveClosedPattern, exportPatternGraph, refinePatternForValue, NODE_KIND };
export default { encode, encodeWithPattern, decode, decodeDebug, deriveClosedPattern, exportPatternGraph, refinePatternForValue, NODE_KIND };
