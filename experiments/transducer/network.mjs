/**
 * JIT-Expanded Network of Pushdown Transducers communicating over TokenFIFOs.
 *
 * Core lifecycle mechanics:
 *   1. Lazy Black-Hole Expansion: every relation call starts as an unexpanded
 *      `STUB(name)` node; it expands into live nodes/FIFOs ONLY when demanded.
 *   2. Demand-Driven Scheduling: pulling from `rootOut` steps producers on
 *      demand (deadlock-free over the dynamic DAG).
 *   3. Identity / Div Pass-Through Splicing (Tail-Call Contraction): once a
 *      `Div` or `Identity` node has finished its prefix work and is a pure
 *      passthrough copy into an internal FIFO, its input FIFO is spliced
 *      directly into its downstream consumer and the node + FIFO are deleted.
 *   4. Completed-Node Retirement: once an upstream node is DONE and its output
 *      FIFO is drained, both are removed from the live graph.
 *   5. Scoped Speculative Failure Teardown: failed union branches tear down
 *      every node and FIFO allocated in their scope and replay buffered input
 *      tokens into the next branch.
 */

import { TokenFIFO } from "./token-stream.mjs";
import { PatternDPDA } from "./dpda.mjs";

const STATE = {
  STUB: "STUB",
  ACTIVE: "ACTIVE",
  DONE: "DONE",
  FAILED: "FAILED",
  RETIRED: "RETIRED"
};

