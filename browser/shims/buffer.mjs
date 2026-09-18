export class Buffer extends Uint8Array {
  static from(data, encoding) {
    if (typeof data === "string") {
      return new Buffer(new TextEncoder().encode(data));
    }
    if (data instanceof Uint8Array || Array.isArray(data) || data instanceof ArrayBuffer) {
      return new Buffer(data);
    }
    if (data?.buffer instanceof ArrayBuffer) {
      return new Buffer(data.buffer, data.byteOffset, data.byteLength);
    }
    return new Buffer(data || 0);
  }

  static isBuffer(val) {
    return val instanceof Uint8Array;
  }

  static alloc(size, fill = 0) {
    const buf = new Buffer(size);
    if (fill !== 0) buf.fill(fill);
    return buf;
  }

  static concat(list, totalLength) {
    const total = totalLength ?? list.reduce((acc, c) => acc + (c?.length || 0), 0);
    const result = new Buffer(total);
    let offset = 0;
    for (const chunk of list) {
      if (!chunk) continue;
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  static compare(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }

  toString(encoding = "utf8") {
    if (encoding === "hex") {
      return Array.from(this).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return new TextDecoder("utf-8").decode(this);
  }

  writeUInt32BE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, val, false);
    return offset + 4;
  }

  readUInt32BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, false);
  }

  writeUInt32LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, val, true);
    return offset + 4;
  }

  readUInt32LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, true);
  }

  subarray(start, end) {
    const sub = super.subarray(start, end);
    return new Buffer(sub.buffer, sub.byteOffset, sub.byteLength);
  }
}

if (typeof globalThis !== "undefined" && !globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

export default Buffer;
