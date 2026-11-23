/**
 * Iteration 4: Bit-Packed Multi-Port JIT + Variable-Width `k-wire` Bit-Chunk Transducer Network.
 *
 * Keeps K's native wire contract (`codecs/WIRE_FORMAT.md`) 100% UNTOUCHED!
 * Combines EVERY layer cleanly and orthogonally:
 *   - Iteration 2: Multi-Port `BitWireBundle`s, zero-copy direct wiring,
 *                  barrier-completion waiter splicing, eager-settle, zero-copy
 *                  `MUX -> DEMUX` bundle fusion, tail-recursive `|cons` settlement.
 *   - Iteration 3: Static CPS symbolic `COMPILED_FSM` & `COMPILED_LOOP` DAGs
 *                  with automatic in-register finite states (`b`, `c`, `ord`).
 *   - Iteration 4: Packed `Uint32Array` ring-buffer `BitDeque`s in strict `k-wire`
 *                  encoding + `BitChunkCompilerV4` consuming variable-width chunks
 *                  of raw `k-wire` bits (sub-token guards, don't-care bit packing
 *                  up to 16b/24b chunks, and heterogeneous cross-schema FSM chunks!).
 */

import { canonicalSubPlistKey, plistHasAny, graftUnionTagPayload } from "../v2/blueprint.mjs";
import { TransducerCompilerV3 } from "../v3/fsm-compiler.mjs";
import { BitDeque, BitWireBundle, bitWireLeaves, bitWireAtPath } from "./bit-deque.mjs";
import { BitCodec } from "./bit-codec.mjs";
import { BitChunkCompilerV4 } from "./bit-chunk-compiler.mjs";

const STATE = {
  STUB: "STUB",
  ACTIVE: "ACTIVE",
  DONE: "DONE",
  FAILED: "FAILED",
  RETIRED: "RETIRED"
};

/**
 * 1-state Pushdown Automaton operating directly on packed `BitDeque`s under `BitCodec`.
 */
export class BitPatternDPDA {
  constructor(mode, codec, inPlist, inStartNode = 0, outPlist = null, outStartNode = 0) {
    this.mode = mode; // "skip" | "copy" | "coerce"
    this.codec = codec;
    this.inPlist = inPlist;
    this.outPlist = outPlist || inPlist;
    this.stack = mode === "coerce" ? [[inStartNode, outStartNode]] : [inStartNode];
    this.done = false;
    this.failed = false;
    this._drainProducts();
  }

  _drainProducts() {
    if (this.mode === "coerce") {
      while (this.stack.length > 0) {
        const [uIn, uOut] = this.stack[this.stack.length - 1];
        const [kIn, eIn] = this.inPlist[uIn];
        const [kOut, eOut] = this.outPlist[uOut];
        if (kIn === "closed-product") {
          if (kOut === "any") {
            this.stack.pop();
            for (let i = eIn.length - 1; i >= 0; i--) this.stack.push([eIn[i][1], uOut]);
          } else {
            if (kOut !== "closed-product" || eIn.length !== eOut.length) {
              this.failed = true;
              return;
            }
            this.stack.pop();
            for (let i = eIn.length - 1; i >= 0; i--) {
              if (eIn[i][0] !== eOut[i][0]) {
                this.failed = true;
                return;
              }
              this.stack.push([eIn[i][1], eOut[i][1]]);
            }
          }
        } else {
          break;
        }
      }
    } else {
      while (this.stack.length > 0) {
        const u = this.stack[this.stack.length - 1];
        const [kind, edges] = this.inPlist[u];
        if (kind === "closed-product") {
          this.stack.pop();
          for (let i = edges.length - 1; i >= 0; i--) this.stack.push(edges[i][1]);
        } else {
          break;
        }
      }
    }
    if (this.stack.length === 0) this.done = true;
  }

  step(inDq, outDq = null) {
    if (this.done) return "DONE";
    if (this.failed) return "FAILED";

    if (this.mode === "coerce") {
      const [uIn, uOut] = this.stack[this.stack.length - 1];
      const [kIn] = this.inPlist[uIn];
      const [kOut] = this.outPlist[uOut];
      if ((kIn !== "closed-union" && kIn !== "open-union") || (kOut !== "closed-union" && kOut !== "open-union" && kOut !== "any")) {
        this.failed = true;
        return "FAILED";
      }
      const pk = this.codec.peekTag(inDq, this.inPlist, uIn);
      if (pk.status === "NEED_BITS") {
        if (inDq.failed || inDq.closed) { this.failed = true; return "FAILED"; }
        return "NEED_INPUT";
      }
      if (pk.status === "INVALID") { this.failed = true; return "FAILED"; }
      const entry = pk.entry;
      if (entry.width > 0) inDq.shiftBits(entry.width);
      this.stack.pop();
      if (kOut === "any") {
        if (entry.width > 0) outDq.pushBits(entry.code, entry.width);
        this.stack.push([entry.target, uOut]);
      } else {
        const outTbl = this.codec.getNodeTable(this.outPlist, uOut);
        const outEnt = outTbl?.byTag.get(entry.tag);
        if (!outEnt) { this.failed = true; return "FAILED"; }
        if (outEnt.width > 0) outDq.pushBits(outEnt.code, outEnt.width);
        this.stack.push([entry.target, outEnt.target]);
      }
    } else {
      const u = this.stack[this.stack.length - 1];
      const [kind] = this.inPlist[u];
      if (kind !== "closed-union" && kind !== "open-union") {
        this.failed = true;
        return "FAILED";
      }
      const pk = this.codec.peekTag(inDq, this.inPlist, u);
      if (pk.status === "NEED_BITS") {
        if (inDq.failed || inDq.closed) { this.failed = true; return "FAILED"; }
        return "NEED_INPUT";
      }
      if (pk.status === "INVALID") { this.failed = true; return "FAILED"; }
      const entry = pk.entry;
      if (entry.width > 0) inDq.shiftBits(entry.width);
      this.stack.pop();
      if (this.mode === "copy" && entry.width > 0) {
        outDq.pushBits(entry.code, entry.width);
      }
      this.stack.push(entry.target);
    }

    this._drainProducts();
    if (this.failed) return "FAILED";
    return this.done ? "DONE" : "STEPPED";
  }
}

export class BitPackedTransducerNetworkV4 {
  constructor(
    registry,
    {
      codec = null,
      compilerV3 = null,
      chunkCompiler = null,
      enableCompiled = true,
      enableChunks = true,
      onSnapshot = null
    } = {}
  ) {
    this.registry = registry;
    this.codec = codec || new BitCodec();
    this.compilerV3 = compilerV3 || new TransducerCompilerV3(registry);
    this.enableCompiled = enableCompiled;
    this.enableChunks = enableCompiled && enableChunks;
    this.chunkCompiler = chunkCompiler || new BitChunkCompilerV4(this.compilerV3, this.codec);
    this.onSnapshot = onSnapshot;

    this.nextNodeId = 1;
    this.nextFifoId = 1;
    this.nextScopeId = 1;
    this.nodes = new Map();
    this.fifos = new Map();

    this.telemetry = {
      codecMode: "k-wire",
      stubsCreated: 0,
      stubsExpanded: 0,
      stubsNeverExpanded: 0,
      totalNodesCreated: 0,
      peakActiveNodes: 0,
      peakLiveFifos: 0,
      divSplices: 0,
      vidPrependSplices: 0,
      idSplices: 0,
      barrierWaiterSplices: 0,
      eagerStubSettles: 0,
      muxDemuxFusions: 0,
      muxTailSplices: 0,
      demuxTailSplices: 0,
      lastBranchSplices: 0,
      directFieldWires: 0,
      teeNodesCreated: 0,
      nodesRetired: 0,
      deterministicDispatches: 0,
      speculativeSwitches: 0,
      speculativeRollbacks: 0,
      abortedNodes: 0,
      compiledNodesCreated: 0,
      compiledFsmHits: 0,
      compiledLoopIterations: 0,
      strideSuperSteps: 0,
      strideIterationsRetired: 0,
      fsmChunkSteps: 0,
      fsmChunkTokensRetired: 0,
      chunkBitsConsumed: 0,
      subTokenGuardHits: 0,
      totalBitsTransferred: 0,
      liveFifoBits: 0,
      peakFifoBits: 0,
      schedulerSteps: 0
    };
  }

  _updatePeakNodes() {
    const active = this.nodes.size;
    if (active > this.telemetry.peakActiveNodes) this.telemetry.peakActiveNodes = active;
    if (this.fifos.size > this.telemetry.peakLiveFifos) this.telemetry.peakLiveFifos = this.fifos.size;
  }

  _isTailRecursiveMux(mux) {
    return Boolean(mux && mux.kind === "MUX" && mux.isTailRecursive);
  }

  createDeque(name, scopeId, { path = "", plist = null, nodeId = 0, upstream = null, downstream = null } = {}) {
    const id = this.nextFifoId++;
    const dq = new BitDeque(id, {
      name: name || `B${id}`,
      path,
      plist,
      nodeId,
      upstream,
      downstream,
      scopeId,
      telemetry: this.telemetry
    });
    this.fifos.set(id, dq);
    return dq;
  }

  createWire(plist, nodeId, namePrefix, scopeId) {
    const [kind, edges] = plist[nodeId];
    if (kind === "closed-product" && edges.length > 0) {
      const fields = new Map();
      for (const [label, target] of edges) {
        const subName = namePrefix ? `${namePrefix}.${label}` : label;
        fields.set(label, this.createWire(plist, target, subName, scopeId));
      }
      return new BitWireBundle(fields, plist, nodeId);
    }
    return this.createDeque(namePrefix || `W${this.nextFifoId}`, scopeId, {
      path: namePrefix,
      plist,
      nodeId
    });
  }

  registerNode(node) {
    this.nodes.set(node.id, node);
    this.telemetry.totalNodesCreated++;
    if (node.kind === "STUB") this.telemetry.stubsCreated++;
    if (node.kind === "TEE") this.telemetry.teeNodesCreated++;
    this._updatePeakNodes();
    return node;
  }

  retireNode(node) {
    if (!node || node.state === STATE.RETIRED) return;
    if (node.kind === "STUB" && node.state === STATE.STUB) this.telemetry.stubsNeverExpanded++;
    node.state = STATE.RETIRED;
    this.nodes.delete(node.id);
    this.telemetry.nodesRetired++;
  }

  retireDeque(dq) {
    if (!dq || !dq.alive) return;
    dq.release();
    this.fifos.delete(dq.id);
  }

  attachWireDownstream(wire, node) {
    for (const { fifo } of bitWireLeaves(wire)) fifo.downstream = node;
  }

  attachWireUpstream(wire, node) {
    for (const { fifo } of bitWireLeaves(wire)) fifo.upstream = node;
  }

