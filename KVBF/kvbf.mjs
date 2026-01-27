import { createHash } from "node:crypto";
import { Product, Variant, TypedValue } from "../TypedValue.mjs";

const DEFAULT_ID_ENCODING = "bnat";

function normalizeDefForHash(def) {
  if (def.match(/^\$C0=.*;$/)) {
    return def.slice(4, -1);
  }
  return def;
}

function sha256Bytes(input) {
  return createHash("sha256").update(input).digest();
}

function typeIdToSha256(typeId, registry) {
  const entry = registry[typeId];
  if (!entry || !entry.def) {
    throw new Error(`Unknown type id: ${typeId}`);
  }
  const normalized = normalizeDefForHash(entry.def);
  return sha256Bytes(normalized);
}

function labelKey(label) {
  return JSON.stringify(label);
}

function sortedLabels(labels) {
  return labels.slice().sort((a, b) => {
    const ka = labelKey(a);
    const kb = labelKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.bitPos = 0;
  }

  writeBit(bit) {
    const b = bit ? 1 : 0;
    this.current |= b << (7 - this.bitPos);
    this.bitPos += 1;
    if (this.bitPos === 8) {
      this.bytes.push(this.current);
      this.current = 0;
      this.bitPos = 0;
    }
  }

  writeBits(value, count) {
    for (let i = count - 1; i >= 0; i -= 1) {
      this.writeBit((value >> i) & 1);
    }
  }

  writeByte(byte) {
    if (this.bitPos === 0) {
      this.bytes.push(byte & 0xff);
      return;
    }
    for (let i = 7; i >= 0; i -= 1) {
      this.writeBit((byte >> i) & 1);
    }
  }

  toBuffer() {
    if (this.bitPos > 0) {
      this.bytes.push(this.current);
      this.current = 0;
      this.bitPos = 0;
    }
    return Buffer.from(this.bytes);
  }
}

class BitReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.byteIndex = 0;
    this.bitPos = 0;
    this.totalBits = buffer.length * 8;
    this.readBitsCount = 0;
  }

  readBit() {
    if (this.readBitsCount >= this.totalBits) {
      throw new Error("Unexpected end of bitstream");
    }
    const byte = this.buffer[this.byteIndex];
    const bit = (byte >> (7 - this.bitPos)) & 1;
    this.bitPos += 1;
    this.readBitsCount += 1;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.byteIndex += 1;
    }
    return bit;
  }

  readBits(count) {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value = (value << 1) | this.readBit();
    }
    return value;
  }

  hasRemainingBits() {
    return this.readBitsCount < this.totalBits;
  }

  remainingBitsAreZero() {
    while (this.hasRemainingBits()) {
      if (this.readBit() !== 0) return false;
    }
    return true;
  }
}

function encodeUleb128(writer, value) {
  let v = value >>> 0;
  while (true) {
    const byte = v & 0x7f;
    v >>>= 7;
    if (v === 0) {
      writer.writeByte(byte);
      break;
    }
    writer.writeByte(byte | 0x80);
  }
}

function decodeUleb128(reader) {
  let shift = 0;
  let result = 0;
  while (true) {
    const byte = reader.readBits(8);
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 35) {
      throw new Error("ULEB128 too large");
    }
  }
}

