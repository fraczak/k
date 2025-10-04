import { Value, Vector, Product } from './Value.mjs';

class SemanticEncoder {
  constructor(cfg) {
    this.cfg = cfg;
    this.rules = this.parseCFG(cfg);
    this.encodingRules = this.extractEncodingRules();
  }

  parseCFG(cfg) {
    const rules = [];
    
    cfg.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      
      // Parse rule: $C0=<C1"list",C2"nil">;
      // Or with encoding annotation: $bnat@binary=<{}_,bnat"0",bnat"1">;
      const match = trimmed.match(/\$([^@=]+)(@([^=]+))?=(.+);/);
      if (!match) return;
      
      const lhs = match[1];
      const encoding = match[3] || 'prefix-free'; // default encoding
      const rhsStr = match[4];
      
      // Parse RHS alternatives
      if (rhsStr.startsWith('<') && rhsStr.endsWith('>')) {
        // Union: <alt1,alt2,alt3>
        const content = rhsStr.slice(1, -1);
        const alternatives = this.parseAlternatives(content);
        
        alternatives.forEach((alt, index) => {
          rules.push({
            lhs,
            rhs: alt,
            type: 'union',
            encoding,
            altIndex: index
          });
        });
      } else if (rhsStr.startsWith('{') && rhsStr.endsWith('}')) {
        // Product: {elem1,elem2}
        const content = rhsStr.slice(1, -1);
        const elements = content ? this.parseProductElements(content) : [];
        
        rules.push({
          lhs,
          rhs: elements,
          type: 'product',
          encoding
        });
      } else if (rhsStr.startsWith('[') && rhsStr.endsWith(']')) {
        // Vector: [elem1,elem2]
        const content = rhsStr.slice(1, -1);
        const elements = content ? this.parseVectorElements(content) : [];
        
        rules.push({
          lhs,
          rhs: elements,
          type: 'vector',
          encoding
        });
      }
    });
    
    return rules;
  }

  extractEncodingRules() {
    const encodings = new Map();
    
    this.rules.forEach(rule => {
      if (!encodings.has(rule.lhs)) {
        encodings.set(rule.lhs, rule.encoding);
      }
    });
    
    return encodings;
  }

  // Parse alternatives - reuse from previous implementation
  parseAlternatives(str) {
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
    // Parse element: can be C1"label", just C1, just "string", or {}/[]/inline structure
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
    return this.parseAlternatives(str);
  }

  parseVectorElements(str) {
    return this.parseAlternatives(str);
  }

  // Enhanced encoding that respects semantic annotations
  encode(value, typeName = 'C0') {
    const encoding = this.encodingRules.get(typeName) || 'prefix-free';
    
    switch (encoding) {
      case 'binary':
        return this.encodeBinary(value, typeName);
      case 'decimal':
        return this.encodeDecimal(value, typeName);
      case 'tlv':
        return this.encodeTLV(value, typeName);
      case 'utf8':
        return this.encodeUTF8(value, typeName);
      default:
        return this.encodePrefixFree(value, typeName);
    }
  }

  encodeBinary(value, typeName) {
    // For bnat: encode natural number as binary string
    if (typeof value === 'number') {
      return value === 0 ? '' : value.toString(2);
    }
    
    // If it's a k value representing bnat, extract the number
    if (value && typeof value === 'object') {
      const num = this.extractBnatValue(value);
      return num === 0 ? '' : num.toString(2);
    }
    
    return '';
  }

  encodeDecimal(value, typeName) {
    // For dnat: encode natural number as decimal string
    if (typeof value === 'number') {
      return value.toString(10);
    }
    
    // If it's a k value representing dnat, extract the number
    if (value && typeof value === 'object') {
      const num = this.extractDnatValue(value);
      return num.toString(10);
    }
    
    return '0';
  }

  encodeTLV(value, typeName) {
    // Type-Length-Value encoding
    const typeCode = this.getTypeCode(typeName);
    const payload = this.encodePayload(value, typeName);
    const length = payload.length;
    
    return `${typeCode}:${length}:${payload}`;
  }

  encodeUTF8(value, typeName) {
    // For string types: direct UTF-8 encoding
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }

  encodePrefixFree(value, typeName) {
    // Fallback to prefix-free encoding for complex structures
    // Implementation would be similar to our previous approach
    return this.generatePrefixFreeEncoding(value, typeName);
  }

  // Helper methods for extracting numeric values from k structures
  extractBnatValue(kValue) {
    // Extract binary natural number from k structure
    // This would traverse the bnat structure and convert to number
    // For now, simplified implementation
    return 0;
  }

  extractDnatValue(kValue) {
    // Extract decimal natural number from k structure  
    // This would traverse the dnat structure and convert to number
    // For now, simplified implementation
    return 0;
  }

  getTypeCode(typeName) {
    // Assign unique type codes for TLV encoding
    const typeCodes = {
      'bnat': 'B',
      'dnat': 'D', 
      'string': 'S',
      'list': 'L',
      'C0': '0',
      'C1': '1',
      'C2': '2'
    };
    return typeCodes[typeName] || 'X';
  }

  encodePayload(value, typeName) {
    // Encode the actual payload based on type
    if (typeof value === 'string') {
      return value;
    } else if (typeof value === 'number') {
      return value.toString();
    } else {
      return JSON.stringify(value);
    }
  }

  generatePrefixFreeEncoding(value, typeName) {
    // Placeholder for prefix-free encoding
    return 'TODO';
  }

  // Example usage demonstration
  printEncodingRules() {
    console.log('Type encoding rules:');
    this.encodingRules.forEach((encoding, typeName) => {
      console.log(`  ${typeName}: ${encoding}`);
    });
  }
}

export { SemanticEncoder };