  _trySpliceScalar(node, inDq, outDq, counterKey, prependEntry = null) {
    if (!inDq || !outDq || !outDq.downstream) return false;
    if (inDq.scopeId !== outDq.scopeId) return false;
    const down = outDq.downstream;
    if (down.kind === "MULTI_SW" && down.activeScopeId !== null) return false;

    if (down.inFifo === outDq) {
      down.inFifo = inDq;
      if (down.inWire === outDq) down.inWire = inDq;
      inDq.downstream = down;
    } else if (down.inWire) {
      if (!this._replaceWireLeaf(down.inWire, outDq, inDq)) return false;
      inDq.downstream = down;
    } else if (down.kind === "DRAIN" && down.barrier) {
      let replaced = false;
      for (const d of down.barrier.drainers) {
        if (d.fifo === outDq) { d.fifo = inDq; replaced = true; }
      }
      if (!replaced) return false;
      inDq.downstream = down;
    } else {
      return false;
    }
    if (down.inLeaves) {
      for (const l of down.inLeaves) {
        if (l.fifo === outDq) l.fifo = inDq;
      }
    }

    // Preserve exact bit order: [outDq existing prefix] -> [prependEntry] -> [inDq bits]
    if (prependEntry && prependEntry.width > 0) {
      inDq.unshiftBits(prependEntry.code, prependEntry.width);
    }
    if (outDq.lenBits > 0) {
      inDq.unshiftFromDeque(outDq);
    }
    if (!plistHasAny(outDq.plist, outDq.nodeId)) {
      inDq.plist = outDq.plist;
      inDq.nodeId = outDq.nodeId;
    }
    if (node) this.retireNode(node);
    this.retireDeque(outDq);
    this.telemetry[counterKey]++;
    return true;
  }

  _replaceWireLeaf(wire, oldDq, newDq) {
    if (wire.kind === "fifo") return false;
    for (const [label, child] of wire.fields.entries()) {
      if (child === oldDq) { wire.fields.set(label, newDq); return true; }
      if (child.kind === "bundle" && this._replaceWireLeaf(child, oldDq, newDq)) return true;
    }
    return false;
  }

  teardownScope(scopeId, countAsAbort = true) {
    const scopesToKill = new Set([scopeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.nodes.values()) {
        if (n.childScopeIds && scopesToKill.has(n.scopeId)) {
          for (const cid of n.childScopeIds) {
            if (!scopesToKill.has(cid)) { scopesToKill.add(cid); changed = true; }
          }
        }
      }
    }
    for (const n of [...this.nodes.values()]) {
      if (scopesToKill.has(n.scopeId)) {
        if (countAsAbort) this.telemetry.abortedNodes++;
        this.retireNode(n);
      }
    }
    for (const f of [...this.fifos.values()]) {
      if (scopesToKill.has(f.scopeId)) this.retireDeque(f);
    }
  }

  _makeNode(kind, label, inWire, outWire, scopeId, extra = {}) {
    const id = this.nextNodeId++;
    const node = {
      id,
      kind,
      label,
      state: extra.state || STATE.ACTIVE,
      inWire,
      outWire,
      inFifo: inWire?.kind === "fifo" ? inWire : null,
      outFifo: outWire?.kind === "fifo" ? outWire : null,
      scopeId,
      ...extra
    };
    if (inWire) this.attachWireDownstream(inWire, node);
    if (outWire) this.attachWireUpstream(outWire, node);
    return this.registerNode(node);
  }

  _wireCopy(inWire, outWire, scopeId, barrier = null) {
    const inL = bitWireLeaves(inWire);
    const outL = bitWireLeaves(outWire);
    if (inL.length !== outL.length) throw new Error(`_wireCopy leaf mismatch: ${inL.length} vs ${outL.length}`);
    for (let i = 0; i < inL.length; i++) {
      const inDq = inL[i].fifo;
      const outDq = outL[i].fifo;
      const samePat =
        plistHasAny(outDq.plist, outDq.nodeId) ||
        canonicalSubPlistKey(inDq.plist, inDq.nodeId) === canonicalSubPlistKey(outDq.plist, outDq.nodeId);
      if (samePat && (!barrier || barrier.done) && this._trySpliceScalar(null, inDq, outDq, "idSplices")) {
        continue;
      }
      const dpda = new BitPatternDPDA(
        samePat ? "copy" : "coerce",
        this.codec,
        inDq.plist,
        inDq.nodeId,
        outDq.plist,
        outDq.nodeId
      );
      const idNode = this._makeNode("ID", barrier ? "()*" : "()", inDq, outDq, scopeId, {
        dpda,
        canBypass: samePat,
        barrier
      });
      if (barrier && !barrier.done && samePat) barrier.waiters.push(idNode);
    }
  }

  _createDrainBarrier(unusedLeaves, scopeId) {
    if (unusedLeaves.length === 0) return null;
    const drainers = unusedLeaves.map(({ fifo }) => ({
      fifo,
      dpda: plistHasAny(fifo.plist, fifo.nodeId)
        ? null
        : new BitPatternDPDA("skip", this.codec, fifo.plist, fifo.nodeId),
      done: false
    }));
    const barrier = { drainers, done: false, failed: false, scopeId, waiters: [], nodes: [] };
    const drainNode = this._makeNode(
      "DRAIN",
      `DRAIN(${unusedLeaves.map((l) => l.pathKey || l.fifo.name).join(",")})`,
      null,
      null,
      scopeId,
      { barrier }
    );
    for (const { fifo } of unusedLeaves) fifo.downstream = drainNode;
    barrier.node = drainNode;
    barrier.nodes.push(drainNode);
    return barrier;
  }

  _mergeBarriers(b1, b2, scopeId) {
    return {
      drainers: [...b1.drainers, ...b2.drainers],
      done: false,
      failed: false,
      scopeId,
      node: b2.node,
      nodes: [...(b1.nodes || [b1.node]), ...(b2.nodes || [b2.node])].filter(Boolean),
      waiters: [...(b1.waiters || []), ...(b2.waiters || [])]
    };
  }

  _retireBarrierNodes(barrier) {
    for (const n of barrier.nodes || [barrier.node]) if (n) this.retireNode(n);
  }

