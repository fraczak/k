/**
 * kTVM Channel ADT (`BitDeque`), Kernel-Local LIFO `BitStack`, and `QuotaTracker`.
 *
 * Implements DOCS/KTVM_SPEC.md §3:
 *   - SPSC bit-addressable double-ended queue with power-of-2 Uint32Array ring buffer
 *   - Dual schema state `(prodSchema, consSchema)` + `aligned` boundary flag
 *   - Strictly monotone status lifecycle: `OPEN -> CLOSED | FAILED`
 *   - Global byte / node / step quota enforcement (`KTVMQuotaError`)
 */

import { KTVMQuotaError } from "./ast.mjs";

const MASKS = new Uint32Array(32);
for (let i = 1; i <= 30; i++) MASKS[i] = ((1 << i) - 1) >>> 0;
MASKS[31] = 0x7fffffff;

export const CHAN_STATUS = Object.freeze({
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  FAILED: "FAILED"
});

export class QuotaTracker {
  constructor({
    maxBitDequeBytes = Infinity,
    maxNodes = Infinity,
    maxSteps = Infinity
  } = {}) {
    this.maxBitDequeBytes = maxBitDequeBytes;
    this.maxNodes = maxNodes;
    this.maxSteps = maxSteps;

    this.liveBitDequeBytes = 0;
    this.peakBitDequeBytes = 0;
    this.liveNodes = 0;
    this.peakNodes = 0;
    this.steps = 0;
  }

  addBufferBytes(delta) {
    this.liveBitDequeBytes += delta;
    if (this.liveBitDequeBytes > this.peakBitDequeBytes) {
      this.peakBitDequeBytes = this.liveBitDequeBytes;
    }
    if (this.liveBitDequeBytes > this.maxBitDequeBytes) {
      throw new KTVMQuotaError("maxBitDequeBytes", this.maxBitDequeBytes, this.liveBitDequeBytes);
    }
  }

  addNode() {
    this.liveNodes += 1;
    if (this.liveNodes > this.peakNodes) {
      this.peakNodes = this.liveNodes;
    }
    if (this.liveNodes > this.maxNodes) {
      throw new KTVMQuotaError("maxNodes", this.maxNodes, this.liveNodes);
    }
  }

  removeNode() {
    if (this.liveNodes > 0) this.liveNodes -= 1;
  }

  tickStep() {
    this.steps += 1;
    if (this.steps > this.maxSteps) {
      throw new KTVMQuotaError("maxSteps", this.maxSteps, this.steps);
    }
  }
}

export class BitDeque {
  constructor(
    id,
    {
      name = "",
      prodSchema = null,
      prodNodeId = 0,
      consSchema = null,
      consNodeId = 0,
      aligned = true,
      prod = null,
      cons = null,
      scope = 0,
      quota = null,
      initialWords = 4
    } = {}
  ) {
    this.id = id;
    this.name = name || `%c${id}`;
    this.status = CHAN_STATUS.OPEN;

    // Dual schemas: upstream suffix obligation (`prodSchema`) vs. downstream view (`consSchema`)
    this.prodSchema = prodSchema;
    this.prodNodeId = prodNodeId;
    this.consSchema = consSchema ?? prodSchema;
    this.consNodeId = consSchema ? consNodeId : prodNodeId;
    this.aligned = aligned;

    this.prod = prod;
    this.cons = cons;
    this.scope = scope;
    this.quota = quota;
    this.retired = false;

    this.words = new Uint32Array(initialWords);
    this.wordMask = initialWords - 1;
    this.capBits = initialWords << 5;
    this.bitMask = this.capBits - 1;
    this.headBit = 0;
    this.lenBits = 0;

    if (this.quota) {
      this.quota.addBufferBytes(this.words.byteLength);
    }
  }

  get length() {
    return this.lenBits;
  }

  get isOpen() {
    return this.status === CHAN_STATUS.OPEN;
  }

  get isClosed() {
    return this.status === CHAN_STATUS.CLOSED;
  }

  get isFailed() {
    return this.status === CHAN_STATUS.FAILED;
  }

  hasBits(n = 1) {
    return this.lenBits >= n;
  }

