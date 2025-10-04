#!/usr/bin/env node

// Practical K Serialization DSL - Working Prototype
// Demonstrates BigInt support and the foundation for k-based serialization

import k from './index.mjs';
import fs from 'fs';
import { parse } from './valueParser.mjs';

// Enhanced BigInt bnat functions
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

// Advanced serialization formats with BigInt and specialized encodings
const ADVANCED_SERIALIZERS = {
  'bnat-bigint-decimal': {
    name: 'BigInt Decimal',
    description: 'Unlimited precision decimal: 12345678901234567890',
    parse: (str) => {
      const bigInt = BigInt(str);
      if (bigInt < 0n) throw new Error('Negative numbers not supported');
      const bnatJson = JSON.stringify(decimalToBnatBigInt(bigInt));
      return parse(bnatJson).value;
    },
    stringify: (obj) => {
      const jsonObj = JSON.parse(JSON.stringify(obj));
      return bnatToDecimalBigInt(jsonObj).toString();
    }
  },

  'bnat-bigint-hex': {
    name: 'BigInt Hexadecimal',
    description: 'Unlimited precision hex: 0x1FFFFFFFFFFFFFFFFFFFFF',
    parse: (str) => {
      if (!str.startsWith('0x') && !str.startsWith('0X')) {
        throw new Error(`Invalid hex format: ${str}`);
      }
      const bigInt = BigInt(str);
      if (bigInt < 0n) throw new Error('Negative numbers not supported');
      const bnatJson = JSON.stringify(decimalToBnatBigInt(bigInt));
      return parse(bnatJson).value;
    },
    stringify: (obj) => {
      const jsonObj = JSON.parse(JSON.stringify(obj));
      return '0x' + bnatToDecimalBigInt(jsonObj).toString(16).toUpperCase();
    }
  },

  'bnat-bigint-binary': {
    name: 'BigInt Binary',
    description: 'Unlimited precision binary: 0b1010101...',
    parse: (str) => {
      if (!str.startsWith('0b')) throw new Error(`Invalid binary format: ${str}`);
      const bigInt = BigInt(str);
      if (bigInt < 0n) throw new Error('Negative numbers not supported');
      const bnatJson = JSON.stringify(decimalToBnatBigInt(bigInt));
      return parse(bnatJson).value;
    },
    stringify: (obj) => {
      const jsonObj = JSON.parse(JSON.stringify(obj));
      return '0b' + bnatToDecimalBigInt(jsonObj).toString(2);
    }
  },

  'bnat-varint': {
    name: 'Variable Integer Encoding',
    description: 'Compact variable-length integer encoding',
    parse: (str) => {
      // Parse as base64-encoded varint bytes
      const bytes = Buffer.from(str, 'base64');
      let result = 0n;
      let shift = 0n;
      
      for (const byte of bytes) {
        result += BigInt(byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7n;
      }
      
      const bnatJson = JSON.stringify(decimalToBnatBigInt(result));
      return parse(bnatJson).value;
    },
    stringify: (obj) => {
      const jsonObj = JSON.parse(JSON.stringify(obj));
      const bigInt = bnatToDecimalBigInt(jsonObj);
      
      // Encode as varint
      const bytes = [];
      let remaining = bigInt;
      
      while (remaining >= 128n) {
        bytes.push(Number((remaining & 0x7Fn) | 0x80n));
        remaining = remaining >> 7n;
      }
      bytes.push(Number(remaining & 0x7Fn));
      
      // Return as base64
      return Buffer.from(bytes).toString('base64');
    }
  },

  'json': {
    name: 'JSON (Original)',
    description: 'Original k value format',
    parse: (str) => parse(str).value,
    stringify: (obj) => JSON.stringify(obj)
  }
};

// Main runner class
class AdvancedKRunner {
  constructor(options = {}) {
    this.inputSerializer = options.inputSerializer || 'json';
    this.outputSerializer = options.outputSerializer || 'json';
  }

  getSerializer(name) {
    return ADVANCED_SERIALIZERS[name];
  }

  parse(input) {
    const serializer = this.getSerializer(this.inputSerializer);
    if (!serializer) throw new Error(`Unknown input serializer: ${this.inputSerializer}`);
    return serializer.parse(input);
  }

  stringify(output) {
    const serializer = this.getSerializer(this.outputSerializer);
    if (!serializer) throw new Error(`Unknown output serializer: ${this.outputSerializer}`);
    return serializer.stringify(output);
  }

  run(program, inputString) {
    try {
      const inputValue = this.parse(inputString);
      const compiledScript = k.compile(program);
      const result = compiledScript(inputValue);
      return this.stringify(result);
    } catch (error) {
      throw new Error(`Execution error: ${error.message}`);
    }
  }
}

// CLI interface
function printUsage() {
  console.log('Advanced K Language Serialization with BigInt Support');
  console.log('');
  console.log('Usage:');
  console.log('  node k_advanced.mjs [options] "k-program"');
  console.log('  echo "input" | node k_advanced.mjs [options] "k-program"');
  console.log('');
  console.log('Options:');
  console.log('  --input-format FORMAT    Input serialization format');
  console.log('  --output-format FORMAT   Output serialization format');
  console.log('  --list-formats           List available formats');
  console.log('  --help                   Show this help');
  console.log('');
  console.log('Advanced serialization formats:');
  Object.entries(ADVANCED_SERIALIZERS).forEach(([name, ser]) => {
    console.log(`  ${name.padEnd(25)} ${ser.description}`);
  });
  console.log('');
  console.log('BigInt Examples:');
  console.log('  echo "999999999999999999999999999" | node k_advanced.mjs --input-format bnat-bigint-decimal "inc"');
  console.log('  echo "0xFFFFFFFFFFFFFFFFFFFFFFFF" | node k_advanced.mjs --input-format bnat-bigint-hex --output-format bnat-bigint-binary "inc"');
  console.log('  echo "10" | node k_advanced.mjs --input-format bnat-bigint-decimal --output-format bnat-varint "."');
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options = { inputFormat: 'json', outputFormat: 'json', program: null };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--help') {
    printUsage();
    process.exit(0);
  } else if (arg === '--list-formats') {
    console.log('Available serialization formats:');
    Object.entries(ADVANCED_SERIALIZERS).forEach(([name, ser]) => {
      console.log(`${name}: ${ser.description}`);
    });
    process.exit(0);
  } else if (arg === '--input-format' && i + 1 < args.length) {
    options.inputFormat = args[++i];
  } else if (arg === '--output-format' && i + 1 < args.length) {
    options.outputFormat = args[++i];
  } else if (!options.program) {
    options.program = arg;
  }
}

if (!options.program) {
  console.error('Error: No k-program specified');
  printUsage();
  process.exit(1);
}

// Main execution
try {
  const runner = new AdvancedKRunner({
    inputSerializer: options.inputFormat,
    outputSerializer: options.outputFormat
  });

  if (process.stdin.isTTY) {
    console.error('Error: No input provided');
    printUsage();
    process.exit(1);
  } else {
    let input = '';
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    
    process.stdin.on('end', () => {
      try {
        const result = runner.run(options.program, input.trim());
        console.log(result);
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

export { AdvancedKRunner, ADVANCED_SERIALIZERS, decimalToBnatBigInt, bnatToDecimalBigInt };