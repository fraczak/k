/**
 * Strictly Iterative Small-Step Reference Virtual Machine for concrete `kTVM`.
 *
 * Implements DOCS/KTVM_SPEC.md §5–§7:
 *   - Explicit heap demand stack (zero host call-stack recursion)
 *   - Dual-schema `(prodSchema, consSchema)` + `aligned` enforcement
 *   - O(1) zero-copy `splice`, same-scope `MUX -> DEMUX` bundle fusion
 *   - Strict K partiality via `drain` / `barrier` / `gate`
 *   - Ordered backtracking `spec` with exact `replay` rollback, upstream-failure
 *     abort, and last-branch tail splice
 *   - Sequential sibling settlement (`after %tok` / `as %tok`)
 *   - Compiled `kernel` execution (`reg`, LIFO `BitStack`, `yield`, `handoff`,
 *     `chunk_table`, `stack_table`, `fsm_table`)
 *   - Configurable runtime quotas (`maxBitDequeBytes`, `maxNodes`, `maxSteps`)
 */

import { KTVMSchemaError, unpackInt32Base64 } from "./ast.mjs";
import { parseModule } from "./parser.mjs";
import {
  CHAN_STATUS,
  BitDeque,
  BitStack,
  QuotaTracker
} from "./bit-deque.mjs";
import {
  compileSchemaExprToPlist,
  isUnitSchema,
  mooreMinimize,
  productFields,
  schemasEquivalent,
  unionTagInfo
} from "./schema.mjs";
import {
  DPDA_RESULT,
  createDpdaCoerce,
  createDpdaCopy,
  createDpdaSkip,
  decodeDequeToValue,
  encodePayloadToDeque,
  frameEnvelopedWire,
  splitEnvelopedWire,
  stepDpdaCoerce,
  stepDpdaCopy,
  stepDpdaSkip
} from "./wire.mjs";
import { choiceWidth } from "../codecs/runtime/prefix-codec.mjs";
import { validateModule } from "./validator.mjs";
import { specializeKTVM } from "./specialize.mjs";

// --- Table Compilation Helpers ---

function applyInputCompress(rawVal, inpSpec) {
  const comp = inpSpec.compress;
  if (!comp || comp.ident === "none") return rawVal;
  if (typeof comp === "object" && Array.isArray(comp.lut)) {
    return comp.lut[rawVal] ?? 0;
  }
  if (typeof comp === "object" && typeof comp.mask === "number") {
    // Bit extraction (PEXT-style) over `raw_bits`
    let out = 0;
    let bitPos = 0;
    const mask = comp.mask >>> 0;
    for (let i = 0; i < (inpSpec.raw_bits || 32); i++) {
      if ((mask >>> i) & 1) {
        out |= ((rawVal >>> i) & 1) << bitPos;
        bitPos++;
      }
    }
    return out;
  }
  return rawVal;
}

function normalizeTableEntry(val) {
  if (!val || typeof val !== "object") return null;
  const kind = val.kind?.ident ?? val.kind;
  return {
    kind,
    next_q: val.next_q ?? 0,
    exit: val.exit ?? 0,
    shift: Array.isArray(val.shift) ? val.shift : (typeof val.shift === "number" ? [val.shift] : []),
    emit_word: Array.isArray(val.emit_word)
      ? val.emit_word
      : (typeof val.emit_word === "number" ? [val.emit_word] : []),
    emit_len: Array.isArray(val.emit_len)
      ? val.emit_len
      : (typeof val.emit_len === "number" ? [val.emit_len] : []),
    // stack_table fields
    shift_stream: val.shift_stream ?? 0,
    pop_stack: val.pop_stack ?? 0,
    push_stack_word: val.push_stack_word ?? 0,
    push_stack_len: val.push_stack_len ?? 0,
    emit_word_single: typeof val.emit_word === "number" ? val.emit_word : (Array.isArray(val.emit_word) ? (val.emit_word[0] ?? 0) : 0),
    emit_len_single: typeof val.emit_len === "number" ? val.emit_len : (Array.isArray(val.emit_len) ? (val.emit_len[0] ?? 0) : 0)
  };
}

function compileTableDecl(decl) {
  const flat = new Map();
  if (Array.isArray(decl.entries)) {
    for (const row of decl.entries) {
      flat.set(row.index, normalizeTableEntry(row.value));
    }
  } else if (decl.packedBase64 && decl.props?.stride) {
    // Compact packed Int32 format: stride words per entry
    // [kindCode (0=CONT,1=EXIT,2=NEED_MORE,3=FAIL), next_q, exit, shift0, ..., emitWord0, ..., emitLen0, ...]
    const arr = unpackInt32Base64(decl.packedBase64);
    const stride = decl.props.stride;
    const nIn = (decl.props.inputs || []).length || 1;
    const nOut = (decl.props.outputs || []).length || 1;
    const kindNames = ["CONT", "EXIT", "NEED_MORE", "FAIL"];
    const count = Math.floor(arr.length / stride);
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const kCode = arr[base];
      const nextQ = arr[base + 1];
      const exit = arr[base + 2];
      const shift = [];
      for (let p = 0; p < nIn; p++) shift.push(arr[base + 3 + p]);
      const emit_word = [];
      for (let o = 0; o < nOut; o++) emit_word.push(arr[base + 3 + nIn + o] >>> 0);
      const emit_len = [];
      for (let o = 0; o < nOut; o++) emit_len.push(arr[base + 3 + nIn + nOut + o]);
      flat.set(i, {
        kind: kindNames[kCode] || "FAIL",
        next_q: nextQ,
        exit,
        shift,
        emit_word,
        emit_len
      });
    }
  }
  return { decl, flat };
}

// --- Runtime Engine ---

export class KTVMRuntime {
  constructor(mod, { quota = null } = {}) {
    if (mod.layer !== "mono") {
      throw new KTVMSchemaError("KTVMRuntime only executes concrete 'mono' modules; specialize first");
    }
    this.mod = mod;
    this.quota = quota instanceof QuotaTracker ? quota : new QuotaTracker(quota || {});

    this.schemaMap = new Map((mod.schemas || []).map((s) => [s.name, s]));
    this.procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
    this.kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
    this.tableMap = new Map((mod.tables || []).map((t) => [t.name, compileTableDecl(t)]));
    this.plistCache = new Map();

    this.nextNodeId = 1;
    this.nextChanId = 1;
    this.nextBarrierId = 1;
    this.nextScopeId = 1;

    this.scopes = new Map();
    this._createScope(0, null);

    this.telemetry = {
      steps: 0,
      peakActiveNodes: 0,
      peakBitDequeBytes: 0,
      splices: 0,
      spliceBitsCopied: 0,
      muxDemuxFusions: 0,
      tableLookups: 0,
      specRollbacks: 0,
      specUpstreamAborts: 0,
      specTailSplices: 0,
      afterSettlements: 0
    };
  }

  resolvePlist(schemaExpr) {
    const key = JSON.stringify(schemaExpr);
    let pl = this.plistCache.get(key);
    if (!pl) {
      pl = mooreMinimize(compileSchemaExprToPlist(schemaExpr, this.schemaMap, { allowOpen: false }), 0).plist;
      this.plistCache.set(key, pl);
    }
    return pl;
  }

  _createScope(scopeId, parentId) {
    this.scopes.set(scopeId, {
      id: scopeId,
      parent: parentId,
      nodes: new Set(),
      chans: new Set(),
      barriers: new Set(),
      children: new Set()
    });
    if (parentId !== null && this.scopes.has(parentId)) {
      this.scopes.get(parentId).children.add(scopeId);
    }
  }

  _allocChan(scopeId, plist, name = "") {
    const id = this.nextChanId++;
    const ch = new BitDeque(id, {
      name: name || `%c${id}`,
      prodSchema: plist,
      prodNodeId: 0,
      consSchema: plist,
      consNodeId: 0,
      aligned: true,
      scope: scopeId,
      quota: this.quota
    });
    const sc = this.scopes.get(scopeId);
    if (sc) sc.chans.add(ch);
    return ch;
  }

  _allocBarrier(scopeId, name = "") {
    const b = {
      id: this.nextBarrierId++,
      name,
      scope: scopeId,
      guards: new Set(),
      status: "PENDING" // PENDING | PASSED | FAILED
    };
    const sc = this.scopes.get(scopeId);
    if (sc) sc.barriers.add(b);
    return b;
  }

  _allocNode(scopeId, kind, props) {
    this.quota.addNode();
    const node = {
      id: this.nextNodeId++,
      kind,
      scope: scopeId,
      retired: false,
      inputs: [],
      outputs: [],
      ...props
    };
    const sc = this.scopes.get(scopeId);
    if (sc) sc.nodes.add(node);
    for (const ch of node.inputs) {
      if (ch) ch.cons = node;
    }
    for (const ch of node.outputs) {
      if (ch) ch.prod = node;
    }
    return node;
  }

