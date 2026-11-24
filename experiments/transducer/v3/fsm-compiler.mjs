/**
 * Iteration 3: Static Symbolic Transducer Compiler (FSM & Tail-Loop Synthesis).
 *
 * Compiles closed / runtime-monomorphic K blueprints (from BlueprintRegistryV2)
 * into explicit deterministic decision DAGs operating over abstract union-tag
 * `TokenDeque` streams — 100% orthogonal to bit-packing / variable-size symbols!
 *
 * Two automatic compilation targets (zero relation-specific hardcoding):
 *   1. `COMPILED_FSM`  : finite (acyclic) relations (`_full_sub_bit`, `_full_add_bit`,
 *                        `_pop_lsb_bit`, `_push_bit_acc`, `_lsb_push_0/1`, `lsb_shl1`,
 *                        `_le1_bit?`, `_classify_bits`, `_drop1/2/4/16`).
 *   2. `COMPILED_LOOP` : self-recursive tail-loop relations whose loop step is finite
 *                        (`trim_bits`, `_rev_bits`, `_lsb_sub`, `_lsb_add`, `_lsb_split`,
 *                        `lsb_shl`, `_half_max_tally`, `_cmp_msb`).
 *                        Finite-enum loop ports (`b`, `c`, `ord`) automatically become
 *                        in-register finite states (zero per-bit FIFO traffic!), and
 *                        recursive exit continuations (`msb_drop_zeros rev_bits`) hand
 *                        off cleanly via `cont` output expressions.
 *
 * Any outer orchestrator (`_nat_divmod`, `_lsb_mul`, `divmod`, `times`) returns
 * `null` and remains a JIT-expanded `STUB` in the multi-port network!
 */

import { patternLeafPaths } from "../v2/wires.mjs";
import { plistHasAny } from "../v2/blueprint.mjs";

const BAIL = Symbol("BAIL");
const MAX_COMPILED_NODES = 256;
const MAX_EVAL_STEPS = 4000;
const MAX_INLINE_DEPTH = 24;

function bail() {
  throw BAIL;
}

function cloneState(st) {
  return {
    peeks: st.peeks.map((a) => a.slice()),
    drained: st.drained.slice(),
    schemas: st.schemas.map((s) => ({ plist: s.plist, nodeId: s.nodeId })),
    selfCall: st.selfCall
  };
}

function schemaKey(s) {
  const entry = s.plist?.[s.nodeId];
  if (!entry) return "?";
  return `${entry[0]}:${s.nodeId}:${entry[1].map(([l]) => l).join(",")}`;
}

function svalKey(v) {
  if (!v) return "null";
  switch (v.kind) {
    case "unit": return "U";
    case "port": return `P(${v.p},${v.depth})`;
    case "selfOut": return `SO(${v.q})`;
    case "cons": return `C(${v.tag},${svalKey(v.tail)})`;
    case "bundle": {
      const parts = [];
      for (const [k, val] of v.fields.entries()) parts.push(`${k}:${svalKey(val)}`);
      return `B{${parts.join(",")}}`;
    }
    case "cont": return `K(${v.bpKey},${svalKey(v.inVal)})`;
  }
  return "?";
}

function stateKey(st) {
  const parts = [];
  for (let p = 0; p < st.peeks.length; p++) {
    parts.push(`${st.peeks[p].join(".")}|${st.drained[p] ? 1 : 0}|${schemaKey(st.schemas[p])}`);
  }
  if (st.selfCall) parts.push("SC");
  return parts.join(";");
}

function containsSelfOut(v) {
  if (!v) return false;
  if (v.kind === "selfOut") return true;
  if (v.kind === "cons") return containsSelfOut(v.tail);
  if (v.kind === "bundle") {
    for (const c of v.fields.values()) if (containsSelfOut(c)) return true;
  }
  if (v.kind === "cont") return containsSelfOut(v.inVal);
  return false;
}

function buildSelfOutVal(plist, nodeId, leafIdxBox) {
  const [kind, edges] = plist[nodeId];
  if (kind === "closed-product" && edges.length > 0) {
    const fields = new Map();
    for (const [label, target] of edges) {
      fields.set(label, buildSelfOutVal(plist, target, leafIdxBox));
    }
    return { kind: "bundle", fields };
  }
  const q = leafIdxBox.next++;
  return { kind: "selfOut", q };
}

function collectPortIds(v, out = new Set()) {
  if (!v) return out;
  if (v.kind === "port") out.add(v.p);
  else if (v.kind === "cons") collectPortIds(v.tail, out);
  else if (v.kind === "bundle") {
    for (const c of v.fields.values()) collectPortIds(c, out);
  } else if (v.kind === "cont") {
    collectPortIds(v.inVal, out);
  }
  return out;
}

