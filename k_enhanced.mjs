#!/usr/bin/env node

// K Language Serialization DSL - Prototype
// Addresses BigInt limitation and provides foundation for k-based serialization DSL

import k from './index.mjs';
import fs from 'fs';
import { parse } from './valueParser.mjs';

// BigInt-capable bnat conversion functions
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

// DSL-based serialization framework
class SerializationDSL {
  constructor() {
    this.mappings = new Map();
    this.deserializers = new Map();
  }

  // Register a k-based serialization mapping
  registerMapping(name, serializeKCode, deserializeKCode) {
    this.mappings.set(name, {
      serialize: k.compile(serializeKCode),
      deserialize: k.compile(deserializeKCode)
    });
  }

  // Apply serialization using k code
  serialize(mappingName, value) {
    const mapping = this.mappings.get(mappingName);
    if (!mapping) throw new Error(`Unknown mapping: ${mappingName}`);
    
    return mapping.serialize(value);
  }

  // Apply deserialization using k code  
  deserialize(mappingName, serializedData) {
    const mapping = this.mappings.get(mappingName);
    if (!mapping) throw new Error(`Unknown mapping: ${mappingName}`);
    
    return mapping.deserialize(serializedData);
  }
}

// Enhanced serializers with BigInt support and DSL foundation
const ENHANCED_SERIALIZERS = {
  'bnat-bigint-decimal': {
    name: 'BigInt Decimal Natural',
    description: 'Unlimited precision decimal numbers: 12345678901234567890',
    parse: (str) => {
      let bigIntValue;
      try {
        bigIntValue = BigInt(str);
      } catch {
        throw new Error(`Invalid BigInt decimal: ${str}`);
      }
      
      if (bigIntValue < 0n) {
        throw new Error(`Negative numbers not supported: ${str}`);
      }
      
      const bnatJson = JSON.stringify(decimalToBnatBigInt(bigIntValue));
      const parsed = parse(bnatJson);
      return parsed.value;
    },
    stringify: (obj) => {
      try {
        const jsonObj = JSON.parse(JSON.stringify(obj));
        return bnatToDecimalBigInt(jsonObj).toString();
      } catch {
        return JSON.stringify(obj);
      }
    }
  },

  'bnat-bigint-hex': {
    name: 'BigInt Hex Natural',
    description: 'Unlimited precision hex numbers: 0x1FFFFFFFFFFFFF',
    parse: (str) => {
      if (!str.startsWith('0x') && !str.startsWith('0X')) {
        throw new Error(`Invalid hex format: ${str}`);
      }
      
      let bigIntValue;
      try {
        bigIntValue = BigInt(str);
      } catch {
        throw new Error(`Invalid BigInt hex: ${str}`);
      }
      
      if (bigIntValue < 0n) {
        throw new Error(`Negative numbers not supported: ${str}`);
      }
      
      const bnatJson = JSON.stringify(decimalToBnatBigInt(bigIntValue));
      const parsed = parse(bnatJson);
      return parsed.value;
    },
    stringify: (obj) => {
      try {
        const jsonObj = JSON.parse(JSON.stringify(obj));
        const bigIntValue = bnatToDecimalBigInt(jsonObj);
        return '0x' + bigIntValue.toString(16).toUpperCase();
      } catch {
        return JSON.stringify(obj);
      }
    }
  },

  // DSL-based serializer (prototype)
  'k-dsl': {
    name: 'K DSL Serializer',
    description: 'User-defined k-based serialization mappings',
    dsl: new SerializationDSL(),
    
    parse: (str, mappingName = 'default') => {
      // This would parse according to user-defined k mappings
      throw new Error('K DSL serialization not yet implemented');
    },
    stringify: (obj, mappingName = 'default') => {
      // This would serialize according to user-defined k mappings
      throw new Error('K DSL serialization not yet implemented');
    }
  },

  // Original JSON for compatibility
  'json': {
    name: 'JSON (Original)',
    description: 'Original k value format: {"field": value}',
    parse: (str) => {
      const parsed = parse(str);
      return parsed.value;
    },
    stringify: (obj) => {
      return JSON.stringify(obj);
    }
  }
};

// Enhanced pluggable runner with BigInt support
class EnhancedKRunner {
  constructor(options = {}) {
    this.inputSerializer = options.inputSerializer || 'json';
    this.outputSerializer = options.outputSerializer || 'json';
    this.customSerializers = options.customSerializers || {};
    this.dsl = new SerializationDSL();
  }

  getSerializer(name) {
    return this.customSerializers[name] || ENHANCED_SERIALIZERS[name];
  }

  parse(input) {
    const serializer = this.getSerializer(this.inputSerializer);
    if (!serializer) {
      throw new Error(`Unknown input serializer: ${this.inputSerializer}`);
    }
    return serializer.parse(input);
  }

  stringify(output) {
    const serializer = this.getSerializer(this.outputSerializer);
    if (!serializer) {
      throw new Error(`Unknown output serializer: ${this.outputSerializer}`);
    }
    return serializer.stringify(output);
  }

  run(program, inputString) {
    try {
      const inputValue = this.parse(inputString);
      const compiledScript = k.compile(program);
      const result = compiledScript(inputValue);
      const outputString = this.stringify(result);
      return outputString;
    } catch (error) {
      throw new Error(`Execution error: ${error.message}`);
    }
  }

  // DSL method to register k-based serialization mappings
  registerSerializationMapping(name, serializeKCode, deserializeKCode) {
    this.dsl.registerMapping(name, serializeKCode, deserializeKCode);
  }
}

// CLI interface
function printUsage() {
  console.log('K Language Enhanced Serialization with BigInt Support');
  console.log('');
  console.log('Usage:');
  console.log('  node k_enhanced.mjs [options] "k-program"');
  console.log('  echo "input" | node k_enhanced.mjs [options] "k-program"');
  console.log('');
  console.log('Options:');
  console.log('  --input-format FORMAT    Input serialization format');
  console.log('  --output-format FORMAT   Output serialization format');
  console.log('  --list-formats           List available serialization formats');
  console.log('  --help                   Show this help');
  console.log('');
  console.log('Enhanced formats with BigInt support:');
  Object.entries(ENHANCED_SERIALIZERS).forEach(([name, ser]) => {
    console.log(`  ${name.padEnd(20)} ${ser.description}`);
  });
  console.log('');
  console.log('Examples with BigInt support:');
  console.log('  echo "12345678901234567890" | node k_enhanced.mjs --input-format bnat-bigint-decimal "inc"');
  console.log('  echo "0x1FFFFFFFFFFFFF" | node k_enhanced.mjs --input-format bnat-bigint-hex --output-format bnat-bigint-decimal "inc"');
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  inputFormat: 'json',
  outputFormat: 'json',
  program: null
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--help') {
    printUsage();
    process.exit(0);
  } else if (arg === '--list-formats') {
    console.log('Available enhanced serialization formats:');
    Object.entries(ENHANCED_SERIALIZERS).forEach(([name, ser]) => {
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
  const runner = new EnhancedKRunner({
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