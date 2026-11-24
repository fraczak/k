/**
 * Iteration 4: Packed Bit-Addressable O(1) Ring-Buffer Deque (`BitDeque`).
 *
 * Stores packed bits MSB-first in a power-of-2 `Uint32Array` ring buffer with
 * O(1) arbitrary-width (1..30 bit) operations at BOTH ends:
 *   - `pushBits(val, width)`    : append `width` bits at back (producer)
 *   - `unshiftBits(val, width)` : prepend `width` bits at front (O(1) `VID` / accumulator!)
 *   - `peekBits(width)`         : read `width` bits from front without consuming
 *   - `shiftBits(width)`        : read & consume `width` bits from front
 *
 * Because every operation works at arbitrary bit offsets with ZERO byte-alignment
 * restriction, prepending 1-bit or 2-bit tags never misaligns the stream and never
 * causes phase-state explosion!
 */

const MASKS = new Uint32Array(32);
for (let i = 1; i <= 30; i++) MASKS[i] = ((1 << i) - 1) >>> 0;
MASKS[31] = 0x7fffffff;

export class BitDeque {
  constructor(
    id,
    {
      name = "",
      path = "",
      plist = null,
      nodeId = 0,
      upstream = null,
      downstream = null,
      scopeId = 0,
      telemetry = null,
      initialWords = 4
    } = {}
  ) {
    this.kind = "fifo";
    this.id = id;
    this.name = name || `B${id}`;
    this.path = path;
    this.plist = plist;
    this.nodeId = nodeId;
    this.prodPlist = plist;
    this.prodNodeId = nodeId;
    this._splicedTo = null;
    this.upstream = upstream;
    this.downstream = downstream;
    this.scopeId = scopeId;
    this.telemetry = telemetry;

    this.words = new Uint32Array(initialWords);
    this.wordMask = initialWords - 1;
    this.capBits = initialWords << 5;
    this.bitMask = this.capBits - 1;
    this.headBit = 0;
    this.lenBits = 0;

    this.closed = false;
    this.failed = false;
    this.alive = true;
  }

  get length() {
    return this.lenBits;
  }

  hasBits(n = 1) {
    return this.lenBits >= n;
  }

  hasToken() {
    return this.lenBits > 0;
  }

