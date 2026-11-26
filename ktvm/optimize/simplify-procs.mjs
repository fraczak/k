/**
 * Verified `proc -> proc` Simplification Pass for `kTVM` (`kTVM -> kTVM`).
 *
 * Runs on validated concrete `mono` modules BEFORE `fuseKernels`:
 *   1. Acyclic helper proc inlining (`@is_nil`, `@car`, `@cdr`, `@cons`,
 *      `@pop_lsb_bit`, `@full_add_bit`, `@full_sub_bit`, `@push_bit_acc`, ...).
 *   2. Fixpoint SPSC channel-graph deforestation:
 *      - `splice` copy propagation
 *      - `mux -> demux` identity elimination
 *      - `wrap -> match` / `wrap -> switch` / `wrap -> drain` folding
 *      - Trivial `const_unit -> drain` & empty `barrier`/`gate` removal
 *      - `tee` common `match /T` factoring
 *      - Total/prefix-atomic `tee -> demux` disjoint-projection collapse
 *        (eliminating O(N^2) tail duplication + draining in list/bit loops)
 *      - Known-tag nested `switch` pruning
 *   3. Multi-column deterministic `spec -> switch` decision-table compilation
 *      using bottom-up greatest-fixed-point totality analysis and exact
 *      uncovered-tuple wildcard compression.
 *   4. Dead unreachable procedure elimination.
 */

import { cloneAst, createModule } from "../ast.mjs";
import {
  compileSchemaExprToPlist,
  isUnitSchema,
  productFields,
  schemasEquivalent,
  subPlist,
  unionTagInfo
} from "../schema.mjs";

// ---------------------------------------------------------------------------
// Generic AST helpers
// ---------------------------------------------------------------------------

function countStmts(stmts) {
  let n = 0;
  for (const s of stmts || []) {
    n += 1;
    if (s.op === "switch") {
      for (const a of s.arms) n += countStmts(a.body);
      if (s.defaultBody) n += countStmts(s.defaultBody);
    } else if (s.op === "spec") {
      for (const b of s.branches) n += countStmts(b.body);
    }
  }
  return n;
}

function hasSpecialOps(stmts, { allowExec = false } = {}) {
  for (const s of stmts || []) {
    if (s.op === "exec" && !allowExec) return true;
    if (s.op === "spawn" && (s.after || s.token)) return true;
    if (s.op === "switch") {
      for (const a of s.arms) if (hasSpecialOps(a.body, { allowExec })) return true;
      if (s.defaultBody && hasSpecialOps(s.defaultBody, { allowExec })) return true;
    } else if (s.op === "spec") {
      for (const b of s.branches) if (hasSpecialOps(b.body, { allowExec })) return true;
    }
  }
  return false;
}

function hasSpecOp(stmts) {
  for (const s of stmts || []) {
    if (s.op === "spec") return true;
    if (s.op === "switch") {
      for (const a of s.arms) if (hasSpecOp(a.body)) return true;
      if (s.defaultBody && hasSpecOp(s.defaultBody)) return true;
    }
  }
  return false;
}

function computeModuleStrictFailure(mod) {
  for (const p of mod.procs || []) {
    if ((p.outputs || []).length !== 1) return false;
    const checkBlock = (stmts) => {
      const localBars = new Set();
      const gatedBars = new Set();
      for (const s of stmts || []) {
        if (s.op === "barrier") localBars.add(s.name);
        else if (s.op === "drain" && !s.barrier) return false;
        else if (s.op === "gate" && s.barrier) gatedBars.add(s.barrier);
      }
      // Also check gates nested in child switches for barriers declared in this block
      const collectGatesDeep = (list) => {
        for (const s of list || []) {
          if (s.op === "gate" && s.barrier) gatedBars.add(s.barrier);
          else if (s.op === "switch") {
            for (const a of s.arms) collectGatesDeep(a.body);
            if (s.defaultBody) collectGatesDeep(s.defaultBody);
          }
        }
      };
      collectGatesDeep(stmts);
      for (const b of localBars) {
        if (!gatedBars.has(b)) return false;
      }
      for (const s of stmts || []) {
        if (s.op === "switch") {
          for (const a of s.arms) if (!checkBlock(a.body)) return false;
          if (s.defaultBody && !checkBlock(s.defaultBody)) return false;
        } else if (s.op === "spec") {
          for (const br of s.branches) if (!checkBlock(br.body)) return false;
        }
      }
      return true;
    };
    if (!checkBlock(p.body)) return false;
  }
  return true;
}

function collectLocalDeclsDeep(stmts, chanSet = new Set(), barSet = new Set(), tokSet = new Set()) {
  for (const s of stmts || []) {
    if (s.op === "chan") chanSet.add(s.name);
    else if (s.op === "barrier") barSet.add(s.name);
    else if (s.op === "spawn" && s.token) tokSet.add(s.token);
    else if (s.op === "switch") {
      for (const a of s.arms) collectLocalDeclsDeep(a.body, chanSet, barSet, tokSet);
      if (s.defaultBody) collectLocalDeclsDeep(s.defaultBody, chanSet, barSet, tokSet);
    } else if (s.op === "spec") {
      for (const b of s.branches) collectLocalDeclsDeep(b.body, chanSet, barSet, tokSet);
    }
  }
  return { chanSet, barSet, tokSet };
}

function renameStmtRefs(stmts, chanMap, barMap = null, tokMap = null) {
  const rc = (v) => (v && chanMap && chanMap.has(v) ? chanMap.get(v) : v);
  const rb = (v) => (v && barMap && barMap.has(v) ? barMap.get(v) : v);
  const rt = (v) => (v && tokMap && tokMap.has(v) ? tokMap.get(v) : v);

  return (stmts || []).map((s) => {
    switch (s.op) {
      case "chan":
        return { ...s, name: rc(s.name) };
      case "barrier":
        return { ...s, name: rb(s.name) };
      case "drain":
        return { ...s, src: rc(s.src), barrier: rb(s.barrier) };
      case "gate":
        return { ...s, barrier: rb(s.barrier), src: rc(s.src), dst: rc(s.dst) };
      case "splice":
        return { ...s, src: rc(s.src), dst: rc(s.dst) };
      case "coerce":
        return { ...s, src: rc(s.src), dst: rc(s.dst) };
      case "const_unit":
        return { ...s, dst: rc(s.dst) };
      case "tee":
        return { ...s, src: rc(s.src), dsts: s.dsts.map(rc) };
      case "wrap":
      case "match":
        return { ...s, src: rc(s.src), dst: rc(s.dst) };
      case "demux":
        return { ...s, src: rc(s.src), fields: s.fields.map((f) => ({ ...f, name: rc(f.name) })) };
      case "mux":
        return { ...s, dst: rc(s.dst), fields: s.fields.map((f) => ({ ...f, name: rc(f.name) })) };
      case "spawn":
        return {
          ...s,
          inputs: s.inputs.map(rc),
          outputs: s.outputs.map(rc),
          after: rt(s.after),
          token: rt(s.token)
        };
      case "exec":
        return { ...s, inputs: s.inputs.map(rc), outputs: s.outputs.map(rc) };
      case "switch":
        return {
          ...s,
          inputs: s.inputs.map(rc),
          arms: s.arms.map((a) => ({ ...a, body: renameStmtRefs(a.body, chanMap, barMap, tokMap) })),
          defaultBody: s.defaultBody ? renameStmtRefs(s.defaultBody, chanMap, barMap, tokMap) : null
        };
      case "spec":
        return {
          ...s,
          inputs: s.inputs.map(rc),
          outputs: s.outputs.map(rc),
          branches: s.branches.map((b) => ({ ...b, body: renameStmtRefs(b.body, chanMap, barMap, tokMap) }))
        };
      default:
        return s;
    }
  });
}

function countChanRefsDeep(stmts, chanName) {
  let count = 0;
  const visit = (list) => {
    for (const s of list || []) {
      switch (s.op) {
        case "drain": if (s.src === chanName) count++; break;
        case "gate":
        case "splice":
        case "coerce":
        case "wrap":
        case "match":
          if (s.src === chanName) count++;
          if (s.dst === chanName) count++;
          break;
        case "const_unit":
          if (s.dst === chanName) count++;
          break;
        case "tee":
          if (s.src === chanName) count++;
          for (const d of s.dsts) if (d === chanName) count++;
          break;
        case "demux":
          if (s.src === chanName) count++;
          for (const f of s.fields) if (f.name === chanName) count++;
          break;
        case "mux":
          if (s.dst === chanName) count++;
          for (const f of s.fields) if (f.name === chanName) count++;
          break;
        case "spawn":
        case "exec":
          for (const v of s.inputs) if (v === chanName) count++;
          for (const v of s.outputs) if (v === chanName) count++;
          break;
        case "switch":
          for (const v of s.inputs) if (v === chanName) count++;
          for (const a of s.arms) visit(a.body);
          if (s.defaultBody) visit(s.defaultBody);
          break;
        case "spec":
          for (const v of s.inputs) if (v === chanName) count++;
          for (const v of s.outputs) if (v === chanName) count++;
          for (const b of s.branches) visit(b.body);
          break;
      }
    }
  };
  visit(stmts);
  return count;
}

function collectBlockIO(stmts, outerChans) {
  const local = new Set();
  const cons = new Set();
  const prod = new Set();
  const walk = (list) => {
    for (const s of list || []) {
      switch (s.op) {
        case "chan":
          local.add(s.name);
          break;
        case "drain":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          break;
        case "gate":
        case "splice":
        case "coerce":
        case "wrap":
        case "match":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          if (!local.has(s.dst) && outerChans.has(s.dst)) prod.add(s.dst);
          break;
        case "const_unit":
          if (!local.has(s.dst) && outerChans.has(s.dst)) prod.add(s.dst);
          break;
        case "tee":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          for (const d of s.dsts) if (!local.has(d) && outerChans.has(d)) prod.add(d);
          break;
        case "demux":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          for (const f of s.fields) if (!local.has(f.name) && outerChans.has(f.name)) prod.add(f.name);
          break;
        case "mux":
          for (const f of s.fields) if (!local.has(f.name) && outerChans.has(f.name)) cons.add(f.name);
          if (!local.has(s.dst) && outerChans.has(s.dst)) prod.add(s.dst);
          break;
        case "spawn":
        case "exec":
          for (const v of s.inputs) if (!local.has(v) && outerChans.has(v)) cons.add(v);
          for (const v of s.outputs) if (!local.has(v) && outerChans.has(v)) prod.add(v);
          break;
        case "switch": {
          const first = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
          walk(first);
          break;
        }
        case "spec":
          for (const v of s.inputs) if (!local.has(v) && outerChans.has(v)) cons.add(v);
          for (const v of s.outputs) if (!local.has(v) && outerChans.has(v)) prod.add(v);
          break;
      }
    }
  };
  walk(stmts);
  return { cons, prod };
}

function collectBarrierDrainsDeep(stmts, counts = new Map()) {
  for (const s of stmts || []) {
    if (s.op === "drain" && s.barrier) {
      counts.set(s.barrier, (counts.get(s.barrier) || 0) + 1);
    } else if (s.op === "switch") {
      for (const a of s.arms) collectBarrierDrainsDeep(a.body, counts);
      if (s.defaultBody) collectBarrierDrainsDeep(s.defaultBody, counts);
    } else if (s.op === "spec") {
      for (const b of s.branches) collectBarrierDrainsDeep(b.body, counts);
    }
  }
  return counts;
}

function replaceBarrierGatesDeep(stmts, deadBarriers) {
  return (stmts || []).map((s) => {
    if (s.op === "gate" && deadBarriers.has(s.barrier)) {
      return { op: "splice", src: s.src, dst: s.dst };
    }
    if (s.op === "switch") {
      return {
        ...s,
        arms: s.arms.map((a) => ({ ...a, body: replaceBarrierGatesDeep(a.body, deadBarriers) })),
        defaultBody: s.defaultBody ? replaceBarrierGatesDeep(s.defaultBody, deadBarriers) : null
      };
    }
    if (s.op === "spec") {
      return {
        ...s,
        branches: s.branches.map((b) => ({ ...b, body: replaceBarrierGatesDeep(b.body, deadBarriers) }))
      };
    }
    return s;
  });
}

// ---------------------------------------------------------------------------
// Schema & Totality Analysis
// ---------------------------------------------------------------------------

function makeSchemaResolver(mod) {
  const schemaMap = new Map();
  for (const s of mod.schemas || []) schemaMap.set(s.name, s);
  const cache = new Map();
  const unitPlist = [["closed-product", []]];
  return function resolvePlist(expr) {
    if (!expr) return null;
    if (expr.kind === "unit") return unitPlist;
    let key;
    if (expr.kind === "ref" && (!expr.args || expr.args.length === 0)) {
      key = expr.name;
    } else {
      key = JSON.stringify(expr);
    }
    if (cache.has(key)) return cache.get(key);
    try {
      const pl = compileSchemaExprToPlist(expr, schemaMap, { allowOpen: false });
      cache.set(key, pl);
      return pl;
    } catch {
      cache.set(key, null);
      return null;
    }
  };
}

function unionTagsOf(plist) {
  if (!plist || !plist[0]) return null;
  const [kind, edges] = plist[0];
  if (kind !== "closed-union") return null;
  return edges.map(([tag]) => tag);
}

/**
 * Greatest-fixed-point totality analysis across all procs in `mod`.
 * A proc is in `totalProcs` iff no reachable execution on a valid closed
 * input can ever return `FAIL`.
 */
function computeTotalProcs(mod, resolvePlist) {
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
  const totalProcs = new Set((mod.procs || []).map((p) => p.name));

  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of mod.procs || []) {
      if (!totalProcs.has(proc.name)) continue;
      const baseTypes = new Map();
      for (const p of proc.inputs) baseTypes.set(p.name, resolvePlist(p.schema));
      for (const p of proc.outputs) baseTypes.set(p.name, resolvePlist(p.schema));
      if (!isBlockTotal(proc.body, baseTypes, new Map(), totalProcs, kernelMap, resolvePlist)) {
        totalProcs.delete(proc.name);
        changed = true;
      }
    }
  }
  return totalProcs;
}

/**
 * Check if `stmts` cannot originate `FAIL` given `allowedTags` (`chan -> Set<tag>`).
 */