  _retireNode(node) {
    if (!node || node.retired) return;
    node.retired = true;
    this.quota.removeNode();
    const sc = this.scopes.get(node.scope);
    if (sc) sc.nodes.delete(node);
    // Clean up any kernel-local BitStacks
    if (node.stacks) {
      for (const st of node.stacks.values()) st.release();
      node.stacks.clear();
    }
    for (const ch of node.inputs) {
      if (ch && ch.cons === node) ch.cons = null;
    }
    for (const ch of node.outputs) {
      if (ch && ch.prod === node) ch.prod = null;
    }
  }

  _rebindOutput(prodNode, oldCh, newCh) {
    if (!prodNode) return;
    for (let i = 0; i < prodNode.outputs.length; i++) {
      if (prodNode.outputs[i] === oldCh) prodNode.outputs[i] = newCh;
    }
    if (prodNode.portMap) {
      for (const [k, v] of prodNode.portMap.entries()) {
        if (v === oldCh) prodNode.portMap.set(k, newCh);
      }
    }
    if (prodNode.env) {
      for (const [k, v] of prodNode.env.entries()) {
        if (v === oldCh) prodNode.env.set(k, newCh);
      }
    }
    if (prodNode.activeChild) {
      for (const st of prodNode.activeChild.staged) {
        if (st.parentOut === oldCh) st.parentOut = newCh;
      }
    }
  }

  _cancelInput(ch) {
    if (!ch) return;
    ch.cons = null;
    // Note: if upstream producer belongs to an inner chain with no other consumers,
    // releasing unread bits immediately frees quota.
    if (!ch.isOpen) {
      ch.release();
    }
  }

  /**
   * Section 3.3 O(1) Zero-Copy Channel Splice: `splice(src -> dst)`.
   */
  _splice(src, dst) {
    if (src === dst) return;
    this.telemetry.splices += 1;

    if (src.isFailed) {
      dst.fail();
      src.prod = null;
      src.cons = null;
      src.release();
      return;
    }

    if (!src.aligned) {
      throw new Error(`kTVM invariant violation: splice on unaligned source channel ${src.name}`);
    }
    if (!schemasEquivalent(src.consSchema, src.consNodeId, dst.prodSchema, dst.prodNodeId)) {
      throw new Error(`kTVM invariant violation: splice schema mismatch (${src.name} -> ${dst.name})`);
    }

    let copied = 0;
    if (dst.length === 0) {
      dst.adoptBufferFrom(src);
    } else if (src.length === 0) {
      // Nothing to move from src
    } else if (dst.length <= src.length) {
      copied = src.unshiftFromDeque(dst);
      dst.adoptBufferFrom(src);
    } else {
      copied = dst.pushFromDeque(src);
    }
    this.telemetry.spliceBitsCopied += copied;

    // Transfer upstream producer obligation & status to `dst` while preserving `dst`'s consumer view
    dst.prodSchema = src.prodSchema;
    dst.prodNodeId = src.prodNodeId;
    dst.status = src.status;
    dst.prod = src.prod;

    if (src.prod) {
      this._rebindOutput(src.prod, src, dst);
    }

    src.prod = null;
    src.cons = null;
    src.release();
  }

