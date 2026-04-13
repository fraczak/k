/**
 * K Binary Codec Runtime
 * 
 * Implements canonical serialization from Chapter 14:
 * - Products emit no tag bits, just children in order
 * - Unions emit ⌈log₂(n)⌉ bit tag, then child
 * - Bits packed LSB-first into bytes
 */

import crypto from 'crypto';
import { Product, Variant } from '../../Value.mjs';

const BASE56_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const BASE56_BASE = BigInt(BASE56_ALPHABET.length);

/**
 * Encode bytes as base56 string
 * @param {Buffer} bytes - 32-byte hash
 * @returns {string} Base56-encoded string
 */
function encodeBase56(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const mod = value % BASE56_BASE;
    encoded = BASE56_ALPHABET[Number(mod)] + encoded;
    value /= BASE56_BASE;
  }

  return encoded || BASE56_ALPHABET[0];
}

/**
 * Decode base56 string to bytes
 * @param {string} str - Base56 string
 * @returns {Buffer} 32-byte hash
 */
function decodeBase56(str) {
  let value = 0n;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const digit = BASE56_ALPHABET.indexOf(char);
    if (digit === -1) {
      throw new Error(`Invalid base56 character: ${char}`);
    }
    value = value * BASE56_BASE + BigInt(digit);
  }

  // Convert back to bytes (32 bytes for SHA-256)
  const bytes = [];
  let tempValue = value;
  while (tempValue > 0n) {
    bytes.unshift(Number(tempValue & 0xFFn));
    tempValue >>= 8n;
  }
  
  // Pad to 32 bytes
  while (bytes.length < 32) {
    bytes.unshift(0);
  }
  
  return Buffer.from(bytes);
}

/**
 * Convert canonical type name to 32-byte hash
 * @param {string} typeName - e.g., "@ABC123..."
 * @returns {Buffer} 32-byte hash
 */
function typeNameToHash(typeName) {
  if (!typeName.startsWith('@')) {
    throw new Error(`Type name must start with @: ${typeName}`);
  }
  // Remove @ prefix and decode base56
  return decodeBase56(typeName.slice(1));
}

/**
 * Convert 32-byte hash back to canonical type name
 * @param {Buffer} hash - 32 bytes
 * @returns {string} Canonical type name with @ prefix
 */
function hashToTypeName(hash) {
  return '@' + encodeBase56(hash);
}

/**
 * Bit writer for canonical serialization
 */
class BitWriter {
  constructor() {
    this.bits = [];
  }

  /**
   * Write n bits with value
   * @param {number} value - Integer value to write
   * @param {number} numBits - Number of bits (0 for no write)
   */
  writeBits(value, numBits) {
    if (numBits === 0) return;
    
    for (let i = 0; i < numBits; i++) {
      this.bits.push((value >> i) & 1);
    }
  }

  /**
   * Convert bit array to Buffer (LSB first, pad to byte boundary)
   */
  toBuffer() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8 && (i + j) < this.bits.length; j++) {
        byte |= (this.bits[i + j] << (7 - j));
      }
      bytes.push(byte);
    }
    return Buffer.from(bytes);
  }
}

/**
 * Bit reader for canonical deserialization
 */
class BitReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.bitPos = 0;
  }

  /**
   * Read n bits as integer
   * @param {number} numBits
   * @returns {number}
   */
  readBits(numBits) {
    if (numBits === 0) return 0;
    
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const byteIndex = Math.floor(this.bitPos / 8);
      const bitIndex = 7 - (this.bitPos % 8);
      
      if (byteIndex >= this.buffer.length) {
        throw new Error('Unexpected end of buffer');
      }
      
      const bit = (this.buffer[byteIndex] >> bitIndex) & 1;
      value |= (bit << i);
      this.bitPos++;
    }
    return value;
  }

  hasMore() {
    return this.bitPos < this.buffer.length * 8;
  }
}

/**
 * Encode a k value to binary format
 * @param {Product|Variant} value - k value
 * @param {string} typeName - Canonical type name
 * @param {Object} typeInfo - Type definition with canonical form
 * @param {Function} resolveType - (typeName) => typeInfo
 * @returns {Buffer}
 */
export function encode(value, typeName, typeInfo, resolveType) {
  const typeHash = typeNameToHash(typeName);
  const writer = new BitWriter();
  
  encodeValue(writer, value, typeInfo, resolveType);
  
  const payload = writer.toBuffer();
  return Buffer.concat([typeHash, payload]);
}

