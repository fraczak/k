/**
 * Iteration 2 Blueprint Compiler:
 *   1. Compiles closed K ASTs to multi-port transducer blueprints (same 8 AST ops).
 *   2. Computes `usedLeafPaths` for every blueprint so `Product` only fans out
 *      (`TEE`) leaf wires that are genuinely read by 2+ branches (zero-copy direct
 *      wiring when used by 1 branch; `DRAIN` when used by 0 branches).
 *   3. Computes `leadingGuards` (Map<leafPathKey, Set<tag>>) for every union branch,
 *      enabling sound **multi-port prefix filtering (`MULTI_SW`)** over both scalar
 *      unions AND nested products (`divmod`, `_rev_bits`, `_nat_divmod`, `_lsb_sub`,
 *      `_full_sub_bit`).
 */

import { exportPatternGraph, patternToPropertyList } from "../../../backend-api.mjs";
import { patternLeafPaths } from "./wires.mjs";

function assertSupportedPlist(plist, context) {
  for (let i = 0; i < plist.length; i++) {
    const [kind] = plist[i];
    if (kind !== "closed-product" && kind !== "closed-union" && kind !== "open-union" && kind !== "any") {
      throw new Error(`BlueprintV2 unsupported pattern kind '${kind}' in ${context}`);
    }
  }
  return plist;
}

export function plistHasAny(plist, startNode = 0) {
  if (!plist) return false;
  const seen = new Set();
  const stack = [startNode];
  while (stack.length > 0) {
    const u = stack.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    const entry = plist[u];
    if (!entry) continue;
    if (entry[0] === "any") return true;
    for (const [, target] of entry[1]) stack.push(target);
  }
  return false;
}

/**
 * Graft a concrete sub-pattern `(payloadPlist, payloadNodeId)` onto the `tag`
 * edge of a union pattern `(outPlist, outNodeId)` when that edge pointed to `any`.
 */
export function graftUnionTagPayload(outPlist, outNodeId, tag, payloadPlist, payloadNodeId) {
  const payloadSub = subPlist(payloadPlist, payloadNodeId);
  const cloned = outPlist.map(([k, edges]) => [k, edges.map(([l, t]) => [l, t])]);
  const base = cloned.length;
  for (const [k, edges] of payloadSub) {
    cloned.push([k, edges.map(([l, t]) => [l, t + base])]);
  }
  const [, outEdges] = cloned[outNodeId];
  const edge = outEdges.find(([t]) => t === tag);
  if (edge) edge[1] = base;
  return cloned;
}

function plistEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function subPlist(plist, startNode) {
  const remap = new Map();
  const out = [];
  const visit = (nid) => {
    if (remap.has(nid)) return remap.get(nid);
    const newId = out.length;
    remap.set(nid, newId);
    const [kind, edges] = plist[nid];
    const entry = [kind, []];
    out.push(entry);
    entry[1] = edges.map(([label, target]) => [label, visit(target)]);
    return newId;
  };
  visit(startNode);
  return out;
}

const _canonKeyCache = new WeakMap();

/**
 * Exact canonical structural key for the regular tree rooted at `(plist, nodeId)`.
 * Uses Moore partition refinement + canonical DFS renumbering so bisimilar graphs
 * (e.g. shared vs. unshared `{}` leaf nodes in `_k_stack[]`) get the EXACT same key!
 */
