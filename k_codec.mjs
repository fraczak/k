#!/usr/bin/env node

// K Language with Value Codec Support
// Provides human-friendly I/O while keeping k language syntax unchanged

import k from './index.mjs';
import fs from 'fs';

class BnatCodec {
  static encode(input) {
    // Convert human input to k internal bnat format
    let num;
    
    if (input.match(/^\d+$/)) {
      // Decimal: "10" 
      num = parseInt(input);
    } else if (input.match(/^0b[01]+$/)) {
      // Binary: "0b1010"
      num = parseInt(input.slice(2), 2);
    } else if (input.match(/^0x[0-9a-fA-F]+$/i)) {
      // Hex: "0xA"
      num = parseInt(input.slice(2), 16);
    } else if (input.match(/^0o[0-7]+$/)) {
      // Octal: "0o12"
      num = parseInt(input.slice(2), 8);
    } else {
      throw new Error(`Invalid bnat format: ${input}`);
    }
    
    return BnatCodec.decimalToBnatJson(num);
  }

  static decode(bnatJson) {
    // Convert k internal bnat format to human decimal
    try {
      const num = BnatCodec.bnatJsonToDecimal(bnatJson);
      return num.toString();
    } catch (error) {
      throw new Error(`Invalid bnat JSON: ${JSON.stringify(bnatJson)}`);
    }
  }

  static decimalToBnatJson(n) {
    if (n === 0) return {"_": {}};
    
    // Convert to binary string and build structure
    const binary = n.toString(2);
    let result = {"_": {}};
    
    // Build from right to left (least significant bit first)
    for (let i = binary.length - 1; i >= 0; i--) {
      const bit = binary[i];
      result = {[bit]: result};
    }
    
    return result;
  }

  static bnatJsonToDecimal(bnat) {
    // Handle zero case
    if (bnat._ !== undefined) return 0;
    
    // Parse the structure - it's encoded with most significant bit first
    function parseBnat(obj, acc = 0) {
      if (obj._ !== undefined) return acc;
      if (obj["0"] !== undefined) return parseBnat(obj["0"], acc * 2);
      if (obj["1"] !== undefined) return parseBnat(obj["1"], acc * 2 + 1);
      throw new Error("Invalid bnat structure");
    }
    
    return parseBnat(bnat);
  }

  static isBnatJson(value) {
    // Check if value looks like bnat internal format
    if (typeof value !== 'object' || value === null) return false;
    
    function checkBnatStructure(obj) {
      if (obj._ !== undefined && Object.keys(obj).length === 1) return true;
      if (obj["0"] !== undefined && Object.keys(obj).length === 1) return checkBnatStructure(obj["0"]);
      if (obj["1"] !== undefined && Object.keys(obj).length === 1) return checkBnatStructure(obj["1"]);
      return false;
    }
    
    return checkBnatStructure(value);
  }
}

class StringCodec {
  static encode(input) {
    // Convert human string input to k internal format
    if (input.match(/^".*"$/)) {
      // Quoted string: "hello"
      return input.slice(1, -1); // Remove quotes, k handles strings directly
    } else {
      // Raw string: hello
      return input;
    }
  }

  static decode(value) {
    // Convert k internal string to human format
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    return value;
  }

  static isStringValue(value) {
    return typeof value === 'string';
  }
}

class KCodecRunner {
  constructor() {
    this.codecs = [
      {
        name: 'bnat',
        patterns: [/^\d+$/, /^0b[01]+$/, /^0x[0-9a-fA-F]+$/i, /^0o[0-7]+$/],
        encode: BnatCodec.encode,
        decode: BnatCodec.decode,
        isType: BnatCodec.isBnatJson
      },
      {
        name: 'string',
        patterns: [/^".*"$/, /^[^0-9].*$/], // String if quoted or doesn't start with number
        encode: StringCodec.encode,
        decode: StringCodec.decode,
        isType: StringCodec.isStringValue
      }
    ];
  }

  encodeInput(input) {
    // Try to encode human input to k internal format
    input = input.trim();
    
    // If it's already JSON, assume it's k internal format
    try {
      const parsed = JSON.parse(input);
      return parsed;
    } catch {}

    // Try each codec
    for (const codec of this.codecs) {
      for (const pattern of codec.patterns) {
        if (pattern.test(input)) {
          try {
            return codec.encode(input);
          } catch (error) {
            console.warn(`Codec ${codec.name} failed: ${error.message}`);
          }
        }
      }
    }

    // Fallback: treat as raw string
    return input;
  }

  decodeOutput(output) {
    // Try to decode k internal format to human-readable
    if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') {
      return output.toString();
    }

    // Try each codec
    for (const codec of this.codecs) {
      if (codec.isType(output)) {
        try {
          return codec.decode(output);
        } catch (error) {
          console.warn(`Decode with ${codec.name} failed: ${error.message}`);
        }
      }
    }

    // Fallback: return as JSON
    return JSON.stringify(output);
  }

  run(program, input) {
    try {
      const encodedInput = this.encodeInput(input);
      const result = k.run(program, encodedInput);
      const decodedOutput = this.decodeOutput(result);
      return decodedOutput;
    } catch (error) {
      throw new Error(`K execution error: ${error.message}`);
    }
  }
}

// CLI interface
function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node k_codec.mjs "k_program" [input]');
    console.log('       echo "input" | node k_codec.mjs "k_program"');
    console.log('');
    console.log('Supported input formats:');
    console.log('  Numbers: 10, 0b1010, 0xA, 0o12');
    console.log('  Strings: "hello", hello');
    console.log('  JSON: {"_":{}} (k internal format)');
    process.exit(1);
  }

  const runner = new KCodecRunner();
  const program = process.argv[2];

  if (process.argv[3]) {
    // Direct input argument
    try {
      const result = runner.run(program, process.argv[3]);
      console.log(result);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    // Pipe input
    let input = '';
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    
    process.stdin.on('end', () => {
      try {
        const result = runner.run(program, input);
        console.log(result);
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
  } else {
    console.error('Error: No input provided');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default KCodecRunner;
export { BnatCodec, StringCodec };