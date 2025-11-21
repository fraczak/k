import { TypeDerivation } from './generated-src/TypeDerivation.mjs';
import codes from './codes.mjs';
import hash from './hash.mjs';

function patterns(representatives, rels) {
  const codeRegistry = new Map();
  
  // Build code registry using only representative (canonical) names
  // This ensures type identity is based on the codes module
  const repNames = new Set(Object.values(representatives));
  for (const repName of repNames) {
    const codeDef = codes.find(repName);
    if (codeDef.code === 'product' || codeDef.code === 'union') {
      codeRegistry.set(repName, {
        type: codeDef.code,
        fields: codeDef[codeDef.code]
      });
    }
  }
  
  const derivation = new TypeDerivation(codeRegistry, representatives);
  const program = { rels };
  
  const relDefs = derivation.derive(program);
  
  // Attach results to rels for compatibility
  for (const [name, relDef] of relDefs) {
    rels[name].typePatternGraph = convertToOldFormat(relDef.graph);
    rels[name].varRefs = relDef.varRefs;
  }
  
  // Compute relAlias
  const relAlias = {};
  for (const [name, relDef] of relDefs) {
    relAlias[name] = hash(serializeRelDef(relDef));
  }
  
  return relAlias;
}

function convertToOldFormat(graph) {
  const nodes = [];
  const edges = [];
  
  for (let i = 0; i < graph.forest.size(); i++) {
    const pattern = graph.forest.data[i];
    
    if (!pattern) {
      nodes.push({ pattern: '(...)' });
      edges.push({});
      continue;
    }
    
    if (pattern.isType()) {
      nodes.push({ pattern: 'type', type: pattern.typeName });
    } else {
      nodes.push({
        pattern: patternTypeToString(pattern.type),
        fields: Array.from(pattern.fields)
      });
    }
    
    const edgeMap = graph.edges[i];
    if (edgeMap) {
      const oldEdges = {};
      for (const [label, destSet] of edgeMap) {
        oldEdges[label] = Array.from(destSet);
      }
      edges.push(oldEdges);
    } else {
      edges.push({});
    }
  }
  
  return {
    patterns: {
      nodes,
      parent: graph.forest.parent,
      find: (id) => graph.find(id)
    },
    edges,
    get_pattern: (id) => nodes[graph.find(id)],
    find: (id) => graph.find(id),
    size: () => [nodes.length, nodes.filter(n => n.pattern === 'type').length]
  };
}

function patternTypeToString(type) {
  const map = {
    'open-unknown': '(...)',
    'open-product': '{...}',
    'open-union': '<...>',
    'closed-unknown': '()',
    'closed-product': '{}',
    'closed-union': '<>',
  };
  return map[type] || '(...)';
}

function serializeRelDef(relDef) {
  const [inId, outId] = relDef.def.patterns;
  return JSON.stringify({
    in: relDef.graph.find(inId),
    out: relDef.graph.find(outId)
  });
}

export default { patterns };
export { patterns };
