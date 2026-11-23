/**
 * Iteration 2: Multi-Port JIT-Expanded Pushdown Transducer Network.
 *
 * Key upgrades over Iteration 1:
 *   1. Parallel Product Wires (`WireBundle`): products travel as M parallel
 *      `TokenDeque` leaf channels — ZERO `CONCAT` serialization between stages!
 *   2. Zero-Copy Field Routing: `Product` inspects `usedPaths` and wires any
 *      leaf read by 1 branch directly into that branch (no `TEE`!); untouched
 *      fields pass straight through tail loops with 0 tokens copied.
 *   3. O(1) `VID` Prepend-Splicing: `|0` / `|1` on an unshared internal deque
 *      prepends the tag via `deque.unshift(tag)` and splices the deque straight
 *      into its downstream consumer — turning `_rev_bits` and `_lsb_sub`
 *      accumulators from O(n^2) to O(n)!
 *   4. Multi-Port Prefix Filtering (`MULTI_SW`): peeks head tokens on guarded
 *      leaf paths (`x`, `y`, `b`, `sub.b`, etc.) to prune impossible branches
 *      BEFORE instantiating them. When 1 candidate remains, splices directly
 *      with ZERO speculation and ZERO rollbacks!
 *   5. Sound Partiality (`DrainBarrier`): unused wires from `.field` or `Product`
 *      are drained before downstream commits so guards/failures are never dropped.
 */

import { PatternDPDA } from "../dpda.mjs";
import { canonicalSubPlistKey, plistHasAny, graftUnionTagPayload } from "./blueprint.mjs";
import {
  TokenDeque,
  WireBundle,
  wireLeaves,
  wireAtPath
} from "./wires.mjs";

const STATE = {
  STUB: "STUB",
  ACTIVE: "ACTIVE",
  DONE: "DONE",
  FAILED: "FAILED",
  RETIRED: "RETIRED"
};

export class MultiPortTransducerNetwork {
  constructor(registry, { onSnapshot = null, strategy = "eager-settle", zeroCopyStack = true, tailSettleCons = true } = {}) {
    this.registry = registry;
    this.onSnapshot = onSnapshot;
    this.strategy = strategy;
    this.eagerSettle = strategy !== "lazy";
    this.zeroCopyStack = this.eagerSettle && zeroCopyStack;
    this.tailSettleCons = this.zeroCopyStack && tailSettleCons;
    this.nextNodeId = 1;
    this.nextFifoId = 1;
    this.nextScopeId = 1;

    this.nodes = new Map();
    this.fifos = new Map();

    this.telemetry = {
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
      totalTokensTransferred: 0,
      liveFifoTokens: 0,
      peakFifoTokens: 0,
      schedulerSteps: 0
    };
  }

  _updatePeakNodes() {
    const active = this.nodes.size;
    if (active > this.telemetry.peakActiveNodes) {
      this.telemetry.peakActiveNodes = active;
    }
    if (this.fifos.size > this.telemetry.peakLiveFifos) {
      this.telemetry.peakLiveFifos = this.fifos.size;
    }
  }

  /**
   * Returns `true` when `mux` constructs a self-recursive union cell (e.g. `_k_stack[]`
   * `|cons` where the last field `cdr` has the same canonical schema as `mux.outFifo`).
   * For these cells, materializing fields `0..m-2` (`car`) and tail-splicing field `m-1`
   * (`cdr`) in O(1) avoids copying the stack tail while evaluating each pushed frame
   * eagerly so recursive subtrees don't pile up lazily in memory!
   */
  _isTailRecursiveMux(mux) {
    return Boolean(mux && mux.kind === "MUX" && mux.isTailRecursive);
  }