function portsUsedByPaths(inVal, usedPaths) {
  const out = new Set();
  if (!usedPaths || usedPaths.size === 0) return out;
  for (const pk of usedPaths) {
    if (pk === "") {
      collectPortIds(inVal, out);
      continue;
    }
    let cur = inVal;
    for (const seg of pk.split(".")) {
      if (cur?.kind !== "bundle") break;
      cur = cur.fields.get(seg);
    }
    collectPortIds(cur, out);
  }
  return out;
}

function collectPortRefs(v, out = []) {
  if (!v) return out;
  if (v.kind === "port") out.push(v);
  else if (v.kind === "cons") collectPortRefs(v.tail, out);
  else if (v.kind === "bundle") {
    for (const c of v.fields.values()) collectPortRefs(c, out);
  } else if (v.kind === "cont") {
    collectPortRefs(v.inVal, out);
  }
  return out;
}

function svalToLeaves(v, out = []) {
  if (v.kind === "bundle") {
    for (const child of v.fields.values()) svalToLeaves(child, out);
    return out;
  }
  out.push(v);
  return out;
}

/**
 * Flatten a pure scalar SVal (`unit` / `cons` / `port`) into either:
 *   - `{ kind: "const", tokens: [...] }` (closed constant ending in `unit`)
 *   - `{ kind: "splice", prefix: [...], p, depth }` (`prefix` prepended onto `Port(p, depth)`)
 *   - `{ kind: "cont", bp, inLeaves: [...] }` (exit continuation blueprint)
 */
function compileOutExpr(v, st) {
  if (v.kind === "cont") {
    const rawIn = svalToLeaves(v.inVal);
    const compiledIn = rawIn.map((x) => {
      const c = compileOutExpr(x, st);
      if (c.kind === "cont") bail();
      return c;
    });
    return { kind: "cont", bp: v.bp, inExprs: compiledIn };
  }
  const prefix = [];
  let cur = v;
  while (cur.kind === "cons") {
    prefix.push(cur.tag);
    cur = cur.tail;
  }
  if (cur.kind === "unit") {
    return { kind: "const", tokens: prefix };
  }
  if (cur.kind === "port") {
    const { p, depth } = cur;
    // Any tokens peeked at indices `depth .. st.peeks[p].length - 1` must be re-emitted
    // after `prefix` and before the unread stream of port `p`!
    const unconsumed = st.peeks[p].slice(depth);
    if (st.drained[p]) {
      // Port p was already consumed all the way to `{}` -> this is a closed constant!
      return { kind: "const", tokens: [...prefix, ...unconsumed] };
    }
    return {
      kind: "splice",
      newPrefix: prefix,
      unconsumed,
      prefix: [...prefix, ...unconsumed],
      p,
      consumeCount: st.peeks[p].length
    };
  }
  bail();
}

function buildInitialInVal(plist, nodeId, leafIdxBox) {
  const [kind, edges] = plist[nodeId];
  if (kind === "closed-product" && edges.length > 0) {
    const fields = new Map();
    for (const [label, target] of edges) {
      fields.set(label, buildInitialInVal(plist, target, leafIdxBox));
    }
    return { kind: "bundle", fields };
  }
  const p = leafIdxBox.next++;
  return { kind: "port", p, depth: 0 };
}

/**
 * Check if `bp` can fail on `inVal` given currently known `peeks`, or if a branch
 * is trivially ruled out by its static `leadingGuards` against `st.peeks`.
 */
function branchRuledOut(branch, inVal, st) {
  if (!branch.guards || branch.guards.size === 0) return false;
  for (const [pathKey, allowed] of branch.guards.entries()) {
    let cur = inVal;
    if (pathKey) {
      for (const seg of pathKey.split(".")) {
        if (cur?.kind !== "bundle") { cur = null; break; }
        cur = cur.fields.get(seg);
      }
    }
    if (!cur) continue;
    if (cur.kind === "cons") {
      if (!allowed.has(cur.tag)) return true;
    } else if (cur.kind === "port") {
      if (cur.depth < st.peeks[cur.p].length) {
        if (!allowed.has(st.peeks[cur.p][cur.depth])) return true;
      }
    }
  }
  return false;
}

export class TransducerCompilerV3 {
  constructor(registryV2) {
    this.registry = registryV2;
    this.cache = new Map(); // relHash -> CompiledTransducer | null
    this._compiling = new Set();
    this._totalCache = new Map();
    this.stats = {
      compiledFSMs: 0,
      compiledLoops: 0,
      fallbackJIT: 0
    };
  }