function isBlockTotal(stmts, outerTypes, allowedTags, totalProcs, kernelMap, resolvePlist) {
  const types = new Map(outerTypes);
  const allowed = new Map(allowedTags);
  // Propagate allowed tag constraints across trivial `gate` and `splice` aliases!
  for (const s of stmts || []) {
    if (s.op === "chan") {
      types.set(s.name, resolvePlist(s.schema));
    }
  }
  for (const s of stmts || []) {
    switch (s.op) {
      case "chan":
      case "barrier":
      case "drain":
      case "const_unit":
      case "demux":
      case "mux":
        break;
      case "gate":
      case "splice":
        if (allowed.has(s.src)) allowed.set(s.dst, allowed.get(s.src));
        break;
      case "tee":
        if (allowed.has(s.src)) {
          const tset = allowed.get(s.src);
          for (const d of s.dsts) allowed.set(d, tset);
        }
        break;
      case "wrap":
        allowed.set(s.dst, new Set([s.tag]));
        break;
      case "match": {
        const pl = types.get(s.src);
        const allTags = unionTagsOf(pl);
        if (allTags && allTags.length === 1 && allTags[0] === s.tag) break;
        const set = allowed.get(s.src);
        if (!set || set.size !== 1 || !set.has(s.tag)) return false;
        break;
      }
      case "coerce": {
        const sPl = resolvePlist(s.srcSchema);
        const dPl = resolvePlist(s.dstSchema);
        if (!sPl || !dPl || !schemasEquivalent(sPl, 0, dPl, 0)) return false;
        break;
      }
      case "spawn":
        if (!totalProcs.has(s.target)) return false;
        break;
      case "exec": {
        const k = kernelMap.get(s.target);
        if (!k || !(k.attrs || []).includes("total")) return false;
        break;
      }
      case "switch": {
        // Compute all reachable tag combinations for `s.inputs` under `allowed`.
        const colTagLists = [];
        let prodSize = 1;
        for (const inp of s.inputs) {
          const all = unionTagsOf(types.get(inp));
          if (!all || all.length === 0) return false;
          const filt = allowed.has(inp) ? all.filter((t) => allowed.get(inp).has(t)) : all;
          if (filt.length === 0) return false;
          colTagLists.push(filt);
          prodSize *= filt.length;
        }

        if (prodSize > 256) {
          // Wide alphabet: require `defaultBody` and all bodies total
          if (!s.defaultBody) return false;
          for (const arm of s.arms) {
            const armAllowed = new Map(allowed);
            for (let j = 0; j < arm.patterns.length; j++) {
              if (arm.patterns[j].kind === "tag") armAllowed.set(s.inputs[j], new Set([arm.patterns[j].tag]));
            }
            if (!isBlockTotal(arm.body, types, armAllowed, totalProcs, kernelMap, resolvePlist)) return false;
          }
          if (!isBlockTotal(s.defaultBody, types, allowed, totalProcs, kernelMap, resolvePlist)) return false;
          break;
        }

        // Exact tuple coverage check!
        const armUsed = new Array(s.arms.length).fill(false);
        let defaultUsed = false;
        const armAllowedSets = s.arms.map(() => s.inputs.map(() => new Set()));
        const defAllowedSets = s.inputs.map(() => new Set());

        const tuple = new Array(s.inputs.length);
        const walkTuples = (col) => {
          if (col === s.inputs.length) {
            let matched = -1;
            for (let a = 0; a < s.arms.length; a++) {
              let ok = true;
              for (let j = 0; j < s.inputs.length; j++) {
                const p = s.arms[a].patterns[j];
                if (p.kind === "tag" && p.tag !== tuple[j]) {
                  ok = false;
                  break;
                }
              }
              if (ok) {
                matched = a;
                break;
              }
            }
            if (matched >= 0) {
              armUsed[matched] = true;
              for (let j = 0; j < s.inputs.length; j++) armAllowedSets[matched][j].add(tuple[j]);
              return true;
            }
            if (!s.defaultBody) return false;
            defaultUsed = true;
            for (let j = 0; j < s.inputs.length; j++) defAllowedSets[j].add(tuple[j]);
            return true;
          }
          for (const tag of colTagLists[col]) {
            tuple[col] = tag;
            if (!walkTuples(col + 1)) return false;
          }
          return true;
        };

        if (!walkTuples(0)) return false;
        for (let a = 0; a < s.arms.length; a++) {
          if (!armUsed[a]) continue;
          const armAllowed = new Map(allowed);
          for (let j = 0; j < s.inputs.length; j++) armAllowed.set(s.inputs[j], armAllowedSets[a][j]);
          if (!isBlockTotal(s.arms[a].body, types, armAllowed, totalProcs, kernelMap, resolvePlist)) return false;
        }
        if (defaultUsed) {
          const defAllowed = new Map(allowed);
          for (let j = 0; j < s.inputs.length; j++) defAllowed.set(s.inputs[j], defAllowedSets[j]);
          if (!isBlockTotal(s.defaultBody, types, defAllowed, totalProcs, kernelMap, resolvePlist)) return false;
        }
        break;
      }
      case "spec": {
        if (s.branches.length === 0) return false;
        // A `spec` is total if ANY branch (in particular the last) is unconditionally total under `allowed`
        const specTypes = new Map();
        for (const v of [...s.inputs, ...s.outputs]) specTypes.set(v, types.get(v));
        const specAllowed = new Map();
        for (const v of s.inputs) if (allowed.has(v)) specAllowed.set(v, allowed.get(v));
        let anyTotal = false;
        for (const br of s.branches) {
          if (isBlockTotal(br.body, specTypes, specAllowed, totalProcs, kernelMap, resolvePlist)) {
            anyTotal = true;
            break;
          }
        }
        if (!anyTotal) return false;
        break;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pass 1: Acyclic Helper Proc Inlining
// ---------------------------------------------------------------------------

function inlineSmallAcyclicProcs(
  mod,
  {
    maxInlineStmts = 48,
    maxSingleUseStmts = 160,
    maxProcStmts = 800,
    allowExec = false,
    allowSpecCallee = true,
    onlyInSpec = false,
    seqBox = { seq: 0 }
  } = {}
) {
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const callsOf = new Map();
  const callCounts = new Map();

  const walkCalls = (stmts, set) => {
    for (const s of stmts || []) {
      if (s.op === "spawn") {
        set.add(s.target);
        callCounts.set(s.target, (callCounts.get(s.target) || 0) + 1);
      } else if (s.op === "switch") {
        for (const a of s.arms) walkCalls(a.body, set);
        if (s.defaultBody) walkCalls(s.defaultBody, set);
      } else if (s.op === "spec") {
        for (const b of s.branches) walkCalls(b.body, set);
      }
    }
  };
  for (const p of mod.procs || []) {
    const s = new Set();
    walkCalls(p.body, s);
    callsOf.set(p.name, s);
  }

  // Non-cyclic check: a proc `P` is safe to inline iff `P` cannot reach `P`
  // (it is not part of any recursive SCC cycle, even if it calls a separate
  // recursive loop such as `@dj_string_loop_19` or `@trim_bits`).
  const nonCyclicCache = new Map();
  const isNonCyclic = (name) => {
    if (nonCyclicCache.has(name)) return nonCyclicCache.get(name);
    if (!procMap.has(name)) {
      nonCyclicCache.set(name, false);
      return false;
    }
    const seen = new Set();
    const stk = [...(callsOf.get(name) || [])];
    let reachesSelf = false;
    while (stk.length > 0) {
      const cur = stk.pop();
      if (cur === name) {
        reachesSelf = true;
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of callsOf.get(cur) || []) stk.push(nxt);
    }
    nonCyclicCache.set(name, !reachesSelf);
    return !reachesSelf;
  };

  // Topological order of non-cyclic procs (callees before callers)
  const topo = [];
  const visited = new Set();
  const visitTopo = (name) => {
    if (visited.has(name) || !procMap.has(name)) return;
    visited.add(name);
    for (const cal of callsOf.get(name) || []) {
      if (isNonCyclic(cal)) visitTopo(cal);
    }
    topo.push(name);
  };
  for (const p of mod.procs || []) if (isNonCyclic(p.name)) visitTopo(p.name);
  for (const p of mod.procs || []) if (!visited.has(p.name)) topo.push(p.name);

  let inlinedCalls = 0;

  const updatedProcs = new Map((mod.procs || []).map((p) => [p.name, cloneAst(p)]));

  const canInline = (calleeName) => {
    if (calleeName === mod.entry) return false;
    if (!isNonCyclic(calleeName)) return false;
    const callee = updatedProcs.get(calleeName);
    if (!callee || hasSpecialOps(callee.body, { allowExec })) return false;
    if (!allowSpecCallee && hasSpecOp(callee.body)) return false;
    const sz = countStmts(callee.body);
    if (sz <= maxInlineStmts) return true;
    if ((callCounts.get(calleeName) || 0) === 1 && sz <= maxSingleUseStmts) return true;
    return false;
  };

  const inlineInBlock = (stmts, budgetBox, insideSpec = false) => {
    const out = [];
    for (const s of stmts || []) {
      if (
        s.op === "spawn" &&
        !s.after &&
        !s.token &&
        (!onlyInSpec || insideSpec) &&
        canInline(s.target)
      ) {
        const callee = updatedProcs.get(s.target);
        const calleeSz = countStmts(callee.body);
        if (budgetBox.cur + calleeSz <= maxProcStmts) {
          const seq = seqBox.seq++;
          const { chanSet, barSet, tokSet } = collectLocalDeclsDeep(callee.body);
          const chanMap = new Map();
          const barMap = new Map();
          const tokMap = new Map();
          for (let i = 0; i < callee.inputs.length; i++) chanMap.set(callee.inputs[i].name, s.inputs[i]);
          for (let i = 0; i < callee.outputs.length; i++) chanMap.set(callee.outputs[i].name, s.outputs[i]);
          let idx = 0;
          for (const c of chanSet) chanMap.set(c, `%il${seq}_${idx++}`);
          for (const b of barSet) barMap.set(b, `%ilb${seq}_${idx++}`);
          for (const t of tokSet) tokMap.set(t, `%ilt${seq}_${idx++}`);
          const body = renameStmtRefs(cloneAst(callee.body), chanMap, barMap, tokMap);
          out.push(...body);
          budgetBox.cur += calleeSz - 1;
          inlinedCalls += 1;
          continue;
        }
      }
      if (s.op === "switch") {
        out.push({
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: inlineInBlock(a.body, budgetBox, insideSpec) })),
          defaultBody: s.defaultBody ? inlineInBlock(s.defaultBody, budgetBox, insideSpec) : null
        });
      } else if (s.op === "spec") {
        out.push({
          ...s,
          branches: s.branches.map((b) => ({ ...b, body: inlineInBlock(b.body, budgetBox, true) }))
        });
      } else {
        out.push(s);
      }
    }
    return out;
  };

  for (const name of topo) {
    const proc = updatedProcs.get(name);
    const budgetBox = { cur: countStmts(proc.body) };
    proc.body = inlineInBlock(proc.body, budgetBox, false);
  }

  return {
    module: { ...mod, procs: (mod.procs || []).map((p) => updatedProcs.get(p.name)) },
    inlinedCalls
  };
}

// ---------------------------------------------------------------------------
// Pass 2: Fixpoint SPSC Channel-Graph Deforestation
// ---------------------------------------------------------------------------

function deforestModule(mod, resolvePlist, totalProcs, freshBox = { seq: 0 }) {
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
  const moduleStrictFailure = computeModuleStrictFailure(mod);
  const stats = {
    splicesEliminated: 0,
    muxDemuxEliminated: 0,
    wrapFolds: 0,
    trivialDrainsEliminated: 0,
    teeMatchFactors: 0,
    teeDemuxCollapses: 0,
    knownSwitchFolds: 0
  };
  const nextFresh = (prefix) => `%${prefix}_${freshBox.seq++}`;

  const procs = (mod.procs || []).map((proc) => {
    const outerTypes = new Map();
    const outerExprs = new Map();
    const totalChans = new Set();
    for (const p of proc.inputs) {
      outerTypes.set(p.name, resolvePlist(p.schema));
      outerExprs.set(p.name, p.schema);
      totalChans.add(p.name);
    }
    for (const p of proc.outputs) {
      outerTypes.set(p.name, resolvePlist(p.schema));
      outerExprs.set(p.name, p.schema);
    }
    const newBody = deforestBlock(
      cloneAst(proc.body),
      outerTypes,
      outerExprs,
      new Set(proc.inputs.map((p) => p.name)),
      new Set(proc.outputs.map((p) => p.name)),
      totalChans,
      new Map()
    );
    return { ...proc, body: newBody };
  });

  function deforestBlock(stmts, outerTypes, outerExprs, outerInputs, outerOutputs, outerTotal, outerKnownTags) {
    let cur = stmts;
    const outerSet = new Set(outerTypes.keys());

    // Keep iterating block-level simplifications until fixpoint
    for (let iter = 0; iter < 32; iter++) {
      let changed = false;

      // Build channel metadata for this block
      const localDecls = new Map(); // name -> { idx, stmt, plist }
      const types = new Map(outerTypes);
      const exprs = new Map(outerExprs);
      const localBarriers = new Map(); // name -> idx
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op === "chan") {
          const pl = resolvePlist(s.schema);
          localDecls.set(s.name, { idx: i, stmt: s, plist: pl });
          types.set(s.name, pl);
          exprs.set(s.name, s.schema);
        } else if (s.op === "barrier") {
          localBarriers.set(s.name, i);
        }
      }

      // Compute producer & consumer statement indices in this block
      const prodAt = new Map();
      const consAt = new Map();
      const setProd = (v, i) => { prodAt.set(v, i); };
      const setCons = (v, i) => { consAt.set(v, i); };

      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        switch (s.op) {
          case "drain": setCons(s.src, i); break;
          case "gate":
          case "splice":
          case "coerce":
          case "wrap":
          case "match":
            setCons(s.src, i); setProd(s.dst, i); break;
          case "const_unit":
            setProd(s.dst, i); break;
          case "tee":
            setCons(s.src, i);
            for (const d of s.dsts) setProd(d, i);
            break;
          case "demux":
            setCons(s.src, i);
            for (const f of s.fields) setProd(f.name, i);
            break;
          case "mux":
            for (const f of s.fields) setCons(f.name, i);
            setProd(s.dst, i);
            break;
          case "spawn":
          case "exec":
            for (const v of s.inputs) setCons(v, i);
            for (const v of s.outputs) setProd(v, i);
            break;
          case "switch": {
            const first = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
            const { cons, prod } = collectBlockIO(first, types);
            for (const v of cons) setCons(v, i);
            for (const v of prod) setProd(v, i);
            break;
          }
          case "spec":
            for (const v of s.inputs) setCons(v, i);
            for (const v of s.outputs) setProd(v, i);
            break;
        }
      }

      // Compute prefix-atomic / total channels within this block
      // A channel is in `prefixAtomic` if once it starts producing (no bit-0 match failure),
      // it can never fail mid-stream (so draining one of its product fields can never fail!).
      const totalHere = new Set(outerTotal);
      const prefixAtomic = new Set(outerTotal);
      let tChanged = true;
      while (tChanged) {
        tChanged = false;
        for (const s of cur) {
          switch (s.op) {
            case "const_unit":
              if (!totalHere.has(s.dst)) { totalHere.add(s.dst); prefixAtomic.add(s.dst); tChanged = true; }
              break;
            case "splice":
              if (totalHere.has(s.src) && !totalHere.has(s.dst)) { totalHere.add(s.dst); tChanged = true; }
              if (prefixAtomic.has(s.src) && !prefixAtomic.has(s.dst)) { prefixAtomic.add(s.dst); tChanged = true; }
              break;
            case "wrap":
              if (totalHere.has(s.src) && !totalHere.has(s.dst)) { totalHere.add(s.dst); tChanged = true; }
              if (prefixAtomic.has(s.src) && !prefixAtomic.has(s.dst)) { prefixAtomic.add(s.dst); tChanged = true; }
              break;
            case "match":
              // If src is total/prefix-atomic, `match /T src -> dst` either fails at bit 0 (failing all of dst)
              // or succeeds and streams a guaranteed-EOF payload!
              if (prefixAtomic.has(s.src) && !prefixAtomic.has(s.dst)) {
                prefixAtomic.add(s.dst);
                tChanged = true;
              }
              if (totalHere.has(s.src) && outerKnownTags.get(s.src) === s.tag && !totalHere.has(s.dst)) {
                totalHere.add(s.dst);
                tChanged = true;
              }
              break;
            case "tee":
              if (totalHere.has(s.src)) {
                for (const d of s.dsts) if (!totalHere.has(d)) { totalHere.add(d); tChanged = true; }
              }
              if (prefixAtomic.has(s.src)) {
                for (const d of s.dsts) if (!prefixAtomic.has(d)) { prefixAtomic.add(d); tChanged = true; }
              }
              break;
            case "demux":
              if (totalHere.has(s.src)) {
                for (const f of s.fields) if (!totalHere.has(f.name)) { totalHere.add(f.name); tChanged = true; }
              }
              if (prefixAtomic.has(s.src)) {
                for (const f of s.fields) if (!prefixAtomic.has(f.name)) { prefixAtomic.add(f.name); tChanged = true; }
              }
              break;
            case "mux":
              if (s.fields.every((f) => totalHere.has(f.name)) && !totalHere.has(s.dst)) {
                totalHere.add(s.dst);
                prefixAtomic.add(s.dst);
                tChanged = true;
              }
              break;
            case "spawn":
              if (totalProcs.has(s.target) && s.inputs.every((v) => totalHere.has(v))) {
                for (const o of s.outputs) if (!totalHere.has(o)) { totalHere.add(o); prefixAtomic.add(o); tChanged = true; }
              }
              break;
            case "exec": {
              const k = kernelMap.get(s.target);
              if (k && (k.attrs || []).includes("total") && s.inputs.every((v) => totalHere.has(v))) {
                for (const o of s.outputs) if (!totalHere.has(o)) { totalHere.add(o); prefixAtomic.add(o); tChanged = true; }
              }
              break;
            }
            case "gate": {
              // Check if all drains on s.barrier are totalHere? Keep conservative: only if gate src is total AND barrier drains total.
              break;
            }
          }
        }
      }

      // Collect all channel names declared inside nested blocks so we never cause shadowing during renames
      const nestedLocalChans = new Set();
      for (const s of cur) {
        if (s.op === "switch") {
          for (const a of s.arms) collectLocalDeclsDeep(a.body, nestedLocalChans);
          if (s.defaultBody) collectLocalDeclsDeep(s.defaultBody, nestedLocalChans);
        } else if (s.op === "spec") {
          for (const b of s.branches) collectLocalDeclsDeep(b.body, nestedLocalChans);
        }
      }

      // --- Rule 1: `splice %a -> %b` elimination ---
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op !== "splice") continue;
        const { src, dst } = s;
        if (src === dst) {
          cur = cur.filter((_, k) => k !== i);
          stats.splicesEliminated += 1;
          changed = true;
          break;
        }
        // Case 1a: `src` is a local chan (produced & consumed in this block) and `dst` doesn't shadow nested locals
        if (localDecls.has(src) && !nestedLocalChans.has(dst)) {
          const declIdx = localDecls.get(src).idx;
          // Ensure `dst` is declared before `prodAt.get(src)` if `dst` is local!
          const dstDecl = localDecls.get(dst);
          const srcProd = prodAt.get(src);
          if (!dstDecl || (srcProd !== undefined && dstDecl.idx < srcProd)) {
            const next = cur.filter((_, k) => k !== i && k !== declIdx);
            cur = renameStmtRefs(next, new Map([[src, dst]]));
            stats.splicesEliminated += 1;
            changed = true;
            break;
          }
          // If `dst` is local and declared after `srcProd`, hoist `chan dst` to `declIdx`!
          if (dstDecl && srcProd !== undefined) {
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === i || k === dstDecl.idx) continue;
              if (k === declIdx) next.push(dstDecl.stmt);
              else next.push(cur[k]);
            }
            cur = renameStmtRefs(next, new Map([[src, dst]]));
            stats.splicesEliminated += 1;
            changed = true;
            break;
          }
        }
        // Case 1b: `dst` is a local chan and `src` doesn't shadow nested locals
        if (localDecls.has(dst) && !nestedLocalChans.has(src)) {
          const declIdx = localDecls.get(dst).idx;
          const srcDecl = localDecls.get(src);
          const dstCons = consAt.get(dst);
          if (!srcDecl || (dstCons !== undefined && srcDecl.idx < dstCons)) {
            const next = cur.filter((_, k) => k !== i && k !== declIdx);
            cur = renameStmtRefs(next, new Map([[dst, src]]));
            stats.splicesEliminated += 1;
            changed = true;
            break;
          }
        }
      }
      if (changed) continue;

      // --- Rule 2: `mux -> demux` elimination ---
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op !== "mux" || !localDecls.has(s.dst)) continue;
        const cIdx = consAt.get(s.dst);
        if (cIdx === undefined) continue;
        const cs = cur[cIdx];
        if (cs.op !== "demux" || cs.src !== s.dst) continue;
        // Match fields 1-to-1 by label
        const srcByLabel = new Map(s.fields.map((f) => [f.label, f.name]));
        if (cs.fields.length !== srcByLabel.size) continue;
        if (!cs.fields.every((f) => srcByLabel.has(f.label))) continue;
        const declIdx = localDecls.get(s.dst).idx;
        const splices = cs.fields.map((f) => ({ op: "splice", src: srcByLabel.get(f.label), dst: f.name }));
        const next = [];
        for (let k = 0; k < cur.length; k++) {
          if (k === declIdx || k === i) continue;
          if (k === cIdx) next.push(...splices);
          else next.push(cur[k]);
        }
        cur = next;
        stats.muxDemuxEliminated += 1;
        changed = true;
        break;
      }
      if (changed) continue;

      // --- Rule 3: `wrap -> match` / `wrap -> drain` / `wrap -> switch` folding ---
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op !== "wrap" || !localDecls.has(s.dst)) continue;
        const cIdx = consAt.get(s.dst);
        if (cIdx === undefined) continue;
        const cs = cur[cIdx];
        const declIdx = localDecls.get(s.dst).idx;

        if (cs.op === "match" && cs.src === s.dst && cs.tag === s.tag) {
          const next = [];
          for (let k = 0; k < cur.length; k++) {
            if (k === declIdx || k === i) continue;
            if (k === cIdx) next.push({ op: "splice", src: s.src, dst: cs.dst });
            else next.push(cur[k]);
          }
          cur = next;
          stats.wrapFolds += 1;
          changed = true;
          break;
        }

        if (cs.op === "drain" && cs.src === s.dst && exprs.has(s.src)) {
          const next = [];
          for (let k = 0; k < cur.length; k++) {
            if (k === declIdx || k === i) continue;
            if (k === cIdx) next.push({ op: "drain", src: s.src, schema: cloneAst(exprs.get(s.src)), barrier: cs.barrier });
            else next.push(cur[k]);
          }
          cur = next;
          stats.wrapFolds += 1;
          changed = true;
          break;
        }

        if (cs.op === "switch" && cs.inputs.includes(s.dst)) {
          const col = cs.inputs.indexOf(s.dst);
          const simplified = foldSwitchColumn(cs, col, s.tag);
          if (simplified.changed) {
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === cIdx) {
                if (simplified.inlinedBody) next.push(...simplified.inlinedBody);
                else next.push(simplified.stmt);
              } else {
                next.push(cur[k]);
              }
            }
            cur = next;
            stats.wrapFolds += 1;
            changed = true;
            break;
          }
        }
      }
      if (changed) continue;

      // --- Rule 4: Trivial `const_unit -> drain`, `mux -> drain` splitting & empty `barrier`/`gate` removal ---
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op === "const_unit" && localDecls.has(s.dst)) {
          const cIdx = consAt.get(s.dst);
          if (cIdx !== undefined) {
            const cs = cur[cIdx];
            if (cs.op === "drain" && cs.src === s.dst) {
              const declIdx = localDecls.get(s.dst).idx;
              cur = cur.filter((_, k) => k !== declIdx && k !== i && k !== cIdx);
              stats.trivialDrainsEliminated += 1;
              changed = true;
              break;
            }
          }
        }
        if (s.op === "mux" && localDecls.has(s.dst)) {
          const cIdx = consAt.get(s.dst);
          if (cIdx !== undefined) {
            const cs = cur[cIdx];
            if (cs.op === "drain" && cs.src === s.dst && s.fields.every((f) => exprs.has(f.name))) {
              const declIdx = localDecls.get(s.dst).idx;
              const fieldDrains = s.fields.map((f) => ({
                op: "drain",
                src: f.name,
                schema: cloneAst(exprs.get(f.name)),
                barrier: cs.barrier
              }));
              const next = [];
              for (let k = 0; k < cur.length; k++) {
                if (k === declIdx || k === i) continue;
                if (k === cIdx) next.push(...fieldDrains);
                else next.push(cur[k]);
              }
              cur = next;
              stats.muxDemuxEliminated += 1;
              changed = true;
              break;
            }
          }
        }
      }
      if (changed) continue;

      // Remove empty local barriers & convert their `gate`s to `splice`s
      if (localBarriers.size > 0) {
        const drainCounts = collectBarrierDrainsDeep(cur);
        const deadBars = new Set();
        for (const [bName] of localBarriers.entries()) {
          if (!drainCounts.has(bName)) deadBars.add(bName);
        }
        if (deadBars.size > 0) {
          const next = cur.filter((s) => !(s.op === "barrier" && deadBars.has(s.name)));
          cur = replaceBarrierGatesDeep(next, deadBars);
          stats.trivialDrainsEliminated += deadBars.size;
          changed = true;
          continue;
        }
      }

      // --- Rule 5: `tee` Normalization, `match` Factoring, and Disjoint `demux` Collapse ---
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op !== "tee") continue;

        // 5a: Single-output tee -> splice
        if (s.dsts.length === 1) {
          cur = cur.map((st, k) => (k === i ? { op: "splice", src: s.src, dst: s.dsts[0] } : st));
          stats.splicesEliminated += 1;
          changed = true;
          break;
        }

        // 5b: `const_unit` -> `tee` => independent `const_unit`s
        if (localDecls.has(s.src)) {
          const pIdx = prodAt.get(s.src);
          if (pIdx !== undefined && cur[pIdx].op === "const_unit") {
            const declIdx = localDecls.get(s.src).idx;
            const repl = s.dsts.map((d) => ({ op: "const_unit", dst: d }));
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === declIdx || k === pIdx) continue;
              if (k === i) next.push(...repl);
              else next.push(cur[k]);
            }
            cur = next;
            stats.splicesEliminated += 1;
            changed = true;
            break;
          }
        }

        // 5b2: Chained `tee` flattening (`tee %x -> (..., %d, ...); tee %d -> (%e0, ...)`)
        {
          let flatIdx = -1;
          for (let j = 0; j < s.dsts.length; j++) {
            const d = s.dsts[j];
            if (localDecls.has(d) && consAt.has(d) && cur[consAt.get(d)].op === "tee" && cur[consAt.get(d)].src === d) {
              flatIdx = j;
              break;
            }
          }
          if (flatIdx >= 0) {
            const d = s.dsts[flatIdx];
            const cIdx = consAt.get(d);
            const innerTee = cur[cIdx];
            const removeIdx = new Set([localDecls.get(d).idx, cIdx]);
            const hoisted = [];
            for (const nd of innerTee.dsts) {
              if (localDecls.has(nd) && localDecls.get(nd).idx > i) {
                hoisted.push(localDecls.get(nd).stmt);
                removeIdx.add(localDecls.get(nd).idx);
              }
            }
            const mergedDsts = [
              ...s.dsts.slice(0, flatIdx),
              ...innerTee.dsts,
              ...s.dsts.slice(flatIdx + 1)
            ];
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === i) {
                next.push(...hoisted, { ...s, dsts: mergedDsts });
                continue;
              }
              if (removeIdx.has(k)) continue;
              next.push(cur[k]);
            }
            cur = next;
            stats.splicesEliminated += 1;
            changed = true;
            break;
          }
        }

        // 5e: Eliminate redundant direct `drain` output of a `tee` on a total stream
        // or in a strict-failure module (where the remaining kept copy still propagates any failure)!
        if (s.dsts.length >= 2 && (totalHere.has(s.src) || moduleStrictFailure)) {
          let drainDstIdx = -1;
          for (let j = 0; j < s.dsts.length; j++) {
            const d = s.dsts[j];
            if (localDecls.has(d) && consAt.has(d)) {
              const cs = cur[consAt.get(d)];
              if (cs.op === "drain" && cs.src === d) {
                drainDstIdx = j;
                break;
              }
            }
          }
          if (drainDstIdx >= 0) {
            const d = s.dsts[drainDstIdx];
            const removeIdx = new Set([localDecls.get(d).idx, consAt.get(d)]);
            const remDsts = s.dsts.filter((_, j) => j !== drainDstIdx);
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === i) {
                next.push({ ...s, dsts: remDsts });
                continue;
              }
              if (removeIdx.has(k)) continue;
              next.push(cur[k]);
            }
            cur = next;
            stats.trivialDrainsEliminated += 1;
            changed = true;
            break;
          }
        }

        // 5f: Push `tee %src -> (%chk, %keep)` into a 1-col `switch (%chk)` on lookahead identity filters
        // (so `case (/cons): demux + drain %cdr` exposes Rule 5d2 and avoids copying/draining %cdr!).
        if (s.dsts.length === 2 && (prefixAtomic.has(s.src) || moduleStrictFailure)) {
          let pushed = false;
          for (let side = 0; side < 2; side++) {
            const chk = s.dsts[side];
            const keep = s.dsts[1 - side];
            if (!localDecls.has(chk) || !consAt.has(chk)) continue;
            const swIdx = consAt.get(chk);
            const sw = cur[swIdx];
            if (sw.op !== "switch" || sw.inputs.length !== 1 || sw.inputs[0] !== chk || sw.defaultBody || sw.arms.length === 0) {
              continue;
            }
            if (localDecls.has(s.src) && localDecls.get(s.src).idx > swIdx) continue;
            if (countChanRefsDeep([sw], keep) !== 0) continue;
            const swLocals = collectLocalDeclsDeep([sw]).chanSet;
            if (swLocals.has(s.src) || swLocals.has(keep)) continue;

            const armInfos = [];
            let allMatch = true;
            let hasBenefit = false;
            for (const arm of sw.arms) {
              if (arm.patterns[0].kind !== "tag") { allMatch = false; break; }
              const tag = arm.patterns[0].tag;
              if (countChanRefsDeep(arm.body, chk) !== 1) { allMatch = false; break; }
              const mIdx = arm.body.findIndex((st) => st.op === "match" && st.src === chk && st.tag === tag);
              if (mIdx < 0) { allMatch = false; break; }
              const mName = arm.body[mIdx].dst;
              const mDeclIdx = arm.body.findIndex((st) => st.op === "chan" && st.name === mName);
              if (mDeclIdx < 0) { allMatch = false; break; }
              const mSchema = arm.body[mDeclIdx].schema;
              const mPl = resolvePlist(mSchema);
              const isUnit = Boolean(mPl && isUnitSchema(mPl));
              if (isUnit) hasBenefit = true;
              else if (mPl && mPl[0]?.[0] === "closed-product") {
                // Check if %m is consumed by a `demux` (exposing Rule 5d2 and inner bit switches!)
                const dm = arm.body.find((st) => st.op === "demux" && st.src === mName);
                if (dm) hasBenefit = true;
              } else if (arm.body.some((st) => st.op === "drain" && st.src === mName)) {
                // Non-unit directly drained payload (exposes Rule 5e to delete the tee+drain!)
                hasBenefit = true;
              }
              armInfos.push({ arm, tag, mIdx, mDeclIdx, mName, mSchema, isUnit });
            }
            if (!allMatch || !hasBenefit) continue;

            const newArms = armInfos.map(({ arm, tag, mIdx, mName, mSchema, isUnit }) => {
              const newBody = [];
              for (let k = 0; k < arm.body.length; k++) {
                if (k === mIdx) {
                  if (isUnit) {
                    const uk = nextFresh("tsu");
                    newBody.push({ op: "match", tag, src: s.src, dst: mName });
                    newBody.push({ op: "chan", name: uk, schema: cloneAst(mSchema) });
                    newBody.push({ op: "const_unit", dst: uk });
                    newBody.push({ op: "wrap", tag, src: uk, dst: keep });
                  } else {
                    const mRaw = nextFresh("tsm");
                    const mKeep = nextFresh("tsk");
                    newBody.push({ op: "chan", name: mRaw, schema: cloneAst(mSchema) });
                    newBody.push({ op: "match", tag, src: s.src, dst: mRaw });
                    newBody.push({ op: "chan", name: mKeep, schema: cloneAst(mSchema) });
                    newBody.push({ op: "tee", src: mRaw, dsts: [mName, mKeep] });
                    newBody.push({ op: "wrap", tag, src: mKeep, dst: keep });
                  }
                } else {
                  newBody.push(arm.body[k]);
                }
              }
              return { ...arm, body: newBody };
            });

            const removeIdx = new Set([i, localDecls.get(chk).idx]);
            const hoistedKeep = [];
            if (localDecls.has(keep) && localDecls.get(keep).idx > swIdx) {
              hoistedKeep.push(localDecls.get(keep).stmt);
              removeIdx.add(localDecls.get(keep).idx);
            }
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === swIdx) {
                next.push(...hoistedKeep, { ...sw, inputs: [s.src], arms: newArms });
                continue;
              }
              if (removeIdx.has(k)) continue;
              next.push(cur[k]);
            }
            cur = next;
            stats.teeMatchFactors += 1;
            changed = true;
            pushed = true;
            break;
          }
          if (pushed) break;
        }

        // 5c: Common `match /T` factoring across ALL tee outputs!
        if (s.dsts.every((d) => localDecls.has(d) && consAt.has(d))) {
          const consumers = s.dsts.map((d) => ({ d, idx: consAt.get(d), st: cur[consAt.get(d)] }));
          if (consumers.every((c) => c.st.op === "match" && c.st.src === c.d && c.st.tag === consumers[0].st.tag)) {
            const tag = consumers[0].st.tag;
            const payloadExpr = exprs.get(consumers[0].st.dst);
            if (payloadExpr) {
              const sharedName = nextFresh("tm");
              const removeIdx = new Set([i]);
              const hoisted = [];
              for (const c of consumers) {
                removeIdx.add(localDecls.get(c.d).idx);
                removeIdx.add(c.idx);
                if (localDecls.has(c.st.dst) && localDecls.get(c.st.dst).idx > i) {
                  hoisted.push(localDecls.get(c.st.dst).stmt);
                  removeIdx.add(localDecls.get(c.st.dst).idx);
                }
              }
              const inserted = [
                ...hoisted,
                { op: "chan", name: sharedName, schema: cloneAst(payloadExpr) },
                { op: "match", tag, src: s.src, dst: sharedName },
                { op: "tee", src: sharedName, dsts: consumers.map((c) => c.st.dst) }
              ];
              // Place inserted statements at the earliest consumer / tee position (after `s.src` is declared)
              const next = [];
              let didInsert = false;
              for (let k = 0; k < cur.length; k++) {
                if (k === i) {
                  next.push(...inserted);
                  didInsert = true;
                  continue;
                }
                if (removeIdx.has(k)) continue;
                next.push(cur[k]);
              }
              if (didInsert) {
                cur = next;
                stats.teeMatchFactors += 1;
                changed = true;
                break;
              }
            }
          }

          // 5d: Prefix-atomic or strict-failure `tee -> all demux` collapse (O(N^2) -> O(N)!)
          if (
            (prefixAtomic.has(s.src) || moduleStrictFailure) &&
            consumers.every((c) => c.st.op === "demux" && c.st.src === c.d)
          ) {
            const baseSchema = consumers[0].st.schema;
            const fieldOrder = consumers[0].st.fields.map((f) => f.label);
            const sameShape = consumers.every(
              (c) =>
                c.st.fields.length === fieldOrder.length &&
                c.st.fields.every((f, fi) => f.label === fieldOrder[fi])
            );
            if (sameShape) {
              // Identify for each side & field whether it is directly drained in this block
              const sideFieldInfo = consumers.map((c) => {
                const byLabel = new Map();
                for (const f of c.st.fields) {
                  const fcIdx = consAt.get(f.name);
                  const fc = fcIdx !== undefined ? cur[fcIdx] : null;
                  const isDirectDrain = Boolean(localDecls.has(f.name) && fc && fc.op === "drain" && fc.src === f.name);
                  byLabel.set(f.label, { chan: f.name, isDirectDrain, drainIdx: isDirectDrain ? fcIdx : -1, drainStmt: isDirectDrain ? fc : null });
                }
                return byLabel;
              });

              // Only fire if at least one field is drained on at least one side (or avoided copying!)
              let keptTargetsByLabel = new Map();
              let hasAnyBenefit = false;
              for (const lbl of fieldOrder) {
                const kept = [];
                let drainCount = 0;
                for (const fm of sideFieldInfo) {
                  const info = fm.get(lbl);
                  if (info.isDirectDrain) drainCount += 1;
                  else kept.push(info.chan);
                }
                if (drainCount > 0 || kept.length < consumers.length) hasAnyBenefit = true;
                keptTargetsByLabel.set(lbl, kept);
              }

              if (hasAnyBenefit) {
                const removeIdx = new Set([i]);
                for (const c of consumers) {
                  removeIdx.add(localDecls.get(c.d).idx);
                  removeIdx.add(c.idx);
                }

                const extraDecls = [];
                const newDemuxFields = [];
                const postDemuxStmts = [];
                const hoistedBarriers = new Set();

                for (const lbl of fieldOrder) {
                  const kept = keptTargetsByLabel.get(lbl);
                  const sampleChan = sideFieldInfo[0].get(lbl).chan;
                  const fieldExpr = exprs.get(sampleChan);

                  if (kept.length === 0) {
                    const firstDrain = sideFieldInfo[0].get(lbl);
                    const fresh = nextFresh("td");
                    extraDecls.push({ op: "chan", name: fresh, schema: cloneAst(fieldExpr) });
                    newDemuxFields.push({ label: lbl, name: fresh });
                    const barName = firstDrain.drainStmt.barrier;
                    if (barName && localBarriers.has(barName) && localBarriers.get(barName) > i) {
                      hoistedBarriers.add(barName);
                      removeIdx.add(localBarriers.get(barName));
                    }
                    postDemuxStmts.push({
                      op: "drain",
                      src: fresh,
                      schema: cloneAst(firstDrain.drainStmt.schema),
                      barrier: barName
                    });
                    for (const fm of sideFieldInfo) {
                      const info = fm.get(lbl);
                      removeIdx.add(localDecls.get(info.chan).idx);
                      removeIdx.add(info.drainIdx);
                    }
                  } else if (kept.length === 1) {
                    // Kept on ONLY ONE side -> ZERO tee, ZERO drain!
                    newDemuxFields.push({ label: lbl, name: kept[0] });
                    for (const fm of sideFieldInfo) {
                      const info = fm.get(lbl);
                      if (info.isDirectDrain) {
                        removeIdx.add(localDecls.get(info.chan).idx);
                        removeIdx.add(info.drainIdx);
                      }
                    }
                  } else {
                    // Kept on 2+ sides -> tee ONLY this field!
                    const fresh = nextFresh("tf");
                    extraDecls.push({ op: "chan", name: fresh, schema: cloneAst(fieldExpr) });
                    newDemuxFields.push({ label: lbl, name: fresh });
                    postDemuxStmts.push({ op: "tee", src: fresh, dsts: kept });
                    for (const fm of sideFieldInfo) {
                      const info = fm.get(lbl);
                      if (info.isDirectDrain) {
                        removeIdx.add(localDecls.get(info.chan).idx);
                        removeIdx.add(info.drainIdx);
                      }
                    }
                  }
                }

                // Make sure all kept field `chan` and `barrier` declarations precede the new `demux`!
                const hoistedKeptChans = new Set();
                for (const lbl of fieldOrder) {
                  for (const ch of keptTargetsByLabel.get(lbl)) {
                    if (localDecls.has(ch) && localDecls.get(ch).idx > i) {
                      hoistedKeptChans.add(ch);
                      removeIdx.add(localDecls.get(ch).idx);
                    }
                  }
                }
                const hoistedDecls = [
                  ...[...hoistedBarriers].map((b) => cur[localBarriers.get(b)]),
                  ...[...hoistedKeptChans].map((ch) => localDecls.get(ch).stmt)
                ];

                const inserted = [
                  ...hoistedDecls,
                  ...extraDecls,
                  { op: "demux", src: s.src, schema: cloneAst(baseSchema), fields: newDemuxFields },
                  ...postDemuxStmts
                ];

                const next = [];
                for (let k = 0; k < cur.length; k++) {
                  if (k === i) {
                    next.push(...inserted);
                    continue;
                  }
                  if (removeIdx.has(k)) continue;
                  next.push(cur[k]);
                }
                cur = next;
                stats.teeDemuxCollapses += 1;
                changed = true;
                break;
              }
            }
          }
        }

        // 5d2: Partial `tee -> (demux+drain, passthrough)` product reconstruction
        // (avoids tee+draining untouched product fields like `cdr` in lookahead filters!)
        if (
          !changed &&
          s.dsts.length >= 2 &&
          (prefixAtomic.has(s.src) || moduleStrictFailure) &&
          types.get(s.src)?.[0]?.[0] === "closed-product"
        ) {
          const demuxSides = [];
          const passSides = [];
          for (const d of s.dsts) {
            if (localDecls.has(d) && consAt.has(d) && cur[consAt.get(d)].op === "demux" && cur[consAt.get(d)].src === d) {
              demuxSides.push({ d, idx: consAt.get(d), st: cur[consAt.get(d)] });
            } else {
              passSides.push(d);
            }
          }
          if (demuxSides.length >= 1 && passSides.length >= 1) {
            const baseSchema = demuxSides[0].st.schema;
            const fieldOrder = demuxSides[0].st.fields.map((f) => f.label);
            const sameShape = demuxSides.every(
              (c) =>
                c.st.fields.length === fieldOrder.length &&
                c.st.fields.every((f, fi) => f.label === fieldOrder[fi])
            );
            if (sameShape) {
              const sideFieldInfo = demuxSides.map((c) => {
                const byLabel = new Map();
                for (const f of c.st.fields) {
                  const fcIdx = consAt.get(f.name);
                  const fc = fcIdx !== undefined ? cur[fcIdx] : null;
                  const isDirectDrain = Boolean(localDecls.has(f.name) && fc && fc.op === "drain" && fc.src === f.name);
                  byLabel.set(f.label, { chan: f.name, isDirectDrain, drainIdx: isDirectDrain ? fcIdx : -1 });
                }
                return byLabel;
              });
              const hasDrainedField = fieldOrder.some((lbl) =>
                sideFieldInfo.some((fm) => fm.get(lbl).isDirectDrain)
              );
              // Also distribute `tee -> (demux, passthrough)` when all fields are small closed-unions
              // (e.g. 7-bit `ascii[]`) inspected by a `switch`, exposing top-level `demux` + bit guards to `spec -> switch`!
              const exposesBitSwitch =
                !hasDrainedField &&
                fieldOrder.length >= 2 &&
                fieldOrder.length <= 8 &&
                demuxSides.length === 1 &&
                fieldOrder.every((lbl) => {
                  const fPl = types.get(sideFieldInfo[0].get(lbl).chan);
                  const tags = unionTagsOf(fPl);
                  return Boolean(tags && tags.length <= 4);
                }) &&
                cur.some((st) => st.op === "switch" && st.inputs.some((inp) =>
                  fieldOrder.some((lbl) => sideFieldInfo[0].get(lbl).chan === inp)
                ));
              if (hasDrainedField || exposesBitSwitch) {
                const removeIdx = new Set([i]);
                for (const c of demuxSides) {
                  removeIdx.add(localDecls.get(c.d).idx);
                  removeIdx.add(c.idx);
                }
                const hoistedChans = new Set();
                for (const dp of passSides) {
                  if (localDecls.has(dp) && localDecls.get(dp).idx > i) {
                    hoistedChans.add(dp);
                    removeIdx.add(localDecls.get(dp).idx);
                  }
                }

                const extraDecls = [];
                const newDemuxFields = [];
                const postStmts = [];
                const passFieldChans = passSides.map(() => new Map());

                for (const lbl of fieldOrder) {
                  const sampleChan = sideFieldInfo[0].get(lbl).chan;
                  const fieldExpr = exprs.get(sampleChan);
                  const targets = [];
                  for (const fm of sideFieldInfo) {
                    const info = fm.get(lbl);
                    if (info.isDirectDrain) {
                      removeIdx.add(localDecls.get(info.chan).idx);
                      removeIdx.add(info.drainIdx);
                    } else {
                      targets.push(info.chan);
                      if (localDecls.has(info.chan) && localDecls.get(info.chan).idx > i) {
                        hoistedChans.add(info.chan);
                        removeIdx.add(localDecls.get(info.chan).idx);
                      }
                    }
                  }
                  for (let p = 0; p < passSides.length; p++) {
                    const pc = nextFresh("tp");
                    extraDecls.push({ op: "chan", name: pc, schema: cloneAst(fieldExpr) });
                    passFieldChans[p].set(lbl, pc);
                    targets.push(pc);
                  }
                  if (targets.length === 1) {
                    newDemuxFields.push({ label: lbl, name: targets[0] });
                  } else {
                    const raw = nextFresh("tf");
                    extraDecls.push({ op: "chan", name: raw, schema: cloneAst(fieldExpr) });
                    newDemuxFields.push({ label: lbl, name: raw });
                    postStmts.push({ op: "tee", src: raw, dsts: targets });
                  }
                }
                for (let p = 0; p < passSides.length; p++) {
                  postStmts.push({
                    op: "mux",
                    fields: fieldOrder.map((lbl) => ({ label: lbl, name: passFieldChans[p].get(lbl) })),
                    dst: passSides[p],
                    schema: cloneAst(baseSchema)
                  });
                }

                const hoistedDecls = [...hoistedChans].map((ch) => localDecls.get(ch).stmt);
                const inserted = [
                  ...hoistedDecls,
                  ...extraDecls,
                  { op: "demux", src: s.src, schema: cloneAst(baseSchema), fields: newDemuxFields },
                  ...postStmts
                ];

                const next = [];
                for (let k = 0; k < cur.length; k++) {
                  if (k === i) {
                    next.push(...inserted);
                    continue;
                  }
                  if (removeIdx.has(k)) continue;
                  next.push(cur[k]);
                }
                cur = next;
                stats.teeDemuxCollapses += 1;
                changed = true;
                break;
              }
            }
          }
        }
      }
      if (changed) continue;

      // --- Rule 6: Fold nested `switch` whose input tag is already statically known ---
      if (outerKnownTags.size > 0) {
        for (let i = 0; i < cur.length; i++) {
          const s = cur[i];
          if (s.op !== "switch") continue;
          let folded = null;
          for (let j = 0; j < s.inputs.length; j++) {
            const knownTag = outerKnownTags.get(s.inputs[j]);
            if (knownTag !== undefined) {
              const res = foldSwitchColumn(s, j, knownTag);
              if (res.changed) {
                folded = res;
                break;
              }
            }
          }
          if (folded) {
            const next = [];
            for (let k = 0; k < cur.length; k++) {
              if (k === i) {
                if (folded.inlinedBody) next.push(...folded.inlinedBody);
                else next.push(folded.stmt);
              } else {
                next.push(cur[k]);
              }
            }
            cur = next;
            stats.knownSwitchFolds += 1;
            changed = true;
            break;
          }
        }
        if (changed) continue;
      }

      // No more top-level rewrites in this block -> exit fixpoint loop!
      break;
    }

    // Recurse into `switch` and `spec` child blocks ONCE after outer block settles
    const types = new Map(outerTypes);
    const exprs = new Map(outerExprs);
    const totalHere = new Set(outerTotal);
    for (const s of cur) {
      if (s.op === "chan") {
        types.set(s.name, resolvePlist(s.schema));
        exprs.set(s.name, s.schema);
      } else if (s.op === "const_unit") {
        totalHere.add(s.dst);
      } else if ((s.op === "splice" || s.op === "wrap") && totalHere.has(s.src)) {
        totalHere.add(s.dst);
      } else if (s.op === "tee" && totalHere.has(s.src)) {
        for (const d of s.dsts) totalHere.add(d);
      } else if (s.op === "demux" && totalHere.has(s.src)) {
        for (const f of s.fields) totalHere.add(f.name);
      } else if (s.op === "mux" && s.fields.every((f) => totalHere.has(f.name))) {
        totalHere.add(s.dst);
      } else if (s.op === "spawn" && totalProcs.has(s.target) && s.inputs.every((v) => totalHere.has(v))) {
        for (const o of s.outputs) totalHere.add(o);
      } else if (s.op === "match" && totalHere.has(s.src) && outerKnownTags.get(s.src) === s.tag) {
        totalHere.add(s.dst);
      }
    }

    return cur.map((s) => {
      if (s.op === "switch") {
        const first = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
        const { cons: swCons, prod: swProd } = collectBlockIO(first, types);
        const newArms = s.arms.map((arm) => {
          const armKnown = new Map(outerKnownTags);
          for (let j = 0; j < arm.patterns.length; j++) {
            if (arm.patterns[j].kind === "tag") armKnown.set(s.inputs[j], arm.patterns[j].tag);
          }
          return { ...arm, body: deforestBlock(arm.body, types, exprs, swCons, swProd, totalHere, armKnown) };
        });
        const newDef = s.defaultBody
          ? deforestBlock(s.defaultBody, types, exprs, swCons, swProd, totalHere, outerKnownTags)
          : null;
        return { ...s, arms: newArms, defaultBody: newDef };
      }
      if (s.op === "spec") {
        const specTypes = new Map();
        const specExprs = new Map();
        const specTotal = new Set();
        const specKnown = new Map();
        for (const v of [...s.inputs, ...s.outputs]) {
          specTypes.set(v, types.get(v));
          specExprs.set(v, exprs.get(v));
        }
        for (const v of s.inputs) {
          if (totalHere.has(v)) specTotal.add(v);
          if (outerKnownTags.has(v)) specKnown.set(v, outerKnownTags.get(v));
        }
        return {
          ...s,
          branches: s.branches.map((br) => ({
            ...br,
            body: deforestBlock(br.body, specTypes, specExprs, new Set(s.inputs), new Set(s.outputs), specTotal, specKnown)
          }))
        };
      }
      return s;
    });
  }

  function foldSwitchColumn(sw, col, tag) {
    const newArms = [];
    let anyModified = false;
    for (const arm of sw.arms) {
      const p = arm.patterns[col];
      if (p.kind === "tag") {
        anyModified = true;
        if (p.tag !== tag) continue; // unreachable arm
        const pats = arm.patterns.map((x, j) => (j === col ? { kind: "wild" } : x));
        newArms.push({ ...arm, patterns: pats });
      } else {
        newArms.push(arm);
      }
    }
    if (!anyModified) return { changed: false };

    // If the first surviving arm has ALL wildcards, inline it directly!
    if (newArms.length > 0 && newArms[0].patterns.every((p) => p.kind === "wild")) {
      return { changed: true, inlinedBody: newArms[0].body };
    }
    if (newArms.length === 0 && sw.defaultBody) {
      return { changed: true, inlinedBody: sw.defaultBody };
    }
    if (newArms.length === 0) {
      // Never emit a 0-arm switch without defaultBody (would lose SPSC IO signature)
      return { changed: false };
    }

    // Drop column `col` if no remaining arm tests it (and there is at least 1 other column)
    if (sw.inputs.length > 1 && newArms.every((a) => a.patterns[col].kind === "wild")) {
      return {
        changed: true,
        stmt: {
          ...sw,
          inputs: sw.inputs.filter((_, j) => j !== col),
          arms: newArms.map((a) => ({ ...a, patterns: a.patterns.filter((_, j) => j !== col) }))
        }
      };
    }

    return { changed: true, stmt: { ...sw, arms: newArms } };
  }

  return { module: { ...mod, procs }, stats };
}

