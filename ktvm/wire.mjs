/**
 * Strictly iterative k-wire boundary codecs and resumable 1-state DPDA steppers.
 *
 * Guarantees zero host call-stack recursion (handles arbitrarily deep 4,096+ bit
 * values cleanly) and 100% bit-exact conformance with codecs/WIRE_FORMAT.md and
 * codecs/runtime/prefix-codec.mjs.
 */

import { Value, isProduct, isVariant } from "../Value.mjs";
import {
  encodeToWire,
  decodeWire,
  choiceWidth,
  propertyListToPattern,
  patternToPropertyList,
  CORE_PATTERN_PROPERTY_LIST
} from "../codecs/runtime/prefix-codec.mjs";
import {
  textToStringValue,
  stringValueToText
} from "../codecs/runtime/unicode-string.mjs";
import { BitDeque } from "./bit-deque.mjs";
import { compareLabels } from "./schema.mjs";

export const DPDA_RESULT = Object.freeze({
  DONE: "DONE",
  NEED_BITS: "NEED_BITS",
  FAILED: "FAILED"
});

/**
 * Strictly iterative Value -> BitDeque encoder under closed property-list `plist`.
 */
export function encodePayloadToDeque(value, plist, deque, rootId = 0) {
  const stack = [{ val: value, nodeId: rootId }];
  while (stack.length > 0) {
    const { val, nodeId } = stack.pop();
    const [kind, edges] = plist[nodeId];
    if (kind === "closed-product") {
      if (!isProduct(val)) {
        throw new Error(`Expected product value at schema node ${nodeId}`);
      }
      // Push children in reverse canonical order so LIFO emits them in canonical order.
      for (let i = edges.length - 1; i >= 0; i--) {
        const [label, targetId] = edges[i];
        if (!(label in val.product)) {
          throw new Error(`Product value missing field '${label}' at schema node ${nodeId}`);
        }
        stack.push({ val: val.product[label], nodeId: targetId });
      }
    } else if (kind === "closed-union") {
      if (!isVariant(val)) {
        throw new Error(`Expected variant value at schema node ${nodeId}`);
      }
      const ord = edges.findIndex(([l]) => l === val.tag);
      if (ord < 0) {
        throw new Error(`Variant tag '${val.tag}' not in closed union at node ${nodeId}`);
      }
      const w = choiceWidth(edges.length);
      if (w > 0) deque.pushBits(ord, w);
      stack.push({ val: val.value, nodeId: edges[ord][1] });
    } else {
      throw new Error(`Cannot encode payload under non-closed schema kind '${kind}'`);
    }
  }
}

/**
 * Strictly iterative BitDeque -> Value decoder under closed property-list `plist`.
 * Rejects truncation, invalid union ordinals, and leftover unconsumed bits.
 */
export function decodeDequeToValue(deque, plist, rootId = 0, { exact = true } = {}) {
  const results = [];
  // Frames: { kind: "decode", nodeId } | { kind: "build_product", labels } | { kind: "build_variant", tag }
  const frames = [{ kind: "decode", nodeId: rootId }];

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame.kind === "build_product") {
      const n = frame.labels.length;
      const vals = new Array(n);
      for (let i = n - 1; i >= 0; i--) {
        vals[i] = results.pop();
      }
      const fields = {};
      for (let i = 0; i < n; i++) {
        fields[frame.labels[i]] = vals[i];
      }
      results.push(Value.product(fields));
      continue;
    }
    if (frame.kind === "build_variant") {
      const payload = results.pop();
      results.push(Value.variant(frame.tag, payload));
      continue;
    }

    const [kind, edges] = plist[frame.nodeId];
    if (kind === "closed-product") {
      if (edges.length === 0) {
        results.push(Value.product({}));
      } else {
        frames.push({ kind: "build_product", labels: edges.map(([l]) => l) });
        for (let i = edges.length - 1; i >= 0; i--) {
          frames.push({ kind: "decode", nodeId: edges[i][1] });
        }
      }
    } else if (kind === "closed-union") {
      if (edges.length === 0) {
        throw new Error("Cannot decode empty union");
      }
      const w = choiceWidth(edges.length);
      let ord = 0;
      if (w > 0) {
        if (!deque.hasBits(w)) {
          throw new Error(`Truncated k-wire stream: needed ${w} bits at union node ${frame.nodeId}`);
        }
        ord = deque.shiftBits(w);
      }
      if (ord >= edges.length) {
        throw new Error(`Invalid union ordinal ${ord} (expected < ${edges.length}) at node ${frame.nodeId}`);
      }
      const [tag, targetId] = edges[ord];
      frames.push({ kind: "build_variant", tag });
      frames.push({ kind: "decode", nodeId: targetId });
    } else {
      throw new Error(`Cannot decode payload under non-closed schema kind '${kind}'`);
    }
  }

  if (exact && deque.length !== 0) {
    throw new Error(`Trailing unconsumed bits in BitDeque (${deque.length} bits remaining)`);
  }
  return results[0];
}

