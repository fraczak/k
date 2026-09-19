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
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, Number(val), false);
    return offset + 4;
  }

  readUInt32BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, false);
  }

  writeUInt32LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, Number(val), true);
    return offset + 4;
  }

  readUInt32LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, true);
  }

  writeInt32BE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(offset, Number(val), false);
    return offset + 4;
  }

  readInt32BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(offset, false);
  }

  writeInt32LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(offset, Number(val), true);
    return offset + 4;
  }

  readInt32LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(offset, true);
  }

  writeUInt16BE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, Number(val), false);
    return offset + 2;
  }

  readUInt16BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, false);
  }

  writeUInt16LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, Number(val), true);
    return offset + 2;
  }

  readUInt16LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, true);
  }

  writeInt16BE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(offset, Number(val), false);
    return offset + 2;
  }

  readInt16BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(offset, false);
  }

  writeInt16LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(offset, Number(val), true);
    return offset + 2;
  }

  readInt16LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(offset, true);
  }

  writeUInt8(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint8(offset, Number(val));
    return offset + 1;
  }

  readUInt8(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint8(offset);
  }

  writeInt8(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt8(offset, Number(val));
    return offset + 1;
  }

  readInt8(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt8(offset);
  }

  writeDoubleBE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, Number(val), false);
    return offset + 8;
  }

  readDoubleBE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset, false);
  }

  writeDoubleLE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, Number(val), true);
    return offset + 8;
  }

  readDoubleLE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset, true);
  }

  writeFloatBE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat32(offset, Number(val), false);
    return offset + 4;
  }

  readFloatBE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, false);
  }

  writeFloatLE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat32(offset, Number(val), true);
    return offset + 4;
  }

  readFloatLE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, true);
  }

  writeBigUInt64BE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(offset, BigInt(val), false);
    return offset + 8;
  }

  readBigUInt64BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigUint64(offset, false);
  }

  writeBigUInt64LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(offset, BigInt(val), true);
    return offset + 8;
  }

  readBigUInt64LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigUint64(offset, true);
  }

  writeBigInt64BE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setBigInt64(offset, BigInt(val), false);
    return offset + 8;
  }

  readBigInt64BE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigInt64(offset, false);
  }

  writeBigInt64LE(val, offset = 0) {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setBigInt64(offset, BigInt(val), true);
    return offset + 8;
  }

  readBigInt64LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigInt64(offset, true);
  }

  subarray(start, end) {
    const sub = super.subarray(start, end);
    return new Buffer(sub.buffer, sub.byteOffset, sub.byteLength);
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.Buffer = Buffer;
}

export default Buffer;