  _destroyScope(scopeId) {
    const sc = this.scopes.get(scopeId);
    if (!sc) return;
    // Destroy child scopes first (explicit iterative stack)
    const stack = [scopeId];
    const order = [];
    while (stack.length > 0) {
      const id = stack.pop();
      const s = this.scopes.get(id);
      if (!s) continue;
      order.push(s);
      for (const cid of s.children) stack.push(cid);
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i];
      for (const n of [...s.nodes]) {
        if (n.kind === "spec" && n.activeChild) {
          for (const t of n.activeChild.taps) t.replay.release();
        }
        this._retireNode(n);
      }
      for (const ch of [...s.chans]) {
        ch.prod = null;
        ch.cons = null;
        ch.release();
      }
      s.chans.clear();
      s.barriers.clear();
      if (s.parent !== null && this.scopes.has(s.parent)) {
        this.scopes.get(s.parent).children.delete(s.id);
      }
      this.scopes.delete(s.id);
    }
  }

  // --- Network Instantiation ---

  _instantiateBlock(stmts, scopeId, outerEnv, outerBarriers = new Map(), outerTokens = new Map()) {
    const env = new Map(outerEnv);
    const barriers = new Map(outerBarriers);
    const tokens = new Map(outerTokens);

    // Track which channels in this block are consumed/produced before a `switch`
    const consumedVars = new Set();
    const producedVars = new Set();

    const markC = (v) => consumedVars.add(v);
    const markP = (v) => producedVars.add(v);

    for (const s of stmts) {
      switch (s.op) {
        case "chan": {
          const pl = this.resolvePlist(s.schema);
          env.set(s.name, this._allocChan(scopeId, pl, s.name));
          break;
        }
        case "barrier": {
          barriers.set(s.name, this._allocBarrier(scopeId, s.name));
          break;
        }
        case "drain": {
          const src = env.get(s.src);
          const pl = this.resolvePlist(s.schema);
          const bar = s.barrier ? barriers.get(s.barrier) : null;
          markC(s.src);
          const node = this._allocNode(scopeId, "drain", {
            inputs: [src],
            outputs: [],
            schema: pl,
            barrier: bar,
            dpda: createDpdaSkip(pl, 0),
            dpdaDone: false
          });
          if (bar) bar.guards.add(node);
          break;
        }
        case "gate": {
          const bar = barriers.get(s.barrier);
          const src = env.get(s.src);
          const dst = env.get(s.dst);
          markC(s.src);
          markP(s.dst);
          this._allocNode(scopeId, "gate", {
            inputs: [src],
            outputs: [dst],
            barrier: bar
          });
          break;
        }
        case "splice": {
          const src = env.get(s.src);
          const dst = env.get(s.dst);
          markC(s.src);
          markP(s.dst);
          this._allocNode(scopeId, "splice", {
            inputs: [src],
            outputs: [dst]
          });
          break;
        }
        case "coerce": {
          const src = env.get(s.src);
          const dst = env.get(s.dst);
          const sPl = this.resolvePlist(s.srcSchema);
          const dPl = this.resolvePlist(s.dstSchema);
          markC(s.src);
          markP(s.dst);
          this._allocNode(scopeId, "coerce", {
            inputs: [src],
            outputs: [dst],
            srcSchema: sPl,
            dstSchema: dPl,
            dpda: null
          });
          break;
        }
        case "const_unit": {
          const dst = env.get(s.dst);
          markP(s.dst);
          this._allocNode(scopeId, "const_unit", {
            inputs: [],
            outputs: [dst]
          });
          break;
        }
        case "tee": {
          const src = env.get(s.src);
          const dsts = s.dsts.map((v) => env.get(v));
          markC(s.src);
          for (const v of s.dsts) markP(v);
          this._allocNode(scopeId, "tee", {
            inputs: [src],
            outputs: dsts
          });
          break;
        }
        case "wrap": {
          const src = env.get(s.src);
          const dst = env.get(s.dst);
          markC(s.src);
          markP(s.dst);
          this._allocNode(scopeId, "wrap", {
            inputs: [src],
            outputs: [dst],
            tag: s.tag
          });
          break;
        }
        case "match": {
          const src = env.get(s.src);
          const dst = env.get(s.dst);
          markC(s.src);
          markP(s.dst);
          this._allocNode(scopeId, "match", {
            inputs: [src],
            outputs: [dst],
            tag: s.tag
          });
          break;
        }
        case "demux": {
          const src = env.get(s.src);
          const pl = this.resolvePlist(s.schema);
          const pf = productFields(pl, 0);
          const byLabel = new Map(s.fields.map((f) => [f.label, env.get(f.name)]));
          const orderedOuts = pf.map((f) => byLabel.get(f.label));
          markC(s.src);
          for (const f of s.fields) markP(f.name);
          this._allocNode(scopeId, "demux", {
            inputs: [src],
            outputs: orderedOuts,
            schema: pl,
            fields: pf,
            fieldIdx: 0,
            dpda: null
          });
          break;
        }
        case "mux": {
          const dst = env.get(s.dst);
          const pl = this.resolvePlist(s.schema);
          const pf = productFields(pl, 0);
          const byLabel = new Map(s.fields.map((f) => [f.label, env.get(f.name)]));
          const orderedIns = pf.map((f) => byLabel.get(f.label));
          for (const f of s.fields) markC(f.name);
          markP(s.dst);
          this._allocNode(scopeId, "mux", {
            inputs: orderedIns,
            outputs: [dst],
            schema: pl,
            fields: pf,
            fieldIdx: 0
          });
          break;
        }
        case "spawn": {
          const ins = s.inputs.map((v) => env.get(v));
          const outs = s.outputs.map((v) => env.get(v));
          for (const v of s.inputs) markC(v);
          for (const v of s.outputs) markP(v);
          const afterToken = s.after ? tokens.get(s.after) : null;
          const node = this._allocNode(scopeId, "spawn", {
            inputs: ins,
            outputs: outs,
            target: s.target,
            afterToken
          });
          if (s.token) {
            tokens.set(s.token, { outputs: [...outs], settled: false, originNode: node });
          }
          break;
        }
        case "exec": {
          const ins = s.inputs.map((v) => env.get(v));
          const outs = s.outputs.map((v) => env.get(v));
          for (const v of s.inputs) markC(v);
          for (const v of s.outputs) markP(v);
          this._instantiateKernel(s.target, scopeId, ins, outs);
          break;
        }
        case "switch": {
          // Capture all remaining unconsumed/unproduced channels in `env`!
          const remIn = [];
          const remOut = [];
          for (const [v, ch] of env.entries()) {
            if (!consumedVars.has(v) && ch.cons === null) remIn.push(ch);
            if (!producedVars.has(v) && ch.prod === null) remOut.push(ch);
          }
          const inspectChans = s.inputs.map((v) => env.get(v));
          this._allocNode(scopeId, "switch", {
            inputs: remIn,
            outputs: remOut,
            inspectVars: s.inputs,
            inspectChans,
            arms: s.arms,
            defaultBody: s.defaultBody,
            env: new Map(env),
            barriers: new Map(barriers),
            tokens: new Map(tokens)
          });
          break;
        }
        case "spec": {
          const ins = s.inputs.map((v) => env.get(v));
          const outs = s.outputs.map((v) => env.get(v));
          for (const v of s.inputs) markC(v);
          for (const v of s.outputs) markP(v);
          this._allocNode(scopeId, "spec", {
            inputs: ins,
            outputs: outs,
            inVars: s.inputs,
            outVars: s.outputs,
            branches: s.branches,
            branchIdx: 0,
            activeChild: null
          });
          break;
        }
        default:
          throw new Error(`Unsupported runtime instruction '${s.op}' in mono kTVM`);
      }
    }
  }

  _instantiateKernel(kernelName, scopeId, ins, outs) {
    const kDecl = this.kernelMap.get(kernelName);
    if (!kDecl) throw new Error(`Unknown kernel '${kernelName}'`);
    const portMap = new Map();
    const ownedInputs = new Set();
    const ownedOutputs = new Set();
    for (let i = 0; i < kDecl.inputs.length; i++) {
      portMap.set(kDecl.inputs[i].name, ins[i]);
      ownedInputs.add(kDecl.inputs[i].name);
    }
    for (let i = 0; i < kDecl.outputs.length; i++) {
      portMap.set(kDecl.outputs[i].name, outs[i]);
      ownedOutputs.add(kDecl.outputs[i].name);
    }
    const regs = new Map((kDecl.regs || []).map((r) => [r.name, r.init ?? 0]));
    const stacks = new Map((kDecl.stacks || []).map((s) => [s.name, new BitStack(this.quota)]));
    const blockMap = new Map(kDecl.blocks.map((b) => [b.label, b]));

    return this._allocNode(scopeId, "kernel", {
      inputs: [...ins],
      outputs: [...outs],
      kernelDecl: kDecl,
      blockMap,
      pc: "entry",
      stmtIdx: 0,
      regs,
      stacks,
      temps: new Map(),
      portMap,
      ownedInputs,
      ownedOutputs,
      pendingDpda: null,
      yieldThreshold: 64
    });
  }

  // --- Small-Step Node Transitions ---

  _stepNode(node) {
    this.quota.tickStep();
    this.telemetry.steps = this.quota.steps;

    switch (node.kind) {
      case "const_unit":
        return this._stepConstUnit(node);
      case "splice":
        return this._stepSplice(node);
      case "coerce":
        return this._stepCoerce(node);
      case "wrap":
        return this._stepWrap(node);
      case "match":
        return this._stepMatch(node);
      case "demux":
        return this._stepDemux(node);
      case "mux":
        return this._stepMux(node);
      case "tee":
        return this._stepTee(node);
      case "drain":
        return this._stepDrain(node);
      case "gate":
        return this._stepGate(node);
      case "switch":
        return this._stepSwitch(node);
      case "spec":
        return this._stepSpec(node);
      case "tap":
        return this._stepTap(node);
      case "spawn":
        return this._stepSpawn(node);
      case "kernel":
        return this._stepKernel(node);
      default:
        throw new Error(`Unknown node kind '${node.kind}'`);
    }
  }

  _stepConstUnit(node) {
    const out = node.outputs[0];
    this._retireNode(node);
    out.close();
    return null;
  }

  _stepSplice(node) {
    const src = node.inputs[0];
    const dst = node.outputs[0];
    this._retireNode(node);
    this._splice(src, dst);
    return null;
  }

  _stepCoerce(node) {
    const src = node.inputs[0];
    const dst = node.outputs[0];
    if (!node.dpda) {
      if (src.aligned && schemasEquivalent(src.consSchema, src.consNodeId, dst.prodSchema, dst.prodNodeId)) {
        this._retireNode(node);
        this._splice(src, dst);
        return null;
      }
      node.dpda = createDpdaCoerce(src.consSchema, src.consNodeId, dst.prodSchema, dst.prodNodeId);
    }
    const res = stepDpdaCoerce(src, dst, node.dpda);
    if (res === DPDA_RESULT.NEED_BITS) {
      if (src.isOpen) return { needPull: src };
      this._retireNode(node);
      dst.fail();
      this._cancelInput(src);
      return null;
    }
    if (res === DPDA_RESULT.FAILED) {
      this._retireNode(node);
      dst.fail();
      this._cancelInput(src);
      return null;
    }
    // DONE: ensure src settles cleanly (CLOSED, 0 leftover bits)
    if (src.isOpen) return { needPull: src };
    if (src.isFailed || src.length > 0) {
      this._retireNode(node);
      dst.fail();
      this._cancelInput(src);
      return null;
    }
    this._retireNode(node);
    src.release();
    dst.close();
    return null;
  }

  _stepWrap(node) {
    const src = node.inputs[0];
    const dst = node.outputs[0];
    const info = unionTagInfo(dst.prodSchema, dst.prodNodeId, node.tag);
    if (!info) {
      this._retireNode(node);
      dst.fail();
      this._cancelInput(src);
      return null;
    }
    if (info.width > 0) {
      dst.pushBits(info.ordinal, info.width);
    }
    dst.prodNodeId = info.targetId;

    if (src.aligned && schemasEquivalent(src.consSchema, src.consNodeId, dst.prodSchema, dst.prodNodeId)) {
      this._retireNode(node);
      this._splice(src, dst);
      return null;
    }
    // Degrade in-place to `coerce`
    node.kind = "coerce";
    node.dpda = null;
    return null;
  }

  _stepMatch(node) {
    const src = node.inputs[0];
    const dst = node.outputs[0];
    const info = unionTagInfo(src.consSchema, src.consNodeId, node.tag);
    if (!info) {
      this._retireNode(node);
      dst.fail();
      this._cancelInput(src);
      return null;
    }
    if (info.width > 0) {
      if (src.length < info.width) {
        if (src.isOpen) return { needPull: src };
        this._retireNode(node);
        dst.fail();
        this._cancelInput(src);
        return null;
      }
      const ord = src.peekBits(info.width);
      if (ord !== info.ordinal) {
        this._retireNode(node);
        dst.fail();
        this._cancelInput(src);
        return null;
      }
      src.shiftBits(info.width);
    }
    src.consNodeId = info.targetId;
    src.aligned = true;

    if (schemasEquivalent(src.consSchema, src.consNodeId, dst.prodSchema, dst.prodNodeId)) {
      this._retireNode(node);
      this._splice(src, dst);
      return null;
    }
    node.kind = "coerce";
    node.dpda = null;
    return null;
  }

  _stepDemux(node) {
    const src = node.inputs[0];
    const outs = node.outputs;
    const fields = node.fields;

    // Same-scope MUX -> DEMUX O(1) bundle fusion!
    if (
      node.fieldIdx === 0 &&
      (outs.length === 0 || outs[0].length === 0) &&
      src.length === 0 &&
      src.aligned &&
      src.prod &&
      src.prod.kind === "mux" &&
      src.prod.scope === node.scope &&
      src.prod.fieldIdx === 0 &&
      schemasEquivalent(src.consSchema, src.consNodeId, src.prod.schema, 0)
    ) {
      const muxNode = src.prod;
      const muxIns = [...muxNode.inputs];
      const demuxOuts = [...outs];
      this._retireNode(muxNode);
      this._retireNode(node);
      src.prod = null;
      src.cons = null;
      src.release();
      for (let i = 0; i < demuxOuts.length; i++) {
        this._splice(muxIns[i], demuxOuts[i]);
      }
      this.telemetry.muxDemuxFusions += 1;
      return null;
    }

    if (fields.length === 0) {
      if (src.isOpen) return { needPull: src };
      this._retireNode(node);
      src.release();
      return null;
    }

    if (fields.length === 1) {
      src.consSchema = node.schema;
      src.consNodeId = fields[0].targetId;
      src.aligned = true;
      const dst0 = outs[0];
      this._retireNode(node);
      this._splice(src, dst0);
      return null;
    }

    // Stream fields 0 .. m-2 with DPDA copy, then zero-copy splice final field m-1!
    while (node.fieldIdx < fields.length - 1) {
      const i = node.fieldIdx;
      const dst = outs[i];
      if (!node.dpda) {
        node.dpda = createDpdaCopy(node.schema, fields[i].targetId);
      }
      const res = stepDpdaCopy(src, dst, node.dpda);
      if (res === DPDA_RESULT.NEED_BITS) {
        if (src.isOpen) return { needPull: src };
        this._failRemainingDemux(node, i);
        return null;
      }
      if (res === DPDA_RESULT.FAILED) {
        this._failRemainingDemux(node, i);
        return null;
      }
      // Field i complete!
      dst.close();
      node.dpda = null;
      node.fieldIdx += 1;
    }

    // Final field m-1: `src` now sits at exact aligned boundary of fields[m-1]!
    const lastIdx = fields.length - 1;
    src.consSchema = node.schema;
    src.consNodeId = fields[lastIdx].targetId;
    src.aligned = true;
    const lastDst = outs[lastIdx];
    this._retireNode(node);
    this._splice(src, lastDst);
    return null;
  }

  _failRemainingDemux(node, fromIdx) {
    const src = node.inputs[0];
    const outs = [...node.outputs];
    this._retireNode(node);
    for (let j = fromIdx; j < outs.length; j++) {
      outs[j].fail();
    }
    this._cancelInput(src);
  }

  _stepMux(node) {
    const ins = node.inputs;
    const dst = node.outputs[0];
    const fields = node.fields;

    // Symmetric same-scope MUX -> DEMUX O(1) bundle fusion!
    if (
      node.fieldIdx === 0 &&
      dst.length === 0 &&
      dst.aligned &&
      dst.cons &&
      dst.cons.kind === "demux" &&
      dst.cons.scope === node.scope &&
      dst.cons.fieldIdx === 0 &&
      (dst.cons.outputs.length === 0 || dst.cons.outputs[0].length === 0) &&
      schemasEquivalent(dst.consSchema, dst.consNodeId, node.schema, 0) &&
      schemasEquivalent(dst.cons.schema, 0, node.schema, 0)
    ) {
      const demuxNode = dst.cons;
      const muxIns = [...ins];
      const demuxOuts = [...demuxNode.outputs];
      this._retireNode(node);
      this._retireNode(demuxNode);
      dst.prod = null;
      dst.cons = null;
      dst.release();
      for (let i = 0; i < demuxOuts.length; i++) {
        this._splice(muxIns[i], demuxOuts[i]);
      }
      this.telemetry.muxDemuxFusions += 1;
      return null;
    }

    if (fields.length === 0) {
      this._retireNode(node);
      dst.close();
      return null;
    }

    if (fields.length === 1) {
      const in0 = ins[0];
      dst.prodSchema = node.schema;
      dst.prodNodeId = fields[0].targetId;
      this._retireNode(node);
      this._splice(in0, dst);
      return null;
    }

    // Stream fields 0 .. m-2, then O(1) tail-splice final field m-1!
    while (node.fieldIdx < fields.length - 1) {
      const i = node.fieldIdx;
      const src = ins[i];
      if (src.length > 0) {
        dst.pushFromDeque(src);
      }
      if (src.isFailed) {
        this._retireNode(node);
        dst.fail();
        for (let j = i; j < ins.length; j++) this._cancelInput(ins[j]);
        return null;
      }
      if (src.isOpen) {
        return { needPull: src };
      }
      // src is CLOSED and empty
      src.cons = null;
      src.release();
      node.fieldIdx += 1;
    }

    // Final field m-1: narrow prodSchema and execute O(1) tail-splice!
    const lastIdx = fields.length - 1;
    const lastSrc = ins[lastIdx];
    dst.prodSchema = node.schema;
    dst.prodNodeId = fields[lastIdx].targetId;
    this._retireNode(node);
    this._splice(lastSrc, dst);
    return null;
  }

  _stepTee(node) {
    const src = node.inputs[0];
    const liveOuts = node.outputs.filter((o) => o && o.isOpen);

    if (liveOuts.length === 0) {
      this._retireNode(node);
      this._cancelInput(src);
      return null;
    }

    // Single-survivor splice degradation
    if (
      liveOuts.length === 1 &&
      src.aligned &&
      schemasEquivalent(src.consSchema, src.consNodeId, liveOuts[0].prodSchema, liveOuts[0].prodNodeId)
    ) {
      const only = liveOuts[0];
      this._retireNode(node);
      this._splice(src, only);
      return null;
    }

    if (src.length > 0) {
      const chunk = src.length > 30 ? 30 : src.length;
      const bits = src.shiftBits(chunk);
      for (const o of liveOuts) o.pushBits(bits, chunk);
      // After transferring bits, if src still has bits we can transfer up to 256 bits per step
      let burst = chunk;
      while (src.length > 0 && burst < 256) {
        const c = src.length > 30 ? 30 : src.length;
        const b = src.shiftBits(c);
        for (const o of liveOuts) o.pushBits(b, c);
        burst += c;
      }
      return null;
    }

    if (src.isOpen) {
      return { needPull: src };
    }
    if (src.isClosed) {
      this._retireNode(node);
      src.release();
      for (const o of liveOuts) o.close();
      return null;
    }
    // src.isFailed
    this._retireNode(node);
    src.release();
    for (const o of liveOuts) o.fail();
    return null;
  }

  _stepDrain(node) {
    const src = node.inputs[0];
    const bar = node.barrier;

    if (!node.dpdaDone) {
      const res = stepDpdaSkip(src, node.dpda);
      if (res === DPDA_RESULT.NEED_BITS) {
        if (src.isOpen) return { needPull: src };
        this._failBarrierDrain(node);
        return null;
      }
      if (res === DPDA_RESULT.FAILED) {
        this._failBarrierDrain(node);
        return null;
      }
      node.dpdaDone = true;
    }

    // Verify source reaches CLOSED cleanly (catches failed unit producers!)
    if (src.isOpen) return { needPull: src };
    if (src.isFailed || src.length > 0) {
      this._failBarrierDrain(node);
      return null;
    }

    this._retireNode(node);
    src.release();
    if (bar) {
      bar.guards.delete(node);
      if (bar.status === "PENDING" && bar.guards.size === 0) {
        bar.status = "PASSED";
      }
    }
    return null;
  }

  _failBarrierDrain(node) {
    const src = node.inputs[0];
    const bar = node.barrier;
    this._retireNode(node);
    this._cancelInput(src);
    if (bar) {
      bar.guards.delete(node);
      bar.status = "FAILED";
    }
  }

  _stepGate(node) {
    const bar = node.barrier;
    const src = node.inputs[0];
    const dst = node.outputs[0];

    if (bar.status === "PENDING") {
      if (bar.guards.size === 0) {
        bar.status = "PASSED";
      } else {
        // Drive first pending guard drain directly!
        const nextGuard = bar.guards.values().next().value;
        return { needStepNode: nextGuard };
      }
    }

    if (bar.status === "PASSED") {
      this._retireNode(node);
      this._splice(src, dst);
      return null;
    }

    // bar.status === "FAILED"
    this._retireNode(node);
    dst.fail();
    this._cancelInput(src);
    return null;
  }

  _stepSwitch(node) {
    const inspectChans = node.inspectChans;
    const tags = new Array(inspectChans.length).fill(null);

    // Determine which positions are actually tested by any arm
    const tested = new Uint8Array(inspectChans.length);
    for (const arm of node.arms) {
      for (let j = 0; j < arm.patterns.length; j++) {
        if (arm.patterns[j].kind === "tag") tested[j] = 1;
      }
    }

    for (let j = 0; j < inspectChans.length; j++) {
      if (!tested[j]) continue;
      const ch = inspectChans[j];
      const [kind, edges] = ch.consSchema[ch.consNodeId];
      if (kind !== "closed-union" || edges.length === 0) {
        return this._failSwitch(node);
      }
      const w = choiceWidth(edges.length);
      let ord = 0;
      if (w > 0) {
        if (ch.length < w) {
          if (ch.isOpen) return { needPull: ch };
          return this._failSwitch(node);
        }
        ord = ch.peekBits(w);
      }
      if (ord >= edges.length) {
        return this._failSwitch(node);
      }
      tags[j] = edges[ord][0];
    }

    // Match first matching arm (patterns are prefix-disjoint)
    let chosenBody = null;
    for (const arm of node.arms) {
      let ok = true;
      for (let j = 0; j < arm.patterns.length; j++) {
        const p = arm.patterns[j];
        if (p.kind === "tag" && tags[j] !== p.tag) {
          ok = false;
          break;
        }
      }
      if (ok) {
        chosenBody = arm.body;
        break;
      }
    }
    if (!chosenBody) chosenBody = node.defaultBody;
    if (!chosenBody) return this._failSwitch(node);

    const { scope, env, barriers, tokens } = node;
    this._retireNode(node);
    this._instantiateBlock(chosenBody, scope, env, barriers, tokens);
    return null;
  }

  _failSwitch(node) {
    const outs = [...node.outputs];
    const ins = [...node.inputs];
    this._retireNode(node);
    for (const o of outs) o.fail();
    for (const i of ins) this._cancelInput(i);
    return null;
  }

  _stepTap(node) {
    const parentCh = node.parentCh;
    const childCh = node.outputs[0];
    const replay = node.replay;

    if (parentCh.length > 0) {
      const chunk = parentCh.length > 30 ? 30 : parentCh.length;
      const bits = parentCh.shiftBits(chunk);
      replay.pushBits(bits, chunk);
      childCh.pushBits(bits, chunk);
      return null;
    }
    if (parentCh.isOpen) {
      return { needPull: parentCh };
    }
    if (parentCh.isClosed) {
      this._retireNode(node);
      childCh.close();
      return null;
    }
    // parentCh.isFailed
    node.sawUpstreamFailure = true;
    this._retireNode(node);
    childCh.fail();
    return null;
  }

  _stepSpec(node) {
    const branches = node.branches;
    const parentIns = node.inputs;
    const parentOuts = node.outputs;

    // Empty choice -> fail immediately
    if (branches.length === 0) {
      this._retireNode(node);
      for (const o of parentOuts) o.fail();
      for (const i of parentIns) this._cancelInput(i);
      return null;
    }

    // Immediate upstream failure check
    for (const pIn of parentIns) {
      if (pIn.isFailed) {
        this.telemetry.specUpstreamAborts += 1;
        if (node.activeChild) this._destroyScope(node.activeChild.scopeId);
        this._retireNode(node);
        for (const o of parentOuts) o.fail();
        return null;
      }
    }

    if (!node.activeChild) {
      // Rule 3: Last-branch tail splice!
      if (node.branchIdx === branches.length - 1) {
        this.telemetry.specTailSplices += 1;
        const br = branches[node.branchIdx];
        const scope = node.scope;
        const env = new Map();
        for (let i = 0; i < node.inVars.length; i++) env.set(node.inVars[i], parentIns[i]);
        for (let i = 0; i < node.outVars.length; i++) env.set(node.outVars[i], parentOuts[i]);
        this._retireNode(node);
        this._instantiateBlock(br.body, scope, env);
        return null;
      }

      // Speculative branch i < k - 1: create child scope + TAPs + staging outputs
      const childScopeId = this.nextScopeId++;
      this._createScope(childScopeId, node.scope);

      const taps = [];
      const env = new Map();
      for (let i = 0; i < parentIns.length; i++) {
        const pIn = parentIns[i];
        const replay = new BitDeque(this.nextChanId++, {
          name: `%replay_${pIn.name}`,
          prodSchema: pIn.consSchema,
          prodNodeId: pIn.consNodeId,
          consSchema: pIn.consSchema,
          consNodeId: pIn.consNodeId,
          scope: childScopeId,
          quota: this.quota
        });
        const childIn = new BitDeque(this.nextChanId++, {
          name: `%tap_${pIn.name}`,
          prodSchema: pIn.consSchema,
          prodNodeId: pIn.consNodeId,
          consSchema: pIn.consSchema,
          consNodeId: pIn.consNodeId,
          aligned: pIn.aligned,
          scope: childScopeId,
          quota: this.quota
        });
        this.scopes.get(childScopeId).chans.add(childIn);
        const tapNode = this._allocNode(childScopeId, "tap", {
          inputs: [],
          outputs: [childIn],
          parentCh: pIn,
          replay,
          sawUpstreamFailure: false
        });
        pIn.cons = tapNode;
        taps.push({ parentCh: pIn, childCh: childIn, replay, tapNode });
        env.set(node.inVars[i], childIn);
      }

      const staged = [];
      for (let i = 0; i < parentOuts.length; i++) {
        const pOut = parentOuts[i];
        const childOut = new BitDeque(this.nextChanId++, {
          name: `%stage_${pOut.name}`,
          prodSchema: pOut.prodSchema,
          prodNodeId: pOut.prodNodeId,
          consSchema: pOut.prodSchema,
          consNodeId: pOut.prodNodeId,
          aligned: true,
          scope: childScopeId,
          quota: this.quota
        });
        this.scopes.get(childScopeId).chans.add(childOut);
        staged.push({ childOut, parentOut: pOut });
        env.set(node.outVars[i], childOut);
      }

      this._instantiateBlock(branches[node.branchIdx].body, childScopeId, env);
      node.activeChild = { scopeId: childScopeId, taps, staged };
    }

    const { scopeId, taps, staged } = node.activeChild;

    // Check failure of any staging output
    const anyFailed = staged.some((st) => st.childOut.isFailed);
    if (anyFailed) {
      const upstreamFailed = taps.some((t) => t.parentCh.isFailed || t.tapNode.sawUpstreamFailure);
      if (upstreamFailed) {
        // Rule 1 (Upstream Failure Abort): fail outputs immediately, DO NOT try branch i+1!
        this.telemetry.specUpstreamAborts += 1;
        for (const t of taps) {
          if (t.parentCh.cons === t.tapNode) t.parentCh.cons = null;
          t.replay.release();
        }
        node.activeChild = null;
        this._destroyScope(scopeId);
        this._retireNode(node);
        for (const o of parentOuts) o.fail();
        return null;
      }

      // Local mismatch rollback: destroy child scope, restore parent inputs bit-for-bit!
      this.telemetry.specRollbacks += 1;
      for (const t of taps) {
        if (t.parentCh.cons === t.tapNode) t.parentCh.cons = node;
      }
      node.activeChild = null;
      this._destroyScope(scopeId);
      for (const t of taps) {
        t.parentCh.unshiftFromDeque(t.replay);
        t.replay.release();
      }
      node.branchIdx += 1;
      return null;
    }

    // Check commit (all staging outputs CLOSED)
    const allClosed = staged.every((st) => st.childOut.isClosed);
    if (allClosed) {
      for (const t of taps) {
        // If branch left unread tapped bits, return them to parentCh
        if (t.childCh.length > 0) {
          t.parentCh.unshiftFromDeque(t.childCh);
        }
        if (t.parentCh.cons === t.tapNode) t.parentCh.cons = null;
        t.replay.release();
      }
      // Splice staged outputs to parent outputs BEFORE destroying child scope!
      const splicePairs = staged.map((st) => ({ src: st.childOut, dst: st.parentOut }));
      const childSc = this.scopes.get(scopeId);
      for (const p of splicePairs) {
        if (childSc) childSc.chans.delete(p.src);
      }
      node.activeChild = null;
      this._retireNode(node);
      for (const p of splicePairs) {
        this._splice(p.src, p.dst);
      }
      this._destroyScope(scopeId);
      return null;
    }

    // Drive first still-OPEN staging output!
    const nextOpen = staged.find((st) => st.childOut.isOpen);
    return { needPull: nextOpen.childOut };
  }

  _stepSpawn(node) {
    // Pre-expansion sequential sibling settlement (`after %tok`)!
    if (node.afterToken && !node.afterToken.settled) {
      const pendingOut = node.afterToken.outputs.find((ch) => ch.isOpen);
      if (pendingOut) {
        return { needPull: pendingOut };
      }
      node.afterToken.settled = true;
      this.telemetry.afterSettlements += 1;
    }

    const proc = this.procMap.get(node.target);
    if (!proc) throw new Error(`Unknown proc '${node.target}'`);

    const env = new Map();
    for (let i = 0; i < proc.inputs.length; i++) env.set(proc.inputs[i].name, node.inputs[i]);
    for (let i = 0; i < proc.outputs.length; i++) env.set(proc.outputs[i].name, node.outputs[i]);

    const scope = node.scope;
    this._retireNode(node);
    this._instantiateBlock(proc.body, scope, env);
    return null;
  }

  // --- Compiled Kernel Execution ---

  _stepKernel(node) {
    const blk = node.blockMap.get(node.pc);
    if (!blk) throw new Error(`Kernel ${node.kernelDecl.name}: missing block '${node.pc}'`);

    // Execute statements in current basic block
    while (node.stmtIdx < blk.stmts.length) {
      const s = blk.stmts[node.stmtIdx];
      switch (s.op) {
        case "peek_bits": {
          const ch = node.portMap.get(s.src);
          const needed = s.offset + s.width;
          if (ch.length < needed) {
            if (ch.isOpen) return { needPull: ch };
            if (ch.isFailed) return this._failKernel(node);
            // CLOSED with insufficient bits -> jump to `onEof`
            node.pc = s.onEof;
            node.stmtIdx = 0;
            return null;
          }
          node.temps.set(s.dst, ch.peekBitsAt(s.offset, s.width));
          node.stmtIdx += 1;
          break;
        }
        case "shift_bits": {
          const ch = node.portMap.get(s.src);
          ch.shiftBits(s.width);
          ch.aligned = false;
          node.stmtIdx += 1;
          break;
        }
        case "shift_tag": {
          const ch = node.portMap.get(s.src);
          ch.shiftBits(s.width);
          ch.consSchema = this.resolvePlist(s.nextSchema);
          ch.consNodeId = 0;
          ch.aligned = true;
          node.stmtIdx += 1;
          break;
        }
        case "push_bits": {
          const ch = node.portMap.get(s.dst);
          ch.pushBits(parseInt(s.bits, 2), s.width);
          node.stmtIdx += 1;
          break;
        }
        case "unshift_bits": {
          const ch = node.portMap.get(s.dst);
          ch.unshiftBits(parseInt(s.bits, 2), s.width);
          node.stmtIdx += 1;
          break;
        }
        case "set_reg": {
          node.regs.set(s.reg, s.value);
          node.stmtIdx += 1;
          break;
        }
        case "stack_push": {
          node.stacks.get(s.stack).push(parseInt(s.bits, 2), s.width);
          node.stmtIdx += 1;
          break;
        }
        case "stack_pop": {
          const st = node.stacks.get(s.stack);
          if (st.length < s.width) {
            node.pc = s.onEmpty;
            node.stmtIdx = 0;
            return null;
          }
          node.temps.set(s.dst, st.pop(s.width));
          node.stmtIdx += 1;
          break;
        }
        case "stack_clear": {
          node.stacks.get(s.stack).clear();
          node.stmtIdx += 1;
          break;
        }
        case "drain_guard": {
          const ch = node.portMap.get(s.src);
          if (!node.pendingDpda) {
            const pl = this.resolvePlist(s.schema);
            node.pendingDpda = { kind: "skip", state: createDpdaSkip(pl, 0), done: false };
          }
          if (!node.pendingDpda.done) {
            const res = stepDpdaSkip(ch, node.pendingDpda.state);
            if (res === DPDA_RESULT.NEED_BITS) {
              if (ch.isOpen) return { needPull: ch };
              return this._failKernel(node);
            }
            if (res === DPDA_RESULT.FAILED) return this._failKernel(node);
            node.pendingDpda.done = true;
          }
          if (ch.isOpen) return { needPull: ch };
          if (ch.isFailed || ch.length > 0) return this._failKernel(node);
          node.pendingDpda = null;
          node.ownedInputs.delete(s.src);
          ch.cons = null;
          ch.release();
          node.stmtIdx += 1;
          break;
        }
        case "dpda_copy": {
          const src = node.portMap.get(s.src);
          const dst = node.portMap.get(s.dst);
          if (!node.pendingDpda) {
            const pl = this.resolvePlist(s.schema);
            node.pendingDpda = { kind: "copy", state: createDpdaCopy(pl, 0) };
          }
          const res = stepDpdaCopy(src, dst, node.pendingDpda.state);
          if (res === DPDA_RESULT.NEED_BITS) {
            if (src.isOpen) return { needPull: src };
            return this._failKernel(node);
          }
          if (res === DPDA_RESULT.FAILED) return this._failKernel(node);
          node.pendingDpda = null;
          node.stmtIdx += 1;
          break;
        }
        case "dpda_coerce": {
          const src = node.portMap.get(s.src);
          const dst = node.portMap.get(s.dst);
          if (!node.pendingDpda) {
            const sPl = this.resolvePlist(s.srcSchema);
            const dPl = this.resolvePlist(s.dstSchema);
            node.pendingDpda = { kind: "coerce", state: createDpdaCoerce(sPl, 0, dPl, 0) };
          }
          const res = stepDpdaCoerce(src, dst, node.pendingDpda.state);
          if (res === DPDA_RESULT.NEED_BITS) {
            if (src.isOpen) return { needPull: src };
            return this._failKernel(node);
          }
          if (res === DPDA_RESULT.FAILED) return this._failKernel(node);
          node.pendingDpda = null;
          node.stmtIdx += 1;
          break;
        }
        case "splice": {
          const src = node.portMap.get(s.src);
          const dst = node.portMap.get(s.dst);
          node.ownedInputs.delete(s.src);
          node.ownedOutputs.delete(s.dst);
          if (src.cons === node) src.cons = null;
          if (dst.prod === node) dst.prod = null;
          this._splice(src, dst);
          node.stmtIdx += 1;
          break;
        }
        case "close": {
          const dst = node.portMap.get(s.dst);
          node.ownedOutputs.delete(s.dst);
          if (dst.prod === node) dst.prod = null;
          dst.close();
          node.stmtIdx += 1;
          break;
        }
        case "yield": {
          const dst = node.portMap.get(s.dst);
          node.yieldThreshold = s.threshold;
          node.stmtIdx += 1;
          if (dst.length >= s.threshold && dst.cons !== null) {
            return { yielded: true };
          }
          break;
        }
        default:
          throw new Error(`Unsupported kernel stmt '${s.op}'`);
      }
    }

    // Execute block terminator
    const t = blk.term;
    switch (t.op) {
      case "goto":
        node.pc = t.target;
        node.stmtIdx = 0;
        return null;
      case "retire":
        this._retireNode(node);
        return null;
      case "fail":
        return this._failKernel(node);
      case "handoff": {
        const ins = t.inputs.map((v) => node.portMap.get(v));
        const outs = t.outputs.map((v) => node.portMap.get(v));
        const scope = node.scope;
        this._retireNode(node);
        if (this.kernelMap.has(t.target)) {
          this._instantiateKernel(t.target, scope, ins, outs);
        } else {
          this._allocNode(scope, "spawn", {
            inputs: ins,
            outputs: outs,
            target: t.target,
            afterToken: null
          });
        }
        return null;
      }
      case "switch_bits": {
        const val = node.temps.get(t.src);
        let next = t.defaultTarget;
        for (const c of t.cases) {
          if (parseInt(c.bits, 2) === val) {
            next = c.target;
            break;
          }
        }
        if (!next) return this._failKernel(node);
        node.pc = next;
        node.stmtIdx = 0;
        return null;
      }
      case "switch_reg": {
        const val = node.regs.get(t.reg);
        const found = t.cases.find((c) => c.value === val);
        if (!found) return this._failKernel(node);
        node.pc = found.target;
        node.stmtIdx = 0;
        return null;
      }
      case "table_step":
        return this._execTableStep(node, t);
      case "stack_table_step":
        return this._execStackTableStep(node, t);
      case "fsm_table_step":
        return this._execFsmTableStep(node, t);
      default:
        throw new Error(`Unsupported kernel terminator '${t.op}'`);
    }
  }

  _failKernel(node) {
    const ownedOuts = [...node.ownedOutputs].map((v) => node.portMap.get(v));
    const ownedIns = [...node.ownedInputs].map((v) => node.portMap.get(v));
    this._retireNode(node);
    for (const o of ownedOuts) if (o) o.fail();
    for (const i of ownedIns) this._cancelInput(i);
    return null;
  }

  _execTableStep(node, t) {
    const compiled = this.tableMap.get(t.table);
    if (!compiled || compiled.flat.size === 0) {
      // Unpopulated/placeholder table -> fall back seamlessly to exact `short` CFG!
      node.pc = t.exits.short || t.exits.fail;
      node.stmtIdx = 0;
      return null;
    }

    const inputsSpec = compiled.decl.props.inputs || [];
    const outputsSpec = compiled.decl.props.outputs || [];
    const inChs = t.inputs.map((v) => node.portMap.get(v));
    const outChs = t.outputs.map((v) => node.portMap.get(v));

    // Hot burst (bounded to keep cooperative yield and quota responsive)
    for (let iter = 0; iter < 32; iter++) {
      // Cooperative yield check if downstream consumer exists
      for (const o of outChs) {
        if (o.cons !== null && o.length >= node.yieldThreshold) {
          return { yielded: true };
        }
      }

      // Refill / check input buffers
      for (let p = 0; p < inChs.length; p++) {
        const ch = inChs[p];
        const wRaw = inputsSpec[p].raw_bits;
        if (ch.length < wRaw) {
          if (ch.isFailed) {
            node.pc = t.exits.fail;
            node.stmtIdx = 0;
            return null;
          }
          if (ch.isOpen) return { needPull: ch };
          // CLOSED with < wRaw bits -> exact bit-level CFG fallback!
          node.pc = t.exits.short;
          node.stmtIdx = 0;
          return null;
        }
      }

      // Compute flat index: (((q << W_eff0) | c0) << W_eff1) | c1 ...
      let idx = node.regs.get(t.reg);
      for (let p = 0; p < inChs.length; p++) {
        const spec = inputsSpec[p];
        const raw = inChs[p].peekBits(spec.raw_bits);
        const eff = applyInputCompress(raw, spec);
        const wEff = spec.eff_bits ?? spec.raw_bits;
        idx = (idx << wEff) | eff;
      }

      const entry = compiled.flat.get(idx);
      this.telemetry.tableLookups += 1;
      if (!entry) {
        node.pc = t.exits.short || t.exits.fail;
        node.stmtIdx = 0;
        return null;
      }

      if (entry.kind === "NEED_MORE") {
        node.pc = t.exits.short;
        node.stmtIdx = 0;
        return null;
      }
      if (entry.kind === "FAIL") {
        node.pc = t.exits.fail;
        node.stmtIdx = 0;
        return null;
      }

      // Apply shifts & emits
      for (let p = 0; p < inChs.length; p++) {
        const sh = entry.shift[p] ?? 0;
        if (sh > 0) inChs[p].shiftBits(sh);
      }
      for (let o = 0; o < outChs.length; o++) {
        const elen = entry.emit_len[o] ?? 0;
        if (elen > 0) {
          const eword = entry.emit_word[o] ?? 0;
          const mode = outputsSpec[o]?.mode?.ident ?? outputsSpec[o]?.mode ?? "push";
          if (mode === "unshift") outChs[o].unshiftBits(eword, elen);
          else outChs[o].pushBits(eword, elen);
        }
      }

      node.regs.set(t.reg, entry.next_q);

      if (entry.kind === "EXIT") {
        node.pc = t.exits[String(entry.exit)];
        node.stmtIdx = 0;
        return null;
      }
      // kind === "CONT" -> continue hot loop!
      this.quota.tickStep();
      this.telemetry.steps = this.quota.steps;
    }
    return null;
  }

  _execStackTableStep(node, t) {
    const compiled = this.tableMap.get(t.table);
    if (!compiled || compiled.flat.size === 0) {
      node.pc = t.exits.short || t.exits.fail;
      node.stmtIdx = 0;
      return null;
    }

    const props = compiled.decl.props;
    const wStream = props.stream_bits;
    const wStack = props.stack_bits ?? 0;
    const stackEncoding = props.stack_encoding?.ident ?? props.stack_encoding ?? "bits";
    const stackStride = stackEncoding === "depth_only"
      ? (wStack + 1)
      : ((1 << (wStack + 1)) - 1);
    const outMode = props.output_mode?.ident ?? props.output_mode ?? "push";

    const inCh = node.portMap.get(t.input);
    const outCh = node.portMap.get(t.output);
    const st = node.stacks.get(t.stack);

    for (let iter = 0; iter < 32; iter++) {
      if (outCh.cons !== null && outCh.length >= node.yieldThreshold) {
        return { yielded: true };
      }

      if (inCh.length < wStream) {
        if (inCh.isFailed) {
          node.pc = t.exits.fail;
          node.stmtIdx = 0;
          return null;
        }
        if (inCh.isOpen) return { needPull: inCh };
        node.pc = t.exits.short;
        node.stmtIdx = 0;
        return null;
      }

      const q = node.regs.get(t.reg);
      const sBits = inCh.peekBits(wStream);
      const d = Math.min(st.length, wStack);
      let stCode = 0;
      if (stackEncoding === "depth_only") {
        stCode = d;
      } else if (d > 0) {
        stCode = ((1 << d) - 1) + st.peekTop(d);
      }

      const idx = (((q << wStream) | sBits) * stackStride) + stCode;
      const entry = compiled.flat.get(idx);
      this.telemetry.tableLookups += 1;
      if (!entry || entry.kind === "NEED_MORE") {
        node.pc = t.exits.short;
        node.stmtIdx = 0;
        return null;
      }
      if (entry.kind === "FAIL") {
        node.pc = t.exits.fail;
        node.stmtIdx = 0;
        return null;
      }

      if (entry.shift_stream > 0) inCh.shiftBits(entry.shift_stream);
      if (entry.pop_stack > 0) st.pop(entry.pop_stack);
      if (entry.push_stack_len > 0) st.push(entry.push_stack_word, entry.push_stack_len);
      if (entry.emit_len_single > 0) {
        if (outMode === "unshift") outCh.unshiftBits(entry.emit_word_single, entry.emit_len_single);
        else outCh.pushBits(entry.emit_word_single, entry.emit_len_single);
      }
      node.regs.set(t.reg, entry.next_q);

      if (entry.kind === "EXIT") {
        node.pc = t.exits[String(entry.exit)];
        node.stmtIdx = 0;
        return null;
      }
      this.quota.tickStep();
      this.telemetry.steps = this.quota.steps;
    }
    return null;
  }

  _execFsmTableStep(node, t) {
    const compiled = this.tableMap.get(t.table);
    if (!compiled || compiled.flat.size === 0) {
      node.pc = t.exits.short || t.exits.fail;
      node.stmtIdx = 0;
      return null;
    }

    const props = compiled.decl.props;
    const wRaw = props.input_bits;
    const outModes = props.output_modes || [];
    const inCh = node.portMap.get(t.input);
    const outChs = t.outputs.map((v) => node.portMap.get(v));

    if (inCh.length < wRaw) {
      if (inCh.isFailed) {
        node.pc = t.exits.fail;
        node.stmtIdx = 0;
        return null;
      }
      if (inCh.isOpen) return { needPull: inCh };
      node.pc = t.exits.short;
      node.stmtIdx = 0;
      return null;
    }

    const idx = inCh.peekBits(wRaw);
    const entry = compiled.flat.get(idx);
    this.telemetry.tableLookups += 1;
    if (!entry || entry.kind === "NEED_MORE") {
      node.pc = t.exits.short;
      node.stmtIdx = 0;
      return null;
    }
    if (entry.kind === "FAIL") {
      node.pc = t.exits.fail;
      node.stmtIdx = 0;
      return null;
    }

    const sh = entry.shift[0] ?? 0;
    if (sh > 0) inCh.shiftBits(sh);
    for (let o = 0; o < outChs.length; o++) {
      const elen = entry.emit_len[o] ?? 0;
      if (elen > 0) {
        const eword = entry.emit_word[o] ?? 0;
        const mode = outModes[o]?.ident ?? outModes[o] ?? "push";
        if (mode === "unshift") outChs[o].unshiftBits(eword, elen);
        else outChs[o].pushBits(eword, elen);
      }
    }

    if (entry.kind === "EXIT") {
      node.pc = t.exits[String(entry.exit)];
      node.stmtIdx = 0;
      return null;
    }
    return null;
  }

  // --- Strictly Iterative Demand-Driven Pull Scheduler ---

  /**
   * Drive all `rootOuts` to completion (`CLOSED` or `FAILED`) using an explicit
   * heap demand stack (zero host call-stack recursion).
   */
  driveToCompletion(rootOuts) {
    // Demand stack frames: { kind: "chan", ch } | { kind: "node", node }
    const demandStack = [];

    for (const rootOut of rootOuts) {
      while (rootOut.isOpen) {
        if (!rootOut.prod) {
          throw new Error(`Deadlock/unproduced channel '${rootOut.name}' is OPEN with no producer`);
        }
        demandStack.push({ kind: "chan", ch: rootOut });

        while (demandStack.length > 0) {
          const top = demandStack[demandStack.length - 1];
          let targetNode = null;

          if (top.kind === "chan") {
            const ch = top.ch;
            if (!ch.isOpen || !ch.prod) {
              demandStack.pop();
              continue;
            }
            targetNode = ch.prod;
          } else {
            if (top.node.retired) {
              demandStack.pop();
              continue;
            }
            targetNode = top.node;
          }

          const outcome = this._stepNode(targetNode);

          if (outcome && outcome.needPull) {
            demandStack.push({ kind: "chan", ch: outcome.needPull });
          } else if (outcome && outcome.needStepNode) {
            demandStack.push({ kind: "node", node: outcome.needStepNode });
          } else if (outcome && outcome.yielded) {
            // Cooperative yield: pop current producer frame so downstream consumer resumes!
            demandStack.pop();
          } else {
            // Normal progress: if we were fulfilling an upstream pull on an internal channel
            // that now has buffered bits (or settled), pop back to its consumer immediately!
            if (top.kind === "chan") {
              const ch = top.ch;
              if (!ch.isOpen || (demandStack.length > 1 && ch.length > 0)) {
                demandStack.pop();
              }
            } else if (top.node.retired) {
              demandStack.pop();
            }
          }
        }
      }
    }

    this.telemetry.peakActiveNodes = this.quota.peakNodes;
    this.telemetry.peakBitDequeBytes = this.quota.peakBitDequeBytes;
    this.telemetry.steps = this.quota.steps;
  }

  /**
   * Execute an entry procedure or kernel on pre-populated closed input `BitDeque`s.
   */
  run(entryName, inputDeques) {
    const entry = entryName || this.mod.entry;
    if (!entry) throw new Error("KTVMRuntime.run requires an entry name");

    const proc = this.procMap.get(entry);
    const kern = this.kernelMap.get(entry);
    const target = proc || kern;
    if (!target) throw new Error(`Unknown entry '${entry}'`);
    if (target.inputs.length !== inputDeques.length) {
      throw new Error(`Entry '${entry}' expects ${target.inputs.length} inputs, got ${inputDeques.length}`);
    }

    const rootIns = inputDeques.map((dq, i) => {
      const expectedPl = this.resolvePlist(target.inputs[i].schema);
      dq.prodSchema = expectedPl;
      dq.prodNodeId = 0;
      dq.consSchema = expectedPl;
      dq.consNodeId = 0;
      dq.aligned = true;
      dq.scope = 0;
      if (!dq.quota) {
        dq.quota = this.quota;
        this.quota.addBufferBytes(dq.words.byteLength);
      }
      return dq;
    });

    const outputPlists = target.outputs.map((o) => this.resolvePlist(o.schema));
    const rootOuts = target.outputs.map((o, i) => this._allocChan(0, outputPlists[i], o.name));

    if (proc) {
      this._allocNode(0, "spawn", {
        inputs: rootIns,
        outputs: rootOuts,
        target: entry,
        afterToken: null
      });
    } else {
      this._instantiateKernel(entry, 0, rootIns, rootOuts);
    }

    this.driveToCompletion(rootOuts);

    const anyFailed = rootOuts.some((o) => o.isFailed);
    if (anyFailed) {
      this._destroyScope(0);
      return {
        status: "FAILED",
        outputDeques: [],
        outputPlists,
        telemetry: { ...this.telemetry }
      };
    }

    // Detach rootOuts from scope 0 before cleanup so callers can consume them!
    const rootSc = this.scopes.get(0);
    if (rootSc) {
      for (const o of rootOuts) rootSc.chans.delete(o);
    }
    this._destroyScope(0);

    return {
      status: "OK",
      outputDeques: rootOuts,
      outputPlists,
      telemetry: { ...this.telemetry }
    };
  }
}