  _grow(minNeededBits) {
    let newWordsLen = this.words.length << 1;
    while ((newWordsLen << 5) < minNeededBits) newWordsLen <<= 1;
    const oldWords = this.words;
    const oldWordMask = this.wordMask;
    const oldBitMask = this.bitMask;
    const oldHead = this.headBit;
    const oldLen = this.lenBits;
    const oldBytes = oldWords.byteLength;

    const newWords = new Uint32Array(newWordsLen);
    if (this.quota) {
      this.quota.addBufferBytes(newWords.byteLength - oldBytes);
    }

    let rem = oldLen;
    let srcPos = oldHead;
    let dstPos = 0;
    while (rem > 0) {
      const chunk = rem > 30 ? 30 : rem;
      const wi = srcPos >>> 5;
      const bo = srcPos & 31;
      let val;
      if (bo + chunk <= 32) {
        val = (oldWords[wi] >>> (32 - bo - chunk)) & MASKS[chunk];
      } else {
        const lo = bo + chunk - 32;
        const hiBits = 32 - bo;
        const w1 = (wi + 1) & oldWordMask;
        val = (((oldWords[wi] & MASKS[hiBits]) << lo) | (oldWords[w1] >>> (32 - lo))) >>> 0;
      }
      const dwi = dstPos >>> 5;
      const dbo = dstPos & 31;
      if (dbo + chunk <= 32) {
        newWords[dwi] |= (val << (32 - dbo - chunk)) >>> 0;
      } else {
        const lo = dbo + chunk - 32;
        newWords[dwi] |= (val >>> lo) >>> 0;
        newWords[dwi + 1] |= (val << (32 - lo)) >>> 0;
      }
      srcPos = (srcPos + chunk) & oldBitMask;
      dstPos += chunk;
      rem -= chunk;
    }

    this.words = newWords;
    this.wordMask = newWordsLen - 1;
    this.capBits = newWordsLen << 5;
    this.bitMask = this.capBits - 1;
    this.headBit = 0;
  }

  _pushSmall(val, width) {
    if (width <= 0) return;
    if (this.lenBits + width > this.capBits) {
      this._grow(this.lenBits + width);
    }
    const v = (val >>> 0) & MASKS[width];
    const tailPos = (this.headBit + this.lenBits) & this.bitMask;
    const wi = tailPos >>> 5;
    const bo = tailPos & 31;
    if (bo + width <= 32) {
      const shift = 32 - bo - width;
      const clearMask = ~((MASKS[width] << shift) >>> 0);
      this.words[wi] = ((this.words[wi] & clearMask) | ((v << shift) >>> 0)) >>> 0;
    } else {
      const lo = bo + width - 32;
      const hiBits = 32 - bo;
      const w1 = (wi + 1) & this.wordMask;
      const hiMask = ~MASKS[hiBits];
      this.words[wi] = ((this.words[wi] & hiMask) | (v >>> lo)) >>> 0;
      const loShift = 32 - lo;
      const loMask = ~((MASKS[lo] << loShift) >>> 0);
      this.words[w1] = ((this.words[w1] & loMask) | ((v << loShift) >>> 0)) >>> 0;
    }
    this.lenBits += width;
  }

  /** Append `width` bits (0..32, MSB-first) to the back of the buffer. */
  pushBits(val, width) {
    if (width <= 0) return;
    if (width <= 30) {
      this._pushSmall(val, width);
      return;
    }
    const hiWidth = width - 16;
    this._pushSmall((val >>> 16) >>> 0, hiWidth);
    this._pushSmall(val & 0xffff, 16);
  }

