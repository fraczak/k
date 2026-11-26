/**
 * CPS Symbolic `proc -> kernel` Fusion, TMC Streaming, Finite-Enum Register
 * Promotion, and Virtual LIFO Bit-Stack Promotion (`kTVM -> kTVM`).
 *
 * Operates purely on validated concrete `mono` kTVM modules:
 *   1. Flattens product ports into flat leaf streams (replacing the proc body
 *      with a thin `demux -> exec @kernel -> mux` wrapper).
 *   2. Symbolically executes the SPSC proc DAG (inlining acyclic helpers,
 *      eliminating `mux`/`demux`/`tee`/`spec` overhead) into a compact
 *      deterministic Decision DAG.
 *   3. Recognizes both strict self-tail loops and Tail-Modulo-Constructor (TMC)
 *      forward-streaming loops (`wrap |tag` around direct self-`spawn`).
 *   4. Promotes finite unit-enum loop ports (`bit[]`, `order[]`, carry/borrow/mode)
 *      to in-register `reg r : enum(K)`.
 *   5. Promotes LIFO `bits[]`-like accumulator ports (e.g. `_lsb_trim`'s `z` or
 *      `_rev_bits`'s `acc`) to kernel-local `stack s : bits`.
 *   6. Gracefully skips wide-alphabet unions (`> maxUnionTags`, e.g. `ascii[]`
 *      in `djson.k`) and branching-recursive orchestrators, leaving them intact.
 */

import { S, cloneAst, createModule } from "../ast.mjs";
import {
  compileSchemaExprToPlist,
  isUnitSchema,
  mooreMinimize,
  plistToSchemaAst,
  productFields,
  schemasEquivalent,
  subPlist,
  unionTagInfo
} from "../schema.mjs";
import { choiceWidth } from "../../codecs/runtime/prefix-codec.mjs";

const BAIL = Symbol("BAIL");

function bail(reason = "bail") {
  const err = new Error(reason);
  err[BAIL] = true;
  throw err;
}

function toBitsLit(val, width) {
  return (val >>> 0).toString(2).padStart(width, "0");
}

function sanitize(raw) {
  const s = String(raw || "").replace(/^[@$%]/, "").replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `k_${s}`;
}

/**
 * Flatten a concrete closed schema into leaf streams (splitting nested closed-products).
 * Empty `closed-product` (`unit`) is kept as a single unit leaf.
 */
function flattenLeaves(plist, nodeId = 0, path = []) {
  const [kind, edges] = plist[nodeId];
  if (kind === "closed-product" && edges.length > 0) {
    const out = [];
    for (const [label, target] of edges) {
      out.push(...flattenLeaves(plist, target, [...path, label]));
    }
    return out;
  }
  return [{
    path,
    pathKey: path.join("."),
    nodeId,
    plist: subPlist(plist, nodeId),
    isUnit: kind === "closed-product" && edges.length === 0
  }];
}

function buildInitialInSVal(plist, nodeId, box) {
  const [kind, edges] = plist[nodeId];
  if (kind === "closed-product" && edges.length > 0) {
    const fields = new Map();
    for (const [label, target] of edges) {
      fields.set(label, buildInitialInSVal(plist, target, box));
    }
    return { kind: "bundle", fields, plist: subPlist(plist, nodeId) };
  }
  const p = box.next++;
  const leafPl = subPlist(plist, nodeId);
  if (kind === "closed-product" && edges.length === 0) {
    return { kind: "port", p, depth: 0, plist: leafPl, nodeId: 0, isUnit: true };
  }
  return { kind: "port", p, depth: 0, plist: leafPl, nodeId: 0, isUnit: false };
}

function buildSelfOutSVal(plist, nodeId, box) {
  const [kind, edges] = plist[nodeId];
  if (kind === "closed-product" && edges.length > 0) {
    const fields = new Map();
    for (const [label, target] of edges) {
      fields.set(label, buildSelfOutSVal(plist, target, box));
    }
    return { kind: "bundle", fields, plist: subPlist(plist, nodeId) };
  }
  const q = box.next++;
  return { kind: "selfOut", q, plist: subPlist(plist, nodeId) };
}

function svalToLeaves(v, out = []) {
  if (v.kind === "bundle") {
    for (const child of v.fields.values()) svalToLeaves(child, out);
    return out;
  }
  out.push(v);
  return out;
}

function containsSelfOut(v) {
  if (!v) return false;
  if (v.kind === "selfOut") return true;
  if (v.kind === "cons") return containsSelfOut(v.tail);
  if (v.kind === "bundle") {
    for (const c of v.fields.values()) if (containsSelfOut(c)) return true;
  }
  if (v.kind === "cont") return v.args.some(containsSelfOut);
  return false;
}

function cloneSymState(st) {
  return {
    peeks: st.peeks.map((a) => a.slice()),
    schemas: st.schemas.map((s) => ({ plist: s.plist, nodeId: s.nodeId })),
    drained: st.drained.slice(),
    mustDrainUnit: st.mustDrainUnit.slice(),
    mustDrainFull: st.mustDrainFull.slice(),
    selfCall: st.selfCall
  };
}

/**
 * Compute call graph & finiteness (acyclicity) over all procs in a mono module.
 */
function analyzeProcCallGraph(mod) {
  const callsOf = new Map();
  const walkStmts = (stmts, set) => {
    for (const s of stmts || []) {
      if (s.op === "spawn") set.add(s.target);
      else if (s.op === "switch") {
        for (const a of s.arms) walkStmts(a.body, set);
        if (s.defaultBody) walkStmts(s.defaultBody, set);
      } else if (s.op === "spec") {
        for (const b of s.branches) walkStmts(b.body, set);
      }
    }
  };
  for (const p of mod.procs || []) {
    const set = new Set();
    walkStmts(p.body, set);
    callsOf.set(p.name, set);
  }

  const finiteCache = new Map();
  const isFinite = (name, visiting = new Set()) => {
    if (finiteCache.has(name)) return finiteCache.get(name);
    if (visiting.has(name)) return false;
    if (!callsOf.has(name)) return false; // kernel or unknown
    visiting.add(name);
    let ok = true;
    for (const callee of callsOf.get(name)) {
      if (!isFinite(callee, visiting)) {
        ok = false;
        break;
      }
    }
    visiting.delete(name);
    if (visiting.size === 0 || ok) finiteCache.set(name, ok);
    return ok;
  };

  const hasDirectSelf = (name) => callsOf.get(name)?.has(name) || false;

  // Count max self-calls along any single execution path (exclude branching recursion!)
  const maxSelfCalls = (stmts, selfName) => {
    let sum = 0;
    for (const s of stmts || []) {
      if (s.op === "spawn" && s.target === selfName) sum += 1;
      else if (s.op === "switch") {
        let best = 0;
        for (const a of s.arms) best = Math.max(best, maxSelfCalls(a.body, selfName));
        if (s.defaultBody) best = Math.max(best, maxSelfCalls(s.defaultBody, selfName));
        sum += best;
      } else if (s.op === "spec") {
        let best = 0;
        for (const b of s.branches) best = Math.max(best, maxSelfCalls(b.body, selfName));
        sum += best;
      }
    }
    return sum;
  };

  return { callsOf, isFinite, hasDirectSelf, maxSelfCalls };
}

/**
 * Check if a leaf schema is a finite unit-only union enum (2..8 states, all payloads unit).
 */
function getUnitEnumInfo(plist) {
  const [kind, edges] = plist[0];
  if (kind !== "closed-union" || edges.length < 2 || edges.length > 8) return null;
  for (const [, target] of edges) {
    if (!isUnitSchema(plist, target)) return null;
  }
  return {
    states: edges.length,
    width: choiceWidth(edges.length),
    tags: edges.map(([t]) => t),
    tagToOrd: new Map(edges.map(([t], i) => [t, i]))
  };
}

/**
 * Check if a leaf schema is a self-recursive LIFO bit-stackable union (e.g. `$bits = { 0: $bits, 1: $bits, _: unit }`),
 * with 1 terminal `unit` tag and `2^k` (specifically 2) self-recursive tags!
 */
function getBitStackSchemaInfo(plist) {
  const [kind, edges] = plist[0];
  if (kind !== "closed-union" || edges.length < 2 || edges.length > 5) return null;
  const termTags = [];
  const recTags = [];
  for (let i = 0; i < edges.length; i++) {
    const [tag, target] = edges[i];
    if (isUnitSchema(plist, target)) termTags.push({ tag, ord: i });
    else if (schemasEquivalent(plist, 0, plist, target)) recTags.push({ tag, ord: i });
    else return null;
  }
  if (termTags.length !== 1) return null;
  if (recTags.length !== 1 && recTags.length !== 2) return null;
  const tagWidth = choiceWidth(edges.length);
  const stackBitWidth = recTags.length === 1 ? 1 : 1; // 1 bit per pushed recTag (0 or 1)
  return {
    tagWidth,
    termTag: termTags[0].tag,
    termOrd: termTags[0].ord,
    recTags,
    recTagToBit: new Map(recTags.map((r, i) => [r.tag, i])),
    bitToRecTag: recTags.map((r) => r),
    stackBitWidth
  };
}

/**
 * Fuse eligible procedures in a concrete `mono` kTVM module into single-node
 * compiled `kernel`s (FSM, tail-loop, TMC streaming, register-promoted, and
 * virtual-stack kernels).
 */