  createDeque(name, scopeId, { path = "", plist = null, nodeId = 0, upstream = null, downstream = null } = {}) {
    const id = this.nextFifoId++;
    const dq = new TokenDeque(id, {
      name: name || `F${id}`,
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
      return new WireBundle(fields, plist, nodeId);
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
    if (node.kind === "STUB" && node.state === STATE.STUB) {
      this.telemetry.stubsNeverExpanded++;
    }
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
    for (const { fifo } of wireLeaves(wire)) {
      fifo.downstream = node;
    }
  }

  attachWireUpstream(wire, node) {
    for (const { fifo } of wireLeaves(wire)) {
      fifo.upstream = node;
    }
  }

  /**
   * Splice an upstream scalar deque `inDq` directly into the downstream consumer
   * of `outDq` (replacing `outDq`), preserving any prefix tokens already
   * prepended onto `outDq` (e.g. from a downstream `VID` prepend-splice), and
   * retire `node` + `outDq`.
   */
  _trySpliceScalar(node, inDq, outDq, counterKey, prependTag = null) {
    if (!inDq || !outDq || !outDq.downstream) return false;
    if (!this.eagerSettle && outDq.hasToken()) return false;
    if (inDq.scopeId !== outDq.scopeId) return false;
    const down = outDq.downstream;
    if (down.kind === "MULTI_SW" && down.activeScopeId !== null) return false;
    // Only splice into a node whose input references `outDq` via single `inFifo`
    // or inside a WireBundle leaf!
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
        if (d.fifo === outDq) {
          d.fifo = inDq;
          replaced = true;
        }
      }
      if (!replaced) return false;
      inDq.downstream = down;
    } else {
      return false;
    }
    // Also update any barrier or multi-leaf refs on `down`
    if (down.inLeaves) {
      for (const l of down.inLeaves) {
        if (l.fifo === outDq) l.fifo = inDq;
      }
    }
    // Preserve token order: [outDq existing prefix] -> [prependTag] -> [inDq tokens]
    if (outDq.hasToken()) {
      const prefix = [];
      while (outDq.hasToken()) prefix.push(outDq.shift());
      if (prependTag !== null) inDq.unshift(prependTag);
      inDq.unshiftTokens(prefix);
    } else if (prependTag !== null) {
      inDq.unshift(prependTag);
    }
    // Preserve concrete runtime schema if outDq contains an unspecialized `any`
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
      if (child === oldDq) {
        wire.fields.set(label, newDq);
        return true;
      }
      if (child.kind === "bundle" && this._replaceWireLeaf(child, oldDq, newDq)) {
        return true;
      }
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
            if (!scopesToKill.has(cid)) {
              scopesToKill.add(cid);
              changed = true;
            }
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
      if (scopesToKill.has(f.scopeId)) {
        this.retireDeque(f);
      }
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

  /**
   * Connect `inWire` to `outWire` (leaf-for-leaf identity / coercion), optionally
   * gated on a shared `barrier` of discarded sibling wires.
   */
  _wireCopy(inWire, outWire, scopeId, barrier = null) {
    const inL = wireLeaves(inWire);
    const outL = wireLeaves(outWire);
    if (inL.length !== outL.length) {
      throw new Error(`_wireCopy leaf mismatch: ${inL.length} vs ${outL.length}`);
    }
    for (let i = 0; i < inL.length; i++) {
      const inDq = inL[i].fifo;
      const outDq = outL[i].fifo;
      const samePat = this.eagerSettle
        ? (
            plistHasAny(outDq.plist, outDq.nodeId) ||
            canonicalSubPlistKey(inDq.plist, inDq.nodeId) === canonicalSubPlistKey(outDq.plist, outDq.nodeId)
          )
        : JSON.stringify(inDq.plist?.[inDq.nodeId]) === JSON.stringify(outDq.plist?.[outDq.nodeId]);
      // Eager zero-node splice for pure unguarded identity passthrough!
      if (samePat && (!barrier || (this.eagerSettle && barrier.done)) && this._trySpliceScalar(null, inDq, outDq, "idSplices")) {
        continue;
      }
      const dpda = new PatternDPDA(
        "coerce",
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
      if (this.eagerSettle && barrier && !barrier.done && samePat) {
        barrier.waiters.push(idNode);
      }
    }
  }

  /**
   * Create a shared drain barrier for a list of unused input leaf `TokenDeque`s.
   * Any downstream node holding this barrier must run `_ensureBarrier(barrier)`
   * before emitting/committing so guards on discarded fields always execute!
   */
  _createDrainBarrier(unusedLeaves, scopeId) {
    if (unusedLeaves.length === 0) return null;
    const drainers = unusedLeaves.map(({ fifo }) => ({
      fifo,
      dpda: plistHasAny(fifo.plist, fifo.nodeId)
        ? null
        : new PatternDPDA("skip", fifo.plist, fifo.nodeId),
      done: false
    }));
    const barrier = {
      drainers,
      done: false,
      failed: false,
      scopeId,
      waiters: [],
      nodes: []
    };
    // Attach a marker DRAIN node for Mermaid visibility while alive
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

  _retireBarrierNodes(barrier) {
    if (barrier.nodes && barrier.nodes.length > 0) {
      for (const n of barrier.nodes) this.retireNode(n);
    } else if (barrier.node) {
      this.retireNode(barrier.node);
    }
  }

  _ensureBarrier(barrier) {
    if (!barrier) return "DONE";
    if (barrier.done) return "DONE";
    if (barrier.failed) return "FAILED";

    for (const d of barrier.drainers) {
      if (d.done) continue;
      // Lazily build skip DPDA once upstream has refined an `any` wire schema
      while (!d.dpda) {
        if (!plistHasAny(d.fifo.plist, d.fifo.nodeId)) {
          d.dpda = new PatternDPDA("skip", d.fifo.plist, d.fifo.nodeId);
          break;
        }
        const st = this._ensureToken(d.fifo);
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "WAIT") continue;
        if (st === "EOF_OR_FAIL") {
          if (d.fifo.failed) {
            barrier.failed = true;
            this._retireBarrierNodes(barrier);
            return "FAILED";
          }
          // Empty closed wire (unit value `{}` after `/_`)
          d.dpda = { done: true, failed: false };
          break;
        }
        if (!plistHasAny(d.fifo.plist, d.fifo.nodeId)) {
          d.dpda = new PatternDPDA("skip", d.fifo.plist, d.fifo.nodeId);
          break;
        }
        // Fallback: wire has concrete token but still open/any schema
        d.dpda = new PatternDPDA("skip", d.fifo.plist, d.fifo.nodeId);
      }
      // Step skip DPDA to consume the discarded wire completely
      while (!d.dpda.done && !d.dpda.failed) {
        const res = d.dpda.step(d.fifo, null);
        if (res === "NEED_INPUT") {
          const st = this._ensureToken(d.fifo);
          if (st === "NEED_INPUT") return "NEED_INPUT";
          if (st === "EOF_OR_FAIL") {
            barrier.failed = true;
            this._retireBarrierNodes(barrier);
            return "FAILED";
          }
          // If spliced, continue loop
          continue;
        }
        if (res === "FAILED") {
          barrier.failed = true;
          this._retireBarrierNodes(barrier);
          return "FAILED";
        }
      }
      // Also drain upstream producer if this was a `comp` wire (catches unit guards like `.x /_`)
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
      if (f.alive && !f.hasToken() && f.closed) {
        if (f.upstream && f.upstream.state === STATE.DONE) this.retireNode(f.upstream);
        if (f.scopeId === barrier.scopeId && (this.eagerSettle ? f.name !== "IN" : Boolean(f.upstream))) {
          this.retireDeque(f);
        }
      }
    }

    barrier.done = true;
    this._retireBarrierNodes(barrier);

    // Local Strategy Rule (3a): Barrier-Completion Eager Waiter Splicing!
    // Once all discarded sibling wires have drained, every waiting `ID` and
    // prepend-spliceable `VID` under this barrier collapses immediately in O(1).
    if (this.eagerSettle && barrier.waiters && barrier.waiters.length > 0) {
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
          if (this._trySpliceScalar(w, w.inFifo, w.outFifo, "vidPrependSplices", w.tag)) {
            this.telemetry.barrierWaiterSplices++;
          }
        }
      }
    }

    return "DONE";
  }

