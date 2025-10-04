#!/usr/bin/env node

// Simple Working Demo: K Language with Value Codec Support
// This demonstrates the concept without getting into complex bnat.k debugging

import k from './index.mjs';
import fs from 'fs';

class SimpleCodec {
  static encodeNumber(str) {
    // For demo: convert simple decimal numbers to a simple format
    const num = parseInt(str);
    if (isNaN(num)) throw new Error(`Not a number: ${str}`);
    return { value: num };
  }

  static decodeNumber(obj) {
    if (obj && typeof obj.value === 'number') {
      return obj.value.toString();
    }
    throw new Error('Not a simple number object');
  }

  static isNumber(str) {
    return /^\d+$/.test(str);
  }

  static isNumberObject(obj) {
    return obj && typeof obj.value === 'number';
  }
}

class SimpleKRunner {
  encodeInput(input) {
    input = input.trim();
    
    // Try to encode as number
    if (SimpleCodec.isNumber(input)) {
      return SimpleCodec.encodeNumber(input);
    }
    
    // Try to parse as JSON (k internal format)
    try {
      return JSON.parse(input);
    } catch {}
    
    // Fallback: treat as string
    return input;
  }

  decodeOutput(output) {
    // Try to decode as number
    if (SimpleCodec.isNumberObject(output)) {
      return SimpleCodec.decodeNumber(output);
    }
    
    // Try to decode as string
    if (typeof output === 'string') {
      return output;
    }
    
    // Fallback: return as JSON
    return JSON.stringify(output);
  }

  run(program, input) {
    const encodedInput = this.encodeInput(input);
    const result = k.run(program, encodedInput);
    const decodedOutput = this.decodeOutput(result);
    return decodedOutput;
  }
}

// Demo program - simple arithmetic
const demoProgram = `
  add_one = {.value inc_value value} <int value>;
  inc_value = 1 PLUS;
  add_one
`;

// CLI interface
if (process.argv.length >= 3) {
  const runner = new SimpleKRunner();
  const program = process.argv[2];

  if (process.argv[3]) {
    // Direct input
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
    console.log('Simple K Codec Demo');
    console.log('Usage: node simple_codec.mjs "k_program" [input]');
    console.log('       echo "input" | node simple_codec.mjs "k_program"');
    console.log('');
    console.log('Demo:');
    console.log('  echo "42" | node simple_codec.mjs "() inc"');
    console.log('  # Would increment 42 to 43 (if inc was defined)');
  }
}

// Export for testing
export default SimpleKRunner;