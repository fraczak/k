// Tarjan's algorithm for strongly connected components

export function computeSCCs(edges, vertices) {
  const graph = new Map();
  for (const v of vertices) {
    graph.set(v, []);
  }
  for (const { from, to } of edges) {
    if (graph.has(from)) {
      graph.get(from).push(to);
    }
  }
  
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let currentIndex = 0;
  
  function strongConnect(v) {
    index.set(v, currentIndex);
    lowlink.set(v, currentIndex);
    currentIndex++;
    stack.push(v);
    onStack.add(v);
    
    for (const w of graph.get(v) || []) {
      if (!index.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
      }
    }
    
    if (lowlink.get(v) === index.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }
  
  for (const v of vertices) {
    if (!index.has(v)) {
      strongConnect(v);
    }
  }
  
  return sccs;
}

export function topologicalSort(sccs) {
  // SCCs are already in reverse topological order from Tarjan's algorithm
  return sccs.reverse();
}
