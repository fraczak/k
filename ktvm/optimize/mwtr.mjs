/**
 * Exact Worst-Case Throughput Evaluator (Howard's Policy-Improvement MWTR)
 * and Global L1 Table Budget Allocator for `kTVM`.
 *
 * Implements DOCS/KTVM_SPEC.md §6.2:
 *   - Howard's policy-improvement algorithm in Max-Plus algebra computing:
 *       rho*(G) = min_{C in G} ( sum_{e in C} w(e) / sum_{e in C} t(e) )
 *     where w(e) = input bits shifted along transition e, t(e) = table lookups.
 *   - Global L1 budget allocator (default 65,536 bytes = 64 KB) choosing the
 *     highest-MWTR table configuration per kernel within the memory budget,
 *     gracefully falling back to un-chunked kernel CFG when over budget or
 *     on wide alphabets.
 */

const EPS = 1e-11;

export const DEFAULT_L1_BUDGET_BYTES = 65536; // 64 KB L1-resident default

/**
 * Compute exact Minimum Weight-to-Time Ratio `rho*(G)` and critical bottleneck
 * cycle `C*` via Howard's policy-improvement algorithm.
 *
 * @param {number} numNodes
 * @param {Array<{from: number, to: number, w: number, t: number, label?: string}>} edges
 * @param {{ maxIters?: number }} [opts]
 * @returns {{ rho: number, cycleNodes: number[], cycleEdges: object[], iterations: number }}
 */
export function computeMWTR(numNodes, edges, { maxIters = 200 } = {}) {
  const out = Array.from({ length: numNodes }, () => []);
  for (const e of edges) {
    out[e.from].push(e);
  }

  // Prune vertices with out-degree 0 (cannot lie on any directed cycle)
  const alive = new Uint8Array(numNodes).fill(1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let u = 0; u < numNodes; u++) {
      if (!alive[u]) continue;
      let hasAliveOut = false;
      for (const e of out[u]) {
        if (alive[e.to]) {
          hasAliveOut = true;
          break;
        }
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

  const adj = Array.from({ length: numNodes }, () => []);
  for (const u of activeNodes) {
    for (const e of out[u]) {
      if (alive[e.to]) adj[u].push(e);
    }
  }

  // Initial policy: pick minimum local ratio w / t per vertex
  const policy = new Array(numNodes).fill(null);
  for (const u of activeNodes) {
    let best = adj[u][0];
    let bestScore = best.t > 0 ? best.w / best.t : Infinity;
    for (let i = 1; i < adj[u].length; i++) {
      const e = adj[u][i];
      const sc = e.t > 0 ? e.w / e.t : Infinity;
      if (sc < bestScore) {
        best = e;
        bestScore = sc;
      }
    }
    policy[u] = best;
  }

  const eta = new Float64Array(numNodes);
  const bias = new Float64Array(numNodes);
  const state = new Int8Array(numNodes);
  let iterations = 0;
  let lastCycles = [];

  for (let iter = 0; iter < maxIters; iter++) {
    iterations++;
    state.fill(0);
    lastCycles = [];

    const revPolicy = Array.from({ length: numNodes }, () => []);
    for (const u of activeNodes) {
      revPolicy[policy[u].to].push(u);
    }

    // Step 1: Policy evaluation on the functional graph `policy`
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
        const cStart = path.indexOf(cur);
        const cNodes = path.slice(cStart);
        let sumW = 0;
        let sumT = 0;
        let root = cNodes[0];
        const cEdges = [];
        for (const u of cNodes) {
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

    // Propagate `(eta, bias)` backwards from each cycle root
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

    // Step 2: Policy improvement
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

/**
 * Classify table byte footprint into cache-residency classes.
 */
export function budgetClassForBytes(bytes) {
  if (bytes <= 16384) return "L1-small";
  if (bytes <= 65536) return "L1";
  if (bytes <= 262144) return "L2";
  return "L3";
}

/**
 * Global L1 budget allocator across multiple kernels.
 *
 * Each item in `kernelFrontiers` is `{ kernelName, candidates }` where each
 * candidate has `{ bytes, rho, score?, ... }` sorted from smallest to largest
 * byte footprint (Pareto-pruned to strictly increasing `rho`).
 *
 * Greedy marginal-gain knapsack (`delta_rho / delta_bytes`) starts every kernel
 * at "no table" (0 bytes, un-chunked CFG fallback) and upgrades the kernel with
 * the best marginal throughput-per-byte gain until `budgetBytes` is exhausted.
 */
export function allocateTableBudgets(kernelFrontiers, { budgetBytes = DEFAULT_L1_BUDGET_BYTES } = {}) {
  const chosen = new Map(); // kernelName -> candidate | null
  const paretoByKernel = new Map();

  for (const { kernelName, candidates } of kernelFrontiers) {
    // Filter candidates that fit alone and extract Pareto frontier (strictly better rho for more bytes)
    const sorted = [...candidates]
      .filter((c) => c.bytes <= budgetBytes && c.rho > 0)
      .sort((a, b) => a.bytes - b.bytes || b.rho - a.rho);
    const frontier = [];
    let bestRho = -1;
    for (const c of sorted) {
      if (c.rho > bestRho + 1e-9) {
        frontier.push(c);
        bestRho = c.rho;
      }
    }
    paretoByKernel.set(kernelName, frontier);
    chosen.set(kernelName, null);
  }

  let usedBytes = 0;
  const idxByKernel = new Map([...paretoByKernel.keys()].map((k) => [k, -1]));

  while (true) {
    let bestKernel = null;
    let bestNextIdx = -1;
    let bestEfficiency = -1;

    for (const [kName, frontier] of paretoByKernel.entries()) {
      const curIdx = idxByKernel.get(kName);
      const curBytes = curIdx >= 0 ? frontier[curIdx].bytes : 0;
      const curRho = curIdx >= 0 ? frontier[curIdx].rho : 0;

      // Consider upgrading `kName` to any higher frontier point that fits remaining budget
      for (let nxt = curIdx + 1; nxt < frontier.length; nxt++) {
        const deltaBytes = frontier[nxt].bytes - curBytes;
        if (usedBytes + deltaBytes > budgetBytes) continue;
        const deltaRho = frontier[nxt].rho - curRho;
        const eff = deltaBytes > 0 ? deltaRho / deltaBytes : Infinity;
        if (eff > bestEfficiency) {
          bestEfficiency = eff;
          bestKernel = kName;
          bestNextIdx = nxt;
        }
      }
    }

    if (bestKernel === null) break;
    const frontier = paretoByKernel.get(bestKernel);
    const prevIdx = idxByKernel.get(bestKernel);
    const prevBytes = prevIdx >= 0 ? frontier[prevIdx].bytes : 0;
    usedBytes += frontier[bestNextIdx].bytes - prevBytes;
    idxByKernel.set(bestKernel, bestNextIdx);
    chosen.set(bestKernel, frontier[bestNextIdx]);
  }

  return { chosen, usedBytes, budgetBytes };
}