function encodeBnat(writer, value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Invalid bnat id: ${value}`);
  }
  const bits = n.toString(2);
  for (const ch of bits) {
    const tag = ch === "0" ? 0 : 1;
    writer.writeBits(tag, 2);
  }
  writer.writeBits(2, 2);
}

function decodeBnat(reader) {
  let bits = "";
  while (true) {
    const tag = reader.readBits(2);
    if (tag === 2) break;
    if (tag !== 0 && tag !== 1) {
      throw new Error(`Invalid bnat tag: ${tag}`);
    }
    bits += tag === 0 ? "0" : "1";
  }
  return bits.length === 0 ? 0 : parseInt(bits, 2);
}

function encodeBackrefId(writer, id, idEncoding) {
  if (idEncoding === "uleb128") {
    encodeUleb128(writer, id);
    return;
  }
  if (idEncoding === "bnat") {
    encodeBnat(writer, id);
    return;
  }
  throw new Error(`Unknown id encoding: ${idEncoding}`);
}

function decodeBackrefId(reader, idEncoding) {
  if (idEncoding === "uleb128") {
    return decodeUleb128(reader);
  }
  if (idEncoding === "bnat") {
    return decodeBnat(reader);
  }
  throw new Error(`Unknown id encoding: ${idEncoding}`);
}

function ensureValueMatchesType(typeId, value, registry) {
  const type = registry[typeId];
  if (!type) throw new Error(`Unknown type id: ${typeId}`);
  if (type.code === "product") {
    if (!(value instanceof Product)) {
      throw new Error(`Expected product for type ${typeId}`);
    }
  } else if (type.code === "union") {
    if (!(value instanceof Variant)) {
      throw new Error(`Expected variant for type ${typeId}`);
    }
  } else {
    throw new Error(`Unexpected type code for ${typeId}: ${type.code}`);
  }
}

function signatureFor(typeId, value, registry, cache) {
  if (cache.has(value)) return cache.get(value);
  const type = registry[typeId];
  if (!type) throw new Error(`Unknown type id: ${typeId}`);
  let sig;
  if (type.code === "product") {
    const labels = sortedLabels(Object.keys(type.product));
    const childSigs = labels.map((label) => {
      const childType = type.product[label];
      const childValue = value.product[label];
      if (childValue === undefined) {
        throw new Error(`Missing field '${label}' for type ${typeId}`);
      }
      return signatureFor(childType, childValue, registry, cache);
    });
    sig = `P(${typeId})[${childSigs.join(",")}]`;
  } else if (type.code === "union") {
    const labels = sortedLabels(Object.keys(type.union));
    const tag = value.tag;
    if (!type.union.hasOwnProperty(tag)) {
      throw new Error(`Unknown variant '${tag}' for type ${typeId}`);
    }
    const childType = type.union[tag];
    const childSig = signatureFor(childType, value.value, registry, cache);
    const idx = labels.indexOf(tag);
    sig = `U(${typeId})#${idx}(${childSig})`;
  } else {
    throw new Error(`Unexpected type code for ${typeId}: ${type.code}`);
  }
  cache.set(value, sig);
  return sig;
}

function encodeInline(writer, typeId, value, registry, sigCache, sigToId, nextIdRef, idEncoding) {
  ensureValueMatchesType(typeId, value, registry);
  const sig = signatureFor(typeId, value, registry, sigCache);
  if (sigToId.has(sig)) {
    writer.writeBit(1);
    encodeBackrefId(writer, sigToId.get(sig), idEncoding);
    return;
  }
  writer.writeBit(0);
  const id = nextIdRef.value;
  nextIdRef.value += 1;
  sigToId.set(sig, id);

  const type = registry[typeId];
  if (type.code === "product") {
    const labels = sortedLabels(Object.keys(type.product));
    const product = value.product;
    for (const label of labels) {
      if (!product.hasOwnProperty(label)) {
        throw new Error(`Missing field '${label}' for type ${typeId}`);
      }
      encodeInline(writer, type.product[label], product[label], registry, sigCache, sigToId, nextIdRef, idEncoding);
    }
    return;
  }

  if (type.code === "union") {
    const labels = sortedLabels(Object.keys(type.union));
    const tag = value.tag;
    const idx = labels.indexOf(tag);
    if (idx < 0) {
      throw new Error(`Unknown variant '${tag}' for type ${typeId}`);
    }
    const m = labels.length;
    const k = Math.ceil(Math.log2(m));
    if (k > 0) writer.writeBits(idx, k);
    encodeInline(writer, type.union[tag], value.value, registry, sigCache, sigToId, nextIdRef, idEncoding);
    return;
  }

  throw new Error(`Unexpected type code for ${typeId}: ${type.code}`);
}

