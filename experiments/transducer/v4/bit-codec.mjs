/**
 * Iteration 4: Strict K-Native Wire Format Codec (`codecs/WIRE_FORMAT.md`).
 *
 * `k-wire` is the contract — we do NOT alter wire serialization:
 *   - Closed product: concatenation of fields in canonical label order (0 framing bits).
 *   - Unit `{}`: 0 bits.
 *   - Closed/open union with `n` edges in canonical order:
 *       ordinal `i ∈ [0, n-1]` encoded MSB-first in `width = n <= 1 ? 0 : ceil(log2(n))` bits.
 *       Codepoints `i ∈ [n, 2^width - 1]` are invalid (`null` in `decodeTable`).
 *
 * Examples on `lib/integer.k`:
 *   - `bits[]` (`0, 1, _`): `0 -> 00 (2b)`, `1 -> 01 (2b)`, `_ -> 10 (2b)` (`11` invalid)
 *   - `int[]` (`+, -`): `+ -> 0 (1b)`, `- -> 1 (1b)`
 *   - `ord[]` (`eq, gt, lt`): `eq -> 00 (2b)`, `gt -> 01 (2b)`, `lt -> 10 (2b)` (`11` invalid)
 *   - `_k_stack[]` (`cons, nil`): `cons -> 0 (1b)`, `nil -> 1 (1b)`
 *
 * Bit-level variable-width consumption (sub-token prefixes, don't-care bit
 * compression, multi-token strides, and heterogeneous cross-node chunks) is
 * compiled strictly OVER this unmodified `k-wire` bitstream in `bit-chunk-compiler.mjs`.
 */

import { Value } from "../../../Value.mjs";

function buildKWireUnionTable(plist, nodeId) {
  const [kind, edges] = plist[nodeId];
  if (kind !== "closed-union" && kind !== "open-union") return null;
  const n = edges.length;
  const byTag = new Map();

  if (n <= 1) {
    if (n === 1) {
      byTag.set(edges[0][0], { tag: edges[0][0], code: 0, width: 0, target: edges[0][1], idx: 0 });
    }
    return {
      kind,
      n,
      byTag,
      maxWidth: 0,
      minWidth: 0,
      hasInvalidAllOnes: false,
      decodeTable: n === 1 ? [byTag.get(edges[0][0])] : []
    };
  }

  const w = Math.ceil(Math.log2(n));
  const tableSize = 1 << w;
  const decodeTable = new Array(tableSize).fill(null);
  for (let i = 0; i < n; i++) {
    const [tag, target] = edges[i];
    const entry = { tag, code: i, width: w, target, idx: i };
    byTag.set(tag, entry);
    decodeTable[i] = entry;
  }

  return {
    kind,
    n,
    byTag,
    maxWidth: w,
    minWidth: w,
    hasInvalidAllOnes: n < tableSize, // e.g. `11` on `bits[]` (n=3 < 4) is guaranteed invalid!
    decodeTable
  };
}

export class BitCodec {
  constructor() {
    this.mode = "k-wire";
    this._cache = new WeakMap();
  }

  getNodeTable(plist, nodeId = 0) {
    if (!plist) return null;
    let byNode = this._cache.get(plist);
    if (!byNode) {
      byNode = new Map();
      this._cache.set(plist, byNode);
    }
    if (!byNode.has(nodeId)) {
      byNode.set(nodeId, buildKWireUnionTable(plist, nodeId));
    }
    return byNode.get(nodeId);
  }

  encodeTag(plist, nodeId, tag) {
    const tbl = this.getNodeTable(plist, nodeId);
    if (!tbl) throw new Error(`BitCodec.encodeTag: node ${nodeId} is not a union`);
    const entry = tbl.byTag.get(tag);
    if (!entry) throw new Error(`BitCodec.encodeTag: unknown tag '${tag}'`);
    return entry;
  }

  /**
   * Peek the next `k-wire` union tag from `bitDq` at schema `(plist, nodeId)`.
   */
  peekTag(bitDq, plist, nodeId) {
    const tbl = this.getNodeTable(plist, nodeId);
    if (!tbl) return { status: "INVALID" };
    if (tbl.maxWidth === 0) {
      return tbl.n === 1 ? { status: "OK", entry: tbl.decodeTable[0] } : { status: "INVALID" };
    }
    if (bitDq.lenBits < tbl.maxWidth) {
      return { status: "NEED_BITS", minNeeded: tbl.maxWidth };
    }
    const code = bitDq.peekBits(tbl.maxWidth);
    const entry = tbl.decodeTable[code];
    if (!entry) return { status: "INVALID" };
    return { status: "OK", entry };
  }

  pushTag(bitDq, plist, nodeId, tag) {
    const entry = this.encodeTag(plist, nodeId, tag);
    if (entry.width > 0) bitDq.pushBits(entry.code, entry.width);
    return entry;
  }

  unshiftTag(bitDq, plist, nodeId, tag) {
    const entry = this.encodeTag(plist, nodeId, tag);
    if (entry.width > 0) bitDq.unshiftBits(entry.code, entry.width);
    return entry;
  }

  /**
   * Serialize a K `Value` into a `BitDeque` in exact `k-wire` payload format.
   */
  serializeValueToDeque(value, plist, bitDq, nodeId = 0) {
    const [kind, edges] = plist[nodeId];
    if (kind === "closed-product") {
      if (value?.type !== "{}") throw new Error("Expected product value");
      for (const [label, target] of edges) {
        this.serializeValueToDeque(value.product[label], plist, bitDq, target);
      }
      return;
    }
    if (kind === "closed-union" || kind === "open-union") {
      if (value?.type !== "<>") throw new Error("Expected variant value");
      const entry = this.pushTag(bitDq, plist, nodeId, value.tag);
      this.serializeValueToDeque(value.value, plist, bitDq, entry.target);
      return;
    }
    throw new Error(`Unsupported pattern kind in BitCodec.serializeValueToDeque: ${kind}`);
  }

  /**
   * Deserialize a complete K `Value` from a closed `BitDeque` in `k-wire` format.
   */
  deserializeDequeToValue(bitDq, plist, nodeId = 0) {
    const [kind, edges] = plist[nodeId];
    if (kind === "closed-product") {
      const obj = {};
      for (const [label, target] of edges) {
        obj[label] = this.deserializeDequeToValue(bitDq, plist, target);
      }
      return Value.product(obj);
    }
    if (kind === "closed-union" || kind === "open-union") {
      const res = this.peekTag(bitDq, plist, nodeId);
      if (res.status !== "OK") {
        throw new Error(`BitCodec.deserializeDequeToValue failed (${res.status})`);
      }
      bitDq.shiftBits(res.entry.width);
      const sub = this.deserializeDequeToValue(bitDq, plist, res.entry.target);
      return Value.variant(res.entry.tag, sub);
    }
    throw new Error(`Unsupported pattern kind in BitCodec.deserializeDequeToValue: ${kind}`);
  }
}
