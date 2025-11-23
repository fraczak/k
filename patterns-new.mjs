// New implementation adapter - provides same interface as patterns.mjs
// To use: change import in index.mjs from "./patterns.mjs" to "./patterns-new.mjs"

import { TypeDerivation } from './generated-src/TypeDerivation.mjs';
import codes from './codes.mjs';
import { assignCanonicalNames } from './export.mjs';
import hash from './hash.mjs';

// Adapter to convert old AST format to new format and back
class ASTAdapter {
  constructor(representatives) {
    this.representatives = representatives;
    this.codeRegistry = this.buildCodeRegistry();
  }

  buildCodeRegistry() {
    const registry = new Map();
    // Add all codes from the codes module
    for (const [name, code] of Object.entries(codes.codes || {})) {
      if (code.code === 'product' || code.code === 'union') {
        registry.set(name, {
          type: code.code,
          fields: code[code.code]
        });
      }
    }
    return registry;
  }

  // Main entry point - same signature as old patterns()
  derive(representatives, rels) {
    this.representatives = representatives;
    
    const derivation = new TypeDerivation(this.codeRegistry);
    const program = { rels };
    
    try {
      const result = derivation.derive(program);
      
      // Convert back to old format (attach typePatternGraph and varRefs to rels)
      for (const [name, relDef] of result) {
        rels[name].typePatternGraph = this.convertGraphToOldFormat(relDef.graph);
        rels[name].varRefs = relDef.varRefs;
      }
      
      // Compute relAlias (same as old implementation)
      const relAlias = {};
      for (const [name, relDef] of result) {
        const canonical = this.serializeRelDef(relDef);
        const h = hash(canonical);
        relAlias[name] = h;
      }
      
      return relAlias;
      
    } catch (error) {
      // Re-throw with better context
      throw new Error(`Type derivation failed: ${error.message}`);
    }
  }

  convertGraphToOldFormat(newGraph) {
    // Create a minimal compatible object
    // The old code expects: { patterns, edges, get_pattern(), find(), size() }
    return {
      patterns: {
        nodes: Array.from({ length: newGraph.forest.size() }, (_, i) => {
          const pattern = newGraph.forest.data[i];
          if (!pattern) return { pattern: '(...)' };
          
          if (pattern.isType()) {
            return { pattern: 'type', type: pattern.typeName };
          }
          
          const fields = Array.from(pattern.fields);
          return {
            pattern: this.patternTypeToString(pattern.type),
            fields
          };
        }),
        find: (id) => newGraph.find(id)
      },
      edges: newGraph.edges.map(edgeMap => {
        if (!edgeMap) return {};
        const result = {};
        for (const [label, destSet] of edgeMap) {
          result[label] = Array.from(destSet);
        }
        return result;
      }),
      get_pattern: (id) => {
        const rep = newGraph.find(id);
        return this.patterns.nodes[rep];
      },
      find: (id) => newGraph.find(id),
      size: () => [newGraph.forest.size(), 0]
    };
  }

  patternTypeToString(type) {
    const map = {
      'open-unknown': '(...)',
      'open-product': '{...}',
      'open-union': '<...>',
      'closed-unknown': '()',
      'closed-product': '{}',
      'closed-union': '<>',
      'type': 'type'
    };
    return map[type] || '(...)';
  }

  serializeRelDef(relDef) {
    // Simple serialization for hashing
    const [inId, outId] = relDef.def.patterns;
    const inRep = relDef.graph.find(inId);
    const outRep = relDef.graph.find(outId);
    return JSON.stringify({ in: inRep, out: outRep });
  }
}

function patterns(representatives, rels) {
  const adapter = new ASTAdapter(representatives);
  return adapter.derive(representatives, rels);
}

export default { patterns };
export { patterns };
