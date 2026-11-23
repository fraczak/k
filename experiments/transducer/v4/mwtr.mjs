/**
 * Exact Worst-Case Throughput Evaluator via Howard's Policy-Improvement Algorithm
 * in Max-Plus Algebra for the Minimum Weight-to-Time Ratio (MWTR) Problem.
 *
 * Implements Section 2 & Section 3 of:
 *   M. Yazdani, W. Fraczak, F. Welfeld, I. Lambadaris,
 *   "A Criterion for Speed Evaluation of Content Inspection Engines"
 *   (ICN/ICONS/MCL 2006, `DOCS/speed-eval.pdf`)
 *   using Howard's policy-improvement algorithm (Cochet-Terrasson et al. 1998).
 *
 * Given a directed graph G = (V, E) where each edge e = (from -> to) has:
 *   - w(e) >= 0: input bits consumed along e
 *   - t(e) >= 0: transition time / memory accesses (table lookups) along e
 * (with t(C) > 0 on every directed cycle C),
 * computes:
 *   rho*(G) = min_{C in G} ( sum_{e in C} w(e) / sum_{e in C} t(e) )
 * together with the exact critical bottleneck cycle C*!
 */

const EPS = 1e-11;

/**
 * Compute exact Minimum Weight-to-Time Ratio `rho*(G)` and critical cycle `C*`.
 *
 * @param {number} numNodes - number of vertices `0 .. numNodes - 1`
 * @param {Array<{from: number, to: number, w: number, t: number, label?: string}>} edges
 * @param {object} [opts]
 * @param {number} [opts.maxIters=200]
 * @returns {{ rho: number, cycleNodes: number[], cycleEdges: object[], iterations: number }}
 */
export function computeMWTR(numNodes, edges, { maxIters = 200 } = {}) {
  // Build adjacency lists and restrict to the maximal subgraph where every node has
  // out-degree >= 1 (sink nodes cannot belong to any directed cycle).
  const out = Array.from({ length: numNodes }, () => []);
  for (const e of edges) {
    out[e.from].push(e);
  }

  // Iteratively prune vertices with out-degree 0
  const alive = new Uint8Array(numNodes).fill(1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let u = 0; u < numNodes; u++) {
      if (!alive[u]) continue;
      let hasAliveOut = false;
      for (const e of out[u]) {
        if (alive[e.to]) { hasAliveOut = true; break; }
      }
      if (!hasAliveOut) {
        alive[u] = 0;
        changed = true;
      }
    }
  }

  const activeNodes = [];
  for (let u = 0; u < numNodes; u++) {
    if (alive[u]) activeNodes.push(u);
  }
  if (activeNodes.length === 0) {
    return { rho: Infinity, cycleNodes: [], cycleEdges: [], iterations: 0 };
  }

  // Filter outgoing edges to alive targets
  const adj = Array.from({ length: numNodes }, () => []);
  for (const u of activeNodes) {
    for (const e of out[u]) {
      if (alive[e.to]) adj[u].push(e);
    }
  }

  // Initial policy: pick edge with minimum immediate ratio w/t (or arbitrary if t==0)
  const policy = new Array(numNodes).fill(null);
  for (const u of activeNodes) {
    let best = adj[u][0];
    let bestScore = best.t > 0 ? best.w / best.t : Infinity;
    for (let i = 1; i < adj[u].length; i++) {
      const e = adj[u][i];
      const sc = e.t > 0 ? e.w / e.t : Infinity;
      if (sc < bestScore) { best = e; bestScore = sc; }
    }
    policy[u] = best;
  }

  const eta = new Float64Array(numNodes);
  const bias = new Float64Array(numNodes);
  const state = new Int8Array(numNodes); // 0=unvisited, 1=visiting, 2=done
  const inCycle = new Uint8Array(numNodes);

  let iterations = 0;
  let lastCycles = [];

  for (let iter = 0; iter < maxIters; iter++) {
    iterations++;
    state.fill(0);
    inCycle.fill(0);
    lastCycles = [];

    // --- Step 1: Policy Evaluation (O(|V|) on the functional graph `policy`) ---
    // Build reverse policy adjacency to propagate `(eta, bias)` from each cycle root!
    const revPolicy = Array.from({ length: numNodes }, () => []);
    for (const u of activeNodes) {
      revPolicy[policy[u].to].push(u);
    }

    const cycleRoots = [];
    for (const start of activeNodes) {
      if (state[start] !== 0) continue;
      const path = [];
      let cur = start;
      while (state[cur] === 0) {
        state[cur] = 1;
        path.push(cur);
        cur = policy[cur].to;
      }
      if (state[cur] === 1) {
        // Found a directed cycle starting at `cur`!
        const cStart = path.indexOf(cur);
        const cNodes = path.slice(cStart);
        let sumW = 0;
        let sumT = 0;
        let root = cNodes[0];
        const cEdges = [];
        for (const u of cNodes) {
          inCycle[u] = 1;
          const e = policy[u];
          cEdges.push(e);
          sumW += e.w;
          sumT += e.t;
          if (u < root) root = u;
        }
        const ratio = sumT > 0 ? sumW / sumT : (sumW === 0 ? 0 : Infinity);
        cycleRoots.push({ root, ratio, cNodes, cEdges });
        lastCycles.push({ ratio, cNodes, cEdges });
      }
      for (const u of path) state[u] = 2;
    }

    // BFS backward along `revPolicy` from each cycle root to compute exact `(eta[u], bias[u])`!
    const visited = new Uint8Array(numNodes);
    for (const { root, ratio } of cycleRoots) {
      eta[root] = ratio;
      bias[root] = 0;
      visited[root] = 1;
      const queue = [root];
      for (let qi = 0; qi < queue.length; qi++) {
        const v = queue[qi];
        for (const u of revPolicy[v]) {
          if (visited[u]) continue;
          visited[u] = 1;
          eta[u] = ratio;
          const e = policy[u];
          bias[u] = e.w - ratio * e.t + bias[v];
          queue.push(u);
        }
      }
    }

    // --- Step 2: Policy Improvement (O(|E|)) ---
    // Phase 2a: Look for any node `u` that can switch to a component with strictly lower `eta[v]`
    let improved = false;
    for (const u of activeNodes) {
      let bestEta = eta[u];
      let bestEdge = null;
      for (const e of adj[u]) {
        if (eta[e.to] < bestEta - EPS) {
          bestEta = eta[e.to];
          bestEdge = e;
        }
      }
      if (bestEdge) {
        policy[u] = bestEdge;
        improved = true;
      }
    }
    if (improved) continue;

    // Phase 2b: Same-eta Bellman bias improvement: `w(e) - eta[u] * t(e) + bias[v] < bias[u]`
    for (const u of activeNodes) {
      let bestVal = bias[u];
      let bestEdge = null;
      for (const e of adj[u]) {
        if (Math.abs(eta[e.to] - eta[u]) > EPS) continue;
        const val = e.w - eta[u] * e.t + bias[e.to];
        if (val < bestVal - EPS) {
          bestVal = val;
          bestEdge = e;
        }
      }
      if (bestEdge) {
        policy[u] = bestEdge;
        improved = true;
      }
    }

    if (!improved) break;
  }

  // Extract global minimum cycle ratio and critical cycle
  let bestCycle = lastCycles[0] || { ratio: Infinity, cNodes: [], cEdges: [] };
  for (const c of lastCycles) {
    if (c.ratio < bestCycle.ratio) bestCycle = c;
  }
  return {
    rho: bestCycle.ratio,
    cycleNodes: bestCycle.cNodes,
    cycleEdges: bestCycle.cEdges,
    iterations
  };
}