export function fuseKernels(
  mod,
  {
    maxDecisionNodes = 192,
    maxEvalSteps = 3000,
    maxInlineDepth = 16,
    maxUnionTags = 12,
    enableVirtualStack = true
  } = {}
) {
  if (mod.layer !== "mono") {
    throw new Error("fuseKernels requires a concrete 'mono' kTVM module");
  }

  const schemaDecls = new Map((mod.schemas || []).map((s) => [s.name, s]));
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const plistCache = new Map();

  function resolvePlist(expr) {
    const key = JSON.stringify(expr);
    if (!plistCache.has(key)) {
      plistCache.set(key, mooreMinimize(compileSchemaExprToPlist(expr, schemaDecls, { allowOpen: false }), 0).plist);
    }
    return plistCache.get(key);
  }

  // Deduplicated schema interning for any new leaf schemas needed by kernel ports
  const emittedSchemas = cloneAst(mod.schemas || []);
  const schemaByMoore = new Map();
  for (const s of emittedSchemas) {
    const pl = resolvePlist(S.ref(s.name));
    schemaByMoore.set(mooreMinimize(pl, 0).key, { expr: S.ref(s.name), plist: pl });
  }
  let schemaSeq = 0;

  function internSchemaExpr(plist, hint = "K") {
    const min = mooreMinimize(plist, 0);
    if (isUnitSchema(min.plist, 0)) return S.unit();
    if (schemaByMoore.has(min.key)) return schemaByMoore.get(min.key).expr;
    const prefix = `$${sanitize(hint)}_k${schemaSeq++}`;
    const { decls, rootExpr } = plistToSchemaAst(min.plist, prefix);
    for (const d of decls) {
      emittedSchemas.push(d);
      schemaDecls.set(d.name, d);
    }
    schemaByMoore.set(min.key, { expr: rootExpr, plist: min.plist });
    return rootExpr;
  }

  const cg = analyzeProcCallGraph(mod);
  const emittedKernels = cloneAst(mod.kernels || []);
  const existingKernelNames = new Set(emittedKernels.map((k) => k.name));
  const newProcs = [];
  const helperProcs = [];

  const stats = {
    fusedFSMs: 0,
    fusedLoops: 0,
    tmcLoops: 0,
    registerPromotions: 0,
    stackKernels: 0,
    skippedWideOrComplex: 0
  };

  let helperSeq = 0;

  // Attempt to fuse each eligible procedure
  for (const proc of mod.procs || []) {
    // Only fuse single-input single-output procs (or multi-port procs with <= 4 leaves)
    const isFin = cg.isFinite(proc.name);
    const hasSelf = cg.hasDirectSelf(proc.name);
    if (!isFin && !hasSelf) {
      newProcs.push(cloneAst(proc));
      continue;
    }
    if (hasSelf && (proc.attrs?.includes("branching") || cg.maxSelfCalls(proc.body, proc.name) > 1)) {
      newProcs.push(cloneAst(proc));
      continue;
    }
    // Don't fuse trivial 1-statement `splice`/`exec` wrappers
    if (proc.body.length <= 2 && proc.body.every((s) => s.op === "splice" || s.op === "exec" || s.op === "const_unit")) {
      newProcs.push(cloneAst(proc));
      continue;
    }

    const compiled = trySymbolicFuseProc(proc, isFin, hasSelf);
    if (!compiled) {
      stats.skippedWideOrComplex += 1;
      newProcs.push(cloneAst(proc));
      continue;
    }

    const emitted = emitKernelFromDecisionDag(proc, compiled);
    if (!emitted) {
      stats.skippedWideOrComplex += 1;
      newProcs.push(cloneAst(proc));
      continue;
    }

    emittedKernels.push(emitted.kernel);
    newProcs.push(emitted.wrapperProc);
    if (emitted.fallbackProc) helperProcs.push(emitted.fallbackProc);

    if (compiled.isLoop) {
      stats.fusedLoops += 1;
      if (compiled.hasTmcEmit) stats.tmcLoops += 1;
      stats.registerPromotions += emitted.promotedRegCount;
      if (emitted.hasVirtualStack) stats.stackKernels += 1;
    } else {
      stats.fusedFSMs += 1;
    }
  }

  // --- Core Symbolic Evaluator over Concrete `kTVM` `proc` DAG ---

  function trySymbolicFuseProc(proc, isFinite, hasSelf) {
    const inPortPlists = proc.inputs.map((p) => resolvePlist(p.schema));
    const outPortPlists = proc.outputs.map((p) => resolvePlist(p.schema));

    const inLeaves = [];
    const inPortLeafRanges = [];
    for (let i = 0; i < proc.inputs.length; i++) {
      const start = inLeaves.length;
      const leaves = flattenLeaves(inPortPlists[i], 0, proc.inputs.length === 1 ? [] : [proc.inputs[i].name.slice(1)]);
      inLeaves.push(...leaves);
      inPortLeafRanges.push({ start, count: leaves.length });
    }

    const outLeaves = [];
    for (let i = 0; i < proc.outputs.length; i++) {
      outLeaves.push(...flattenLeaves(outPortPlists[i], 0, proc.outputs.length === 1 ? [] : [proc.outputs[i].name.slice(1)]));
    }

    const P = inLeaves.length;
    const Q = outLeaves.length;
    if (P === 0 || Q === 0 || P > 6 || Q > 4) return null;

    // Bail early on wide-alphabet schemas (`ascii[]`/`unicode[]`)
    for (const l of inLeaves) {
      if (l.plist[0][0] === "closed-union" && l.plist[0][1].length > maxUnionTags) {
        return null;
      }
    }

    let nodeIdSeq = 0;
    let evalSteps = 0;
    const dnodeById = new Map();
    const dnodeByKey = new Map();
    const plistKeyCache = new WeakMap();
    const FAIL_NODE = { id: -1, kind: "fail" };
    let hasLoopLeaf = false;
    let hasTmcEmit = false;
    let hasFail = false;

    const getPlKey = (pl) => {
      if (!pl) return "null";
      let k = plistKeyCache.get(pl);
      if (k === undefined) {
        k = mooreMinimize(pl, 0).key;
        plistKeyCache.set(pl, k);
      }
      return k;
    };

    const allocDNode = (obj, canonicalKey = null) => {
      if (canonicalKey && dnodeByKey.has(canonicalKey)) {
        return dnodeByKey.get(canonicalKey);
      }
      if (nodeIdSeq >= maxDecisionNodes) bail("maxDecisionNodes");
      const n = { id: nodeIdSeq++, ...obj };
      dnodeById.set(n.id, n);
      if (canonicalKey) dnodeByKey.set(canonicalKey, n);
      return n;
    };

    const tick = () => {
      if (++evalSteps > maxEvalSteps) bail("maxEvalSteps");
    };

    const inLeafIsUnitEnum = inLeaves.map((l) => Boolean(getUnitEnumInfo(l.plist)));

    /**
     * Compile an output leaf SVal into:
     *   - `{ kind: "const", tokens: [{ tag, ord, width }] }`
     *   - `{ kind: "splice", prefix: [{ tag, ord, width }], p, consumeCount, tailPlist }`
     *
     * When `forLoop === true`, `port(p, depth)` shifts ONLY `depth` actually consumed
     * tokens (leaving peeked-but-unconsumed tokens untouched in `%p`) and keeps `prefix`
     * strictly equal to explicitly `wrap`ped tags.
     */
    function compileLeafOutExpr(v, st, expectedPlist, { forLoop = false } = {}) {
      const prefix = [];
      let cur = v;
      while (cur.kind === "cons") {
        const info = unionTagInfo(cur.plist, cur.nodeId, cur.tag);
        if (!info) bail("cons-tag-info");
        prefix.push({ tag: cur.tag, ord: info.ordinal, width: info.width, nextPlist: subPlist(cur.plist, info.targetId) });
        cur = cur.tail;
      }
      if (cur.kind === "unit") {
        return { kind: "const", tokens: prefix };
      }
      if (cur.kind === "port") {
        const { p, depth } = cur;
        if (forLoop) {
          // Leave any unconsumed peeked tags `st.peeks[p].slice(depth)` in `%p`!
          let checkPl = expectedPlist;
          let checkNid = 0;
          for (const tok of prefix) {
            const info = unionTagInfo(checkPl, checkNid, tok.tag);
            if (!info) bail("loop-prefix-schema");
            checkNid = info.targetId;
          }
          const curTailPl = subPlist(cur.plist, cur.nodeId);
          if (!schemasEquivalent(curTailPl, 0, checkPl, checkNid)) bail("loop-tail-schema");
          return {
            kind: "splice",
            prefix,
            p,
            consumeCount: depth,
            tailPlist: curTailPl
          };
        }

        // Emit leaf: re-emit unconsumed peeked tags in order so all `st.peeks[p]` can be shifted cleanly.
        const unconsumed = [];
        let curPl = cur.plist;
        let curNid = cur.nodeId;
        for (let d = depth; d < st.peeks[p].length; d++) {
          const t = st.peeks[p][d];
          const info = unionTagInfo(curPl, curNid, t);
          if (!info) bail("emit-unconsumed-info");
          unconsumed.push({ tag: t, ord: info.ordinal, width: info.width, nextPlist: subPlist(curPl, info.targetId) });
          curNid = info.targetId;
        }
        const tailPlist = subPlist(curPl, curNid);
        if (st.drained[p] || isUnitSchema(tailPlist, 0)) {
          // Port p has already reached `unit` -> mark for unit drain and emit constant!
          st.mustDrainUnit[p] = true;
          return { kind: "const", tokens: [...prefix, ...unconsumed] };
        }
        // Verify tail schema matches expected suffix schema (after prefix + unconsumed)
        const allPrefix = [...prefix, ...unconsumed];
        let checkPl = expectedPlist;
        let checkNid = 0;
        for (const tok of allPrefix) {
          const info = unionTagInfo(checkPl, checkNid, tok.tag);
          if (!info) bail("emit-prefix-schema");
          checkNid = info.targetId;
        }
        if (!schemasEquivalent(tailPlist, 0, checkPl, checkNid)) bail("emit-tail-schema");
        // Kernel `push_bits` does not advance `dst.prodSchema`, so `splice` after non-empty prefix
        // requires `tailPlist` to remain schema-equivalent to `expectedPlist` (true for all recursive streams!).
        if (allPrefix.length > 0 && !schemasEquivalent(tailPlist, 0, expectedPlist, 0)) {
          bail("emit-nonrec-splice");
        }
        return {
          kind: "splice",
          prefix: allPrefix,
          p,
          consumeCount: st.peeks[p].length,
          tailPlist
        };
      }
      bail("leaf-out-expr");
    }

    function markSValDrained(v, st) {
      if (!v || v.kind === "unit") return;
      if (v.kind === "cons") {
        markSValDrained(v.tail, st);
        return;
      }
      if (v.kind === "bundle") {
        for (const c of v.fields.values()) markSValDrained(c, st);
        return;
      }
      if (v.kind === "port") {
        const { p, depth } = v;
        let curPl = v.plist;
        let curNid = v.nodeId;
        for (let d = depth; d < st.peeks[p].length; d++) {
          const info = unionTagInfo(curPl, curNid, st.peeks[p][d]);
          if (!info) bail();
          curNid = info.targetId;
        }
        const remPl = subPlist(curPl, curNid);
        if (isUnitSchema(remPl, 0)) {
          st.mustDrainUnit[p] = true;
        } else {
          st.mustDrainFull[p] = remPl;
        }
        return;
      }
      bail();
    }

    function makeEmitLeaf(outVals, st) {
      const outLeafVals = [];
      for (const ov of outVals) svalToLeaves(ov, outLeafVals);
      if (outLeafVals.length !== Q) bail();

      const stCopy = cloneSymState(st);
      const outExprs = outLeafVals.map((lv, q) => compileLeafOutExpr(lv, stCopy, outLeaves[q].plist));

      // Verify no input port is spliced twice across outputs (SPSC linearity!)
      const splicedPorts = new Set();
      for (const e of outExprs) {
        if (e.kind === "splice") {
          if (splicedPorts.has(e.p)) bail();
          splicedPorts.add(e.p);
        }
      }

      // Compute exact shifts and remaining drains per input port
      const shifts = new Array(P).fill(0);
      const shiftTokens = Array.from({ length: P }, () => []);
      const drainGuards = new Array(P).fill(null);

      for (let p = 0; p < P; p++) {
        let curPl = inLeaves[p].plist;
        let curNid = 0;
        for (const t of stCopy.peeks[p]) {
          const info = unionTagInfo(curPl, curNid, t);
          if (!info) bail();
          shifts[p] += info.width;
          shiftTokens[p].push({ width: info.width, nextPlist: subPlist(curPl, info.targetId) });
          curNid = info.targetId;
        }
        const remPl = subPlist(curPl, curNid);
        if (!splicedPorts.has(p)) {
          if (stCopy.mustDrainFull[p]) drainGuards[p] = stCopy.mustDrainFull[p];
          else if (stCopy.mustDrainUnit[p] || isUnitSchema(remPl, 0)) drainGuards[p] = remPl;
          else drainGuards[p] = remPl; // Ensure every unspliced input port is drained cleanly!
        }
      }

      const emitKey = `E|${outExprs.map((e) =>
        e.kind === "const"
          ? `C:${e.tokens.map((t) => `${t.ord}/${t.width}`).join(",")}`
          : `S:${e.p}:${e.prefix.map((t) => `${t.ord}/${t.width}`).join(",")}`
      ).join(";")}|${shiftTokens.map((ts) => ts.map((t) => `${t.width}:${getPlKey(t.nextPlist)}`).join(",")).join(";")}|${drainGuards.map((d) => getPlKey(d)).join(",")}`;

      return allocDNode({
        kind: "emit",
        outExprs,
        shifts,
        shiftTokens,
        drainGuards
      }, emitKey);
    }

    function makeLoopLeaf(outVals, st) {
      if (!st.selfCall) bail("no-self-call");
      const nextInLeafVals = [];
      for (const nv of st.selfCall.nextArgs) svalToLeaves(nv, nextInLeafVals);
      if (nextInLeafVals.length !== P) bail("self-arity");

      // Check TMC output wrapping around `selfOut(q)`
      const outLeafVals = [];
      for (const ov of outVals) svalToLeaves(ov, outLeafVals);
      if (outLeafVals.length !== Q) bail("loop-out-arity");

      const outEmitPrefixes = new Array(Q).fill(null);
      for (let q = 0; q < Q; q++) {
        const prefix = [];
        let cur = outLeafVals[q];
        while (cur.kind === "cons") {
          const info = unionTagInfo(cur.plist, cur.nodeId, cur.tag);
          if (!info) bail("tmc-prefix-info");
          prefix.push({ tag: cur.tag, ord: info.ordinal, width: info.width });
          cur = cur.tail;
        }
        if (cur.kind !== "selfOut" || cur.q !== q) bail("not-tmc-selfout");
        if (prefix.length > 0) hasTmcEmit = true;
        outEmitPrefixes[q] = prefix;
      }

      const stCopy = cloneSymState(st);
      const nextExprs = nextInLeafVals.map((nv, p) =>
        compileLeafOutExpr(nv, stCopy, inLeaves[p].plist, { forLoop: true })
      );

      // Terminal-keep equivalence: on non-unit-enum ports (e.g. `$bits`), if `p` was peeked
      // all the way to terminal tag `t` (`st.drained[p] === true`, last peek === `t`) and the
      // recursive call passes `const([t])` (e.g. `pop_lsb_bit` or `drop2` clamping at `_`),
      // leaving `t` unshifted on `%p` (`consumeCount = st.peeks[p].length - 1`) is bit-exact!
      for (let p = 0; p < P; p++) {
        if (inLeafIsUnitEnum[p]) continue;
        const ne = nextExprs[p];
        if (
          ne.kind === "const" &&
          ne.tokens.length === 1 &&
          stCopy.drained[p] &&
          stCopy.peeks[p].length >= 1 &&
          stCopy.peeks[p][stCopy.peeks[p].length - 1] === ne.tokens[0].tag
        ) {
          const keepDepth = stCopy.peeks[p].length - 1;
          let curPl = inLeaves[p].plist;
          let curNid = 0;
          let ok = true;
          for (let d = 0; d < keepDepth; d++) {
            const info = unionTagInfo(curPl, curNid, stCopy.peeks[p][d]);
            if (!info) { ok = false; break; }
            curNid = info.targetId;
          }
          if (ok && schemasEquivalent(curPl, curNid, inLeaves[p].plist, 0)) {
            nextExprs[p] = {
              kind: "splice",
              prefix: [],
              p,
              consumeCount: keepDepth,
              tailPlist: inLeaves[p].plist
            };
          }
        }
      }

      // Verify every non-constant port maps to itself (no port permutation in-place)
      for (let p = 0; p < P; p++) {
        const ne = nextExprs[p];
        if (ne.kind === "splice" && ne.p !== p) bail("port-permute");
      }

      // Record any non-unit `mustDrainFull[p]` where port `p` is NOT kept live in `nextExprs[p]`
      // (a `drain` on a `tee`'d copy of a still-live port `p` is redundant because `p` remains owned!).
      const droppedDrainFull = new Array(P).fill(false);
      for (let p = 0; p < P; p++) {
        if (st.mustDrainFull[p]) {
          const ne = nextExprs[p];
          const keptLive = ne.kind === "splice" && ne.p === p;
          if (!keptLive) droppedDrainFull[p] = true;
        }
      }

      // Compute exact bit shifts per port (ONLY `consumeCount` tokens for splice ports!)
      const shifts = new Array(P).fill(0);
      const shiftTokens = Array.from({ length: P }, () => []);
      for (let p = 0; p < P; p++) {
        const ne = nextExprs[p];
        const count = ne.kind === "splice" ? ne.consumeCount : 0;
        let curPl = inLeaves[p].plist;
        let curNid = 0;
        for (let d = 0; d < count; d++) {
          const t = stCopy.peeks[p][d];
          const info = unionTagInfo(curPl, curNid, t);
          if (!info) bail("loop-shift-info");
          shifts[p] += info.width;
          shiftTokens[p].push({ width: info.width, nextPlist: subPlist(curPl, info.targetId) });
          curNid = info.targetId;
        }
      }

      const loopKey = `L|${nextExprs.map((e) =>
        e.kind === "const"
          ? `C:${e.tokens.map((t) => `${t.ord}/${t.width}`).join(",")}`
          : `S:${e.p}:${e.consumeCount}:${e.prefix.map((t) => `${t.ord}/${t.width}`).join(",")}`
      ).join(";")}|${outEmitPrefixes.map((ps) => ps.map((t) => `${t.ord}/${t.width}`).join(",")).join(";")}|${shiftTokens.map((ts) => ts.map((t) => `${t.width}:${getPlKey(t.nextPlist)}`).join(",")).join(";")}|${droppedDrainFull.map((b) => (b ? "1" : "0")).join("")}`;

      hasLoopLeaf = true;
      return allocDNode({
        kind: "loop",
        nextExprs,
        outEmitPrefixes,
        shifts,
        shiftTokens,
        droppedDrainFull
      }, loopKey);
    }

    /**
     * Symbolically inspect a single union SVal `val`, calling `onTag(tag, payloadVal, nextSt)`
     * or `onFail(st)` if impossible.
     */
    function inspectUnion(val, st, onTag, onFail) {
      tick();
      if (val.kind === "cons") {
        return onTag(val.tag, val.tail, st);
      }
      if (val.kind === "port") {
        const { p, depth, plist, nodeId } = val;
        const [kind, edges] = plist[nodeId];
        if (kind !== "closed-union") bail();
        if (edges.length > maxUnionTags) bail();

        if (depth < st.peeks[p].length) {
          const tag = st.peeks[p][depth];
          const info = unionTagInfo(plist, nodeId, tag);
          if (!info) return onFail(st);
          const nextPl = subPlist(plist, info.targetId);
          const payload = isUnitSchema(nextPl, 0)
            ? { kind: "unit" }
            : { kind: "port", p, depth: depth + 1, plist: nextPl, nodeId: 0 };
          return onTag(tag, payload, st);
        }

        // Singleton 1-tag union (`width === 0`): no peek bits needed, step deterministically!
      if (edges.length === 1) {
        const [tag, targetId] = edges[0];
        const nextSt = cloneSymState(st);
        nextSt.peeks[p].push(tag);
        const nextPl = subPlist(plist, targetId);
        if (isUnitSchema(nextPl, 0)) nextSt.drained[p] = true;
        const payload = isUnitSchema(nextPl, 0)
          ? { kind: "unit" }
          : { kind: "port", p, depth: depth + 1, plist: nextPl, nodeId: 0 };
        return onTag(tag, payload, nextSt);
      }

      // Branch decision node `peek(p, depth)`!
        const cases = {};
        let offsetBits = 0;
        {
          let cPl = inLeaves[p].plist;
          let cNid = 0;
          for (const t of st.peeks[p]) {
            const inf = unionTagInfo(cPl, cNid, t);
            offsetBits += inf.width;
            cNid = inf.targetId;
          }
        }
        const width = choiceWidth(edges.length);
        for (let ord = 0; ord < edges.length; ord++) {
          const [tag, targetId] = edges[ord];
          const nextSt = cloneSymState(st);
          nextSt.peeks[p].push(tag);
          const nextPl = subPlist(plist, targetId);
          if (isUnitSchema(nextPl, 0)) nextSt.drained[p] = true;
          const payload = isUnitSchema(nextPl, 0)
            ? { kind: "unit" }
            : { kind: "port", p, depth: depth + 1, plist: nextPl, nodeId: 0 };
          cases[tag] = {
            ord,
            bits: toBitsLit(ord, width),
            node: onTag(tag, payload, nextSt)
          };
        }
        // Redundant-peek elimination: if all tags lead to the exact same canonical DNode,
        // collapse this peek node directly (only skip bit-validation when the alphabet fills
        // all `2^width` codes OR when the collapsed sub-DAG never shifts `p` past `depth`!).
        const caseVals = Object.values(cases);
        const firstTarget = caseVals[0]?.node;
        if (firstTarget && caseVals.every((c) => c.node === firstTarget)) {
          const isFullPowerOf2 = edges.length === (1 << width);
          const shiftsAtOrPastDepth = (n, seen = new Set()) => {
            if (!n || n === FAIL_NODE || seen.has(n.id)) return false;
            seen.add(n.id);
            if (n.kind === "peek") {
              if (n.p === p && n.depth >= depth) return true;
              return Object.values(n.cases).some((c) => shiftsAtOrPastDepth(c.node, seen));
            }
            return (n.shiftTokens && n.shiftTokens[p] && n.shiftTokens[p].length > depth);
          };
          if (isFullPowerOf2 || !shiftsAtOrPastDepth(firstTarget)) {
            return firstTarget;
          }
        }

        const peekKey = `P|${p}|${depth}|${offsetBits}|${width}|${caseVals.map((c) => `${c.bits}:${c.node.id}`).join(",")}`;
        return allocDNode({
          kind: "peek",
          p,
          depth,
          offsetBits,
          width,
          plist,
          nodeId,
          cases
        }, peekKey);
      }
      bail();
    }

    /**
     * Symbolically execute a block of kTVM statements in `env` with explicit CPS
     * `(onDone(finalEnv, finalSt), onFail(st))`.
     */
    function symExecBlock(stmts, idx, env, st, inlineDepth, onDone, onFail) {
      tick();
      if (idx >= stmts.length) {
        return onDone(env, st);
      }
      const s = stmts[idx];
      const cont = (nextEnv, nextSt) => symExecBlock(stmts, idx + 1, nextEnv, nextSt, inlineDepth, onDone, onFail);

      switch (s.op) {
        case "chan": {
          const nextEnv = new Map(env);
          nextEnv.set(s.name, { __schema: resolvePlist(s.schema) });
          return cont(nextEnv, st);
        }
        case "barrier":
          return cont(env, st);
        case "const_unit": {
          const nextEnv = new Map(env);
          nextEnv.set(s.dst, { kind: "unit" });
          return cont(nextEnv, st);
        }
        case "splice": {
          const nextEnv = new Map(env);
          nextEnv.set(s.dst, env.get(s.src));
          return cont(nextEnv, st);
        }
        case "gate": {
          const nextEnv = new Map(env);
          nextEnv.set(s.dst, env.get(s.src));
          return cont(nextEnv, st);
        }
        case "drain": {
          const nextSt = cloneSymState(st);
          markSValDrained(env.get(s.src), nextSt);
          return cont(env, nextSt);
        }
        case "tee": {
          const val = env.get(s.src);
          const nextEnv = new Map(env);
          for (const d of s.dsts) nextEnv.set(d, val);
          return cont(nextEnv, st);
        }
        case "mux": {
          const pl = resolvePlist(s.schema);
          const fields = new Map();
          const pf = productFields(pl, 0);
          const byLbl = new Map(s.fields.map((f) => [f.label, env.get(f.name)]));
          for (const f of pf) fields.set(f.label, byLbl.get(f.label));
          const nextEnv = new Map(env);
          nextEnv.set(s.dst, { kind: "bundle", fields, plist: pl });
          return cont(nextEnv, st);
        }
        case "demux": {
          const val = env.get(s.src);
          if (!val || val.kind !== "bundle") bail();
          const nextEnv = new Map(env);
          for (const f of s.fields) nextEnv.set(f.name, val.fields.get(f.label));
          return cont(nextEnv, st);
        }
        case "wrap": {
          const dstMeta = env.get(s.dst);
          const dstPl = dstMeta?.__schema || env.get(`__port_schema__${s.dst}`);
          if (!dstPl) bail();
          const nextEnv = new Map(env);
          nextEnv.set(s.dst, { kind: "cons", tag: s.tag, tail: env.get(s.src), plist: dstPl, nodeId: 0 });
          return cont(nextEnv, st);
        }
        case "match": {
          const val = env.get(s.src);
          return inspectUnion(
            val,
            st,
            (tag, payload, nextSt) => {
              if (tag !== s.tag) return onFail(nextSt);
              const nextEnv = new Map(env);
              nextEnv.set(s.dst, payload);
              return cont(nextEnv, nextSt);
            },
            onFail
          );
        }
        case "coerce": {
          const sPl = resolvePlist(s.srcSchema);
          const dPl = resolvePlist(s.dstSchema);
          const val = env.get(s.src);
          if (schemasEquivalent(sPl, 0, dPl, 0)) {
            const nextEnv = new Map(env);
            nextEnv.set(s.dst, val);
            return cont(nextEnv, st);
          }
          // Re-tag known `cons` values (common in variant widening/narrowing!)
          if (val.kind === "cons") {
            const info = unionTagInfo(dPl, 0, val.tag);
            if (!info) return onFail(st);
            const nextEnv = new Map(env);
            nextEnv.set(s.dst, { kind: "cons", tag: val.tag, tail: val.tail, plist: dPl, nodeId: 0 });
            return cont(nextEnv, st);
          }
          bail();
        }
        case "switch": {
          // Inspect all non-wildcard switch inputs sequentially!
          const needed = [];
          for (let j = 0; j < s.inputs.length; j++) {
            if (s.arms.some((a) => a.patterns[j].kind === "tag")) needed.push(j);
          }
          const observedTags = new Array(s.inputs.length).fill(null);

          const inspectNext = (k, curSt) => {
            if (k >= needed.length) {
              let chosen = null;
              for (const arm of s.arms) {
                let ok = true;
                for (let j = 0; j < arm.patterns.length; j++) {
                  if (arm.patterns[j].kind === "tag" && observedTags[j] !== arm.patterns[j].tag) {
                    ok = false;
                    break;
                  }
                }
                if (ok) {
                  chosen = arm.body;
                  break;
                }
              }
              if (!chosen) chosen = s.defaultBody;
              if (!chosen) return onFail(curSt);
              return symExecBlock(chosen, 0, env, curSt, inlineDepth, (armEnv, armSt) => cont(armEnv, armSt), onFail);
            }
            const j = needed[k];
            return inspectUnion(
              env.get(s.inputs[j]),
              curSt,
              (tag, _payload, nxtSt) => {
                observedTags[j] = tag;
                return inspectNext(k + 1, nxtSt);
              },
              onFail
            );
          };
          return inspectNext(0, st);
        }
        case "spec": {
          if (s.branches.length === 0) return onFail(st);
          const tryBranch = (bIdx, curSt) => {
            if (bIdx >= s.branches.length) return onFail(curSt);
            const brEnv = new Map();
            for (const v of s.inputs) brEnv.set(v, env.get(v));
            for (const v of s.outputs) {
              brEnv.set(v, env.get(v));
              if (env.has(`__port_schema__${v}`)) brEnv.set(`__port_schema__${v}`, env.get(`__port_schema__${v}`));
            }
            return symExecBlock(
              s.branches[bIdx].body,
              0,
              brEnv,
              cloneSymState(curSt),
              inlineDepth,
              (outEnv, okSt) => {
                const merged = new Map(env);
                for (const v of s.outputs) merged.set(v, outEnv.get(v));
                return cont(merged, okSt);
              },
              (failSt) => {
                // Roll back local side effects of the failed speculative branch while preserving
                // `peeks` and `drained` already committed by ancestor `peek` nodes along this path!
                const rbSt = cloneSymState(curSt);
                if (failSt) {
                  rbSt.peeks = failSt.peeks.map((a) => a.slice());
                  rbSt.drained = failSt.drained.slice();
                }
                return tryBranch(bIdx + 1, rbSt);
              }
            );
          };
          return tryBranch(0, st);
        }
        case "spawn": {
          // 1. Direct self-recursion -> tail-loop or TMC streaming loop!
          if (s.target === proc.name) {
            if (st.selfCall !== null || inlineDepth > 0) bail();
            const nextSt = cloneSymState(st);
            nextSt.selfCall = { nextArgs: s.inputs.map((v) => env.get(v)) };
            const nextEnv = new Map(env);
            const box = { next: 0 };
            for (let oi = 0; oi < s.outputs.length; oi++) {
              const outPl = outPortPlists[oi];
              nextEnv.set(s.outputs[oi], buildSelfOutSVal(outPl, 0, box));
            }
            return cont(nextEnv, nextSt);
          }

          // 2. Acyclic helper proc -> inline symbolically!
          const callee = procMap.get(s.target);
          if (callee && cg.isFinite(s.target) && inlineDepth < maxInlineDepth) {
            const subEnv = new Map();
            for (let i = 0; i < callee.inputs.length; i++) {
              subEnv.set(callee.inputs[i].name, env.get(s.inputs[i]));
            }
            for (let i = 0; i < callee.outputs.length; i++) {
              const oPl = resolvePlist(callee.outputs[i].schema);
              subEnv.set(callee.outputs[i].name, { __schema: oPl });
              subEnv.set(`__port_schema__${callee.outputs[i].name}`, oPl);
            }
            return symExecBlock(
              callee.body,
              0,
              subEnv,
              st,
              inlineDepth + 1,
              (doneEnv, doneSt) => {
                const nextEnv = new Map(env);
                for (let i = 0; i < s.outputs.length; i++) {
                  nextEnv.set(s.outputs[i], doneEnv.get(callee.outputs[i].name));
                }
                return cont(nextEnv, doneSt);
              },
              onFail
            );
          }

          // External recursive call -> bail (keep as outer proc orchestrator)
          bail();
        }
        default:
          bail();
      }
    }

    try {
      const initSt = {
        peeks: inLeaves.map(() => []),
        schemas: inLeaves.map((l) => ({ plist: l.plist, nodeId: 0 })),
        drained: inLeaves.map((l) => l.isUnit),
        mustDrainUnit: inLeaves.map(() => false),
        mustDrainFull: inLeaves.map(() => null),
        selfCall: null
      };

      const initEnv = new Map();
      const inBox = { next: 0 };
      for (let i = 0; i < proc.inputs.length; i++) {
        initEnv.set(proc.inputs[i].name, buildInitialInSVal(inPortPlists[i], 0, inBox));
      }
      for (let i = 0; i < proc.outputs.length; i++) {
        initEnv.set(proc.outputs[i].name, { __schema: outPortPlists[i] });
        initEnv.set(`__port_schema__${proc.outputs[i].name}`, outPortPlists[i]);
      }

      const root = symExecBlock(
        proc.body,
        0,
        initEnv,
        initSt,
        0,
        (finalEnv, finalSt) => {
          const outVals = proc.outputs.map((o) => finalEnv.get(o.name));
          return finalSt.selfCall ? makeLoopLeaf(outVals, finalSt) : makeEmitLeaf(outVals, finalSt);
        },
        () => {
          hasFail = true;
          return FAIL_NODE;
        }
      );

      if (root === FAIL_NODE) return null;
      if (hasSelf && !hasLoopLeaf) return null;

      // Collect actually reachable decision nodes
      const reachable = new Set();
      const visit = (n) => {
        if (!n || reachable.has(n.id)) return;
        reachable.add(n.id);
        if (n.kind === "peek") {
          for (const c of Object.values(n.cases)) visit(c.node);
        }
      };
      visit(root);

      // Identify finite-enum register ports (e.g. `c`, `b`, `mode`, `ord`)!
      const regPorts = new Map(); // p -> enumInfo
      if (hasLoopLeaf) {
        for (let p = 0; p < P; p++) {
          const enumInfo = getUnitEnumInfo(inLeaves[p].plist);
          if (!enumInfo) continue;
          let valid = true;
          let hasConst = false;
          for (const id of reachable) {
            const n = dnodeById.get(id);
            if (!n || n.kind !== "loop") continue;
            const ne = n.nextExprs[p];
            if (ne.kind === "const" && ne.tokens.length === 1) {
              hasConst = true;
            } else if (ne.kind === "splice" && ne.p === p && ne.consumeCount === 0 && ne.prefix.length === 0) {
              // identity unchanged
            } else {
              valid = false;
              break;
            }
          }
          if (valid && hasConst) {
            regPorts.set(p, enumInfo);
          }
        }
      }

      // Identify write-only prepend accumulators -> `unshift_bits` directly onto output `q`!
      // (Handles `rev_bits`, `half_max_tally`, `f64_rev_step`, `f64_lsb_inc_step`, `f64_prepend_zeros`
      // with ZERO virtual stack overhead and full multi-input `chunk_table` + SWAR support!)
      const unshiftAccPorts = new Map(); // p -> { outIdx }
      const unshiftOutToPort = new Map(); // q -> p
      if (hasLoopLeaf) {
        const peekedPorts = new Set();
        for (const id of reachable) {
          const n = dnodeById.get(id);
          if (n && n.kind === "peek") peekedPorts.add(n.p);
        }
        for (let p = 0; p < P; p++) {
          if (regPorts.has(p) || peekedPorts.has(p)) continue;
          let okLoop = true;
          let hasPrepend = false;
          for (const id of reachable) {
            const n = dnodeById.get(id);
            if (!n || n.kind !== "loop") continue;
            const ne = n.nextExprs[p];
            if (ne.kind === "splice" && ne.p === p && ne.consumeCount === 0) {
              if (ne.prefix.length > 0) hasPrepend = true;
            } else {
              okLoop = false;
              break;
            }
          }
          if (!okLoop || !hasPrepend) continue;

          // Every reachable `emit` leaf must splice `p` to the SAME output `q` with matching schema!
          let targetQ = -1;
          let okExit = true;
          for (const id of reachable) {
            const n = dnodeById.get(id);
            if (!n || n.kind !== "emit") continue;
            const idxQ = n.outExprs.findIndex((e) => e.kind === "splice" && e.p === p);
            if (idxQ < 0 || (targetQ >= 0 && targetQ !== idxQ)) {
              okExit = false;
              break;
            }
            targetQ = idxQ;
          }
          if (!okExit || targetQ < 0) continue;
          if (unshiftOutToPort.has(targetQ)) continue;
          if (!schemasEquivalent(inLeaves[p].plist, 0, outLeaves[targetQ].plist, 0)) continue;

          // Output `targetQ` must NOT also emit forward TMC `push_bits` in any loop leaf!
          let conflictsTmc = false;
          for (const id of reachable) {
            const n = dnodeById.get(id);
            if (n && n.kind === "loop" && (n.outEmitPrefixes[targetQ] || []).length > 0) {
              conflictsTmc = true;
              break;
            }
          }
          if (conflictsTmc) continue;

          unshiftAccPorts.set(p, { outIdx: targetQ });
          unshiftOutToPort.set(targetQ, p);
        }
      }

      // Identify read/write virtual LIFO bit-stack ports (e.g. `_lsb_trim`'s `z`)!
      const stackPorts = new Map(); // p -> { stackInfo, exitMode: "clear" | "flush_to_out", outIdx? }
      if (hasLoopLeaf && enableVirtualStack) {
        for (let p = 0; p < P; p++) {
          if (regPorts.has(p) || unshiftAccPorts.has(p)) continue;
          const sInfo = getBitStackSchemaInfo(inLeaves[p].plist);
          if (!sInfo) continue;

          // Check loop updates: ONLY LIFO push, LIFO pop, identity, or clear/const(termTag)!
          let okLoop = true;
          let hasPush = false;
          for (const id of reachable) {
            const n = dnodeById.get(id);
            if (!n || n.kind !== "loop") continue;
            const ne = n.nextExprs[p];
            if (ne.kind === "splice" && ne.p === p) {
              if (ne.consumeCount === 0 && ne.prefix.length > 0) {
                // LIFO push of recTags!
                if (ne.prefix.every((tok) => sInfo.recTagToBit.has(tok.tag))) {
                  hasPush = true;
                } else {
                  okLoop = false;
                  break;
                }
              } else if (ne.prefix.length === 0) {
                // Identity (`consumeCount === 0`) OR LIFO pop (`consumeCount >= 1`)!
              } else {
                okLoop = false;
                break;
              }
            } else if (ne.kind === "const" && ne.tokens.length === 1 && ne.tokens[0].tag === sInfo.termTag) {
              // Reset/clear to empty!
            } else {
              okLoop = false;
              break;
            }
          }
          if (!okLoop || !hasPush) continue;

          // Check exit leaves: must either discard (`drain`) OR splice cleanly to one output!
          let exitMode = null;
          let outIdx = -1;
          let okExit = true;
          for (const id of reachable) {
            const n = dnodeById.get(id);
            if (!n || n.kind !== "emit") continue;
            const splicedOut = n.outExprs.findIndex((e) => e.kind === "splice" && e.p === p);
            if (splicedOut >= 0) {
              if (exitMode === "clear" || (outIdx >= 0 && outIdx !== splicedOut)) {
                okExit = false;
                break;
              }
              exitMode = "flush_to_out";
              outIdx = splicedOut;
            } else {
              if (exitMode === "flush_to_out") {
                okExit = false;
                break;
              }
              exitMode = "clear";
            }
          }
          if (okExit && exitMode) {
            stackPorts.set(p, { stackInfo: sInfo, exitMode, outIdx });
            break; // At most 1 virtual stack per kernel (matches stack_table_step!)
          }
        }
      }

      // Validate loop-step invariants for all non-promoted ports & dropped drains!
      if (hasLoopLeaf) {
        for (const id of reachable) {
          const n = dnodeById.get(id);
          if (!n || n.kind !== "loop") continue;
          let makesProgress = false;
          for (let p = 0; p < P; p++) {
            const ne = n.nextExprs[p];
            if (n.droppedDrainFull[p] && !regPorts.has(p) && !stackPorts.has(p)) {
              bail("dropped-drain-in-loop");
            }
            if (regPorts.has(p)) {
              if (ne.kind === "const") makesProgress = true;
              continue;
            }
            if (unshiftAccPorts.has(p)) continue;
            if (stackPorts.has(p)) {
              if (ne.kind === "splice" && ne.consumeCount > 0) makesProgress = true;
              if (ne.kind === "const") makesProgress = true;
              continue;
            }
            if (ne.kind === "const") bail("const-stream-in-loop");
            if (ne.kind === "splice" && ne.prefix.length > 0) bail("prepend-stream-in-loop");
            if (n.shifts[p] > 0) makesProgress = true;
          }
          if (!makesProgress) bail("zero-progress-loop");
        }
      }

      // Must only have single-level peek (`depth === 0`) on stack ports, and every non-empty
      // branch of a `peek(sp)` MUST consume `sp` (since `stack_pop` pops 1 bit eagerly!).
      for (const [sp, spMeta] of stackPorts.entries()) {
        const sInfo = spMeta.stackInfo;
        const verifyConsumes = (node, seen = new Set()) => {
          if (!node || node === FAIL_NODE || seen.has(node.id)) return;
          seen.add(node.id);
          if (node.kind === "peek") {
            if (node.p === sp) bail("nested-stack-peek");
            for (const c of Object.values(node.cases)) verifyConsumes(c.node, seen);
          } else if (node.kind === "loop") {
            const ne = node.nextExprs[sp];
            if (ne.kind === "splice" && ne.consumeCount === 0) bail("unconsumed-stack-pop");
          }
        };
        for (const id of reachable) {
          const n = dnodeById.get(id);
          if (n && n.kind === "peek" && n.p === sp) {
            if (n.depth > 0) bail("deep-stack-peek");
            for (const [tag, c] of Object.entries(n.cases)) {
              if (tag !== sInfo.termTag) verifyConsumes(c.node);
            }
          }
        }
      }

      return {
        isLoop: hasLoopLeaf,
        hasTmcEmit,
        inLeaves,
        outLeaves,
        inPortPlists,
        outPortPlists,
        inPortLeafRanges,
        root,
        reachable,
        dnodeById,
        regPorts,
        unshiftAccPorts,
        unshiftOutToPort,
        stackPorts,
        hasFail
      };
    } catch (err) {
      if (err && err[BAIL]) {
        if (process.env.KTVM_OPT_DEBUG) {
          console.error(`[fuse-kernel bail] ${proc.name}: ${err.message} (stack: ${err.stack?.split("\n")[2]?.trim()})`);
        }
        return null;
      }
      throw err;
    }
  }

  // --- Emit Concrete `kTVM` `kernel` Basic-Block CFG from Decision DAG ---

  function emitKernelFromDecisionDag(proc, c) {
    const { inLeaves, outLeaves, root, dnodeById, regPorts, unshiftAccPorts, unshiftOutToPort, stackPorts, isLoop, hasTmcEmit } = c;
    const P = inLeaves.length;
    const Q = outLeaves.length;

    let kName = `@${sanitize(proc.name)}_k`;
    while (existingKernelNames.has(kName)) kName = `@${sanitize(proc.name)}_k${helperSeq++}`;
    existingKernelNames.add(kName);

    const kInNames = inLeaves.map((l, i) => `%i${i}_${sanitize(l.pathKey || "in")}`);
    const kOutNames = outLeaves.map((l, i) => `%o${i}_${sanitize(l.pathKey || "out")}`);
    const kInputs = inLeaves.map((l, i) => ({ name: kInNames[i], schema: internSchemaExpr(l.plist, `ki${i}`) }));
    const kOutputs = outLeaves.map((l, i) => ({ name: kOutNames[i], schema: internSchemaExpr(l.plist, `ko${i}`) }));

    const regs = [];
    const regNameOfPort = new Map();
    for (const [p, info] of regPorts.entries()) {
      const rName = `r${p}`;
      regNameOfPort.set(p, rName);
      regs.push({ name: rName, states: info.states, init: 0 });
    }

    const stacks = [];
    const stackNameOfPort = new Map();
    for (const [p] of stackPorts.entries()) {
      const sName = `s${p}`;
      stackNameOfPort.set(p, sName);
      stacks.push({ name: sName });
    }

    const blocks = [];
    let blkSeq = 0;
    const freshLbl = (p) => `${p}_${blkSeq++}`;

    // If a stack port might receive a non-empty initial value at runtime, keep a fallback proc
    // so `entry_init` can handoff safely if initial stack != termTag!
    let fallbackProc = null;
    if (stackPorts.size > 0) {
      const fbName = `@${sanitize(proc.name)}_fb_${helperSeq++}`;
      const fbIn = kInputs.map((x) => cloneAst(x));
      const fbOut = kOutputs.map((x) => cloneAst(x));
      // Build a proc taking flat leaf ports -> muxing into original proc body -> demuxing!
      const fbBody = [];
      let fvSeq = 0;
      const fvar = (p) => `%fb_${p}_${fvSeq++}`;

      const rebuildFromLeaves = (plist, nodeId, leafVars, idxBox, stmts) => {
        const [kind, edges] = plist[nodeId];
        if (kind === "closed-product" && edges.length > 0) {
          const mFields = edges.map(([lbl, t]) => ({
            label: lbl,
            name: rebuildFromLeaves(plist, t, leafVars, idxBox, stmts)
          }));
          const subPl = subPlist(plist, nodeId);
          const v = fvar("mux");
          stmts.push({ op: "chan", name: v, schema: internSchemaExpr(subPl, "fb") });
          stmts.push({ op: "mux", fields: mFields, dst: v, schema: internSchemaExpr(subPl, "fb") });
          return v;
        }
        return leafVars[idxBox.i++];
      };

      const splitToLeaves = (srcVar, plist, nodeId, dstVars, idxBox, stmts) => {
        const [kind, edges] = plist[nodeId];
        if (kind === "closed-product" && edges.length > 0) {
          const subPl = subPlist(plist, nodeId);
          const dFields = [];
          const subPairs = [];
          for (const [lbl, t] of edges) {
            const tPl = subPlist(plist, t);
            const v = fvar(lbl);
            stmts.push({ op: "chan", name: v, schema: internSchemaExpr(tPl, lbl) });
            dFields.push({ label: lbl, name: v });
            subPairs.push({ v, t });
          }
          stmts.push({ op: "demux", src: srcVar, schema: internSchemaExpr(subPl, "fb"), fields: dFields });
          for (const sp of subPairs) splitToLeaves(sp.v, plist, sp.t, dstVars, idxBox, stmts);
          return;
        }
        stmts.push({ op: "splice", src: srcVar, dst: dstVars[idxBox.i++] });
      };

      // Clone original proc as fallback helper and wrap it
      const origCopyName = `@${sanitize(proc.name)}_orig_${helperSeq++}`;
      const origCopy = cloneAst(proc);
      origCopy.name = origCopyName;
      // Rewrite self-spawns inside origCopy to origCopyName
      const rewriteSelf = (stmts) => {
        for (const s of stmts || []) {
          if (s.op === "spawn" && s.target === proc.name) s.target = origCopyName;
          else if (s.op === "switch") {
            for (const a of s.arms) rewriteSelf(a.body);
            if (s.defaultBody) rewriteSelf(s.defaultBody);
          } else if (s.op === "spec") {
            for (const b of s.branches) rewriteSelf(b.body);
          }
        }
      };
      rewriteSelf(origCopy.body);
      helperProcs.push(origCopy);

      const boxIn = { i: 0 };
      const origArgs = c.inPortPlists.map((pl) => rebuildFromLeaves(pl, 0, kInNames, boxIn, fbBody));
      const origOuts = c.outPortPlists.map((pl, idx) => {
        const v = fvar(`out${idx}`);
        fbBody.push({ op: "chan", name: v, schema: internSchemaExpr(pl, "fbo") });
        return v;
      });
      fbBody.push({
        op: "spawn",
        target: origCopyName,
        schemaArgs: [],
        inputs: origArgs,
        outputs: origOuts,
        after: null,
        token: null
      });
      const boxOut = { i: 0 };
      for (let i = 0; i < origOuts.length; i++) {
        splitToLeaves(origOuts[i], c.outPortPlists[i], 0, kOutNames, boxOut, fbBody);
      }
      fallbackProc = {
        name: fbName,
        params: [],
        inputs: fbIn,
        outputs: fbOut,
        attrs: [],
        body: fbBody
      };
    }

    const loopHeaderLabel = (regPorts.size > 0 || stackPorts.size > 0) ? "loop_hdr" : "entry";
    const slowStepLabel = "slow_step";

    // Preamble `entry` initializing promoted `reg`s and checking `stack`s
    if (loopHeaderLabel !== "entry") {
      let curLbl = "entry";
      const initRegPorts = [...regPorts.entries()];
      const initStackPorts = [...stackPorts.entries()];

      // Read initial enum values from promoted register ports & drain them to unit!
      for (let idx = 0; idx < initRegPorts.length; idx++) {
        const [p, info] = initRegPorts[idx];
        const nextLbl = (idx === initRegPorts.length - 1 && initStackPorts.length === 0)
          ? loopHeaderLabel
          : freshLbl("init");
        const tmp = `%ir_${p}`;
        const cases = [];
        for (let ord = 0; ord < info.states; ord++) {
          const setLbl = freshLbl(`set_r${p}_${ord}`);
          cases.push({ bits: toBitsLit(ord, info.width), target: setLbl });
          blocks.push({
            label: setLbl,
            stmts: [
              { op: "shift_tag", src: kInNames[p], width: info.width, nextSchema: S.unit() },
              { op: "drain_guard", src: kInNames[p], schema: S.unit() },
              { op: "set_reg", reg: regNameOfPort.get(p), value: ord }
            ],
            term: { op: "goto", target: nextLbl }
          });
        }
        blocks.push({
          label: curLbl,
          stmts: [
            { op: "peek_bits", dst: tmp, src: kInNames[p], offset: 0, width: info.width, onEof: "err" }
          ],
          term: { op: "switch_bits", src: tmp, cases, defaultTarget: "err" }
        });
        curLbl = nextLbl;
      }

      // Check initial stack port: if `exitMode === "clear"`, check empty (`termTag`),
      // else if `exitMode === "flush_to_out"`, keep `%in_p` untouched to splice after flushing stack!
      for (let idx = 0; idx < initStackPorts.length; idx++) {
        const [p, spMeta] = initStackPorts[idx];
        const nextLbl = idx === initStackPorts.length - 1 ? loopHeaderLabel : freshLbl("init");
        if (spMeta.exitMode === "flush_to_out") {
          // Don't even need `%in_p` to be empty: stack accumulates new prepended tags,
          // and on exit we pop stack then `splice %in_p -> %out`!
          if (curLbl !== nextLbl) {
            blocks.push({ label: curLbl, stmts: [], term: { op: "goto", target: nextLbl } });
            curLbl = nextLbl;
          }
        } else {
          // `exitMode === "clear"` (e.g. `_lsb_trim`): verify initial `%z` starts with `termTag`,
          // shift + drain it, otherwise handoff to fallbackProc!
          const sInfo = spMeta.stackInfo;
          const tmp = `%iz_${p}`;
          const emptyOkLbl = freshLbl("stack_init_ok");
          const fbLbl = freshLbl("stack_init_fb");
          blocks.push({
            label: curLbl,
            stmts: [
              { op: "peek_bits", dst: tmp, src: kInNames[p], offset: 0, width: sInfo.tagWidth, onEof: "err" }
            ],
            term: {
              op: "switch_bits",
              src: tmp,
              cases: [{ bits: toBitsLit(sInfo.termOrd, sInfo.tagWidth), target: emptyOkLbl }],
              defaultTarget: fbLbl
            }
          });
          blocks.push({
            label: emptyOkLbl,
            stmts: [
              { op: "shift_tag", src: kInNames[p], width: sInfo.tagWidth, nextSchema: S.unit() },
              { op: "drain_guard", src: kInNames[p], schema: S.unit() }
            ],
            term: { op: "goto", target: nextLbl }
          });
          blocks.push({
            label: fbLbl,
            stmts: [],
            term: { op: "handoff", target: fallbackProc.name, inputs: [...kInNames], outputs: [...kOutNames] }
          });
          curLbl = nextLbl;
        }
      }
    }

    // Loop header block (with cooperative `yield` ONLY for forward-push TMC outputs!)
    const hdrStmts = [];
    if (isLoop && hasTmcEmit && !unshiftOutToPort.has(0)) {
      hdrStmts.push({ op: "yield", dst: kOutNames[0], threshold: 64 });
    }
    blocks.push({
      label: loopHeaderLabel,
      stmts: hdrStmts,
      term: { op: "goto", target: slowStepLabel }
    });

    // Lower Decision DAG nodes -> kernel basic blocks!
    const emittedDNodes = new Map(); // dnode.id -> blockLabel
    const exitBlocks = []; // tracked for table synthesis metadata!

    function lowerDNode(dnode, preferredLabel = null) {
      if (dnode.kind === "fail") return "err";
      if (!preferredLabel && emittedDNodes.has(dnode.id)) return emittedDNodes.get(dnode.id);

      const lbl = preferredLabel || freshLbl(`d${dnode.id}`);
      emittedDNodes.set(dnode.id, lbl);

      if (dnode.kind === "peek") {
        // Case 1: Promoted finite-enum register!
        if (regPorts.has(dnode.p)) {
          const rName = regNameOfPort.get(dnode.p);
          const cases = Object.values(dnode.cases).map((c) => ({
            value: c.ord,
            target: lowerDNode(c.node)
          }));
          blocks.push({
            label: lbl,
            stmts: [],
            term: { op: "switch_reg", reg: rName, cases }
          });
          return lbl;
        }

        // Case 2: Promoted virtual LIFO bit-stack!
        if (stackPorts.has(dnode.p)) {
          const spMeta = stackPorts.get(dnode.p);
          const sInfo = spMeta.stackInfo;
          const sName = stackNameOfPort.get(dnode.p);
          const emptyCase = dnode.cases[sInfo.termTag];
          const emptyTarget = emptyCase ? lowerDNode(emptyCase.node) : "err";
          const tmp = `%sp_${dnode.id}`;
          const recCases = sInfo.recTags.map((rt, bitIdx) => ({
            bits: toBitsLit(bitIdx, sInfo.stackBitWidth),
            target: dnode.cases[rt.tag] ? lowerDNode(dnode.cases[rt.tag].node) : "err"
          }));
          // Pop top bit (on empty -> branch to `termTag` case!).
          // If a child path does NOT consume the stack (identity), we re-push it there!
          // Wait: let's track `poppedStackTag` cleanly — even simpler: in every loop/emit
          // leaf, `dnode.cases[rt]` already has `st.peeks[sp] = [rt.tag]` (`consumeCount = 1`)!
          // If a leaf has `ne.consumeCount === 0` on `sp` (meaning it only peeked without popping!),
          // that leaf simply re-pushes `rt.tag`! That way `stack_pop` works in 1 op!
          blocks.push({
            label: lbl,
            stmts: [
              { op: "stack_pop", dst: tmp, stack: sName, width: sInfo.stackBitWidth, onEmpty: emptyTarget }
            ],
            term: { op: "switch_bits", src: tmp, cases: recCases, defaultTarget: "err" }
          });
          return lbl;
        }

        // Case 3: Normal stream input `peek_bits`!
        const tmp = `%t_${dnode.id}`;
        const cases = Object.values(dnode.cases).map((c) => ({
          bits: c.bits,
          target: lowerDNode(c.node)
        }));
        blocks.push({
          label: lbl,
          stmts: [
            {
              op: "peek_bits",
              dst: tmp,
              src: kInNames[dnode.p],
              offset: dnode.offsetBits,
              width: dnode.width,
              onEof: "err"
            }
          ],
          term: { op: "switch_bits", src: tmp, cases, defaultTarget: "err" }
        });
        return lbl;
      }

      if (dnode.kind === "loop") {
        const stmts = [];
        // 1. Shift consumed input tags on stream ports
        for (let p = 0; p < P; p++) {
          if (regPorts.has(p) || unshiftAccPorts.has(p) || stackPorts.has(p)) continue;
          for (const st of dnode.shiftTokens[p]) {
            stmts.push({
              op: "shift_tag",
              src: kInNames[p],
              width: st.width,
              nextSchema: internSchemaExpr(st.nextPlist, `st${p}`)
            });
          }
        }
        // 2. Push TMC forward output bits
        for (let q = 0; q < Q; q++) {
          for (const tok of dnode.outEmitPrefixes[q] || []) {
            if (tok.width > 0) {
              stmts.push({
                op: "push_bits",
                dst: kOutNames[q],
                bits: toBitsLit(tok.ord, tok.width),
                width: tok.width
              });
            }
          }
        }
        // 2b. Unshift write-only prepend accumulator tags directly onto output `q`!
        for (const [p, uMeta] of unshiftAccPorts.entries()) {
          const ne = dnode.nextExprs[p];
          if (ne.kind === "splice" && ne.prefix.length > 0) {
            for (let i = ne.prefix.length - 1; i >= 0; i--) {
              const tok = ne.prefix[i];
              if (tok.width > 0) {
                stmts.push({
                  op: "unshift_bits",
                  dst: kOutNames[uMeta.outIdx],
                  bits: toBitsLit(tok.ord, tok.width),
                  width: tok.width
                });
              }
            }
          }
        }
        // 3. Update promoted registers
        for (const [p, info] of regPorts.entries()) {
          const ne = dnode.nextExprs[p];
          if (ne.kind === "const" && ne.tokens.length === 1) {
            stmts.push({ op: "set_reg", reg: regNameOfPort.get(p), value: ne.tokens[0].ord });
          }
        }
        // 4. Update promoted virtual stack (push / clear)
        for (const [p, spMeta] of stackPorts.entries()) {
          const sInfo = spMeta.stackInfo;
          const sName = stackNameOfPort.get(p);
          const ne = dnode.nextExprs[p];
          if (ne.kind === "const") {
            stmts.push({ op: "stack_clear", stack: sName });
          } else if (ne.kind === "splice" && ne.prefix.length > 0) {
            // Push in reverse so first tag in `prefix` ends up on TOP of LIFO stack!
            for (let i = ne.prefix.length - 1; i >= 0; i--) {
              const bit = sInfo.recTagToBit.get(ne.prefix[i].tag);
              stmts.push({
                op: "stack_push",
                stack: sName,
                bits: toBitsLit(bit, sInfo.stackBitWidth),
                width: sInfo.stackBitWidth
              });
            }
          }
        }
        blocks.push({
          label: lbl,
          stmts,
          term: { op: "goto", target: loopHeaderLabel }
        });
        return lbl;
      }

      if (dnode.kind === "emit") {
        // Split emit into: (a) shift block (runs on `slow_step`), jumping to
        // (b) clean exit handler block `exit_N` (which BOTH `slow_step` AND `table_step`
        // can jump to — running `drain_guard`s, final emits, `splice`/`close`, `retire`!)
        const exitLbl = freshLbl("exit");
        exitBlocks.push({ label: exitLbl, dnode });

        const shiftStmts = [];
        for (let p = 0; p < P; p++) {
          if (regPorts.has(p) || unshiftAccPorts.has(p) || stackPorts.has(p)) continue;
          for (const st of dnode.shiftTokens[p]) {
            shiftStmts.push({
              op: "shift_tag",
              src: kInNames[p],
              width: st.width,
              nextSchema: internSchemaExpr(st.nextPlist, `st${p}`)
            });
          }
        }
        blocks.push({
          label: lbl,
          stmts: shiftStmts,
          term: { op: "goto", target: exitLbl }
        });

        // Build the exit handler block `exitLbl`
        const exitStmts = [];
        // Re-align `consSchema` on any spliced stream port whose post-shift schema differs from its
        // entry schema (so `table_step`/`fsm_table_step` raw `shiftBits` transitions align cleanly!).
        for (let p = 0; p < P; p++) {
          if (regPorts.has(p) || unshiftAccPorts.has(p) || stackPorts.has(p)) continue;
          const toks = dnode.shiftTokens[p];
          if (toks.length > 0 && dnode.outExprs.some((e) => e.kind === "splice" && e.p === p)) {
            const remPl = toks[toks.length - 1].nextPlist;
            if (!schemasEquivalent(remPl, 0, inLeaves[p].plist, 0)) {
              exitStmts.push({
                op: "shift_tag",
                src: kInNames[p],
                width: 0,
                nextSchema: internSchemaExpr(remPl, `re${p}`)
              });
            }
          }
        }
        for (let p = 0; p < P; p++) {
          if (regPorts.has(p) || unshiftAccPorts.has(p)) continue;
          if (stackPorts.has(p)) {
            const spMeta = stackPorts.get(p);
            if (spMeta.exitMode === "clear") {
              exitStmts.push({ op: "stack_clear", stack: stackNameOfPort.get(p) });
            }
            continue;
          }
          if (dnode.drainGuards[p]) {
            exitStmts.push({
              op: "drain_guard",
              src: kInNames[p],
              schema: internSchemaExpr(dnode.drainGuards[p], `dg${p}`)
            });
          }
        }

        // Helper to emit a single standard or unshift-acc output `q` (returns true if emitted inline,
        // or false if `e` splices a promoted `reg` port that must be emitted via `switch_reg`!)
        const regOutList = [];
        const emitOutputToStmts = (q, targetStmts) => {
          const e = dnode.outExprs[q];
          if (e.kind === "splice" && regPorts.has(e.p)) {
            regOutList.push({ q, e });
            return;
          }
          if (unshiftOutToPort.has(q)) {
            // `unshift` output: prepend any exit prefix in reverse order, then `splice %acc -> %out`!
            const pref = e.prefix || [];
            for (let i = pref.length - 1; i >= 0; i--) {
              const tok = pref[i];
              if (tok.width > 0) {
                targetStmts.push({
                  op: "unshift_bits",
                  dst: kOutNames[q],
                  bits: toBitsLit(tok.ord, tok.width),
                  width: tok.width
                });
              }
            }
            targetStmts.push({ op: "splice", src: kInNames[e.p], dst: kOutNames[q] });
            return;
          }
          if (e.kind === "const") {
            for (const tok of e.tokens) {
              if (tok.width > 0) {
                targetStmts.push({
                  op: "push_bits",
                  dst: kOutNames[q],
                  bits: toBitsLit(tok.ord, tok.width),
                  width: tok.width
                });
              }
            }
            targetStmts.push({ op: "close", dst: kOutNames[q] });
          } else if (e.kind === "splice") {
            for (const tok of e.prefix) {
              if (tok.width > 0) {
                targetStmts.push({
                  op: "push_bits",
                  dst: kOutNames[q],
                  bits: toBitsLit(tok.ord, tok.width),
                  width: tok.width
                });
              }
            }
            targetStmts.push({ op: "splice", src: kInNames[e.p], dst: kOutNames[q] });
          }
        };

        // Chain `switch_reg` blocks to emit any promoted register outputs before jumping to `finalTerm`
        const chainRegOutputs = (startLbl, startStmts, finalTerm) => {
          if (regOutList.length === 0) {
            blocks.push({ label: startLbl, stmts: startStmts, term: finalTerm });
            return;
          }
          let curLbl = startLbl;
          let curStmts = startStmts;
          for (let ri = 0; ri < regOutList.length; ri++) {
            const { q, e } = regOutList[ri];
            const info = regPorts.get(e.p);
            const rName = regNameOfPort.get(e.p);
            const isLast = ri === regOutList.length - 1;
            const nextLbl = isLast ? null : freshLbl("reg_out_next");
            const cases = [];
            for (let ord = 0; ord < info.states; ord++) {
              const cLbl = freshLbl(`emit_r${e.p}_${ord}`);
              const cStmts = [];
              for (const tok of e.prefix || []) {
                if (tok.width > 0) {
                  cStmts.push({
                    op: "push_bits",
                    dst: kOutNames[q],
                    bits: toBitsLit(tok.ord, tok.width),
                    width: tok.width
                  });
                }
              }
              if (info.width > 0) {
                cStmts.push({
                  op: "push_bits",
                  dst: kOutNames[q],
                  bits: toBitsLit(ord, info.width),
                  width: info.width
                });
              }
              cStmts.push({ op: "close", dst: kOutNames[q] });
              blocks.push({
                label: cLbl,
                stmts: cStmts,
                term: isLast ? finalTerm : { op: "goto", target: nextLbl }
              });
              cases.push({ value: ord, target: cLbl });
            }
            blocks.push({
              label: curLbl,
              stmts: curStmts,
              term: { op: "switch_reg", reg: rName, cases }
            });
            curLbl = nextLbl;
            curStmts = [];
          }
        };

        // Check if any read/write stack port flushes to an output on exit!
        let flushStackPort = null;
        for (const [p, spMeta] of stackPorts.entries()) {
          if (spMeta.exitMode === "flush_to_out") {
            flushStackPort = { p, spMeta };
          }
        }

        if (flushStackPort) {
          const { p, spMeta } = flushStackPort;
          const sInfo = spMeta.stackInfo;
          const sName = stackNameOfPort.get(p);
          const flushQ = spMeta.outIdx;
          // Emit ALL OTHER outputs `q2 !== flushQ` first so no output is ever left open!
          for (let q2 = 0; q2 < Q; q2++) {
            if (q2 !== flushQ) emitOutputToStmts(q2, exitStmts);
          }
          const expr = dnode.outExprs[flushQ];
          for (const tok of expr.prefix || []) {
            if (tok.width > 0) {
              exitStmts.push({
                op: "push_bits",
                dst: kOutNames[flushQ],
                bits: toBitsLit(tok.ord, tok.width),
                width: tok.width
              });
            }
          }
          const flushLoopLbl = freshLbl("flush_stack");
          const flushDoneLbl = freshLbl("flush_done");
          chainRegOutputs(exitLbl, exitStmts, { op: "goto", target: flushLoopLbl });

          const tmp = `%fl_${blkSeq++}`;
          const recCases = sInfo.recTags.map((rt, bitIdx) => {
            const emitBitLbl = freshLbl(`emit_s${bitIdx}`);
            blocks.push({
              label: emitBitLbl,
              stmts: [{ op: "push_bits", dst: kOutNames[flushQ], bits: toBitsLit(rt.ord, sInfo.tagWidth), width: sInfo.tagWidth }],
              term: { op: "goto", target: flushLoopLbl }
            });
            return { bits: toBitsLit(bitIdx, sInfo.stackBitWidth), target: emitBitLbl };
          });
          blocks.push({
            label: flushLoopLbl,
            stmts: [{ op: "stack_pop", dst: tmp, stack: sName, width: sInfo.stackBitWidth, onEmpty: flushDoneLbl }],
            term: { op: "switch_bits", src: tmp, cases: recCases, defaultTarget: "err" }
          });
          blocks.push({
            label: flushDoneLbl,
            stmts: [{ op: "splice", src: kInNames[p], dst: kOutNames[flushQ] }],
            term: { op: "retire" }
          });
          return lbl;
        }

        // Standard exit: emit every output cleanly!
        for (let q = 0; q < Q; q++) {
          emitOutputToStmts(q, exitStmts);
        }
        chainRegOutputs(exitLbl, exitStmts, { op: "retire" });
        return lbl;
      }

      return "err";
    }

    lowerDNode(root, slowStepLabel);

    blocks.push({ label: "err", stmts: [], term: { op: "fail" } });

    const attrs = [];
    if (!c.hasFail) attrs.push("total");
    if (isLoop && hasTmcEmit) attrs.push("tmc");

    const outputModes = outLeaves.map((_, q) => (unshiftOutToPort.has(q) ? "unshift" : "push"));

    const kernel = {
      name: kName,
      inputs: kInputs,
      outputs: kOutputs,
      attrs,
      regs,
      stacks,
      blocks,
      // Internal metadata consumed by `synthesize-tables.mjs` (stripped before JSON/DSL export)
      _optMeta: {
        isLoop,
        hasTmcEmit,
        loopHeaderLabel,
        slowStepLabel,
        exitBlocks: exitBlocks.map((e) => e.label),
        streamPortIndices: inLeaves.map((_, i) => i).filter((i) => !regPorts.has(i) && !unshiftAccPorts.has(i) && !stackPorts.has(i)),
        regPortIndices: [...regPorts.keys()],
        unshiftAccPortIndices: [...unshiftAccPorts.keys()],
        stackPortIndices: [...stackPorts.keys()],
        outputModes,
        inLeaves,
        outLeaves
      }
    };

    // Build wrapper proc: `demux` product inputs -> `exec @kernel` -> `mux` product outputs
    const wrapBody = [];
    let wv = 0;
    const wvar = (p) => `%w_${p}_${wv++}`;

    const emitDemuxLeaves = (srcVar, plist, nodeId, outVars) => {
      const [kind, edges] = plist[nodeId];
      if (kind === "closed-product" && edges.length > 0) {
        const subPl = subPlist(plist, nodeId);
        const dFields = [];
        const pairs = [];
        for (const [lbl, t] of edges) {
          const tPl = subPlist(plist, t);
          const v = wvar(lbl);
          wrapBody.push({ op: "chan", name: v, schema: internSchemaExpr(tPl, lbl) });
          dFields.push({ label: lbl, name: v });
          pairs.push({ v, t });
        }
        wrapBody.push({ op: "demux", src: srcVar, schema: internSchemaExpr(subPl, "wd"), fields: dFields });
        for (const pair of pairs) emitDemuxLeaves(pair.v, plist, pair.t, outVars);
        return;
      }
      outVars.push(srcVar);
    };

    const emitMuxLeaves = (plist, nodeId, leafVars, idxBox, targetVar = null) => {
      const [kind, edges] = plist[nodeId];
      if (kind === "closed-product" && edges.length > 0) {
        const subPl = subPlist(plist, nodeId);
        const mFields = edges.map(([lbl, t]) => ({
          label: lbl,
          name: emitMuxLeaves(plist, t, leafVars, idxBox, null)
        }));
        const dst = targetVar || wvar("mux");
        if (!targetVar) wrapBody.push({ op: "chan", name: dst, schema: internSchemaExpr(subPl, "wm") });
        wrapBody.push({ op: "mux", fields: mFields, dst, schema: internSchemaExpr(subPl, "wm") });
        return dst;
      }
      const v = leafVars[idxBox.i++];
      if (targetVar && v !== targetVar) {
        wrapBody.push({ op: "splice", src: v, dst: targetVar });
        return targetVar;
      }
      return v;
    };

    const flatInVars = [];
    for (let i = 0; i < proc.inputs.length; i++) {
      emitDemuxLeaves(proc.inputs[i].name, c.inPortPlists[i], 0, flatInVars);
    }

    const flatOutVars = [];
    const directOut = proc.outputs.length === 1 && Q === 1;
    if (directOut) {
      flatOutVars.push(proc.outputs[0].name);
    } else {
      for (let q = 0; q < Q; q++) {
        const v = wvar(`o${q}`);
        wrapBody.push({ op: "chan", name: v, schema: internSchemaExpr(outLeaves[q].plist, `wo${q}`) });
        flatOutVars.push(v);
      }
    }

    wrapBody.push({
      op: "exec",
      target: kName,
      inputs: flatInVars,
      outputs: flatOutVars
    });

    if (!directOut) {
      const box = { i: 0 };
      for (let i = 0; i < proc.outputs.length; i++) {
        emitMuxLeaves(c.outPortPlists[i], 0, flatOutVars, box, proc.outputs[i].name);
      }
    }

    const wrapperProc = {
      name: proc.name,
      params: [],
      inputs: cloneAst(proc.inputs),
      outputs: cloneAst(proc.outputs),
      attrs: [...(proc.attrs || [])],
      body: wrapBody
    };

    return {
      kernel,
      wrapperProc,
      fallbackProc,
      promotedRegCount: regPorts.size,
      hasVirtualStack: stackPorts.size > 0
    };
  }

  const outMod = createModule({
    version: mod.version || "0.1",
    layer: "mono",
    entry: mod.entry,
    schemas: emittedSchemas,
    procs: [...newProcs, ...helperProcs],
    kernels: emittedKernels,
    tables: cloneAst(mod.tables || [])
  });

  return { module: outMod, stats };
}