export function canonicalSubPlistKey(plist, nodeId = 0) {
  if (!plist) return "";
  let byNode = _canonKeyCache.get(plist);
  if (!byNode) {
    byNode = new Map();
    _canonKeyCache.set(plist, byNode);
  }
  let key = byNode.get(nodeId);
  if (key === undefined) {
    const sub = subPlist(plist, nodeId);
    const n = sub.length;
    // Step 1: Moore partition refinement (bisimulation quotient)
    let cls = new Array(n);
    const initMap = new Map();
    for (let u = 0; u < n; u++) {
      const [kind, edges] = sub[u];
      const s = `${kind}|${edges.map(([l]) => l).join(",")}`;
      if (!initMap.has(s)) initMap.set(s, initMap.size);
      cls[u] = initMap.get(s);
    }
    let numClasses = initMap.size;
    while (true) {
      const nextMap = new Map();
      const nextCls = new Array(n);
      for (let u = 0; u < n; u++) {
        const [kind, edges] = sub[u];
        const s = `${kind}|${edges.map(([l, t]) => `${l}:${cls[t]}`).join(",")}`;
        if (!nextMap.has(s)) nextMap.set(s, nextMap.size);
        nextCls[u] = nextMap.get(s);
      }
      cls = nextCls;
      if (nextMap.size === numClasses) break;
      numClasses = nextMap.size;
    }
    // Step 2: Canonical DFS renumbering of the minimized quotient graph from cls[0]
    const repOf = new Array(numClasses).fill(-1);
    for (let u = 0; u < n; u++) if (repOf[cls[u]] === -1) repOf[cls[u]] = u;
    const remap = new Map();
    const minGraph = [];
    const emit = (c) => {
      if (remap.has(c)) return remap.get(c);
      const id = minGraph.length;
      remap.set(c, id);
      const [kind, edges] = sub[repOf[c]];
      const entry = [kind, []];
      minGraph.push(entry);
      entry[1] = edges.map(([l, t]) => [l, emit(cls[t])]);
      return id;
    };
    emit(cls[0]);
    key = JSON.stringify(minGraph);
    byNode.set(nodeId, key);
  }
  return key;
}

function prependPath(prefix, pathKey) {
  return pathKey ? `${prefix}.${pathKey}` : prefix;
}

/**
 * Compute the set of input leaf pathKeys read by a blueprint.
 * Conservative (sound): any leaf not in this set is guaranteed unread by `bp`.
 */
function computeUsedPaths(bp) {
  const allIn = () => new Set(patternLeafPaths(bp.inPlist).map((l) => l.pathKey));

  switch (bp.kind) {
    case "unit":
      return new Set();

    case "identity":
    case "div":
    case "vid":
    case "stub":
      return allIn();

    case "dot": {
      const subLeaves = patternLeafPaths(bp.inPlist, bp.targetNodeId);
      return new Set(subLeaves.map((l) => prependPath(bp.field, l.pathKey)));
    }

    case "comp":
      // Look through leading `dot` chain (e.g. `.sub .b /0` ONLY reads `sub.b`!)
      return computeCompUsedPaths(bp.steps);

    case "product": {
      const used = new Set();
      for (const f of bp.fields) {
        for (const p of f.blueprint.usedPaths) used.add(p);
      }
      return used;
    }

    case "multi-switch": {
      const used = new Set();
      for (const b of bp.branches) {
        for (const p of b.blueprint.usedPaths) used.add(p);
      }
      for (const p of bp.peekPaths) used.add(p);
      return used;
    }

    default:
      return allIn();
  }
}

function computeCompUsedPaths(steps) {
  if (steps.length === 0) return new Set();
  const [first, ...rest] = steps;
  if (first.kind === "dot") {
    if (rest.length === 0) return first.usedPaths;
    const restUsed = computeCompUsedPaths(rest);
    const out = new Set();
    for (const p of restUsed) {
      out.add(prependPath(first.field, p));
    }
    return out;
  }
  if (first.kind === "identity") {
    return rest.length === 0 ? first.usedPaths : computeCompUsedPaths(rest);
  }
  return first.usedPaths;
}

/**
 * Compute necessary head-token guards `Map<leafPathKey, Set<tag>>` on the
 * input wire for a blueprint to possibly succeed.
 *
 * Soundness invariant: if `bp` succeeds on an input whose leaf at `pathKey`
 * starts with token `t`, then `t ∈ guards.get(pathKey)` (for every `pathKey`
 * present in `guards`).
 */
