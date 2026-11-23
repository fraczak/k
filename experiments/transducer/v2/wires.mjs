/**
 * Iteration 2: Multi-Port Wire Bundles & O(1) TokenDeque channels.
 *
 * Instead of serializing a closed-product `{ f1, ..., fm }` into one linear
 * FIFO, Iteration 2 unpacks products recursively into a `WireBundle` of
 * parallel independent `TokenDeque` leaf channels.
 *
 * Each `TokenDeque` is a two-stack deque supporting O(1) amortized:
 *   - `push(tok)`        : append at back (upstream producer)
 *   - `unshift(tok)`     : prepend at front (O(1) `VID |tag` prepend-splicing!)
 *   - `unshiftTokens(a)` : prepend array at front (SPEC_SW last-branch splicing)
 *   - `shift()` / `peek()`: read from front (downstream consumer)
 */

import { serializeValue, deserializeTokens } from "../token-stream.mjs";

export { serializeValue, deserializeTokens };

export class TokenDeque {
  constructor(id, { name = "", path = "", plist = null, nodeId = 0, upstream = null, downstream = null, scopeId = 0, telemetry = null } = {}) {
    this.kind = "fifo";
    this.id = id;
    this.name = name || `F${id}`;
    this.path = path;
    this.plist = plist;
    this.nodeId = nodeId;
    this.upstream = upstream;
    this.downstream = downstream;
    this.scopeId = scopeId;
    this.telemetry = telemetry;

    this.front = []; // reversed stack: front[front.length - 1] is the next token
    this.back = [];
    this.backHead = 0;

    this.closed = false;
    this.failed = false;
    this.alive = true;
  }

  get length() {
    return this.front.length + (this.back.length - this.backHead);
  }

  hasToken() {
    return this.front.length > 0 || this.backHead < this.back.length;
  }

  peek() {
    if (this.front.length > 0) return this.front[this.front.length - 1];
    if (this.backHead < this.back.length) return this.back[this.backHead];
    return undefined;
  }

  push(tok) {
    this.back.push(tok);
    if (this.telemetry) {
      this.telemetry.totalTokensTransferred++;
      this.telemetry.liveFifoTokens++;
      if (this.telemetry.liveFifoTokens > this.telemetry.peakFifoTokens) {
        this.telemetry.peakFifoTokens = this.telemetry.liveFifoTokens;
      }
    }
  }

  unshift(tok) {
    this.front.push(tok);
    if (this.telemetry) {
      this.telemetry.totalTokensTransferred++;
      this.telemetry.liveFifoTokens++;
      if (this.telemetry.liveFifoTokens > this.telemetry.peakFifoTokens) {
        this.telemetry.peakFifoTokens = this.telemetry.liveFifoTokens;
      }
    }
  }

  unshiftTokens(prefix) {
    if (!prefix || prefix.length === 0) return;
    for (let i = prefix.length - 1; i >= 0; i--) {
      this.front.push(prefix[i]);
    }
    if (this.telemetry) {
      this.telemetry.liveFifoTokens += prefix.length;
      if (this.telemetry.liveFifoTokens > this.telemetry.peakFifoTokens) {
        this.telemetry.peakFifoTokens = this.telemetry.liveFifoTokens;
      }
    }
  }

  shift() {
    let tok;
    if (this.front.length > 0) {
      tok = this.front.pop();
    } else if (this.backHead < this.back.length) {
      tok = this.back[this.backHead++];
      if (this.backHead > 64 && this.backHead * 2 >= this.back.length) {
        this.back = this.back.slice(this.backHead);
        this.backHead = 0;
      }
    } else {
      throw new Error(`TokenDeque ${this.name}: underflow`);
    }
    if (this.telemetry) {
      this.telemetry.liveFifoTokens--;
    }
    return tok;
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
    const rem = this.length;
    if (this.telemetry && rem > 0) {
      this.telemetry.liveFifoTokens -= rem;
    }
    this.front.length = 0;
    this.back.length = 0;
    this.backHead = 0;
  }
}

export class WireBundle {
  constructor(fields, plist, nodeId = 0) {
    this.kind = "bundle";
    this.fields = fields; // Map<label, Wire> in canonical order
    this.plist = plist;
    this.nodeId = nodeId;
  }
}

/**
 * Enumerate all leaf `{ pathKey, path, fifo }` entries of a Wire in canonical order.
 */
export function wireLeaves(wire, prefix = [], out = []) {
  if (wire.kind === "fifo") {
    out.push({ pathKey: prefix.join("."), path: prefix, fifo: wire });
    return out;
  }
  for (const [label, child] of wire.fields.entries()) {
    wireLeaves(child, [...prefix, label], out);
  }
  return out;
}

/**
 * Resolve a sub-wire at a dot-separated path (e.g. "sub.b" or "").
 */
export function wireAtPath(wire, pathKey) {
  if (!pathKey) return wire;
  let cur = wire;
  for (const seg of pathKey.split(".")) {
    if (cur.kind !== "bundle" || !cur.fields.has(seg)) {
      throw new Error(`wireAtPath: missing segment '${seg}' in '${pathKey}'`);
    }
    cur = cur.fields.get(seg);
  }
  return cur;
}

/**
 * Collect all leaf path keys of a closed pattern property-list graph.
 */
export function patternLeafPaths(plist, nodeId = 0, prefix = [], out = []) {
  const [kind, edges] = plist[nodeId];
  if (kind === "closed-product" && edges.length > 0) {
    for (const [label, target] of edges) {
      patternLeafPaths(plist, target, [...prefix, label], out);
    }
    return out;
  }
  out.push({ pathKey: prefix.join("."), path: prefix, nodeId, isUnit: kind === "closed-product" });
  return out;
}