/**
 * Push a byte buffer into a BitDeque (MSB-first per byte), stripping trailing
 * zero-padding beyond `totalBits` if specified.
 */
export function writeBytesToDeque(bytes, deque, totalBits = bytes.length * 8) {
  let rem = totalBits;
  for (let i = 0; i < bytes.length && rem > 0; i++) {
    if (rem >= 8) {
      deque.pushBits(bytes[i], 8);
      rem -= 8;
    } else {
      deque.pushBits(bytes[i] >>> (8 - rem), rem);
      rem = 0;
    }
  }
}

/**
 * Drain a BitDeque into a zero-padded Uint8Array (exact k-wire byte framing).
 */
export function dequeToPaddedBytes(deque) {
  const totalBits = deque.length;
  const byteLen = Math.ceil(totalBits / 8);
  const out = Buffer.alloc(byteLen);
  let byteIdx = 0;
  let rem = totalBits;
  while (rem >= 8) {
    out[byteIdx++] = deque.shiftBits(8);
    rem -= 8;
  }
  if (rem > 0) {
    out[byteIdx++] = (deque.shiftBits(rem) << (8 - rem)) & 0xff;
  }
  return out;
}

/**
 * Decode ONLY the k-wire envelope header prefix (`encode(pattern_value)`) without
 * running a JS DPDA over the payload bits. Returns `{ plist, headerBitLen, canonicalOrder }`
 * so Wasm/native runners can validate and stream the remaining payload bits directly.
 */
export function splitWireHeaderOnly(buffer, { quota = null } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const full = new BitDeque(-1, { quota });
  const totalBits = bytes.length * 8;
  writeBytesToDeque(bytes, full, totalBits);

  const patternValue = decodeDequeToValue(full, CORE_PATTERN_PROPERTY_LIST, 0, { exact: false });
  const headerBitLen = totalBits - full.length;
  full.release();

  const rawPlist = patternValueToPropertyList(patternValue);
  let canonicalOrder = true;
  const plist = rawPlist.map(([kind, edges]) => {
    for (let i = 1; i < edges.length; i++) {
      if (compareLabels(edges[i - 1][0], edges[i][0]) >= 0) {
        canonicalOrder = false;
        break;
      }
    }
    if (kind === "open-union") return ["closed-union", edges];
    if (kind === "open-product") return ["closed-product", edges];
    return [kind, edges];
  });

  return { plist, headerBitLen, canonicalOrder };
}

/**
 * Decode an enveloped k-wire byte buffer (`encode(pattern_value) encode(payload)`)
 * strictly iteratively into `{ plist, payloadDeque }`.
 *
 * Rejects malformed headers, truncated streams, invalid ordinals, and nonzero
 * trailing padding bits (matching WIRE_FORMAT.md).
 */
export function splitEnvelopedWire(buffer, { quota = null } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const full = new BitDeque(-1, { quota });
  writeBytesToDeque(bytes, full, bytes.length * 8);

  // Decode the pattern header using K's CORE_PATTERN_PROPERTY_LIST
  const patternValue = decodeDequeToValue(full, CORE_PATTERN_PROPERTY_LIST, 0, { exact: false });
  const rawPlist = patternValueToPropertyList(patternValue);
  // Concrete k-wire headers may tag value-derived variants/products as `open-union` /
  // `open-product` (see prefix-codec.mjs `deriveClosedPatternFromValue`), whose wire
  // encoding is identical to `closed-union` / `closed-product` over their listed edges.
  const plist = rawPlist.map(([kind, edges]) => {
    if (kind === "open-union") return ["closed-union", edges];
    if (kind === "open-product") return ["closed-product", edges];
    return [kind, edges];
  });

  // Validate and extract exact payload bits by running DPDA copy into payloadDeque,
  // then verify all remaining bits (< 8) are zero trailing byte padding.
  const payloadDeque = new BitDeque(-2, { prodSchema: plist, consSchema: plist, quota });
  const copyState = createDpdaCopy(plist, 0);
  const res = stepDpdaCopy(full, payloadDeque, copyState);
  if (res !== DPDA_RESULT.DONE) {
    full.release();
    payloadDeque.release();
    throw new Error("Malformed k-wire envelope payload (truncated or invalid union ordinal)");
  }
  if (full.length >= 8) {
    const extra = full.length;
    full.release();
    payloadDeque.release();
    throw new Error(`Malformed k-wire envelope: ${extra} trailing bits after payload`);
  }
  if (full.length > 0) {
    const pad = full.shiftBits(full.length);
    if (pad !== 0) {
      full.release();
      payloadDeque.release();
      throw new Error(`Malformed k-wire envelope: nonzero trailing padding bits (0b${pad.toString(2)})`);
    }
  }
  full.release();
  payloadDeque.close();
  return { plist, payloadDeque };
}