function computeLeadingGuards(bp) {
  switch (bp.kind) {
    case "div": {
      const m = new Map();
      m.set("", new Set([bp.tag]));
      return m;
    }

    case "dot":
      return new Map();

    case "comp": {
      // Combine guards through leading `dot` / `identity` chains!
      return computeCompGuards(bp.steps);
    }

    case "product": {
      // All fields must succeed -> intersect guard sets per path!
      const merged = new Map();
      for (const f of bp.fields) {
        for (const [p, tags] of f.blueprint.leadingGuards.entries()) {
          if (!merged.has(p)) {
            merged.set(p, new Set(tags));
          } else {
            const cur = merged.get(p);
            const inter = new Set([...cur].filter((t) => tags.has(t)));
            merged.set(p, inter);
          }
        }
      }
      return merged;
    }

    case "multi-switch": {
      // A union succeeds if ANY branch succeeds -> for paths constrained by ALL
      // branches, take the union of allowed tags!
      if (bp.branches.length === 0) return new Map();
      const firstGuards = bp.branches[0].guards;
      const common = new Map();
      for (const [p, tags] of firstGuards.entries()) {
        let inAll = true;
        const unionSet = new Set(tags);
        for (let i = 1; i < bp.branches.length; i++) {
          const other = bp.branches[i].guards.get(p);
          if (!other) {
            inAll = false;
            break;
          }
          for (const t of other) unionSet.add(t);
        }
        if (inAll) {
          common.set(p, unionSet);
        }
      }
      return common;
    }

    default:
      return new Map();
  }
}

function computeCompGuards(steps) {
  if (steps.length === 0) return new Map();
  const [first, ...rest] = steps;
  if (first.kind === "dot") {
    const restG = computeCompGuards(rest);
    const shifted = new Map();
    for (const [p, tags] of restG.entries()) {
      shifted.set(prependPath(first.field, p), tags);
    }
    return shifted;
  }
  if (first.kind === "identity") {
    return computeCompGuards(rest);
  }
  return first.leadingGuards;
}

export class BlueprintRegistryV2 {
  constructor(library) {
    this.library = library;
    this.nameByHash = new Map();
    for (const [alias, hash] of Object.entries(library.relAlias || {})) {
      if (!this.nameByHash.has(hash)) {
        this.nameByHash.set(hash, alias);
      }
    }
    this.blueprints = new Map();
    this._finiteCache = new Map();
    this._branchingCache = new Map();
  }

  displayName(hash) {
    return this.nameByHash.get(hash) || hash.slice(0, 10);
  }

  /**
   * Returns `true` iff no call-graph cycle (recursion) is reachable from `relHash`.
   * Purely static over AST `ref` edges — used by the local eager-settle strategy
   * to know which helper STUBs (e.g. `_push_bit_acc`, `_pop_lsb_bit`, `_full_sub_bit`)
   * are guaranteed finite and safe to settle before expanding a recursive STUB.
   */
  isFiniteRel(relHash) {
    if (this._finiteCache.has(relHash)) {
      return this._finiteCache.get(relHash);
    }
    const visiting = new Set();
    const check = (h) => {
      if (this._finiteCache.has(h)) return this._finiteCache.get(h);
      if (visiting.has(h)) return false;
      const rel = this.library.rels[h];
      if (!rel) return true;
      visiting.add(h);
      let finite = true;
      const walk = (ast) => {
        if (!finite || !ast) return;
        if (ast.op === "ref") {
          if (!check(ast.ref)) finite = false;
        } else if (ast.op === "comp") {
          for (const s of ast.comp) walk(s);
        } else if (ast.op === "union") {
          for (const b of ast.union) walk(b);
        } else if (ast.op === "product") {
          for (const f of ast.product) walk(f.exp);
        }
      };
      walk(rel.def);
      visiting.delete(h);
      if (visiting.size === 0 || finite) {
        this._finiteCache.set(h, finite);
      }
      return finite;
    };
    const res = check(relHash);
    this._finiteCache.set(relHash, res);
    return res;
  }

