/**
 * Iteration 3: Hybrid JIT + Statically Compiled Transducer Network.
 *
 * Extends Iteration 2 (`MultiPortTransducerNetwork`) with ONE new runtime node
 * kind (`COMPILED`) that executes compiled `COMPILED_FSM` and `COMPILED_LOOP`
 * decision DAGs directly over the exact same parallel `TokenDeque` wires!
 *
 *   - Finite helpers (`_full_sub_bit`, `_pop_lsb_bit`, `_push_bit_acc`, `_classify_bits`,
 *     `_lsb_push_0/1`, `lsb_shl1`, `_le1_bit?`) run as single-node FSM transducers.
 *   - Tail-recursive loops (`trim_bits`, `_rev_bits`, `_lsb_sub`, `_lsb_add`,
 *     `_lsb_split`, `lsb_shl`, `_half_max_tally`, `_cmp_msb`) execute IN-PLACE in a
 *     single node with in-register finite states (`b`, `c`, `ord`) — ZERO per-bit
 *     stub expansions, ZERO node allocations, ZERO rollbacks!
 *   - Non-compilable outer orchestrators (`_nat_divmod`, `_lsb_mul`, `divmod`, `times`)
 *     still expand lazily as black-hole `STUB`s in the exact Iteration 2 network!
 */

import { PatternDPDA } from "../dpda.mjs";
import { wireLeaves } from "../v2/wires.mjs";
import { plistHasAny } from "../v2/blueprint.mjs";
import { MultiPortTransducerNetwork } from "../v2/network.mjs";
import { TransducerCompilerV3 } from "./fsm-compiler.mjs";

const STATE = {
  STUB: "STUB",
  ACTIVE: "ACTIVE",
  DONE: "DONE",
  FAILED: "FAILED",
  RETIRED: "RETIRED"
};

export class CompiledTransducerNetworkV3 extends MultiPortTransducerNetwork {
  constructor(registry, opts = {}) {
    super(registry, opts);
    this.enableCompiled = opts.enableCompiled !== false;
    this.compiler = opts.compiler || new TransducerCompilerV3(registry);
    this.telemetry.compiledNodesCreated = 0;
    this.telemetry.compiledLoopIterations = 0;
    this.telemetry.compiledFsmHits = 0;
  }

  instantiate(bp, inWire, outWire, scopeId, barrier = null) {
    // Intercept compiled FSM / Loop relations directly (or keep STUB until demanded?
    // Keeping STUB until demanded preserves lazy JIT black-hole semantics so unused
    // branches NEVER compile or allocate, and `expandStub` swaps STUB -> COMPILED!).
    return super.instantiate(bp, inWire, outWire, scopeId, barrier);
  }

  expandStub(stub) {
    if (this.enableCompiled) {
      const compiled = this.compiler.getCompiled(stub.relHash);
      if (compiled) {
        const { inWire, outWire, scopeId, barrier } = stub;
        const inLeaves = wireLeaves(inWire);
        const outLeaves = wireLeaves(outWire);
        if (inLeaves.length === compiled.inLeaves.length && outLeaves.length === compiled.outLeaves.length) {
          this.telemetry.stubsExpanded++;
          this.telemetry.compiledNodesCreated++;
          stub.state = STATE.RETIRED;
          this.nodes.delete(stub.id);

          const kindTag = compiled.isLoop ? "LOOP" : "FSM";
          const regSuffix = compiled.registerPorts.length > 0
            ? `[${compiled.registerPorts.map((p) => compiled.inLeaves[p].pathKey || `p${p}`).join(",")}]`
            : "";
          this._makeNode(
            "COMPILED",
            `${kindTag}(${compiled.name})${regSuffix}`,
            inWire,
            outWire,
            scopeId,
            {
              compiled,
              inLeaves,
              outLeaves,
              curDNode: compiled.root,
              peekBuf: inLeaves.map(() => []),
              portIsConst: inLeaves.map(() => false),
              portUnitDrained: inLeaves.map(() => false),
              pendingDrain: null,
              pendingLeaf: null,
              barrier
            }
          );
          this._snapshot(`expand:${compiled.name}`);
          return;
        }
      }
    }
    return super.expandStub(stub);
  }

  stepNode(node) {
    if (node && node.kind === "COMPILED") {
      if (node.state === STATE.RETIRED || node.state === STATE.DONE) return "DONE";
      if (node.state === STATE.FAILED) return "FAILED";
      this.telemetry.schedulerSteps++;
      if (node.barrier && !node.barrier.done) {
        const bRes = this._ensureBarrier(node.barrier);
        if (bRes === "NEED_INPUT") return "NEED_INPUT";
        if (bRes === "FAILED") return this._failMultiOut(node, node.outLeaves);
        if (node.state === STATE.RETIRED) return "PROGRESS";
      }
      return this._stepCompiled(node);
    }
    return super.stepNode(node);
  }