  /**
   * Sound conservative check: returns `true` only when `relHash` is provably total
   * on its closed input domain (no `div` failure paths possible). Used to allow
   * exit continuations like `msb_drop_zeros` / `rev_bits` / `_rev_bits` inside
   * multi-branch loops (`_lsb_sub`, `_lsb_add`, `_lsb_split`) once the branch's
   * own guards have already matched!
   */
  isProvablyTotal(relHash) {
    if (this._totalCache.has(relHash)) return this._totalCache.get(relHash);
    if (this._compiling.has(relHash)) return false;
    const bp = this.registry.getBlueprint(relHash);
    // Pure alias or non-div wrapper over a provably total relation (e.g. `rev_bits`, `msb_drop_zeros`)
    const checkNoDiv = (node) => {
      switch (node.kind) {
        case "identity":
        case "unit":
        case "vid":
        case "dot":
          return true;
        case "div":
        case "multi-switch":
          return false;
        case "product":
          return node.fields.every((f) => checkNoDiv(f.blueprint));
        case "comp":
          return node.steps.every(checkNoDiv);
        case "stub":
          return this.isProvablyTotal(node.relHash);
        default:
          return false;
      }
    };
    if (checkNoDiv(bp.root)) {
      this._totalCache.set(relHash, true);
      return true;
    }
    // Or compile it first and verify it has zero `FAIL` leaves!
    const compiled = this.getCompiled(relHash);
    if (compiled && !compiled.hasFail) {
      this._totalCache.set(relHash, true);
      return true;
    }
    this._totalCache.set(relHash, false);
    return false;
  }

  getCompiled(relHash) {
    if (this.cache.has(relHash)) {
      return this.cache.get(relHash);
    }
    if (this._compiling.has(relHash)) return null;
    this._compiling.add(relHash);
    let compiled;
    try {
      compiled = this._tryCompile(relHash);
    } finally {
      this._compiling.delete(relHash);
    }
    this.cache.set(relHash, compiled);
    if (compiled) {
      if (compiled.isLoop) this.stats.compiledLoops++;
      else this.stats.compiledFSMs++;
    } else {
      this.stats.fallbackJIT++;
    }
    return compiled;
  }

