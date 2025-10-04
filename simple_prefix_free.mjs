#!/usr/bin/env node

// Simple demonstration of prefix-free encoding for k canonical forms
// Based on the pattern: $ @DsAtBAP = < @KL false, @KL true >; -- $C0=<C1"false",C1"true">;$C1={};

import { spawn } from 'child_process';

class SimplePrefixFreeKEncoder {
  constructor() {
    this.symbolCodes = new Map();
  }

  // Extract canonical form from k repl
  async getCanonicalForm(kCode, symbolName) {
    return new Promise((resolve, reject) => {
      const repl = spawn('./repl.mjs', [], { stdio: ['pipe', 'pipe', 'pipe'] });
      
      let output = '';
      repl.stdout.on('data', (data) => output += data.toString());
      repl.on('close', (code) => {
        if (code === 0) {
          resolve(this.parseCanonicalOutput(output));
        } else {
          reject(new Error('repl failed'));
        }
      });
      
      const input = `${kCode}\n--C ${symbolName}\n`;
      repl.stdin.write(input);
      repl.stdin.end();
    });
  }

  // Parse the canonical output
  parseCanonicalOutput(output) {
    const lines = output.split('\n');
    for (const line of lines) {
      // Match: $ @DsAtBAP = < @KL false, @KL true >; -- $C0=<C1"false",C1"true">;$C1={};
      const match = line.match(/\$ (@\w+) = (.*?) -- (.*);/);
      if (match) {
        return {
          canonicalName: match[1],
          canonicalDefinition: match[2].trim(),
          cfgRepresentation: match[3]
        };
      }
    }
    return null;
  }

  // Generate prefix-free codes for CFG symbols
  generatePrefixFreeCodes(cfgString) {
    // Extract unique symbols from CFG representation
    const symbols = this.extractCFGSymbols(cfgString);
    
    console.log('CFG symbols found:', symbols);
    
    // Generate fixed-length codes to ensure prefix-free property
    const bitsNeeded = Math.ceil(Math.log2(Math.max(1, symbols.length)));
    const codes = new Map();
    
    symbols.forEach((symbol, index) => {
      const code = index.toString(2).padStart(bitsNeeded, '0');
      codes.set(symbol, code);
    });
    
    return codes;
  }

  // Extract symbols from CFG representation
  extractCFGSymbols(cfgString) {
    const symbols = new Set();
    
    // Extract non-terminals like C0, C1
    const nonTerminals = cfgString.match(/C\d+/g) || [];
    nonTerminals.forEach(nt => symbols.add(nt));
    
    // Extract quoted strings like "false", "true"
    const strings = cfgString.match(/"[^"]*"/g) || [];
    strings.forEach(str => symbols.add(str));
    
    // Extract structural symbols
    const structural = ['<', '>', '{', '}', ',', '=', ';'];
    cfgString.split('').forEach(char => {
      if (structural.includes(char)) {
        symbols.add(char);
      }
    });
    
    return Array.from(symbols).sort(); // Sort for deterministic ordering
  }

  // Verify prefix-free property
  verifyPrefixFree(codes) {
    const codeValues = Array.from(codes.values());
    
    for (let i = 0; i < codeValues.length; i++) {
      for (let j = i + 1; j < codeValues.length; j++) {
        if (codeValues[i].startsWith(codeValues[j]) || 
            codeValues[j].startsWith(codeValues[i])) {
          return false;
        }
      }
    }
    return true;
  }

  // Encode a sequence of CFG symbols
  encode(symbols, codes) {
    return symbols.map(symbol => {
      const code = codes.get(symbol);
      if (!code) {
        throw new Error(`No code for symbol: ${symbol}`);
      }
      return code;
    }).join('');
  }

  // Decode bit string back to symbols
  decode(bitString, codes) {
    const reverseMap = new Map();
    for (const [symbol, code] of codes) {
      reverseMap.set(code, symbol);
    }
    
    const symbols = [];
    const codeLength = codes.values().next().value.length; // All codes same length
    
    for (let i = 0; i < bitString.length; i += codeLength) {
      const code = bitString.substr(i, codeLength);
      const symbol = reverseMap.get(code);
      if (symbol) {
        symbols.push(symbol);
      } else {
        throw new Error(`Unknown code: ${code}`);
      }
    }
    
    return symbols;
  }
}

// Demonstration
async function demonstrateSimplePrefixFree() {
  console.log('=== Simple K Canonical Prefix-Free Encoding ===\n');
  
  const encoder = new SimplePrefixFreeKEncoder();
  
  // Test with bool example
  const kCode = '$bool = <{}true,{}false>;';
  console.log('K code:', kCode);
  
  try {
    const canonical = await encoder.getCanonicalForm(kCode, 'bool');
    console.log('\nCanonical form:');
    console.log('Name:', canonical.canonicalName);
    console.log('Definition:', canonical.canonicalDefinition);
    console.log('CFG:', canonical.cfgRepresentation);
    
    // Generate prefix-free encoding
    const codes = encoder.generatePrefixFreeCodes(canonical.cfgRepresentation);
    
    console.log('\nPrefix-free encoding:');
    for (const [symbol, code] of codes) {
      console.log(`${symbol.padEnd(10)} -> ${code}`);
    }
    
    // Verify prefix-free property
    const isPrefixFree = encoder.verifyPrefixFree(codes);
    console.log(`\nPrefix-free property: ${isPrefixFree ? '✓ Valid' : '✗ Invalid'}`);
    
    // Test encoding/decoding
    const testSymbols = ['C0', '"false"', '"true"'];
    const availableSymbols = testSymbols.filter(s => codes.has(s));
    
    if (availableSymbols.length > 0) {
      console.log(`\nTest encoding: [${availableSymbols.join(', ')}]`);
      const encoded = encoder.encode(availableSymbols, codes);
      console.log(`Encoded bits: ${encoded}`);
      
      const decoded = encoder.decode(encoded, codes);
      console.log(`Decoded: [${decoded.join(', ')}]`);
      console.log(`Round-trip: ${JSON.stringify(availableSymbols) === JSON.stringify(decoded) ? '✓' : '✗'}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run demo
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateSimplePrefixFree();
}

export { SimplePrefixFreeKEncoder };