/**
 * Recursively encode a value
 * @param {BitWriter} writer
 * @param {Product|Variant} value
 * @param {Object|string} typeInfo - Type automaton state or type name
 * @param {Function} resolveType - Function to resolve type names
 */
function encodeValue(writer, value, typeInfo, resolveType) {
  // If typeInfo is a string (canonical type name), resolve it
  if (typeof typeInfo === 'string') {
    typeInfo = resolveType(typeInfo);
  }
  
  const code = typeInfo.code;
  
  switch (code) {
    case 'product': {
      // Products emit no tag, just encode children in canonical field order
      const fields = Object.keys(typeInfo.product).sort();
      
      if (!(value instanceof Product)) {
        throw new Error(`Expected Product, got ${value.constructor.name}`);
      }
      
      for (const field of fields) {
        const childValue = value.product[field];
        const childType = typeInfo.product[field];
        encodeValue(writer, childValue, childType, resolveType);
      }
      break;
    }
    
    case 'union': {
      // Unions emit tag bits
      const variants = Object.keys(typeInfo.union).sort();
      const numBits = Math.max(1, Math.ceil(Math.log2(variants.length)));
      
      if (!(value instanceof Variant)) {
        throw new Error(`Expected Variant, got ${value.constructor.name}`);
      }
      
      const tag = value.tag;
      const tagIndex = variants.indexOf(tag);
      
      if (tagIndex === -1) {
        throw new Error(`Invalid variant tag: ${tag} (expected one of ${variants.join(', ')})`);
      }
      
      writer.writeBits(tagIndex, numBits);
      
      const childValue = value.value;
      const childType = typeInfo.union[tag];
      encodeValue(writer, childValue, childType, resolveType);
      break;
    }
    
    case 'ref': {
      // Resolve reference and encode
      const resolvedType = resolveType(typeInfo.ref);
      encodeValue(writer, value, resolvedType, resolveType);
      break;
    }
    
    default:
      throw new Error(`Unknown type code: ${code}`);
  }
}

/**
 * Decode a k value from binary format
 * @param {Buffer} buffer
 * @param {Function} resolveType - (typeName) => typeInfo
 * @returns {{typeName: string, value: Product|Variant}}
 */
export function decode(buffer, resolveType) {
  if (buffer.length < 32) {
    throw new Error('Buffer too short for type hash');
  }
  
  const typeHash = buffer.slice(0, 32);
  const typeName = hashToTypeName(typeHash);
  const typeInfo = resolveType(typeName);
  
  const payload = buffer.slice(32);
  const reader = new BitReader(payload);
  
  const value = decodeValue(reader, typeInfo, resolveType);
  
  return { typeName, value };
}

/**
 * Recursively decode a value
 * @param {BitReader} reader
 * @param {Object|string} typeInfo - Type definition or type name
 * @param {Function} resolveType - Function to resolve type names
 * @returns {Product|Variant}
 */
function decodeValue(reader, typeInfo, resolveType) {
  // If typeInfo is a string (canonical type name), resolve it
  if (typeof typeInfo === 'string') {
    typeInfo = resolveType(typeInfo);
  }
  
  const code = typeInfo.code;
  
  switch (code) {
    case 'product': {
      const fields = Object.keys(typeInfo.product).sort();
      const result = {};
      
      for (const field of fields) {
        const childType = typeInfo.product[field];
        result[field] = decodeValue(reader, childType, resolveType);
      }
      
      return new Product(result);
    }
    
    case 'union': {
      const variants = Object.keys(typeInfo.union).sort();
      const numBits = Math.max(1, Math.ceil(Math.log2(variants.length)));
      
      const tagIndex = reader.readBits(numBits);
      
      if (tagIndex >= variants.length) {
        throw new Error(`Invalid tag index: ${tagIndex}`);
      }
      
      const tag = variants[tagIndex];
      const childType = typeInfo.union[tag];
      
      const childValue = decodeValue(reader, childType, resolveType);
      
      return new Variant(tag, childValue);
    }
    
    case 'ref': {
      // Resolve reference and decode
      const resolvedType = resolveType(typeInfo.ref);
      return decodeValue(reader, resolvedType, resolveType);
    }
    
    default:
      throw new Error(`Unknown type code: ${code}`);
  }
}

export default { encode, decode };