  /**
   * Returns `true` iff `relHash` belongs to a recursive cycle (SCC) that makes
   * >= 2 recursive calls along a single execution path (e.g., tree recursion
   * such as direct Karatsuba `lsb_mul` calling `z0`, `z2`, `z3`), as opposed
   * to linear / tail recursion (`_nat_divmod`, `_gcd`, `_lsb_mul_small`).
   */
  isBranchingRecursive(relHash) {
    if (this._branchingCache.has(relHash)) {
      return this._branchingCache.get(relHash);
    }
    const directRefs = (h) => {
      const rel = this.library.rels[h];
      const refs = new Set();
      if (!rel) return refs;
      const walk = (ast) => {
        if (!ast) return;
        if (ast.op === "ref") refs.add(ast.ref);
        else if (ast.op === "comp") for (const s of ast.comp) walk(s);
        else if (ast.op === "union") for (const b of ast.union) walk(b);
        else if (ast.op === "product") for (const f of ast.product) walk(f.exp);
      };
      walk(rel.def);
      return refs;
    };
    // BFS all nodes reachable from `relHash` in >= 1 step
    const reachableFromRoot = new Set();
    const q = [...directRefs(relHash)];
    for (let i = 0; i < q.length; i++) {
      const h = q[i];
      if (reachableFromRoot.has(h)) continue;
      reachableFromRoot.add(h);
      for (const nxt of directRefs(h)) {
        if (!reachableFromRoot.has(nxt)) q.push(nxt);
      }
    }
    if (!reachableFromRoot.has(relHash)) {
      this._branchingCache.set(relHash, false);
      return false;
    }
    // SCC = nodes reachable from relHash that can also reach relHash
    const scc = new Set([relHash]);
    for (const h of reachableFromRoot) {
      if (h === relHash) continue;
      const seen = new Set();
      const stack = [...directRefs(h)];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === relHash) { scc.add(h); break; }
        if (seen.has(cur) || !reachableFromRoot.has(cur)) continue;
        seen.add(cur);
        for (const nxt of directRefs(cur)) stack.push(nxt);
      }
    }
    const maxCallsPerPath = (ast) => {
      if (!ast) return 0;
      if (ast.op === "ref") return scc.has(ast.ref) ? 1 : 0;
      if (ast.op === "comp") {
        let sum = 0;
        for (const s of ast.comp) sum += maxCallsPerPath(s);
        return sum;
      }
      if (ast.op === "product") {
        let sum = 0;
        for (const f of ast.product) sum += maxCallsPerPath(f.exp);
        return sum;
      }
      if (ast.op === "union") {
        let best = 0;
        for (const b of ast.union) {
          const v = maxCallsPerPath(b);
          if (v > best) best = v;
        }
        return best;
      }
      return 0;
    };
    let branching = false;
    for (const h of scc) {
      if (maxCallsPerPath(this.library.rels[h]?.def) >= 2) {
        branching = true;
        break;
      }
    }
    this._branchingCache.set(relHash, branching);
    return branching;
  }

  getBlueprint(relHash) {
    if (this.blueprints.has(relHash)) {
      return this.blueprints.get(relHash);
    }
    const rel = this.library.rels[relHash];
    if (!rel) throw new Error(`Unknown relation hash: ${relHash}`);
    const name = this.displayName(relHash);
    const g = rel.typePatternGraph;
    const localCache = new Map();
    const plistOf = (pid, ctx) => {
      const rep = g.find(pid);
      if (!localCache.has(rep)) {
        localCache.set(rep, assertSupportedPlist(patternToPropertyList(exportPatternGraph(g, rep)), `${name}:${ctx}`));
      }
      return localCache.get(rep);
    };

    const finalize = (bp) => {
      bp.usedPaths = computeUsedPaths(bp);
      bp.leadingGuards = computeLeadingGuards(bp);
      return bp;
    };

    const compileNode = (ast) => {
      const inPlist = plistOf(ast.patterns[0], `${ast.op}.in`);
      const outPlist = plistOf(ast.patterns[1], `${ast.op}.out`);
      const samePattern = plistEquals(inPlist, outPlist);

      switch (ast.op) {
        case "identity":
          return finalize({ kind: "identity", inPlist, outPlist, samePattern });

        case "div": {
          const [rootKind, edges] = inPlist[0];
          if (rootKind !== "closed-union" && rootKind !== "open-union") throw new Error(`${name}: div '${ast.div}' on non-union`);
          const edge = edges.find(([t]) => t === ast.div);
          if (!edge) throw new Error(`${name}: div tag '${ast.div}' not in union`);
          const targetSub = subPlist(inPlist, edge[1]);
          return finalize({
            kind: "div",
            tag: ast.div,
            targetNodeId: edge[1],
            targetPlist: targetSub,
            inPlist,
            outPlist,
            payloadSamePattern: plistEquals(targetSub, outPlist)
          });
        }

        case "vid": {
          const [rootKind, edges] = outPlist[0];
          if (rootKind !== "closed-union" && rootKind !== "open-union") throw new Error(`${name}: vid '${ast.vid}' on non-union`);
          const edge = edges.find(([t]) => t === ast.vid);
          if (!edge) throw new Error(`${name}: vid tag '${ast.vid}' not in union`);
          const targetSub = subPlist(outPlist, edge[1]);
          return finalize({
            kind: "vid",
            tag: ast.vid,
            targetNodeId: edge[1],
            targetPlist: targetSub,
            inPlist,
            outPlist,
            payloadSamePattern: plistEquals(inPlist, targetSub)
          });
        }

        case "dot": {
          const [rootKind, edges] = inPlist[0];
          if (rootKind !== "closed-product") throw new Error(`${name}: dot '${ast.dot}' on non-product`);
          const edge = edges.find(([l]) => l === ast.dot);
          if (!edge) throw new Error(`${name}: dot field '${ast.dot}' not found`);
          const targetSub = subPlist(inPlist, edge[1]);
          return finalize({
            kind: "dot",
            field: ast.dot,
            targetNodeId: edge[1],
            targetPlist: targetSub,
            inPlist,
            outPlist,
            samePattern: plistEquals(targetSub, outPlist)
          });
        }

        case "product": {
          if (ast.product.length === 0) {
            return finalize({ kind: "unit", inPlist, outPlist });
          }
          const [rootKind, outEdges] = outPlist[0];
          if (rootKind !== "closed-product") throw new Error(`${name}: product output not closed-product`);
          const byLabel = new Map(ast.product.map((f) => [f.label, f.exp]));
          const fields = outEdges.map(([label]) => {
            const exp = byLabel.get(label);
            if (!exp) throw new Error(`${name}: product missing field '${label}'`);
            return { label, blueprint: compileNode(exp) };
          });
          return finalize({ kind: "product", fields, inPlist, outPlist });
        }

        case "comp": {
          const steps = ast.comp.map(compileNode);
          if (steps.length === 1) return steps[0];
          return finalize({ kind: "comp", steps, inPlist, outPlist });
        }

        case "union": {
          const compiledBranches = ast.union.map((bAst) => {
            const bBp = compileNode(bAst);
            return { blueprint: bBp, guards: bBp.leadingGuards };
          });
          // Collect all distinct leaf paths guarded by at least one branch (sorted)
          const peekSet = new Set();
          for (const b of compiledBranches) {
            for (const p of b.guards.keys()) peekSet.add(p);
          }
          const peekPaths = [...peekSet].sort();
          return finalize({
            kind: "multi-switch",
            branches: compiledBranches,
            peekPaths,
            inPlist,
            outPlist
          });
        }

        case "ref":
          return finalize({
            kind: "stub",
            relHash: ast.ref,
            relName: this.displayName(ast.ref),
            inPlist,
            outPlist
          });

        default:
          throw new Error(`${name}: unsupported AST op '${ast.op}'`);
      }
    };

    const root = compileNode(rel.def);
    const bp = {
      relHash,
      name,
      inPlist: root.inPlist,
      outPlist: root.outPlist,
      root
    };
    this.blueprints.set(relHash, bp);
    return bp;
  }
}