/**
 * Frame a closed `plist` + payload `BitDeque` into a complete enveloped k-wire
 * `Uint8Array`, 100% bit-exact with `encodeToWire` in `codecs/runtime/prefix-codec.mjs`.
 */
export function frameEnvelopedWire(plist, payloadDeque) {
  const headerVal = propertyListToPatternValue(plist);
  const out = new BitDeque(-3);
  encodePayloadToDeque(headerVal, CORE_PATTERN_PROPERTY_LIST, out, 0);
  out.pushFromDeque(payloadDeque);
  const bytes = dequeToPaddedBytes(out);
  out.release();
  return bytes;
}

/**
 * Convenience bridge: encode a K `Value` under closed `plist` to enveloped k-wire bytes
 * using K's canonical `encodeToWire`.
 */
export function encodeValueToEnvelopedWire(value, plist) {
  return encodeToWire(value, plist);
}

export function decodeEnvelopedWireToValue(bytes) {
  return decodeWire(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}

// --- Pattern Value <-> Property List helpers (using K's canonical pattern codec) ---

function patternValueToPropertyList(patternValue) {
  // Reuse K's canonical decoder by encoding only header? Better: convert directly!
  // Pattern value matches CORE_PATTERN_PROPERTY_LIST (list of node variants).
  const nodes = [];
  let cur = patternValue;
  while (isVariant(cur) && cur.tag === "cons") {
    const nodeVal = cur.value.product.car;
    const kind = nodeVal.tag;
    const edges = [];
    if (kind !== "any") {
      let ecur = nodeVal.value;
      while (isVariant(ecur) && ecur.tag === "cons") {
        const edgeProd = ecur.value.product.car.product;
        const label = decodeKStringValue(edgeProd.label);
        const target = decodeKBitsUint(edgeProd.target);
        edges.push([label, target]);
        ecur = ecur.value.product.cdr;
      }
    }
    nodes.push([kind, edges]);
    cur = cur.value.product.cdr;
  }
  return nodes;
}

function propertyListToPatternValue(plist) {
  // Use K's own `encodeToWire` header or direct conversion via `patternToPropertyList`.
  // Build canonical pattern[] Value directly matching CORE_PATTERN_PROPERTY_LIST!
  let listVal = Value.variant("nil", Value.product({}));
  for (let i = plist.length - 1; i >= 0; i--) {
    const [kind, edges] = plist[i];
    let nodeVal;
    if (kind === "any") {
      nodeVal = Value.variant("any", Value.product({}));
    } else {
      let edgeList = Value.variant("nil", Value.product({}));
      for (let j = edges.length - 1; j >= 0; j--) {
        const [label, target] = edges[j];
        const edgeProd = Value.product({
          label: encodeKStringValue(label),
          target: encodeKBitsUint(target)
        });
        edgeList = Value.variant("cons", Value.product({ car: edgeProd, cdr: edgeList }));
      }
      nodeVal = Value.variant(kind, edgeList);
    }
    listVal = Value.variant("cons", Value.product({ car: nodeVal, cdr: listVal }));
  }
  return listVal;
}

function decodeKBitsUint(bitsVal) {
  // `bits[]` target indices in WIRE_FORMAT.md / prefix-codec.mjs are LSB-first (`01_` = 2)
  let acc = 0;
  let place = 1;
  let cur = bitsVal;
  while (isVariant(cur) && cur.tag !== "_") {
    if (cur.tag === "1") acc += place;
    place *= 2;
    cur = cur.value;
  }
  return acc;
}

function encodeKBitsUint(n) {
  const unit = Value.product({});
  if (n === 0) return Value.variant("_", unit);
  const bits = [];
  let v = n;
  while (v > 0) {
    bits.push(v & 1 ? "1" : "0");
    v = Math.floor(v / 2);
  }
  let cur = Value.variant("_", unit);
  for (let i = bits.length - 1; i >= 0; i--) {
    cur = Value.variant(bits[i], cur);
  }
  return cur;
}

function decodeKStringValue(strVal) {
  return stringValueToText(strVal);
}

function encodeKStringValue(str) {
  return textToStringValue(str);
}

// --- Strictly Iterative, Resumable 1-State Pushdown Steppers ---

export function createDpdaSkip(plist, rootId = 0) {
  return { plist, stack: [rootId] };
}

export function stepDpdaSkip(srcDeque, state) {
  const { plist, stack } = state;
  while (stack.length > 0) {
    const nodeId = stack[stack.length - 1];
    const [kind, edges] = plist[nodeId];
    if (kind === "closed-product") {
      stack.pop();
      for (let i = edges.length - 1; i >= 0; i--) {
        stack.push(edges[i][1]);
      }
    } else if (kind === "closed-union") {
      if (edges.length === 0) return DPDA_RESULT.FAILED;
      const w = choiceWidth(edges.length);
      let ord = 0;
      if (w > 0) {
        if (!srcDeque.hasBits(w)) {
          return srcDeque.isOpen ? DPDA_RESULT.NEED_BITS : DPDA_RESULT.FAILED;
        }
        ord = srcDeque.shiftBits(w);
        srcDeque.aligned = false;
      }
      if (ord >= edges.length) return DPDA_RESULT.FAILED;
      stack.pop();
      stack.push(edges[ord][1]);
    } else {
      return DPDA_RESULT.FAILED;
    }
  }
  return DPDA_RESULT.DONE;
}

export function createDpdaCopy(plist, rootId = 0) {
  return { plist, stack: [rootId] };
}

export function stepDpdaCopy(srcDeque, dstDeque, state) {
  const { plist, stack } = state;
  while (stack.length > 0) {
    const nodeId = stack[stack.length - 1];
    const [kind, edges] = plist[nodeId];
    if (kind === "closed-product") {
      stack.pop();
      for (let i = edges.length - 1; i >= 0; i--) {
        stack.push(edges[i][1]);
      }
    } else if (kind === "closed-union") {
      if (edges.length === 0) return DPDA_RESULT.FAILED;
      const w = choiceWidth(edges.length);
      let ord = 0;
      if (w > 0) {
        if (!srcDeque.hasBits(w)) {
          return srcDeque.isOpen ? DPDA_RESULT.NEED_BITS : DPDA_RESULT.FAILED;
        }
        ord = srcDeque.shiftBits(w);
        srcDeque.aligned = false;
      }
      if (ord >= edges.length) return DPDA_RESULT.FAILED;
      if (w > 0) dstDeque.pushBits(ord, w);
      stack.pop();
      stack.push(edges[ord][1]);
    } else {
      return DPDA_RESULT.FAILED;
    }
  }
  return DPDA_RESULT.DONE;
}

export function createDpdaCoerce(srcPlist, srcRoot, dstPlist, dstRoot) {
  return { srcPlist, dstPlist, stack: [{ s: srcRoot, d: dstRoot }] };
}

export function stepDpdaCoerce(srcDeque, dstDeque, state) {
  const { srcPlist, dstPlist, stack } = state;
  while (stack.length > 0) {
    const { s, d } = stack[stack.length - 1];
    const [sKind, sEdges] = srcPlist[s];
    const [dKind, dEdges] = dstPlist[d];

    if (sKind === "closed-product" && dKind === "closed-product") {
      if (sEdges.length !== dEdges.length) return DPDA_RESULT.FAILED;
      stack.pop();
      for (let i = sEdges.length - 1; i >= 0; i--) {
        if (sEdges[i][0] !== dEdges[i][0]) return DPDA_RESULT.FAILED;
        stack.push({ s: sEdges[i][1], d: dEdges[i][1] });
      }
    } else if (sKind === "closed-union" && dKind === "closed-union") {
      if (sEdges.length === 0 || dEdges.length === 0) return DPDA_RESULT.FAILED;
      const sw = choiceWidth(sEdges.length);
      let sOrd = 0;
      if (sw > 0) {
        if (!srcDeque.hasBits(sw)) {
          return srcDeque.isOpen ? DPDA_RESULT.NEED_BITS : DPDA_RESULT.FAILED;
        }
        sOrd = srcDeque.shiftBits(sw);
        srcDeque.aligned = false;
      }
      if (sOrd >= sEdges.length) return DPDA_RESULT.FAILED;
      const [label, sNext] = sEdges[sOrd];
      const dOrd = dEdges.findIndex(([l]) => l === label);
      if (dOrd < 0) return DPDA_RESULT.FAILED;
      const dw = choiceWidth(dEdges.length);
      if (dw > 0) dstDeque.pushBits(dOrd, dw);
      stack.pop();
      stack.push({ s: sNext, d: dEdges[dOrd][1] });
    } else {
      return DPDA_RESULT.FAILED;
    }
  }
  return DPDA_RESULT.DONE;
}
