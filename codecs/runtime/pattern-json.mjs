const NODE_KIND_TO_NAME = Object.freeze({
  0: "any",
  1: "open-product",
  2: "open-union",
  3: "closed-product",
  4: "closed-union"
});

const NAME_TO_NODE_KIND = Object.freeze(
  Object.fromEntries(Object.entries(NODE_KIND_TO_NAME).map(([kind, name]) => [name, Number(kind)]))
);

function patternToPropertyList(pattern) {
  if (!pattern || !Array.isArray(pattern.nodes)) {
    throw new Error("Pattern must be an object with a nodes array");
  }

  return pattern.nodes.map((node, index) => {
    const kind = NODE_KIND_TO_NAME[node.kind];
    if (!kind) {
      throw new Error(`Unknown pattern node kind ${node.kind} at node ${index}`);
    }
    const edges = (node.edges || []).map((edge) => {
      if (typeof edge.label !== "string") {
        throw new Error(`Pattern node ${index} has an edge without a string label`);
      }
      if (!Number.isInteger(edge.target) || edge.target < 0 || edge.target >= pattern.nodes.length) {
        throw new Error(`Pattern node ${index} has invalid edge target ${edge.target}`);
      }
      return [edge.label, edge.target];
    });
    return [kind, edges];
  });
}

function propertyListToPattern(propertyList) {
  if (!Array.isArray(propertyList)) {
    throw new Error("Pattern property list must be an array");
  }

  const dictionary = [...new Set(propertyList.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) return [];
    return entry[1].map((edge) => edge[0]);
  }))].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  const symbolIds = new Map(dictionary.map((label, index) => [label, index]));

  const nodes = propertyList.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`Pattern node ${index} must be [kind, edges]`);
    }
    const [kindName, rawEdges] = entry;
    const kind = NAME_TO_NODE_KIND[kindName];
    if (kind == null) {
      throw new Error(`Unknown pattern node kind '${kindName}' at node ${index}`);
    }
    if (!Array.isArray(rawEdges)) {
      throw new Error(`Pattern node ${index} edges must be an array`);
    }

    const edges = rawEdges.map((edge, edgeIndex) => {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new Error(`Pattern node ${index} edge ${edgeIndex} must be [label, target]`);
      }
      const [label, target] = edge;
      if (typeof label !== "string") {
        throw new Error(`Pattern node ${index} edge ${edgeIndex} label must be a string`);
      }
      if (!Number.isInteger(target) || target < 0 || target >= propertyList.length) {
        throw new Error(`Pattern node ${index} edge ${edgeIndex} has invalid target ${target}`);
      }
      return { label, target };
    }).sort((a, b) => Buffer.compare(Buffer.from(a.label, "utf8"), Buffer.from(b.label, "utf8")));

    for (let i = 1; i < edges.length; i++) {
      if (edges[i - 1].label === edges[i].label) {
        throw new Error(`Pattern node ${index} has duplicate edge label '${edges[i].label}'`);
      }
    }
    if (kind === NAME_TO_NODE_KIND.any && edges.length > 0) {
      throw new Error("Pattern node 'any' cannot have outgoing edges");
    }

    return {
      kind,
      edges: edges.map((edge) => ({ ...edge, symbolId: symbolIds.get(edge.label) }))
    };
  });

  return {
    dictionary,
    nodes
  };
}

export { patternToPropertyList, propertyListToPattern, NODE_KIND_TO_NAME, NAME_TO_NODE_KIND };
export default { patternToPropertyList, propertyListToPattern, NODE_KIND_TO_NAME, NAME_TO_NODE_KIND };