  _tryCompile(relHash) {
    const bp = this.registry.getBlueprint(relHash);

    // Pure alias forwarding (e.g. `msb_drop_zeros = trim_bits`)
    if (bp.root.kind === "stub" && bp.root.relHash !== relHash) {
      const target = this.getCompiled(bp.root.relHash);
      if (target) {
        return { ...target, relHash, name: bp.name };
      }
      return null;
    }

    const isFinite = this.registry.isFiniteRel(relHash);
    const inLeaves = patternLeafPaths(bp.inPlist);
    const outLeaves = patternLeafPaths(bp.outPlist);
    const P = inLeaves.length;
    const Q = outLeaves.length;

    // Require at least 1 input leaf and 1 output leaf
    if (P === 0 || Q === 0) return null;

    // For non-finite relations, attempt compilation if either:
    //  (a) direct self-recursive tail loop (`trim_bits`, `_rev_bits`, `_lsb_sub`, `_lsb_add`,
    //      `_lsb_split`, `lsb_shl`, `_half_max_tally`, `_cmp_msb`), OR
    //  (b) a thin single-step wrapper whose external recursive calls are provably total
    //      (e.g. `msb_drop_zeros = < /_ |_, /1 |1, /0 trim_bits >`!).
    const hasSelf = this._hasDirectSelfRef(bp.root, relHash);
    if (!isFinite && !hasSelf) {
      // Only try small non-self wrappers (like `msb_drop_zeros`, `rev_bits`) whose AST has no
      // deep product-in-union structures; complex orchestrators bail immediately.
      if (bp.root.kind !== "multi-switch") return null;
    }

    let nodeCount = 0;
    let evalSteps = 0;
    let hasLoopLeaf = false;
    let hasTmcEmit = false;
    let hasExitLeaf = false;
    let hasFail = false;
    const dnodeById = new Map();
    const memo = new Map();
    let nextDNodeId = 1;
    let nextBpKey = 1;
    let nextContId = 1;
    const bpKeyMap = new WeakMap();
    const contIdMap = new WeakMap();
    const getBpKey = (b) => {
      let k = bpKeyMap.get(b);
      if (!k) { k = nextBpKey++; bpKeyMap.set(b, k); }
      return k;
    };
    const getContId = (fn) => {
      let k = contIdMap.get(fn);
      if (!k) { k = nextContId++; contIdMap.set(fn, k); }
      return k;
    };

    const allocNode = (obj) => {
      if (++nodeCount > MAX_COMPILED_NODES) bail();
      const n = { id: nextDNodeId++, ...obj };
      dnodeById.set(n.id, n);
      return n;
    };

    const FAIL_NODE = { id: 0, kind: "fail" };

    // Structural deduplication for identical Peek/Shift decision nodes
    const dedupMap = new Map();
    const makeBranchNode = (kind, p, depth, cases) => {
      // Collapse if all cases go to the exact same node!
      const vals = Object.values(cases);
      if (vals.length === 0) return FAIL_NODE;
      if (vals.every((v) => v === vals[0]) && kind === "peek") {
        return vals[0];
      }
      const sig = `${kind}:${p}:${depth}|${Object.keys(cases).sort().map((t) => `${t}=${cases[t].id}`).join(",")}`;
      if (dedupMap.has(sig)) return dedupMap.get(sig);
      const n = allocNode({ kind, p, depth, cases });
      dedupMap.set(sig, n);
      return n;
    };

    const makeEmitLeaf = (outVal, st) => {
      const rawOut = svalToLeaves(outVal);
      if (rawOut.length !== Q) bail();
      const outExprs = rawOut.map((v) => compileOutExpr(v, st));

      // Verify each input port is spliced at most once (zero-copy linearity!)
      const usedPorts = new Set();
      const markPort = (expr) => {
        if (expr.kind === "splice") {
          if (usedPorts.has(expr.p)) bail();
          usedPorts.add(expr.p);
        } else if (expr.kind === "cont") {
          for (const sub of expr.inExprs) markPort(sub);
        }
      };
      for (const e of outExprs) markPort(e);

      // Compute ports that must be drained (not forwarded via splice and not already consumed to `{}`)
      const drainPorts = [];
      const unitClosedPorts = [];
      for (let p = 0; p < P; p++) {
        if (usedPorts.has(p)) continue;
        if (st.drained[p]) unitClosedPorts.push(p);
        else drainPorts.push(p);
      }

      const sig = `emit:${JSON.stringify(outExprs.map((e) => (e.kind === "cont" ? { k: "cont", b: getBpKey(e.bp), i: e.inExprs } : e)))}|d:${drainPorts.join(",")}|u:${unitClosedPorts.join(",")}`;
      if (dedupMap.has(sig)) return dedupMap.get(sig);
      hasExitLeaf = true;
      const n = allocNode({ kind: "emit", outExprs, drainPorts, unitClosedPorts });
      dedupMap.set(sig, n);
      return n;
    };

    const makeLoopLeaf = (nextInVal, st, outEmitPrefixes = null) => {
      const rawNext = svalToLeaves(nextInVal);
      if (rawNext.length !== P) bail();
      const nextExprs = rawNext.map((v) => {
        const e = compileOutExpr(v, st);
        if (e.kind === "cont") bail();
        return e;
      });

      // Verify linear use of ports in loop iteration (each port p appears at most once;
      // in-place `e.p === idx` keeps the exact same TokenDeque without even swapping!)
      const usedPorts = new Set();
      for (let idx = 0; idx < P; idx++) {
        const e = nextExprs[idx];
        if (e.kind === "splice") {
          if (e.p !== idx || usedPorts.has(e.p)) bail();
          usedPorts.add(e.p);
        }
      }

      // Any port `p` replaced by a `const` (e.g. `b = "0"/"1"` or `x = "_"`) must have been
      // consumed to `{}` (or we drain it once when transitioning from stream to const!)
      const drainOncePorts = [];
      const unitClosedPorts = [];
      for (let p = 0; p < P; p++) {
        if (usedPorts.has(p)) continue;
        if (st.drained[p]) unitClosedPorts.push(p);
        else drainOncePorts.push(p);
      }

      const emitPrefs = outEmitPrefixes || Array.from({ length: Q }, () => []);
      if (emitPrefs.some((a) => a.length > 0)) hasTmcEmit = true;

      const sig = `loop:${JSON.stringify(nextExprs)}|e:${JSON.stringify(emitPrefs)}|d:${drainOncePorts.join(",")}|u:${unitClosedPorts.join(",")}`;
      if (dedupMap.has(sig)) return dedupMap.get(sig);
      hasLoopLeaf = true;
      const n = allocNode({ kind: "loop", nextExprs, outEmitPrefixes: emitPrefs, drainOncePorts, unitClosedPorts });
      dedupMap.set(sig, n);
      return n;
    };

    const makeTmcLoopLeaf = (outVal, st) => {
      const { nextInVal, callSt } = st.selfCall;
      // Ensure no input stream side-effects occurred after the self-call
      for (let p = 0; p < P; p++) {
        if (st.drained[p] !== callSt.drained[p]) bail();
        if (st.peeks[p].length !== callSt.peeks[p].length) bail();
        for (let i = 0; i < st.peeks[p].length; i++) {
          if (st.peeks[p][i] !== callSt.peeks[p][i]) bail();
        }
      }
      const rawOut = svalToLeaves(outVal);
      if (rawOut.length !== Q) bail();
      const outEmitPrefixes = [];
      for (let q = 0; q < Q; q++) {
        const pref = [];
        let cur = rawOut[q];
        while (cur && cur.kind === "cons") {
          pref.push(cur.tag);
          cur = cur.tail;
        }
        // Every output channel q must strictly prepend `pref` onto `selfOut(q)`!
        if (!cur || cur.kind !== "selfOut" || cur.q !== q) bail();
        outEmitPrefixes.push(pref);
      }
      return makeLoopLeaf(nextInVal, callSt, outEmitPrefixes);
    };

    // CPS Symbolic Evaluator
    const symEval = (nodeBp, inVal, st, inTailPos, inlineDepth, canBacktrack, onSuccess, onFail) => {
      if (++evalSteps > MAX_EVAL_STEPS) bail();
      if (inlineDepth > MAX_INLINE_DEPTH) bail();

      switch (nodeBp.kind) {
        case "identity":
          return onSuccess(inVal, st);

        case "unit":
          return onSuccess({ kind: "unit" }, st);

        case "dot": {
          if (inVal.kind !== "bundle") bail();
          const sub = inVal.fields.get(nodeBp.field);
          if (!sub) bail();
          return onSuccess(sub, st);
        }

        case "vid": {
          if (inVal.kind === "bundle" || inVal.kind === "cont") bail();
          return onSuccess({ kind: "cons", tag: nodeBp.tag, tail: inVal }, st);
        }

        case "div": {
          if (inVal.kind === "selfOut") bail();
          if (inVal.kind === "cons") {
            if (inVal.tag === nodeBp.tag) {
              return onSuccess(inVal.tail, st);
            }
            return onFail(st);
          }
          if (inVal.kind === "port") {
            const { p, depth } = inVal;
            if (depth < st.peeks[p].length) {
              const tok = st.peeks[p][depth];
              if (tok !== nodeBp.tag) return onFail(st);
              const nextVal = (depth === st.peeks[p].length - 1 && st.drained[p])
                ? { kind: "unit" }
                : { kind: "port", p, depth: depth + 1 };
              return onSuccess(nextVal, st);
            }
            // Need to peek next token from port `p`
            if (st.drained[p]) return onFail(st);
            const sch = st.schemas[p];
            const entry = sch.plist?.[sch.nodeId];
            if (!entry) bail();
            const [k, edges] = entry;
            if (k !== "closed-union" && k !== "open-union") bail();

            // Optimization: when `!canBacktrack` and `depth === 0` and `st.peeks[p].length === 0`,
            // we can emit a direct `Shift(p)` (consuming 1 token without buffering it!), which
            // keeps `peeks[p]` empty so `_drop16` / `_classify_bits` collapses from 2^16 to 18 DAG nodes!
            const useShift = !canBacktrack && depth === 0 && st.peeks[p].length === 0;
            const cases = {};
            for (const [t, target] of edges) {
              const targetEntry = sch.plist[target];
              if (!targetEntry) bail();
              if (targetEntry[0] === "closed-product" && targetEntry[1].length > 0) {
                // Non-empty product payload inside union (e.g. `_k_state[]`, `_k_stack[]`) -> JIT!
                bail();
              }
              const nextSt = cloneState(st);
              if (!useShift) nextSt.peeks[p].push(t);
              nextSt.schemas[p] = { plist: sch.plist, nodeId: target };
              if (targetEntry[0] === "closed-product" && targetEntry[1].length === 0) {
                nextSt.drained[p] = true;
              }
              if (t === nodeBp.tag) {
                const nextVal = nextSt.drained[p]
                  ? { kind: "unit" }
                  : { kind: "port", p, depth: useShift ? 0 : depth + 1 };
                cases[t] = onSuccess(nextVal, nextSt);
              } else {
                cases[t] = onFail(nextSt);
              }
            }
            return makeBranchNode(useShift ? "shift" : "peek", p, depth, cases);
          }
          return onFail(st);
        }

        case "product": {
          // Precompute ports read by each field: if field `idx` shares any port with
          // any later field `j > idx`, field `idx` MUST NOT destructively `SHIFT` that port!
          const fieldPortSets = nodeBp.fields.map((f) => portsUsedByPaths(inVal, f.blueprint.usedPaths));
          const evalField = (idx, accMap, curSt) => {
            if (idx === nodeBp.fields.length) {
              return onSuccess({ kind: "bundle", fields: accMap }, curSt);
            }
            const f = nodeBp.fields[idx];
            let sharesLater = false;
            for (let j = idx + 1; j < fieldPortSets.length && !sharesLater; j++) {
              for (const p of fieldPortSets[idx]) {
                if (fieldPortSets[j].has(p)) { sharesLater = true; break; }
              }
            }
            return symEval(
              f.blueprint,
              inVal,
              curSt,
              false,
              inlineDepth,
              canBacktrack || sharesLater,
              (val, st2) => {
                const nextMap = new Map(accMap);
                nextMap.set(f.label, val);
                return evalField(idx + 1, nextMap, st2);
              },
              onFail
            );
          };
          return evalField(0, new Map(), st);
        }

        case "comp": {
          const steps = nodeBp.steps;
          const evalStep = (idx, curVal, curSt) => {
            if (idx === steps.length) {
              return onSuccess(curVal, curSt);
            }
            const stepBp = steps[idx];
            const isLast = idx === steps.length - 1;

            // If previous step produced an exit continuation `cont`, chain remaining steps onto it!
            if (curVal.kind === "cont") {
              const remSteps = steps.slice(idx);
              const chainedBp = {
                kind: "comp",
                steps: [curVal.bp, ...remSteps],
                inPlist: curVal.bp.inPlist,
                outPlist: nodeBp.outPlist
              };
              return onSuccess(
                { kind: "cont", bp: chainedBp, bpKey: getBpKey(chainedBp), inVal: curVal.inVal },
                curSt
              );
            }

            // DAG memoization when `!canBacktrack` — MUST include `getContId(onSuccess)`
            // because `symEval` is CPS and returns the full continuation subtree!
            let mKey = null;
            if (!canBacktrack && !inTailPos && !curSt.selfCall) {
              mKey = `${getContId(onSuccess)}|${getBpKey(nodeBp)}#${idx}|${svalKey(curVal)}|${stateKey(curSt)}|${inlineDepth}`;
              if (memo.has(mKey)) return memo.get(mKey);
            }

            const res = symEval(
              stepBp,
              curVal,
              curSt,
              inTailPos && isLast,
              inlineDepth,
              canBacktrack,
              (nextVal, nextSt) => evalStep(idx + 1, nextVal, nextSt),
              onFail
            );
            if (mKey !== null) memo.set(mKey, res);
            return res;
          };
          return evalStep(0, inVal, st);
        }

        case "multi-switch": {
          // Fast committed dispatch: when `!canBacktrack` and every branch guards a single
          // scalar `Port(p, 0)` with `st.peeks[p].length === 0`, emit ONE `Shift(p)` node
          // and pass `Cons(t, nextPort)` to matching branches! This keeps `st.peeks[p]` empty,
          // so `_drop16` / `_classify_bits` collapses in O(16) steps instead of O(2^16)!
          if (
            !canBacktrack &&
            inVal.kind === "port" &&
            inVal.depth === 0 &&
            st.peeks[inVal.p].length === 0 &&
            !st.drained[inVal.p] &&
            nodeBp.branches.every((b) => b.guards && b.guards.has(""))
          ) {
            const p = inVal.p;
            const sch = st.schemas[p];
            const entry = sch.plist?.[sch.nodeId];
            if (entry && (entry[0] === "closed-union" || entry[0] === "open-union")) {
              const [, edges] = entry;
              let canShiftAll = true;
              for (const [, target] of edges) {
                const te = sch.plist[target];
                if (!te || (te[0] === "closed-product" && te[1].length > 0)) {
                  canShiftAll = false;
                  break;
                }
              }
              if (canShiftAll) {
                const cases = {};
                for (const [t, target] of edges) {
                  const te = sch.plist[target];
                  const nextSt = cloneState(st);
                  nextSt.schemas[p] = { plist: sch.plist, nodeId: target };
                  if (te[0] === "closed-product" && te[1].length === 0) {
                    nextSt.drained[p] = true;
                  }
                  const tailVal = nextSt.drained[p]
                    ? { kind: "unit" }
                    : { kind: "port", p, depth: 0 };
                  const consVal = { kind: "cons", tag: t, tail: tailVal };
                  // Filter to branches whose guard on "" permits `t`
                  const liveBranches = nodeBp.branches.filter((b) => b.guards.get("").has(t));
                  const runLive = (j, curSt) => {
                    if (j >= liveBranches.length) return onFail(curSt);
                    const hasMore = j + 1 < liveBranches.length;
                    return symEval(
                      liveBranches[j].blueprint,
                      consVal,
                      curSt,
                      inTailPos,
                      inlineDepth,
                      hasMore,
                      onSuccess,
                      (fSt) => runLive(j + 1, fSt)
                    );
                  };
                  cases[t] = runLive(0, nextSt);
                }
                return makeBranchNode("shift", p, 0, cases);
              }
            }
          }

          const evalBranch = (idx, curSt) => {
            // Skip branches statically ruled out by already-peeked tokens
            while (idx < nodeBp.branches.length && branchRuledOut(nodeBp.branches[idx], inVal, curSt)) {
              idx++;
            }
            if (idx >= nodeBp.branches.length) {
              return onFail(curSt);
            }
            const branch = nodeBp.branches[idx];
            // Check whether ANY later branch could still match on `curSt`
            let hasLaterLive = false;
            for (let j = idx + 1; j < nodeBp.branches.length; j++) {
              if (!branchRuledOut(nodeBp.branches[j], inVal, curSt)) {
                hasLaterLive = true;
                break;
              }
            }
            const branchCanBacktrack = canBacktrack || hasLaterLive;
            return symEval(
              branch.blueprint,
              inVal,
              curSt,
              inTailPos,
              inlineDepth,
              branchCanBacktrack,
              onSuccess,
              (failSt) => evalBranch(idx + 1, failSt)
            );
          };
          return evalBranch(0, st);
        }

        case "stub": {
          // 1. Direct self-call -> strict tail loop OR tail-modulo-constructor (TMC) streaming loop!
          if (nodeBp.relHash === relHash) {
            if (st.selfCall !== null || inlineDepth > 0) bail();
            if (inTailPos) {
              return makeLoopLeaf(inVal, st);
            }
            if (isFinite) bail();
            const nextSt = cloneState(st);
            nextSt.selfCall = { nextInVal: inVal, callSt: cloneState(st) };
            const selfOutVal = buildSelfOutVal(bp.outPlist, 0, { next: 0 });
            return onSuccess(selfOutVal, nextSt);
          }
          // 2. Finite (acyclic) helper relation -> inline symbolically!
          if (this.registry.isFiniteRel(nodeBp.relHash)) {
            const subBp = this.registry.getBlueprint(nodeBp.relHash);
            // Memoize pure finite calls when `!canBacktrack` (crucial for `_drop16 = _drop4^4`!)
            return symEval(
              subBp.root,
              inVal,
              st,
              false,
              inlineDepth + 1,
              canBacktrack,
              onSuccess,
              onFail
            );
          }
          // 3. External recursive relation (e.g. `msb_drop_zeros` / `rev_bits` / `_rev_bits`
          //    in exit branches of `_lsb_sub`, `_lsb_add`, `_lsb_split`!):
          //    Safe whenever either `!canBacktrack` OR `nodeBp.relHash` is provably total
          //    (cannot fail, so backtracking past it is impossible)!
          if (containsSelfOut(inVal)) bail();
          if (canBacktrack && !this.isProvablyTotal(nodeBp.relHash)) bail();
          return onSuccess(
            { kind: "cont", bp: nodeBp, bpKey: getBpKey(nodeBp), inVal },
            st
          );
        }

        default:
          bail();
      }
    };

    try {
      const initSt = {
        peeks: inLeaves.map(() => []),
        drained: inLeaves.map((l) => l.isUnit),
        schemas: inLeaves.map((l) => ({ plist: bp.inPlist, nodeId: l.nodeId })),
        selfCall: null
      };
      const initInVal = buildInitialInVal(bp.inPlist, 0, { next: 0 });

      const root = symEval(
        bp.root,
        initInVal,
        initSt,
        !isFinite, // allow self tail-loops & TMC loops for non-finite relations!
        0,
        false,
        (outVal, st) => (st.selfCall ? makeTmcLoopLeaf(outVal, st) : makeEmitLeaf(outVal, st)),
        () => { hasFail = true; return FAIL_NODE; }
      );

      // Must have at least one non-fail path; self-recursive relations must compile a loop leaf
      if (root === FAIL_NODE) return null;
      if (hasSelf && !hasLoopLeaf) return null;

      // Recompute `hasFail` over actually reachable nodes from `root` (dead pruned FAILs don't count!)
      hasFail = false;
      const seen = new Set();
      const checkReach = (n) => {
        if (!n || seen.has(n.id)) return;
        seen.add(n.id);
        if (n.kind === "fail") { hasFail = true; return; }
        if (n.cases) for (const c of Object.values(n.cases)) checkReach(c);
      };
      checkReach(root);

      // Identify finite-state register ports: unit-only finite enum ports updated
      // strictly by `const` (1 token) or identity `splice` (`consumeCount === 0`, no prefix)
      // across all reachable loop leaves, with at least one `const` update (e.g. `b` in
      // `_lsb_sub`, `c` in `_lsb_add`, `ord` in `_cmp_msb`).
      const registerPorts = [];
      if (hasLoopLeaf) {
        for (let p = 0; p < P; p++) {
          const leaf = inLeaves[p];
          const pNode = bp.inPlist[leaf.nodeId];
          const isUnitEnum =
            pNode &&
            (pNode[0] === "closed-union" || pNode[0] === "open-union") &&
            pNode[1].length >= 2 &&
            pNode[1].every(([, tgt]) => {
              const te = bp.inPlist[tgt];
              return te && te[0] === "closed-product" && te[1].length === 0;
            });
          if (!isUnitEnum) continue;

          let validReg = true;
          let hasConstUpdate = false;
          for (const id of seen) {
            const n = dnodeById.get(id);
            if (!n || n.kind !== "loop") continue;
            const ne = n.nextExprs[p];
            if (ne.kind === "const" && ne.tokens.length === 1) {
              hasConstUpdate = true;
            } else if (
              ne.kind === "splice" &&
              ne.p === p &&
              ne.consumeCount === 0 &&
              ne.prefix.length === 0 &&
              (!ne.newPrefix || ne.newPrefix.length === 0)
            ) {
              // Identity pass-through (e.g. `ord` unchanged on matching MSB bits)
            } else {
              validReg = false;
              break;
            }
          }
          if (validReg && hasConstUpdate) registerPorts.push(p);
        }
      }

      return {
        relHash,
        name: bp.name,
        isLoop: hasLoopLeaf,
        hasTmcEmit,
        inLeaves,
        outLeaves,
        inCount: P,
        outCount: Q,
        root,
        nodeCount: seen.size,
        dnodeById,
        registerPorts,
        hasExitLeaf,
        hasFail
      };
    } catch (err) {
      if (err === BAIL) return null;
      throw err;
    }
  }

