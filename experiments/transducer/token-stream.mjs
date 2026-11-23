/**
 * Closed-pattern preorder token stream serialization & TokenFIFO channels.
 *
 * Under a closed patternToPropertyList graph `plist`, a Value serializes to
 * a flat, prefix-free array of union-tag tokens:
 *   - unit {}           -> []
 *   - closed-product    -> concatenation of fields in canonical edge order
 *   - closed-union(tag) -> [tag, ...payload]
 */

import { Value, isProduct, isVariant } from "../../Value.mjs";

export function serializeValue(value, plist, nodeId = 0, out = []) {
  const stack = [{ value, nodeId }];
  while (stack.length > 0) {
    const { value: cur, nodeId: nid } = stack.pop();
    const [kind, edges] = plist[nid];
    if (kind === "closed-product") {
      if (!isProduct(cur)) {
        throw new Error(`serializeValue: expected Product at node ${nid}`);
      }
      for (let i = edges.length - 1; i >= 0; i--) {
        const [label, target] = edges[i];
        const field = cur.product[label];
        if (field === undefined) {
          throw new Error(`serializeValue: missing product field '${label}' at node ${nid}`);
        }
        stack.push({ value: field, nodeId: target });
      }
    } else if (kind === "closed-union") {
      if (!isVariant(cur)) {
        throw new Error(`serializeValue: expected Variant at node ${nid}`);
      }
      const edge = edges.find(([tag]) => tag === cur.tag);
      if (!edge) {
        throw new Error(`serializeValue: tag '${cur.tag}' not in closed-union at node ${nid}`);
      }
      out.push(cur.tag);
      stack.push({ value: cur.value, nodeId: edge[1] });
    } else {
      throw new Error(`serializeValue: unsupported non-closed pattern kind '${kind}' at node ${nid}`);
    }
  }
  return out;
}

export function deserializeTokens(tokens, plist, nodeId = 0) {
  let pos = 0;
  let rootValue = null;
  const stack = [{ nodeId, assign: (v) => { rootValue = v; } }];

  while (stack.length > 0) {
    const frame = stack.pop();
    const [kind, edges] = plist[frame.nodeId];
    if (kind === "closed-product") {
      const fields = {};
      const prod = Value.product(fields);
      frame.assign(prod);
      for (let i = edges.length - 1; i >= 0; i--) {
        const [label, target] = edges[i];
        stack.push({
          nodeId: target,
          assign: (v) => { fields[label] = v; }
        });
      }
    } else if (kind === "closed-union") {
      if (pos >= tokens.length) {
        throw new Error(`deserializeTokens: unexpected EOF at node ${frame.nodeId}`);
      }
      const tag = tokens[pos++];
      const edge = edges.find(([t]) => t === tag);
      if (!edge) {
        throw new Error(`deserializeTokens: unexpected tag '${tag}' at node ${frame.nodeId}`);
      }
      const assign = frame.assign;
      stack.push({
        nodeId: edge[1],
        assign: (payload) => assign(Value.variant(tag, payload))
      });
    } else {
      throw new Error(`deserializeTokens: unsupported pattern kind '${kind}'`);
    }
  }

  if (pos !== tokens.length) {
    throw new Error(`deserializeTokens: trailing tokens (${tokens.length - pos} unread)`);
  }
  return rootValue;
}

/**
 * Directed FIFO channel carrying symbolic tag tokens between two transducer nodes.
 */
export class TokenFIFO {
  constructor(id, { name = "", upstream = null, downstream = null, scopeId = 0, telemetry = null } = {}) {
    this.id = id;
    this.name = name || `F${id}`;
    this.upstream = upstream;
    this.downstream = downstream;
    this.scopeId = scopeId;
    this.telemetry = telemetry;
    this.tokens = [];
    this.readIdx = 0;
    this.closed = false;
    this.failed = false;
    this.alive = true;
  }

  get length() {
    return this.tokens.length - this.readIdx;
  }

  hasToken() {
    return this.readIdx < this.tokens.length;
  }

  peek() {
    return this.readIdx < this.tokens.length ? this.tokens[this.readIdx] : undefined;
  }

  push(tok) {
    this.tokens.push(tok);
    if (this.telemetry) {
      this.telemetry.totalTokensTransferred++;
      this.telemetry.liveFifoTokens++;
      if (this.telemetry.liveFifoTokens > this.telemetry.peakFifoTokens) {
        this.telemetry.peakFifoTokens = this.telemetry.liveFifoTokens;
      }
    }
  }

  shift() {
    if (this.readIdx >= this.tokens.length) {
      throw new Error(`TokenFIFO ${this.name}: underflow`);
    }
    const tok = this.tokens[this.readIdx++];
    if (this.telemetry) {
      this.telemetry.liveFifoTokens--;
    }
    // Periodically compact consumed prefix
    if (this.readIdx > 64 && this.readIdx * 2 >= this.tokens.length) {
      this.tokens = this.tokens.slice(this.readIdx);
      this.readIdx = 0;
    }
    return tok;
  }

  unshiftTokens(prefix) {
    if (!prefix || prefix.length === 0) return;
    const remaining = this.readIdx > 0 ? this.tokens.slice(this.readIdx) : this.tokens;
    this.tokens = prefix.concat(remaining);
    this.readIdx = 0;
    if (this.telemetry) {
      this.telemetry.liveFifoTokens += prefix.length;
      if (this.telemetry.liveFifoTokens > this.telemetry.peakFifoTokens) {
        this.telemetry.peakFifoTokens = this.telemetry.liveFifoTokens;
      }
    }
  }

  close() {
    this.closed = true;
  }

  markFailed() {
    this.failed = true;
  }

  release() {
    if (!this.alive) return;
    this.alive = false;
    if (this.telemetry && this.length > 0) {
      this.telemetry.liveFifoTokens -= this.length;
    }
    this.tokens.length = 0;
    this.readIdx = 0;
  }
}
