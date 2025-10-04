import { Value, Vector, Product } from './Value.mjs';

class ValueBasedEncoder {
  constructor(cfg) {
    this.cfg = cfg;
    this.rules = this.parseCFG(cfg);
    this.codes = this.generatePrefixFreeCodes();
  }

  parseCFG(cfg) {
    const rules = [];
    
    cfg.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      
      // Parse rule: $C0=<C1"list",C2"nil">;
      const match = trimmed.match(/\$([^=]+)=(.+);/);
      if (!match) return;
      
      const lhs = match[1];
      const rhsStr = match[2];
      
      // Parse RHS alternatives
      if (rhsStr.startsWith('<') && rhsStr.endsWith('>')) {
        // Union: <alt1,alt2,alt3>
        const content = rhsStr.slice(1, -1);
        const alternatives = this.parseAlternatives(content);
        
        alternatives.forEach(alt => {
          rules.push({
            lhs,
            rhs: alt,
            type: 'union'
          });
        });
      } else if (rhsStr.startsWith('{') && rhsStr.endsWith('}')) {
        // Product: {elem1,elem2}
        const content = rhsStr.slice(1, -1);
        const elements = content ? this.parseProductElements(content) : [];
        
        rules.push({
          lhs,
          rhs: elements,
          type: 'product'
        });
      } else if (rhsStr.startsWith('[') && rhsStr.endsWith(']')) {
        // Vector: [elem1,elem2]
        const content = rhsStr.slice(1, -1);
        const elements = content ? this.parseVectorElements(content) : [];
        
        rules.push({
          lhs,
          rhs: elements,
          type: 'vector'
        });
      }
    });
    
    return rules;
  }

  parseAlternatives(str) {
    // Split by commas, but respect nested structures
    const alternatives = [];
    let current = '';
    let depth = 0;
    let inQuotes = false;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if (char === '"' && (i === 0 || str[i-1] !== '\\')) {
        inQuotes = !inQuotes;
      }
      
      if (!inQuotes) {
        if (char === '<' || char === '{' || char === '[') depth++;
        else if (char === '>' || char === '}' || char === ']') depth--;
      }
      
      if (char === ',' && depth === 0 && !inQuotes) {
        alternatives.push(this.parseElement(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      alternatives.push(this.parseElement(current.trim()));
    }
    
    return alternatives;
  }

  parseElement(str) {
    // Parse element: can be C1"list", just C1, just "string", or {}/[]/inline structure
    const match = str.match(/^([^"]+)"(.+)"$/);
    if (match) {
      return { identifier: match[1], label: match[2] };
    } else if (str.startsWith('"') && str.endsWith('"')) {
      return { label: str.slice(1, -1) };
    } else if (str.startsWith('{') || str.startsWith('[')) {
      return { inline: str };
    } else {
      return { identifier: str };
    }
  }

  parseProductElements(str) {
    // Parse product elements: C3"head",C0"tail"
    const elements = [];
    const parts = this.parseAlternatives(str); // Reuse the comma-splitting logic
    
    return parts; // Now parseAlternatives returns properly parsed elements
  }

  parseVectorElements(str) {
    // Similar to product elements but for vectors
    return this.parseAlternatives(str);
  }

  generatePrefixFreeCodes() {
    // Group rules by LHS
    const rulesByLHS = new Map();
    this.rules.forEach((rule, index) => {
      if (!rulesByLHS.has(rule.lhs)) {
        rulesByLHS.set(rule.lhs, []);
      }
      rulesByLHS.get(rule.lhs).push({ ...rule, index });
    });

    const codes = new Map();
    
    // Generate prefix-free codes for each non-terminal
    rulesByLHS.forEach((rules, lhs) => {
      if (rules.length === 1) {
        // Single rule - no bits needed
        codes.set(rules[0].index, []);
      } else {
        // Multiple rules - generate prefix-free codes
        const numBits = Math.ceil(Math.log2(rules.length));
        rules.forEach((rule, i) => {
          const code = [];
          for (let bit = numBits - 1; bit >= 0; bit--) {
            code.push((i >> bit) & 1);
          }
          codes.set(rule.index, code);
        });
      }
    });

    return codes;
  }

  decodeBitString(bitString) {
    const bits = bitString.split('').map(b => parseInt(b));
    let position = 0;
    
    const decode = (symbol) => {
      // Find rules for this symbol
      const applicableRules = this.rules.filter(rule => rule.lhs === symbol);
      
      if (applicableRules.length === 0) {
        throw new Error(`No rules found for symbol ${symbol}`);
      }
      
      if (applicableRules.length === 1) {
        // Single rule - no bits needed
        const rule = applicableRules[0];
        return this.applyRule(rule, decode);
      }
      
      // Multiple rules - need to read bits to determine which one
      const numBits = Math.ceil(Math.log2(applicableRules.length));
      
      if (position + numBits > bits.length) {
        throw new Error(`Not enough bits to decode ${symbol}`);
      }
      
      let ruleIndex = 0;
      for (let i = 0; i < numBits; i++) {
        ruleIndex = (ruleIndex << 1) | bits[position + i];
      }
      position += numBits;
      
      if (ruleIndex >= applicableRules.length) {
        throw new Error(`Invalid rule index ${ruleIndex} for ${symbol}`);
      }
      
      const rule = applicableRules[ruleIndex];
      return this.applyRule(rule, decode);
    };

    try {
      const result = decode('C0'); // Start with root symbol
      return {
        success: true,
        value: result,
        bitsUsed: position,
        kNotation: result.toString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        bitsUsed: position
      };
    }
  }

  applyRule(rule, decode) {
    switch (rule.type) {
      case 'product':
        const productData = {};
        rule.rhs.forEach(element => {
          let value;
          if (element.identifier && element.identifier.startsWith('C')) {
            // Recursive non-terminal
            value = decode(element.identifier);
          } else if (element.identifier) {
            // Terminal identifier
            value = element.identifier;
          } else {
            // Should not happen in well-formed grammar
            value = null;
          }
          
          const key = element.label || element.identifier || 'value';
          productData[key] = value;
        });
        return new Product(productData);
        
      case 'vector':
        const vectorData = [];
        rule.rhs.forEach(element => {
          if (typeof element === 'string' && element.startsWith('C')) {
            vectorData.push(decode(element));
          } else {
            vectorData.push(element);
          }
        });
        return new Vector(vectorData);
        
      case 'union':
        // For union alternatives, the RHS is a parsed element  
        if (rule.rhs.identifier && rule.rhs.identifier.startsWith('C')) {
          // Non-terminal with optional label
          const value = decode(rule.rhs.identifier);
          if (rule.rhs.label) {
            // For union rules with labels, the label typically represents the final terminal value
            // But if the decoded value is an empty Product, then the label is the actual value
            if (value instanceof Product && Object.keys(value.product).length === 0) {
              return rule.rhs.label;
            } else {
              // Wrap in a Product with the label as key
              return new Product({ [rule.rhs.label]: value });
            }
          } else {
            return value;
          }
        } else if (rule.rhs.inline) {
          // Inline structure like {C1,C2}
          if (rule.rhs.inline.startsWith('{')) {
            const content = rule.rhs.inline.slice(1, -1);
            const elements = content ? this.parseProductElements(content) : [];
            const tempRule = { type: 'product', rhs: elements };
            return this.applyRule(tempRule, decode);
          } else if (rule.rhs.inline.startsWith('[')) {
            const content = rule.rhs.inline.slice(1, -1);
            const elements = content ? this.parseVectorElements(content) : [];
            const tempRule = { type: 'vector', rhs: elements };
            return this.applyRule(tempRule, decode);
          }
        } else if (rule.rhs.label) {
          // Just a terminal string
          return rule.rhs.label;
        } else {
          // Terminal identifier
          return rule.rhs.identifier || rule.rhs;
        }
        
      default:
        throw new Error(`Unknown rule type: ${rule.type}`);
    }
  }

  printRules() {
    console.log('Production rules:');
    this.rules.forEach((rule, index) => {
      const code = this.codes.get(index) || [];
      const codeStr = code.length > 0 ? `[${code.join('')}]` : '[]';
      console.log(`Rule ${index}: ${rule.lhs} -> ${this.formatRHS(rule)} => ${codeStr}`);
    });
  }

  formatRHS(rule) {
    switch (rule.type) {
      case 'product':
        const elements = rule.rhs.map(elem => {
          if (elem.identifier && elem.label) {
            return `${elem.identifier}"${elem.label}"`;
          } else if (elem.identifier) {
            return elem.identifier;
          } else if (elem.label) {
            return `"${elem.label}"`;
          } else if (elem.inline) {
            return elem.inline;
          }
          return elem;
        });
        return `{${elements.join(', ')}}`;
        
      case 'vector':
        return `[${rule.rhs.join(', ')}]`;
        
      case 'union':
        if (rule.rhs.identifier && rule.rhs.label) {
          return `${rule.rhs.identifier}"${rule.rhs.label}"`;
        } else if (rule.rhs.identifier) {
          return rule.rhs.identifier;
        } else if (rule.rhs.label) {
          return `"${rule.rhs.label}"`;
        } else if (rule.rhs.inline) {
          return rule.rhs.inline;
        } else {
          return rule.rhs;
        }
        
      default:
        return rule.rhs;
    }
  }
}

export { ValueBasedEncoder };