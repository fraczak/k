/**
 * K pattern graph runtime helpers.
 */

import { Product, Variant } from "../../Value.mjs";

const NODE_KIND = Object.freeze({
  ANY: 0,
  OPEN_PRODUCT: 1,
  OPEN_UNION: 2,
  CLOSED_PRODUCT: 3,
  CLOSED_UNION: 4
});

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

  return collapseClosedNodes({
    dictionary,
    nodes: nodes.map((node) => ({
      kind: node.kind,
      edges: node.edges.map((edge) => ({
        symbolId: symbolIds.get(edge.label),
        label: edge.label,
        target: edge.target
      }))
    }))
  });
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

  return collapseClosedNodes({
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
  });
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

function collapseClosedNodes(pattern) {
  const base = normalizePattern(pattern);
  const { nodes } = base;
  const representative = nodes.map((_, index) => index);
  const state = new Array(nodes.length).fill("unseen");
  const cyclic = new Array(nodes.length).fill(false);
  const stack = [];
  const stackIndex = new Map();
  const canonicalClosed = new Map();

  // Collapse finite closed subtrees from the leaves up. Open nodes keep identity,
  // and recursive closed nodes are preserved because they are not value-tree leaves.
  function closedKey(node) {
    return JSON.stringify([
      node.kind,
      node.edges.map((edge) => [edge.label, representative[edge.target]])
    ]);
  }

  function visit(nodeId) {
    if (state[nodeId] === "done") return representative[nodeId];
    if (state[nodeId] === "visiting") {
      const cycleStart = stackIndex.get(nodeId);
      if (cycleStart != null) {
        for (let i = cycleStart; i < stack.length; i++) {
          cyclic[stack[i]] = true;
        }
      }
      return nodeId;
    }

    state[nodeId] = "visiting";
    stackIndex.set(nodeId, stack.length);
    stack.push(nodeId);
    const node = nodes[nodeId];
    for (const edge of node.edges) {
      visit(edge.target);
    }
    stack.pop();
    stackIndex.delete(nodeId);

    if ((node.kind === NODE_KIND.CLOSED_PRODUCT || node.kind === NODE_KIND.CLOSED_UNION) && !cyclic[nodeId]) {
      const key = closedKey(node);
      if (canonicalClosed.has(key)) {
        representative[nodeId] = canonicalClosed.get(key);
      } else {
        canonicalClosed.set(key, nodeId);
      }
    }

    state[nodeId] = "done";
    return representative[nodeId];
  }

  visit(0);

  const discovered = [];
  const assigned = new Map();

  function assign(oldNodeId) {
    const repId = representative[oldNodeId];
    if (assigned.has(repId)) return assigned.get(repId);

    const newNodeId = discovered.length;
    assigned.set(repId, newNodeId);
    const node = nodes[repId];
    const newNode = { kind: node.kind, edges: [] };
    discovered.push(newNode);
    newNode.edges = node.edges.map((edge) => ({
      label: edge.label,
      target: assign(edge.target)
    }));
    return newNodeId;
  }

  assign(0);

  const dictionary = [...new Set(discovered.flatMap((node) => node.edges.map((edge) => edge.label)))].sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  );
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));

  return {
    dictionary,
    nodes: discovered.map((node) => ({
      kind: node.kind,
      edges: node.edges
        .map((edge) => ({
          label: edge.label,
          symbolId: symbolIds.get(edge.label),
          target: edge.target
        }))
        .sort((a, b) => a.symbolId - b.symbolId)
    }))
  };
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
    const node = { kind: NODE_KIND.OPEN_UNION, edges: [] };
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

  return collapseClosedNodes({
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
  });
}

function coerceValueForPattern(pattern, value) {
  const base = normalizePattern(pattern);

  function coerce(patternNodeId, currentValue) {
    const patternNode = base.nodes[patternNodeId];
    if (!patternNode) {
      throw new Error(`Unknown pattern node ${patternNodeId}`);
    }

    switch (patternNode.kind) {
      case NODE_KIND.ANY:
        return currentValue;

      case NODE_KIND.CLOSED_PRODUCT:
      case NODE_KIND.OPEN_PRODUCT: {
        let productValue = currentValue;
        if (currentValue instanceof Variant) {
          productValue = new Product({ [currentValue.tag]: currentValue.value });
        }
        if (!(productValue instanceof Product)) {
          throw new Error(`Expected Product for pattern node ${patternNodeId}`);
        }

        const explicitTargets = new Map(patternNode.edges.map((edge) => [edge.label, edge.target]));
        const product = {};
        for (const [label, childValue] of Object.entries(productValue.product)) {
          product[label] = explicitTargets.has(label)
            ? coerce(explicitTargets.get(label), childValue)
            : childValue;
        }
        return new Product(product);
      }

      case NODE_KIND.CLOSED_UNION:
      case NODE_KIND.OPEN_UNION: {
        if (!(currentValue instanceof Variant)) {
          throw new Error(`Expected Variant for pattern node ${patternNodeId}`);
        }
        const target = patternNode.edges.find((edge) => edge.label === currentValue.tag)?.target;
        return new Variant(
          currentValue.tag,
          target == null ? currentValue.value : coerce(target, currentValue.value)
        );
      }

      default:
        throw new Error(`Unknown pattern node kind: ${patternNode.kind}`);
    }
  }

  return coerce(0, value);
}

export { deriveClosedPattern, exportPatternGraph, refinePatternForValue, coerceValueForPattern, NODE_KIND };
export default { deriveClosedPattern, exportPatternGraph, refinePatternForValue, coerceValueForPattern, NODE_KIND };