  _grow(minNeededBits) {
    let newWordsLen = this.words.length << 1;
    while ((newWordsLen << 5) < minNeededBits) newWordsLen <<= 1;
    const oldWords = this.words;
    const oldWordMask = this.wordMask;
    const oldHead = this.headBit;
    const oldLen = this.lenBits;

    const newWords = new Uint32Array(newWordsLen);
    // Copy existing live bits cleanly into [0 .. oldLen) of newWords in 30-bit chunks
    let rem = oldLen;
    let srcPos = oldHead;
    let dstPos = 0;
    const oldBitMask = this.bitMask;
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
      // Write into newWords at dstPos (guaranteed linear, no wrap)
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

  _readAt(pos, w) {
    const wi = pos >>> 5;
    const bo = pos & 31;
    if (bo + w <= 32) {
      return (this.words[wi] >>> (32 - bo - w)) & MASKS[w];
    }
    const lo = bo + w - 32;
    const hiBits = 32 - bo;
    const w1 = (wi + 1) & this.wordMask;
    return (((this.words[wi] & MASKS[hiBits]) << lo) | (this.words[w1] >>> (32 - lo))) >>> 0;
  }

  _writeAt(pos, val, w) {
    const wi = pos >>> 5;
    const bo = pos & 31;
    const masked = (val & MASKS[w]) >>> 0;
    if (bo + w <= 32) {
      const shift = 32 - bo - w;
      const clearMask = ~((MASKS[w] << shift) >>> 0);
      this.words[wi] = ((this.words[wi] & clearMask) | ((masked << shift) >>> 0)) >>> 0;
    } else {
      const lo = bo + w - 32;
      const hiBits = 32 - bo;
      const hiMask = MASKS[hiBits];
      this.words[wi] = ((this.words[wi] & ~hiMask) | (masked >>> lo)) >>> 0;
      const w1 = (wi + 1) & this.wordMask;
      const loShift = 32 - lo;
      const loClear = ~((MASKS[lo] << loShift) >>> 0);
      this.words[w1] = ((this.words[w1] & loClear) | ((masked << loShift) >>> 0)) >>> 0;
    }
  }

  peekBits(w) {
    if (w === 0) return 0;
    if (this.lenBits < w) {
      throw new Error(`BitDeque ${this.name}: peekBits(${w}) underflow (have ${this.lenBits})`);
    }
    return this._readAt(this.headBit, w);
  }

  /**
   * Peek up to `w` bits, right-padded with zeros if `lenBits < w`.
   */
  peekBitsPadded(w) {
    if (w === 0 || this.lenBits === 0) return 0;
    if (this.lenBits >= w) return this._readAt(this.headBit, w);
    const avail = this.lenBits;
    return (this._readAt(this.headBit, avail) << (w - avail)) >>> 0;
  }

  /**
   * Peek up to `w` bits, right-padded with `1`s if `lenBits < w` (used on closed
   * tails of `k-wire` unions whose all-ones codepoint is invalid — e.g. `11` on
   * `bits[]` — so a stride table safely retires all remaining tokens and stops
   * right before the padded sentinel!).
   */
  peekBitsPaddedOnes(w) {
    if (w === 0) return 0;
    if (this.lenBits >= w) return this._readAt(this.headBit, w);
    const avail = this.lenBits;
    const pad = w - avail;
    const hi = avail > 0 ? this._readAt(this.headBit, avail) : 0;
    return (((hi << pad) >>> 0) | MASKS[pad]) >>> 0;
  }

  shiftBits(w) {
    if (w === 0) return 0;
    const v = this.peekBits(w);
    this.headBit = (this.headBit + w) & this.bitMask;
    this.lenBits -= w;
    if (this.telemetry) {
      this.telemetry.liveFifoBits -= w;
    }
    return v;
  }

  pushBits(val, w, countTransfer = true) {
    if (w === 0) return;
    if (this.lenBits + w > this.capBits) {
      this._grow(this.lenBits + w);
    }
    const tailPos = (this.headBit + this.lenBits) & this.bitMask;
    this._writeAt(tailPos, val, w);
    this.lenBits += w;
    if (this.telemetry) {
      if (countTransfer) this.telemetry.totalBitsTransferred += w;
      this.telemetry.liveFifoBits += w;
      if (this.telemetry.liveFifoBits > this.telemetry.peakFifoBits) {
        this.telemetry.peakFifoBits = this.telemetry.liveFifoBits;
      }
    }
  }

  unshiftBits(val, w, countTransfer = true) {
    if (w === 0) return;
    if (this.lenBits + w > this.capBits) {
      this._grow(this.lenBits + w);
    }
    this.headBit = (this.headBit - w) & this.bitMask;
    this._writeAt(this.headBit, val, w);
    this.lenBits += w;
    if (this.telemetry) {
      if (countTransfer) this.telemetry.totalBitsTransferred += w;
      this.telemetry.liveFifoBits += w;
      if (this.telemetry.liveFifoBits > this.telemetry.peakFifoBits) {
        this.telemetry.peakFifoBits = this.telemetry.liveFifoBits;
      }
    }
  }

  /**
   * Drain all bits from `prefixDq` and prepend them (in exact order!) onto the
   * front of `this` without double-counting `totalBitsTransferred`.
   */
  unshiftFromDeque(prefixDq) {
    const n = prefixDq.lenBits;
    if (n === 0) return;
    if (this.lenBits + n > this.capBits) {
      this._grow(this.lenBits + n);
    }
    // Copy from back of prefixDq to front (or into temp chunks then unshift in reverse)
    const chunks = [];
    while (prefixDq.lenBits > 0) {
      const w = prefixDq.lenBits > 30 ? 30 : prefixDq.lenBits;
      chunks.push([prefixDq.shiftBits(w), w]);
    }
    for (let i = chunks.length - 1; i >= 0; i--) {
      this.unshiftBits(chunks[i][0], chunks[i][1], false);
    }
  }

  /**
   * Export entire bitstream as `{ bytes: Uint8Array, bitLength: number }` (MSB-first,
   * zero-padded final byte — matching `codecs/WIRE_FORMAT.md`!).
   */
  toBytes() {
    const bitLength = this.lenBits;
    const byteLen = (bitLength + 7) >>> 3;
    const bytes = new Uint8Array(byteLen);
    let pos = this.headBit;
    let rem = bitLength;
    let bi = 0;
    while (rem > 0) {
      const w = rem >= 8 ? 8 : rem;
      const v = this._readAt(pos, w);
      bytes[bi++] = w === 8 ? v : (v << (8 - w)) & 0xff;
      pos = (pos + w) & this.bitMask;
      rem -= w;
    }
    return { bytes, bitLength };
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
    if (this.telemetry && this.lenBits > 0) {
      this.telemetry.liveFifoBits -= this.lenBits;
    }
    this.lenBits = 0;
    this.headBit = 0;
  }
}

export class BitWireBundle {
  constructor(fields, plist, nodeId = 0) {
    this.kind = "bundle";
    this.fields = fields;
    this.plist = plist;
    this.nodeId = nodeId;
  }
}

export function bitWireLeaves(wire, prefix = [], out = []) {
  if (wire.kind === "fifo") {
    out.push({ pathKey: prefix.join("."), path: prefix, fifo: wire });
    return out;
  }
  for (const [label, child] of wire.fields.entries()) {
    bitWireLeaves(child, [...prefix, label], out);
  }
  return out;
}

export function bitWireAtPath(wire, pathKey) {
  if (!pathKey) return wire;
  let cur = wire;
  for (const seg of pathKey.split(".")) {
    if (cur.kind !== "bundle" || !cur.fields.has(seg)) {
      throw new Error(`bitWireAtPath: missing segment '${seg}' in '${pathKey}'`);
    }
    cur = cur.fields.get(seg);
  }
  return cur;
}
