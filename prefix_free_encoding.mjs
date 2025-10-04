#!/usr/bin/env node

// Prefix-Free CFG Encoding for K Language Serialization
// Implements heuristics for creating unambiguous bit-string encodings

import k from './index.mjs';

class PrefixFreeEncoder {
  constructor() {
    this.codeBook = new Map();
    this.reverseCodeBook = new Map();
    this.usedCodes = new Set();
  }

  // Generate prefix-free codes using fixed-length encoding within each category
  generatePrefixFreeCodes(symbols) {
    // Group symbols by category for systematic encoding
    const categories = this.categorizeSymbols(symbols);
    
    let currentPrefix = '';
    let codeLength = 1;
    
    // Assign prefix-free codes to each category
    for (const [category, categorySymbols] of categories) {
      const codes = this.generateFixedLengthCodes(categorySymbols, currentPrefix, codeLength);
      
      // Update for next category
      currentPrefix = this.getNextPrefix(currentPrefix, categorySymbols.length);
      if (this.needsLongerCodes(categorySymbols.length, codeLength)) {
        codeLength++;
      }
      
      // Store codes
      codes.forEach((code, symbol) => {
        this.codeBook.set(symbol, code);
        this.reverseCodeBook.set(code, symbol);
        this.usedCodes.add(code);
      });
    }
    
    return this.codeBook;
  }

  // Categorize CFG symbols for systematic encoding
  categorizeSymbols(symbols) {
    const categories = new Map();
    
    // Category 1: Non-terminals (C0, C1, C2, ...)
    const nonTerminals = symbols.filter(s => s.match(/^C\d+$/));
    if (nonTerminals.length > 0) {
      categories.set('nonterminals', nonTerminals);
    }
    
    // Category 2: Structural operators (<, {, }, etc.)
    const operators = symbols.filter(s => ['<', '>', '{', '}', ',', ';'].includes(s));
    if (operators.length > 0) {
      categories.set('operators', operators);
    }
    
    // Category 3: Terminal strings ("list", "nil", etc.)
    const terminals = symbols.filter(s => s.match(/^".*"$/));
    if (terminals.length > 0) {
      categories.set('terminals', terminals);
    }
    
    // Category 4: Special symbols (_, numbers, etc.)
    const specials = symbols.filter(s => 
      !s.match(/^C\d+$/) && 
      !['<', '>', '{', '}', ',', ';'].includes(s) && 
      !s.match(/^".*"$/)
    );
    if (specials.length > 0) {
      categories.set('specials', specials);
    }
    
    return categories;
  }

  // Generate fixed-length codes for symbols in a category
  generateFixedLengthCodes(symbols, prefix, baseLength) {
    const codes = new Map();
    const bitsNeeded = Math.ceil(Math.log2(Math.max(1, symbols.length)));
    const totalLength = prefix.length + bitsNeeded;
    
    symbols.forEach((symbol, index) => {
      const suffix = index.toString(2).padStart(bitsNeeded, '0');
      const code = prefix + suffix;
      codes.set(symbol, code);
    });
    
    return codes;
  }

  // Get next available prefix for the next category
  getNextPrefix(currentPrefix, usedCount) {
    if (currentPrefix === '') {
      return '0';
    }
    
    // Find next available prefix that doesn't conflict
    let candidate = '1';
    while (this.hasConflict(candidate)) {
      candidate = this.incrementBinary(candidate);
    }
    
    return candidate;
  }

  // Check if a prefix would create conflicts with existing codes
  hasConflict(prefix) {
    for (const existingCode of this.usedCodes) {
      if (existingCode.startsWith(prefix) || prefix.startsWith(existingCode)) {
        return true;
      }
    }
    return false;
  }

  // Increment binary string
  incrementBinary(binary) {
    let carry = 1;
    let result = '';
    
    for (let i = binary.length - 1; i >= 0; i--) {
      const sum = parseInt(binary[i]) + carry;
      result = (sum % 2) + result;
      carry = Math.floor(sum / 2);
    }
    
    if (carry) {
      result = '1' + result;
    }
    
    return result;
  }

  needsLongerCodes(symbolCount, currentLength) {
    return Math.pow(2, currentLength) < symbolCount;
  }