// --- High-Level Runners ---

function cloneDequeBits(src) {
  const copy = new BitDeque(-99, {
    prodSchema: src.prodSchema,
    prodNodeId: src.prodNodeId,
    consSchema: src.consSchema,
    consNodeId: src.consNodeId,
    aligned: src.aligned
  });
  let off = 0;
  let rem = src.length;
  while (rem > 0) {
    const chunk = rem > 30 ? 30 : rem;
    copy.pushBits(src.peekBitsAt(off, chunk), chunk);
    off += chunk;
    rem -= chunk;
  }
  if (src.isClosed) copy.close();
  return copy;
}

/**
 * Execute a `kTVM` (or `kTVM-P` with `inputPlists`) module on K `Value`s or `BitDeque`s.
 */
export function executeKTVM(moduleOrSource, inputsArg, opts = {}) {
  const parsed = typeof moduleOrSource === "string" ? parseModule(moduleOrSource) : moduleOrSource;
  const entryName = opts.entry || parsed.entry;
  const rawInputs = Array.isArray(inputsArg) ? inputsArg : [inputsArg];

  let monoMod = parsed;
  let monoEntry = entryName;

  if (parsed.layer === "poly") {
    if (!opts.inputPlists) {
      throw new KTVMSchemaError("Executing a 'poly' kTVM-P module requires `opts.inputPlists` or `executeKTVMWire`");
    }
    const spec = specializeKTVM(parsed, entryName, opts.inputPlists, {
      useCache: opts.useCache !== false,
      validate: opts.validate !== false
    });
    monoMod = spec.module;
    monoEntry = spec.entry;
  } else if (opts.validate !== false) {
    validateModule(monoMod, { verifyTables: opts.verifyTables !== false });
  }

  const quota = new QuotaTracker(opts.quota || {});
  const vm = new KTVMRuntime(monoMod, { quota });
  const target = vm.procMap.get(monoEntry) || vm.kernelMap.get(monoEntry);
  if (!target) throw new Error(`Unknown entry '${monoEntry}'`);

  const inputDeques = rawInputs.map((item, i) => {
    if (item instanceof BitDeque) {
      if (item.isOpen) item.close();
      return item;
    }
    const pl = vm.resolvePlist(target.inputs[i].schema);
    const dq = new BitDeque(10000 + i, { prodSchema: pl, consSchema: pl, quota });
    encodePayloadToDeque(item, pl, dq, 0);
    dq.close();
    return dq;
  });

  const res = vm.run(monoEntry, inputDeques);
  if (res.status === "FAILED") {
    return { status: "FAILED", telemetry: res.telemetry };
  }

  const values = opts.decodeValues === false
    ? null
    : res.outputDeques.map((dq, i) => {
        const tmp = cloneDequeBits(dq);
        const val = decodeDequeToValue(tmp, res.outputPlists[i], 0, { exact: true });
        tmp.release();
        return val;
      });

  return {
    status: "OK",
    outputDeques: res.outputDeques,
    values,
    value: values ? values[0] : null,
    outputPlists: res.outputPlists,
    telemetry: res.telemetry
  };
}