// ---------------------------------------------------------------------------
// Pass 3: Multi-Column Deterministic `spec -> switch` Compilation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sound Backward Entry-Guard Analysis (Interprocedural, Non-Cyclic & Cyclic)
// ---------------------------------------------------------------------------

const GUARD_TOP = Object.freeze({ kind: "top" });
const GUARD_EMPTY = Object.freeze({ kind: "empty" });

const bitprodCache = new WeakMap();

function bitprodInfoOf(pl) {
  if (!pl || !pl[0]) return null;
  if (bitprodCache.has(pl)) return bitprodCache.get(pl);
  let res = null;
  if (pl[0][0] === "closed-product") {
    const fields = productFields(pl, 0);
    if (fields.length >= 2 && fields.length <= 8) {
      const labels = [];
      const allTags = [];
      let grid = 1;
      let ok = true;
      for (const f of fields) {
        const fnode = pl[f.targetId];
        if (!fnode || fnode[0] !== "closed-union") {
          ok = false;
          break;
        }
        const edges = fnode[1];
        if (!edges || edges.length === 0 || edges.length > 16) {
          ok = false;
          break;
        }
        // ONLY represent a closed product as flat `bitprod` when every field is a
        // pure unit-payload enum (e.g. `bit`), so nested payload guards (like `cons.car.ascii`)
        // are NEVER flattened away!
        if (!edges.every(([, tid]) => isUnitSchema(pl, tid))) {
          ok = false;
          break;
        }
        const ft = edges.map(([tag]) => tag);
        grid *= ft.length;
        if (grid > 256) {
          ok = false;
          break;
        }
        labels.push(f.label);
        allTags.push(ft);
      }
      if (ok) res = { labels, allTags, grid };
    }
  }
  bitprodCache.set(pl, res);
  return res;
}

function guardEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "top" || a.kind === "empty") return true;
  if (a.kind === "union") {
    if (a.mustInspect !== b.mustInspect || a.tags.size !== b.tags.size) return false;
    for (const [t, sa] of a.tags.entries()) {
      if (!b.tags.has(t) || !guardEqual(sa, b.tags.get(t))) return false;
    }
    return true;
  }
  if (a.kind === "product") {
    if (a.fields.size !== b.fields.size) return false;
    for (const [l, fa] of a.fields.entries()) {
      if (!b.fields.has(l) || !guardEqual(fa, b.fields.get(l))) return false;
    }
    return true;
  }
  if (a.kind === "bitprod") {
    if (a.mustInspect !== b.mustInspect || a.allowed.size !== b.allowed.size) return false;
    if (a.labels.length !== b.labels.length) return false;
    for (let i = 0; i < a.labels.length; i++) if (a.labels[i] !== b.labels[i]) return false;
    for (const k of a.allowed) if (!b.allowed.has(k)) return false;
    return true;
  }
  return false;
}

function downgradeMustInspect(g) {
  if (!g || g.kind === "top" || g.kind === "empty") return g || GUARD_TOP;
  if (g.kind === "union") {
    if (!g.mustInspect) return g;
    return { kind: "union", tags: g.tags, mustInspect: false };
  }
  if (g.kind === "bitprod") {
    if (!g.mustInspect) return g;
    if (g.allowed.size >= g.grid) return GUARD_TOP;
    return { ...g, mustInspect: false };
  }
  return g;
}

function promoteProductToBitprod(pr, bpInfo) {
  const colTags = [];
  let anyInspected = false;
  for (let i = 0; i < bpInfo.labels.length; i++) {
    const lbl = bpInfo.labels[i];
    const fg = pr.fields.get(lbl);
    if (fg && fg.kind === "empty") return GUARD_EMPTY;
    if (fg && fg.kind === "union") {
      if (fg.mustInspect) anyInspected = true;
      const filt = bpInfo.allTags[i].filter((t) => fg.tags.has(t));
      if (filt.length === 0) return GUARD_EMPTY;
      colTags.push(filt);
    } else {
      colTags.push(bpInfo.allTags[i]);
    }
  }
  const allowed = new Set();
  const cur = new Array(colTags.length);
  const build = (idx) => {
    if (idx === colTags.length) {
      allowed.add(cur.join("\x00"));
      return;
    }
    for (const t of colTags[idx]) {
      cur[idx] = t;
      build(idx + 1);
    }
  };
  build(0);
  if (allowed.size === 0) return GUARD_EMPTY;
  if (allowed.size >= bpInfo.grid && !anyInspected) return GUARD_TOP;
  return {
    kind: "bitprod",
    labels: bpInfo.labels,
    allTags: bpInfo.allTags,
    grid: bpInfo.grid,
    allowed,
    mustInspect: anyInspected
  };
}

function guardAnd(g1, g2) {
  if (!g1 || g1.kind === "top") return g2 || GUARD_TOP;
  if (!g2 || g2.kind === "top") return g1;
  if (g1.kind === "empty" || g2.kind === "empty") return GUARD_EMPTY;
  if (g1.kind === "union" && g2.kind === "union") {
    const tags = new Map();
    for (const [t, s1] of g1.tags.entries()) {
      if (!g2.tags.has(t)) continue;
      const sub = guardAnd(s1, g2.tags.get(t));
      if (sub.kind !== "empty") tags.set(t, sub);
    }
    if (tags.size === 0) return GUARD_EMPTY;
    return { kind: "union", tags, mustInspect: g1.mustInspect || g2.mustInspect };
  }
  if (g1.kind === "product" && g2.kind === "product") {
    const fields = new Map(g1.fields);
    for (const [lbl, f2] of g2.fields.entries()) {
      const sub = fields.has(lbl) ? guardAnd(fields.get(lbl), f2) : f2;
      if (sub.kind === "empty") return GUARD_EMPTY;
      if (sub.kind !== "top") fields.set(lbl, sub);
    }
    if (fields.size === 0) return GUARD_TOP;
    return { kind: "product", fields };
  }
  if (g1.kind === "bitprod" && g2.kind === "bitprod") {
    if (g1.labels.length !== g2.labels.length || g1.labels.some((l, i) => l !== g2.labels[i])) {
      return g1;
    }
    const allowed = new Set();
    for (const k of g1.allowed) if (g2.allowed.has(k)) allowed.add(k);
    if (allowed.size === 0) return GUARD_EMPTY;
    return {
      kind: "bitprod",
      labels: g1.labels,
      allTags: g1.allTags,
      grid: g1.grid,
      allowed,
      mustInspect: g1.mustInspect || g2.mustInspect
    };
  }
  if (
    (g1.kind === "bitprod" && g2.kind === "product") ||
    (g1.kind === "product" && g2.kind === "bitprod")
  ) {
    const bp = g1.kind === "bitprod" ? g1 : g2;
    const pr = g1.kind === "product" ? g1 : g2;
    const bp2 = promoteProductToBitprod(pr, bp);
    return guardAnd(bp, bp2);
  }
  return g1;
}

function guardOr(g1, g2) {
  if (!g1 || g1.kind === "top" || !g2 || g2.kind === "top") return GUARD_TOP;
  if (g1.kind === "empty") return g2;
  if (g2.kind === "empty") return g1;
  if (g1.kind === "union" && g2.kind === "union") {
    const tags = new Map();
    for (const [t, s1] of g1.tags.entries()) {
      tags.set(t, g2.tags.has(t) ? guardOr(s1, g2.tags.get(t)) : s1);
    }
    for (const [t, s2] of g2.tags.entries()) {
      if (!tags.has(t)) tags.set(t, s2);
    }
    return { kind: "union", tags, mustInspect: g1.mustInspect && g2.mustInspect };
  }
  if (g1.kind === "product" && g2.kind === "product") {
    const fields = new Map();
    for (const [lbl, f1] of g1.fields.entries()) {
      if (!g2.fields.has(lbl)) continue;
      const sub = guardOr(f1, g2.fields.get(lbl));
      if (sub.kind !== "top") fields.set(lbl, sub);
    }
    if (fields.size === 0) return GUARD_TOP;
    return { kind: "product", fields };
  }
  if (g1.kind === "bitprod" && g2.kind === "bitprod") {
    if (g1.labels.length !== g2.labels.length || g1.labels.some((l, i) => l !== g2.labels[i])) {
      return GUARD_TOP;
    }
    const allowed = new Set(g1.allowed);
    for (const k of g2.allowed) allowed.add(k);
    const mustInspect = g1.mustInspect && g2.mustInspect;
    if (allowed.size >= g1.grid && !mustInspect) return GUARD_TOP;
    return {
      kind: "bitprod",
      labels: g1.labels,
      allTags: g1.allTags,
      grid: g1.grid,
      allowed,
      mustInspect
    };
  }
  if (
    (g1.kind === "bitprod" && g2.kind === "product") ||
    (g1.kind === "product" && g2.kind === "bitprod")
  ) {
    const bp = g1.kind === "bitprod" ? g1 : g2;
    const pr = g1.kind === "product" ? g1 : g2;
    const bp2 = promoteProductToBitprod(pr, bp);
    return guardOr(bp, bp2);
  }
  return GUARD_TOP;
}