  // Verify prefix-free property
  verifyPrefixFreeProperty() {
    const codes = Array.from(this.usedCodes);
    
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        if (codes[i].startsWith(codes[j]) || codes[j].startsWith(codes[i])) {
          return false;
        }
      }
    }
    
    return true;
  }

  // Encode a sequence of symbols
  encode(symbols) {
    return symbols.map(symbol => {
      const code = this.codeBook.get(symbol);
      if (!code) {
        throw new Error(`No encoding for symbol: ${symbol}`);
      }
      return code;
    }).join('');
  }

  // Decode a bit string back to symbols
  decode(bitString) {
    const symbols = [];
    let position = 0;
    
    while (position < bitString.length) {
      let found = false;
      
      // Try all possible code lengths
      for (let length = 1; length <= bitString.length - position; length++) {
        const candidate = bitString.substr(position, length);
        const symbol = this.reverseCodeBook.get(candidate);
        
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
  }
}

// Huffman-style prefix-free encoding for frequency-optimized codes
class HuffmanPrefixFreeEncoder {
  constructor() {
    this.frequencies = new Map();
    this.codeBook = new Map();
  }

  // Build frequency table from usage statistics
  buildFrequencyTable(symbols, frequencies) {
    symbols.forEach((symbol, index) => {
      this.frequencies.set(symbol, frequencies[index] || 1);
    });
  }

  // Generate Huffman-style codes (simplified version)
  generateHuffmanCodes() {
    // Create priority queue of symbols by frequency
    const queue = Array.from(this.frequencies.entries())
      .sort((a, b) => a[1] - b[1]);
    
    // Build Huffman tree (simplified - binary tree construction)
    const tree = this.buildHuffmanTree(queue);
    
    // Extract codes from tree
    this.extractCodes(tree, '');
    
    return this.codeBook;
  }

  buildHuffmanTree(queue) {
    while (queue.length > 1) {
      const left = queue.shift();
      const right = queue.shift();
      
      const merged = {
        symbol: null,
        frequency: left[1] + right[1],
        left: left,
        right: right
      };
      
      // Insert back in sorted order
      let inserted = false;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i][1] > merged.frequency) {
          queue.splice(i, 0, [null, merged.frequency, merged]);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        queue.push([null, merged.frequency, merged]);
      }
    }
    
    return queue[0][2];
  }

  extractCodes(node, code) {
    if (typeof node[0] === 'string') {
      // Leaf node - store code
      this.codeBook.set(node[0], code || '0'); // Handle single symbol case
      return;
    }
    
    // Internal node - recurse
    if (node.left) {
      this.extractCodes(node.left, code + '0');
    }
    if (node.right) {
      this.extractCodes(node.right, code + '1');
    }
  }
}

// CFG-specific prefix-free encoding strategies
class CFGPrefixFreeStrategy {
  constructor() {
    this.strategies = {
      'fixed-length-by-category': this.fixedLengthByCategory.bind(this),
      'huffman-frequency': this.huffmanFrequency.bind(this),
      'hierarchical-prefix': this.hierarchicalPrefix.bind(this),
      'grammar-aware': this.grammarAware.bind(this)
    };
  }

  // Strategy 1: Fixed-length codes within each symbol category
  fixedLengthByCategory(symbols, options = {}) {
    const encoder = new PrefixFreeEncoder();
    return encoder.generatePrefixFreeCodes(symbols);
  }

  // Strategy 2: Huffman codes based on symbol frequency
  huffmanFrequency(symbols, options = {}) {
    const encoder = new HuffmanPrefixFreeEncoder();
    encoder.buildFrequencyTable(symbols, options.frequencies || []);
    return encoder.generateHuffmanCodes();
  }