  /**
   * Ensure a compiled node's input port `p` has drained its upstream producer to
   * EOF (preserving unit-guard failures upstream!) and retire the empty deque.
   */
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
    if (f.alive && !f.hasToken() && f.closed) {
      if (f.upstream && f.upstream.state === STATE.DONE) this.retireNode(f.upstream);
      if (f.scopeId === node.scopeId && f.name !== "IN") this.retireDeque(f);
    }
    node.portUnitDrained[p] = true;
    return "DONE";
  }

  /**
   * Pull 1 token from port `p` (preferring in-register `peekBuf[p]` when `portIsConst[p]`
   * or already buffered).
   */
  _readShiftToken(node, p) {
    const buf = node.peekBuf[p];
    if (buf.length > 0) {
      return { status: "OK", tok: buf.shift() };
    }
    if (node.portIsConst[p]) {
      return { status: "FAIL" };
    }
    const dq = node.inLeaves[p].fifo;
    const st = this._ensureToken(dq);
    if (st === "WAIT") return { status: "WAIT" };
    if (st === "NEED_INPUT") return { status: "NEED_INPUT" };
    if (st === "EOF_OR_FAIL") return { status: "FAIL" };
    return { status: "OK", tok: dq.shift() };
  }

  _ensurePeekToken(node, p, depth) {
    const buf = node.peekBuf[p];
    while (buf.length <= depth) {
      if (node.portIsConst[p]) return { status: "FAIL" };
      const dq = node.inLeaves[p].fifo;
      const st = this._ensureToken(dq);
      if (st === "WAIT") return { status: "WAIT" };
      if (st === "NEED_INPUT") return { status: "NEED_INPUT" };
      if (st === "EOF_OR_FAIL") return { status: "FAIL" };
      buf.push(dq.shift());
    }
    return { status: "OK", tok: buf[depth] };
  }

  _stepCompiled(node) {
    const comp = node.compiled;

    // Resume any in-progress discard drain barrier before committing `pendingLeaf`
    if (node.pendingDrain) {
      const bRes = this._ensureBarrier(node.pendingDrain);
      if (bRes === "NEED_INPUT") return "NEED_INPUT";
      if (bRes === "FAILED") return this._failMultiOut(node, node.outLeaves);
      node.pendingDrain = null;
      const leaf = node.pendingLeaf;
      node.pendingLeaf = null;
      return this._commitCompiledLeaf(node, leaf);
    }

    // Tight inner execution loop: step straight through decision DAG & in-place tail loops!
    while (true) {
      const d = node.curDNode;

      if (d.kind === "fail") {
        return this._failMultiOut(node, node.outLeaves);
      }

      if (d.kind === "shift") {
        const res = this._readShiftToken(node, d.p);
        if (res.status === "WAIT") return "PROGRESS";
        if (res.status === "NEED_INPUT") return "NEED_INPUT";
        if (res.status === "FAIL") return this._failMultiOut(node, node.outLeaves);
        const next = d.cases[res.tok];
        if (!next) return this._failMultiOut(node, node.outLeaves);
        node.curDNode = next;
        continue;
      }

      if (d.kind === "peek") {
        const res = this._ensurePeekToken(node, d.p, d.depth);
        if (res.status === "WAIT") return "PROGRESS";
        if (res.status === "NEED_INPUT") return "NEED_INPUT";
        if (res.status === "FAIL") return this._failMultiOut(node, node.outLeaves);
        const next = d.cases[res.tok];
        if (!next) return this._failMultiOut(node, node.outLeaves);
        node.curDNode = next;
        continue;
      }

      if (d.kind === "loop" || d.kind === "emit") {
        // First drain any unit-closed input ports (preserves upstream guards!)
        for (const p of d.unitClosedPorts) {
          const dr = this._drainUnitClosedPort(node, p);
          if (dr === "NEED_INPUT") return "NEED_INPUT";
          if (dr === "FAILED") return this._failMultiOut(node, node.outLeaves);
        }
        // Build a DrainBarrier for any discarded non-const stream ports
        const toDrain = [];
        const portsList = d.kind === "loop" ? d.drainOncePorts : d.drainPorts;
        for (const p of portsList) {
          if (node.portIsConst[p]) {
            node.peekBuf[p].length = 0;
            continue;
          }
          const dq = node.inLeaves[p].fifo;
          // Restore any peeked tokens back onto `dq` so full-value `PatternDPDA("skip")` is exact!
          if (node.peekBuf[p].length > 0) {
            dq.unshiftTokens(node.peekBuf[p]);
            node.peekBuf[p].length = 0;
          }
          // If `Shift` already consumed the terminal unit tag (e.g. `"_"` in unannotated
          // `_classify_bits` whose static target was `"any"`), `dq` is already at EOF!
          if (!dq.hasToken() && dq.closed && !dq.failed) {
            const dr = this._drainUnitClosedPort(node, p);
            if (dr === "NEED_INPUT") return "NEED_INPUT";
            if (dr === "FAILED") return this._failMultiOut(node, node.outLeaves);
            continue;
          }
          toDrain.push(node.inLeaves[p]);
          // If this happens inside a `loop` leaf, mark port as drained/const so we never re-drain!
          if (d.kind === "loop") node.portUnitDrained[p] = true;
        }
        if (toDrain.length > 0) {
          const barrier = this._createDrainBarrier(toDrain, node.scopeId);
          const bRes = this._ensureBarrier(barrier);
          if (bRes === "NEED_INPUT") {
            node.pendingDrain = barrier;
            node.pendingLeaf = d;
            return "NEED_INPUT";
          }
          if (bRes === "FAILED") return this._failMultiOut(node, node.outLeaves);
        }

        if (d.kind === "loop") {
          // Execute IN-PLACE loop transition! Zero node allocations, zero stub expansions!
          this.telemetry.compiledLoopIterations++;
          for (let p = 0; p < comp.inCount; p++) {
            const e = d.nextExprs[p];
            if (e.kind === "const") {
              node.peekBuf[p] = e.tokens.slice();
              node.portIsConst[p] = true;
            } else if (e.kind === "splice") {
              if (node.portIsConst[p]) {
                const rem = node.peekBuf[p].slice(e.consumeCount);
                node.peekBuf[p] = [...e.prefix, ...rem];
              } else {
                node.peekBuf[p].length = 0;
                if (e.prefix.length > 0) {
                  const dq = node.inLeaves[p].fifo;
                  if (e.unconsumed && e.unconsumed.length > 0) dq.unshiftTokens(e.unconsumed);
                  if (e.newPrefix && e.newPrefix.length > 0) {
                    for (let i = e.newPrefix.length - 1; i >= 0; i--) dq.unshift(e.newPrefix[i]);
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

    // Detach & retire this compiled node before wiring outputs / exit continuations
    node.state = STATE.RETIRED;
    this.nodes.delete(node.id);

    const materializeExprToDeque = (e, outDq) => {
      if (e.kind === "const") {
        for (const tok of e.tokens) outDq.push(tok);
        outDq.close();
        if (outDq.upstream === node) outDq.upstream = null;
        return;
      }
      if (e.kind === "splice") {
        const p = e.p;
        if (node.portIsConst[p]) {
          const rem = node.peekBuf[p].slice(e.consumeCount);
          for (const tok of e.prefix) outDq.push(tok);
          for (const tok of rem) outDq.push(tok);
          outDq.close();
          if (outDq.upstream === node) outDq.upstream = null;
          return;
        }
        const inDq = node.inLeaves[p].fifo;
        node.peekBuf[p].length = 0;
        if (e.unconsumed && e.unconsumed.length > 0) {
          inDq.unshiftTokens(e.unconsumed);
        }
        if (e.newPrefix && e.newPrefix.length > 0) {
          for (let i = e.newPrefix.length - 1; i >= 0; i--) inDq.unshift(e.newPrefix[i]);
        }
        // Try O(1) direct splice into downstream of `outDq`!
        if (!inDq.failed && this._trySpliceScalar(null, inDq, outDq, "idSplices")) {
          return;
        }
        // Fallback (e.g. `outDq` is `ROOT_OUT` or cross-scope): attach a pure `ID` copy node
        this._wireCopy(inDq, outDq, scopeId, null);
        return;
      }
      if (e.kind === "cont") {
        // Instantiate exit continuation blueprint (e.g. `msb_drop_zeros rev_bits`)!
        const contInWire = this.createWire(e.bp.inPlist, 0, `ce${this.nextFifoId}`, scopeId);
        const contInLeaves = wireLeaves(contInWire);
        // Instantiate continuation RIGHT-TO-LEFT (so `contInLeaves` already have `.downstream` attached,
        // enabling zero-node splicing of every `e.inExprs[k]` directly into `contInWire`!)
        this.instantiate(e.bp, contInWire, outDq, scopeId, null);
        for (let k = 0; k < contInLeaves.length; k++) {
          materializeExprToDeque(e.inExprs[k], contInLeaves[k].fifo);
        }
      }
    };

    for (let q = 0; q < comp.outCount; q++) {
      materializeExprToDeque(d.outExprs[q], node.outLeaves[q].fifo);
    }

    return "PROGRESS";
  }

  toMermaid() {
    const base = super.toMermaid();
    // Style COMPILED nodes distinctly in purple so they pop visually in walkthroughs!
    const lines = base.split("\n");
    const out = [];
    for (const line of lines) {
      const m = line.match(/^  N(\d+)\["((?:LOOP|FSM)\([^"]*\)(?:\[[^\]]*\])?)"\]$/);
      if (m) {
        out.push(`  N${m[1]}[["${m[2]}"]]:::compiled`);
      } else {
        out.push(line);
      }
    }
    out.push("  classDef compiled fill:#ede9fe,color:#4c1d95,stroke:#7c3aed,stroke-width:2px");
    return out.join("\n");
  }
}