  _unshiftSmall(val, width) {
    if (width <= 0) return;
    if (this.lenBits + width > this.capBits) {
      this._grow(this.lenBits + width);
    }
    const v = (val >>> 0) & MASKS[width];
    const newHead = (this.headBit - width) & this.bitMask;
    const wi = newHead >>> 5;
    const bo = newHead & 31;
    if (bo + width <= 32) {
      const shift = 32 - bo - width;
      const clearMask = ~((MASKS[width] << shift) >>> 0);
      this.words[wi] = ((this.words[wi] & clearMask) | ((v << shift) >>> 0)) >>> 0;
    } else {
      const lo = bo + width - 32;
      const hiBits = 32 - bo;
      const w1 = (wi + 1) & this.wordMask;
      const hiMask = ~MASKS[hiBits];
      this.words[wi] = ((this.words[wi] & hiMask) | (v >>> lo)) >>> 0;
      const loShift = 32 - lo;
      const loMask = ~((MASKS[lo] << loShift) >>> 0);
      this.words[w1] = ((this.words[w1] & loMask) | ((v << loShift) >>> 0)) >>> 0;
    }
    this.headBit = newHead;
    this.lenBits += width;
  }

  /** Prepend `width` bits (0..32, MSB-first) onto the front of the buffer. */
  unshiftBits(val, width) {
    if (width <= 0) return;
    if (width <= 30) {
      this._unshiftSmall(val, width);
      return;
    }
    // Prepend low 16 bits first, then high bits in front of them
    const hiWidth = width - 16;
    this._unshiftSmall(val & 0xffff, 16);
    this._unshiftSmall((val >>> 16) >>> 0, hiWidth);
  }

  _peekSmallAt(bitOffset, width) {
    if (width <= 0) return 0;
    const pos = (this.headBit + bitOffset) & this.bitMask;
    const wi = pos >>> 5;
    const bo = pos & 31;
    if (bo + width <= 32) {
      return (this.words[wi] >>> (32 - bo - width)) & MASKS[width];
    }
    const lo = bo + width - 32;
    const hiBits = 32 - bo;
    const w1 = (wi + 1) & this.wordMask;
    return (((this.words[wi] & MASKS[hiBits]) << lo) | (this.words[w1] >>> (32 - lo))) >>> 0;
  }

  /** Non-destructively read `width` bits (0..32) starting at `bitOffset` from front. */
  peekBitsAt(bitOffset, width) {
    if (width <= 0) return 0;
    if (bitOffset < 0 || bitOffset + width > this.lenBits) {
      throw new RangeError(
        `BitDeque.peekBitsAt(${bitOffset}, ${width}) out of bounds (lenBits=${this.lenBits})`
      );
    }
    if (width <= 30) return this._peekSmallAt(bitOffset, width);
    const hiWidth = width - 16;
    const hi = this._peekSmallAt(bitOffset, hiWidth);
    const lo = this._peekSmallAt(bitOffset + hiWidth, 16);
    return (((hi << 16) >>> 0) | lo) >>> 0;
  }

  peekBits(width) {
    return this.peekBitsAt(0, width);
  }

  /** Read and discard `width` bits (0..32) from front of buffer. */
  shiftBits(width) {
    if (width <= 0) return 0;
    const val = this.peekBitsAt(0, width);
    this.headBit = (this.headBit + width) & this.bitMask;
    this.lenBits -= width;
    return val;
  }

  /** Prepend all bits of `src` in front of `this`, emptying `src`. Returns bits moved. */
  unshiftFromDeque(src) {
    const total = src.lenBits;
    if (total === 0) return 0;
    if (this.lenBits + total > this.capBits) {
      this._grow(this.lenBits + total);
    }
    // Walk backwards from end of `src` in 30-bit chunks, unshifting onto front of `this`.
    let rem = total;
    while (rem > 0) {
      const chunk = rem > 30 ? 30 : rem;
      const offset = rem - chunk;
      const bits = src._peekSmallAt(offset, chunk);
      this._unshiftSmall(bits, chunk);
      rem -= chunk;
    }
    src.headBit = 0;
    src.lenBits = 0;
    return total;
  }

  /** Append all bits of `src` to the back of `this`, emptying `src`. Returns bits moved. */
  pushFromDeque(src) {
    const total = src.lenBits;
    if (total === 0) return 0;
    if (this.lenBits + total > this.capBits) {
      this._grow(this.lenBits + total);
    }
    let moved = 0;
    while (src.lenBits > 0) {
      const chunk = src.lenBits > 30 ? 30 : src.lenBits;
      const bits = src.shiftBits(chunk);
      this._pushSmall(bits, chunk);
      moved += chunk;
    }
    return moved;
  }

