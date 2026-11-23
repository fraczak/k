/**
 * 1-state Deterministic Pushdown Automaton (DPDA) for closed pattern graphs.
 *
 * Stack alphabet = pattern node IDs (or paired [inNodeId, outNodeId] for coerce).
 * Each `step(inFifo, outFifo)` processes at most ONE union-tag token (draining
 * zero-token product frames eagerly), returning:
 *   - "STEPPED"    : consumed/forwarded a token, more work remains
 *   - "NEED_INPUT" : blocked waiting for a token on `inFifo`
 *   - "DONE"       : complete value consumed (and forwarded if copy/coerce)
 *   - "FAILED"     : tag mismatch or upstream failure
 */

export class PatternDPDA {
  constructor(mode, inPlist, inStartNode = 0, outPlist = null, outStartNode = 0) {
    this.mode = mode; // "skip" | "copy" | "coerce"
    this.inPlist = inPlist;
    this.outPlist = outPlist || inPlist;
    this.stack = mode === "coerce"
      ? [[inStartNode, outStartNode]]
      : [inStartNode];
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
            for (let i = eIn.length - 1; i >= 0; i--) {
              this.stack.push([eIn[i][1], uOut]);
            }
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
          for (let i = edges.length - 1; i >= 0; i--) {
            this.stack.push(edges[i][1]);
          }
        } else {
          break;
        }
      }
    }
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  step(inFifo, outFifo = null) {
    if (this.done) return "DONE";
    if (this.failed) return "FAILED";

    if (!inFifo.hasToken()) {
      if (inFifo.failed) {
        this.failed = true;
        return "FAILED";
      }
      if (inFifo.closed) {
        // Unexpected EOF before completing the value
        this.failed = true;
        return "FAILED";
      }
      return "NEED_INPUT";
    }

    const tok = inFifo.shift();
    if (this.mode === "coerce") {
      const [uIn, uOut] = this.stack.pop();
      const [kIn, eIn] = this.inPlist[uIn];
      const [kOut, eOut] = this.outPlist[uOut];
      const isUnionIn = kIn === "closed-union" || kIn === "open-union";
      const isUnionOut = kOut === "closed-union" || kOut === "open-union";
      if (!isUnionIn || (!isUnionOut && kOut !== "any")) {
        this.failed = true;
        return "FAILED";
      }
      const edgeIn = eIn.find(([t]) => t === tok);
      if (!edgeIn) {
        this.failed = true;
        return "FAILED";
      }
      if (kOut === "any") {
        outFifo.push(tok);
        this.stack.push([edgeIn[1], uOut]);
      } else {
        const edgeOut = eOut.find(([t]) => t === tok);
        if (!edgeOut) {
          this.failed = true;
          return "FAILED";
        }
        outFifo.push(tok);
        this.stack.push([edgeIn[1], edgeOut[1]]);
      }
    } else {
      const u = this.stack.pop();
      const [kind, edges] = this.inPlist[u];
      if (kind !== "closed-union" && kind !== "open-union") {
        this.failed = true;
        return "FAILED";
      }
      const edge = edges.find(([t]) => t === tok);
      if (!edge) {
        this.failed = true;
        return "FAILED";
      }
      if (this.mode === "copy") {
        outFifo.push(tok);
      }
      this.stack.push(edge[1]);
    }

    this._drainProducts();
    if (this.failed) return "FAILED";
    return this.done ? "DONE" : "STEPPED";
  }
}
