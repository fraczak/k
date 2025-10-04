#!/usr/bin/env node

// K Language with Pluggable Serialization System
// Replaces the fixed valueParser.mjs with user-defined serialization options

import k from './index.mjs';
import fs from 'fs';
import { parse } from './valueParser.mjs';

// Built-in serializers that replace valueParser.mjs functionality
const BUILTIN_SERIALIZERS = {
  // Original JSON-like format (compatible with current valueParser)
  'json': {
    name: 'JSON-like (default)',
    description: 'Original k value format: {"field": value}',
    parse: (str) => {
      // Use the original valueParser to get the proper Value object
      const parsed = parse(str);
      return parsed.value;
    },
    stringify: (obj) => {
      return JSON.stringify(obj);
    }
  },

  // Human-friendly formats
  'bnat-decimal': {
    name: 'Decimal Natural',
    description: 'Decimal numbers for bnat: 10, 255, 1000',
    parse: (str) => {
      const num = parseInt(str, 10);
      if (isNaN(num)) throw new Error(`Invalid decimal number: ${str}`);
      // Convert to bnat JSON structure, then parse through valueParser
      const bnatJson = JSON.stringify(decimalToBnat(num));
      const parsed = parse(bnatJson);
      return parsed.value;
    },
    stringify: (obj) => {
      // Convert Value object back to raw JSON structure first
      const jsonObj = JSON.parse(JSON.stringify(obj));
      return bnatToDecimal(jsonObj).toString();
    }
  },

  'bnat-binary': {
    name: 'Binary Natural (Binary)',
    description: 'Binary numbers for bnat: 0b1010, 0b11111111',
    parse: (str) => {
      if (!str.startsWith('0b')) throw new Error(`Invalid binary format: ${str}`);
      const num = parseInt(str.slice(2), 2);
      if (isNaN(num)) throw new Error(`Invalid binary number: ${str}`);
      const bnatJson = JSON.stringify(decimalToBnat(num));
      const parsed = parse(bnatJson);
      return parsed.value;
    },
    stringify: (obj) => {
      try {
        const jsonObj = JSON.parse(JSON.stringify(obj));
        const decimal = bnatToDecimal(jsonObj);
        return '0b' + decimal.toString(2);
      } catch {
        return JSON.stringify(obj);
      }
    }
  },

  'bnat-hex': {
    name: 'Hex Natural (Hexadecimal)',
    description: 'Hex numbers for bnat: 0xFF, 0x1A2B',
    parse: (str) => {
      if (!str.startsWith('0x') && !str.startsWith('0X')) throw new Error(`Invalid hex format: ${str}`);
      const num = parseInt(str, 16);
      if (isNaN(num)) throw new Error(`Invalid hex number: ${str}`);
      const bnatJson = JSON.stringify(decimalToBnat(num));
      const parsed = parse(bnatJson);
      return parsed.value;
    },
    stringify: (obj) => {
      try {
        const jsonObj = JSON.parse(JSON.stringify(obj));
        const decimal = bnatToDecimal(jsonObj);
        return '0x' + decimal.toString(16).toUpperCase();
      } catch {
        return JSON.stringify(obj);
      }
    }
  },

  'string': {
    name: 'String',
    description: 'Direct string values: hello, world',
    parse: (str) => {
      // For now, just return the string as-is
      // In a full implementation, this would convert to the appropriate k structure
      return str;
    },
    stringify: (obj) => {
      if (typeof obj === 'string') return obj;
      return JSON.stringify(obj);
    }
  },

  'bnat-binary': {
    name: 'Binary Natural (Binary)',
    description: 'Binary numbers for bnat: 0b1010, 0b11111111',
    parse: (str) => {
      const trimmed = str.trim();
      if (!trimmed.startsWith('0b')) throw new Error(`Invalid binary format: ${str}`);
      const num = parseInt(trimmed.slice(2), 2);
      if (isNaN(num)) throw new Error(`Invalid binary number: ${str}`);
      return decimalToBnat(num);
    },
    stringify: (obj) => {
      try {
        const decimal = bnatToDecimal(obj);
        return '0b' + decimal.toString(2);
      } catch {
        return JSON.stringify(obj);
      }
    }
  },

  'bnat-hex': {
    name: 'Binary Natural (Hexadecimal)', 
    description: 'Hex numbers for bnat: 0xFF, 0x1A2B',
    parse: (str) => {
      const trimmed = str.trim();
      if (!trimmed.startsWith('0x')) throw new Error(`Invalid hex format: ${str}`);
      const num = parseInt(trimmed.slice(2), 16);
      if (isNaN(num)) throw new Error(`Invalid hex number: ${str}`);
      return decimalToBnat(num);
    },
    stringify: (obj) => {
      try {
        const decimal = bnatToDecimal(obj);
        return '0x' + decimal.toString(16).toUpperCase();
      } catch {
        return JSON.stringify(obj);
      }
    }
  },

  'string': {
    name: 'Plain String',
    description: 'Direct string values: hello, world',
    parse: (str) => {
      return str.trim();
    },
    stringify: (obj) => {
      if (typeof obj === 'string') return obj;
      return JSON.stringify(obj);
    }
  },

  'auto': {
    name: 'Auto-detect',
    description: 'Automatically detect format based on input pattern',
    parse: (str) => {
      const trimmed = str.trim();
      
      // Try binary
      if (trimmed.match(/^0b[01]+$/)) {
        return BUILTIN_SERIALIZERS['bnat-binary'].parse(trimmed);
      }
      
      // Try hex
      if (trimmed.match(/^0x[0-9a-fA-F]+$/i)) {
        return BUILTIN_SERIALIZERS['bnat-hex'].parse(trimmed);
      }
      
      // Try decimal number
      if (trimmed.match(/^\d+$/)) {
        return BUILTIN_SERIALIZERS['bnat-decimal'].parse(trimmed);
      }
      
      // Try JSON
      try {
        return BUILTIN_SERIALIZERS['json'].parse(trimmed);
      } catch {}
      
      // Fallback to string
      return BUILTIN_SERIALIZERS['string'].parse(trimmed);
    },
    stringify: (obj) => {
      // Try bnat first
      try {
        const jsonObj = JSON.parse(JSON.stringify(obj));
        return bnatToDecimal(jsonObj).toString();
      } catch {}
      
      // Try string
      if (typeof obj === 'string') {
        return obj;
      }
      
      // Fallback to JSON
      return JSON.stringify(obj);
    }
  }
};