  _ensureBarrier(barrier) {
    if (!barrier || barrier.done) return "DONE";
    if (barrier.failed) return "FAILED";

    for (const d of barrier.drainers) {
      if (d.done) continue;
      while (!d.dpda) {
        if (!plistHasAny(d.fifo.plist, d.fifo.nodeId)) {
          d.dpda = new BitPatternDPDA("skip", this.codec, d.fifo.plist, d.fifo.nodeId);
          break;
        }
        const st = this._ensureBits(d.fifo, 1);
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "WAIT") continue;
        if (st === "EOF_OR_FAIL") {
          if (d.fifo.failed) {
            barrier.failed = true;
            this._retireBarrierNodes(barrier);
            return "FAILED";
          }
          d.dpda = { done: true, failed: false };
          break;
        }
        d.dpda = new BitPatternDPDA("skip", this.codec, d.fifo.plist, d.fifo.nodeId);
      }
      while (!d.dpda.done && !d.dpda.failed) {
        const res = d.dpda.step(d.fifo, null);
        if (res === "NEED_INPUT") {
          const st = this._pullUpstreamOneStep(d.fifo);
          if (st === "NEED_INPUT") return "NEED_INPUT";
          if (st === "EOF_OR_FAIL") {
            barrier.failed = true;
            this._retireBarrierNodes(barrier);
            return "FAILED";
          }
          continue;
        }
        if (res === "FAILED") {
          barrier.failed = true;
          this._retireBarrierNodes(barrier);
          return "FAILED";
        }
      }
      const f = d.fifo;
      if (f.alive && f.upstream && f.upstream.kind !== "TEE" && f.upstream.kind !== "REPLAY" && f.upstream.kind !== "DEMUX") {
        while (f.alive && !f.closed && !f.failed) {
          const r = this.stepNode(f.upstream);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || f.failed) break;
        }
        if (f.failed) {
          barrier.failed = true;
          this._retireBarrierNodes(barrier);
          return "FAILED";
        }
      }
      d.done = true;
      if (f.alive && f.lenBits === 0 && f.closed) {
        if (f.upstream && f.upstream.state === STATE.DONE) this.retireNode(f.upstream);
        if (f.scopeId === barrier.scopeId && f.name !== "IN") this.retireDeque(f);
      }
    }

    barrier.done = true;
    this._retireBarrierNodes(barrier);

    if (barrier.waiters.length > 0) {
      const waiters = barrier.waiters;
      barrier.waiters = [];
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (!w || w.state !== STATE.ACTIVE) continue;
        if (w.kind === "ID" && w.canBypass) {
          if (this._trySpliceScalar(w, w.inFifo, w.outFifo, "idSplices")) {
            this.telemetry.barrierWaiterSplices++;
          }
        } else if (w.kind === "VID" && w.canPrependSplice && !w.emittedTag && !w.inFifo.failed) {
          if (this._trySpliceScalar(w, w.inFifo, w.outFifo, "vidPrependSplices", w.tagEntry)) {
            this.telemetry.barrierWaiterSplices++;
          }
        }
      }
    }
    return "DONE";
  }

  instantiate(bp, inWire, outWire, scopeId, barrier = null) {
    switch (bp.kind) {
      case "stub":
        return this._makeNode("STUB", `STUB(${bp.relName})`, inWire, outWire, scopeId, {
          state: STATE.STUB,
          relHash: bp.relHash,
          relName: bp.relName,
          barrier
        });

      case "identity":
        this._wireCopy(inWire, outWire, scopeId, barrier);
        return null;

      case "unit": {
        const allLeaves = inWire ? bitWireLeaves(inWire) : [];
        const b = this._createDrainBarrier(allLeaves, scopeId);
        return this._makeNode("UNIT", "{}", null, outWire, scopeId, { unitDrain: b, barrier });
      }

      case "div": {
        if (inWire.kind !== "fifo") throw new Error(`DIV /${bp.tag}: expected scalar BitDeque`);
        const bpHasAny = plistHasAny(bp.inPlist) || plistHasAny(bp.outPlist);
        const rtEdgeInit = bpHasAny ? inWire.plist?.[inWire.nodeId]?.[1]?.find(([t]) => t === bp.tag) : null;
        const useRuntimeIn = Boolean(rtEdgeInit && !plistHasAny(inWire.plist, rtEdgeInit[1]));
        const effInPlist = useRuntimeIn ? inWire.plist : bp.inPlist;
        const effTargetNode = useRuntimeIn ? rtEdgeInit[1] : bp.targetNodeId;

        if (outWire.kind === "fifo") {
          if (useRuntimeIn && plistHasAny(outWire.plist, outWire.nodeId)) {
            outWire.plist = effInPlist;
            outWire.nodeId = effTargetNode;
          }
          const effOutPlist = bpHasAny ? outWire.plist : bp.outPlist;
          const effOutNode = bpHasAny ? outWire.nodeId : 0;
          const samePay = bpHasAny
            ? canonicalSubPlistKey(effInPlist, effTargetNode) === canonicalSubPlistKey(effOutPlist, effOutNode)
            : bp.payloadSamePattern;
          const dpda = new BitPatternDPDA(
            samePay ? "copy" : "coerce",
            this.codec,
            effInPlist,
            effTargetNode,
            effOutPlist,
            effOutNode
          );
          return this._makeNode("DIV", `/${bp.tag}`, inWire, outWire, scopeId, {
            tag: bp.tag,
            inSchemaPlist: bp.inPlist,
            matchedTag: false,
            dpda,
            canBypass: samePay && !barrier,
            needsRuntimeSchema: bpHasAny,
            barrier
          });
        }
        const payloadDq = this.createDeque(`div_${bp.tag}`, scopeId, { plist: bp.targetPlist, nodeId: 0 });
        const dpda = new BitPatternDPDA("copy", this.codec, effInPlist, effTargetNode);
        this._makeNode("DIV", `/${bp.tag}`, inWire, payloadDq, scopeId, {
          tag: bp.tag,
          inSchemaPlist: bp.inPlist,
          matchedTag: false,
          dpda,
          canBypass: !barrier,
          needsRuntimeSchema: false,
          barrier
        });
        return this._makeDemux(bp.targetPlist, payloadDq, outWire, scopeId);
      }

      case "vid": {
        if (outWire.kind !== "fifo") throw new Error(`VID |${bp.tag}: expected scalar BitDeque`);
        let scalarIn = inWire;
        if (inWire.kind === "bundle") {
          scalarIn = this.createDeque(`mux_${bp.tag}`, scopeId, { plist: bp.inPlist, nodeId: 0 });
          const muxNode = this._makeMux(inWire, scalarIn, scopeId);
          if (muxNode.inLeaves.length >= 2) {
            const lastF = muxNode.inLeaves[muxNode.inLeaves.length - 1].fifo;
            muxNode.isTailRecursive =
              canonicalSubPlistKey(lastF.plist, lastF.nodeId) ===
              canonicalSubPlistKey(outWire.plist, outWire.nodeId);
          }
        }
        const bpHasAny = plistHasAny(bp.inPlist) || plistHasAny(bp.outPlist);
        const useRuntimeIn = bpHasAny && scalarIn.plist && !plistHasAny(scalarIn.plist, scalarIn.nodeId);
        const effInPlist = useRuntimeIn ? scalarIn.plist : bp.inPlist;
        const effInNode = useRuntimeIn ? scalarIn.nodeId : 0;

        if (useRuntimeIn && plistHasAny(outWire.plist, outWire.nodeId)) {
          const outEdge = outWire.plist[outWire.nodeId]?.[1]?.find(([t]) => t === bp.tag);
          if (outEdge && plistHasAny(outWire.plist, outEdge[1])) {
            outWire.plist = graftUnionTagPayload(outWire.plist, outWire.nodeId, bp.tag, effInPlist, effInNode);
          }
        }
        const outEdge = bpHasAny ? outWire.plist?.[outWire.nodeId]?.[1]?.find(([t]) => t === bp.tag) : null;
        const effOutPlist = outEdge ? outWire.plist : bp.outPlist;
        const effOutTarget = outEdge ? outEdge[1] : bp.targetNodeId;
        const samePay = bpHasAny
          ? canonicalSubPlistKey(effInPlist, effInNode) === canonicalSubPlistKey(effOutPlist, effOutTarget)
          : bp.payloadSamePattern;
        const tagEntry = this.codec.encodeTag(bp.outPlist, 0, bp.tag);

        const dpda = new BitPatternDPDA(
          samePay ? "copy" : "coerce",
          this.codec,
          effInPlist,
          effInNode,
          effOutPlist,
          effOutTarget
        );
        const hasAnyIn = bpHasAny && plistHasAny(effInPlist, effInNode);
        const canPrependSplice = !hasAnyIn && samePay && !dpda.done && scalarIn.kind === "fifo";
        if (
          canPrependSplice &&
          (!barrier || barrier.done) &&
          !scalarIn.failed &&
          this._trySpliceScalar(null, scalarIn, outWire, "vidPrependSplices", tagEntry)
        ) {
          return null;
        }
        const vidNode = this._makeNode("VID", `|${bp.tag}`, scalarIn, outWire, scopeId, {
          tag: bp.tag,
          tagEntry,
          emittedTag: false,
          dpda,
          canPrependSplice,
          needsRuntimeSchema: bpHasAny,
          barrier
        });
        if (barrier && !barrier.done && canPrependSplice) barrier.waiters.push(vidNode);
        return vidNode;
      }

      case "dot": {
        const selected = inWire.fields.get(bp.field);
        const discardedLeaves = [];
        for (const [label, child] of inWire.fields.entries()) {
          if (label !== bp.field) bitWireLeaves(child, [label], discardedLeaves);
        }
        const dotBarrier = this._createDrainBarrier(discardedLeaves, scopeId);
        const eff = barrier && dotBarrier ? this._mergeBarriers(barrier, dotBarrier, scopeId) : (dotBarrier || barrier);
        this._wireCopy(selected, outWire, scopeId, eff);
        return null;
      }

      case "comp": {
        const stages = [];
        let curIn = inWire;
        let curBarrier = barrier;
        for (let i = 0; i < bp.steps.length; i++) {
          const stepBp = bp.steps[i];
          const isLast = i === bp.steps.length - 1;
          if (stepBp.kind === "dot" && curIn && curIn.kind === "bundle") {
            const selected = curIn.fields.get(stepBp.field);
            const discardedLeaves = [];
            for (const [label, child] of curIn.fields.entries()) {
              if (label !== stepBp.field) bitWireLeaves(child, [label], discardedLeaves);
            }
            const dotBarrier = this._createDrainBarrier(discardedLeaves, scopeId);
            if (dotBarrier) curBarrier = curBarrier ? this._mergeBarriers(curBarrier, dotBarrier, scopeId) : dotBarrier;
            curIn = selected;
            if (isLast) stages.push({ kind: "wireCopy", inWire: curIn, outWire, barrier: curBarrier });
            continue;
          }
          const stepOut = isLast ? outWire : this.createWire(stepBp.outPlist, 0, `m${this.nextFifoId}`, scopeId);
          stages.push({ kind: "bp", bp: stepBp, inWire: curIn, outWire: stepOut, barrier: curBarrier });
          curBarrier = null;
          curIn = stepOut;
        }
        for (let i = stages.length - 1; i >= 0; i--) {
          const st = stages[i];
          if (st.kind === "wireCopy") this._wireCopy(st.inWire, st.outWire, scopeId, st.barrier);
          else this.instantiate(st.bp, st.inWire, st.outWire, scopeId, st.barrier);
        }
        return null;
      }

      case "product": {
        const inLeaves = bitWireLeaves(inWire);
        const readersByPath = new Map(inLeaves.map((l) => [l.pathKey, []]));
        bp.fields.forEach((f, idx) => {
          for (const p of f.blueprint.usedPaths) if (readersByPath.has(p)) readersByPath.get(p).push(idx);
        });
        const unusedLeaves = [];
        const branchLeafMap = bp.fields.map(() => new Map());
        for (const l of inLeaves) {
          const users = readersByPath.get(l.pathKey);
          if (users.length === 0) unusedLeaves.push(l);
          else if (users.length === 1) {
            branchLeafMap[users[0]].set(l.pathKey, l.fifo);
            this.telemetry.directFieldWires++;
          } else {
            const tee = this._makeNode("TEE", `TEE(${l.pathKey || l.fifo.name}×${users.length})`, l.fifo, null, scopeId, {
              branchDeques: []
            });
            for (const u of users) {
              const bDq = this.createDeque(`t_${l.pathKey || "v"}_${u}`, scopeId, {
                path: l.pathKey,
                plist: l.fifo.plist,
                nodeId: l.fifo.nodeId,
                upstream: tee
              });
              tee.branchDeques.push(bDq);
              branchLeafMap[u].set(l.pathKey, bDq);
            }
          }
        }
        const prodBarrier = this._createDrainBarrier(unusedLeaves, scopeId);
        const eff = barrier && prodBarrier ? this._mergeBarriers(barrier, prodBarrier, scopeId) : (prodBarrier || barrier);
        for (let i = 0; i < bp.fields.length; i++) {
          const f = bp.fields[i];
          const branchInWire = this._buildBranchInWire(inWire, branchLeafMap[i], "");
          this.instantiate(f.blueprint, branchInWire, outWire.fields.get(f.label), scopeId, eff);
        }
        return null;
      }

      case "multi-switch": {
        const peekLabel = bp.peekPaths.length > 0
          ? `SW[${bp.peekPaths.map((p) => p || "*").join(",")}]`
          : `SPEC<${bp.branches.length}>`;
        const inLeaves = bitWireLeaves(inWire);
        const outLeaves = bitWireLeaves(outWire);
        return this._makeNode("MULTI_SW", peekLabel, inWire, outWire, scopeId, {
          branches: bp.branches,
          peekPaths: bp.peekPaths,
          inLeaves,
          outLeaves,
          barrier,
          candidates: null,
          candIdx: 0,
          recorded: null, // BitDeque[] for bit-exact replay!
          replayCursors: null,
          activeScopeId: null,
          branchOutLeaves: null,
          committed: false,
          childScopeIds: new Set()
        });
      }

      default:
        throw new Error(`Unknown V4 blueprint kind: ${bp.kind}`);
    }
  }

  _buildBranchInWire(origWire, leafMap, prefix) {
    if (origWire.kind === "fifo") return leafMap.get(prefix) || null;
    const fields = new Map();
    let any = false;
    for (const [label, child] of origWire.fields.entries()) {
      const subPrefix = prefix ? `${prefix}.${label}` : label;
      const sub = this._buildBranchInWire(child, leafMap, subPrefix);
      if (sub !== null) { fields.set(label, sub); any = true; }
    }
    return any ? new BitWireBundle(fields, origWire.plist, origWire.nodeId) : null;
  }

  _makeDemux(plist, inDq, outBundle, scopeId) {
    const outLeaves = bitWireLeaves(outBundle);
    const leafDpdas = outLeaves.map(({ fifo }) => new BitPatternDPDA("copy", this.codec, fifo.plist, fifo.nodeId));
    return this._makeNode("DEMUX", `DEMUX(${outLeaves.length})`, inDq, outBundle, scopeId, {
      outLeaves,
      leafDpdas,
      leafIdx: 0
    });
  }

  _makeMux(inBundle, outDq, scopeId) {
    const inLeaves = bitWireLeaves(inBundle);
    return this._makeNode("MUX", `MUX(${inLeaves.length})`, inBundle, outDq, scopeId, {
      inLeaves,
      leafIdx: 0
    });
  }

  expandStub(stub) {
    if (this.enableCompiled) {
      const compiled = this.compilerV3.getCompiled(stub.relHash);
      if (compiled) {
        const { inWire, outWire, scopeId, barrier } = stub;
        const inLeaves = bitWireLeaves(inWire);
        const outLeaves = bitWireLeaves(outWire);
        if (inLeaves.length === compiled.inLeaves.length && outLeaves.length === compiled.outLeaves.length) {
          const bp = this.registry.getBlueprint(stub.relHash);
          this.telemetry.stubsExpanded++;
          this.telemetry.compiledNodesCreated++;
          stub.state = STATE.RETIRED;
          this.nodes.delete(stub.id);

          const chunkTbl = this.enableChunks ? this.chunkCompiler.getChunkTable(stub.relHash) : null;
          let kindTag;
          if (chunkTbl) {
            if (chunkTbl.kind === "loop") {
              const wDesc = chunkTbl.arity === 1 ? `${chunkTbl.W_raw0}b` : `${chunkTbl.W_raw0}bx${chunkTbl.W_raw1}b`;
              kindTag = `CHUNK_${wDesc}(${compiled.name})`;
            } else {
              kindTag = `FSM_CHUNK_${chunkTbl.W_raw0}b(${compiled.name})`;
            }
          } else {
            kindTag = compiled.isLoop ? `LOOP(${compiled.name})` : `FSM(${compiled.name})`;
          }
          const regSuffix = compiled.registerPorts.length > 0
            ? `[${compiled.registerPorts.map((p) => compiled.inLeaves[p].pathKey || `p${p}`).join(",")}]`
            : "";

          this._makeNode("COMPILED", `${kindTag}${regSuffix}`, inWire, outWire, scopeId, {
            compiled,
            bpInPlist: bp.inPlist,
            bpOutPlist: bp.outPlist,
            chunkTbl,
            inLeaves,
            outLeaves,
            curDNode: compiled.root,
            // Per-port dynamic union cursor schema for base 1-symbol V3 DAG mode
            portSchemaPlist: inLeaves.map((l, p) => (plistHasAny(bp.inPlist, compiled.inLeaves[p].nodeId) ? l.fifo.plist : bp.inPlist)),
            portSchemaNode: inLeaves.map((l, p) => (plistHasAny(bp.inPlist, compiled.inLeaves[p].nodeId) ? l.fifo.nodeId : compiled.inLeaves[p].nodeId)),
            peekBuf: inLeaves.map(() => []), // `{ tag, code, width }[]`
            portIsConst: inLeaves.map(() => false),
            portUnitDrained: inLeaves.map(() => false),
            pendingDrain: null,
            pendingLeaf: null,
            barrier
          });
          this._snapshot(`expand:${compiled.name}`);
          return;
        }
      }
    }
    const bp = this.registry.getBlueprint(stub.relHash);
    const { inWire, outWire, scopeId, relName, barrier } = stub;
    this.telemetry.stubsExpanded++;
    stub.state = STATE.RETIRED;
    this.nodes.delete(stub.id);
    this.instantiate(bp.root, inWire, outWire, scopeId, barrier);
    this._snapshot(`expand:${relName}`);
  }

  _settleStubInputs(stub) {
    if (!stub.inWire || this.registry.isFiniteRel(stub.relHash)) return "DONE";
    const paths = bitWireLeaves(stub.inWire).map((l) => l.pathKey);
    for (const pathKey of paths) {
      let progress = true;
      while (progress) {
        progress = false;
        const dq = bitWireAtPath(stub.inWire, pathKey);
        if (!dq || dq.kind !== "fifo" || !dq.alive) break;
        if (dq.failed) return "FAILED";
        if (dq.closed) break;
        const up = dq.upstream;
        if (!up || up.state === STATE.RETIRED || up.scopeId !== stub.scopeId) break;

        if (up.barrier && !up.barrier.done) {
          const bRes = this._ensureBarrier(up.barrier);
          if (bRes === "NEED_INPUT") return "NEED_INPUT";
          if (bRes === "FAILED") { this._failNode(up); return "FAILED"; }
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
        if (up.kind === "ID" && up.canBypass && up.state === STATE.ACTIVE) {
          if (this._trySpliceScalar(up, up.inFifo, up.outFifo, "idSplices")) {
            this.telemetry.eagerStubSettles++;
            progress = true;
            continue;
          }
        }
        if (up.kind === "VID" && up.canPrependSplice && !up.emittedTag && up.state === STATE.ACTIVE && !up.inFifo.failed) {
          if (this._trySpliceScalar(up, up.inFifo, up.outFifo, "vidPrependSplices", up.tagEntry)) {
            this.telemetry.eagerStubSettles++;
            progress = true;
            continue;
          }
        }
        if (
          up.kind === "DIV" && !up.matchedTag && up.state === STATE.ACTIVE &&
          (!up.barrier || up.barrier.done) && up.inFifo && up.inFifo.lenBits > 0
        ) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
        if (
          up.kind === "VID" && up.dpda.done && !up.emittedTag && up.state === STATE.ACTIVE &&
          up.inFifo?.upstream?.kind === "UNIT" && !up.inFifo.upstream.unitDrain &&
          (!up.inFifo.upstream.barrier || up.inFifo.upstream.barrier.done)
        ) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
        if (up.kind === "MULTI_SW" && up.state === STATE.ACTIVE) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
        if (up.kind === "STUB" && this.registry.isFiniteRel(up.relHash)) {
          this.expandStub(up);
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
        if (up.kind === "COMPILED" && up.state === STATE.ACTIVE && !up.compiled.isLoop) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
        if (up.kind === "MUX" && up.state === STATE.ACTIVE && this._isTailRecursiveMux(up)) {
          while (up.state === STATE.ACTIVE) {
            const r = this.stepNode(up);
            if (r === "NEED_INPUT") return "NEED_INPUT";
            if (r === "FAILED" || dq.failed) return "FAILED";
          }
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }
      }
    }
    return "DONE";
  }

  _retireTee(tee) {
    const inF = tee.inFifo;
    for (const bf of tee.branchDeques) if (bf.upstream === tee) bf.upstream = null;
    if (inF && inF.alive && inF.lenBits === 0 && (inF.closed || inF.failed)) {
      if (inF.upstream && (inF.upstream.state === STATE.DONE || inF.upstream.state === STATE.FAILED)) {
        this.retireNode(inF.upstream);
      }
      if (inF.scopeId === tee.scopeId && inF.name !== "IN") this.retireDeque(inF);
    }
    this.retireNode(tee);
  }

  _ensureTag(dq, plist, nodeId) {
    while (dq.alive) {
      const pk = this.codec.peekTag(dq, plist, nodeId);
      if (pk.status === "OK") return { status: "READY", entry: pk.entry };
      if (pk.status === "INVALID") return { status: "EOF_OR_FAIL" };
      if (dq.failed || dq.closed) return { status: "EOF_OR_FAIL" };
      if (!dq.upstream) return { status: "NEED_INPUT" };
      const up = dq.upstream;
      const r = up.kind === "REPLAY" ? this._stepReplayFeeder(up) : this.stepNode(up);
      if (r === "NEED_INPUT") return { status: "NEED_INPUT" };
    }
    return { status: "WAIT" };
  }

  _ensureBits(dq, minBits) {
    while (dq.alive && dq.lenBits < minBits) {
      if (dq.failed || dq.closed) return dq.lenBits > 0 ? "PARTIAL" : "EOF_OR_FAIL";
      if (!dq.upstream) return "NEED_INPUT";
      const up = dq.upstream;
      const r = up.kind === "REPLAY" ? this._stepReplayFeeder(up) : this.stepNode(up);
      if (r === "NEED_INPUT") return "NEED_INPUT";
    }
    if (!dq.alive) return "WAIT";
    return "READY";
  }

  _pullUpstreamOneStep(dq) {
    const before = dq.lenBits;
    while (dq.alive && dq.lenBits === before && !dq.failed && !dq.closed) {
      if (!dq.upstream) return "NEED_INPUT";
      const up = dq.upstream;
      const r = up.kind === "REPLAY" ? this._stepReplayFeeder(up) : this.stepNode(up);
      if (r === "NEED_INPUT") return "NEED_INPUT";
    }
    if (!dq.alive) return "WAIT";
    if (dq.lenBits > before) return "READY";
    if (dq.failed || dq.closed) return "EOF_OR_FAIL";
    return "READY";
  }

  stepNode(node) {
    if (!node || node.state === STATE.RETIRED || node.state === STATE.DONE) return "DONE";
    if (node.state === STATE.FAILED) return "FAILED";
    this.telemetry.schedulerSteps++;

    if (node.barrier && !node.barrier.done) {
      const bRes = this._ensureBarrier(node.barrier);
      if (bRes === "NEED_INPUT") return "NEED_INPUT";
      if (bRes === "FAILED") {
        return node.outLeaves ? this._failMultiOut(node, node.outLeaves) : this._failNode(node);
      }
      if (node.state === STATE.RETIRED) return "PROGRESS";
    }

    if (node.kind === "STUB") {
      const sRes = this._settleStubInputs(node);
      if (sRes === "NEED_INPUT") return "NEED_INPUT";
      if (sRes === "FAILED") {
        return node.outWire.kind === "fifo"
          ? this._failNode(node)
          : this._failMultiOut(node, bitWireLeaves(node.outWire));
      }
      if (node.state === STATE.RETIRED) return "PROGRESS";
      this.expandStub(node);
      return "PROGRESS";
    }

    switch (node.kind) {
      case "COMPILED":
        return this._stepCompiled(node);

      case "ID":
        if (node.canBypass && this._trySpliceScalar(node, node.inFifo, node.outFifo, "idSplices")) {
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);

      case "UNIT":
        if (node.unitDrain && !node.unitDrain.done) {
          const r = this._ensureBarrier(node.unitDrain);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED") return this._failNode(node);
        }
        return this._finishNode(node);

      case "DIV": {
        if (!node.matchedTag) {
          const inP = plistHasAny(node.inFifo.plist, node.inFifo.nodeId) ? node.inSchemaPlist : node.inFifo.plist;
          const inN = plistHasAny(node.inFifo.plist, node.inFifo.nodeId) ? 0 : node.inFifo.nodeId;
          const st = this._ensureTag(node.inFifo, inP, inN);
          if (st.status === "WAIT") return "PROGRESS";
          if (st.status === "NEED_INPUT") return "NEED_INPUT";
          if (st.status === "EOF_OR_FAIL") return this._failNode(node);
          if (st.entry.tag !== node.tag) return this._failNode(node);
          if (st.entry.width > 0) node.inFifo.shiftBits(st.entry.width);
          node.matchedTag = true;

          if (node.needsRuntimeSchema) {
            const rtEdge = node.inFifo.plist?.[node.inFifo.nodeId]?.[1]?.find(([t]) => t === node.tag);
            if (rtEdge && !plistHasAny(node.inFifo.plist, rtEdge[1]) && node.outFifo) {
              const rtTarget = rtEdge[1];
              if (plistHasAny(node.outFifo.plist, node.outFifo.nodeId)) {
                node.outFifo.plist = node.inFifo.plist;
                node.outFifo.nodeId = rtTarget;
              }
              const samePay =
                canonicalSubPlistKey(node.inFifo.plist, rtTarget) ===
                canonicalSubPlistKey(node.outFifo.plist, node.outFifo.nodeId);
              node.dpda = new BitPatternDPDA(
                samePay ? "copy" : "coerce",
                this.codec,
                node.inFifo.plist,
                rtTarget,
                node.outFifo.plist,
                node.outFifo.nodeId
              );
              node.canBypass = samePay && !node.barrier;
            }
          }
          if (node.dpda.done) return this._finishNode(node);
          if (node.canBypass && this._trySpliceScalar(node, node.inFifo, node.outFifo, "divSplices")) {
            return "PROGRESS";
          }
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "VID": {
        if (!node.emittedTag) {
          if (node.inFifo.failed) return this._failNode(node);
          if (
            node.needsRuntimeSchema &&
            node.inFifo.plist &&
            !plistHasAny(node.inFifo.plist, node.inFifo.nodeId) &&
            (plistHasAny(node.dpda.inPlist) || plistHasAny(node.outFifo.plist, node.outFifo.nodeId))
          ) {
            if (plistHasAny(node.outFifo.plist, node.outFifo.nodeId)) {
              const outEdge = node.outFifo.plist[node.outFifo.nodeId]?.[1]?.find(([t]) => t === node.tag);
              if (outEdge && plistHasAny(node.outFifo.plist, outEdge[1])) {
                node.outFifo.plist = graftUnionTagPayload(
                  node.outFifo.plist, node.outFifo.nodeId, node.tag, node.inFifo.plist, node.inFifo.nodeId
                );
              }
            }
            const outEdge = node.outFifo.plist?.[node.outFifo.nodeId]?.[1]?.find(([t]) => t === node.tag);
            const effOutPlist = outEdge ? node.outFifo.plist : node.dpda.outPlist;
            const effOutTarget = outEdge ? outEdge[1] : 0;
            const samePay =
              canonicalSubPlistKey(node.inFifo.plist, node.inFifo.nodeId) ===
              canonicalSubPlistKey(effOutPlist, effOutTarget);
            node.dpda = new BitPatternDPDA(
              samePay ? "copy" : "coerce",
              this.codec,
              node.inFifo.plist,
              node.inFifo.nodeId,
              effOutPlist,
              effOutTarget
            );
            node.canPrependSplice = !plistHasAny(node.inFifo.plist, node.inFifo.nodeId) && samePay && !node.dpda.done;
          }
          if (node.canPrependSplice && this._trySpliceScalar(node, node.inFifo, node.outFifo, "vidPrependSplices", node.tagEntry)) {
            return "PROGRESS";
          }
          if (node.tagEntry.width > 0) node.outFifo.pushBits(node.tagEntry.code, node.tagEntry.width);
          node.emittedTag = true;
          if (node.dpda.done) return this._finishNode(node);
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "TEE": {
        // Packed bit-level broadcast: up to 30 bits in ONE scheduler step!
        const st = this._ensureBits(node.inFifo, 1);
        if (st === "WAIT") return "PROGRESS";
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "EOF_OR_FAIL") {
          if (node.inFifo.failed) {
            node.state = STATE.FAILED;
            for (const bf of node.branchDeques) if (bf.alive) bf.markFailed();
            this._retireTee(node);
            return "FAILED";
          }
          node.state = STATE.DONE;
          for (const bf of node.branchDeques) if (bf.alive) bf.close();
          this._retireTee(node);
          return "DONE";
        }
        const w = node.inFifo.lenBits > 30 ? 30 : node.inFifo.lenBits;
        const bits = node.inFifo.shiftBits(w);
        for (const bf of node.branchDeques) if (bf.alive) bf.pushBits(bits, w);
        if (node.inFifo.alive && node.inFifo.lenBits === 0 && node.inFifo.closed && !node.inFifo.failed) {
          node.state = STATE.DONE;
          for (const bf of node.branchDeques) if (bf.alive) bf.close();
          this._retireTee(node);
          return "DONE";
        }
        return "PROGRESS";
      }

      case "DEMUX": {
        if (
          node.leafIdx === 0 &&
          node.inFifo && !node.inFifo.closed && !node.inFifo.failed &&
          node.inFifo.upstream?.kind === "MUX" &&
          node.inFifo.upstream.state === STATE.ACTIVE &&
          node.inFifo.upstream.scopeId === node.scopeId &&
          node.inFifo.upstream.leafIdx === 0 &&
          !this._isTailRecursiveMux(node.inFifo.upstream) &&
          !node.inFifo.upstream.barrier && !node.barrier &&
          node.inFifo.upstream.inLeaves.length === node.outLeaves.length
        ) {
          const mux = node.inFifo.upstream;
          const midDq = node.inFifo;
          const m = mux.inLeaves.length;
          let allMatch = true;
          for (let i = 0; i < m; i++) {
            const s = mux.inLeaves[i].fifo, d = node.outLeaves[i].fifo;
            if (!s.alive || canonicalSubPlistKey(s.plist, s.nodeId) !== canonicalSubPlistKey(d.plist, d.nodeId)) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            if (midDq.lenBits > 0) mux.inLeaves[0].fifo.unshiftFromDeque(midDq);
            this.retireNode(mux);
            this.retireNode(node);
            this.retireDeque(midDq);
            this.telemetry.muxDemuxFusions++;
            for (let i = 0; i < m; i++) this._wireCopy(mux.inLeaves[i].fifo, node.outLeaves[i].fifo, node.scopeId, null);
            return "PROGRESS";
          }
        }

        while (node.leafIdx < node.outLeaves.length) {
          const dpda = node.leafDpdas[node.leafIdx];
          const outDq = node.outLeaves[node.leafIdx].fifo;
          if (
            node.leafIdx === node.outLeaves.length - 1 && !dpda.done &&
            node.inFifo.name !== "IN" && !node.inFifo.failed &&
            this._trySpliceScalar(node, node.inFifo, outDq, "demuxTailSplices")
          ) {
            return "PROGRESS";
          }
          if (dpda.done) { outDq.close(); node.leafIdx++; continue; }
          const res = dpda.step(node.inFifo, outDq);
          if (res === "NEED_INPUT") {
            const st = this._pullUpstreamOneStep(node.inFifo);
            if (st === "WAIT") return "PROGRESS";
            if (st === "NEED_INPUT") return "NEED_INPUT";
            if (st === "EOF_OR_FAIL") return this._failMultiOut(node, node.outLeaves);
            continue;
          }
          if (res === "FAILED") return this._failMultiOut(node, node.outLeaves);
          if (res === "DONE") {
            outDq.close();
            node.leafIdx++;
            if (node.leafIdx >= node.outLeaves.length) {
              const fin = this._finishNode(node);
              if (fin === "DONE") {
                for (const { fifo } of node.outLeaves) if (fifo.upstream === node) fifo.upstream = null;
                this.retireNode(node);
              }
              return fin;
            }
            return "PROGRESS";
          }
          return "PROGRESS";
        }
        const fin = this._finishNode(node);
        if (fin === "DONE") {
          for (const { fifo } of node.outLeaves) if (fifo.upstream === node) fifo.upstream = null;
          this.retireNode(node);
        }
        return fin;
      }

      case "MUX": {
        while (node.leafIdx < node.inLeaves.length) {
          const inDq = node.inLeaves[node.leafIdx].fifo;
          const tailSafe =
            inDq.closed ||
            canonicalSubPlistKey(inDq.plist, inDq.nodeId) ===
              canonicalSubPlistKey(node.outFifo.plist, node.outFifo.nodeId);
          if (
            node.leafIdx === node.inLeaves.length - 1 && tailSafe && !inDq.failed &&
            this._trySpliceScalar(node, inDq, node.outFifo, "muxTailSplices")
          ) {
            return "PROGRESS";
          }
          if (inDq.lenBits > 0) {
            const w = inDq.lenBits > 30 ? 30 : inDq.lenBits;
            node.outFifo.pushBits(inDq.shiftBits(w), w);
            return "PROGRESS";
          }
          if (inDq.failed) return this._failNode(node);
          if (inDq.closed) {
            if (inDq.upstream && inDq.upstream.state === STATE.DONE) this.retireNode(inDq.upstream);
            if (inDq.scopeId === node.scopeId && inDq.name !== "IN") this.retireDeque(inDq);
            node.leafIdx++;
            continue;
          }
          const r = this._pullUpstreamOneStep(inDq);
          if (r === "NEED_INPUT") return "NEED_INPUT";
        }
        return this._finishNode(node);
      }

      case "MULTI_SW":
        return this._stepMultiSwitch(node);

      default:
        throw new Error(`Unknown V4 node kind: ${node.kind}`);
    }
  }

  _stepMultiSwitch(node) {
    if (node.committed) return this._finishMultiNode(node);
    for (const { fifo } of node.inLeaves) {
      if (fifo.failed) {
        if (node.activeScopeId !== null) {
          this.teardownScope(node.activeScopeId, true);
          node.activeScopeId = null;
        }
        return this._failMultiOut(node, node.outLeaves);
      }
    }

    if (node.candidates === null) {
      const peeked = new Map();
      for (const pathKey of node.peekPaths) {
        const dq = bitWireAtPath(node.inWire, pathKey);
        if (dq.kind !== "fifo") continue;
        const st = this._ensureTag(dq, dq.plist, dq.nodeId);
        if (st.status === "WAIT") return "PROGRESS";
        if (st.status === "NEED_INPUT") return "NEED_INPUT";
        if (st.status === "EOF_OR_FAIL") return this._failMultiOut(node, node.outLeaves);
        peeked.set(pathKey, st.entry.tag);
      }

      const matching = [];
      for (const b of node.branches) {
        let ok = true;
        for (const [p, allowed] of b.guards.entries()) {
          if (peeked.has(p) && !allowed.has(peeked.get(p))) { ok = false; break; }
        }
        if (ok) matching.push(b.blueprint);
      }
      if (matching.length === 0) return this._failMultiOut(node, node.outLeaves);
      if (matching.length === 1) {
        this.telemetry.deterministicDispatches++;
        const { inWire, outWire, scopeId } = node;
        node.state = STATE.RETIRED;
        this.nodes.delete(node.id);
        this.instantiate(matching[0], inWire, outWire, scopeId);
        return "PROGRESS";
      }

      node.candidates = matching;
      node.candIdx = 0;
      // Record raw bits per leaf in lightweight array of `[val, width]` chunks
      node.recorded = node.inLeaves.map(() => []);
      node.replayCursors = node.inLeaves.map(() => 0);
    }

    if (node.activeScopeId === null) {
      if (node.candIdx >= node.candidates.length) return this._failMultiOut(node, node.outLeaves);
      if (node.candIdx === node.candidates.length - 1) {
        const { inWire, outWire, scopeId, inLeaves, recorded } = node;
        const lastBp = node.candidates[node.candIdx];
        for (let k = 0; k < inLeaves.length; k++) {
          const rec = recorded[k];
          for (let i = rec.length - 1; i >= 0; i--) {
            inLeaves[k].fifo.unshiftBits(rec[i][0], rec[i][1], false);
          }
          rec.length = 0;
        }
        node.state = STATE.RETIRED;
        this.nodes.delete(node.id);
        this.telemetry.lastBranchSplices++;
        this.instantiate(lastBp, inWire, outWire, scopeId);
        return "PROGRESS";
      }

      this.telemetry.speculativeSwitches++;
      const childScope = this.nextScopeId++;
      node.activeScopeId = childScope;
      node.childScopeIds.add(childScope);
      for (let k = 0; k < node.replayCursors.length; k++) node.replayCursors[k] = 0;

      const branchInWire = this._buildReplayWire(node, node.inWire, childScope, "");
      const branchOutWire = this.createWire(node.outWire.plist, node.outWire.nodeId, `so${node.candIdx}`, childScope);
      node.branchOutLeaves = bitWireLeaves(branchOutWire);
      this.instantiate(node.candidates[node.candIdx], branchInWire, branchOutWire, childScope);
      return "PROGRESS";
    }

    const bOutLeaves = node.branchOutLeaves;
    while (true) {
      let anyFailed = false, allClosed = true;
      for (const { fifo } of bOutLeaves) {
        if (fifo.failed) anyFailed = true;
        if (!fifo.closed) allClosed = false;
      }
      if (anyFailed) {
        this.teardownScope(node.activeScopeId, true);
        node.activeScopeId = null;
        node.branchOutLeaves = null;
        for (const { fifo } of node.inLeaves) if (fifo.failed) return this._failMultiOut(node, node.outLeaves);
        this.telemetry.speculativeRollbacks++;
        node.candIdx++;
        return "PROGRESS";
      }
      if (allClosed) {
        for (let j = 0; j < bOutLeaves.length; j++) {
          const src = bOutLeaves[j].fifo, dst = node.outLeaves[j].fifo;
          while (src.lenBits > 0) {
            const w = src.lenBits > 30 ? 30 : src.lenBits;
            dst.pushBits(src.shiftBits(w), w);
          }
        }
        this.teardownScope(node.activeScopeId, false);
        node.activeScopeId = null;
        node.committed = true;
        return this._finishMultiNode(node);
      }
      for (const { fifo } of bOutLeaves) {
        if (!fifo.closed && !fifo.failed) {
          if (!fifo.upstream) return "NEED_INPUT";
          const r = fifo.upstream.kind === "REPLAY" ? this._stepReplayFeeder(fifo.upstream) : this.stepNode(fifo.upstream);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          break;
        }
      }
    }
  }

  _buildReplayWire(specNode, origWire, childScope, prefix) {
    if (origWire.kind === "fifo") {
      const leafIdx = specNode.inLeaves.findIndex((l) => l.pathKey === prefix);
      const feeder = this._makeNode("REPLAY", `REPLAY(${prefix || "*"})`, null, null, childScope, {
        specNode,
        leafIdx
      });
      const dq = this.createDeque(`si_${prefix || "v"}`, childScope, {
        path: prefix,
        plist: origWire.plist,
        nodeId: origWire.nodeId,
        upstream: feeder
      });
      feeder.outFifo = dq;
      return dq;
    }
    const fields = new Map();
    for (const [label, child] of origWire.fields.entries()) {
      const sub = prefix ? `${prefix}.${label}` : label;
      fields.set(label, this._buildReplayWire(specNode, child, childScope, sub));
    }
    return new BitWireBundle(fields, origWire.plist, origWire.nodeId);
  }

  _stepReplayFeeder(feeder) {
    const spec = feeder.specNode;
    const k = feeder.leafIdx;
    const rec = spec.recorded[k];
    if (spec.replayCursors[k] < rec.length) {
      const [val, w] = rec[spec.replayCursors[k]++];
      feeder.outFifo.pushBits(val, w);
      return "PROGRESS";
    }
    const parentDq = spec.inLeaves[k].fifo;
    const st = this._ensureBits(parentDq, 1);
    if (st === "WAIT") return "PROGRESS";
    if (st === "NEED_INPUT") return "NEED_INPUT";
    if (st === "EOF_OR_FAIL") {
      if (parentDq.failed) { feeder.state = STATE.FAILED; feeder.outFifo.markFailed(); return "FAILED"; }
      feeder.state = STATE.DONE;
      feeder.outFifo.close();
      return "DONE";
    }
    // Pull 1 bit at a time during speculation so rollback never over-pulls a sibling stream!
    // (Wait: if parentDq already has >1 bit buffered, pulling 1 bit preserves exact minimal lookahead!)
    const bit = parentDq.shiftBits(1);
    rec.push([bit, 1]);
    spec.replayCursors[k]++;
    feeder.outFifo.pushBits(bit, 1);
    return "PROGRESS";
  }

  // === COMPILED (FSM + LOOP + STRIDE-W SUPER-TRANSITION) EXECUTOR ON BITDEQUES ===

  _drainUnitClosedPort(node, p) {
    if (node.portUnitDrained[p]) return "DONE";
    const f = node.inLeaves[p].fifo;
    if (f.alive && f.upstream && f.upstream.kind !== "TEE" && f.upstream.kind !== "REPLAY" && f.upstream.kind !== "DEMUX") {
      while (f.alive && !f.closed && !f.failed) {
        const r = this.stepNode(f.upstream);
        if (r === "NEED_INPUT") return "NEED_INPUT";
        if (r === "FAILED" || f.failed) return "FAILED";
      }
      if (f.failed) return "FAILED";
    }
    if (f.failed) return "FAILED";
    if (f.alive && f.lenBits === 0 && f.closed) {
      if (f.upstream && f.upstream.state === STATE.DONE) this.retireNode(f.upstream);
      if (f.scopeId === node.scopeId && f.name !== "IN") this.retireDeque(f);
    }
    node.portUnitDrained[p] = true;
    return "DONE";
  }

  _readShiftTag(node, p) {
    const buf = node.peekBuf[p];
    if (buf.length > 0) return { status: "OK", entry: buf.shift() };
    if (node.portIsConst[p]) return { status: "FAIL" };
    const dq = node.inLeaves[p].fifo;
    const st = this._ensureTag(dq, node.portSchemaPlist[p], node.portSchemaNode[p]);
    if (st.status === "WAIT") return { status: "WAIT" };
    if (st.status === "NEED_INPUT") return { status: "NEED_INPUT" };
    if (st.status === "EOF_OR_FAIL") return { status: "FAIL" };
    if (st.entry.width > 0) dq.shiftBits(st.entry.width);
    // Advance union schema cursor on heterogeneous transitions (e.g. `int[]` -> `bits[]`!)
    if (st.entry.target !== node.portSchemaNode[p]) {
      const te = node.portSchemaPlist[p]?.[st.entry.target];
      if (te && (te[0] === "closed-union" || te[0] === "open-union")) {
        node.portSchemaNode[p] = st.entry.target;
      }
    }
    return { status: "OK", entry: st.entry };
  }

  _ensurePeekTag(node, p, depth) {
    const buf = node.peekBuf[p];
    while (buf.length <= depth) {
      if (node.portIsConst[p]) return { status: "FAIL" };
      const dq = node.inLeaves[p].fifo;
      const st = this._ensureTag(dq, node.portSchemaPlist[p], node.portSchemaNode[p]);
      if (st.status === "WAIT") return { status: "WAIT" };
      if (st.status === "NEED_INPUT") return { status: "NEED_INPUT" };
      if (st.status === "EOF_OR_FAIL") return { status: "FAIL" };
      if (st.entry.width > 0) dq.shiftBits(st.entry.width);
      buf.push(st.entry);
      if (st.entry.target !== node.portSchemaNode[p]) {
        const te = node.portSchemaPlist[p]?.[st.entry.target];
        if (te && (te[0] === "closed-union" || te[0] === "open-union")) {
          node.portSchemaNode[p] = st.entry.target;
        }
      }
    }
    return { status: "OK", entry: buf[depth] };
  }

  /**
   * Run variable-width `k-wire` bit-chunk transitions for BOTH `COMPILED_LOOP`s
   * (with don't-care key packing, sub-token guards, and closed-tail 1-padding)
   * AND `COMPILED_FSM`s (don't-care compressed & heterogeneous multi-schema chains!).
   */
  _tryChunkFastPath(node) {
    const stbl = node.chunkTbl;
    if (!stbl) return "DONE";

    // --- FSM Variable-Width Bit-Chunk Fast Path ---
    if (stbl.kind === "fsm") {
      if (node.portIsConst[0] || node.peekBuf[0].length > 0) return "FALLBACK";
      const W0 = stbl.W_raw0;
      const ext0 = stbl.extract0;
      const dq0 = node.inLeaves[0].fifo;
      let progressed = false;

      while (true) {
        const st = stbl.stateByDNodeId.get(node.curDNode.id);
        if (!st) break;
        let raw0;
        if (dq0.lenBits >= W0) {
          raw0 = dq0.peekBits(W0);
        } else {
          const e = this._ensureBits(dq0, W0);
          if (e === "WAIT") return "WAIT";
          if (e === "NEED_INPUT") return "NEED_INPUT";
          if (e === "READY") {
            raw0 = dq0.peekBits(W0);
          } else if (dq0.closed && !dq0.failed && dq0.lenBits > 0) {
            // For `dont-care` compressed tables, 1-pad guarantees all-ones invalid sentinel stops cleanly.
            // For `heterogeneous` tables, 0-pad + `c0 <= dq0.lenBits` guarantees ZERO padding bits were read!
            raw0 = stbl.canPadTail0 ? dq0.peekBitsPaddedOnes(W0) : dq0.peekBitsPadded(W0);
          } else {
            break;
          }
        }
        const key = ext0(raw0);
        const c0 = st.tblConsume[key];
        if (c0 === 0 || c0 > dq0.lenBits) break;
        dq0.shiftBits(c0);
        node.curDNode = st.tblNextDNode[key];
        if (stbl.fsmMode === "heterogeneous") {
          const ns = st.tblNextSchema[key];
          if (ns >= 0) node.portSchemaNode[0] = ns;
        }
        this.telemetry.fsmChunkSteps++;
        this.telemetry.fsmChunkTokensRetired += st.tblTokens[key];
        this.telemetry.chunkBitsConsumed += c0;
        progressed = true;
      }
      return progressed ? "CONTINUE" : "FALLBACK";
    }

    // --- LOOP Variable-Width Bit-Chunk Fast Path ---
    if (node.curDNode !== node.compiled.root) return "DONE";

    let regIdx = 0;
    const rp = stbl.regPort;
    if (rp >= 0) {
      if (!node.portIsConst[rp]) {
        if (node.peekBuf[rp].length === 0) {
          const r = this._ensurePeekTag(node, rp, 0);
          if (r.status !== "OK") return r.status === "WAIT" ? "WAIT" : (r.status === "NEED_INPUT" ? "NEED_INPUT" : "FALLBACK");
        }
        const dr = this._drainUnitClosedPort(node, rp);
        if (dr === "NEED_INPUT") return "NEED_INPUT";
        if (dr === "FAILED") return "FAILED";
        node.portIsConst[rp] = true;
      }
      if (node.peekBuf[rp].length !== 1) return "FALLBACK";
      regIdx = stbl.regTagToIdx.get(node.peekBuf[rp][0].tag);
      if (regIdx === undefined) return "FALLBACK";
    }

    const saveReg = () => {
      if (rp >= 0) {
        const newTag = stbl.regTags[regIdx];
        const ent = this.codec.encodeTag(node.portSchemaPlist[rp], node.portSchemaNode[rp], newTag);
        node.peekBuf[rp] = [ent];
      }
    };

    const p0 = stbl.streamPort0;
    if (node.portIsConst[p0] || node.peekBuf[p0].length > 0) return "FALLBACK";
    const accP = stbl.accPort;
    if (accP >= 0 && (node.portIsConst[accP] || node.peekBuf[accP].length > 0)) return "FALLBACK";
    const accDq = accP >= 0 ? node.inLeaves[accP].fifo : null;

    // Peek-guarded accumulator check (uses SUB-TOKEN bit-prefix when available, e.g. 1 bit of `x` in `lsb_shl`!)
    if (stbl.guardPrefix && accDq) {
      const gp = stbl.guardPrefix;
      if (accDq.lenBits < gp.prefixBits) {
        const e = this._ensureBits(accDq, gp.prefixBits);
        if (e === "WAIT") { saveReg(); return "WAIT"; }
        if (e === "NEED_INPUT") { saveReg(); return "NEED_INPUT"; }
        if (e !== "READY") { saveReg(); return "FALLBACK"; }
      }
      if (accDq.peekBits(gp.prefixBits) !== gp.prefixCode) { saveReg(); return "FALLBACK"; }
      this.telemetry.subTokenGuardHits++;
    } else if (stbl.guardValidTags && accDq) {
      const g = this._ensureTag(accDq, node.portSchemaPlist[accP], node.portSchemaNode[accP]);
      if (g.status === "WAIT") { saveReg(); return "WAIT"; }
      if (g.status === "NEED_INPUT") { saveReg(); return "NEED_INPUT"; }
      if (g.status !== "READY" || !stbl.guardValidTags.has(g.entry.tag)) { saveReg(); return "FALLBACK"; }
    }

    if (stbl.arity === 1) {
      const { W_raw0: W0, keyBits0, extract0, canPadTail0, tblIters, tblConsume0, tblEmitBits, tblEmitCode, tblNextReg } = stbl;
      while (true) {
        const dq0 = node.inLeaves[p0].fifo;
        let raw0;
        if (dq0.lenBits >= W0) {
          raw0 = dq0.peekBits(W0);
        } else {
          const e = this._ensureBits(dq0, W0);
          if (e === "WAIT") { saveReg(); return "WAIT"; }
          if (e === "NEED_INPUT") { saveReg(); return "NEED_INPUT"; }
          if (e === "READY") {
            raw0 = dq0.peekBits(W0);
          } else if (canPadTail0 && dq0.closed && !dq0.failed && dq0.lenBits > 0) {
            raw0 = dq0.peekBitsPaddedOnes(W0);
          } else {
            break;
          }
        }
        const idx = (regIdx << keyBits0) | extract0(raw0);
        const iters = tblIters[idx];
        if (iters === 0) break;
        const c0 = tblConsume0[idx];
        if (c0 > dq0.lenBits) break;
        dq0.shiftBits(c0);
        const eBits = tblEmitBits[idx];
        if (eBits > 0 && accDq) accDq.unshiftBits(tblEmitCode[idx], eBits);
        regIdx = tblNextReg[idx];
        this.telemetry.strideSuperSteps++;
        this.telemetry.strideIterationsRetired += iters;
        this.telemetry.chunkBitsConsumed += c0;
        this.telemetry.compiledLoopIterations += iters;
      }
    } else {
      const p1 = stbl.streamPort1;
      if (node.portIsConst[p1] || node.peekBuf[p1].length > 0) { saveReg(); return "FALLBACK"; }
      const {
        W_raw0: W0, W_raw1: W1, keyBits1, totalKeyBits,
        extract0, extract1, canPadTail0, canPadTail1,
        tblIters, tblConsume0, tblConsume1, tblEmitBits, tblEmitCode, tblNextReg
      } = stbl;
      while (true) {
        const dq0 = node.inLeaves[p0].fifo;
        const dq1 = node.inLeaves[p1].fifo;
        let raw0;
        if (dq0.lenBits >= W0) {
          raw0 = dq0.peekBits(W0);
        } else {
          const e = this._ensureBits(dq0, W0);
          if (e === "WAIT") { saveReg(); return "WAIT"; }
          if (e === "NEED_INPUT") { saveReg(); return "NEED_INPUT"; }
          if (e === "READY") {
            raw0 = dq0.peekBits(W0);
          } else if (canPadTail0 && dq0.closed && !dq0.failed && dq0.lenBits > 0) {
            raw0 = dq0.peekBitsPaddedOnes(W0);
          } else {
            break;
          }
        }
        let raw1;
        if (dq1.lenBits >= W1) {
          raw1 = dq1.peekBits(W1);
        } else {
          const e = this._ensureBits(dq1, W1);
          if (e === "WAIT") { saveReg(); return "WAIT"; }
          if (e === "NEED_INPUT") { saveReg(); return "NEED_INPUT"; }
          if (e === "READY") {
            raw1 = dq1.peekBits(W1);
          } else if (canPadTail1 && dq1.closed && !dq1.failed && dq1.lenBits > 0) {
            raw1 = dq1.peekBitsPaddedOnes(W1);
          } else {
            break;
          }
        }
        const idx = (regIdx << totalKeyBits) | (extract0(raw0) << keyBits1) | extract1(raw1);
        const iters = tblIters[idx];
        if (iters === 0) break;
        const c0 = tblConsume0[idx];
        const c1 = tblConsume1[idx];
        if (c0 > dq0.lenBits || c1 > dq1.lenBits) break;
        dq0.shiftBits(c0);
        dq1.shiftBits(c1);
        const eBits = tblEmitBits[idx];
        if (eBits > 0 && accDq) accDq.unshiftBits(tblEmitCode[idx], eBits);
        regIdx = tblNextReg[idx];
        this.telemetry.strideSuperSteps++;
        this.telemetry.strideIterationsRetired += iters;
        this.telemetry.chunkBitsConsumed += c0 + c1;
        this.telemetry.compiledLoopIterations += iters;
      }
    }

    saveReg();
    return "FALLBACK";
  }

  _stepCompiled(node) {
    const comp = node.compiled;

    if (node.pendingDrain) {
      const bRes = this._ensureBarrier(node.pendingDrain);
      if (bRes === "NEED_INPUT") return "NEED_INPUT";
      if (bRes === "FAILED") return this._failMultiOut(node, node.outLeaves);
      node.pendingDrain = null;
      const leaf = node.pendingLeaf;
      node.pendingLeaf = null;
      return this._commitCompiledLeaf(node, leaf);
    }

    while (true) {
      // Variable-width `k-wire` bit-chunk fast path (for BOTH `LOOP`s and `FSM`s!)
      if (node.chunkTbl) {
        const fs = this._tryChunkFastPath(node);
        if (fs === "WAIT") return "PROGRESS";
        if (fs === "NEED_INPUT") return "NEED_INPUT";
        if (fs === "FAILED") return this._failMultiOut(node, node.outLeaves);
      }

      const d = node.curDNode;
      if (d.kind === "fail") return this._failMultiOut(node, node.outLeaves);

      if (d.kind === "shift") {
        const res = this._readShiftTag(node, d.p);
        if (res.status === "WAIT") return "PROGRESS";
        if (res.status === "NEED_INPUT") return "NEED_INPUT";
        if (res.status === "FAIL") return this._failMultiOut(node, node.outLeaves);
        const next = d.cases[res.entry.tag];
        if (!next) return this._failMultiOut(node, node.outLeaves);
        node.curDNode = next;
        continue;
      }

      if (d.kind === "peek") {
        const res = this._ensurePeekTag(node, d.p, d.depth);
        if (res.status === "WAIT") return "PROGRESS";
        if (res.status === "NEED_INPUT") return "NEED_INPUT";
        if (res.status === "FAIL") return this._failMultiOut(node, node.outLeaves);
        const next = d.cases[res.entry.tag];
        if (!next) return this._failMultiOut(node, node.outLeaves);
        node.curDNode = next;
        continue;
      }

      if (d.kind === "loop" || d.kind === "emit") {
        for (const p of d.unitClosedPorts) {
          const dr = this._drainUnitClosedPort(node, p);
          if (dr === "NEED_INPUT") return "NEED_INPUT";
          if (dr === "FAILED") return this._failMultiOut(node, node.outLeaves);
        }
        const toDrain = [];
        const portsList = d.kind === "loop" ? d.drainOncePorts : d.drainPorts;
        for (const p of portsList) {
          if (node.portIsConst[p]) { node.peekBuf[p].length = 0; continue; }
          const dq = node.inLeaves[p].fifo;
          const buf = node.peekBuf[p];
          for (let i = buf.length - 1; i >= 0; i--) {
            if (buf[i].width > 0) dq.unshiftBits(buf[i].code, buf[i].width, false);
          }
          buf.length = 0;
          if (dq.lenBits === 0 && dq.closed && !dq.failed) {
            const dr = this._drainUnitClosedPort(node, p);
            if (dr === "NEED_INPUT") return "NEED_INPUT";
            if (dr === "FAILED") return this._failMultiOut(node, node.outLeaves);
            continue;
          }
          toDrain.push(node.inLeaves[p]);
          if (d.kind === "loop") node.portUnitDrained[p] = true;
        }
        if (toDrain.length > 0) {
          const barrier = this._createDrainBarrier(toDrain, node.scopeId);
          const bRes = this._ensureBarrier(barrier);
          if (bRes === "NEED_INPUT") { node.pendingDrain = barrier; node.pendingLeaf = d; return "NEED_INPUT"; }
          if (bRes === "FAILED") return this._failMultiOut(node, node.outLeaves);
        }

        if (d.kind === "loop") {
          this.telemetry.compiledLoopIterations++;
          for (let p = 0; p < comp.inCount; p++) {
            const e = d.nextExprs[p];
            if (e.kind === "const") {
              node.peekBuf[p] = e.tokens.map((t) => this.codec.encodeTag(node.portSchemaPlist[p], node.portSchemaNode[p], t));
              node.portIsConst[p] = true;
            } else if (e.kind === "splice") {
              if (node.portIsConst[p]) {
                const rem = node.peekBuf[p].slice(e.consumeCount);
                const pre = e.prefix.map((t) => this.codec.encodeTag(node.portSchemaPlist[p], node.portSchemaNode[p], t));
                node.peekBuf[p] = [...pre, ...rem];
              } else {
                const dq = node.inLeaves[p].fifo;
                // Restore any unconsumed peeked entries (without counting as new transfer)
                const buf = node.peekBuf[p];
                if (e.unconsumed && e.unconsumed.length > 0) {
                  const startIdx = buf.length - e.unconsumed.length;
                  for (let i = buf.length - 1; i >= startIdx; i--) {
                    if (buf[i].width > 0) dq.unshiftBits(buf[i].code, buf[i].width, false);
                  }
                }
                buf.length = 0;
                // Prepend newly synthesized tags (counted!)
                if (e.newPrefix && e.newPrefix.length > 0) {
                  for (let i = e.newPrefix.length - 1; i >= 0; i--) {
                    this.codec.unshiftTag(dq, node.portSchemaPlist[p], node.portSchemaNode[p], e.newPrefix[i]);
                  }
                }
              }
            }
          }
          node.curDNode = comp.root;
          continue;
        }

        return this._commitCompiledLeaf(node, d);
      }
    }
  }

  _commitCompiledLeaf(node, d) {
    const comp = node.compiled;
    const scopeId = node.scopeId;
    this.telemetry.compiledFsmHits++;
    node.state = STATE.RETIRED;
    this.nodes.delete(node.id);

    const materializeExprToDeque = (e, outDq, outSchemaPlist, outSchemaNode) => {
      if (e.kind === "const") {
        let curP = outSchemaPlist;
        let curN = outSchemaNode;
        for (const tok of e.tokens) {
          const ent = this.codec.pushTag(outDq, curP, curN, tok);
          curN = ent.target;
        }
        outDq.close();
        if (outDq.upstream === node) outDq.upstream = null;
        return;
      }
      if (e.kind === "splice") {
        const p = e.p;
        if (node.portIsConst[p]) {
          let curN = outSchemaNode;
          for (const tok of e.prefix) {
            const ent = this.codec.pushTag(outDq, outSchemaPlist, curN, tok);
            curN = ent.target;
          }
          const rem = node.peekBuf[p].slice(e.consumeCount);
          for (const item of rem) {
            const ent = this.codec.pushTag(outDq, outSchemaPlist, curN, item.tag);
            curN = ent.target;
          }
          outDq.close();
          if (outDq.upstream === node) outDq.upstream = null;
          return;
        }
        const inDq = node.inLeaves[p].fifo;
        const buf = node.peekBuf[p];
        if (e.unconsumed && e.unconsumed.length > 0) {
          const startIdx = buf.length - e.unconsumed.length;
          for (let i = buf.length - 1; i >= startIdx; i--) {
            if (buf[i].width > 0) inDq.unshiftBits(buf[i].code, buf[i].width, false);
          }
        }
        buf.length = 0;
        if (e.newPrefix && e.newPrefix.length > 0) {
          for (let i = e.newPrefix.length - 1; i >= 0; i--) {
            this.codec.unshiftTag(inDq, outSchemaPlist, outSchemaNode, e.newPrefix[i]);
          }
        }
        if (!inDq.failed && this._trySpliceScalar(null, inDq, outDq, "idSplices")) return;
        this._wireCopy(inDq, outDq, scopeId, null);
        return;
      }
      if (e.kind === "cont") {
        const contInWire = this.createWire(e.bp.inPlist, 0, `ce${this.nextFifoId}`, scopeId);
        const contInLeaves = bitWireLeaves(contInWire);
        this.instantiate(e.bp, contInWire, outDq, scopeId, null);
        for (let k = 0; k < contInLeaves.length; k++) {
          const lf = contInLeaves[k].fifo;
          materializeExprToDeque(e.inExprs[k], lf, lf.plist, lf.nodeId);
        }
      }
    };

    for (let q = 0; q < comp.outCount; q++) {
      const outDq = node.outLeaves[q].fifo;
      materializeExprToDeque(d.outExprs[q], outDq, node.bpOutPlist, comp.outLeaves[q].nodeId);
    }
    return "PROGRESS";
  }

  _stepDPDANode(node, dpda, inFifo, outFifo) {
    const res = dpda.step(inFifo, outFifo);
    if (res === "DONE") return this._finishNode(node);
    if (res === "FAILED") return this._failNode(node);
    if (res === "NEED_INPUT") {
      const r = this._pullUpstreamOneStep(inFifo);
      if (r === "NEED_INPUT") return "NEED_INPUT";
      return "PROGRESS";
    }
    return "PROGRESS";
  }

  _finishNode(node) {
    const inF = node.inFifo;
    if (inF && inF.alive && inF.upstream && inF.upstream.kind !== "TEE" && inF.upstream.kind !== "REPLAY" && inF.upstream.kind !== "DEMUX") {
      while (inF.alive && !inF.closed && !inF.failed) {
        const res = this.stepNode(inF.upstream);
        if (res === "NEED_INPUT") return "NEED_INPUT";
        if (res === "FAILED" || inF.failed) break;
      }
      if (inF.failed) return this._failNode(node);
    }
    node.state = STATE.DONE;
    if (node.outFifo) {
      node.outFifo.close();
      if (node.outFifo.upstream === node) node.outFifo.upstream = null;
    }
    if (inF && inF.alive && inF.lenBits === 0 && inF.closed) {
      if (inF.upstream && inF.upstream.state === STATE.DONE) this.retireNode(inF.upstream);
      if (inF.scopeId === node.scopeId && inF.name !== "IN") this.retireDeque(inF);
    }
    if (node.kind !== "DEMUX") this.retireNode(node);
    return "DONE";
  }

  _finishMultiNode(node) {
    for (const { fifo } of node.inLeaves) {
      if (fifo.alive && fifo.upstream && fifo.upstream.kind !== "TEE" && fifo.upstream.kind !== "REPLAY" && fifo.upstream.kind !== "DEMUX") {
        while (fifo.alive && !fifo.closed && !fifo.failed) {
          const res = this.stepNode(fifo.upstream);
          if (res === "NEED_INPUT") return "NEED_INPUT";
          if (res === "FAILED" || fifo.failed) break;
        }
        if (fifo.failed) return this._failMultiOut(node, node.outLeaves);
      }
    }
    node.state = STATE.DONE;
    for (const { fifo } of node.outLeaves) {
      fifo.close();
      if (fifo.upstream === node) fifo.upstream = null;
    }
    for (const { fifo } of node.inLeaves) {
      if (fifo.alive && fifo.lenBits === 0 && fifo.closed) {
        if (fifo.upstream && fifo.upstream.state === STATE.DONE) this.retireNode(fifo.upstream);
        if (fifo.scopeId === node.scopeId && fifo.name !== "IN") this.retireDeque(fifo);
      }
    }
    this.retireNode(node);
    return "DONE";
  }

  _failNode(node) {
    node.state = STATE.FAILED;
    if (node.outFifo) node.outFifo.markFailed();
    return "FAILED";
  }

  _failMultiOut(node, outLeaves) {
    node.state = STATE.FAILED;
    for (const { fifo } of outLeaves) fifo.markFailed();
    return "FAILED";
  }

  _snapshot(event) {
    if (this.onSnapshot) this.onSnapshot(event, this);
  }

  runValue(relHash, inputValue) {
    const bp = this.registry.getBlueprint(relHash);
    const rootScope = 0;

    const rootInFlat = this.createDeque("IN", rootScope, { plist: bp.inPlist, nodeId: 0 });
    this.codec.serializeValueToDeque(inputValue, bp.inPlist, rootInFlat, 0);
    const inBits = rootInFlat.lenBits;
    rootInFlat.close();

    let entryWire = rootInFlat;
    if (bp.inPlist[0][0] === "closed-product" && bp.inPlist[0][1].length > 0) {
      entryWire = this.createWire(bp.inPlist, 0, "", rootScope);
      this._makeDemux(bp.inPlist, rootInFlat, entryWire, rootScope);
    }

    const rootOutFlat = this.createDeque("OUT", rootScope, { plist: bp.outPlist, nodeId: 0 });
    let exitWire = rootOutFlat;
    if (bp.outPlist[0][0] === "closed-product" && bp.outPlist[0][1].length > 0) {
      exitWire = this.createWire(bp.outPlist, 0, "out", rootScope);
      this._makeMux(exitWire, rootOutFlat, rootScope);
    }

    this.instantiate(
      { kind: "stub", relHash, relName: bp.name, inPlist: bp.inPlist, outPlist: bp.outPlist },
      entryWire,
      exitWire,
      rootScope
    );
    this._snapshot(`init:${bp.name}`);

    while (true) {
      if (rootOutFlat.failed) {
        this._snapshot(`failed:${bp.name}`);
        for (const n of [...this.nodes.values()]) this.retireNode(n);
        return { ok: false, value: undefined, inBits, outBits: 0, telemetry: { ...this.telemetry } };
      }
      if (rootOutFlat.closed) {
        this._snapshot(`done:${bp.name}`);
        const outBits = rootOutFlat.lenBits;
        const { bytes: outBytes } = rootOutFlat.toBytes();
        const value = this.codec.deserializeDequeToValue(rootOutFlat, bp.outPlist, 0);
        for (const n of [...this.nodes.values()]) this.retireNode(n);
        return { ok: true, value, inBits, outBits, outBytes, telemetry: { ...this.telemetry } };
      }
      const res = this._pullUpstreamOneStep(rootOutFlat);
      if (res === "NEED_INPUT") throw new Error(`BitPackedTransducerNetworkV4 stalled on ${bp.name}`);
    }
  }

  toMermaid() {
    const lines = ["flowchart LR"];
    const esc = (s) => String(s).replace(/"/g, "'");

    let hasIn = false;
    let hasOut = false;
    for (const f of this.fifos.values()) {
      if (!f.alive) continue;
      if (!f.upstream && f.name === "IN") hasIn = true;
      if (!f.downstream && f.name === "OUT") hasOut = true;
    }
    if (hasIn) lines.push(`  ROOT_IN(["IN"])`);
    if (hasOut) lines.push(`  ROOT_OUT(["OUT"])`);

    for (const n of this.nodes.values()) {
      if (n.state === STATE.RETIRED) continue;
      const nid = `N${n.id}`;
      if (n.kind === "STUB") {
        lines.push(`  ${nid}[["${esc(n.label)}"]]:::stub`);
      } else if (n.kind === "COMPILED") {
        const cls = n.chunkTbl ? "stride" : "compiled";
        lines.push(`  ${nid}["${esc(n.label)}"]:::${cls}`);
      } else if (n.kind === "MULTI_SW") {
        lines.push(`  ${nid}{"${esc(n.label)}"}:::switch`);
      } else if (n.kind === "TEE" || n.kind === "DEMUX" || n.kind === "MUX") {
        lines.push(`  ${nid}(["${esc(n.label)}"]):::mux`);
      } else if (n.kind === "DRAIN") {
        lines.push(`  ${nid}["${esc(n.label)}"]:::drain`);
      } else {
        const suffix = n.state === STATE.DONE ? " ✓" : n.state === STATE.FAILED ? " ✗" : "";
        lines.push(`  ${nid}["${esc(n.label + suffix)}"]`);
      }
    }

    for (const f of this.fifos.values()) {
      if (!f.alive) continue;
      let src = f.upstream && f.upstream.state !== STATE.RETIRED
        ? `N${f.upstream.id}`
        : (!f.upstream && f.name === "IN" ? "ROOT_IN" : null);
      const dst = f.downstream && f.downstream.state !== STATE.RETIRED
        ? `N${f.downstream.id}`
        : (!f.downstream && f.name === "OUT" ? "ROOT_OUT" : null);
      if (!src && dst && f.name !== "IN" && f.name !== "OUT") {
        src = `BUF_${f.id}`;
        const bufLabel = `buf:${f.name}${f.lenBits > 0 ? ` (${f.lenBits}b)` : ""}`;
        lines.push(`  ${src}(["${esc(bufLabel)}"]):::buf`);
      }
      if (src && dst) {
        const bitInfo = f.lenBits > 0 ? `${f.name} (${f.lenBits}b)` : f.name;
        lines.push(`  ${src} -->|"${esc(bitInfo)}"| ${dst}`);
      }
    }

    lines.push("  classDef stub fill:#1e1e2e,color:#cdd6f4,stroke:#f38ba8,stroke-width:2px");
    lines.push("  classDef stride fill:#ede9fe,color:#4c1d95,stroke:#7c3aed,stroke-width:2px");
    lines.push("  classDef compiled fill:#f5f3ff,color:#5b21b6,stroke:#8b5cf6,stroke-width:1.5px");
    lines.push("  classDef switch fill:#fef3c7,color:#78350f,stroke:#d97706");
    lines.push("  classDef mux fill:#dbeafe,color:#1e3a8a,stroke:#2563eb");
    lines.push("  classDef drain fill:#f3f4f6,color:#6b7280,stroke:#9ca3af,stroke-dasharray: 4 2");
    lines.push("  classDef buf fill:#dcfce7,color:#166534,stroke:#16a34a");
    return lines.join("\n");
  }
}