/**
 * Full end-to-end enveloped `k-wire` execution:
 *   enveloped wire bytes -> split header -> boundary specialization (`kTVM-P` -> `kTVM`)
 *   -> iterative execution -> framed enveloped output `k-wire` bytes.
 */
export function executeKTVMWire(moduleOrSource, envelopedWireBuffer, opts = {}) {
  const parsed = typeof moduleOrSource === "string" ? parseModule(moduleOrSource) : moduleOrSource;
  const entryName = opts.entry || parsed.entry;
  const quota = new QuotaTracker(opts.quota || {});

  // 1. Split & validate incoming k-wire envelope strictly iteratively
  const { plist: inPlist, payloadDeque } = splitEnvelopedWire(envelopedWireBuffer, { quota });

  // 2. Boundary specialization / compatibility check (throws KTVMSchemaError on mismatch)
  let spec;
  try {
    spec = specializeKTVM(parsed, entryName, inPlist, {
      useCache: opts.useCache !== false,
      validate: opts.validate !== false
    });
  } catch (err) {
    payloadDeque.release();
    throw err;
  }

  if (parsed.layer === "mono" && opts.validate !== false) {
    validateModule(spec.module, { verifyTables: opts.verifyTables !== false });
  }

  // 3. Execute concrete mono module
  const vm = new KTVMRuntime(spec.module, { quota });
  const res = vm.run(spec.entry, [payloadDeque]);
  if (res.status === "FAILED") {
    return {
      status: "FAILED",
      specialized: spec,
      telemetry: res.telemetry
    };
  }

  const outDeque = res.outputDeques[0];
  const outPlist = res.outputPlists[0];

  let value = null;
  if (opts.decodeValue !== false) {
    const tmp = cloneDequeBits(outDeque);
    value = decodeDequeToValue(tmp, outPlist, 0, { exact: true });
    tmp.release();
  }

  // 4. Frame output payload with derived closed output schema header
  const wire = frameEnvelopedWire(outPlist, outDeque);
  outDeque.release();

  return {
    status: "OK",
    wire,
    value,
    outputPlist: outPlist,
    specialized: spec,
    telemetry: res.telemetry
  };
}
