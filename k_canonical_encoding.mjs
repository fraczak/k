#!/usr/bin/env node

// K-Canonical Prefix-Free Encoding System
// Integrates with k's canonical form extraction for systematic bit encoding

import { spawn } from 'child_process';
import { PrefixFreeEncoder, CFGPrefixFreeStrategy } from './prefix_free_encoding.mjs';

class KCanonicalEncoder {
  constructor() {
    this.canonicalNames = new Map(); // original -> canonical mapping
    this.reverseCanonical = new Map(); // canonical -> original mapping
    this.prefixEncoder = new PrefixFreeEncoder();
    this.strategy = new CFGPrefixFreeStrategy();
  }

  // Extract canonical form using k repl
  async extractCanonicalForm(kCode, symbolName = 'bool') {
    return new Promise((resolve, reject) => {
      const repl = spawn('./repl.mjs', [], { stdio: ['pipe', 'pipe', 'pipe'] });
      
      let output = '';
      let errorOutput = '';
      
      repl.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      repl.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      repl.on('close', (code) => {
        if (code === 0) {
          resolve(this.parseCanonicalOutput(output));
        } else {
          reject(new Error(`repl failed: ${errorOutput}`));
        }
      });
      
      // Send k code and request canonical form (using proper newlines)
      const input = `${kCode}\n--C ${symbolName}\n`;
      repl.stdin.write(input);
      repl.stdin.end();
    });
  }

  // Parse canonical output to extract mappings
  parseCanonicalOutput(output) {
    const lines = output.split('\n');
    const canonicalMappings = new Map();
    const cfgInfo = {
      canonical: null,
      originalName: null,
      cfgRepresentation: null
    };
    
    for (const line of lines) {
      // Look for canonical form definitions like:
      // $ @DsAtBAP = < @KL false, @KL true >; -- $C0=<C1"false",C1"true">;$C1={};
      const match = line.match(/\$ (@\w+) = (.*?) -- (\$.*);/);
      if (match) {
        const canonicalName = match[1];
        const canonicalDef = match[2].trim();
        const cfgRepresentation = match[3];
        
        // Extract the original name from the requesting command (we know we asked for a specific symbol)
        // For now, we'll track this separately
        cfgInfo.canonical = canonicalName;
        cfgInfo.cfgRepresentation = cfgRepresentation;
        
        // Parse the CFG to extract original symbol mappings
        const cfgMappings = this.parseCFGRepresentation(cfgRepresentation);
        cfgMappings.forEach((canonical, original) => {
          canonicalMappings.set(original, canonical);
          this.reverseCanonical.set(canonical, original);
        });
      }
    }
    
    return { mappings: canonicalMappings, cfgInfo };
  }

  // Parse CFG representation to extract symbol mappings
  parseCFGRepresentation(cfgString) {
    const mappings = new Map();
    
    // Parse CFG definitions like: $C0=<C1"false",C1"true">;$C1={};
    const definitions = cfgString.split(';').filter(def => def.trim());
    
    for (const def of definitions) {
      const match = def.match(/\$(\w+)=(.*)/);
      if (match) {
        const symbol = match[1];
        const definition = match[2];
        
        // For now, map to a placeholder canonical name
        // In a real implementation, we'd need to track the correspondence
        mappings.set(symbol, `@canonical_${symbol}`);
      }
    }
    
    return mappings;
  }

  // Generate prefix-free encoding based on canonical names
  generateCanonicalEncoding(kCode, strategy = 'fixed-length-by-category') {
    return this.extractCanonicalForm(kCode).then(canonicalMappings => {
      this.canonicalNames = canonicalMappings;
      
      // Extract all symbols from the k code
      const symbols = this.extractSymbols(kCode);
      
      // Generate prefix-free codes
      const codes = this.strategy.applyStrategy(strategy, symbols);
      
      // Create canonical-aware encoding
      const canonicalCodes = new Map();
      
      for (const [symbol, code] of codes) {
        const canonical = this.canonicalNames.get(symbol) || symbol;
        canonicalCodes.set(canonical, {
          original: symbol,
          code: code,
          canonical: canonical
        });
      }
      
      return {
        codes: canonicalCodes,
        mappings: canonicalMappings,
        strategy: strategy
      };
    });
  }