  /**
   * Instantiate a blueprint between `inWire` and `outWire` (either may be a
   * scalar `TokenDeque` or a parallel `WireBundle`!).
   */
  instantiate(bp, inWire, outWire, scopeId, barrier = null) {
    switch (bp.kind) {
      case "stub": {
        return this._makeNode("STUB", `STUB(${bp.relName})`, inWire, outWire, scopeId, {
          state: STATE.STUB,
          relHash: bp.relHash,
          relName: bp.relName,
          barrier
        });
      }

      case "identity": {
        this._wireCopy(inWire, outWire, scopeId, barrier);
        return null;
      }

      case "unit": {
        // Consumes any owned input leaves (via drain barrier) and closes the single unit outWire!
        // Note: when `{}` sits inside a Product `{ () in, {} |_ acc }`, `inWire` is null
        // because the Product already routes/drains all input leaves.
        const allLeaves = inWire ? wireLeaves(inWire) : [];
        const b = this._createDrainBarrier(allLeaves, scopeId);
        return this._makeNode("UNIT", "{}", null, outWire, scopeId, {
          unitDrain: b,
          barrier
        });
      }

      case "div": {
        // Scalar union input -> output (which may be a WireBundle if tag payload is a product!)
        if (inWire.kind !== "fifo") {
          throw new Error(`DIV /${bp.tag}: expected scalar input deque`);
        }
        const bpHasAny = plistHasAny(bp.inPlist) || plistHasAny(bp.outPlist);
        // Only substitute runtime schemas when the static blueprint has `any`
        // (avoids conflating `outWire.plist` after a downstream VID prepend-splice!).
        const rtEdgeInit = bpHasAny
          ? inWire.plist?.[inWire.nodeId]?.[1]?.find(([t]) => t === bp.tag)
          : null;
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
            ? (canonicalSubPlistKey(effInPlist, effTargetNode) === canonicalSubPlistKey(effOutPlist, effOutNode))
            : bp.payloadSamePattern;
          const dpda = new PatternDPDA(
            samePay ? "copy" : "coerce",
            effInPlist,
            effTargetNode,
            effOutPlist,
            effOutNode
          );
          return this._makeNode("DIV", `/${bp.tag}`, inWire, outWire, scopeId, {
            tag: bp.tag,
            matchedTag: false,
            dpda,
            canBypass: samePay && !barrier,
            needsRuntimeSchema: bpHasAny,
            barrier
          });
        }
        // Payload is a product -> strip tag then DEMUX payload directly into `outWire` bundle!
        // Under eager-settle, DIV splices `inWire` directly into DEMUX after matching `tag` (Rule A)!
        const payloadDq = this.createDeque(`div_${bp.tag}`, scopeId, {
          plist: bp.targetPlist,
          nodeId: 0
        });
        const dpda = new PatternDPDA("copy", effInPlist, effTargetNode);
        this._makeNode("DIV", `/${bp.tag}`, inWire, payloadDq, scopeId, {
          tag: bp.tag,
          matchedTag: false,
          dpda,
          canBypass: this.zeroCopyStack && !barrier,
          needsRuntimeSchema: false,
          barrier
        });
        return this._makeDemux(bp.targetPlist, payloadDq, outWire, scopeId);
      }

      case "vid": {
        // Output is scalar union! Input may be a scalar deque OR a WireBundle!
        if (outWire.kind !== "fifo") {
          throw new Error(`VID |${bp.tag}: expected scalar output deque`);
        }
        let scalarIn = inWire;
        if (inWire.kind === "bundle") {
          scalarIn = this.createDeque(`mux_${bp.tag}`, scopeId, {
            plist: bp.inPlist,
            nodeId: 0
          });
          const muxNode = this._makeMux(inWire, scalarIn, scopeId);
          // Mark self-recursive union constructors (e.g. `{ car, cdr } |cons` on `_k_stack[]`)
          // immutably at creation time so downstream `DIV` splices cannot obscure it!
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

        // If outWire has `any` on this tag's payload, graft concrete runtime payload schema!
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
          ? (canonicalSubPlistKey(effInPlist, effInNode) === canonicalSubPlistKey(effOutPlist, effOutTarget))
          : bp.payloadSamePattern;

        const dpda = new PatternDPDA(
          samePay ? "copy" : "coerce",
          effInPlist,
          effInNode,
          effOutPlist,
          effOutTarget
        );
        const hasAnyIn = bpHasAny && plistHasAny(effInPlist, effInNode);
        // Under eager-settle, also prepend-splice onto `scalarIn` when `inWire` is a bundle
        // (`MUX -> VID(|tag)` — Rule B, enabling direct `MUX -> DEMUX` fusion on `|eval /eval`!).
        const canPrependSplice = this.eagerSettle
          ? (!hasAnyIn && samePay && !dpda.done && (this.zeroCopyStack ? scalarIn.kind === "fifo" : inWire.kind === "fifo"))
          : (!hasAnyIn && samePay && !dpda.done && !barrier && inWire.kind === "fifo");
        // Eager O(1) prepend-splice: prepend `tag` onto the front of `scalarIn` deque
        // and splice `scalarIn` straight into downstream without creating a VID node!
        if (
          canPrependSplice &&
          (!barrier || (this.eagerSettle && barrier.done)) &&
          !scalarIn.failed &&
          this._trySpliceScalar(null, scalarIn, outWire, "vidPrependSplices", bp.tag)
        ) {
          return null;
        }
        const vidNode = this._makeNode("VID", `|${bp.tag}`, scalarIn, outWire, scopeId, {
          tag: bp.tag,
          emittedTag: false,
          dpda,
          canPrependSplice,
          needsRuntimeSchema: bpHasAny,
          barrier
        });
        if (this.eagerSettle && barrier && !barrier.done && canPrependSplice) {
          barrier.waiters.push(vidNode);
        }
        return vidNode;
      }

      case "dot": {
        // ZERO-COPY MULTI-PORT PROJECTION!
        if (inWire.kind !== "bundle") {
          throw new Error(`DOT .${bp.field}: expected WireBundle input`);
        }
        const selected = inWire.fields.get(bp.field);
        const discardedLeaves = [];
        for (const [label, child] of inWire.fields.entries()) {
          if (label !== bp.field) {
            wireLeaves(child, [label], discardedLeaves);
          }
        }
        const dotBarrier = this._createDrainBarrier(discardedLeaves, scopeId);
        // Chain external barrier if any
        const effectiveBarrier = barrier && dotBarrier
          ? this._mergeBarriers(barrier, dotBarrier, scopeId)
          : (dotBarrier || barrier);
        this._wireCopy(selected, outWire, scopeId, effectiveBarrier);
        return null;
      }

      case "comp": {
        // Phase 1: resolve compile-time `.field` projections & allocate intermediate wires
        // left-to-right; then Phase 2: instantiate steps RIGHT-TO-LEFT so every step's
        // `outWire.downstream` is ALREADY attached, enabling eager zero-node ID/VID splicing!
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
              if (label !== stepBp.field) {
                wireLeaves(child, [label], discardedLeaves);
              }
            }
            const dotBarrier = this._createDrainBarrier(discardedLeaves, scopeId);
            if (dotBarrier) {
              curBarrier = curBarrier
                ? this._mergeBarriers(curBarrier, dotBarrier, scopeId)
                : dotBarrier;
            }
            curIn = selected;
            if (isLast) {
              stages.push({ kind: "wireCopy", inWire: curIn, outWire, barrier: curBarrier });
            }
            continue;
          }
          const stepOut = isLast
            ? outWire
            : this.createWire(stepBp.outPlist, 0, `m${this.nextFifoId}`, scopeId);
          stages.push({ kind: "bp", bp: stepBp, inWire: curIn, outWire: stepOut, barrier: curBarrier });
          curBarrier = null;
          curIn = stepOut;
        }
        for (let i = stages.length - 1; i >= 0; i--) {
          const st = stages[i];
          if (st.kind === "wireCopy") {
            this._wireCopy(st.inWire, st.outWire, scopeId, st.barrier);
          } else {
            this.instantiate(st.bp, st.inWire, st.outWire, scopeId, st.barrier);
          }
        }
        return null;
      }

      case "product": {
        // ZERO-COPY MULTI-PORT PRODUCT ROUTING!
        //   - No CONCAT node at all: each field branch writes straight to outWire.fields.get(label)!
        //   - Each input leaf wire used by 1 branch goes straight to that branch (NO TEE)!
        //   - Each input leaf wire used by 2+ branches gets a dedicated scalar TEE!
        //   - Each input leaf wire used by 0 branches goes into a DrainBarrier!
        if (outWire.kind !== "bundle") {
          throw new Error("Product output must be a WireBundle");
        }
        const inLeaves = wireLeaves(inWire);
        const readersByPath = new Map();
        for (const l of inLeaves) readersByPath.set(l.pathKey, []);

        bp.fields.forEach((f, idx) => {
          for (const p of f.blueprint.usedPaths) {
            if (readersByPath.has(p)) {
              readersByPath.get(p).push(idx);
            }
          }
        });

        const unusedLeaves = [];
        // Map (branchIdx, pathKey) -> TokenDeque
        const branchLeafMap = bp.fields.map(() => new Map());

        for (const l of inLeaves) {
          const users = readersByPath.get(l.pathKey);
          if (users.length === 0) {
            unusedLeaves.push(l);
          } else if (users.length === 1) {
            // DIRECT ZERO-COPY WIRE!
            branchLeafMap[users[0]].set(l.pathKey, l.fifo);
            this.telemetry.directFieldWires++;
          } else {
            // Fan out ONLY this single scalar leaf wire!
            const tee = this._makeNode(
              "TEE",
              `TEE(${l.pathKey || l.fifo.name}×${users.length})`,
              l.fifo,
              null,
              scopeId,
              { branchDeques: [] }
            );
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
        const effectiveBarrier = barrier && prodBarrier
          ? this._mergeBarriers(barrier, prodBarrier, scopeId)
          : (prodBarrier || barrier);

        // Build each branch's restricted input wire view (only its used leaves are live;
        // unused leaves are placeholders never touched by `f.blueprint`)
        for (let i = 0; i < bp.fields.length; i++) {
          const f = bp.fields[i];
          const branchInWire = this._buildBranchInWire(inWire, branchLeafMap[i], "");
          const branchOutWire = outWire.fields.get(f.label);
          this.instantiate(f.blueprint, branchInWire, branchOutWire, scopeId, effectiveBarrier);
        }
        return null;
      }

      case "multi-switch": {
        const peekLabel = bp.peekPaths.length > 0
          ? `SW[${bp.peekPaths.map((p) => p || "*").join(",")}]`
          : `SPEC<${bp.branches.length}>`;
        const inLeaves = wireLeaves(inWire);
        const outLeaves = wireLeaves(outWire);
        return this._makeNode("MULTI_SW", peekLabel, inWire, outWire, scopeId, {
          branches: bp.branches,
          peekPaths: bp.peekPaths,
          inLeaves,
          outLeaves,
          barrier,
          // Speculative state (used ONLY if >1 candidate survives prefix filtering!)
          candidates: null,
          candIdx: 0,
          recorded: null,
          replayCursors: null,
          activeScopeId: null,
          branchOutLeaves: null,
          committed: false,
          childScopeIds: new Set()
        });
      }

      default:
        throw new Error(`Unknown V2 blueprint kind: ${bp.kind}`);
    }
  }

  _mergeBarriers(b1, b2, scopeId) {
    return {
      drainers: [...b1.drainers, ...b2.drainers],
      done: false,
      failed: false,
      scopeId,
      node: b2.node,
      nodes: [
        ...(b1.nodes || (b1.node ? [b1.node] : [])),
        ...(b2.nodes || (b2.node ? [b2.node] : []))
      ],
      waiters: [...(b1.waiters || []), ...(b2.waiters || [])]
    };
  }

  _buildBranchInWire(origWire, leafMap, prefix) {
    if (origWire.kind === "fifo") {
      return leafMap.get(prefix) || null;
    }
    const fields = new Map();
    let any = false;
    for (const [label, child] of origWire.fields.entries()) {
      const subPrefix = prefix ? `${prefix}.${label}` : label;
      const sub = this._buildBranchInWire(child, leafMap, subPrefix);
      if (sub !== null) {
        fields.set(label, sub);
        any = true;
      }
    }
    return any ? new WireBundle(fields, origWire.plist, origWire.nodeId) : null;
  }

  _makeDemux(plist, inDq, outBundle, scopeId) {
    const outLeaves = wireLeaves(outBundle);
    const leafDpdas = outLeaves.map(({ fifo }) => new PatternDPDA("copy", fifo.plist, fifo.nodeId));
    return this._makeNode("DEMUX", `DEMUX(${outLeaves.length})`, inDq, outBundle, scopeId, {
      outLeaves,
      leafDpdas,
      leafIdx: 0
    });
  }

  _makeMux(inBundle, outDq, scopeId) {
    const inLeaves = wireLeaves(inBundle);
    return this._makeNode("MUX", `MUX(${inLeaves.length})`, inBundle, outDq, scopeId, {
      inLeaves,
      leafIdx: 0
    });
  }

  expandStub(stub) {
    const bp = this.registry.getBlueprint(stub.relHash);
    const { inWire, outWire, scopeId, relName, barrier } = stub;
    this.telemetry.stubsExpanded++;
    stub.state = STATE.RETIRED;
    this.nodes.delete(stub.id);
    this.instantiate(bp.root, inWire, outWire, scopeId, barrier);
    this._snapshot(`expand:${relName}`);
  }

  /**
   * Local Strategy Rule (3b): Eager Local Input Settlement Before Expanding a Recursive STUB.
   *
   * Before unfolding the next iteration of a recursive STUB (e.g. `_nat_divmod`,
   * `_lsb_sub`), settle bounded local work already queued on its input leaves in
   * the same scope:
   *   - pending DrainBarriers (flushing all waiting ID/VID splices!)
   *   - zero-node ID bypasses and O(1) VID prepend-splices
   *   - constant unit-tag emitters (`{} |0`, `{} |1`, `{} |_`)
   *   - upstream MULTI_SW switches (e.g. `SW[sub.b]` of iteration k!)
   *   - finite (acyclic, non-recursive) helper STUBs (e.g. `_push_bit_acc`,
   *     `_full_sub_bit`, `_pop_lsb_bit`, `_lsb_push_0/1`)
   *
   * Streaming/recursive producers (DEMUX, TEE, DIV, recursive STUBs) are NEVER
   * eagerly drained, preserving lazy streaming on big inputs like `x` while
   * retiring iteration k completely before iteration k+1 unfolds!
   */
  _settleStubInputs(stub) {
    if (!stub.inWire) return "DONE";
    if (this.registry.isFiniteRel(stub.relHash)) return "DONE";

    const paths = wireLeaves(stub.inWire).map((l) => l.pathKey);
    for (const pathKey of paths) {
      let progress = true;
      while (progress) {
        progress = false;
        const dq = wireAtPath(stub.inWire, pathKey);
        if (!dq || dq.kind !== "fifo" || !dq.alive) break;
        if (dq.failed) return "FAILED";
        if (dq.closed) break;
        const up = dq.upstream;
        if (!up || up.state === STATE.RETIRED || up.scopeId !== stub.scopeId) break;

        // 1. Unfinished barrier on direct upstream producer -> drain & flush waiters
        if (up.barrier && !up.barrier.done) {
          const bRes = this._ensureBarrier(up.barrier);
          if (bRes === "NEED_INPUT") return "NEED_INPUT";
          if (bRes === "FAILED") {
            this._failNode(up);
            return "FAILED";
          }
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }

        // 2. Spliceable ID / VID directly feeding this stub leaf
        if (up.kind === "ID" && up.canBypass && up.state === STATE.ACTIVE) {
          if (this._trySpliceScalar(up, up.inFifo, up.outFifo, "idSplices")) {
            this.telemetry.eagerStubSettles++;
            progress = true;
            continue;
          }
        }
        if (up.kind === "VID" && up.canPrependSplice && !up.emittedTag && up.state === STATE.ACTIVE && !up.inFifo.failed) {
          if (this._trySpliceScalar(up, up.inFifo, up.outFifo, "vidPrependSplices", up.tag)) {
            this.telemetry.eagerStubSettles++;
            progress = true;
            continue;
          }
        }

        // 2b. Ready `DIV` whose input already holds its tag token (e.g. just peeked by SW[*])
        //     -> consume the 1 already-buffered tag and splice DIV away in O(1)!
        if (
          up.kind === "DIV" &&
          !up.matchedTag &&
          up.state === STATE.ACTIVE &&
          (!up.barrier || up.barrier.done) &&
          up.inFifo &&
          up.inFifo.hasToken()
        ) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }

        // 3. Constant unit-tag emitter (`{} |0`, `{} |1`, `{} |_`) -> emit 1 token & retire 2 nodes!
        if (
          up.kind === "VID" &&
          up.dpda.done &&
          !up.emittedTag &&
          up.state === STATE.ACTIVE &&
          up.inFifo &&
          up.inFifo.upstream &&
          up.inFifo.upstream.kind === "UNIT" &&
          !up.inFifo.upstream.unitDrain &&
          (!up.inFifo.upstream.barrier || up.inFifo.upstream.barrier.done)
        ) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }

        // 4. Upstream MULTI_SW (e.g. `SW[sub.b]` or `< /0 |0, /1 |1 >`) -> resolve switch!
        if (up.kind === "MULTI_SW" && up.state === STATE.ACTIVE) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }

        // 5. Finite (non-recursive) helper STUB (e.g. `_push_bit_acc`, `_full_sub_bit`, `_pop_lsb_bit`)
        if (up.kind === "STUB" && this.registry.isFiniteRel(up.relHash)) {
          this.expandStub(up);
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }

        // 5b. Finite compiled FSM node (Iteration 3) -> settle & retire immediately!
        if (up.kind === "COMPILED" && up.state === STATE.ACTIVE && !up.compiled.isLoop) {
          const r = this.stepNode(up);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED" || dq.failed) return "FAILED";
          this.telemetry.eagerStubSettles++;
          progress = true;
          continue;
        }

        // 6. Tail-recursive stack/list constructor MUX (e.g. `{ car, cdr } |cons` on `_k_stack[]`):
        //    Materialize only the pushed frame `car` (retiring finished subproblems like `z0`/`z2`!)
        //    and O(1) tail-splice `cdr` (zero copies of the stack tail!) before expanding the next
        //    recursive STUB! Gives BOTH O(n^1.585) tokens AND O(log n) live nodes on Karatsuba!
        if (this.tailSettleCons && up.kind === "MUX" && up.state === STATE.ACTIVE && this._isTailRecursiveMux(up)) {
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
    for (const bf of tee.branchDeques) {
      if (bf.upstream === tee) bf.upstream = null;
    }
    if (inF && inF.alive && !inF.hasToken() && (inF.closed || inF.failed)) {
      if (inF.upstream && (inF.upstream.state === STATE.DONE || inF.upstream.state === STATE.FAILED)) {
        this.retireNode(inF.upstream);
      }
      if (inF.scopeId === tee.scopeId && inF.name !== "IN") this.retireDeque(inF);
    }
    this.retireNode(tee);
  }

  stepNode(node) {
    if (!node || node.state === STATE.RETIRED) return "DONE";
    if (node.state === STATE.DONE) return "DONE";
    if (node.state === STATE.FAILED) return "FAILED";

    this.telemetry.schedulerSteps++;

    // Enforce shared drain barrier before any node emits/commits
    if (node.barrier && !node.barrier.done) {
      const bRes = this._ensureBarrier(node.barrier);
      if (bRes === "NEED_INPUT") return "NEED_INPUT";
      if (bRes === "FAILED") return this._failNode(node);
      if (node.state === STATE.RETIRED) return "PROGRESS";
    }

    if (node.kind === "STUB") {
      if (this.eagerSettle) {
        const sRes = this._settleStubInputs(node);
        if (sRes === "NEED_INPUT") return "NEED_INPUT";
        if (sRes === "FAILED") {
          return node.outWire.kind === "fifo"
            ? this._failNode(node)
            : this._failMultiOut(node, wireLeaves(node.outWire));
        }
        if (node.state === STATE.RETIRED) return "PROGRESS";
      }
      this.expandStub(node);
      return "PROGRESS";
    }

    switch (node.kind) {
      case "ID": {
        if (node.canBypass && this._trySpliceScalar(node, node.inFifo, node.outFifo, "idSplices")) {
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "UNIT": {
        if (node.unitDrain && !node.unitDrain.done) {
          const r = this._ensureBarrier(node.unitDrain);
          if (r === "NEED_INPUT") return "NEED_INPUT";
          if (r === "FAILED") return this._failNode(node);
        }
        return this._finishNode(node);
      }

      case "DIV": {
        if (!node.matchedTag) {
          const st = this._ensureToken(node.inFifo);
          if (st === "WAIT") return "PROGRESS";
          if (st === "NEED_INPUT") return "NEED_INPUT";
          if (st === "EOF_OR_FAIL") return this._failNode(node);
          const tok = node.inFifo.shift();
          if (tok !== node.tag) {
            return this._failNode(node);
          }
          node.matchedTag = true;
          // Refresh payload DPDA & output schema ONLY for blueprints containing `any`
          // (handles right-to-left `comp` pipelines through `_drop16` without ever
          // misreading `outFifo.plist` after a downstream VID prepend-splice!).
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
              node.dpda = new PatternDPDA(
                samePay ? "copy" : "coerce",
                node.inFifo.plist,
                rtTarget,
                node.outFifo.plist,
                node.outFifo.nodeId
              );
              node.canBypass = samePay && !node.barrier;
            }
          }
          if (node.dpda.done) {
            return this._finishNode(node);
          }
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
          // Refresh DPDA / output schema if upstream refined an `any` input wire!
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
                  node.outFifo.plist,
                  node.outFifo.nodeId,
                  node.tag,
                  node.inFifo.plist,
                  node.inFifo.nodeId
                );
              }
            }
            const outEdge = node.outFifo.plist?.[node.outFifo.nodeId]?.[1]?.find(([t]) => t === node.tag);
            const effOutPlist = outEdge ? node.outFifo.plist : node.dpda.outPlist;
            const effOutTarget = outEdge ? outEdge[1] : 0;
            const samePay =
              canonicalSubPlistKey(node.inFifo.plist, node.inFifo.nodeId) ===
              canonicalSubPlistKey(effOutPlist, effOutTarget);
            node.dpda = new PatternDPDA(
              samePay ? "copy" : "coerce",
              node.inFifo.plist,
              node.inFifo.nodeId,
              effOutPlist,
              effOutTarget
            );
            const hasAnyIn = plistHasAny(node.inFifo.plist, node.inFifo.nodeId);
            node.canPrependSplice = this.eagerSettle
              ? (!hasAnyIn && samePay && !node.dpda.done && node.inWire?.kind === "fifo")
              : (!hasAnyIn && samePay && !node.dpda.done && !node.barrier && node.inWire?.kind === "fifo");
          }
          // O(1) PREPEND-SPLICING!
          // Prepend `tag` straight onto the front of `inFifo` and splice `inFifo`
          // directly into downstream — ZERO tail copying for `_rev_bits` / `_lsb_sub`!
          if (node.canPrependSplice && this._trySpliceScalar(node, node.inFifo, node.outFifo, "vidPrependSplices", node.tag)) {
            return "PROGRESS";
          }
          node.outFifo.push(node.tag);
          node.emittedTag = true;
          if (node.dpda.done) {
            return this._finishNode(node);
          }
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "TEE": {
        const st = this._ensureToken(node.inFifo);
        if (st === "WAIT") return "PROGRESS";
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "EOF_OR_FAIL") {
          if (node.inFifo.failed) {
            node.state = STATE.FAILED;
            for (const bf of node.branchDeques) if (bf.alive) bf.markFailed();
            if (this.eagerSettle) this._retireTee(node);
            return "FAILED";
          }
          node.state = STATE.DONE;
          for (const bf of node.branchDeques) if (bf.alive) bf.close();
          if (this.eagerSettle) this._retireTee(node);
          return "DONE";
        }
        const tok = node.inFifo.shift();
        for (const bf of node.branchDeques) {
          if (bf.alive) bf.push(tok);
        }
        if (this.eagerSettle && node.inFifo.alive && !node.inFifo.hasToken() && node.inFifo.closed && !node.inFifo.failed) {
          node.state = STATE.DONE;
          for (const bf of node.branchDeques) if (bf.alive) bf.close();
          this._retireTee(node);
          return "DONE";
        }
        return "PROGRESS";
      }

      case "DEMUX": {
        // Rule C2: Direct `MUX(m) -> DEMUX(m)` Bundle Fusion!
        // When `VID(|eval) -> DIV(/eval)` (or `|apply -> /apply`) has spliced away
        // between a `MUX` and a `DEMUX`, wire all m parallel leaves directly leaf-for-leaf
        // in O(1) — ZERO tokens serialized or copied!
        // Even if speculative lookahead (e.g. `_lsb_mul`'s `.stack /nil` probe on `/apply`)
        // already pulled a few tokens of leaf 0 into `midDq`, `mux.leafIdx === 0` guarantees
        // every token in `midDq` came solely from `mux.inLeaves[0]`, so unshifting them back
        // onto `mux.inLeaves[0]` restores the exact stream before fusing all m wires!
        if (
          this.zeroCopyStack &&
          node.leafIdx === 0 &&
          node.inFifo &&
          !node.inFifo.closed &&
          !node.inFifo.failed &&
          node.inFifo.upstream &&
          node.inFifo.upstream.kind === "MUX" &&
          node.inFifo.upstream.state === STATE.ACTIVE &&
          node.inFifo.upstream.scopeId === node.scopeId &&
          node.inFifo.upstream.leafIdx === 0 &&
          (!this.tailSettleCons || !this._isTailRecursiveMux(node.inFifo.upstream)) &&
          !node.inFifo.upstream.barrier &&
          !node.barrier &&
          node.inFifo.upstream.inLeaves.length === node.outLeaves.length
        ) {
          const mux = node.inFifo.upstream;
          const midDq = node.inFifo;
          const m = mux.inLeaves.length;
          let allMatch = true;
          for (let i = 0; i < m; i++) {
            const srcF = mux.inLeaves[i].fifo;
            const dstF = node.outLeaves[i].fifo;
            if (
              !srcF.alive ||
              canonicalSubPlistKey(srcF.plist, srcF.nodeId) !==
                canonicalSubPlistKey(dstF.plist, dstF.nodeId)
            ) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            if (midDq.hasToken()) {
              const prefix = [];
              while (midDq.hasToken()) prefix.push(midDq.shift());
              mux.inLeaves[0].fifo.unshiftTokens(prefix);
            }
            this.retireNode(mux);
            this.retireNode(node);
            this.retireDeque(midDq);
            this.telemetry.muxDemuxFusions++;
            for (let i = 0; i < m; i++) {
              this._wireCopy(mux.inLeaves[i].fifo, node.outLeaves[i].fifo, node.scopeId, null);
            }
            return "PROGRESS";
          }
        }

        while (node.leafIdx < node.outLeaves.length) {
          const dpda = node.leafDpdas[node.leafIdx];
          const outDq = node.outLeaves[node.leafIdx].fifo;
          // Rule C1 (DEMUX tail-leaf splice): once fields 0..m-2 have been read,
          // the entire remaining suffix of `node.inFifo` IS the last leaf (e.g. `cdr`
          // of `_k_stack[]`!) — splice `node.inFifo` straight into `outDq` in O(1)!
          if (
            this.zeroCopyStack &&
            node.leafIdx === node.outLeaves.length - 1 &&
            !dpda.done &&
            node.inFifo.name !== "IN" &&
            !node.inFifo.failed &&
            this._trySpliceScalar(node, node.inFifo, outDq, "demuxTailSplices")
          ) {
            return "PROGRESS";
          }
          if (dpda.done) {
            outDq.close();
            node.leafIdx++;
            continue;
          }
          const res = dpda.step(node.inFifo, outDq);
          if (res === "NEED_INPUT") {
            const st = this._ensureToken(node.inFifo);
            if (st === "WAIT") return "PROGRESS";
            if (st === "NEED_INPUT") return "NEED_INPUT";
            if (st === "EOF_OR_FAIL") return this._failMultiOut(node, node.outLeaves);
            continue;
          }
          if (res === "FAILED") return this._failMultiOut(node, node.outLeaves);
          if (res === "DONE") {
            outDq.close();
            node.leafIdx++;
            if (this.eagerSettle && node.leafIdx >= node.outLeaves.length) {
              const fin = this._finishNode(node);
              if (fin === "DONE") {
                for (const { fifo } of node.outLeaves) {
                  if (fifo.upstream === node) fifo.upstream = null;
                }
                this.retireNode(node);
              }
              return fin;
            }
            return "PROGRESS";
          }
          return "PROGRESS";
        }
        const fin = this._finishNode(node);
        if (this.eagerSettle && fin === "DONE") {
          for (const { fifo } of node.outLeaves) {
            if (fifo.upstream === node) fifo.upstream = null;
          }
          this.retireNode(node);
        }
        return fin;
      }

      case "MUX": {
        while (node.leafIdx < node.inLeaves.length) {
          const inDq = node.inLeaves[node.leafIdx].fifo;
          // Rule C1 (MUX tail-leaf splice): once fields 0..m-2 have been pushed into
          // `node.outFifo` (e.g. `["cons", ...car...]`), prepend that small prefix onto
          // the last leaf (`cdr`!) and splice `cdr` straight into downstream in O(1) —
          // ZERO copies of the O(n) continuation stack tail!
          // Safe whenever `inDq` is already closed (no upstream will read `inDq.plist`)
          // OR `inDq` and `outFifo` share the same closed schema (e.g. recursive `_k_stack[]`).
          const tailSafe =
            inDq.closed ||
            canonicalSubPlistKey(inDq.plist, inDq.nodeId) ===
              canonicalSubPlistKey(node.outFifo.plist, node.outFifo.nodeId);
          if (
            this.zeroCopyStack &&
            node.leafIdx === node.inLeaves.length - 1 &&
            tailSafe &&
            !inDq.failed &&
            this._trySpliceScalar(node, inDq, node.outFifo, "muxTailSplices")
          ) {
            return "PROGRESS";
          }
          if (inDq.hasToken()) {
            node.outFifo.push(inDq.shift());
            return "PROGRESS";
          }
          if (inDq.failed) return this._failNode(node);
          if (inDq.closed) {
            if (inDq.upstream && inDq.upstream.state === STATE.DONE) {
              this.retireNode(inDq.upstream);
            }
            if (inDq.scopeId === node.scopeId && inDq.name !== "IN") this.retireDeque(inDq);
            node.leafIdx++;
            continue;
          }
          const r = this._pullUpstream(inDq);
          if (r === "NEED_INPUT") return "NEED_INPUT";
        }
        return this._finishNode(node);
      }

      case "MULTI_SW": {
        return this._stepMultiSwitch(node);
      }

      default:
        throw new Error(`Unknown V2 node kind: ${node.kind}`);
    }
  }

  _stepMultiSwitch(node) {
    if (node.committed) {
      return this._finishMultiNode(node);
    }
    // Check upstream failure on any input leaf!
    for (const { fifo } of node.inLeaves) {
      if (fifo.failed) {
        if (node.activeScopeId !== null) {
          this.teardownScope(node.activeScopeId, true);
          node.activeScopeId = null;
        }
        return this._failMultiOut(node, node.outLeaves);
      }
    }

    // Phase A: Multi-port prefix filtering! Peek head tokens of all guarded paths.
    if (node.candidates === null) {
      const peeked = new Map();
      for (const pathKey of node.peekPaths) {
        const dq = wireAtPath(node.inWire, pathKey);
        if (dq.kind !== "fifo") continue;
        const st = this._ensureToken(dq);
        if (st === "WAIT") return "PROGRESS";
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "EOF_OR_FAIL") {
          return this._failMultiOut(node, node.outLeaves);
        }
        peeked.set(pathKey, dq.peek());
      }

      // Filter branches whose necessary leading guards match the peeked tokens!
      const matching = [];
      for (const b of node.branches) {
        let ok = true;
        for (const [p, allowedTags] of b.guards.entries()) {
          if (peeked.has(p) && !allowedTags.has(peeked.get(p))) {
            ok = false;
            break;
          }
        }
        if (ok) matching.push(b.blueprint);
      }

      if (matching.length === 0) {
        return this._failMultiOut(node, node.outLeaves);
      }

      // FAST PATH (ZERO SPECULATION!): Exactly 1 matching candidate!
      // Splice it directly onto (inWire, outWire) and delete MULTI_SW!
      if (matching.length === 1) {
        this.telemetry.deterministicDispatches++;
        const { inWire, outWire, scopeId } = node;
        node.state = STATE.RETIRED;
        this.nodes.delete(node.id);
        this.instantiate(matching[0], inWire, outWire, scopeId);
        return "PROGRESS";
      }

      // General speculative fallback ONLY over the surviving `matching` subset!
      node.candidates = matching;
      node.candIdx = 0;
      node.recorded = node.inLeaves.map(() => []);
      node.replayCursors = node.inLeaves.map(() => 0);
    }

    // Phase B: Speculative execution over `node.candidates` (with Last-Branch Tail Splicing!)
    if (node.activeScopeId === null) {
      if (node.candIdx >= node.candidates.length) {
        return this._failMultiOut(node, node.outLeaves);
      }

      // Last candidate -> unshift recorded tokens back onto each leaf deque & splice directly!
      if (node.candIdx === node.candidates.length - 1) {
        const { inWire, outWire, scopeId, inLeaves, recorded } = node;
        const lastBp = node.candidates[node.candIdx];
        for (let k = 0; k < inLeaves.length; k++) {
          if (recorded[k].length > 0) {
            inLeaves[k].fifo.unshiftTokens(recorded[k]);
            recorded[k].length = 0;
          }
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

      // Build replayable input wire matching `inWire` structure
      const branchInWire = this._buildReplayWire(node, node.inWire, childScope, "");
      const branchOutWire = this.createWire(node.outWire.plist, node.outWire.nodeId, `so${node.candIdx}`, childScope);
      node.branchOutLeaves = wireLeaves(branchOutWire);
      this.instantiate(node.candidates[node.candIdx], branchInWire, branchOutWire, childScope);
      return "PROGRESS";
    }

    // Drive active speculative candidate until all output leaves close or any fails
    const bOutLeaves = node.branchOutLeaves;
    while (true) {
      let anyFailed = false;
      let allClosed = true;
      for (const { fifo } of bOutLeaves) {
        if (fifo.failed) anyFailed = true;
        if (!fifo.closed) allClosed = false;
      }
      if (anyFailed) {
        this.teardownScope(node.activeScopeId, true);
        node.activeScopeId = null;
        node.branchOutLeaves = null;
        for (const { fifo } of node.inLeaves) {
          if (fifo.failed) return this._failMultiOut(node, node.outLeaves);
        }
        this.telemetry.speculativeRollbacks++;
        node.candIdx++;
        this._snapshot(`rollback:${node.label}->cand${node.candIdx}`);
        return "PROGRESS";
      }
      if (allClosed) {
        for (let j = 0; j < bOutLeaves.length; j++) {
          const src = bOutLeaves[j].fifo;
          const dst = node.outLeaves[j].fifo;
          while (src.hasToken()) dst.push(src.shift());
        }
        this.teardownScope(node.activeScopeId, false);
        node.activeScopeId = null;
        node.committed = true;
        return this._finishMultiNode(node);
      }
      // Step first non-closed output leaf upstream
      for (const { fifo } of bOutLeaves) {
        if (!fifo.closed && !fifo.failed) {
          if (!fifo.upstream) return "NEED_INPUT";
          const r = fifo.upstream.kind === "REPLAY"
            ? this._stepReplayFeeder(fifo.upstream)
            : this.stepNode(fifo.upstream);
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
    return new WireBundle(fields, origWire.plist, origWire.nodeId);
  }

  _stepReplayFeeder(feeder) {
    const spec = feeder.specNode;
    const k = feeder.leafIdx;
    const rec = spec.recorded[k];
    if (spec.replayCursors[k] < rec.length) {
      feeder.outFifo.push(rec[spec.replayCursors[k]++]);
      return "PROGRESS";
    }
    const parentDq = spec.inLeaves[k].fifo;
    const st = this._ensureToken(parentDq);
    if (st === "WAIT") return "PROGRESS";
    if (st === "NEED_INPUT") return "NEED_INPUT";
    if (st === "EOF_OR_FAIL") {
      if (parentDq.failed) {
        feeder.state = STATE.FAILED;
        feeder.outFifo.markFailed();
        return "FAILED";
      }
      feeder.state = STATE.DONE;
      feeder.outFifo.close();
      return "DONE";
    }
    const tok = parentDq.shift();
    rec.push(tok);
    spec.replayCursors[k]++;
    feeder.outFifo.push(tok);
    return "PROGRESS";
  }

  _stepDPDANode(node, dpda, inFifo, outFifo) {
    const res = dpda.step(inFifo, outFifo);
    if (res === "DONE") return this._finishNode(node);
    if (res === "FAILED") return this._failNode(node);
    if (res === "NEED_INPUT") return this._pullUpstream(inFifo);
    return "PROGRESS";
  }

  _ensureToken(dq) {
    while (dq.alive && !dq.hasToken()) {
      if (dq.failed || dq.closed) return "EOF_OR_FAIL";
      if (!dq.upstream) return "NEED_INPUT";
      const up = dq.upstream;
      const r = up.kind === "REPLAY"
        ? this._stepReplayFeeder(up)
        : this.stepNode(up);
      if (r === "NEED_INPUT") return "NEED_INPUT";
    }
    if (!dq.alive) return "WAIT";
    return "READY";
  }

  _pullUpstream(dq) {
    while (dq.alive && !dq.hasToken() && !dq.failed && !dq.closed) {
      if (!dq.upstream) return "NEED_INPUT";
      const up = dq.upstream;
      const r = up.kind === "REPLAY"
        ? this._stepReplayFeeder(up)
        : this.stepNode(up);
      if (r === "NEED_INPUT") return "NEED_INPUT";
    }
    if (!dq.alive) return "PROGRESS";
    if (dq.hasToken()) return "PROGRESS";
    if (dq.failed) return "FAILED";
    return "DONE";
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
      if (this.eagerSettle && node.outFifo.upstream === node) {
        node.outFifo.upstream = null;
      }
    }
    if (inF && inF.alive && !inF.hasToken() && inF.closed) {
      if (inF.upstream && inF.upstream.state === STATE.DONE) this.retireNode(inF.upstream);
      if (inF.scopeId === node.scopeId && (this.eagerSettle ? inF.name !== "IN" : Boolean(inF.upstream))) {
        this.retireDeque(inF);
      }
    }
    if (this.eagerSettle && node.kind !== "DEMUX") {
      this.retireNode(node);
    }
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
      if (this.eagerSettle && fifo.upstream === node) fifo.upstream = null;
    }
    for (const { fifo } of node.inLeaves) {
      if (fifo.alive && !fifo.hasToken() && fifo.closed) {
        if (fifo.upstream && fifo.upstream.state === STATE.DONE) this.retireNode(fifo.upstream);
        if (fifo.scopeId === node.scopeId && (this.eagerSettle ? fifo.name !== "IN" : Boolean(fifo.upstream))) {
          this.retireDeque(fifo);
        }
      }
    }
    if (this.eagerSettle) {
      this.retireNode(node);
    }
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

  /**
   * Run a closed relation on flat preorder input tokens, demuxing the top-level
   * input product into parallel wires and muxing any top-level output product back.
   */
  run(relHash, inputTokens) {
    const bp = this.registry.getBlueprint(relHash);
    const rootScope = 0;

    // Input wire (if root input is a product, insert a DEMUX from flat IN)
    const rootInFlat = this.createDeque("IN", rootScope, { plist: bp.inPlist, nodeId: 0 });
    for (const tok of inputTokens) rootInFlat.push(tok);
    rootInFlat.close();

    let entryWire = rootInFlat;
    if (bp.inPlist[0][0] === "closed-product" && bp.inPlist[0][1].length > 0) {
      entryWire = this.createWire(bp.inPlist, 0, "", rootScope);
      this._makeDemux(bp.inPlist, rootInFlat, entryWire, rootScope);
    }

    // Output wire (if root output is a product, insert a MUX into flat OUT)
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

    const outTokens = [];
    while (true) {
      while (rootOutFlat.hasToken()) {
        outTokens.push(rootOutFlat.shift());
      }
      if (rootOutFlat.failed) {
        this._snapshot(`failed:${bp.name}`);
        for (const n of [...this.nodes.values()]) this.retireNode(n);
        return { ok: false, tokens: null, telemetry: { ...this.telemetry } };
      }
      if (rootOutFlat.closed) {
        this._snapshot(`done:${bp.name}`);
        for (const n of [...this.nodes.values()]) this.retireNode(n);
        return { ok: true, tokens: outTokens, telemetry: { ...this.telemetry } };
      }
      const res = this._pullUpstream(rootOutFlat);
      if (res === "NEED_INPUT") {
        throw new Error(`MultiPortTransducerNetwork stalled on ${bp.name}`);
      }
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
        // Producer already retired; render buffered closed deque as a green FIFO pill
        src = `BUF_${f.id}`;
        const bufLabel = `buf:${f.name}${f.length > 0 ? ` (${f.length})` : ""}`;
        lines.push(`  ${src}(["${esc(bufLabel)}"]):::buf`);
      }
      if (src && dst) {
        const tokInfo = f.length > 0 ? `${f.name} (${f.length})` : f.name;
        lines.push(`  ${src} -->|"${esc(tokInfo)}"| ${dst}`);
      }
    }

    lines.push("  classDef stub fill:#1e1e2e,color:#cdd6f4,stroke:#f38ba8,stroke-width:2px");
    lines.push("  classDef switch fill:#fef3c7,color:#78350f,stroke:#d97706");
    lines.push("  classDef mux fill:#dbeafe,color:#1e3a8a,stroke:#2563eb");
    lines.push("  classDef drain fill:#f3f4f6,color:#6b7280,stroke:#9ca3af,stroke-dasharray: 4 2");
    lines.push("  classDef buf fill:#dcfce7,color:#166534,stroke:#16a34a");
    return lines.join("\n");
  }
}
