import { Pattern } from './Pattern.mjs';
import { UnionFind } from './UnionFind.mjs';
import { unifyPatterns } from './Unification.mjs';

export class PatternGraph {
  constructor(codeRegistry = null) {
    this.forest = new UnionFind();
    this.edges = []; // edges[id] = Map<label, Set<id>>
    this.typeCache = new Map(); // typeName -> id
    this.codeRegistry = codeRegistry;
  }

  addNode(pattern, edges = {}) {
    const id = this.forest.makeSet(pattern);
    this.edges[id] = new Map();
    
    for (const [label, destIds] of Object.entries(edges)) {
      this.edges[id].set(label, new Set(destIds.map(d => this.find(d))));
    }
    
    return id;
  }

  find(id) {
    return this.forest.find(id);
  }

  getPattern(id) {
    return this.forest.get(id);
  }

  getEdges(id) {
    const rep = this.find(id);
    return this.edges[rep] || new Map();
  }

  getTypeId(typeName, codeRegistry) {
    if (this.typeCache.has(typeName)) {
      return this.typeCache.get(typeName);
    }
    
    const pattern = Pattern.type(typeName);
    const id = this.addNode(pattern);
    this.typeCache.set(typeName, id);
    
    // Add edges for type fields
    const code = codeRegistry.get(typeName);
    if (code) {
      const constructor = code.type; // 'product' | 'union'
      for (const [label, fieldType] of Object.entries(code.fields)) {
        const targetId = this.getTypeId(fieldType, codeRegistry);
        this.edges[id].set(label, new Set([targetId]));
      }
    }
    
    return id;
  }

  unify(reason, ...ids) {
    if (ids.length <= 1) return;
    
    const reps = [...new Set(ids.map(id => this.find(id)))];
    if (reps.length <= 1) return;
    
    // Get patterns with their fields from edges
    const patterns = reps.map(rep => {
      const pattern = this.getPattern(rep).clone();
      const edges = this.getEdges(rep);
      pattern.fields = new Set([...pattern.fields, ...edges.keys()]);
      return pattern;
    });
    
    // Compute unified pattern
    const unified = unifyPatterns(patterns, reason, this.codeRegistry);
    
    // Create new representative
    const newId = this.addNode(unified);
    this.forest.union(newId, reps);
    
    // Migrate edges
    const newEdges = new Map();
    for (const rep of reps) {
      const edges = this.edges[rep];
      if (!edges) continue;
      
      for (const [label, dests] of edges) {
        if (!newEdges.has(label)) {
          newEdges.set(label, new Set());
        }
        for (const dest of dests) {
          newEdges.get(label).add(this.find(dest));
        }
      }
    }
    this.edges[newId] = newEdges;
    
    // Recursively unify edge destinations
    for (const [label, dests] of newEdges) {
      if (dests.size > 0) {
        this.unify(`${reason}.${label}`, ...dests);
      }
    }
  }

  clone(rootIds, targetGraph = null) {
    const target = targetGraph || new PatternGraph(this.codeRegistry);
    const mapping = new Map();
    const queue = [...rootIds];
    
    // Note: Each pattern node represents a distinct type variable.
    // Even if two patterns have identical structure (e.g., both are (...)),
    // they remain separate unless explicitly unified.
    
    while (queue.length > 0) {
      const id = queue.shift();
      const rep = this.find(id);
      
      if (mapping.has(rep)) {
        mapping.set(id, mapping.get(rep));
        continue;
      }
      
      const pattern = this.getPattern(rep).clone();
      const newId = target.addNode(pattern);
      mapping.set(rep, newId);
      mapping.set(id, newId);
      
      const edges = this.getEdges(rep);
      for (const dests of edges.values()) {
        queue.push(...dests);
      }
    }
    
    // Copy edges with remapped destinations
    for (const [oldId, newId] of mapping) {
      if (oldId !== this.find(oldId)) continue;
      
      const edges = this.getEdges(oldId);
      for (const [label, dests] of edges) {
        target.edges[newId].set(label, 
          new Set([...dests].map(d => mapping.get(this.find(d)))));
      }
    }
    
    return mapping;
  }
}