  /** Steal the backing buffer of `src` in O(1) (`0` bits copied), emptying `src`. */
  adoptBufferFrom(src) {
    if (this.quota) {
      this.quota.addBufferBytes(-this.words.byteLength);
    }
    this.words = src.words;
    this.wordMask = src.wordMask;
    this.capBits = src.capBits;
    this.bitMask = src.bitMask;
    this.headBit = src.headBit;
    this.lenBits = src.lenBits;

    // Leave `src` with an empty minimal backing buffer (released cleanly on release())
    src.words = new Uint32Array(0);
    src.wordMask = 0;
    src.capBits = 0;
    src.bitMask = 0;
    src.headBit = 0;
    src.lenBits = 0;
  }

  close() {
    if (this.status === CHAN_STATUS.OPEN) {
      this.status = CHAN_STATUS.CLOSED;
      this.prod = null;
    }
  }

  fail() {
    if (this.status === CHAN_STATUS.OPEN) {
      this.status = CHAN_STATUS.FAILED;
      this.prod = null;
    }
  }

  release() {
    if (this.retired) return;
    this.retired = true;
    if (this.quota && this.words.byteLength > 0) {
      this.quota.addBufferBytes(-this.words.byteLength);
    }
    this.words = new Uint32Array(0);
    this.lenBits = 0;
    this.capBits = 0;
  }

  /** Debug helper: return unread bits as a '0'/'1' string. */
  toBitString() {
    let out = "";
    for (let i = 0; i < this.lenBits; i++) {
      out += this._peekSmallAt(i, 1) ? "1" : "0";
    }
    return out;
  }
}

/**
 * Kernel-local LIFO bit-stack (`stack s : bits`).
 *
 * Bits are stored sequentially in a growable Uint32Array; `push(word, k)` pushes
 * LSB..MSB so `pop(k)` / `peekTop(k)` reads the top `k` bits MSB-first (so
 * `push(0b10, 2); pop(2) === 0b10` and `push(0, 1); push(1, 1); pop(1) === 1`).
 */
export class BitStack {
  constructor(quota = null, initialWords = 4) {
    this.quota = quota;
    this.words = new Uint32Array(initialWords);
    this.lenBits = 0;
    if (this.quota) {
      this.quota.addBufferBytes(this.words.byteLength);
    }
  }

  get length() {
    return this.lenBits;
  }

  _ensure(neededBits) {
    if (neededBits <= (this.words.length << 5)) return;
    let newLen = this.words.length << 1;
    while ((newLen << 5) < neededBits) newLen <<= 1;
    const oldBytes = this.words.byteLength;
    const next = new Uint32Array(newLen);
    next.set(this.words);
    this.words = next;
    if (this.quota) {
      this.quota.addBufferBytes(next.byteLength - oldBytes);
    }
  }

  push(word, k) {
    if (k <= 0) return;
    this._ensure(this.lenBits + k);
    for (let i = 0; i < k; i++) {
      const bit = (word >>> i) & 1;
      const pos = this.lenBits++;
      const wi = pos >>> 5;
      const bo = pos & 31;
      if (bit) this.words[wi] = (this.words[wi] | (1 << bo)) >>> 0;
      else this.words[wi] = (this.words[wi] & ~(1 << bo)) >>> 0;
    }
  }

  peekTop(k) {
    if (k <= 0) return 0;
    if (k > this.lenBits) {
      throw new RangeError(`BitStack.peekTop(${k}) underflow (lenBits=${this.lenBits})`);
    }
    let val = 0;
    for (let i = 0; i < k; i++) {
      const pos = this.lenBits - 1 - i;
      const bit = (this.words[pos >>> 5] >>> (pos & 31)) & 1;
      val = ((val << 1) | bit) >>> 0;
    }
    return val;
  }

  pop(k) {
    const val = this.peekTop(k);
    this.lenBits -= k;
    return val;
  }

  clear() {
    this.lenBits = 0;
  }

  release() {
    if (this.quota && this.words.byteLength > 0) {
      this.quota.addBufferBytes(-this.words.byteLength);
    }
    this.words = new Uint32Array(0);
    this.lenBits = 0;
  }
}
