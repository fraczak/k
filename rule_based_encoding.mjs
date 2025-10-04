#!/usr/bin/env node

// Rule-based Prefix-Free Encoding for K CFG Derivations
// Encodes production rules and generates bit strings from leftmost derivations

import { spawn } from 'child_process';

class CFGRuleEncoder {
  constructor() {
    this.productions = [];
    this.ruleCodes = new Map();
    this.nonTerminalRules = new Map(); // Maps non-terminal to its rules
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

  // Parse CFG string into production rules with proper k notation
  parseCFGIntoRules(cfgString) {
    // Example: $C0=<C1"list",C2"nil">;$C1={C3"head",C0"tail"};$C2={};$C3=<C3"0",C3"1",C2"_">;
    // This represents k notation rules:
    // C0 -> {C1 "list"} | {C2 "nil"}
    // C1 -> {C3 "head", C0 "tail"}
    // C2 -> {}
    // C3 -> {C3 "0"} | {C3 "1"} | {C2 "_"}
    
    const rules = [];
    const definitions = cfgString.split(';').filter(def => def.trim());
    
    for (const def of definitions) {
      const match = def.match(/\$(\w+)=(.*)/);
      if (match) {
        const lhs = match[1];
        const rhs = match[2].trim();
        
        // Parse RHS based on structure
        if (rhs === '{}') {
          // Empty production: C2 -> {}
          rules.push({ 
            lhs, 
            rhs: ['{}'], 
            ruleId: rules.length,
            kNotation: `${lhs} -> {}`
          });
        } else if (rhs.startsWith('<') && rhs.endsWith('>')) {
          // Choice: <option1,option2,...>
          const content = rhs.slice(1, -1); // Remove < >
          const options = this.parseChoiceOptions(content);
          
          options.forEach(option => {
            const kNotation = `${lhs} -> {${option.join(' ')}}`;
            rules.push({ 
              lhs, 
              rhs: ['{', ...option, '}'], 
              ruleId: rules.length,
              kNotation
            });
          });
        } else if (rhs.startsWith('{') && rhs.endsWith('}')) {
          // Single product: {elements}
          const content = rhs.slice(1, -1); // Remove { }
          if (content.trim() === '') {
            // Empty product
            rules.push({ 
              lhs, 
              rhs: ['{}'], 
              ruleId: rules.length,
              kNotation: `${lhs} -> {}`
            });
          } else {
            const elements = this.parseProductElements(content);
            const kNotation = `${lhs} -> {${elements.join(', ')}}`;
            rules.push({ 
              lhs, 
              rhs: ['{', ...elements, '}'], 
              ruleId: rules.length,
              kNotation
            });
          }
        } else {
          // Other cases - treat as single production
          const symbols = this.parseRHSSymbols(rhs);
          const kNotation = `${lhs} -> ${symbols.join(' ')}`;
          rules.push({ 
            lhs, 
            rhs: symbols, 
            ruleId: rules.length,
            kNotation
          });
        }
      }
    }
    
    return rules;
  }

  // Parse product elements like: C3"head",C0"tail"
  parseProductElements(content) {
    const elements = [];
    let current = '';
    let inQuotes = false;
    let depth = 0;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === '<' || char === '{') {
        depth++;
        current += char;
      } else if (char === '>' || char === '}') {
        depth--;
        current += char;
      } else if (char === ',' && !inQuotes && depth === 0) {
        if (current.trim()) {
          elements.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      elements.push(current.trim());
    }
    
    return elements;
  }

  // Parse choice options like: C1"list",C2"nil"
  parseChoiceOptions(content) {
    const options = [];
    let current = '';
    let inQuotes = false;
    let depth = 0;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === '<' || char === '{') {
        depth++;
        current += char;
      } else if (char === '>' || char === '}') {
        depth--;
        current += char;
      } else if (char === ',' && !inQuotes && depth === 0) {
        if (current.trim()) {
          options.push(this.parseElementsFromString(current.trim()));
        }
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      options.push(this.parseElementsFromString(current.trim()));
    }
    
    return options;
  }

  // Parse elements from a string like C3"head" or C1"list"
  parseElementsFromString(str) {
    const elements = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if (char === '"') {
        if (inQuotes) {
          current += char;
          elements.push(current);
          current = '';
          inQuotes = false;
        } else {
          if (current.trim()) {
            elements.push(current.trim());
          }
          current = char;
          inQuotes = true;
        }
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      elements.push(current.trim());
    }
    
    return elements;
  }