  // Extract symbols from k code string
  extractSymbols(kCode) {
    const symbols = new Set();
    
    // Extract non-terminals (C0, C1, etc.)
    const nonTerminals = kCode.match(/\$?C\d+/g) || [];
    nonTerminals.forEach(nt => symbols.add(nt.replace('$', '')));
    
    // Extract quoted strings
    const strings = kCode.match(/"[^"]*"/g) || [];
    strings.forEach(str => symbols.add(str));
    
    // Extract structural symbols
    const structural = kCode.match(/[<>{}=;,]/g) || [];
    structural.forEach(sym => symbols.add(sym));
    
    // Extract underscores and other special symbols
    const specials = kCode.match(/[_]/g) || [];
    specials.forEach(sym => symbols.add(sym));
    
    return Array.from(symbols);
  }

  // Create bit-string encoding for a k code
  async createBitStringEncoding(kCode, strategy = 'fixed-length-by-category') {
    const encoding = await this.generateCanonicalEncoding(kCode, strategy);
    
    // Create encoding/decoding functions
    const encoder = {
      encode: (symbols) => {
        return symbols.map(symbol => {
          const canonical = this.canonicalNames.get(symbol) || symbol;
          const entry = encoding.codes.get(canonical);
          if (!entry) {
            throw new Error(`No encoding for symbol: ${symbol} (canonical: ${canonical})`);
          }
          return entry.code;
        }).join('');
      },
      
      decode: (bitString) => {
        // Create reverse lookup
        const reverseCodes = new Map();
        for (const [canonical, entry] of encoding.codes) {
          reverseCodes.set(entry.code, entry.original);
        }
        
        const symbols = [];
        let position = 0;
        
        while (position < bitString.length) {
          let found = false;
          
          for (let length = 1; length <= bitString.length - position; length++) {
            const candidate = bitString.substr(position, length);
            const symbol = reverseCodes.get(candidate);
            
            if (symbol) {
              symbols.push(symbol);
              position += length;
              found = true;
              break;
            }
          }
          
          if (!found) {
            throw new Error(`Cannot decode bit string at position ${position}`);
          }
        }
        
        return symbols;
      },
      
      getEncodingTable: () => encoding.codes,
      getCanonicalMappings: () => encoding.mappings
    };
    
    return encoder;
  }

  // Optimize encoding based on usage frequency analysis
  async optimizeEncoding(kCode, usageFrequencies = {}) {
    const symbols = this.extractSymbols(kCode);
    const frequencies = symbols.map(symbol => usageFrequencies[symbol] || 1);
    
    return this.generateCanonicalEncoding(kCode, 'huffman-frequency').then(encoding => {
      // Apply frequency optimization
      return this.createBitStringEncoding(kCode, 'huffman-frequency');
    });
  }
}

// Demo of k-canonical prefix-free encoding
async function demonstrateKCanonicalEncoding() {
  console.log('=== K-Canonical Prefix-Free Encoding ===\n');
  
  const kCode = '$bool = <{}true,{}false>;';
  const symbolName = 'bool';
  console.log('Input k code:', kCode);
  console.log('Requesting canonical form for:', symbolName);
  console.log();
  
  const canonicalEncoder = new KCanonicalEncoder();
  
  try {
    console.log('Extracting canonical form...');
    const result = await canonicalEncoder.extractCanonicalForm(kCode, symbolName);
    
    console.log('\nCanonical result:');
    console.log('Mappings:', result.mappings);
    console.log('CFG Info:', result.cfgInfo);
    
    if (result.mappings.size > 0) {
      console.log('\nCanonical mappings:');
      for (const [original, canonical] of result.mappings) {
        console.log(`${original} -> ${canonical}`);
      }
    }
    
    // Extract symbols for encoding
    const symbols = canonicalEncoder.extractSymbols(kCode);
    console.log('\nExtracted symbols:', symbols);
    
    // Generate prefix-free codes
    const codes = canonicalEncoder.strategy.applyStrategy('fixed-length-by-category', symbols);
    
    console.log('\nPrefix-free encoding table:');
    for (const [symbol, code] of codes) {
      console.log(`${symbol.padEnd(8)} -> ${code}`);
    }
    
    // Verify prefix-free property
    const usedCodes = Array.from(codes.values());
    const isPrefixFree = canonicalEncoder.prefixEncoder.verifyPrefixFreeProperty.call({
      usedCodes: new Set(usedCodes)
    });
    console.log(`\nPrefix-free property: ${isPrefixFree ? '✓' : '✗'}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('This requires the k repl to be available in the current directory');
  }
}

// Export for integration
export { KCanonicalEncoder };

// Run demo if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateKCanonicalEncoding();
}