export class TransducerNetwork {
  constructor(registry, { onSnapshot = null } = {}) {
    this.registry = registry;
    this.onSnapshot = onSnapshot;
    this.nextNodeId = 1;
    this.nextFifoId = 1;
    this.nextScopeId = 1;

    this.nodes = new Map();   // id -> Node
    this.fifos = new Map();   // id -> TokenFIFO

    this.telemetry = {
      stubsCreated: 0,
      stubsExpanded: 0,
      stubsNeverExpanded: 0,
      totalNodesCreated: 0,
      peakActiveNodes: 0,
      tailSplices: 0,
      nodesRetired: 0,
      prefixSwitches: 0,
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
    let active = 0;
    for (const n of this.nodes.values()) {
      if (n.state !== STATE.RETIRED) active++;
    }
    if (active > this.telemetry.peakActiveNodes) {
      this.telemetry.peakActiveNodes = active;
    }
  }

  createFifo(name, scopeId, upstream = null, downstream = null) {
    const id = this.nextFifoId++;
    const fifo = new TokenFIFO(id, {
      name: name || `F${id}`,
      upstream,
      downstream,
      scopeId,
      telemetry: this.telemetry
    });
    this.fifos.set(id, fifo);
    return fifo;
  }

  registerNode(node) {
    this.nodes.set(node.id, node);
    this.telemetry.totalNodesCreated++;
    if (node.kind === "STUB") {
      this.telemetry.stubsCreated++;
    }
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

  retireFifo(fifo) {
    if (!fifo || !fifo.alive) return;
    fifo.release();
    this.fifos.delete(fifo.id);
  }

  /**
   * Rewire `fifo`'s downstream consumer from `oldNode` to `newNode`.
   */
  rewireInput(node, newInFifo) {
    node.inFifo = newInFifo;
    if (newInFifo) {
      newInFifo.downstream = node;
    }
  }

  rewireOutput(node, newOutFifo) {
    node.outFifo = newOutFifo;
    if (newOutFifo) {
      newOutFifo.upstream = node;
    }
  }

  /**
   * Tear down every node and FIFO belonging to a failed speculative scope
   * (and any nested child scopes).
   */
  teardownScope(scopeId, countAsAbort = true) {
    const scopesToKill = new Set([scopeId]);
    // Collect nested scopes transitively
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.nodes.values()) {
        if (n.childScopeIds) {
          if (scopesToKill.has(n.scopeId)) {
            for (const cid of n.childScopeIds) {
              if (!scopesToKill.has(cid)) {
                scopesToKill.add(cid);
                changed = true;
              }
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
        this.retireFifo(f);
      }
    }
  }

  /**
   * Instantiate a blueprint wired directly between `inFifo` and `outFifo`.
   * Returns the entry node (for reference) while wiring `outFifo.upstream`
   * to the exit node and `inFifo.downstream` to the entry node.
   */
  instantiate(bp, inFifo, outFifo, scopeId) {
    switch (bp.kind) {
      case "stub": {
        const node = this._makeNode("STUB", `STUB(${bp.relName})`, inFifo, outFifo, scopeId, {
          state: STATE.STUB,
          relHash: bp.relHash,
          relName: bp.relName
        });
        return node;
      }

      case "identity": {
        const dpda = new PatternDPDA(
          bp.samePattern ? "copy" : "coerce",
          bp.inPlist,
          0,
          bp.outPlist,
          0
        );
        return this._makeNode("ID", "()", inFifo, outFifo, scopeId, {
          dpda,
          canBypass: bp.samePattern
        });
      }

      case "unit": {
        const dpda = new PatternDPDA("skip", bp.inPlist, 0);
        return this._makeNode("UNIT", "{}", inFifo, outFifo, scopeId, { dpda });
      }

      case "div": {
        const dpda = new PatternDPDA(
          bp.payloadSamePattern ? "copy" : "coerce",
          bp.inPlist,
          bp.targetNodeId,
          bp.outPlist,
          0
        );
        return this._makeNode("DIV", `/${bp.tag}`, inFifo, outFifo, scopeId, {
          tag: bp.tag,
          matchedTag: false,
          dpda,
          canBypass: bp.payloadSamePattern
        });
      }

      case "vid": {
        const dpda = new PatternDPDA(
          bp.payloadSamePattern ? "copy" : "coerce",
          bp.inPlist,
          0,
          bp.outPlist,
          bp.targetNodeId
        );
        return this._makeNode("VID", `|${bp.tag}`, inFifo, outFifo, scopeId, {
          tag: bp.tag,
          emittedTag: false,
          dpda
        });
      }

      case "dot": {
        const before = bp.beforeNodes.map((nid) => new PatternDPDA("skip", bp.inPlist, nid));
        const target = new PatternDPDA("coerce", bp.inPlist, bp.targetNodeId, bp.outPlist, 0);
        const after = bp.afterNodes.map((nid) => new PatternDPDA("skip", bp.inPlist, nid));
        return this._makeNode("DOT", `.${bp.field}`, inFifo, outFifo, scopeId, {
          field: bp.field,
          before,
          beforeIdx: 0,
          target,
          after,
          afterIdx: 0,
          phase: 0 // 0=before, 1=target, 2=after
        });
      }

      case "comp": {
        let curIn = inFifo;
        let firstNode = null;
        for (let i = 0; i < bp.steps.length; i++) {
          const isLast = i === bp.steps.length - 1;
          const stepOut = isLast
            ? outFifo
            : this.createFifo(`mid_${this.nextFifoId}`, scopeId);
          const n = this.instantiate(bp.steps[i], curIn, stepOut, scopeId);
          if (!firstNode) firstNode = n;
          curIn = stepOut;
        }
        return firstNode;
      }

      case "product": {
        // Tee fans `inFifo` out to N branch input FIFOs; Concat drains N branch output FIFOs to `outFifo`.
        const fieldNames = bp.fields.map((f) => f.label).join(",");
        const tee = this._makeNode("TEE", `TEE{${fieldNames}}`, inFifo, null, scopeId, {
          shared: [],
          cursors: bp.fields.map(() => 0),
          branchInFifos: [],
          inDone: false,
          inFailed: false
        });
        const concat = this._makeNode("CONCAT", `CONCAT{${fieldNames}}`, null, outFifo, scopeId, {
          tee,
          branchOutFifos: [],
          fieldIndex: 0,
          fieldLabels: bp.fields.map((f) => f.label)
        });
        for (let i = 0; i < bp.fields.length; i++) {
          const f = bp.fields[i];
          const bIn = this.createFifo(`tee_${f.label}`, scopeId, tee, null);
          const bOut = this.createFifo(`cat_${f.label}`, scopeId, null, concat);
          tee.branchInFifos.push(bIn);
          concat.branchOutFifos.push(bOut);
          this.instantiate(f.blueprint, bIn, bOut, scopeId);
        }
        return tee;
      }

      case "prefix-switch": {
        const tags = [...bp.cases.keys()].join("|");
        return this._makeNode("PREFIX_SW", `SW<${tags}>`, inFifo, outFifo, scopeId, {
          cases: bp.cases
        });
      }

      case "spec-switch": {
        return this._makeNode("SPEC_SW", `SPEC<${bp.branches.length}>`, inFifo, outFifo, scopeId, {
          branches: bp.branches,
          branchIdx: 0,
          recorded: [],
          replayCursor: 0,
          activeScopeId: null,
          branchIn: null,
          branchOut: null,
          childScopeIds: new Set()
        });
      }

      default:
        throw new Error(`Unknown blueprint kind: ${bp.kind}`);
    }
  }

  _makeNode(kind, label, inFifo, outFifo, scopeId, extra = {}) {
    const id = this.nextNodeId++;
    const node = {
      id,
      kind,
      label,
      state: extra.state || STATE.ACTIVE,
      inFifo,
      outFifo,
      scopeId,
      ...extra
    };
    if (inFifo) inFifo.downstream = node;
    if (outFifo) outFifo.upstream = node;
    return this.registerNode(node);
  }

  /**
   * Expand a black-hole STUB(R) in place, wiring R's blueprint directly to
   * (stub.inFifo, stub.outFifo) and retiring the stub.
   */
  expandStub(stub) {
    const bp = this.registry.getBlueprint(stub.relHash);
    const { inFifo, outFifo, scopeId, relName } = stub;
    this.telemetry.stubsExpanded++;
    // Remove stub before wiring so inFifo/outFifo point cleanly to new nodes
    stub.state = STATE.RETIRED;
    this.nodes.delete(stub.id);
    this.instantiate(bp.root, inFifo, outFifo, scopeId);
    this._snapshot(`expand:${relName}`);
  }

  /**
   * Tail/passthrough splice: when a node's only remaining task is pure `copy`
   * from `node.inFifo` to an empty internal `node.outFifo` (same scope, not rootOut),
   * bypass the node by wiring `node.inFifo` directly into `downstream`.
   */
  _trySplicePassthrough(node) {
    const inF = node.inFifo;
    const outF = node.outFifo;
    if (!inF || !outF || !outF.downstream) return false; // Never bypass rootOut
    if (outF.hasToken()) return false;
    if (inF.scopeId !== outF.scopeId) return false;
    const down = outF.downstream;
    // Only splice simple single-input downstream nodes (not CONCAT/multi-port)
    if (down.inFifo !== outF) return false;

    this.rewireInput(down, inF);
    this.retireNode(node);
    this.retireFifo(outF);
    this.telemetry.tailSplices++;
    return true;
  }

  /**
   * Demand-driven step on a node (producer of some demanded FIFO).
   * Returns: "PROGRESS" | "NEED_INPUT" | "DONE" | "FAILED"
   */
  stepNode(node) {
    if (!node || node.state === STATE.RETIRED) return "DONE";
    if (node.state === STATE.DONE) return "DONE";
    if (node.state === STATE.FAILED) return "FAILED";

    this.telemetry.schedulerSteps++;

    // 1. Lazy black-hole expansion!
    if (node.kind === "STUB") {
      this.expandStub(node);
      return "PROGRESS";
    }

    switch (node.kind) {
      case "ID": {
        if (node.canBypass && this._trySplicePassthrough(node)) {
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "UNIT": {
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
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
          if (node.dpda.done) {
            return this._finishNode(node);
          }
          // Immediately splice if payload is an exact passthrough copy!
          if (node.canBypass && this._trySplicePassthrough(node)) {
            return "PROGRESS";
          }
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "VID": {
        if (!node.emittedTag) {
          if (node.inFifo.failed) return this._failNode(node);
          node.outFifo.push(node.tag);
          node.emittedTag = true;
          if (node.dpda.done) {
            return this._finishNode(node);
          }
          return "PROGRESS";
        }
        return this._stepDPDANode(node, node.dpda, node.inFifo, node.outFifo);
      }

      case "DOT": {
        while (true) {
          if (node.phase === 0) {
            while (node.beforeIdx < node.before.length && node.before[node.beforeIdx].done) {
              node.beforeIdx++;
            }
            if (node.beforeIdx >= node.before.length) {
              node.phase = 1;
              continue;
            }
            const res = this._stepDPDAOnly(node.before[node.beforeIdx], node.inFifo, null);
            if (res === "FAILED") return this._failNode(node);
            if (res === "NEED_INPUT") return this._pullUpstream(node.inFifo);
            return "PROGRESS";
          }
          if (node.phase === 1) {
            if (node.target.done) {
              node.phase = 2;
              continue;
            }
            const res = this._stepDPDAOnly(node.target, node.inFifo, node.outFifo);
            if (res === "FAILED") return this._failNode(node);
            if (res === "NEED_INPUT") return this._pullUpstream(node.inFifo);
            return "PROGRESS";
          }
          if (node.phase === 2) {
            while (node.afterIdx < node.after.length && node.after[node.afterIdx].done) {
              node.afterIdx++;
            }
            if (node.afterIdx >= node.after.length) {
              return this._finishNode(node);
            }
            const res = this._stepDPDAOnly(node.after[node.afterIdx], node.inFifo, null);
            if (res === "FAILED") return this._failNode(node);
            if (res === "NEED_INPUT") return this._pullUpstream(node.inFifo);
            return "PROGRESS";
          }
        }
      }

      case "TEE": {
        // Pull 1 token from `inFifo` into `shared[]` and push to all active branch input FIFOs.
        const st = this._ensureToken(node.inFifo);
        if (st === "WAIT") return "PROGRESS";
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "EOF_OR_FAIL") {
          if (node.inFifo.failed) {
            node.state = STATE.FAILED;
            for (const bf of node.branchInFifos) if (bf.alive) bf.markFailed();
            return "FAILED";
          }
          node.state = STATE.DONE;
          for (const bf of node.branchInFifos) if (bf.alive) bf.close();
          return "DONE";
        }
        const tok = node.inFifo.shift();
        for (const bf of node.branchInFifos) {
          if (bf.alive) bf.push(tok);
        }
        return "PROGRESS";
      }

      case "CONCAT": {
        while (true) {
          if (node.fieldIndex >= node.branchOutFifos.length) {
            const teeIn = node.tee.inFifo;
            if (teeIn && teeIn.upstream && teeIn.upstream.kind !== "TEE" && teeIn.upstream.kind !== "REPLAY") {
              while (!teeIn.closed && !teeIn.failed) {
                const res = this.stepNode(teeIn.upstream);
                if (res === "NEED_INPUT") return "NEED_INPUT";
                if (res === "FAILED" || teeIn.failed) break;
              }
              if (teeIn.failed) {
                if (node.tee.state !== STATE.RETIRED) this.retireNode(node.tee);
                for (const bf of node.tee.branchInFifos) this.retireFifo(bf);
                for (const bf of node.branchOutFifos) this.retireFifo(bf);
                return this._failNode(node);
              }
            }
            if (node.tee.state !== STATE.RETIRED) {
              this.retireNode(node.tee);
            }
            if (teeIn && !teeIn.hasToken() && teeIn.closed && teeIn.upstream) {
              if (teeIn.upstream.state === STATE.DONE) this.retireNode(teeIn.upstream);
              if (teeIn.scopeId === node.scopeId) this.retireFifo(teeIn);
            }
            for (const bf of node.tee.branchInFifos) this.retireFifo(bf);
            for (const bf of node.branchOutFifos) this.retireFifo(bf);
            return this._finishNode(node);
          }
          const curOut = node.branchOutFifos[node.fieldIndex];
          if (curOut.hasToken()) {
            node.outFifo.push(curOut.shift());
            return "PROGRESS";
          }
          if (curOut.failed) {
            if (node.tee.state !== STATE.RETIRED) this.retireNode(node.tee);
            for (const bf of node.tee.branchInFifos) this.retireFifo(bf);
            for (const bf of node.branchOutFifos) this.retireFifo(bf);
            return this._failNode(node);
          }
          if (curOut.closed) {
            if (curOut.upstream && curOut.upstream.state === STATE.DONE) {
              this.retireNode(curOut.upstream);
            }
            this.retireFifo(curOut);
            const bIn = node.tee.branchInFifos[node.fieldIndex];
            if (bIn && !bIn.hasToken()) this.retireFifo(bIn);
            node.fieldIndex++;
            continue;
          }
          const res = this._pullUpstream(curOut);
          if (res === "NEED_INPUT") return "NEED_INPUT";
        }
      }

      case "PREFIX_SW": {
        // Peek 1 token from `inFifo`, deterministically splice the single matching branch!
        const st = this._ensureToken(node.inFifo);
        if (st === "WAIT") return "PROGRESS";
        if (st === "NEED_INPUT") return "NEED_INPUT";
        if (st === "EOF_OR_FAIL") return this._failNode(node);
        const tok = node.inFifo.peek();
        const branchBp = node.cases.get(tok);
        if (!branchBp) {
          return this._failNode(node);
        }
        this.telemetry.prefixSwitches++;
        const { inFifo, outFifo, scopeId } = node;
        node.state = STATE.RETIRED;
        this.nodes.delete(node.id);
        this.instantiate(branchBp, inFifo, outFifo, scopeId);
        return "PROGRESS";
      }

      case "SPEC_SW": {
        return this._stepSpecSwitch(node);
      }

      default:
        throw new Error(`Unknown node kind: ${node.kind}`);
    }
  }

  _stepSpecSwitch(node) {
    if (node.committed) {
      return this._finishNode(node);
    }
    // Upstream failure is NOT a branch mismatch: if the input stream to the
    // union itself failed, abort the entire union immediately (never try branch i+1!).
    if (node.inFifo.failed) {
      if (node.activeScopeId !== null) {
        this.teardownScope(node.activeScopeId, true);
        node.activeScopeId = null;
      }
      return this._failNode(node);
    }
    // If no active branch, start branch `branchIdx`
    if (node.activeScopeId === null) {
      if (node.branchIdx >= node.branches.length) {
        return this._failNode(node);
      }

      // LAST-BRANCH TAIL SPLICING:
      // Once all earlier branches failed and we reach the final branch, there is
      // no fallback left! Unshift any recorded tokens back into `node.inFifo`,
      // splice the final branch directly onto `(node.inFifo, node.outFifo)`, and
      // delete `SPEC_SW` so tail-recursive loops keep O(1) graph depth!
      if (node.branchIdx === node.branches.length - 1) {
        const { inFifo, outFifo, scopeId, recorded } = node;
        const lastBp = node.branches[node.branchIdx];
        if (recorded.length > 0) {
          inFifo.unshiftTokens(recorded);
          recorded.length = 0;
        }
        node.state = STATE.RETIRED;
        this.nodes.delete(node.id);
        this.telemetry.tailSplices++;
        this.instantiate(lastBp, inFifo, outFifo, scopeId);
        return "PROGRESS";
      }

      this.telemetry.speculativeSwitches++;
      const childScope = this.nextScopeId++;
      node.activeScopeId = childScope;
      node.childScopeIds.add(childScope);
      node.replayCursor = 0;

      // Feeder node feeds `recorded[replayCursor++]` (or pulls from `node.inFifo`) into `branchIn`
      const feeder = this._makeNode("REPLAY", `REPLAY#${node.branchIdx}`, null, null, childScope, {
        specNode: node
      });
      const branchIn = this.createFifo(`spec_in_${node.branchIdx}`, childScope, feeder, null);
      feeder.outFifo = branchIn;
      const branchOut = this.createFifo(`spec_out_${node.branchIdx}`, childScope, null, null);
      node.branchIn = branchIn;
      node.branchOut = branchOut;
      this.instantiate(node.branches[node.branchIdx], branchIn, branchOut, childScope);
      return "PROGRESS";
    }

    const bOut = node.branchOut;

    // If active branch failed: tear down its scope. If the upstream input itself
    // failed, abort the entire switch; otherwise roll back and try next branch!
    if (bOut.failed) {
      this.teardownScope(node.activeScopeId, true);
      node.activeScopeId = null;
      node.branchIn = null;
      node.branchOut = null;
      if (node.inFifo.failed) {
        return this._failNode(node);
      }
      this.telemetry.speculativeRollbacks++;
      node.branchIdx++;
      this._snapshot(`rollback:${node.label}->branch${node.branchIdx}`);
      return "PROGRESS";
    }

    // If active branch succeeded: flush staged tokens into `node.outFifo` and commit!
    if (bOut.closed) {
      while (bOut.hasToken()) {
        node.outFifo.push(bOut.shift());
      }
      if (node.replayCursor !== node.recorded.length) {
        throw new Error(
          `SpecSwitch invariant violated: winning branch consumed ${node.replayCursor} ` +
          `tokens, but recorded buffer has ${node.recorded.length}`
        );
      }
      this.teardownScope(node.activeScopeId, false);
      node.activeScopeId = null;
      node.recorded.length = 0;
      node.committed = true;
      return this._finishNode(node);
    }

    // Drive the active speculative branch until it commits (closed) or fails
    while (!bOut.closed && !bOut.failed) {
      if (!bOut.upstream) return "NEED_INPUT";
      const res = bOut.upstream.kind === "REPLAY"
        ? this._stepReplayFeeder(bOut.upstream)
        : this.stepNode(bOut.upstream);
      if (res === "NEED_INPUT") {
        return "NEED_INPUT";
      }
    }
    return "PROGRESS";
  }

  _stepReplayFeeder(feeder) {
    const spec = feeder.specNode;
    if (spec.replayCursor < spec.recorded.length) {
      feeder.outFifo.push(spec.recorded[spec.replayCursor++]);
      return "PROGRESS";
    }
    const st = this._ensureToken(spec.inFifo);
    if (st === "WAIT") return "PROGRESS";
    if (st === "NEED_INPUT") return "NEED_INPUT";
    if (st === "EOF_OR_FAIL") {
      if (spec.inFifo.failed) {
        feeder.state = STATE.FAILED;
        feeder.outFifo.markFailed();
        return "FAILED";
      }
      feeder.state = STATE.DONE;
      feeder.outFifo.close();
      return "DONE";
    }
    const tok = spec.inFifo.shift();
    spec.recorded.push(tok);
    spec.replayCursor++;
    feeder.outFifo.push(tok);
    return "PROGRESS";
  }

  _stepDPDAOnly(dpda, inFifo, outFifo) {
    return dpda.step(inFifo, outFifo);
  }

  _stepDPDANode(node, dpda, inFifo, outFifo) {
    const res = dpda.step(inFifo, outFifo);
    if (res === "DONE") return this._finishNode(node);
    if (res === "FAILED") return this._failNode(node);
    if (res === "NEED_INPUT") return this._pullUpstream(inFifo);
    return "PROGRESS";
  }

  _ensureToken(fifo) {
    while (fifo.alive && !fifo.hasToken()) {
      if (fifo.failed || fifo.closed) return "EOF_OR_FAIL";
      if (!fifo.upstream) return "NEED_INPUT";
      const up = fifo.upstream;
      const r = up.kind === "REPLAY"
        ? this._stepReplayFeeder(up)
        : this.stepNode(up);
      if (r === "NEED_INPUT") return "NEED_INPUT";
    }
    if (!fifo.alive) return "WAIT";
    return "READY";
  }

  _pullUpstream(fifo) {
    while (fifo.alive && !fifo.hasToken() && !fifo.failed && !fifo.closed) {
      if (!fifo.upstream) return "NEED_INPUT";
      const up = fifo.upstream;
      const r = up.kind === "REPLAY"
        ? this._stepReplayFeeder(up)
        : this.stepNode(up);
      if (r === "NEED_INPUT") return "NEED_INPUT";
    }
    if (!fifo.alive) return "PROGRESS";
    if (fifo.hasToken()) return "PROGRESS";
    if (fifo.failed) return "FAILED";
    return "DONE";
  }

  _finishNode(node) {
    // Before committing DONE on a `comp` edge (upstream is a real producer, not TEE/REPLAY),
    // drain/verify the upstream producer has finished (DONE) and did not FAIL!
    const inF = node.inFifo;
    if (inF && inF.alive && inF.upstream && inF.upstream.kind !== "TEE" && inF.upstream.kind !== "REPLAY") {
      while (inF.alive && !inF.closed && !inF.failed) {
        const res = this.stepNode(inF.upstream);
        if (res === "NEED_INPUT") return "NEED_INPUT";
        if (res === "FAILED" || inF.failed) break;
      }
      if (inF.failed) {
        return this._failNode(node);
      }
    }

    node.state = STATE.DONE;
    if (node.outFifo) {
      node.outFifo.close();
    }
    // Retire drained input FIFO & completed upstream node if safe
    if (inF && !inF.hasToken() && inF.closed && inF.upstream) {
      if (inF.upstream.state === STATE.DONE) {
        this.retireNode(inF.upstream);
      }
      if (inF.scopeId === node.scopeId) {
        this.retireFifo(inF);
      }
    }
    return "DONE";
  }

  _failNode(node) {
    node.state = STATE.FAILED;
    if (node.outFifo) {
      node.outFifo.markFailed();
    }
    return "FAILED";
  }

  _snapshot(event) {
    if (this.onSnapshot) {
      this.onSnapshot(event, this);
    }
  }

  /**
   * Run a relation `relHash` on an array of preorder input tokens.
   * Returns `{ ok: true, tokens, telemetry }` or `{ ok: false, telemetry }`.
   */
  run(relHash, inputTokens) {
    const bp = this.registry.getBlueprint(relHash);
    const rootScope = 0;
    const rootIn = this.createFifo("IN", rootScope);
    const rootOut = this.createFifo("OUT", rootScope);
    for (const tok of inputTokens) rootIn.push(tok);
    rootIn.close();

    this.instantiate(
      { kind: "stub", relHash, relName: bp.name, inPlist: bp.inPlist, outPlist: bp.outPlist },
      rootIn,
      rootOut,
      rootScope
    );
    this._snapshot(`init:${bp.name}`);

    const outTokens = [];
    while (true) {
      while (rootOut.hasToken()) {
        outTokens.push(rootOut.shift());
      }
      if (rootOut.failed) {
        this._snapshot(`failed:${bp.name}`);
        // Count any remaining unexpanded stubs
        for (const n of [...this.nodes.values()]) {
          this.retireNode(n);
        }
        return { ok: false, tokens: null, telemetry: { ...this.telemetry } };
      }
      if (rootOut.closed) {
        this._snapshot(`done:${bp.name}`);
        for (const n of [...this.nodes.values()]) {
          this.retireNode(n);
        }
        return { ok: true, tokens: outTokens, telemetry: { ...this.telemetry } };
      }
      const res = this._pullUpstream(rootOut);
      if (res === "NEED_INPUT") {
        throw new Error(`TransducerNetwork stalled waiting for root input (${bp.name})`);
      }
    }
  }

  /**
   * Render the current live network graph as a Mermaid `flowchart LR` diagram.
   * Black-hole STUBs are styled dark so unexpanded recursion is visually obvious!
   */
  toMermaid() {
    const lines = ["flowchart LR"];
    const esc = (s) => String(s).replace(/"/g, "'");
    const nodeIds = new Set();

    // External IN / OUT terminals
    let hasRootIn = false;
    let hasRootOut = false;
    for (const f of this.fifos.values()) {
      if (!f.alive) continue;
      if (!f.upstream && f.name === "IN") hasRootIn = true;
      if (!f.downstream && f.name === "OUT") hasRootOut = true;
    }
    if (hasRootIn) lines.push(`  ROOT_IN(["IN"])`);
    if (hasRootOut) lines.push(`  ROOT_OUT(["OUT"])`);

    for (const n of this.nodes.values()) {
      if (n.state === STATE.RETIRED) continue;
      const nid = `N${n.id}`;
      nodeIds.add(nid);
      if (n.kind === "STUB") {
        lines.push(`  ${nid}[["${esc(n.label)}"]]:::stub`);
      } else if (n.kind === "PREFIX_SW" || n.kind === "SPEC_SW") {
        lines.push(`  ${nid}{"${esc(n.label)}"}:::switch`);
      } else if (n.kind === "TEE" || n.kind === "CONCAT") {
        lines.push(`  ${nid}(["${esc(n.label)}"]):::mux`);
      } else {
        const suffix = n.state === STATE.DONE ? " ✓" : n.state === STATE.FAILED ? " ✗" : "";
        lines.push(`  ${nid}["${esc(n.label + suffix)}"]`);
      }
    }

    for (const f of this.fifos.values()) {
      if (!f.alive) continue;
      const src = f.upstream && f.upstream.state !== STATE.RETIRED
        ? `N${f.upstream.id}`
        : (!f.upstream && f.name === "IN" ? "ROOT_IN" : null);
      const dst = f.downstream && f.downstream.state !== STATE.RETIRED
        ? `N${f.downstream.id}`
        : (!f.downstream && f.name === "OUT" ? "ROOT_OUT" : null);
      if (src && dst) {
        const tokInfo = f.length > 0 ? `${f.name} (${f.length})` : f.name;
        lines.push(`  ${src} -->|"${esc(tokInfo)}"| ${dst}`);
      }
    }

    // Link SPEC_SW to its active speculative child branch for visibility
    for (const n of this.nodes.values()) {
      if (n.kind === "SPEC_SW" && n.branchIn && n.branchOut && n.state !== STATE.RETIRED) {
        if (n.branchIn.upstream && n.branchIn.upstream.state !== STATE.RETIRED) {
          lines.push(`  N${n.id} -.->|"try #${n.branchIdx}"| N${n.branchIn.upstream.id}`);
        }
        if (n.branchOut.upstream && n.branchOut.upstream.state !== STATE.RETIRED) {
          lines.push(`  N${n.branchOut.upstream.id} -.->|"stage"| N${n.id}`);
        }
      }
    }

    lines.push("  classDef stub fill:#1e1e2e,color:#cdd6f4,stroke:#f38ba8,stroke-width:2px");
    lines.push("  classDef switch fill:#fef3c7,color:#78350f,stroke:#d97706");
    lines.push("  classDef mux fill:#dbeafe,color:#1e3a8a,stroke:#2563eb");
    return lines.join("\n");
  }
}
