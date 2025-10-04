#!/usr/bin/env node

// K-based Serialization DSL Prototype
// Demonstrates how k code can define serialization mappings

import k from './index.mjs';
import fs from 'fs';
import { parse } from './valueParser.mjs';

// BigInt bnat functions (from enhanced version)
function decimalToBnatBigInt(bigIntValue) {
  if (bigIntValue === 0n) return {"_": {}};
  
  const binary = bigIntValue.toString(2);
  let result = {"_": {}};
  
  for (let i = binary.length - 1; i >= 0; i--) {
    result = {[binary[i]]: result};
  }
  
  return result;
}

function bnatToDecimalBigInt(bnat) {
  if (bnat._ !== undefined) return 0n;
  
  function parseBnat(obj, acc = 0n) {
    if (obj._ !== undefined) return acc;
    if (obj["0"] !== undefined) return parseBnat(obj["0"], acc * 2n);
    if (obj["1"] !== undefined) return parseBnat(obj["1"], acc * 2n + 1n);
    throw new Error("Invalid bnat structure");
  }
  
  return parseBnat(bnat);
}

// K-based DSL Framework
class KSerializationDSL {
  constructor() {
    this.encoders = new Map();
    this.decoders = new Map();
    this.builtins = this.createBuiltins();
  }

  // Create builtin functions that k serialization code can use
  createBuiltins() {
    return {
      // Convert bnat to byte array
      bnat_to_bytes: (bnatValue) => {
        const bigInt = bnatToDecimalBigInt(JSON.parse(JSON.stringify(bnatValue)));
        const bytes = [];
        let remaining = bigInt;
        
        if (remaining === 0n) return [0];
        
        while (remaining > 0n) {
          bytes.unshift(Number(remaining & 0xFFn));
          remaining = remaining >> 8n;
        }
        return bytes;
      },

      // Convert byte array to bnat  
      bytes_to_bnat: (byteArray) => {
        let bigInt = 0n;
        for (const byte of byteArray) {
          bigInt = (bigInt << 8n) + BigInt(byte);
        }
        return decimalToBnatBigInt(bigInt);
      },

      // Variable-length integer encoding
      encode_varint: (value) => {
        const bigInt = bnatToDecimalBigInt(JSON.parse(JSON.stringify(value)));
        const bytes = [];
        let remaining = bigInt;
        
        while (remaining >= 128n) {
          bytes.push(Number((remaining & 0x7Fn) | 0x80n));
          remaining = remaining >> 7n;
        }
        bytes.push(Number(remaining & 0x7Fn));
        return bytes;
      },

      // Variable-length integer decoding
      decode_varint: (bytes) => {
        let result = 0n;
        let shift = 0n;
        
        for (const byte of bytes) {
          result += BigInt(byte & 0x7F) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7n;
        }
        
        return decimalToBnatBigInt(result);
      }
    };
  }

  // Register a k-based encoder
  registerEncoder(name, kCode) {
    try {
      // Create a k function that has access to builtins
      const compiledEncoder = k.compile(`
        ~
        ${this.createBuiltinDefinitions()}
        ${kCode}
        ()
      `);
      
      this.encoders.set(name, compiledEncoder);
    } catch (error) {
      throw new Error(`Failed to compile encoder '${name}': ${error.message}`);
    }
  }

  // Register a k-based decoder
  registerDecoder(name, kCode) {
    try {
      const compiledDecoder = k.compile(`
        ~
        ${this.createBuiltinDefinitions()}
        ${kCode}
        ()
      `);
      
      this.decoders.set(name, compiledDecoder);
    } catch (error) {
      throw new Error(`Failed to compile decoder '${name}': ${error.message}`);
    }
  }

  // Create k definitions for builtin functions
  createBuiltinDefinitions() {
    return `
      -- Builtin serialization functions
      bnat_to_bytes = <builtin_bnat_to_bytes>;
      bytes_to_bnat = <builtin_bytes_to_bnat>;
      encode_varint = <builtin_encode_varint>;
      decode_varint = <builtin_decode_varint>;
    `;
  }

  // Apply encoding using registered k code
  encode(encoderName, value) {
    const encoder = this.encoders.get(encoderName);
    if (!encoder) {
      throw new Error(`Unknown encoder: ${encoderName}`);
    }
    
    return encoder(value);
  }

  // Apply decoding using registered k code  
  decode(decoderName, data) {
    const decoder = this.decoders.get(decoderName);
    if (!decoder) {
      throw new Error(`Unknown decoder: ${decoderName}`);
    }
    
    return decoder(data);
  }
}

// Example usage of the k-based DSL
const dsl = new KSerializationDSL();

// Register a simple bnat-to-varint encoder in k
dsl.registerEncoder('bnat_varint', `
  -- Encode bnat as variable-length integer
  {() input, input encode_varint output} output
`);

// Register corresponding decoder
dsl.registerDecoder('varint_bnat', `
  -- Decode variable-length integer to bnat
  {() input, input decode_varint output} output
`);

// Enhanced serializer that uses k-based DSL
const DSL_SERIALIZERS = {
  'k-varint': {
    name: 'K DSL Variable Integer',
    description: 'Variable-length integer encoding defined in k',
    dsl: dsl,
    
    parse: (str) => {
      // Parse input as BigInt decimal
      const bigInt = BigInt(str);
      const bnatJson = JSON.stringify(decimalToBnatBigInt(bigInt));
      const parsed = parse(bnatJson);
      return parsed.value;
    },
    
    stringify: (obj) => {
      try {
        // Use k-based encoder to convert to varint bytes
        const bytes = dsl.encode('bnat_varint', obj);
        
        // Convert bytes back to decimal representation
        let result = 0n;
        let shift = 0n;
        for (const byte of bytes) {
          result += BigInt(byte & 0x7F) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7n;
        }
        
        return result.toString();
      } catch (error) {
        return JSON.stringify(obj);
      }
    }
  }
};

// Demo function
function demonstrateKDSL() {
  console.log('=== K-based Serialization DSL Demonstration ===\n');
  
  // Test the k-based varint encoder
  console.log('Testing k-based variable integer encoding:');
  
  const testNumbers = ['100', '12345678901234567890', '255'];
  
  testNumbers.forEach(num => {
    try {
      const serializer = DSL_SERIALIZERS['k-varint'];
      
      // Parse -> internal representation
      const internal = serializer.parse(num);
      console.log(`Input: ${num}`);
      console.log(`Internal: ${JSON.stringify(internal)}`);
      
      // Serialize -> output representation  
      const output = serializer.stringify(internal);
      console.log(`Output: ${output}`);
      console.log('---');
    } catch (error) {
      console.error(`Error with ${num}: ${error.message}`);
    }
  });
}

// Run demonstration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateKDSL();
}

export { KSerializationDSL, DSL_SERIALIZERS, decimalToBnatBigInt, bnatToDecimalBigInt };