  _hasDirectSelfRef(bp, relHash) {
    if (!bp) return false;
    switch (bp.kind) {
      case "stub": return bp.relHash === relHash;
      case "comp": return bp.steps.some((s) => this._hasDirectSelfRef(s, relHash));
      case "product": return bp.fields.some((f) => this._hasDirectSelfRef(f.blueprint, relHash));
      case "multi-switch": return bp.branches.some((b) => this._hasDirectSelfRef(b.blueprint, relHash));
      default: return false;
    }
  }

  /**
   * Render a compiled FSM or Loop Transducer's decision DAG as a clean Mermaid flowchart!
   */
  toMermaid(compiled) {
    const lines = ["flowchart TD"];
    const esc = (s) => String(s).replace(/"/g, "'");
    const pName = (p) => compiled.inLeaves[p]?.pathKey || `in${p}`;
    const oName = (q) => compiled.outLeaves[q]?.pathKey || `out${q}`;
    const fmtExpr = (e) => {
      if (e.kind === "const") return e.tokens.length ? e.tokens.map((t) => `|${t}`).join("") : "{}";
      if (e.kind === "splice") {
        const pre = e.prefix.length ? `${e.prefix.map((t) => `|${t}`).join("")} ` : "";
        return `${pre}${pName(e.p)}`;
      }
      if (e.kind === "cont") {
        const lbl = e.bp.kind === "stub"
          ? e.bp.relName
          : e.bp.steps?.map((s) => (s.kind === "stub" ? s.relName : s.kind)).join("→") || "cont";
        return `${lbl}(${e.inExprs.map(fmtExpr).join(",")})`;
      }
      return "?";
    };

    const visited = new Set();
    const walk = (n) => {
      if (!n || visited.has(n.id)) return;
      visited.add(n.id);
      const nid = `D${n.id}`;
      if (n.kind === "fail") {
        lines.push(`  ${nid}["FAIL"]:::fail`);
        return;
      }
      if (n.kind === "peek" || n.kind === "shift") {
        const op = n.kind === "shift" ? `SHIFT(${pName(n.p)})` : `PEEK(${pName(n.p)}[${n.depth}])`;
        lines.push(`  ${nid}{"${esc(op)}"}:::decision`);
        // Group identical target edges for compact readability (e.g. "0,1" on `_classify_bits`!)
        const byTarget = new Map();
        for (const [tok, tgt] of Object.entries(n.cases)) {
          if (!byTarget.has(tgt)) byTarget.set(tgt, []);
          byTarget.get(tgt).push(tok);
        }
        for (const [tgt, toks] of byTarget.entries()) {
          walk(tgt);
          lines.push(`  ${nid} -->|"${esc(toks.join(", "))}"| D${tgt.id}`);
        }
        return;
      }
      if (n.kind === "loop") {
        const updates = [];
        if (n.outEmitPrefixes) {
          for (let q = 0; q < compiled.outCount; q++) {
            const pref = n.outEmitPrefixes[q];
            if (pref && pref.length > 0) updates.push(`${oName(q)}.push(${pref.join(",")})`);
          }
        }
        for (let p = 0; p < compiled.inCount; p++) {
          const e = n.nextExprs[p];
          if (e.kind === "const") updates.push(`${pName(p)}:=${fmtExpr(e)}`);
          else if (e.prefix.length > 0) updates.push(`${pName(p)}.unshift(${e.prefix.join(",")})`);
          else if (e.consumeCount > 0) updates.push(`drop(${pName(p)},${e.consumeCount})`);
        }
        lines.push(`  ${nid}(["LOOP: ${esc(updates.join("; ") || "step")}"]):::loop`);
        lines.push(`  ${nid} -.-> D${compiled.root.id}`);
        return;
      }
      if (n.kind === "emit") {
        const outs = n.outExprs.map((e, q) => `${oName(q)}=${fmtExpr(e)}`).join("; ");
        lines.push(`  ${nid}["EXIT: ${esc(outs)}"]:::exit`);
      }
    };

    walk(compiled.root);
    lines.push("  classDef decision fill:#fef3c7,color:#78350f,stroke:#d97706");
    lines.push("  classDef loop fill:#dbeafe,color:#1e3a8a,stroke:#2563eb");
    lines.push("  classDef exit fill:#dcfce7,color:#166534,stroke:#16a34a");
    lines.push("  classDef fail fill:#fee2e2,color:#991b1b,stroke:#dc2626");
    return lines.join("\n");
  }
}