  // Strategy 3: Hierarchical prefixes based on grammar structure
  hierarchicalPrefix(symbols, options = {}) {
    const codes = new Map();
    
    // Assign shorter codes to more fundamental grammar elements
    const hierarchy = [
      symbols.filter(s => s.match(/^C\d+$/)),      // Non-terminals: 0xxx
      symbols.filter(s => ['<', '>', '{', '}'].includes(s)), // Structures: 10xx
      symbols.filter(s => s.match(/^".*"$/)),      // Terminals: 110x
      symbols.filter(s => !s.match(/^C\d+$/) && !['<', '>', '{', '}'].includes(s) && !s.match(/^".*"$/)) // Others: 111x
    ];
    
    let prefix = '';
    hierarchy.forEach((group, level) => {
      const levelPrefix = '0'.repeat(level) + '1';
      this.assignFixedLengthCodes(group, levelPrefix, codes);
    });
    
    return codes;
  }

  // Strategy 4: Grammar-aware encoding considering production rules
  grammarAware(symbols, options = {}) {
    const productions = options.productions || [];
    const codes = new Map();
    
    // Analyze production patterns to optimize encoding
    const rhsSymbols = this.extractRHSSymbols(productions);
    const lhsSymbols = this.extractLHSSymbols(productions);
    
    // Assign shorter codes to frequently occurring RHS symbols
    let codeLength = 1;
    rhsSymbols.forEach((symbol, index) => {
      if (Math.pow(2, codeLength) <= index) {
        codeLength++;
      }
      const code = index.toString(2).padStart(codeLength, '0');
      codes.set(symbol, code);
    });
    
    return codes;
  }

  assignFixedLengthCodes(symbols, prefix, codes) {
    if (symbols.length === 0) return;
    
    const bitsNeeded = Math.ceil(Math.log2(Math.max(1, symbols.length)));
    symbols.forEach((symbol, index) => {
      const suffix = index.toString(2).padStart(bitsNeeded, '0');
      codes.set(symbol, prefix + suffix);
    });
  }

  extractRHSSymbols(productions) {
    // Extract symbols that appear on right-hand side of productions
    const rhsSymbols = new Set();
    productions.forEach(production => {
      production.rhs.forEach(symbol => rhsSymbols.add(symbol));
    });
    return Array.from(rhsSymbols);
  }

  extractLHSSymbols(productions) {
    // Extract symbols that appear on left-hand side of productions
    return productions.map(p => p.lhs);
  }

  // Apply a specific strategy
  applyStrategy(strategyName, symbols, options = {}) {
    const strategy = this.strategies[strategyName];
    if (!strategy) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }
    return strategy(symbols, options);
  }
}

// Demo of prefix-free encoding strategies
function demonstratePrefixFreeEncoding() {
  console.log('=== Prefix-Free CFG Encoding Strategies ===\n');
  
  // Example symbols from k CFG
  const symbols = ['C0', 'C1', 'C2', 'C3', '"list"', '"nil"', '"head"', '"tail"', '"0"', '"1"', '"_"'];
  
  const strategy = new CFGPrefixFreeStrategy();
  
  console.log('Input symbols:', symbols.join(', '));
  console.log();
  
  // Test different strategies
  const strategies = ['fixed-length-by-category', 'huffman-frequency', 'hierarchical-prefix'];
  
  strategies.forEach(strategyName => {
    console.log(`--- Strategy: ${strategyName} ---`);
    
    try {
      const codes = strategy.applyStrategy(strategyName, symbols, {
        frequencies: [5, 3, 1, 4, 8, 6, 2, 2, 3, 3, 1] // Example frequencies
      });
      
      // Display encoding
      for (const [symbol, code] of codes) {
        console.log(`${symbol.padEnd(8)} -> ${code}`);
      }
      
      // Verify prefix-free property
      const encoder = new PrefixFreeEncoder();
      encoder.codeBook = codes;
      encoder.usedCodes = new Set(codes.values());
      
      const isPrefixFree = encoder.verifyPrefixFreeProperty();
      console.log(`Prefix-free property: ${isPrefixFree ? '✓' : '✗'}`);
      
      // Test encoding/decoding
      const testSymbols = ['C0', '"list"', 'C1'];
      const encoded = testSymbols.map(s => codes.get(s)).join('');
      console.log(`Test encoding [${testSymbols.join(', ')}] -> ${encoded}`);
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
    
    console.log();
  });
}

// Export for integration
export { PrefixFreeEncoder, HuffmanPrefixFreeEncoder, CFGPrefixFreeStrategy };

// Run demo if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstratePrefixFreeEncoding();
}