// Bnat conversion functions
function decimalToBnat(n) {
  if (n === 0) return {"_": {}};
  
  const binary = n.toString(2);
  let result = {"_": {}};
  
  for (let i = binary.length - 1; i >= 0; i--) {
    result = {[binary[i]]: result};
  }
  
  return result;
}

function bnatToDecimal(bnat) {
  // Handle bnat JSON objects  
  if (bnat._ !== undefined) return 0;
  
  function parseBnat(obj, acc = 0) {
    if (obj._ !== undefined) return acc;
    if (obj["0"] !== undefined) return parseBnat(obj["0"], acc * 2);
    if (obj["1"] !== undefined) return parseBnat(obj["1"], acc * 2 + 1);
    throw new Error("Invalid bnat structure");
  }
  
  return parseBnat(bnat);
}

// Pluggable K Runner
class PluggableKRunner {
  constructor(options = {}) {
    this.inputSerializer = options.inputSerializer || 'auto';
    this.outputSerializer = options.outputSerializer || 'auto';
    this.customSerializers = options.customSerializers || {};
  }

  getSerializer(name) {
    return this.customSerializers[name] || BUILTIN_SERIALIZERS[name];
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
      // Parse input using selected serializer
      const inputValue = this.parse(inputString);
      
      // Compile and run k program
      const compiledScript = k.compile(program);
      const result = compiledScript(inputValue);
      
      // Stringify output using selected serializer
      const outputString = this.stringify(result);
      
      return outputString;
    } catch (error) {
      throw new Error(`Execution error: ${error.message}`);
    }
  }
}

// Load custom serializers from file
function loadCustomSerializers(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load custom serializers from ${filepath}: ${error.message}`);
  }
}

// CLI Interface
function printUsage() {
  console.log('K Language with Pluggable Serialization');
  console.log('');
  console.log('Usage:');
  console.log('  node k_pluggable.mjs [options] "k-program"');
  console.log('  echo "input" | node k_pluggable.mjs [options] "k-program"');
  console.log('');
  console.log('Options:');
  console.log('  --input-format FORMAT    Input serialization format');
  console.log('  --output-format FORMAT   Output serialization format');
  console.log('  --serializers FILE       Load custom serializers from JSON file');
  console.log('  --list-formats           List available serialization formats');
  console.log('  --help                   Show this help');
  console.log('');
  console.log('Built-in formats:');
  Object.entries(BUILTIN_SERIALIZERS).forEach(([name, ser]) => {
    console.log(`  ${name.padEnd(15)} ${ser.description}`);
  });
  console.log('');
  console.log('Examples:');
  console.log('  echo "10" | node k_pluggable.mjs --input-format bnat-decimal "inc"');
  console.log('  echo "0b1010" | node k_pluggable.mjs --input-format bnat-binary "inc"');
  console.log('  echo "0xFF" | node k_pluggable.mjs --input-format bnat-hex --output-format bnat-binary "inc"');
}

function parseArgs(args) {
  const options = {
    inputSerializer: 'auto',
    outputSerializer: 'auto',
    customSerializers: {},
    program: null,
    help: false,
    listFormats: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--input-format':
        options.inputSerializer = args[++i];
        break;
      case '--output-format':
        options.outputSerializer = args[++i];
        break;
      case '--serializers':
        options.customSerializers = loadCustomSerializers(args[++i]);
        break;
      case '--list-formats':
        options.listFormats = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        if (!options.program) {
          options.program = arg;
        } else {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
  }

  return options;
}

// Main CLI execution
if (process.argv.length >= 3) {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      printUsage();
      process.exit(0);
    }

    if (options.listFormats) {
      console.log('Available serialization formats:');
      Object.entries(BUILTIN_SERIALIZERS).forEach(([name, ser]) => {
        console.log(`${name}: ${ser.description}`);
      });
      process.exit(0);
    }

    if (!options.program) {
      console.error('Error: No k-program specified');
      printUsage();
      process.exit(1);
    }

    const runner = new PluggableKRunner(options);

    if (!process.stdin.isTTY) {
      // Read from stdin
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
    } else {
      console.error('Error: No input provided');
      printUsage();
      process.exit(1);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
} else {
  printUsage();
}

export { PluggableKRunner, BUILTIN_SERIALIZERS, loadCustomSerializers };