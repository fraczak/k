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

function hasSpecialOps(stmts) {
  for (const s of stmts || []) {
    if (s.op === "exec") return true;
    if (s.op === "spawn" && (s.after || s.token)) return true;
    if (s.op === "switch") {
      for (const a of s.arms) if (hasSpecialOps(a.body)) return true;
      if (s.defaultBody && hasSpecialOps(s.defaultBody)) return true;
    } else if (s.op === "spec") {
      for (const b of s.branches) if (hasSpecialOps(b.body)) return true;
    }
  }
  return false;
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
  return function resolvePlist(expr) {
    if (!expr) return null;
    const key = JSON.stringify(expr);
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

function inlineSmallAcyclicProcs(mod, { maxInlineStmts = 32, maxSingleUseStmts = 64, maxProcStmts = 420 } = {}) {
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

  // Acyclicity check
  const acyclicCache = new Map();
  const isAcyclic = (name, visiting = new Set()) => {
    if (acyclicCache.has(name)) return acyclicCache.get(name);
    if (visiting.has(name) || !procMap.has(name)) return false;
    visiting.add(name);
    let ok = true;
    for (const cal of callsOf.get(name) || []) {
      if (!isAcyclic(cal, visiting)) {
        ok = false;
        break;
      }
    }
    visiting.delete(name);
    acyclicCache.set(name, ok);
    return ok;
  };

  // Topological order of acyclic procs (callees before callers)
  const topo = [];
  const visited = new Set();
  const visitTopo = (name) => {
    if (visited.has(name) || !procMap.has(name)) return;
    visited.add(name);
    for (const cal of callsOf.get(name) || []) {
      if (isAcyclic(cal)) visitTopo(cal);
    }
    topo.push(name);
  };
  for (const p of mod.procs || []) if (isAcyclic(p.name)) visitTopo(p.name);
  for (const p of mod.procs || []) if (!visited.has(p.name)) topo.push(p.name);

  let inlinedCalls = 0;
  let globalSeq = 0;

  const updatedProcs = new Map((mod.procs || []).map((p) => [p.name, cloneAst(p)]));

  const canInline = (calleeName) => {
    if (calleeName === mod.entry) return false;
    if (!isAcyclic(calleeName)) return false;
    const callee = updatedProcs.get(calleeName);
    if (!callee || hasSpecialOps(callee.body)) return false;
    const sz = countStmts(callee.body);
    if (sz <= maxInlineStmts) return true;
    if ((callCounts.get(calleeName) || 0) === 1 && sz <= maxSingleUseStmts) return true;
    return false;
  };

  const inlineInBlock = (stmts, budgetBox) => {
    const out = [];
    for (const s of stmts || []) {
      if (s.op === "spawn" && !s.after && !s.token && canInline(s.target)) {
        const callee = updatedProcs.get(s.target);
        const calleeSz = countStmts(callee.body);
        if (budgetBox.cur + calleeSz <= maxProcStmts) {
          const seq = globalSeq++;
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
          arms: s.arms.map((a) => ({ ...a, body: inlineInBlock(a.body, budgetBox) })),
          defaultBody: s.defaultBody ? inlineInBlock(s.defaultBody, budgetBox) : null
        });
      } else if (s.op === "spec") {
        out.push({
          ...s,
          branches: s.branches.map((b) => ({ ...b, body: inlineInBlock(b.body, budgetBox) }))
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
    proc.body = inlineInBlock(proc.body, budgetBox);
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

      // --- Rule 4: Trivial `const_unit -> drain` & empty `barrier`/`gate` removal ---
      for (let i = 0; i < cur.length; i++) {
        const s = cur[i];
        if (s.op !== "const_unit" || !localDecls.has(s.dst)) continue;
        const cIdx = consAt.get(s.dst);
        if (cIdx === undefined) continue;
        const cs = cur[cIdx];
        if (cs.op === "drain" && cs.src === s.dst) {
          const declIdx = localDecls.get(s.dst).idx;
          cur = cur.filter((_, k) => k !== declIdx && k !== i && k !== cIdx);
          stats.trivialDrainsEliminated += 1;
          changed = true;
          break;
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

          // 5d: Prefix-atomic `tee -> demux` collapse (O(N^2) -> O(N)!)
          if (
            prefixAtomic.has(s.src) &&
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

function extractBranchGuards(stmts, specInputSet, specTypes) {
  // Trace simple pass-through aliases (`gate`, `splice`) to catch `gate %bar, %x -> %x2; match /_ %x2`
  const aliasOf = new Map();
  for (const v of specInputSet) aliasOf.set(v, v);
  const guards = new Map(); // specInput -> Set<tag>

  const recordGuard = (origInput, tagSet) => {
    const pl = specTypes.get(origInput);
    const all = unionTagsOf(pl);
    if (!all) return;
    if (!guards.has(origInput)) {
      guards.set(origInput, new Set([...tagSet].filter((t) => all.includes(t))));
    } else {
      const cur = guards.get(origInput);
      const inter = new Set([...cur].filter((t) => tagSet.has(t)));
      guards.set(origInput, inter);
    }
  };

  for (const s of stmts || []) {
    if (s.op === "gate" || s.op === "splice") {
      if (aliasOf.has(s.src)) aliasOf.set(s.dst, aliasOf.get(s.src));
    } else if (s.op === "match") {
      const orig = aliasOf.get(s.src);
      if (orig) recordGuard(orig, new Set([s.tag]));
    } else if (s.op === "switch" && s.inputs.length === 1 && !s.defaultBody) {
      const orig = aliasOf.get(s.inputs[0]);
      if (orig && s.arms.length > 0 && s.arms.every((a) => a.patterns[0].kind === "tag")) {
        recordGuard(orig, new Set(s.arms.map((a) => a.patterns[0].tag)));
      }
    }
  }
  return guards;
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
  { maxCols = 4, maxGrid = 64, maxSwitchArms = 24 } = {}
) {
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
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
    const out = [];
    for (const s of body) {
      if (s.op === "switch") {
        const col = s.inputs.indexOf(chanName);
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
          }
        }
      }
      out.push(cloneAst(s));
    }
    return out;
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

  function tryPeelCommonMatchDemux(survBodies, chanName, tag, specTypes, specExprs) {
    // Every surviving branch must have a single top-level `match /tag chanName -> %m_b`
    // and no other references to `chanName`!
    const matchInfo = [];
    for (const body of survBodies) {
      if (countChanRefsDeep(body, chanName) !== 1) return null;
      const mIdx = body.findIndex((s) => s.op === "match" && s.src === chanName && s.tag === tag);
      if (mIdx === -1) return null;
      const dst = body[mIdx].dst;
      const declIdx = body.findIndex((s) => s.op === "chan" && s.name === dst);
      if (declIdx === -1) return null;
      matchInfo.push({ mIdx, declIdx, dst, dstSchema: body[declIdx].schema });
    }

    const sharedM = nextFresh("pm");
    const mSchemaExpr = cloneAst(matchInfo[0].dstSchema);
    const mPlist = resolvePlist(mSchemaExpr);

    const peeledStmts = [
      { op: "chan", name: sharedM, schema: mSchemaExpr },
      { op: "match", tag, src: chanName, dst: sharedM }
    ];

    let strippedBodies = survBodies.map((body, idx) => {
      const { mIdx, declIdx, dst } = matchInfo[idx];
      const filtered = body.filter((_, i) => i !== mIdx && i !== declIdx);
      return renameStmtRefs(filtered, new Map([[dst, sharedM]]));
    });

    // Optionally peel a common top-level `demux sharedM : S -> (...)` if every branch does it!
    const newInputEntries = [];
    if (mPlist && mPlist[0]?.[0] === "closed-product") {
      const demuxInfo = [];
      let allDemux = true;
      for (const body of strippedBodies) {
        if (countChanRefsDeep(body, sharedM) !== 1) {
          allDemux = false;
          break;
        }
        const dIdx = body.findIndex((s) => s.op === "demux" && s.src === sharedM);
        if (dIdx === -1) {
          allDemux = false;
          break;
        }
        const ds = body[dIdx];
        const fieldDeclIdxs = [];
        const fieldSchemas = new Map();
        for (const f of ds.fields) {
          const fDecl = body.findIndex((s) => s.op === "chan" && s.name === f.name);
          if (fDecl === -1) {
            allDemux = false;
            break;
          }
          fieldDeclIdxs.push(fDecl);
          fieldSchemas.set(f.label, { oldName: f.name, schema: body[fDecl].schema });
        }
        if (!allDemux) break;
        demuxInfo.push({ dIdx, ds, fieldDeclIdxs: new Set(fieldDeclIdxs), fieldSchemas });
      }

      if (allDemux && demuxInfo.length === strippedBodies.length && demuxInfo[0].ds.fields.length > 0) {
        const refFields = demuxInfo[0].ds.fields;
        const sharedByLabel = new Map();
        const demuxFieldsOut = [];
        for (const f of refFields) {
          const sf = nextFresh("pf");
          const fSchema = cloneAst(demuxInfo[0].fieldSchemas.get(f.label).schema);
          sharedByLabel.set(f.label, sf);
          peeledStmts.push({ op: "chan", name: sf, schema: fSchema });
          demuxFieldsOut.push({ label: f.label, name: sf });
          newInputEntries.push({ name: sf, plist: resolvePlist(fSchema), schema: fSchema });
        }
        peeledStmts.push({
          op: "demux",
          src: sharedM,
          schema: cloneAst(demuxInfo[0].ds.schema),
          fields: demuxFieldsOut
        });
        strippedBodies = strippedBodies.map((body, idx) => {
          const { dIdx, fieldDeclIdxs, fieldSchemas } = demuxInfo[idx];
          const filtered = body.filter((_, i) => i !== dIdx && !fieldDeclIdxs.has(i));
          const cmap = new Map();
          for (const [lbl, sf] of sharedByLabel.entries()) {
            cmap.set(fieldSchemas.get(lbl).oldName, sf);
          }
          return renameStmtRefs(filtered, cmap);
        });
      }
    }

    if (newInputEntries.length === 0) {
      newInputEntries.push({ name: sharedM, plist: mPlist, schema: mSchemaExpr });
    }

    return { peeledStmts, strippedBodies, newInputEntries };
  }

  function trySplitSpecByUnionInput(spec, specTypes, specExprs, depth = 0) {
    if (depth >= 4 || spec.branches.length < 2) return null;
    const specInputSet = new Set(spec.inputs);
    const branchGuards = spec.branches.map((b) => extractBranchGuards(b.body, specInputSet, specTypes));

    // Only split on a closed-union input unconditionally constrained by branch 0
    // (guarantees peeking the tag preserves exact demand/termination order).
    let chosenCol = null;
    let chosenTags = null;
    for (const inp of spec.inputs) {
      const allTags = unionTagsOf(specTypes.get(inp));
      if (!allTags || allTags.length === 0 || allTags.length > 16) continue;
      const g0 = branchGuards[0].get(inp);
      if (!g0 || g0.size >= allTags.length) continue;
      if (spec.branches.some((br) => hasUngatedDrainOf(br.body, inp))) continue;
      chosenCol = inp;
      chosenTags = allTags;
      break;
    }
    if (!chosenCol) return null;

    const arms = [];
    let madeProgress = false;

    for (const tag of chosenTags) {
      const survIndices = [];
      for (let b = 0; b < spec.branches.length; b++) {
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
      const peeled = tryPeelCommonMatchDemux(survBodies, chosenCol, tag, specTypes, specExprs);
      if (peeled) {
        const innerInputs = [];
        for (const v of spec.inputs) {
          if (v !== chosenCol) innerInputs.push(v);
        }
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
          branches: peeled.strippedBodies.map((body, idx) => ({
            index: idx,
            body
          }))
        };
        const compiledInner =
          tryCompileSpec(innerSpec, innerTypes) ||
          trySplitSpecByUnionInput(innerSpec, innerTypes, innerExprs, depth + 1);
        if (compiledInner) madeProgress = true;
        arms.push({
          patterns: [{ kind: "tag", tag }],
          body: [...peeled.peeledStmts, compiledInner || innerSpec]
        });
      } else {
        const innerSpec = {
          op: "spec",
          inputs: spec.inputs.slice(),
          outputs: spec.outputs.slice(),
          branches: survBodies.map((body, idx) => ({ index: idx, body }))
        };
        const compiledInner = tryCompileSpec(innerSpec, specTypes);
        if (compiledInner) madeProgress = true;
        arms.push({
          patterns: [{ kind: "tag", tag }],
          body: [compiledInner || innerSpec]
        });
      }
    }

    if (!madeProgress || arms.length === 0) return null;
    return {
      op: "switch",
      inputs: [chosenCol],
      arms,
      defaultBody: null
    };
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

    return (stmts || []).map((s) => {
      if (s.op === "switch") {
        return {
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: rewriteBlock(a.body, types, exprs) })),
          defaultBody: s.defaultBody ? rewriteBlock(s.defaultBody, types, exprs) : null
        };
      }
      if (s.op !== "spec") return s;

      // Recurse into branches first
      const specTypes = new Map();
      const specExprs = new Map();
      for (const v of [...s.inputs, ...s.outputs]) {
        specTypes.set(v, types.get(v));
        specExprs.set(v, exprs.get(v));
      }
      const branches = s.branches.map((b) => ({ ...b, body: rewriteBlock(b.body, specTypes, specExprs) }));
      const specStmt = { ...s, branches };

      const sw = tryCompileSpec(specStmt, specTypes) || trySplitSpecByUnionInput(specStmt, specTypes, specExprs);
      if (sw) {
        converted += 1;
        return sw;
      }
      return specStmt;
    });
  }

  function tryCompileSpec(spec, specTypes) {
    const B = spec.branches.length;
    if (B === 0) return null;

    const specInputSet = new Set(spec.inputs);
    const branchGuards = spec.branches.map((b) => extractBranchGuards(b.body, specInputSet, specTypes));

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

  const procs = (mod.procs || []).map((proc) => {
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
    return { ...proc, body: rewriteBlock(proc.body, outerTypes, outerExprs) };
  });

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
  const live = new Set();
  const stack = [mod.entry];
  const walk = (stmts) => {
    for (const s of stmts || []) {
      if (s.op === "spawn" && !live.has(s.target)) stack.push(s.target);
      else if (s.op === "switch") {
        for (const a of s.arms) walk(a.body);
        if (s.defaultBody) walk(s.defaultBody);
      } else if (s.op === "spec") {
        for (const b of s.branches) walk(b.body);
      }
    }
  };
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
// Main Entrypoint
// ---------------------------------------------------------------------------

export function simplifyProcs(
  monoMod,
  {
    inline = true,
    deforest = true,
    specToSwitch = true,
    extractLoops = true,
    dce = true,
    maxInlineStmts = 32,
    maxSingleUseStmts = 64,
    maxProcStmts = 420
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
  let deadProcsRemoved = 0;

  const mergeDeforest = (s) => {
    for (const k of Object.keys(deforestStats)) deforestStats[k] += s[k] || 0;
  };

  if (inline) {
    const r = inlineSmallAcyclicProcs(cur, { maxInlineStmts, maxSingleUseStmts, maxProcStmts });
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

  return {
    module: cur,
    stats: {
      inlinedCalls,
      ...deforestStats,
      specsConverted,
      loopsExtracted,
      deadProcsRemoved
    }
  };
}