function analyzeBlockReq(stmts, postReq, outerTypes, procGuards, resolvePlist, strictFailure, depth = 0) {
  if (depth > 8) return { dead: false, req: new Map(postReq), tupleConstraints: [] };

  const types = new Map(outerTypes);
  const localChans = new Set();
  for (const s of stmts || []) {
    if (s.op === "chan") {
      if (!outerTypes.has(s.name)) localChans.add(s.name);
      types.set(s.name, resolvePlist(s.schema));
    }
  }

  const req = new Map();
  for (const [k, v] of postReq.entries()) {
    if (v && v.kind !== "top") req.set(k, v);
  }
  const tcByKey = new Map(); // chans.join("\x00") -> { chans, allTags, grid, allowed, mustInspect }

  const tighten = (ch, g) => {
    if (!g || g.kind === "top") return { changed: false, dead: false };
    if (g.kind === "empty") return { changed: true, dead: true };
    const prev = req.get(ch);
    const next = prev ? guardAnd(prev, g) : g;
    if (next.kind === "empty") return { changed: true, dead: true };
    if (prev && guardEqual(prev, next)) return { changed: false, dead: false };
    req.set(ch, next);
    return { changed: true, dead: false };
  };

  const addTupleConstraint = (chans, allTags, grid, allowed, mustInspect) => {
    if (allowed.size === 0) return { changed: true, dead: true };
    const key = chans.join("\x00");
    const prev = tcByKey.get(key);
    let nextAllowed = allowed;
    let nextMust = mustInspect;
    if (prev) {
      nextAllowed = new Set();
      for (const t of prev.allowed) if (allowed.has(t)) nextAllowed.add(t);
      if (nextAllowed.size === 0) return { changed: true, dead: true };
      nextMust = prev.mustInspect || mustInspect;
      if (nextAllowed.size === prev.allowed.size && nextMust === prev.mustInspect) {
        return { changed: false, dead: false };
      }
    }
    tcByKey.set(key, { chans, allTags, grid, allowed: nextAllowed, mustInspect: nextMust });
    // Also project marginals onto `req[chans[j]]`
    let anyChanged = true;
    for (let j = 0; j < chans.length; j++) {
      const mTags = new Map();
      for (const tk of nextAllowed) {
        const t = tk.split("\x00")[j];
        if (!mTags.has(t)) mTags.set(t, GUARD_TOP);
      }
      const tr = tighten(chans[j], { kind: "union", tags: mTags, mustInspect: nextMust });
      if (tr.dead) return { changed: true, dead: true };
    }
    return { changed: anyChanged, dead: false };
  };

  const remapTupleConstraints = (fromCh, toCh) => {
    let changed = false;
    const snapshot = [...tcByKey.values()];
    for (const tc of snapshot) {
      if (!tc.chans.includes(fromCh)) continue;
      const newChans = tc.chans.map((c) => (c === fromCh ? toCh : c));
      // Only remap if all mapped channels remain distinct
      if (new Set(newChans).size !== newChans.length) continue;
      const tr = addTupleConstraint(newChans, tc.allTags, tc.grid, tc.allowed, tc.mustInspect);
      if (tr.dead) return { changed: true, dead: true };
      if (tr.changed) changed = true;
    }
    return { changed, dead: false };
  };

  const tuplePassesTcList = (t, cols, tcList) => {
    for (const tc of tcList) {
      const colMap = tc.chans.map((c) => cols.indexOf(c));
      if (colMap.every((idx) => idx >= 0)) {
        const key = colMap.map((idx) => t[idx]).join("\x00");
        if (!tc.allowed.has(key)) return false;
      } else if (colMap.some((idx) => idx >= 0)) {
        let anyOk = false;
        for (const tk of tc.allowed) {
          const parts = tk.split("\x00");
          let ok = true;
          for (let k = 0; k < colMap.length; k++) {
            if (colMap[k] >= 0 && parts[k] !== t[colMap[k]]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            anyOk = true;
            break;
          }
        }
        if (!anyOk) return false;
      }
    }
    return true;
  };

  const subPostMapsEqual = (a, b) => {
    if (!a || !b || a.size !== b.size) return false;
    for (const [k, va] of a.entries()) {
      if (!b.has(k) || !guardEqual(va, b.get(k))) return false;
    }
    return true;
  };
  const lastControlPost = new Map(); // stmtIndex -> Map<chan, Guard>

  // Detect whether any statement consumes a local channel before its producer appears in `stmts`.
  // When strictly def-before-use (>99% of blocks), 1 backward pass is already the exact fixpoint!
  let maxIter = 1;
  if ((stmts || []).length >= 2 && localChans.size > 0) {
    const producedSoFar = new Set();
    const markProd = (c) => {
      if (localChans.has(c)) producedSoFar.add(c);
    };
    const checkCons = (c) => localChans.has(c) && !producedSoFar.has(c);
    for (const s of stmts) {
      let ooo = false;
      switch (s.op) {
        case "drain":
          ooo = checkCons(s.src);
          break;
        case "gate":
        case "splice":
        case "coerce":
        case "wrap":
        case "match":
          ooo = checkCons(s.src);
          markProd(s.dst);
          break;
        case "const_unit":
          markProd(s.dst);
          break;
        case "tee":
          ooo = checkCons(s.src);
          for (const d of s.dsts) markProd(d);
          break;
        case "demux":
          ooo = checkCons(s.src);
          for (const f of s.fields) markProd(f.name);
          break;
        case "mux":
          ooo = s.fields.some((f) => checkCons(f.name));
          markProd(s.dst);
          break;
        case "spawn":
        case "exec":
        case "spec":
          ooo = (s.inputs || []).some(checkCons);
          for (const o of s.outputs || []) markProd(o);
          break;
        case "switch": {
          const io = collectBlockIO(s.arms.length > 0 ? s.arms[0].body : s.defaultBody || [], localChans);
          for (const c of s.inputs) if (checkCons(c)) ooo = true;
          for (const c of io.cons) if (checkCons(c)) ooo = true;
          for (const p of io.prod) markProd(p);
          break;
        }
      }
      if (ooo) {
        maxIter = 3;
        break;
      }
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = (stmts || []).length - 1; i >= 0; i--) {
      const s = stmts[i];
      if (s.op === "chan" || s.op === "barrier" || s.op === "drain") continue;

      if (s.op === "const_unit") {
        if (req.get(s.dst)?.kind === "empty") return { dead: true, req, tupleConstraints: [] };
        continue;
      }

      if (s.op === "coerce") {
        if (req.get(s.dst)?.kind === "empty") return { dead: true, req, tupleConstraints: [] };
        continue;
      }

      if (s.op === "gate" || s.op === "splice") {
        const gDst = req.get(s.dst);
        if (gDst) {
          const tr = tighten(s.src, gDst);
          if (tr.dead) return { dead: true, req, tupleConstraints: [] };
          if (tr.changed) changed = true;
        }
        const mr = remapTupleConstraints(s.dst, s.src);
        if (mr.dead) return { dead: true, req, tupleConstraints: [] };
        if (mr.changed) changed = true;
        continue;
      }

      if (s.op === "tee") {
        for (const d of s.dsts) {
          const gd = req.get(d);
          if (gd) {
            const tr = tighten(s.src, gd);
            if (tr.dead) return { dead: true, req, tupleConstraints: [] };
            if (tr.changed) changed = true;
          }
          const mr = remapTupleConstraints(d, s.src);
          if (mr.dead) return { dead: true, req, tupleConstraints: [] };
          if (mr.changed) changed = true;
        }
        continue;
      }

      if (s.op === "match") {
        const sub = req.get(s.dst) || GUARD_TOP;
        if (sub.kind === "empty") return { dead: true, req, tupleConstraints: [] };
        const tr = tighten(s.src, {
          kind: "union",
          tags: new Map([[s.tag, sub]]),
          mustInspect: true
        });
        if (tr.dead) return { dead: true, req, tupleConstraints: [] };
        if (tr.changed) changed = true;
        continue;
      }

      if (s.op === "wrap") {
        const gDst = req.get(s.dst);
        if (gDst) {
          if (gDst.kind === "empty") return { dead: true, req, tupleConstraints: [] };
          if (gDst.kind === "union") {
            if (!gDst.tags.has(s.tag)) return { dead: true, req, tupleConstraints: [] };
            const sub = gDst.tags.get(s.tag);
            const tr = tighten(s.src, sub);
            if (tr.dead) return { dead: true, req, tupleConstraints: [] };
            if (tr.changed) changed = true;
          }
        }
        continue;
      }

      if (s.op === "demux") {
        const fieldGuards = new Map();
        for (const f of s.fields) {
          const gf = req.get(f.name);
          if (gf) {
            if (gf.kind === "empty") return { dead: true, req, tupleConstraints: [] };
            if (gf.kind !== "top") fieldGuards.set(f.label, gf);
          }
        }
        const bpInfo = bitprodInfoOf(types.get(s.src));
        let prodGuard = null;
        if (bpInfo) {
          // Check if any tupleConstraint constrains a subset/all of `demux`'s outputs!
          const fieldByChan = new Map();
          for (const f of s.fields) {
            const idx = bpInfo.labels.indexOf(f.label);
            if (idx >= 0) fieldByChan.set(f.name, idx);
          }
          if (fieldGuards.size > 0) {
            prodGuard = promoteProductToBitprod({ kind: "product", fields: fieldGuards }, bpInfo);
          }
          for (const tc of tcByKey.values()) {
            // Project `tc` onto the subset of `tc.chans` that are outputs of this `demux`!
            // This handles switches that mix a sibling channel (e.g. `cdr`) with the product's fields (e.g. 7 ASCII bits).
            const matchedPositions = []; // { tcPos, fIdx }
            for (let p = 0; p < tc.chans.length; p++) {
              const fIdx = fieldByChan.has(tc.chans[p]) ? fieldByChan.get(tc.chans[p]) : -1;
              if (fIdx >= 0) matchedPositions.push({ tcPos: p, fIdx });
            }
            if (matchedPositions.length < 2) continue;
            const projAllowed = new Set();
            for (const tk of tc.allowed) {
              const parts = tk.split("\x00");
              projAllowed.add(matchedPositions.map((m) => parts[m.tcPos]).join("\x00"));
            }
            // Exact `BITPROD` over `bpInfo.labels` matching `projAllowed`!
            const allowed = new Set();
            const cur = new Array(bpInfo.labels.length);
            const emit = (k) => {
              if (k === bpInfo.labels.length) {
                const projKey = matchedPositions.map((m) => cur[m.fIdx]).join("\x00");
                if (projAllowed.has(projKey)) allowed.add(cur.join("\x00"));
                return;
              }
              for (const t of bpInfo.allTags[k]) {
                cur[k] = t;
                emit(k + 1);
              }
            };
            emit(0);
            const tcBp =
              allowed.size === 0
                ? GUARD_EMPTY
                : {
                    kind: "bitprod",
                    labels: bpInfo.labels,
                    allTags: bpInfo.allTags,
                    grid: bpInfo.grid,
                    allowed,
                    mustInspect: tc.mustInspect
                  };
            prodGuard = prodGuard ? guardAnd(prodGuard, tcBp) : tcBp;
          }
        } else if (fieldGuards.size > 0) {
          prodGuard = { kind: "product", fields: fieldGuards };
        }
        if (prodGuard) {
          const tr = tighten(s.src, prodGuard);
          if (tr.dead) return { dead: true, req, tupleConstraints: [] };
          if (tr.changed) changed = true;
        }
        continue;
      }

      if (s.op === "mux") {
        const gDst = req.get(s.dst);
        if (!gDst || gDst.kind === "top") continue;
        if (gDst.kind === "empty") return { dead: true, req, tupleConstraints: [] };
        if (gDst.kind === "product") {
          for (const f of s.fields) {
            const fg = gDst.fields.get(f.label);
            if (fg) {
              const tr = tighten(f.name, fg);
              if (tr.dead) return { dead: true, req, tupleConstraints: [] };
              if (tr.changed) changed = true;
            }
          }
        } else if (gDst.kind === "bitprod") {
          const byLabel = new Map(s.fields.map((f) => [f.label, f.name]));
          const chans = gDst.labels.map((l) => byLabel.get(l));
          if (chans.every(Boolean) && new Set(chans).size === chans.length) {
            const tr = addTupleConstraint(chans, gDst.allTags, gDst.grid, gDst.allowed, gDst.mustInspect);
            if (tr.dead) return { dead: true, req, tupleConstraints: [] };
            if (tr.changed) changed = true;
          }
        }
        continue;
      }

      if (s.op === "spawn") {
        for (const o of s.outputs) {
          if (req.get(o)?.kind === "empty") return { dead: true, req, tupleConstraints: [] };
        }
        if (strictFailure && procGuards) {
          const cg = procGuards.get(s.target);
          if (cg) {
            for (let k = 0; k < s.inputs.length && k < cg.length; k++) {
              const g = s.after ? downgradeMustInspect(cg[k]) : cg[k];
              const tr = tighten(s.inputs[k], g);
              if (tr.dead) return { dead: true, req, tupleConstraints: [] };
              if (tr.changed) changed = true;
            }
          }
        }
        continue;
      }

      if (s.op === "exec") {
        for (const o of s.outputs || []) {
          if (req.get(o)?.kind === "empty") return { dead: true, req, tupleConstraints: [] };
        }
        continue;
      }

      if (s.op === "spec") {
        const subPost = new Map();
        for (const o of s.outputs) {
          if (req.has(o)) subPost.set(o, req.get(o));
        }
        if (iter > 0 && subPostMapsEqual(subPost, lastControlPost.get(i))) continue;
        lastControlPost.set(i, new Map(subPost));
        const surv = [];
        for (const br of s.branches) {
          const r = analyzeBlockReq(br.body, subPost, types, procGuards, resolvePlist, strictFailure, depth + 1);
          if (!r.dead) surv.push(r);
        }
        if (surv.length === 0) return { dead: true, req, tupleConstraints: [] };
        for (const v of s.inputs) {
          let gv = surv[0].req.get(v) || GUARD_TOP;
          for (let k = 1; k < surv.length; k++) {
            gv = guardOr(gv, surv[k].req.get(v) || GUARD_TOP);
          }
          const tr = tighten(v, gv);
          if (tr.dead) return { dead: true, req, tupleConstraints: [] };
          if (tr.changed) changed = true;
        }
        // Intersect/join shared tuple constraints on `s.inputs` across all surviving branches
        for (const tc0 of surv[0].tupleConstraints) {
          if (!tc0.chans.every((c) => s.inputs.includes(c))) continue;
          const key = tc0.chans.join("\x00");
          let allHave = true;
          const unionAllowed = new Set(tc0.allowed);
          let must = tc0.mustInspect;
          for (let k = 1; k < surv.length; k++) {
            const matchTc = surv[k].tupleConstraints.find((x) => x.chans.join("\x00") === key);
            if (!matchTc) {
              allHave = false;
              break;
            }
            for (const tk of matchTc.allowed) unionAllowed.add(tk);
            must = must && matchTc.mustInspect;
          }
          if (allHave && (unionAllowed.size < tc0.grid || must)) {
            const tr = addTupleConstraint(tc0.chans, tc0.allTags, tc0.grid, unionAllowed, must);
            if (tr.dead) return { dead: true, req, tupleConstraints: [] };
            if (tr.changed) changed = true;
          }
        }
        continue;
      }

      if (s.op === "switch") {
        const colAllTags = s.inputs.map((inp) => unionTagsOf(types.get(inp)));
        if (colAllTags.some((t) => !t || t.length === 0)) continue;
        // Only pass `req` entries for channels actually PRODUCED inside this `switch`!
        const swPost = new Map();
        if (req.size > 0) {
          const reqKeySet = new Set(req.keys());
          const firstArmBody = s.arms.length > 0 ? s.arms[0].body : s.defaultBody || [];
          const swIo = collectBlockIO(firstArmBody, reqKeySet);
          for (const k of swIo.prod) {
            if (req.has(k)) swPost.set(k, req.get(k));
          }
        }
        if (iter > 0 && subPostMapsEqual(swPost, lastControlPost.get(i))) continue;
        lastControlPost.set(i, new Map(swPost));
        const m = s.inputs.length;
        const grid = colAllTags.reduce((acc, ts) => acc * ts.length, 1);

        if (m === 1) {
          const c = s.inputs[0];
          const allTags = colAllTags[0];
          const covered = new Set();
          const survArms = [];

          const evalArm = (armTags, body) => {
            if (armTags.length === 0) return;
            const r = analyzeBlockReq(body, swPost, types, procGuards, resolvePlist, strictFailure, depth + 1);
            if (r.dead) return;
            const patGuard = {
              kind: "union",
              tags: new Map(armTags.map((t) => [t, GUARD_TOP])),
              mustInspect: true
            };
            const cg = guardAnd(patGuard, r.req.get(c) || GUARD_TOP);
            if (cg.kind === "empty") return;
            survArms.push({ cGuard: cg, armReq: r.req, armTcs: r.tupleConstraints });
          };

          for (const a of s.arms) {
            const p = a.patterns[0];
            const armTags =
              p.kind === "tag"
                ? covered.has(p.tag) || !allTags.includes(p.tag)
                  ? []
                  : [p.tag]
                : allTags.filter((t) => !covered.has(t));
            for (const t of armTags) covered.add(t);
            evalArm(armTags, a.body);
          }
          if (s.defaultBody) {
            const rem = allTags.filter((t) => !covered.has(t));
            evalArm(rem, s.defaultBody);
          }

          if (survArms.length === 0) return { dead: true, req, tupleConstraints: [] };
          let cJoined = survArms[0].cGuard;
          for (let k = 1; k < survArms.length; k++) cJoined = guardOr(cJoined, survArms[k].cGuard);
          if (cJoined.kind === "union") cJoined = { ...cJoined, mustInspect: true };
          const trC = tighten(c, cJoined);
          if (trC.dead) return { dead: true, req, tupleConstraints: [] };
          if (trC.changed) changed = true;

          // Join outer channel constraints across all surviving arms
          const outerKeys = new Set();
          for (const sa of survArms) {
            for (const k of sa.armReq.keys()) {
              if (k !== c && types.has(k) && !swPost.has(k)) outerKeys.add(k);
            }
          }
          for (const k of outerKeys) {
            let gk = survArms[0].armReq.get(k) || GUARD_TOP;
            for (let j = 1; j < survArms.length; j++) {
              gk = guardOr(gk, survArms[j].armReq.get(k) || GUARD_TOP);
            }
            const trK = tighten(k, gk);
            if (trK.dead) return { dead: true, req, tupleConstraints: [] };
            if (trK.changed) changed = true;
          }
          continue;
        }

        if (m >= 2 && grid <= 256) {
          // Exact multi-column grid evaluation
          const armResCache = new Map(); // armIdx (-1 for default) -> analyzeBlockReq result
          const getArmRes = (idx) => {
            if (armResCache.has(idx)) return armResCache.get(idx);
            const body = idx === -1 ? s.defaultBody : s.arms[idx].body;
            const r = analyzeBlockReq(body, swPost, types, procGuards, resolvePlist, strictFailure, depth + 1);
            armResCache.set(idx, r);
            return r;
          };

          const survivingTuples = new Set();
          const survArmIdxs = new Set();
          const colTagSubGuards = s.inputs.map(() => new Map()); // j -> Map<tag, Guard>

          const cur = new Array(m);
          const visitGrid = (cIdx) => {
            if (cIdx === m) {
              let matchedIdx = -2;
              for (let ai = 0; ai < s.arms.length; ai++) {
                const pats = s.arms[ai].patterns;
                let ok = true;
                for (let j = 0; j < m; j++) {
                  if (pats[j].kind === "tag" && pats[j].tag !== cur[j]) {
                    ok = false;
                    break;
                  }
                }
                if (ok) {
                  matchedIdx = ai;
                  break;
                }
              }
              if (matchedIdx === -2) {
                if (!s.defaultBody) return;
                matchedIdx = -1;
              }
              const r = getArmRes(matchedIdx);
              if (r.dead) return;
              // Verify `cur` satisfies `r.req` on every switch input & `r.tupleConstraints`
              for (let j = 0; j < m; j++) {
                const gj = r.req.get(s.inputs[j]);
                if (gj && gj.kind === "union" && !gj.tags.has(cur[j])) return;
              }
              if (!tuplePassesTcList(cur, s.inputs, r.tupleConstraints)) return;
              survivingTuples.add(cur.join("\x00"));
              survArmIdxs.add(matchedIdx);
              for (let j = 0; j < m; j++) {
                const gj = r.req.get(s.inputs[j]);
                const sub = gj && gj.kind === "union" ? gj.tags.get(cur[j]) || GUARD_TOP : GUARD_TOP;
                const mapJ = colTagSubGuards[j];
                mapJ.set(cur[j], mapJ.has(cur[j]) ? guardOr(mapJ.get(cur[j]), sub) : sub);
              }
              return;
            }
            for (const t of colAllTags[cIdx]) {
              cur[cIdx] = t;
              visitGrid(cIdx + 1);
            }
          };
          visitGrid(0);

          if (survivingTuples.size === 0) return { dead: true, req, tupleConstraints: [] };
          const trTc = addTupleConstraint(s.inputs.slice(), colAllTags, grid, survivingTuples, true);
          if (trTc.dead) return { dead: true, req, tupleConstraints: [] };
          if (trTc.changed) changed = true;

          for (let j = 0; j < m; j++) {
            const trJ = tighten(s.inputs[j], {
              kind: "union",
              tags: colTagSubGuards[j],
              mustInspect: true
            });
            if (trJ.dead) return { dead: true, req, tupleConstraints: [] };
            if (trJ.changed) changed = true;
          }

          const survList = [...survArmIdxs].map((idx) => getArmRes(idx));
          const swInputSet = new Set(s.inputs);
          const outerKeys = new Set();
          for (const sr of survList) {
            for (const k of sr.req.keys()) {
              if (!swInputSet.has(k) && types.has(k) && !swPost.has(k)) outerKeys.add(k);
            }
          }
          for (const k of outerKeys) {
            let gk = survList[0].req.get(k) || GUARD_TOP;
            for (let j = 1; j < survList.length; j++) {
              gk = guardOr(gk, survList[j].req.get(k) || GUARD_TOP);
            }
            const trK = tighten(k, gk);
            if (trK.dead) return { dead: true, req, tupleConstraints: [] };
            if (trK.changed) changed = true;
          }
          continue;
        }

        // Wide multi-column switch (>256 grid): conservative per-column union
        for (let j = 0; j < m; j++) {
          const all = colAllTags[j];
          const tags =
            s.defaultBody || s.arms.some((a) => a.patterns[j].kind !== "tag")
              ? all
              : [...new Set(s.arms.map((a) => a.patterns[j].tag))];
          const trJ = tighten(s.inputs[j], {
            kind: "union",
            tags: new Map(tags.map((t) => [t, GUARD_TOP])),
            mustInspect: true
          });
          if (trJ.dead) return { dead: true, req, tupleConstraints: [] };
          if (trJ.changed) changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Strip local channels declared inside this block so they never leak to outer scopes
  const outReq = new Map();
  for (const [k, v] of req.entries()) {
    if (!localChans.has(k)) outReq.set(k, v);
  }
  const outTcs = [];
  for (const tc of tcByKey.values()) {
    if (tc.chans.every((c) => !localChans.has(c))) outTcs.push(tc);
  }
  return { dead: false, req: outReq, tupleConstraints: outTcs };
}

function analyzeProcEntryGuards(proc, procGuards, resolvePlist, strictFailure) {
  const outerTypes = new Map();
  for (const p of proc.inputs || []) outerTypes.set(p.name, resolvePlist(p.schema));
  for (const p of proc.outputs || []) outerTypes.set(p.name, resolvePlist(p.schema));
  const res = analyzeBlockReq(proc.body, new Map(), outerTypes, procGuards, resolvePlist, strictFailure, 0);
  if (res.dead) return (proc.inputs || []).map(() => GUARD_EMPTY);
  return (proc.inputs || []).map((p) => res.req.get(p.name) || GUARD_TOP);
}

function extractBranchGuards(
  stmts,
  specInputSet,
  specTypes,
  procGuards = null,
  resolvePlist = null,
  strictFailure = false
) {
  if (resolvePlist) {
    const res = analyzeBlockReq(stmts, new Map(), specTypes, procGuards, resolvePlist, strictFailure, 0);
    const guards = new Map();
    const mustInspectSet = new Set();
    for (const v of specInputSet) {
      const g = res.req.get(v);
      if (g && g.kind === "union") {
        const all = unionTagsOf(specTypes.get(v));
        if (all) {
          const valid = new Set([...g.tags.keys()].filter((t) => all.includes(t)));
          guards.set(v, valid);
          if (g.mustInspect) mustInspectSet.add(v);
        }
      }
    }
    const tupleConstraints = res.tupleConstraints.filter((tc) => tc.chans.some((c) => specInputSet.has(c)));
    return { dead: res.dead, guards, mustInspectSet, tupleConstraints };
  }

  // Fallback local-only path (if resolvePlist omitted)
  const aliasOf = new Map();
  for (const v of specInputSet) aliasOf.set(v, v);
  const guards = new Map();
  const mustInspectSet = new Set();

  const recordGuard = (origInput, tagSet) => {
    const pl = specTypes.get(origInput);
    const all = unionTagsOf(pl);
    if (!all) return;
    mustInspectSet.add(origInput);
    if (!guards.has(origInput)) {
      guards.set(origInput, new Set([...tagSet].filter((t) => all.includes(t))));
    } else {
      const cur = guards.get(origInput);
      guards.set(origInput, new Set([...cur].filter((t) => tagSet.has(t))));
    }
  };

  for (const s of stmts || []) {
    if (s.op === "gate" || s.op === "splice") {
      if (aliasOf.has(s.src)) aliasOf.set(s.dst, aliasOf.get(s.src));
    } else if (s.op === "tee") {
      if (aliasOf.has(s.src)) {
        const orig = aliasOf.get(s.src);
        for (const d of s.dsts) aliasOf.set(d, orig);
      }
    } else if (s.op === "match") {
      const orig = aliasOf.get(s.src);
      if (orig) recordGuard(orig, new Set([s.tag]));
    } else if (s.op === "switch" && s.arms.length > 0) {
      for (let j = 0; j < s.inputs.length; j++) {
        const orig = aliasOf.get(s.inputs[j]);
        if (!orig) continue;
        const anyTested = s.arms.some((a) => a.patterns[j].kind === "tag");
        if (!anyTested) continue;
        const all = unionTagsOf(specTypes.get(orig));
        if (!all) continue;
        if (s.defaultBody || s.arms.some((a) => a.patterns[j].kind !== "tag")) {
          recordGuard(orig, new Set(all));
        } else {
          recordGuard(orig, new Set(s.arms.map((a) => a.patterns[j].tag)));
        }
      }
    }
  }
  return { dead: false, guards, mustInspectSet, tupleConstraints: [] };
}

function hasUngatedDrainOf(stmts, chanName) {
  const aliases = new Set([chanName]);
  for (const s of stmts || []) {
    if ((s.op === "gate" || s.op === "splice") && aliases.has(s.src)) aliases.add(s.dst);
    else if (s.op === "drain" && aliases.has(s.src) && !s.barrier) return true;
    else if (s.op === "switch") {
      for (const a of s.arms) if (hasUngatedDrainOf(a.body, chanName)) return true;
      if (s.defaultBody && hasUngatedDrainOf(s.defaultBody, chanName)) return true;
    } else if (s.op === "spec") {
      for (const b of s.branches) if (hasUngatedDrainOf(b.body, chanName)) return true;
    }
  }
  return false;
}

function compileSpecsToSwitches(
  mod,
  resolvePlist,
  totalProcs,
  freshBox = { seq: 0 },
  { maxCols = 8, maxGrid = 256, maxSwitchArms = 32, maxDepth = 10 } = {}
) {
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
  const strictFailure = computeModuleStrictFailure(mod);
  const procGuards = new Map(); // procName -> Guard[]
  let converted = 0;
  const nextFresh = (prefix) => `%${prefix}_${freshBox.seq++}`;

  function freshenBodyLocals(stmts) {
    const { chanSet, barSet, tokSet } = collectLocalDeclsDeep(stmts);
    if (chanSet.size === 0 && barSet.size === 0 && tokSet.size === 0) return cloneAst(stmts);
    const chanMap = new Map();
    const barMap = new Map();
    const tokMap = new Map();
    for (const c of chanSet) chanMap.set(c, nextFresh("sp"));
    for (const b of barSet) barMap.set(b, nextFresh("spb"));
    for (const t of tokSet) tokMap.set(t, nextFresh("spt"));
    return renameStmtRefs(cloneAst(stmts), chanMap, barMap, tokMap);
  }

  function specializeBranchForTag(body, chanName, tag) {
    // Also track simple `tee`/`gate`/`splice` aliases of `chanName` inside `body`
    // so `tee %b -> (%b_chk, %b_keep); switch (%b_chk)` specializes cleanly too!
    const aliases = new Set([chanName]);
    const out = [];
    for (const s of body) {
      if ((s.op === "gate" || s.op === "splice") && aliases.has(s.src)) {
        aliases.add(s.dst);
        out.push(cloneAst(s));
        continue;
      }
      if (s.op === "tee" && aliases.has(s.src)) {
        for (const d of s.dsts) aliases.add(d);
        out.push(cloneAst(s));
        continue;
      }
      if (s.op === "switch") {
        const col = s.inputs.findIndex((inp) => aliases.has(inp));
        if (col !== -1) {
          const matchingArms = [];
          let anyTagTested = false;
          for (const arm of s.arms) {
            const p = arm.patterns[col];
            if (p.kind === "tag") {
              anyTagTested = true;
              if (p.tag !== tag) continue;
              matchingArms.push({
                ...arm,
                patterns: arm.patterns.map((x, j) => (j === col ? { kind: "wild" } : x))
              });
            } else {
              matchingArms.push(arm);
            }
          }
          if (anyTagTested) {
            if (matchingArms.length > 0 && matchingArms[0].patterns.every((p) => p.kind === "wild")) {
              out.push(...freshenBodyLocals(matchingArms[0].body));
              continue;
            }
            if (matchingArms.length === 0 && s.defaultBody) {
              out.push(...freshenBodyLocals(s.defaultBody));
              continue;
            }
            if (matchingArms.length > 0) {
              if (s.inputs.length > 1 && matchingArms.every((a) => a.patterns[col].kind === "wild")) {
                out.push({
                  ...s,
                  inputs: s.inputs.filter((_, j) => j !== col),
                  arms: matchingArms.map((a) => ({
                    ...a,
                    patterns: a.patterns.filter((_, j) => j !== col),
                    body: freshenBodyLocals(a.body)
                  })),
                  defaultBody: s.defaultBody ? freshenBodyLocals(s.defaultBody) : null
                });
                continue;
              }
              out.push({
                ...s,
                arms: matchingArms.map((a) => ({ ...a, body: freshenBodyLocals(a.body) })),
                defaultBody: s.defaultBody ? freshenBodyLocals(s.defaultBody) : null
              });
              continue;
            }
          }
        }
      }
      out.push(cloneAst(s));
    }
    return out;
  }

  function extractTopLevelDemux(body, chanName) {
    if (countChanRefsDeep(body, chanName) !== 1) return null;
    const dIdx = body.findIndex((s) => s.op === "demux" && s.src === chanName);
    if (dIdx === -1) return null;
    const ds = body[dIdx];
    if (!ds.fields || ds.fields.length < 2) return null;
    const fieldDeclIdxs = new Set();
    const fieldSchemas = new Map();
    for (const f of ds.fields) {
      const fDecl = body.findIndex((s) => s.op === "chan" && s.name === f.name);
      if (fDecl === -1) return null;
      fieldDeclIdxs.add(fDecl);
      fieldSchemas.set(f.label, { oldName: f.name, schema: body[fDecl].schema });
    }
    return { dIdx, ds, fieldDeclIdxs, fieldSchemas };
  }

  function tryPeelCommonMatchDemux(
    survBodies,
    chanName,
    tag,
    specTypes,
    specExprs,
    { allowReconstruct = false } = {}
  ) {
    const matchInfo = [];
    let reconstructed = false;
    for (let b = 0; b < survBodies.length; b++) {
      const body = survBodies[b];
      const mIdx =
        countChanRefsDeep(body, chanName) === 1
          ? body.findIndex((s) => s.op === "match" && s.src === chanName && s.tag === tag)
          : -1;
      if (mIdx !== -1) {
        const dst = body[mIdx].dst;
        const declIdx = body.findIndex((s) => s.op === "chan" && s.name === dst);
        if (declIdx !== -1) {
          matchInfo.push({ matched: true, mIdx, declIdx, dst, dstSchema: body[declIdx].schema });
          continue;
        }
      }
      if (!allowReconstruct) return null;
      reconstructed = true;
      matchInfo.push({ matched: false });
    }

    const firstMatchIdx = matchInfo.findIndex((m) => m.matched);
    if (firstMatchIdx === -1) return null;

    const origExpr = specExprs.get(chanName);
    if (reconstructed && !origExpr) return null;

    const sharedM = nextFresh("pm");
    const mSchemaExpr = cloneAst(matchInfo[firstMatchIdx].dstSchema);
    const mPlist = resolvePlist(mSchemaExpr);

    const peeledStmts = [
      { op: "chan", name: sharedM, schema: mSchemaExpr },
      { op: "match", tag, src: chanName, dst: sharedM }
    ];

    let strippedBodies = survBodies.map((body, idx) => {
      const mi = matchInfo[idx];
      if (mi.matched) {
        const filtered = body.filter((_, i) => i !== mi.mIdx && i !== mi.declIdx);
        return renameStmtRefs(filtered, new Map([[mi.dst, sharedM]]));
      }
      const recCh = nextFresh("pr");
      return [
        { op: "chan", name: recCh, schema: cloneAst(origExpr) },
        { op: "wrap", tag, src: sharedM, dst: recCh },
        ...renameStmtRefs(body, new Map([[chanName, recCh]]))
      ];
    });

    // Optionally peel a leading `demux sharedM : S -> (...)`!
    const newInputEntries = [];
    if (mPlist && mPlist[0]?.[0] === "closed-product") {
      const demuxInfo = strippedBodies.map((body) => extractTopLevelDemux(body, sharedM));
      const firstDemuxIdx = demuxInfo.findIndex(Boolean);
      const allDemux = demuxInfo.every(Boolean);
      const canPartialDemux = allowReconstruct && firstDemuxIdx !== -1;

      if ((allDemux || canPartialDemux) && demuxInfo[firstDemuxIdx].ds.fields.length > 0) {
        const refDi = demuxInfo[firstDemuxIdx];
        const refFields = refDi.ds.fields;
        const shapeOk = demuxInfo.every(
          (di) =>
            !di ||
            (di.ds.fields.length === refFields.length &&
              refFields.every((rf) => di.fieldSchemas.has(rf.label)))
        );
        if (shapeOk) {
          if (!allDemux) reconstructed = true;
          const sharedByLabel = new Map();
          const demuxFieldsOut = [];
          for (const f of refFields) {
            const sf = nextFresh("pf");
            const fSchema = cloneAst(refDi.fieldSchemas.get(f.label).schema);
            sharedByLabel.set(f.label, sf);
            peeledStmts.push({ op: "chan", name: sf, schema: fSchema });
            demuxFieldsOut.push({ label: f.label, name: sf });
            newInputEntries.push({ name: sf, plist: resolvePlist(fSchema), schema: fSchema });
          }
          peeledStmts.push({
            op: "demux",
            src: sharedM,
            schema: cloneAst(refDi.ds.schema),
            fields: demuxFieldsOut
          });
          strippedBodies = strippedBodies.map((body, idx) => {
            const di = demuxInfo[idx];
            if (di) {
              const filtered = body.filter((_, i) => i !== di.dIdx && !di.fieldDeclIdxs.has(i));
              const cmap = new Map();
              for (const [lbl, sf] of sharedByLabel.entries()) {
                cmap.set(di.fieldSchemas.get(lbl).oldName, sf);
              }
              return renameStmtRefs(filtered, cmap);
            }
            const recM = nextFresh("prm");
            return [
              { op: "chan", name: recM, schema: cloneAst(mSchemaExpr) },
              {
                op: "mux",
                fields: refFields.map((f) => ({ label: f.label, name: sharedByLabel.get(f.label) })),
                dst: recM,
                schema: cloneAst(refDi.ds.schema)
              },
              ...renameStmtRefs(body, new Map([[sharedM, recM]]))
            ];
          });
        }
      }
    }

    if (newInputEntries.length === 0) {
      newInputEntries.push({ name: sharedM, plist: mPlist, schema: mSchemaExpr });
    }

    return { peeledStmts, strippedBodies, newInputEntries, reconstructed };
  }

  function tryHoistProductDemuxFromSpec(spec, specTypes, specExprs, depth = 0, demuxDepth = 0) {
    if (demuxDepth >= 4 || spec.branches.length < 2) return null;

    for (const inp of spec.inputs) {
      const pl = specTypes.get(inp);
      if (!pl || pl[0]?.[0] !== "closed-product" || (pl[0][1] || []).length < 2) continue;
      if (spec.branches.some((br) => hasUngatedDrainOf(br.body, inp))) continue;

      const d0 = extractTopLevelDemux(spec.branches[0].body, inp);
      if (!d0) continue;

      const demuxInfos = spec.branches.map((br, b) => (b === 0 ? d0 : extractTopLevelDemux(br.body, inp)));
      const refFields = d0.ds.fields;
      const shapeOk = demuxInfos.every(
        (di) =>
          !di ||
          (di.ds.fields.length === refFields.length &&
            refFields.every((rf) => di.fieldSchemas.has(rf.label)))
      );
      if (!shapeOk) continue;

      const allDemux = demuxInfos.every(Boolean);
      const inpExpr = specExprs.get(inp);
      if (!allDemux && !inpExpr) continue;

      // For partial hoisting (some branch doesn't demux `inp`), require `br0` to inspect
      // at least one demuxed field (either via union guard or nested demux) so hoisting can split!
      if (!allDemux) {
        const d0FieldNames = new Set(refFields.map((f) => f.name));
        const d0FieldTypes = new Map();
        for (const f of refFields) {
          d0FieldTypes.set(f.name, resolvePlist(d0.fieldSchemas.get(f.label).schema));
        }
        const br0Info = extractBranchGuards(
          spec.branches[0].body,
          d0FieldNames,
          d0FieldTypes,
          procGuards,
          resolvePlist,
          strictFailure
        );
        const hasGuardOrNestedDemux =
          br0Info.guards.size > 0 ||
          refFields.some((f) => Boolean(extractTopLevelDemux(spec.branches[0].body, f.name)));
        if (!hasGuardOrNestedDemux) continue;
      }

      const peeledStmts = [];
      const sharedByLabel = new Map();
      const demuxFieldsOut = [];
      const innerInputs = [];
      const innerTypes = new Map(specTypes);
      const innerExprs = new Map(specExprs);
      for (const v of spec.inputs) {
        if (v !== inp) innerInputs.push(v);
      }
      for (const f of refFields) {
        const sf = nextFresh("hf");
        const fSchema = cloneAst(d0.fieldSchemas.get(f.label).schema);
        sharedByLabel.set(f.label, sf);
        peeledStmts.push({ op: "chan", name: sf, schema: fSchema });
        demuxFieldsOut.push({ label: f.label, name: sf });
        innerInputs.push(sf);
        innerTypes.set(sf, resolvePlist(fSchema));
        innerExprs.set(sf, fSchema);
      }
      peeledStmts.push({
        op: "demux",
        src: inp,
        schema: cloneAst(d0.ds.schema),
        fields: demuxFieldsOut
      });

      const innerBranches = spec.branches.map((br, idx) => {
        const di = demuxInfos[idx];
        if (di) {
          const filtered = br.body.filter((_, i) => i !== di.dIdx && !di.fieldDeclIdxs.has(i));
          const cmap = new Map();
          for (const [lbl, sf] of sharedByLabel.entries()) {
            cmap.set(di.fieldSchemas.get(lbl).oldName, sf);
          }
          return { index: idx, body: renameStmtRefs(filtered, cmap) };
        }
        const recP = nextFresh("hr");
        return {
          index: idx,
          body: [
            { op: "chan", name: recP, schema: cloneAst(inpExpr) },
            {
              op: "mux",
              fields: refFields.map((f) => ({ label: f.label, name: sharedByLabel.get(f.label) })),
              dst: recP,
              schema: cloneAst(d0.ds.schema)
            },
            ...renameStmtRefs(br.body, new Map([[inp, recP]]))
          ]
        };
      });

      const innerSpec = {
        op: "spec",
        inputs: innerInputs,
        outputs: spec.outputs.slice(),
        branches: innerBranches
      };

      const compiledInner = compileSpecToStmts(innerSpec, innerTypes, innerExprs, depth, demuxDepth + 1);
      if (compiledInner) {
        return [...peeledStmts, ...compiledInner];
      }
      if (allDemux) {
        // Hoisting an all-branch product demux out of `spec` is ALWAYS strictly better:
        // avoids tapping untouched sibling fields (e.g. `acc` in `split_by_loop`) and unlocks MUX->DEMUX fusion!
        return [...peeledStmts, innerSpec];
      }
    }
    return null;
  }

  function tryPartitionSpecByMultiCols(spec, specTypes, specExprs, depth = 0, precomputedBranchInfos = null) {
    if (depth >= maxDepth || spec.branches.length < 2) return null;
    const B = spec.branches.length;
    const specInputSet = new Set(spec.inputs);
    const branchInfos =
      precomputedBranchInfos ||
      spec.branches.map((b) =>
        extractBranchGuards(b.body, specInputSet, specTypes, procGuards, resolvePlist, strictFailure)
      );
    const branchGuards = branchInfos.map((bi) => bi.guards);
    if (branchInfos[0].dead) return null;

    // Only include columns unconditionally inspected by branch 0 (preserves exact demand order).
    // Note: do NOT require each single column to be individually constrained (`g.size < allTags.length`),
    // because multi-column switches (e.g. 5-bit whitespace dispatch in `@dj_ws_4`) constrain joint tuples!
    const safeCols = [];
    for (const inp of spec.inputs) {
      const allTags = unionTagsOf(specTypes.get(inp));
      if (!allTags || allTags.length === 0 || allTags.length > 16) continue;
      if (!branchInfos[0].mustInspectSet.has(inp)) continue;
      if (spec.branches.some((br) => hasUngatedDrainOf(br.body, inp))) continue;
      safeCols.push({ name: inp, allTags });
    }
    if (safeCols.length < 2 || safeCols.length > maxCols) return null;

    let gridSize = 1;
    for (const col of safeCols) gridSize *= col.allTags.length;
    if (gridSize > maxGrid) return null;

    const C = safeCols.length;
    const allTuples = [];
    const curTuple = new Array(C);
    const buildGrid = (c) => {
      if (c === C) {
        allTuples.push(curTuple.slice());
        return;
      }
      for (const t of safeCols[c].allTags) {
        curTuple[c] = t;
        buildGrid(c + 1);
      }
    };
    buildGrid(0);

    // Helper: check if branch `b` can actually match tuple `t` across multi-column switches & interprocedural tuple constraints!
    const safeColNames = safeCols.map((sc) => sc.name);
    const branchInfo = spec.branches.map((br, bi) => {
      const aliasOf = new Map();
      for (const v of spec.inputs) aliasOf.set(v, v);
      const multiSwitches = [];
      for (const s of br.body || []) {
        if ((s.op === "gate" || s.op === "splice") && aliasOf.has(s.src)) {
          aliasOf.set(s.dst, aliasOf.get(s.src));
        } else if (s.op === "tee" && aliasOf.has(s.src)) {
          const orig = aliasOf.get(s.src);
          for (const d of s.dsts) aliasOf.set(d, orig);
        } else if (s.op === "switch" && !s.defaultBody && s.arms.length > 0) {
          // Map switch inputs to `safeCols` indices (or -1 if not in `safeCols`)
          const colMap = s.inputs.map((inp) => {
            const orig = aliasOf.get(inp);
            return orig ? safeCols.findIndex((sc) => sc.name === orig) : -1;
          });
          if (colMap.some((idx) => idx >= 0)) {
            multiSwitches.push({ sw: s, colMap });
          }
        }
      }
      const mappedTcs = [];
      for (const tc of branchInfos[bi].tupleConstraints) {
        const colMap = tc.chans.map((c) => safeColNames.indexOf(c));
        if (colMap.some((idx) => idx >= 0)) {
          mappedTcs.push({ tc, colMap, allMapped: colMap.every((idx) => idx >= 0) });
        }
      }
      return { multiSwitches, mappedTcs };
    });

    const groups = new Map(); // survKey -> { survIndices, tuples }
    const deadTuples = [];
    let madeProgress = false;

    for (const t of allTuples) {
      const tupleAllowed = new Map();
      for (let j = 0; j < C; j++) tupleAllowed.set(safeCols[j].name, new Set([t[j]]));

      const surv = [];
      for (let b = 0; b < B; b++) {
        if (branchInfos[b].dead) continue;
        let ok = true;
        for (let j = 0; j < C; j++) {
          const g = branchGuards[b].get(safeCols[j].name);
          if (g && !g.has(t[j])) {
            ok = false;
            break;
          }
        }
        if (ok) {
          // Check exact interprocedural/backward joint tuple constraints on `t`
          for (const { tc, colMap, allMapped } of branchInfo[b].mappedTcs) {
            if (allMapped) {
              const key = colMap.map((idx) => t[idx]).join("\x00");
              if (!tc.allowed.has(key)) {
                ok = false;
                break;
              }
            } else {
              let anyOk = false;
              for (const tk of tc.allowed) {
                const parts = tk.split("\x00");
                let match = true;
                for (let k = 0; k < colMap.length; k++) {
                  if (colMap[k] >= 0 && parts[k] !== t[colMap[k]]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  anyOk = true;
                  break;
                }
              }
              if (!anyOk) {
                ok = false;
                break;
              }
            }
          }
        }
        if (ok) {
          // Check exact multi-column switch satisfiability on `t`
          for (const { sw, colMap } of branchInfo[b].multiSwitches) {
            const anyArmMatches = sw.arms.some((arm) =>
              arm.patterns.every((p, pj) => {
                const scIdx = colMap[pj];
                if (scIdx < 0 || p.kind !== "tag") return true;
                return p.tag === t[scIdx];
              })
            );
            if (!anyArmMatches) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        surv.push(b);
        // CRITICAL: check totality using ONLY `tupleAllowed` (the tested `safeCols`),
        // NEVER untested columns from `branchGuards[b]`!
        if (isBlockTotal(spec.branches[b].body, specTypes, tupleAllowed, totalProcs, kernelMap, resolvePlist)) {
          break;
        }
      }
      if (surv.length < B) madeProgress = true;
      if (surv.length === 0) {
        deadTuples.push(t);
      } else {
        const key = surv.join(",");
        let g = groups.get(key);
        if (!g) {
          g = { key, survIndices: surv, tuples: [] };
          groups.set(key, g);
        }
        g.tuples.push(t);
      }
    }

    if (!madeProgress || groups.size === 0) return null;
    if (groups.size === 1 && deadTuples.length === 0) return null;

    // Sort groups ascending by tuple count; if no dead tuples, largest group becomes `defaultBody`!
    const groupList = [...groups.values()].sort((a, b) => a.tuples.length - b.tuples.length);
    let defaultGroup = null;
    if (deadTuples.length === 0 && groupList.length >= 2) {
      defaultGroup = groupList.pop();
    }

    const cubeMatches = (cube, tuple) => {
      for (let j = 0; j < C; j++) {
        if (cube[j] !== null && cube[j] !== tuple[j]) return false;
      }
      return true;
    };

    const armSpecs = []; // { cube, survIndices }
    const origTotalStmts = spec.branches.reduce((acc, br) => acc + countStmts(br.body), 0);
    let estExtraStmts = 0;

    for (let gi = 0; gi < groupList.length; gi++) {
      const grp = groupList[gi];
      // Forbidden tuples = all later groups + defaultGroup + deadTuples
      const forbidden = [...deadTuples];
      for (let k = gi + 1; k < groupList.length; k++) forbidden.push(...groupList[k].tuples);
      if (defaultGroup) forbidden.push(...defaultGroup.tuples);

      let rem = grp.tuples.slice();
      let grpRows = 0;
      while (rem.length > 0) {
        const cube = rem[0].slice();
        for (let j = 0; j < C; j++) {
          if (cube[j] === null) continue;
          const saved = cube[j];
          cube[j] = null;
          if (forbidden.some((ft) => cubeMatches(cube, ft))) cube[j] = saved;
        }
        armSpecs.push({ cube, survIndices: grp.survIndices });
        grpRows += 1;
        if (armSpecs.length > maxSwitchArms) return null;
        rem = rem.filter((t) => !cubeMatches(cube, t));
      }
      if (grpRows > 1) {
        const grpCost = grp.survIndices.reduce((acc, bi) => acc + countStmts(spec.branches[bi].body), 0);
        estExtraStmts += (grpRows - 1) * grpCost;
        if (estExtraStmts > Math.max(600, origTotalStmts * 3)) return null;
      }
    }

    const buildGroupBody = (survIndices, fixedCube) => {
      const specialized = survIndices.map((b) => {
        let body = cloneAst(spec.branches[b].body);
        if (fixedCube) {
          for (let j = 0; j < C; j++) {
            if (fixedCube[j] !== null) body = specializeBranchForTag(body, safeCols[j].name, fixedCube[j]);
          }
        }
        return freshenBodyLocals(body);
      });
      if (specialized.length === 1) {
        return rewriteBlock(specialized[0], specTypes, specExprs);
      }
      const innerSpec = {
        op: "spec",
        inputs: spec.inputs.slice(),
        outputs: spec.outputs.slice(),
        branches: specialized.map((body, idx) => ({ index: idx, body }))
      };
      if (fixedCube) {
        // Try peeling any single fixed column (first exact, then with reconstruction if inner compiles!)
        for (const allowReconstruct of [false, true]) {
          for (let j = 0; j < C; j++) {
            if (fixedCube[j] === null) continue;
            const peeled = tryPeelCommonMatchDemux(
              specialized,
              safeCols[j].name,
              fixedCube[j],
              specTypes,
              specExprs,
              { allowReconstruct }
            );
            if (!peeled) continue;
            const innerInputs = spec.inputs.filter((v) => v !== safeCols[j].name);
            const innerTypes = new Map(specTypes);
            const innerExprs = new Map(specExprs);
            for (const e of peeled.newInputEntries) {
              innerInputs.push(e.name);
              innerTypes.set(e.name, e.plist);
              innerExprs.set(e.name, e.schema);
            }
            const pSpec = {
              op: "spec",
              inputs: innerInputs,
              outputs: spec.outputs.slice(),
              branches: peeled.strippedBodies.map((body, idx) => ({ index: idx, body }))
            };
            const compiled = compileSpecToStmts(pSpec, innerTypes, innerExprs, depth + 1, 0);
            if (compiled) return [...peeled.peeledStmts, ...compiled];
            if (!allowReconstruct) return [...peeled.peeledStmts, pSpec];
          }
        }
      }
      const compiled =
        survIndices.length < B ? compileSpecToStmts(innerSpec, specTypes, specExprs, depth + 1, 0) : null;
      return compiled || [innerSpec];
    };

    const arms = armSpecs.map(({ cube, survIndices }) => ({
      patterns: cube.map((t) => (t === null ? { kind: "wild" } : { kind: "tag", tag: t })),
      body: buildGroupBody(survIndices, cube)
    }));
    const defaultBody = defaultGroup ? buildGroupBody(defaultGroup.survIndices, null) : null;

    const activeCols = [];
    for (let j = 0; j < C; j++) {
      if (arms.some((a) => a.patterns[j].kind === "tag")) activeCols.push(j);
    }
    if (activeCols.length === 0) return null;

    return {
      op: "switch",
      inputs: activeCols.map((j) => safeCols[j].name),
      arms: arms.map((a) => ({
        patterns: activeCols.map((j) => a.patterns[j]),
        body: a.body
      })),
      defaultBody
    };
  }

  function trySplitSpecByUnionInput(spec, specTypes, specExprs, depth = 0, precomputedBranchInfos = null) {
    if (depth >= maxDepth || spec.branches.length < 2) return null;
    const specInputSet = new Set(spec.inputs);
    const branchInfos =
      precomputedBranchInfos ||
      spec.branches.map((b) =>
        extractBranchGuards(b.body, specInputSet, specTypes, procGuards, resolvePlist, strictFailure)
      );
    const branchGuards = branchInfos.map((bi) => bi.guards);
    if (branchInfos[0].dead) return null;

    // Only split on a closed-union input unconditionally inspected by branch 0
    // (guarantees peeking the tag preserves exact demand/termination order).
    // Prefer inputs that strictly constrain branch 0, then inputs constrained by any branch
    // or dispatched via top-level `switch` in branch 0 (e.g. `@dj_ws_4`, `@dj_scan_digits_54`).
    let chosenCol = null;
    let chosenTags = null;
    let bestScore = -1;
    for (const inp of spec.inputs) {
      const allTags = unionTagsOf(specTypes.get(inp));
      if (!allTags || allTags.length === 0 || allTags.length > 16) continue;
      const g0 = branchGuards[0].get(inp);
      if (!g0 || !branchInfos[0].mustInspectSet.has(inp)) continue;
      if (spec.branches.some((br) => hasUngatedDrainOf(br.body, inp))) continue;

      const br0Constrains = g0.size < allTags.length;
      const anyConstrains = branchGuards.some((bg) => {
        const g = bg.get(inp);
        return g && g.size < allTags.length;
      });
      const br0HasSwitch = spec.branches[0].body.some(
        (s) => s.op === "switch" && s.inputs.includes(inp)
      );
      if (!br0Constrains && !anyConstrains && !br0HasSwitch) continue;

      // Score: count total eliminated branch-tag pairs + bonus for constraining br0
      let elim = 0;
      for (const bg of branchGuards) {
        const g = bg.get(inp);
        if (g && g.size < allTags.length) elim += allTags.length - g.size;
      }
      const score = elim * 4 + (br0Constrains ? 2 : 0) + (br0HasSwitch ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        chosenCol = inp;
        chosenTags = allTags;
      }
    }
    if (!chosenCol) return null;

    const arms = [];
    let madeProgress = false;

    for (const tag of chosenTags) {
      const survIndices = [];
      for (let b = 0; b < spec.branches.length; b++) {
        if (branchInfos[b].dead) continue;
        const gb = branchGuards[b].get(chosenCol);
        if (!gb || gb.has(tag)) survIndices.push(b);
      }
      if (survIndices.length === 0) {
        madeProgress = true;
        continue;
      }

      const survBodies = survIndices.map((b) =>
        specializeBranchForTag(spec.branches[b].body, chosenCol, tag)
      );

      if (survBodies.length === 1) {
        madeProgress = true;
        arms.push({
          patterns: [{ kind: "tag", tag }],
          body: rewriteBlock(survBodies[0], specTypes, specExprs)
        });
        continue;
      }

      if (survBodies.length < spec.branches.length) madeProgress = true;

      // Try peeling common leading `match /tag %c` (+ optional `demux`) out of surviving branches
      let peeled = tryPeelCommonMatchDemux(survBodies, chosenCol, tag, specTypes, specExprs, {
        allowReconstruct: false
      });
      let compiledPeeled = null;
      if (peeled) {
        const innerInputs = spec.inputs.filter((v) => v !== chosenCol);
        const innerTypes = new Map(specTypes);
        const innerExprs = new Map(specExprs);
        for (const e of peeled.newInputEntries) {
          innerInputs.push(e.name);
          innerTypes.set(e.name, e.plist);
          innerExprs.set(e.name, e.schema);
        }
        const innerSpec = {
          op: "spec",
          inputs: innerInputs,
          outputs: spec.outputs.slice(),
          branches: peeled.strippedBodies.map((body, idx) => ({ index: idx, body }))
        };
        compiledPeeled = compileSpecToStmts(innerSpec, innerTypes, innerExprs, depth + 1, 0);
        if (compiledPeeled) madeProgress = true;
        arms.push({
          patterns: [{ kind: "tag", tag }],
          body: [...peeled.peeledStmts, ...(compiledPeeled || [innerSpec])]
        });
        continue;
      }

      // Try partial peel with reconstruction (e.g. `br0` matches `/cons`+`demux`, `br1` is fallback):
      // ONLY commit if the inner `spec` actually compiles/splits!
      peeled = tryPeelCommonMatchDemux(survBodies, chosenCol, tag, specTypes, specExprs, {
        allowReconstruct: true
      });
      if (peeled) {
        const innerInputs = spec.inputs.filter((v) => v !== chosenCol);
        const innerTypes = new Map(specTypes);
        const innerExprs = new Map(specExprs);
        for (const e of peeled.newInputEntries) {
          innerInputs.push(e.name);
          innerTypes.set(e.name, e.plist);
          innerExprs.set(e.name, e.schema);
        }
        const innerSpec = {
          op: "spec",
          inputs: innerInputs,
          outputs: spec.outputs.slice(),
          branches: peeled.strippedBodies.map((body, idx) => ({ index: idx, body }))
        };
        compiledPeeled = compileSpecToStmts(innerSpec, innerTypes, innerExprs, depth + 1, 0);
        if (compiledPeeled) {
          madeProgress = true;
          arms.push({
            patterns: [{ kind: "tag", tag }],
            body: [...peeled.peeledStmts, ...compiledPeeled]
          });
          continue;
        }
      }

      const innerSpec = {
        op: "spec",
        inputs: spec.inputs.slice(),
        outputs: spec.outputs.slice(),
        branches: survBodies.map((body, idx) => ({ index: idx, body }))
      };
      const compiledInner =
        tryCompileSpec(innerSpec, specTypes) ||
        (survBodies.length < spec.branches.length
          ? compileSpecToStmts(innerSpec, specTypes, specExprs, depth + 1, 0)
          : null);
      if (compiledInner) madeProgress = true;
      arms.push({
        patterns: [{ kind: "tag", tag }],
        body: Array.isArray(compiledInner) ? compiledInner : [compiledInner || innerSpec]
      });
    }

    if (!madeProgress || arms.length === 0) return null;
    return {
      op: "switch",
      inputs: [chosenCol],
      arms,
      defaultBody: null
    };
  }

  function compileSpecToStmts(specStmt, specTypes, specExprs, depth = 0, demuxDepth = 0) {
    const hoisted = tryHoistProductDemuxFromSpec(specStmt, specTypes, specExprs, depth, demuxDepth);
    if (hoisted) return hoisted;
    const specInputSet = new Set(specStmt.inputs);
    const branchInfos = specStmt.branches.map((b) =>
      extractBranchGuards(b.body, specInputSet, specTypes, procGuards, resolvePlist, strictFailure)
    );
    const sw =
      tryCompileSpec(specStmt, specTypes, branchInfos) ||
      tryPartitionSpecByMultiCols(specStmt, specTypes, specExprs, depth, branchInfos) ||
      trySplitSpecByUnionInput(specStmt, specTypes, specExprs, depth, branchInfos);
    return sw ? [sw] : null;
  }

  function rewriteBlock(stmts, outerTypes, outerExprs) {
    const types = new Map(outerTypes);
    const exprs = new Map(outerExprs);
    for (const s of stmts || []) {
      if (s.op === "chan") {
        types.set(s.name, resolvePlist(s.schema));
        exprs.set(s.name, s.schema);
      }
    }

    const out = [];
    for (const s of stmts || []) {
      if (s.op === "switch") {
        out.push({
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: rewriteBlock(a.body, types, exprs) })),
          defaultBody: s.defaultBody ? rewriteBlock(s.defaultBody, types, exprs) : null
        });
        continue;
      }
      if (s.op !== "spec") {
        out.push(s);
        continue;
      }

      // Recurse into branches first
      const specTypes = new Map();
      const specExprs = new Map();
      for (const v of [...s.inputs, ...s.outputs]) {
        specTypes.set(v, types.get(v));
        specExprs.set(v, exprs.get(v));
      }
      const branches = s.branches.map((b) => ({ ...b, body: rewriteBlock(b.body, specTypes, specExprs) }));
      const specStmt = { ...s, branches };

      const compiled = compileSpecToStmts(specStmt, specTypes, specExprs, 0, 0);
      if (compiled) {
        converted += 1;
        out.push(...compiled);
      } else {
        out.push(specStmt);
      }
    }
    return out;
  }

  function tryCompileSpec(spec, specTypes, precomputedBranchInfos = null) {
    const B = spec.branches.length;
    if (B === 0) return null;

    const specInputSet = new Set(spec.inputs);
    const branchInfos =
      precomputedBranchInfos ||
      spec.branches.map((b) =>
        extractBranchGuards(b.body, specInputSet, specTypes, procGuards, resolvePlist, strictFailure)
      );
    if (branchInfos.some((bi) => bi.dead)) return null;
    const branchGuards = branchInfos.map((bi) => bi.guards);

    // Check every non-final branch is post-guard total (final branch can fail freely!)
    for (let b = 0; b < B - 1; b++) {
      if (!isBlockTotal(spec.branches[b].body, specTypes, branchGuards[b], totalProcs, kernelMap, resolvePlist)) {
        return null;
      }
    }

    // Collect candidate inspected columns (only closed-union inputs constrained by at least one branch)
    const constrainedCols = [];
    for (const inp of spec.inputs) {
      const allTags = unionTagsOf(specTypes.get(inp));
      if (!allTags || allTags.length === 0 || allTags.length > 16) continue;
      let isConstrained = false;
      for (let b = 0; b < B; b++) {
        const g = branchGuards[b].get(inp);
        if (g && g.size < allTags.length) {
          isConstrained = true;
          break;
        }
      }
      if (!isConstrained) continue;
      // Safety check: no branch has an ungated drain of `inp` before inspecting it
      if (spec.branches.some((br) => hasUngatedDrainOf(br.body, inp))) return null;
      constrainedCols.push({ name: inp, allTags });
    }

    if (constrainedCols.length === 0 || constrainedCols.length > maxCols) return null;

    // Defer non-Cartesian joint tuple constraints over `constrainedCols` to `tryPartitionSpecByMultiCols`
    const constrainedSet = new Set(constrainedCols.map((c) => c.name));
    for (const bi of branchInfos) {
      for (const tc of bi.tupleConstraints) {
        if (tc.chans.filter((c) => constrainedSet.has(c)).length >= 2) {
          // Check if `tc` is strictly non-Cartesian across its channels
          const margCounts = tc.chans.map((_, j) => {
            const s = new Set();
            for (const tk of tc.allowed) s.add(tk.split("\x00")[j]);
            return s.size;
          });
          const cart = margCounts.reduce((a, b) => a * b, 1);
          if (tc.allowed.size < cart) return null;
        }
      }
    }

    let gridSize = 1;
    for (const col of constrainedCols) gridSize *= col.allTags.length;
    if (gridSize > maxGrid) return null;

    // Enumerate exact Cartesian grid of tag tuples
    const C = constrainedCols.length;
    const allTuples = [];
    const curTuple = new Array(C);
    const buildGrid = (c) => {
      if (c === C) {
        allTuples.push(curTuple.slice());
        return;
      }
      for (const t of constrainedCols[c].allTags) {
        curTuple[c] = t;
        buildGrid(c + 1);
      }
    };
    buildGrid(0);

    // Remaining uncovered tuples as we process branches 0 .. B-1 in priority order
    let uncovered = allTuples.slice();
    const arms = [];
    let defaultBody = null;

    const tupleMatchesBranch = (t, bIdx) => {
      for (let j = 0; j < C; j++) {
        const g = branchGuards[bIdx].get(constrainedCols[j].name);
        if (g && !g.has(t[j])) return false;
      }
      return true;
    };

    for (let b = 0; b < B; b++) {
      if (uncovered.length === 0) break;
      const matched = [];
      const stillUncovered = [];
      for (const t of uncovered) {
        if (tupleMatchesBranch(t, b)) matched.push(t);
        else stillUncovered.push(t);
      }
      if (matched.length === 0) continue; // dead branch!

      // If this branch matches ALL remaining uncovered tuples, emit as `defaultBody`!
      if (stillUncovered.length === 0) {
        if (arms.length === 0) {
          // Single unconditional branch? Keep as 1-arm switch or defaultBody
          defaultBody = spec.branches[b].body;
        } else {
          defaultBody = spec.branches[b].body;
        }
        uncovered = [];
        break;
      }

      // Compute minimal wildcard-compressed pattern rows for branch `b` over current `uncovered`!
      // Start with each column restricted to `branchGuards[b]` (or `wild` if unconstrained).
      // Then iteratively try relaxing any constrained column `j` to `wild` iff doing so
      // does NOT accidentally match any tuple in `stillUncovered`!
      const colSets = constrainedCols.map((col, j) => {
        const g = branchGuards[b].get(col.name);
        if (!g || g.size === col.allTags.length) return null; // wild!
        return [...g];
      });

      for (let j = 0; j < C; j++) {
        if (colSets[j] === null) continue;
        // Test whether relaxing column `j` to `wild` conflicts with `stillUncovered`
        const conflicts = stillUncovered.some((t) => {
          for (let k = 0; k < C; k++) {
            if (k === j || colSets[k] === null) continue;
            if (!colSets[k].includes(t[k])) return false;
          }
          return true;
        });
        if (!conflicts) colSets[j] = null;
      }

      // Expand non-wild columns into pattern rows
      let rowCount = 1;
      for (const cs of colSets) if (cs !== null) rowCount *= cs.length;
      if (arms.length + rowCount > maxSwitchArms) return null;

      const patRow = new Array(C);
      const emitRows = (j) => {
        if (j === C) {
          arms.push({
            patterns: patRow.slice(),
            body: cloneAst(spec.branches[b].body)
          });
          return;
        }
        if (colSets[j] === null) {
          patRow[j] = { kind: "wild" };
          emitRows(j + 1);
        } else {
          for (const tag of colSets[j]) {
            patRow[j] = { kind: "tag", tag };
            emitRows(j + 1);
          }
        }
      };
      emitRows(0);
      uncovered = stillUncovered;
    }

    if (arms.length === 0 && !defaultBody) return null;

    // Prune any column that ended up `{ kind: "wild" }` in EVERY arm!
    const activeCols = [];
    for (let j = 0; j < C; j++) {
      if (arms.some((a) => a.patterns[j].kind === "tag")) activeCols.push(j);
    }
    if (activeCols.length === 0) {
      // Every arm was wild -> shouldn't happen unless `B === 1` unconditional; bail cleanly
      return null;
    }

    return {
      op: "switch",
      inputs: activeCols.map((j) => constrainedCols[j].name),
      arms: arms.map((a) => ({
        patterns: activeCols.map((j) => a.patterns[j]),
        body: a.body
      })),
      defaultBody
    };
  }

  // Process procedures in bottom-up call-graph post-order (callees before callers)
  // so every callee's compiled `switch` decision tree immediately yields exact
  // interprocedural entry guards for its callers in a single pass!
  const allProcs = mod.procs || [];
  const procByName = new Map(allProcs.map((p) => [p.name, p]));
  const callAdj = new Map();
  const collectSpawns = (stmts, out) => {
    for (const s of stmts || []) {
      if (s.op === "spawn") out.add(s.target);
      else if (s.op === "switch") {
        for (const a of s.arms) collectSpawns(a.body, out);
        if (s.defaultBody) collectSpawns(s.defaultBody, out);
      } else if (s.op === "spec") {
        for (const b of s.branches) collectSpawns(b.body, out);
      }
    }
  };
  for (const p of allProcs) {
    const set = new Set();
    collectSpawns(p.body, set);
    callAdj.set(p.name, set);
  }

  const visited = new Set();
  const postOrder = [];
  const dfsPost = (name) => {
    if (visited.has(name) || !procByName.has(name)) return;
    visited.add(name);
    for (const callee of callAdj.get(name) || []) dfsPost(callee);
    postOrder.push(name);
  };
  for (const p of allProcs) dfsPost(p.name);

  const rewrittenByName = new Map();
  for (const name of postOrder) {
    const proc = procByName.get(name);
    const outerTypes = new Map();
    const outerExprs = new Map();
    for (const p of proc.inputs) {
      outerTypes.set(p.name, resolvePlist(p.schema));
      outerExprs.set(p.name, p.schema);
    }
    for (const p of proc.outputs) {
      outerTypes.set(p.name, resolvePlist(p.schema));
      outerExprs.set(p.name, p.schema);
    }
    const newProc = { ...proc, body: rewriteBlock(proc.body, outerTypes, outerExprs) };
    rewrittenByName.set(name, newProc);
    if (strictFailure) {
      procGuards.set(name, analyzeProcEntryGuards(newProc, procGuards, resolvePlist, strictFailure));
    }
  }

  const procs = allProcs.map((p) => rewrittenByName.get(p.name));

  return { module: { ...mod, procs }, converted };
}

// ---------------------------------------------------------------------------
// Pass 4: Loop-Kernel Extraction & Entry-Guard Peeling
// ---------------------------------------------------------------------------

/**
 * Extract pure self-recursive loop kernels from procs whose exit arms contain
 * external recursive calls (`@lsb_add`, `@lsb_sub`) OR peel entry-only checks
 * on write-only prepend accumulators (`@lsb_shl`) so `fuseKernels` and
 * `synthesizeTables` can turn the hot loop into a verified `chunk_table` kernel!
 */
function extractLoopKernels(mod, resolvePlist) {
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const existingNames = new Set((mod.procs || []).map((p) => p.name));

  // Compute acyclic procs (to distinguish acyclic helpers from external recursive calls)
  const callsOf = new Map();
  const walkCalls = (stmts, set) => {
    for (const s of stmts || []) {
      if (s.op === "spawn") set.add(s.target);
      else if (s.op === "switch") {
        for (const a of s.arms) walkCalls(a.body, set);
        if (s.defaultBody) walkCalls(s.defaultBody, set);
      } else if (s.op === "spec") {
        for (const b of s.branches) walkCalls(b.body, set);
      }
    }
  };
  for (const p of mod.procs || []) {
    const s = new Set();
    walkCalls(p.body, s);
    callsOf.set(p.name, s);
  }
  const acyclicCache = new Map();
  const isAcyclic = (name, visiting = new Set()) => {
    if (acyclicCache.has(name)) return acyclicCache.get(name);
    if (visiting.has(name) || !procMap.has(name)) return false;
    visiting.add(name);
    let ok = true;
    for (const c of callsOf.get(name) || []) {
      if (!isAcyclic(c, visiting)) { ok = false; break; }
    }
    visiting.delete(name);
    acyclicCache.set(name, ok);
    return ok;
  };

  function analyzeBranch(stmts, selfName, outChan) {
    let selfCalls = 0;
    let strictTailSelf = false;
    let hasSpec = false;
    let hasExternalRec = false;
    const walk = (list) => {
      for (const s of list || []) {
        if (s.op === "spec") {
          hasSpec = true;
          for (const b of s.branches) walk(b.body);
        } else if (s.op === "switch") {
          for (const a of s.arms) walk(a.body);
          if (s.defaultBody) walk(s.defaultBody);
        } else if (s.op === "spawn") {
          if (s.target === selfName) {
            selfCalls += 1;
            if (!s.after && !s.token && s.outputs.length === 1 && s.outputs[0] === outChan) {
              strictTailSelf = true;
            }
          } else if (!isAcyclic(s.target)) {
            hasExternalRec = true;
          }
        }
      }
    };
    walk(stmts);
    return { selfCalls, strictTailSelf, hasSpec, hasExternalRec };
  }

  function replaceSelfSpawn(stmts, oldName, newName, oldOut, newOut) {
    return (stmts || []).map((s) => {
      if (s.op === "spawn" && s.target === oldName) {
        return {
          ...s,
          target: newName,
          outputs: s.outputs.map((o) => (o === oldOut ? newOut : o))
        };
      }
      if (s.op === "switch") {
        return {
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: replaceSelfSpawn(a.body, oldName, newName, oldOut, newOut) })),
          defaultBody: s.defaultBody ? replaceSelfSpawn(s.defaultBody, oldName, newName, oldOut, newOut) : null
        };
      }
      if (s.op === "spec") {
        return {
          ...s,
          branches: s.branches.map((b) => ({ ...b, body: replaceSelfSpawn(b.body, oldName, newName, oldOut, newOut) }))
        };
      }
      return s;
    });
  }

  /**
   * Check whether in `loopBody`, field `fieldLabel` (input channel `fieldVar`) is
   * NEVER peeked/matched/switched, and is passed to `spawn @P` strictly as
   * `wrap |T_rec <fieldVar>` with `T_rec !== forbiddenTag`.
   */
  function isPurePrependInLoop(loopBody, fieldLabel, fieldVar, selfName, forbiddenTag) {
    // Check no peek/match/switch/drain on fieldVar
    let peeked = false;
    let wrapTag = null;
    let wrappedVar = null;
    let spawnNextIn = null;
    const muxMap = new Map();
    const walk = (list) => {
      for (const s of list || []) {
        if (s.op === "match" && s.src === fieldVar) peeked = true;
        if (s.op === "switch") {
          if (s.inputs.includes(fieldVar)) peeked = true;
          for (const a of s.arms) walk(a.body);
          if (s.defaultBody) walk(s.defaultBody);
        } else if (s.op === "spec") {
          peeked = true;
        } else if (s.op === "drain" && s.src === fieldVar) {
          peeked = true;
        } else if (s.op === "wrap" && s.src === fieldVar) {
          wrapTag = s.tag;
          wrappedVar = s.dst;
        } else if (s.op === "mux") {
          muxMap.set(s.dst, s.fields);
        } else if (s.op === "spawn" && s.target === selfName) {
          spawnNextIn = s.inputs[0];
        }
      }
    };
    walk(loopBody);
    if (peeked || !wrapTag || wrapTag === forbiddenTag || !spawnNextIn) return false;
    const fields = muxMap.get(spawnNextIn);
    if (!fields) return false;
    const f = fields.find((x) => x.label === fieldLabel);
    return Boolean(f && f.name === wrappedVar);
  }

  const outProcs = [];
  const addedProcs = [];
  let loopsExtracted = 0;

  for (const proc of mod.procs || []) {
    // Only single-input, single-output self-recursive procs with `[chan*, demux?, switch]` body
    if (proc.inputs.length !== 1 || proc.outputs.length !== 1 || !(callsOf.get(proc.name)?.has(proc.name))) {
      outProcs.push(proc);
      continue;
    }
    const inPort = proc.inputs[0];
    const outPort = proc.outputs[0];
    const body = proc.body || [];
    if (body.length === 0) { outProcs.push(proc); continue; }
    const lastStmt = body[body.length - 1];
    if (lastStmt.op !== "switch") { outProcs.push(proc); continue; }

    // Check preceding statements: ONLY `chan` decls and at most ONE `demux` of `inPort.name`!
    let demuxStmt = null;
    let validPrefix = true;
    for (let i = 0; i < body.length - 1; i++) {
      const s = body[i];
      if (s.op === "chan") continue;
      if (s.op === "demux" && !demuxStmt && s.src === inPort.name) {
        demuxStmt = s;
        continue;
      }
      validPrefix = false;
      break;
    }
    if (!validPrefix) { outProcs.push(proc); continue; }
    if (demuxStmt && demuxStmt.fields.length > 4) { outProcs.push(proc); continue; }

    // Ensure every leaf input is flat (not a nested closed-product) so `P <= 4` and `Q <= 4`
    const inPl = resolvePlist(inPort.schema);
    if (!inPl) { outProcs.push(proc); continue; }
    if (demuxStmt) {
      const pf = productFields(inPl, 0);
      if (!pf || pf.length !== demuxStmt.fields.length) { outProcs.push(proc); continue; }
      const nestedProd = pf.some((f) => {
        const sub = subPlist(inPl, f.targetId);
        return sub[0][0] === "closed-product" && sub[0][1].length > 0;
      });
      if (nestedProd) { outProcs.push(proc); continue; }
    }

    const sw = lastStmt;
    const armInfos = sw.arms.map((a) => analyzeBranch(a.body, proc.name, outPort.name));
    const defInfo = sw.defaultBody ? analyzeBranch(sw.defaultBody, proc.name, outPort.name) : null;
    const allInfos = defInfo ? [...armInfos, defInfo] : armInfos;

    let loopBranches = 0;
    let exitBranches = 0;
    let hasExternalRecExit = false;
    let validShape = true;
    for (const info of allInfos) {
      if (info.selfCalls === 0) {
        exitBranches += 1;
        if (info.hasExternalRec || info.hasSpec) hasExternalRecExit = true;
      } else if (info.selfCalls === 1 && info.strictTailSelf && !info.hasSpec && !info.hasExternalRec) {
        loopBranches += 1;
      } else {
        validShape = false;
        break;
      }
    }
    if (!validShape || loopBranches === 0 || exitBranches === 0) {
      outProcs.push(proc);
      continue;
    }

    // --- Case B: Entry-peeked write-only prepend accumulator peeling (e.g. `@lsb_shl_32`)! ---
    if (!hasExternalRecExit && demuxStmt && sw.arms.length >= 2 && defInfo && defInfo.selfCalls === 1 && armInfos.every((a) => a.selfCalls === 0)) {
      // Look for an exit arm `peelIdx` that tests ONE column `col` (all other cols wild) where
      // NO other arm tests `col`, and the default loop arm strictly prepends a non-matching tag onto `col`!
      let peeled = false;
      for (let col = 0; col < sw.inputs.length; col++) {
        const testedArms = [];
        for (let a = 0; a < sw.arms.length; a++) {
          if (sw.arms[a].patterns[col].kind === "tag") testedArms.push(a);
        }
        if (testedArms.length !== 1) continue;
        const peelIdx = testedArms[0];
        const peelArm = sw.arms[peelIdx];
        if (!peelArm.patterns.every((p, j) => j === col || p.kind === "wild")) continue;
        const termTag = peelArm.patterns[col].tag;
        const fieldVar = sw.inputs[col];
        const fEntry = demuxStmt.fields.find((f) => f.name === fieldVar);
        if (!fEntry) continue;
        if (!isPurePrependInLoop(sw.defaultBody, fEntry.label, fieldVar, proc.name, termTag)) continue;

        // Peel `peelArm` outside! Emit `@P_loop` without `col` and without `peelArm`!
        let loopName = `${proc.name}_loop`;
        let seq = 0;
        while (existingNames.has(loopName)) loopName = `${proc.name}_loop${seq++}`;
        existingNames.add(loopName);

        const remInputs = sw.inputs.filter((_, j) => j !== col);
        if (remInputs.length === 0) continue;
        const remArms = sw.arms
          .filter((_, a) => a !== peelIdx)
          .map((a) => ({
            patterns: a.patterns.filter((_, j) => j !== col),
            body: cloneAst(a.body)
          }));
        const loopBodySw = {
          op: "switch",
          inputs: remInputs,
          arms: remArms,
          defaultBody: replaceSelfSpawn(cloneAst(sw.defaultBody), proc.name, loopName, outPort.name, outPort.name)
        };
        const prefixDecls = body.slice(0, body.length - 1).map((s) => cloneAst(s));

        addedProcs.push({
          name: loopName,
          params: [],
          inputs: [cloneAst(inPort)],
          outputs: [cloneAst(outPort)],
          attrs: [...(proc.attrs || [])],
          body: [...prefixDecls, loopBodySw]
        });

        // Outer proc checks `fieldVar == termTag` ONCE at entry, else hands off to `@P_loop`!
        const outerPrefix = body.slice(0, body.length - 1).map((s) => cloneAst(s));
        const remuxName = "%peel_in";
        const outerSw = {
          op: "switch",
          inputs: [fieldVar],
          arms: [
            {
              patterns: [{ kind: "tag", tag: termTag }],
              body: cloneAst(peelArm.body)
            }
          ],
          defaultBody: [
            { op: "chan", name: remuxName, schema: cloneAst(inPort.schema) },
            { op: "mux", fields: demuxStmt.fields.map((f) => ({ label: f.label, name: f.name })), dst: remuxName, schema: cloneAst(demuxStmt.schema) },
            { op: "spawn", target: loopName, schemaArgs: [], inputs: [remuxName], outputs: [outPort.name], after: null, token: null }
          ]
        };
        outProcs.push({
          ...proc,
          body: [...outerPrefix, outerSw]
        });
        loopsExtracted += 1;
        peeled = true;
        break;
      }
      if (peeled) continue;
    }

    // --- Case A: External-exit loop extraction (e.g. `@lsb_add_18`, `@lsb_sub_30`)! ---
    if (!hasExternalRecExit) {
      outProcs.push(proc);
      continue;
    }

    let loopName = `${proc.name}_loop`;
    let seq = 0;
    while (existingNames.has(loopName)) loopName = `${proc.name}_loop${seq++}`;
    existingNames.add(loopName);

    const loopOutName = "%loop_state";
    const makeExitStateBody = () => {
      if (demuxStmt) {
        return [
          {
            op: "mux",
            fields: demuxStmt.fields.map((f) => ({ label: f.label, name: f.name })),
            dst: loopOutName,
            schema: cloneAst(demuxStmt.schema)
          }
        ];
      }
      return [{ op: "splice", src: inPort.name, dst: loopOutName }];
    };

    const loopArms = sw.arms.map((a, idx) => ({
      patterns: cloneAst(a.patterns),
      body: armInfos[idx].selfCalls === 0
        ? makeExitStateBody()
        : replaceSelfSpawn(cloneAst(a.body), proc.name, loopName, outPort.name, loopOutName)
    }));
    const loopDef = sw.defaultBody
      ? (defInfo.selfCalls === 0
          ? makeExitStateBody()
          : replaceSelfSpawn(cloneAst(sw.defaultBody), proc.name, loopName, outPort.name, loopOutName))
      : null;

    const loopPrefix = body.slice(0, body.length - 1).map((s) => cloneAst(s));
    addedProcs.push({
      name: loopName,
      params: [],
      inputs: [cloneAst(inPort)],
      outputs: [{ name: loopOutName, schema: cloneAst(inPort.schema) }],
      attrs: [],
      body: [
        ...loopPrefix,
        { op: "switch", inputs: [...sw.inputs], arms: loopArms, defaultBody: loopDef }
      ]
    });

    // Outer proc calls `@P_loop(%in) -> (%ls_done)` ONCE, then runs original exit switch on `%ls_done`!
    const doneVar = "%ls_done";
    const renamedTail = renameStmtRefs(cloneAst(body), new Map([[inPort.name, doneVar]]));
    outProcs.push({
      ...proc,
      body: [
        { op: "chan", name: doneVar, schema: cloneAst(inPort.schema) },
        { op: "spawn", target: loopName, schemaArgs: [], inputs: [inPort.name], outputs: [doneVar], after: null, token: null },
        ...renamedTail
      ]
    });
    loopsExtracted += 1;
  }

  return {
    module: { ...mod, procs: [...outProcs, ...addedProcs] },
    loopsExtracted
  };
}

// ---------------------------------------------------------------------------
// Pass 5: Dead Unreachable Proc Elimination
// ---------------------------------------------------------------------------

function eliminateDeadProcs(mod) {
  if (!mod.entry) return { module: mod, removed: 0 };
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
  const live = new Set();
  const liveKernels = new Set();
  const stack = [mod.entry];
  const walk = (stmts) => {
    for (const s of stmts || []) {
      if (s.op === "spawn" && !live.has(s.target)) stack.push(s.target);
      else if (s.op === "exec" && !liveKernels.has(s.target)) {
        liveKernels.add(s.target);
        const k = kernelMap.get(s.target);
        if (k) {
          for (const b of k.blocks || []) {
            if (b.term?.op === "handoff" && b.term.target && !live.has(b.term.target)) {
              stack.push(b.term.target);
            }
          }
        }
      } else if (s.op === "switch") {
        for (const a of s.arms) walk(a.body);
        if (s.defaultBody) walk(s.defaultBody);
      } else if (s.op === "spec") {
        for (const b of s.branches) walk(b.body);
      }
    }
  };
  // Also preserve any handoff targets of all retained kernels
  for (const k of mod.kernels || []) {
    for (const b of k.blocks || []) {
      if (b.term?.op === "handoff" && b.term.target && !live.has(b.term.target)) {
        stack.push(b.term.target);
      }
    }
  }
  while (stack.length > 0) {
    const name = stack.pop();
    if (live.has(name)) continue;
    live.add(name);
    const p = procMap.get(name);
    if (p) walk(p.body);
  }
  const kept = (mod.procs || []).filter((p) => live.has(p.name));
  return {
    module: createModule({
      version: mod.version || "0.1",
      layer: mod.layer || "mono",
      entry: mod.entry,
      schemas: cloneAst(mod.schemas || []),
      procs: kept,
      kernels: cloneAst(mod.kernels || []),
      tables: cloneAst(mod.tables || [])
    }),
    removed: (mod.procs || []).length - kept.length
  };
}

// ---------------------------------------------------------------------------
// Pass 5: Strict Accumulator Forcing for Self-Recursive Tail Loops
// ---------------------------------------------------------------------------
//
// In a demand-driven dataflow VM, a tail-recursive loop whose accumulator
// channel (`%acc`) is NOT inspected by the loop's `switch` (e.g. `poly.length`:
// `{ .xs cdr xs, .acc inc acc } length_loop`) builds an O(L) chain of suspended
// `inc` pipeline stages until the base case demands `%acc` (the lazy `foldl`
// space leak).
//
// When a self-recursive tail arm updates an uninspected loop parameter via a
// helper `spawn @H(...%acc...) -> (%acc_next)` where:
//   1. `@H` is total (cannot originate spurious FAIL / divergence), AND
//   2. `@H` actively inspects/transforms `%acc` (reaches switch/match/demux/exec
//      rather than blindly wrapping `%acc` as an opaque tail like `cons`),
// attaching `token: %tok` to `spawn @H` and `after: %tok` to the recursive tail
// `spawn` forces `@H` to settle on the compact closed accumulator before the
// next iteration spawns — collapsing O(L) live pipeline nodes to O(1) while
// keeping structural accumulators like `reverse` lazy and O(L)!

function isProcInspectingInput(procName, inIdx, procMap, trackedFields = null, visited = new Set()) {
  const fieldKey = trackedFields ? [...trackedFields].sort().join(",") : "*";
  const key = `${procName}#${inIdx}:${fieldKey}`;
  if (visited.has(key)) return false;
  visited.add(key);
  const proc = procMap.get(procName);
  if (!proc || inIdx < 0 || inIdx >= proc.inputs.length) return false;

  // Map chanName -> null (whole channel tracked) | Set<label> (specific product fields tracked)
  const tracked = new Map();
  tracked.set(proc.inputs[inIdx].name, trackedFields ? new Set(trackedFields) : null);

  const walk = (stmts) => {
    for (const s of stmts || []) {
      switch (s.op) {
        case "splice":
        case "gate":
        case "coerce":
          if (tracked.has(s.src)) {
            const v = tracked.get(s.src);
            tracked.set(s.dst, v ? new Set(v) : null);
          }
          break;
        case "tee":
          if (tracked.has(s.src)) {
            const v = tracked.get(s.src);
            for (const d of s.dsts) tracked.set(d, v ? new Set(v) : null);
          }
          break;
        case "mux": {
          const hitLabels = new Set();
          for (const f of s.fields) {
            if (tracked.has(f.name)) hitLabels.add(f.label);
          }
          if (hitLabels.size > 0) tracked.set(s.dst, hitLabels);
          break;
        }
        case "demux": {
          if (!tracked.has(s.src)) break;
          const v = tracked.get(s.src);
          if (v === null) {
            for (const f of s.fields) tracked.set(f.name, null);
          } else {
            for (const f of s.fields) {
              if (v.has(f.label)) tracked.set(f.name, null);
            }
          }
          break;
        }
        case "match":
          if (tracked.has(s.src) && tracked.get(s.src) === null) return true;
          break;
        case "exec":
          if (s.inputs.some((c) => tracked.has(c) && tracked.get(c) === null)) return true;
          break;
        case "switch":
          if (s.inputs.some((c) => tracked.has(c) && tracked.get(c) === null)) return true;
          for (const a of s.arms) if (walk(a.body)) return true;
          if (s.defaultBody && walk(s.defaultBody)) return true;
          break;
        case "spec":
          for (const b of s.branches) if (walk(b.body)) return true;
          break;
        case "spawn": {
          for (let i = 0; i < s.inputs.length; i++) {
            if (tracked.has(s.inputs[i])) {
              if (isProcInspectingInput(s.target, i, procMap, tracked.get(s.inputs[i]), visited)) {
                return true;
              }
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return false;
  };

  return walk(proc.body);
}

/**
 * Verify that `rootProc`'s entire reachable call graph is spec-free and every
 * recursive proc consumes at least one union tag (`match`) before recursing
 * (structural termination on finite closed k-wire streams).
 */
function isSafeStrictHelper(rootProc, procMap) {
  const reachable = new Set();
  const stack = [rootProc];
  while (stack.length > 0) {
    const nm = stack.pop();
    if (reachable.has(nm)) continue;
    const p = procMap.get(nm);
    if (!p) continue;
    reachable.add(nm);
    let hasSpec = false;
    const walk = (stmts) => {
      for (const s of stmts || []) {
        if (s.op === "spec") { hasSpec = true; return; }
        if (s.op === "spawn") stack.push(s.target);
        else if (s.op === "switch") {
          for (const a of s.arms) walk(a.body);
          if (s.defaultBody) walk(s.defaultBody);
        }
      }
    };
    walk(p.body);
    if (hasSpec) return false;
  }

  // Compute procs in `reachable` that consume at least one union tag (`match` / `exec`)
  const consumingProcs = new Set();
  let cChanged = true;
  while (cChanged) {
    cChanged = false;
    for (const nm of reachable) {
      if (consumingProcs.has(nm)) continue;
      const p = procMap.get(nm);
      let consumes = false;
      const scan = (stmts) => {
        for (const s of stmts || []) {
          if (s.op === "match" || s.op === "exec" || (s.op === "spawn" && s.target !== nm && consumingProcs.has(s.target))) {
            consumes = true;
            return;
          }
          if (s.op === "switch") {
            for (const a of s.arms) scan(a.body);
            if (s.defaultBody) scan(s.defaultBody);
          }
        }
      };
      scan(p.body);
      if (consumes) {
        consumingProcs.add(nm);
        cChanged = true;
      }
    }
  }

  // Check every recursive proc in the reachable subgraph structurally consumes input
  // (`match`, `exec`, consuming helper, or an exhaustive inner `switch` whose arms all consume)
  // in every arm that recurses.
  for (const nm of reachable) {
    const p = procMap.get(nm);
    const blockAlwaysConsumes = (stmts) => {
      for (const s of stmts || []) {
        if (s.op === "match" || s.op === "exec" || (s.op === "spawn" && s.target !== nm && consumingProcs.has(s.target))) {
          return true;
        }
        if (s.op === "switch") {
          const bodies = [...s.arms.map((a) => a.body), ...(s.defaultBody ? [s.defaultBody] : [])];
          if (bodies.length > 0 && bodies.every((b) => blockAlwaysConsumes(b))) return true;
        }
      }
      return false;
    };
    const checkBlock = (stmts, ancestorConsumed) => {
      const localConsumed = ancestorConsumed || blockAlwaysConsumes(stmts);
      for (const s of stmts || []) {
        if (s.op === "spawn" && s.target === nm) {
          if (!localConsumed) return false;
        } else if (s.op === "switch") {
          for (const a of s.arms) if (!checkBlock(a.body, localConsumed)) return false;
          if (s.defaultBody && !checkBlock(s.defaultBody, localConsumed)) return false;
        }
      }
      return true;
    };
    if (!checkBlock(p.body, false)) return false;
  }
  return true;
}

function forceStrictLoopAccumulators(mod, totalProcs, freshBox) {
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  let forcedCount = 0;

  for (const proc of mod.procs || []) {
    const swIdx = (proc.body || []).findIndex((s) => s.op === "switch");
    if (swIdx < 0) continue;
    const sw = proc.body[swIdx];
    const inspected = new Set(sw.inputs);

    // Identify uninspected loop parameters (either Pattern A: demuxed single product input,
    // or Pattern B: direct multi-input proc parameters).
    let mode = null;
    let inDemux = null;
    const uninspectedSlots = []; // { origChan, label?, argIdx? }

    if (proc.inputs.length === 1) {
      inDemux = proc.body.slice(0, swIdx).find((s) => s.op === "demux" && s.src === proc.inputs[0].name);
      if (inDemux && inDemux.fields.length >= 2) {
        mode = "product";
        for (const f of inDemux.fields) {
          if (!inspected.has(f.name)) uninspectedSlots.push({ origChan: f.name, label: f.label });
        }
      }
    } else if (proc.inputs.length >= 2) {
      mode = "multi";
      for (let i = 0; i < proc.inputs.length; i++) {
        const nm = proc.inputs[i].name;
        if (!inspected.has(nm)) uninspectedSlots.push({ origChan: nm, argIdx: i });
      }
    }

    if (!mode || uninspectedSlots.length === 0) continue;

    const procOutNames = proc.outputs.map((o) => o.name);
    const armBodies = [
      ...sw.arms.map((a) => a.body),
      ...(sw.defaultBody ? [sw.defaultBody] : [])
    ];

    for (const body of armBodies) {
      if (!body || body.length < 2) continue;
      const tailIdx = body.length - 1;
      const tailSpawn = body[tailIdx];
      if (
        tailSpawn.op !== "spawn" ||
        tailSpawn.target !== proc.name ||
        tailSpawn.after ||
        tailSpawn.token ||
        tailSpawn.outputs.length !== procOutNames.length ||
        !tailSpawn.outputs.every((o, i) => o === procOutNames[i])
      ) {
        continue;
      }

      // Map each uninspected slot to the channel passed into the recursive tail call
      const slotNextChan = new Map(); // origChan -> nextChan
      if (mode === "product") {
        if (tailSpawn.inputs.length !== 1) continue;
        const tailMux = body.find((s) => s.op === "mux" && s.dst === tailSpawn.inputs[0]);
        if (!tailMux) continue;
        const muxByLabel = new Map(tailMux.fields.map((f) => [f.label, f.name]));
        for (const sl of uninspectedSlots) {
          const nc = muxByLabel.get(sl.label);
          if (nc && nc !== sl.origChan) slotNextChan.set(sl.origChan, nc);
        }
      } else {
        for (const sl of uninspectedSlots) {
          const nc = tailSpawn.inputs[sl.argIdx];
          if (nc && nc !== sl.origChan) slotNextChan.set(sl.origChan, nc);
        }
      }
      if (slotNextChan.size === 0) continue;

      // Find qualifying helper `spawn` statements producing `nextChan` from `origChan`
      // (either directly or wrapped via a local `mux` such as `{ x: %acc, y: 1 } -> spawn @plus`).
      const muxCarry = new Map(); // muxDst -> Map<origChan, Set<label>>
      for (let i = 0; i < tailIdx; i++) {
        const st = body[i];
        if (st.op === "mux") {
          const hit = new Map();
          for (const f of st.fields) {
            if (slotNextChan.has(f.name)) {
              if (!hit.has(f.name)) hit.set(f.name, new Set());
              hit.get(f.name).add(f.label);
            }
          }
          if (hit.size > 0) muxCarry.set(st.dst, hit);
        }
      }
      const forcedSpawns = [];
      for (let i = 0; i < tailIdx; i++) {
        const st = body[i];
        if (st.op !== "spawn" || st.target === proc.name || st.token || st.outputs.length !== 1) continue;
        const outCh = st.outputs[0];
        let matchedInIdx = -1;
        let trackedFields = null;
        for (const [origChan, nextChan] of slotNextChan.entries()) {
          if (nextChan === outCh) {
            const idx = st.inputs.indexOf(origChan);
            if (idx >= 0) {
              matchedInIdx = idx;
              trackedFields = null;
              break;
            }
            for (let ii = 0; ii < st.inputs.length; ii++) {
              const mc = muxCarry.get(st.inputs[ii]);
              if (mc && mc.has(origChan)) {
                matchedInIdx = ii;
                trackedFields = mc.get(origChan);
                break;
              }
            }
            if (matchedInIdx >= 0) break;
          }
        }
        if (matchedInIdx < 0) continue;
        if (!totalProcs.has(st.target) && !isSafeStrictHelper(st.target, procMap)) continue;
        if (!isProcInspectingInput(st.target, matchedInIdx, procMap, trackedFields)) continue;
        forcedSpawns.push(st);
      }

      if (forcedSpawns.length === 0) continue;

      // Chain tokens onto the qualifying accumulator spawns and gate `tailSpawn` on the last token
      let prevTok = null;
      for (const accSp of forcedSpawns) {
        if (prevTok && !accSp.after) accSp.after = prevTok;
        const tokName = `%sacc_tok_${freshBox.seq++}`;
        accSp.token = tokName;
        prevTok = tokName;
        forcedCount++;
      }
      tailSpawn.after = prevTok;
    }
  }

  return { module: mod, forcedCount };
}

// ---------------------------------------------------------------------------
// Main Entrypoint
// ---------------------------------------------------------------------------

export function simplifyProcs(
  monoMod,
  {
    inline = true,
    deforest = true,
    specToSwitch = true,
    extractLoops = true,
    strictAccumulators = true,
    dce = true,
    maxInlineStmts = 48,
    maxSingleUseStmts = 160,
    maxProcStmts = 800
  } = {}
) {
  let cur = cloneAst(monoMod);
  const resolvePlist = makeSchemaResolver(cur);

  let inlinedCalls = 0;
  let deforestStats = {
    splicesEliminated: 0,
    muxDemuxEliminated: 0,
    wrapFolds: 0,
    trivialDrainsEliminated: 0,
    teeMatchFactors: 0,
    teeDemuxCollapses: 0,
    knownSwitchFolds: 0
  };
  let specsConverted = 0;
  let loopsExtracted = 0;
  let strictAccumulatorsForced = 0;
  let deadProcsRemoved = 0;

  const mergeDeforest = (s) => {
    for (const k of Object.keys(deforestStats)) deforestStats[k] += s[k] || 0;
  };

  const inlineSeqBox = { seq: 0 };
  if (inline) {
    const r = inlineSmallAcyclicProcs(cur, {
      maxInlineStmts,
      maxSingleUseStmts,
      maxProcStmts,
      seqBox: inlineSeqBox
    });
    cur = r.module;
    inlinedCalls += r.inlinedCalls;
  }

  let totalProcs = computeTotalProcs(cur, resolvePlist);

  const freshBox = { seq: 0 };

  if (deforest) {
    const d1 = deforestModule(cur, resolvePlist, totalProcs, freshBox);
    cur = d1.module;
    mergeDeforest(d1.stats);
  }

  if (specToSwitch) {
    totalProcs = computeTotalProcs(cur, resolvePlist);
    const sw = compileSpecsToSwitches(cur, resolvePlist, totalProcs, freshBox);
    cur = sw.module;
    specsConverted += sw.converted;

    // Second deforestation pass to fold newly exposed `switch` arms & known tags!
    if (deforest && sw.converted > 0) {
      totalProcs = computeTotalProcs(cur, resolvePlist);
      const d2 = deforestModule(cur, resolvePlist, totalProcs, freshBox);
      cur = d2.module;
      mergeDeforest(d2.stats);
    }

    // Rounds 2-3: if any `spec`s remain, inline newly spec-free non-cyclic helpers inside
    // `spec` branches (e.g. `@dj_not_ws_`, `@dj_not_digit_`, `@dj_ws_char`, `@dj_digit_nibble`,
    // `@dj_json_string`, `@dj_json_number`, `@dj_parse_atom`) and re-run deforest + specToSwitch!
    for (let round = 0; round < 2; round++) {
      if (!inline || !(cur.procs || []).some((p) => hasSpecOp(p.body))) break;
      const r2 = inlineSmallAcyclicProcs(cur, {
        maxInlineStmts: 160,
        maxSingleUseStmts: 320,
        maxProcStmts: 1100,
        allowExec: false,
        allowSpecCallee: false,
        onlyInSpec: true,
        seqBox: inlineSeqBox
      });
      if (r2.inlinedCalls === 0) break;
      cur = r2.module;
      inlinedCalls += r2.inlinedCalls;
      if (deforest) {
        totalProcs = computeTotalProcs(cur, resolvePlist);
        const d3 = deforestModule(cur, resolvePlist, totalProcs, freshBox);
        cur = d3.module;
        mergeDeforest(d3.stats);
      }
      totalProcs = computeTotalProcs(cur, resolvePlist);
      const sw2 = compileSpecsToSwitches(cur, resolvePlist, totalProcs, freshBox);
      cur = sw2.module;
      specsConverted += sw2.converted;
      if (deforest && sw2.converted > 0) {
        totalProcs = computeTotalProcs(cur, resolvePlist);
        const d4 = deforestModule(cur, resolvePlist, totalProcs, freshBox);
        cur = d4.module;
        mergeDeforest(d4.stats);
      }
    }
  }

  if (extractLoops) {
    const el = extractLoopKernels(cur, resolvePlist);
    cur = el.module;
    loopsExtracted += el.loopsExtracted;
  }

  if (dce) {
    const dc = eliminateDeadProcs(cur);
    cur = dc.module;
    deadProcsRemoved += dc.removed;
  }

  if (strictAccumulators) {
    totalProcs = computeTotalProcs(cur, resolvePlist);
    const sa = forceStrictLoopAccumulators(cur, totalProcs, freshBox);
    cur = sa.module;
    strictAccumulatorsForced += sa.forcedCount;
  }

  return {
    module: cur,
    stats: {
      inlinedCalls,
      ...deforestStats,
      specsConverted,
      loopsExtracted,
      strictAccumulatorsForced,
      deadProcsRemoved
    }
  };
}

/**
 * Post-fusion wrapper inlining: after `fuseKernels` turns recursive bit-loops
 * (`trim_bits`, `_rev_bits`, `_lsb_add_loop`, `_lsb_cmp`, ...) into tiny acyclic
 * `exec @kernel` procs, inline small acyclic wrappers (including `exec` calls)
 * and deforest the exposed `mux -> demux` / `wrap -> match` pairs!
 */
export function inlinePostFusionWrappers(
  monoMod,
  { maxInlineStmts = 28, maxSingleUseStmts = 64, maxProcStmts = 480 } = {}
) {
  let cur = cloneAst(monoMod);
  const resolvePlist = makeSchemaResolver(cur);
  const seqBox = { seq: 10000 };
  const freshBox = { seq: 100000 };
  const r = inlineSmallAcyclicProcs(cur, {
    maxInlineStmts,
    maxSingleUseStmts,
    maxProcStmts,
    allowExec: true,
    allowSpecCallee: false,
    onlyInSpec: false,
    seqBox
  });
  cur = r.module;
  let deforestStats = null;
  let deadProcsRemoved = 0;
  if (r.inlinedCalls > 0) {
    const totalProcs = computeTotalProcs(cur, resolvePlist);
    const d = deforestModule(cur, resolvePlist, totalProcs, freshBox);
    cur = d.module;
    deforestStats = d.stats;
    const dc = eliminateDeadProcs(cur);
    cur = dc.module;
    deadProcsRemoved = dc.removed;
  }
  return {
    module: cur,
    stats: {
      inlinedCalls: r.inlinedCalls,
      deforest: deforestStats,
      deadProcsRemoved
    }
  };
}