  // Parse RHS symbols from a string like: C1"false" or {C3"head",C0"tail"}
  parseRHSSymbols(rhsString) {
    const symbols = [];
    let current = '';
    let inQuotes = false;
    let braceDepth = 0;
    
    for (let i = 0; i < rhsString.length; i++) {
      const char = rhsString[i];
      
      if (char === '"') {
        if (inQuotes) {
          current += char;
          symbols.push(current);
          current = '';
          inQuotes = false;
        } else {
          if (current.trim()) {
            symbols.push(current.trim());
          }
          current = char;
          inQuotes = true;
        }
      } else if (char === '{' && !inQuotes) {
        if (current.trim()) {
          symbols.push(current.trim());
          current = '';
        }
        braceDepth++;
        symbols.push('{');
      } else if (char === '}' && !inQuotes) {
        if (current.trim()) {
          symbols.push(current.trim());
          current = '';
        }
        braceDepth--;
        symbols.push('}');
      } else if (char === ',' && !inQuotes && braceDepth <= 1) {
        if (current.trim()) {
          symbols.push(current.trim());
          current = '';
        }
        symbols.push(',');
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      symbols.push(current.trim());
    }
    
    return symbols;
  }

  // Generate prefix-free codes for rules grouped by non-terminal
  generateRuleCodes(rules) {
    // Group rules by LHS (non-terminal)
    const rulesByNT = new Map();
    
    rules.forEach(rule => {
      if (!rulesByNT.has(rule.lhs)) {
        rulesByNT.set(rule.lhs, []);
      }
      rulesByNT.get(rule.lhs).push(rule);
    });
    
    // Assign prefix-free codes within each non-terminal group
    const codes = new Map();
    
    for (const [nt, ntRules] of rulesByNT) {
      if (ntRules.length === 1) {
        // Single rule: can use empty code (or single bit if preferred)
        codes.set(ntRules[0].ruleId, '');
      } else {
        // Multiple rules: need prefix-free codes
        const bitsNeeded = Math.ceil(Math.log2(ntRules.length));
        ntRules.forEach((rule, index) => {
          const code = index.toString(2).padStart(bitsNeeded, '0');
          codes.set(rule.ruleId, code);
        });
      }
    }
    
    this.nonTerminalRules = rulesByNT;
    return codes;
  }

  // Perform leftmost derivation and generate bit string
  deriveWithEncoding(axiom, targetString, rules, codes) {
    // This is a simplified derivation - in practice you'd need a parser
    // For our bool example: C0 -> C1"false" -> {}"false"
    
    const derivationSteps = [];
    const bitString = [];
    
    // Find the rule that derives our target
    const applicableRules = rules.filter(rule => 
      rule.lhs === axiom && this.matchesTarget(rule.rhs, targetString)
    );
    
    if (applicableRules.length > 0) {
      const rule = applicableRules[0];
      derivationSteps.push(`${rule.lhs} -> ${rule.rhs.join('')}`);
      bitString.push(codes.get(rule.ruleId));
      
      // Continue derivation for non-terminals in RHS
      for (const symbol of rule.rhs) {
        if (this.isNonTerminal(symbol)) {
          const subRules = rules.filter(r => r.lhs === symbol);
          if (subRules.length > 0) {
            const subRule = subRules[0]; // Take first available rule
            derivationSteps.push(`${subRule.lhs} -> ${subRule.rhs.join('')}`);
            bitString.push(codes.get(subRule.ruleId));
          }
        }
      }
    }
    
    return {
      derivation: derivationSteps,
      bitString: bitString.join(''),
      steps: derivationSteps.length
    };
  }

  // Check if a rule RHS matches target pattern
  matchesTarget(rhs, target) {
    // Simplified matching - in practice this would be more sophisticated
    return rhs.some(symbol => target.includes(symbol.replace(/"/g, '')));
  }

  // Check if symbol is a non-terminal
  isNonTerminal(symbol) {
    return /^C\d+$/.test(symbol);
  }

  // Extract non-terminals from a symbol like "C3\"head\"" -> ["C3"]
  extractNonTerminalsFromSymbol(symbol) {
    if (this.isNonTerminal(symbol)) {
      return [symbol];
    }
    
    // Extract non-terminals from composite symbols like C3"head"
    const matches = symbol.match(/C\d+/g) || [];
    return matches;
  }

  // Decode bit string back to derivation and final string
  decodeBitString(bitString, rules, codes, axiom = 'C0') {
    // Create reverse mapping: code -> rule
    const codeToRule = new Map();
    for (const [ruleId, code] of codes) {
      codeToRule.set(code, rules.find(r => r.ruleId === ruleId));
    }
    
    // Create rules grouped by non-terminal for parsing
    const rulesByNT = new Map();
    rules.forEach(rule => {
      if (!rulesByNT.has(rule.lhs)) {
        rulesByNT.set(rule.lhs, []);
      }
      rulesByNT.get(rule.lhs).push(rule);
    });
    
    // Parse bit string and reconstruct derivation
    const derivation = [];
    const parseStack = [axiom]; // Start with axiom
    let bitPosition = 0;
    
    while (parseStack.length > 0) {
      const currentNT = parseStack.shift();
      
      if (!this.isNonTerminal(currentNT)) {
        continue; // Skip terminals
      }
      
      const ntRules = rulesByNT.get(currentNT) || [];
      if (ntRules.length === 0) {
        break; // No more rules to apply
      }
      
      if (ntRules.length === 1) {
        // Single rule - no bit needed (empty code)
        const rule = ntRules[0];
        derivation.push(`${rule.lhs} -> ${rule.rhs.join('')}`);
        
        // Add RHS symbols to stack (in reverse order for leftmost derivation)
        for (let i = rule.rhs.length - 1; i >= 0; i--) {
          const symbol = rule.rhs[i];
          const nonTerminals = this.extractNonTerminalsFromSymbol(symbol);
          // Add in reverse order to maintain leftmost derivation
          for (let j = nonTerminals.length - 1; j >= 0; j--) {
            parseStack.unshift(nonTerminals[j]);
          }
        }
      } else {
        // Multiple rules - need to decode bit(s)
        if (bitPosition >= bitString.length) {
          // No more bits available - this is expected for incomplete derivations
          break;
        }
        
        const maxCodeLength = Math.max(...ntRules.map(r => codes.get(r.ruleId).length));
        
        // Try different code lengths to find matching rule
        let foundRule = null;
        let codeLength = 0;
        
        for (let len = 1; len <= maxCodeLength && len <= bitString.length - bitPosition; len++) {
          const candidate = bitString.substr(bitPosition, len);
          const rule = codeToRule.get(candidate);
          
          if (rule && rule.lhs === currentNT) {
            foundRule = rule;
            codeLength = len;
            break;
          }
        }
        
        if (!foundRule) {
          // No matching rule found - stop derivation
          break;
        }
        
        derivation.push(`${foundRule.lhs} -> ${foundRule.rhs.join('')}`);
        bitPosition += codeLength;
        
        // Add RHS symbols to stack
        for (let i = foundRule.rhs.length - 1; i >= 0; i--) {
          const symbol = foundRule.rhs[i];
          const nonTerminals = this.extractNonTerminalsFromSymbol(symbol);
          // Add in reverse order to maintain leftmost derivation
          for (let j = nonTerminals.length - 1; j >= 0; j--) {
            parseStack.unshift(nonTerminals[j]);
          }
        }
      }
    }
    
    // Generate final string from derivation
    const finalString = this.generateFinalString(derivation, axiom);
    const kNotation = this.generateKNotation(derivation, axiom);
    
    return {
      derivation,
      finalString,
      kNotation,
      bitsUsed: bitPosition,
      success: bitPosition === bitString.length
    };
  }

  // Generate final string from derivation steps
  generateFinalString(derivation, axiom) {
    // Start with axiom and apply derivation steps
    let current = [axiom];
    
    for (const step of derivation) {
      const match = step.match(/(\w+) -> (.*)/);
      if (match) {
        const lhs = match[1];
        const rhsStr = match[2];
        const rhs = this.parseRHSSymbols(rhsStr);
        
        // Replace first occurrence of lhs with rhs
        const index = current.indexOf(lhs);
        if (index !== -1) {
          current.splice(index, 1, ...rhs);
        }
      }
    }
    
    // Extract meaningful symbols and build result
    const result = [];
    for (const symbol of current) {
      if (symbol.startsWith('"') && symbol.endsWith('"')) {
        // Terminal string
        result.push(symbol.slice(1, -1)); // Remove quotes
      } else if (symbol === '{}') {
        // Empty - skip
      } else if (['{', '}', ','].includes(symbol)) {
        // Structure symbols - keep for now to show structure
        result.push(symbol);
      } else if (!this.isNonTerminal(symbol)) {
        // Other terminals
        result.push(symbol);
      }
      // Skip non-terminals that weren't expanded
    }
    
    return result.join('');
  }

  // Generate k notation representation of decoded value
  generateKNotation(derivation, axiom) {
    // Start with axiom and apply derivation steps
    let current = [axiom];
    
    for (const step of derivation) {
      const match = step.match(/(\w+) -> (.*)/);
      if (match) {
        const lhs = match[1];
        const rhsStr = match[2];
        const rhs = this.parseRHSSymbols(rhsStr);
        
        // Replace first occurrence of lhs with rhs
        const index = current.indexOf(lhs);
        if (index !== -1) {
          current.splice(index, 1, ...rhs);
        }
      }
    }
    
    // Convert to proper k notation preserving full nested structure
    return this.formatFullKNotation(current);
  }

  // Format preserving full nested structure
  formatFullKNotation(symbols) {
    const result = [];
    let i = 0;
    
    while (i < symbols.length) {
      const symbol = symbols[i];
      
      if (symbol === '{') {
        // Find matching closing brace and preserve structure
        let depth = 1;
        let j = i + 1;
        const content = ['{'];
        
        while (j < symbols.length && depth > 0) {
          const current = symbols[j];
          content.push(current);
          
          if (current === '{') {
            depth++;
          } else if (current === '}') {
            depth--;
          }
          j++;
        }
        
        // Format the content with proper spacing
        const formatted = this.formatProductContent(content);
        result.push(formatted);
        i = j;
      } else if (symbol.startsWith('"') && symbol.endsWith('"')) {
        result.push(symbol);
        i++;
      } else if (!this.isNonTerminal(symbol) && symbol !== ',' && symbol !== '}') {
        result.push(symbol);
        i++;
      } else {
        // Skip non-terminals and structural symbols handled elsewhere
        i++;
      }
    }
    
    return result.join(' ');
  }

  // Format product content with proper spacing and commas
  formatProductContent(tokens) {
    if (tokens.length <= 2) {
      return '{}'; // Empty product
    }
    
    // Parse elements between opening and closing braces
    const elements = [];
    let i = 1; // Skip opening brace
    const endIndex = tokens.length - 1; // Skip closing brace
    
    while (i < endIndex) {
      let elementTokens = [];
      
      // Collect tokens for one complete element
      if (tokens[i] === '{') {
        // Balanced brace expression - collect entire nested structure
        let depth = 1;
        elementTokens.push(tokens[i]);
        i++;
        while (i < endIndex && depth > 0) {
          elementTokens.push(tokens[i]);
          if (tokens[i] === '{') depth++;
          else if (tokens[i] === '}') depth--;
          i++;
        }
        
        // Check if there's an identifier/string following this nested structure
        if (i < endIndex && !tokens[i].startsWith('C') && tokens[i] !== '{') {
          // This is a label for the nested structure
          let label = tokens[i];
          // Remove quotes from identifiers, keep quotes for actual strings
          if (label.startsWith('"') && label.endsWith('"')) {
            const content = label.slice(1, -1);
            if (['head', 'tail', 'list'].includes(content)) {
              label = content; // Remove quotes for identifiers
            }
          }
          elementTokens.push(' ' + label);
          i++;
        }
      } else if (tokens[i].startsWith('"')) {
        // String literal
        elementTokens.push(tokens[i]);
        i++;
      } else if (!tokens[i].startsWith('C')) {
        // Identifier - shouldn't happen in final token sequence but handle gracefully
        elementTokens.push(tokens[i]);
        i++;
      } else {
        // This shouldn't happen - all non-terminals should be expanded
        i++;
      }
      
      if (elementTokens.length > 0) {
        let elementStr = elementTokens.join('');
        elements.push(elementStr);
      }
    }
    
    if (elements.length === 0) {
      return '{}';
    }
    
    return '{' + elements.join(', ') + '}';
  }

  // Verify prefix-free property within each non-terminal group
  verifyPrefixFreeProperty(codes, rules) {
    const rulesByNT = new Map();
    
    // Group rules by non-terminal
    rules.forEach(rule => {
      if (!rulesByNT.has(rule.lhs)) {
        rulesByNT.set(rule.lhs, []);
      }
      rulesByNT.get(rule.lhs).push(rule);
    });
    
    // Check prefix-free property within each group
    for (const [nt, ntRules] of rulesByNT) {
      const ntCodes = ntRules.map(rule => codes.get(rule.ruleId));
      
      for (let i = 0; i < ntCodes.length; i++) {
        for (let j = i + 1; j < ntCodes.length; j++) {
          if (ntCodes[i].startsWith(ntCodes[j]) || 
              ntCodes[j].startsWith(ntCodes[i])) {
            return false;
          }
        }
      }
    }
    
    return true;
  }
}

// Demonstration
async function demonstrateRuleEncoding() {
  console.log('=== CFG Rule-Based Prefix-Free Encoding ===\n');
  
  const encoder = new CFGRuleEncoder();
  
  const kCode = '$bool = <{}true,{}false>;';
  console.log('K code:', kCode);
  
  try {
    const canonical = await encoder.getCanonicalForm(kCode, 'bool');
    console.log('\nCFG representation:', canonical.cfgRepresentation);
    
    // Parse into rules
    const rules = encoder.parseCFGIntoRules(canonical.cfgRepresentation);
    console.log('\nProduction rules:');
    rules.forEach((rule, index) => {
      console.log(`Rule ${rule.ruleId}: ${rule.lhs} -> ${rule.rhs.join('')}`);
    });
    
    // Generate codes
    const codes = encoder.generateRuleCodes(rules);
    console.log('\nRule codes:');
    rules.forEach(rule => {
      const code = codes.get(rule.ruleId);
      console.log(`Rule ${rule.ruleId}: ${rule.lhs} -> ${rule.rhs.join('')} => [${code}]`);
    });
    
    // Verify prefix-free property
    const isPrefixFree = encoder.verifyPrefixFreeProperty(codes, rules);
    console.log(`\nPrefix-free property: ${isPrefixFree ? '✓ Valid' : '✗ Invalid'}`);
    
    // Show derivation examples
    console.log('\nExample derivations:');
    const derivation1 = encoder.deriveWithEncoding('C0', 'false', rules, codes);
    console.log(`C0 -> "false": ${derivation1.derivation.join(' -> ')}`);
    console.log(`Bit string: [${derivation1.bitString}]`);
    
    const derivation2 = encoder.deriveWithEncoding('C0', 'true', rules, codes);
    console.log(`C0 -> "true": ${derivation2.derivation.join(' -> ')}`);
    console.log(`Bit string: [${derivation2.bitString}]`);
    
    // Test decoding (the reverse direction)
    console.log('\n=== Decoding (Reverse Direction) ===');
    
    // Decode bit string "0" back to derivation
    console.log('\nDecoding bit string "0":');
    const decoded1 = encoder.decodeBitString('0', rules, codes, 'C0');
    console.log(`Derivation: ${decoded1.derivation.join(' -> ')}`);
    console.log(`Final string: "${decoded1.finalString}"`);
    console.log(`Bits used: ${decoded1.bitsUsed}, Success: ${decoded1.success}`);
    
    // Decode bit string "1" back to derivation
    console.log('\nDecoding bit string "1":');
    const decoded2 = encoder.decodeBitString('1', rules, codes, 'C0');
    console.log(`Derivation: ${decoded2.derivation.join(' -> ')}`);
    console.log(`Final string: "${decoded2.finalString}"`);
    console.log(`Bits used: ${decoded2.bitsUsed}, Success: ${decoded2.success}`);
    
    // Test round-trip encoding/decoding
    console.log('\n=== Round-trip Verification ===');
    const testBits = ['0', '1'];
    testBits.forEach(bits => {
      const decoded = encoder.decodeBitString(bits, rules, codes, 'C0');
      console.log(`${bits} -> "${decoded.finalString}" -> ${decoded.success ? '✓' : '✗'}`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Export
export { CFGRuleEncoder };

// Run demo
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateRuleEncoding();
}