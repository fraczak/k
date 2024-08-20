class Graph {
  constructor(edges, vertices = {}) {
    this.edges = edges;
    this.vertices = vertices;
    for (const dir of ['src', 'dst']) {
      this[dir] = {};
      for (let i=0; i < edges.length; i++) {
        console.log("i",i);
        const e = edges[i];
        if (vertices[e[dir]] == undefined) {
          vertices[e[dir]] = {
            _rem: "discovered"
          };
        }
        if (this[dir][e[dir]] == null) {
          this[dir][e[dir]] = [];
        }
        this[dir][e[dir]].push(i);
      }
    }   
  }
}

function sccs(graph) {
  const stack = [];
  const disc = {};
  const low = {};
  const inStack = {};
  const sccs = [];
  let time = 0;

  const dfs = (u) => {
    disc[u] = low[u] = time++;
    stack.push(u);
    inStack[u] = true;

    for (const e of graph.src[u] || []) {
      const v = graph.edges[e].dst;
      if (disc[v] == undefined) {
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
      } else if (inStack[v]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    }

    if (low[u] === disc[u]) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        inStack[w] = false;
        scc.push(w);
      } while (w !== u);
      sccs.push(scc);
    }
  };

  for (const x in graph.vertices) {
    if (disc[x] == undefined) {
      dfs(x);
    }
  }
  return sccs;
};


export { Graph, sccs };
export default { Graph, sccs };