function encodeValueBits(typeId, value, registry, options = {}) {
  ensureValueMatchesType(typeId, value, registry);
  const writer = new BitWriter();
  const sigCache = new WeakMap();
  const sigToId = new Map();
  const nextIdRef = { value: 0 };
  const idEncoding = options.idEncoding || DEFAULT_ID_ENCODING;
  encodeInline(writer, typeId, value, registry, sigCache, sigToId, nextIdRef, idEncoding);
  return writer.toBuffer();
}

function decodeNode(reader, typeId, registry, idMap, nextIdRef, idEncoding) {
  const marker = reader.readBit();
  if (marker === 1) {
    const id = decodeBackrefId(reader, idEncoding);
    if (!idMap.has(id)) {
      throw new Error(`Unknown back-reference id: ${id}`);
    }
    return idMap.get(id);
  }

  const id = nextIdRef.value;
  nextIdRef.value += 1;

  const type = registry[typeId];
  if (!type) throw new Error(`Unknown type id: ${typeId}`);
  let value;
  if (type.code === "product") {
    const labels = sortedLabels(Object.keys(type.product));
    const product = {};
    for (const label of labels) {
      product[label] = decodeNode(reader, type.product[label], registry, idMap, nextIdRef, idEncoding);
    }
    value = new Product(product);
  } else if (type.code === "union") {
    const labels = sortedLabels(Object.keys(type.union));
    const m = labels.length;
    const k = Math.ceil(Math.log2(m));
    const idx = k === 0 ? 0 : reader.readBits(k);
    if (idx < 0 || idx >= labels.length) {
      throw new Error(`Invalid variant index ${idx} for type ${typeId}`);
    }
    const tag = labels[idx];
    const childType = type.union[tag];
    const childValue = decodeNode(reader, childType, registry, idMap, nextIdRef, idEncoding);
    value = new Variant(tag, childValue);
  } else {
    throw new Error(`Unexpected type code for ${typeId}: ${type.code}`);
  }

  idMap.set(id, value);
  return value;
}

function decodeValueBits(buffer, typeId, registry, options = {}) {
  const reader = new BitReader(buffer);
  const idMap = new Map();
  const nextIdRef = { value: 0 };
  const idEncoding = options.idEncoding || DEFAULT_ID_ENCODING;
  const value = decodeNode(reader, typeId, registry, idMap, nextIdRef, idEncoding);
  if (!reader.remainingBitsAreZero()) {
    throw new Error("Non-zero padding bits at end of payload");
  }
  return value;
}

function encodeKVBF(typedValue, registry, options = {}) {
  const typeId = typedValue.type.startsWith("@") ? typedValue.type : `@${typedValue.type}`;
  const typeHash = typeIdToSha256(typeId, registry);
  const payload = encodeValueBits(typeId, typedValue.value, registry, options);
  const flags = 0;
  return Buffer.concat([Buffer.from([flags]), typeHash, payload]);
}

function decodeKVBF(buffer, registry, options = {}) {
  if (buffer.length < 33) {
    throw new Error("Buffer too small for KVBF envelope");
  }
  const flags = buffer.readUInt8(0);
  if (flags !== 0) {
    throw new Error(`Unsupported KVBF flags: ${flags}`);
  }
  const typeHash = buffer.subarray(1, 33);
  const payload = buffer.subarray(33);
  const typeId = findTypeIdByHash(typeHash, registry);
  if (!typeId) {
    throw new Error("Type id not found for hash in registry");
  }
  const value = decodeValueBits(payload, typeId, registry, options);
  return new TypedValue(typeId, value);
}

function findTypeIdByHash(hashBytes, registry) {
  for (const typeId of Object.keys(registry)) {
    if (!registry[typeId] || !registry[typeId].def) continue;
    const digest = typeIdToSha256(typeId, registry);
    if (digest.equals(hashBytes)) {
      return typeId;
    }
  }
  return null;
}

export {
  BitReader,
  BitWriter,
  decodeKVBF,
  decodeValueBits,
  decodeBackrefId,
  encodeKVBF,
  encodeValueBits,
  encodeBackrefId,
  findTypeIdByHash,
  sortedLabels,
  typeIdToSha256,
};
