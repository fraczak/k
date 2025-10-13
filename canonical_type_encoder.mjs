#!/usr/bin/env node

// Canonical Type Encoder - Transforms type definitions into encoding/decoding functions
// Handles union types (<...>) and product types ({...}) for Value instances
//
// Usage:
//   const { toBits, fromBits } = createTypeEncoder('$C0=<C0"0",C0"1",C1"_">;$C1={};');
//   const bits = toBits(value, 'C0');
//   const value = fromBits(bits, 'C0');
//
// Encoding Strategy:
//   - Union types: Sequential bit codes (00, 01, 10, ...) followed by member encoding
//   - Product types: Concatenation of member encodings
//   - Empty products: Empty bit string

import { Value, Vector, Product } from './Value.mjs';

class CanonicalTypeEncoder {
  constructor(typeDefinition) {
    this.typeDefinition = typeDefinition;
    this.types = new Map(); // type name -> type info
    this.encodingMap = new Map(); // type name -> encoding strategy
    this.parseTypeDefinition();
    this.generateEncodingStrategies();
  }

  // Parse type definition string like "$C0=<C0"0",C0"1",C1"_">;$C1={};"
  parseTypeDefinition() {
    // Split by semicolons to get individual type definitions
    const typeDefs = this.typeDefinition.split(';').filter(def => def.trim());
    
    for (const typeDef of typeDefs) {
      const trimmed = typeDef.trim();
      if (!trimmed.startsWith('$')) continue;
      
      // Extract type name and definition
      const match = trimmed.match(/^\$([^=]+)=(.+)$/);
      if (!match) continue;
      
      const typeName = match[1];
      const typeSpec = match[2];
      
      this.types.set(typeName, this.parseTypeSpec(typeSpec));
    }
  }

  // Parse individual type specification
  parseTypeSpec(spec) {
    spec = spec.trim();
    
    if (spec.startsWith('<') && spec.endsWith('>')) {
      // Union type
      const content = spec.slice(1, -1);
      const members = this.parseMembers(content);
      return {
        kind: 'union',
        members: members
      };
    } else if (spec.startsWith('{') && spec.endsWith('}')) {
      // Product type
      const content = spec.slice(1, -1);
      const members = content.trim() ? this.parseMembers(content) : [];
      return {
        kind: 'product',
        members: members
      };
    } else {
      throw new Error(`Unknown type specification: ${spec}`);
    }
  }

  // Parse comma-separated members, handling quoted strings
  parseMembers(content) {
    if (!content.trim()) return [];
    
    const members = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < content.length) {
      const char = content[i];
      
      if (char === '"' && (i === 0 || content[i-1] !== '\\')) {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          members.push(this.parseMember(current.trim()));
        }
        current = '';
      } else {
        current += char;
      }
      i++;
    }
    
    if (current.trim()) {
      members.push(this.parseMember(current.trim()));
    }
    
    return members;
  }

  // Parse individual member (either type reference or literal)
  parseMember(member) {
    if (member.startsWith('"') && member.endsWith('"')) {
      // Literal string
      return {
        kind: 'literal',
        value: JSON.parse(member) // Handle escaped quotes
      };
    } else {
      // Type reference (like C0"0" or C1"_")
      const match = member.match(/^([^"]+)(".*")?$/);
      if (match) {
        const typeName = match[1];
        const literal = match[2] ? JSON.parse(match[2]) : null;
        return {
          kind: 'type_ref',
          typeName: typeName,
          literal: literal
        };
      } else {
        throw new Error(`Cannot parse member: ${member}`);
      }
    }
  }

  // Generate encoding strategies for each type
  generateEncodingStrategies() {
    for (const [typeName, typeInfo] of this.types) {
      if (typeInfo.kind === 'union') {
        // For unions, assign sequential bit codes
        const memberCount = typeInfo.members.length;
        const bitsNeeded = Math.ceil(Math.log2(Math.max(1, memberCount)));
        
        const strategy = {
          kind: 'union',
          bitsNeeded: bitsNeeded,
          members: typeInfo.members.map((member, index) => ({
            ...member,
            code: index.toString(2).padStart(bitsNeeded, '0')
          }))
        };
        
        this.encodingMap.set(typeName, strategy);
      } else if (typeInfo.kind === 'product') {
        // For products, concatenate member encodings
        const strategy = {
          kind: 'product',
          members: typeInfo.members
        };
        
        this.encodingMap.set(typeName, strategy);
      }
    }
  }

  // Generate toBits function for encoding Values to bit strings
  generateToBitsFunction() {
    return (value, typeName = 'C0') => {
      return this.encodeValue(value, typeName);
    };
  }

  // Generate fromBits function for decoding bit strings to Values
  generateFromBitsFunction() {
    return (bitString, typeName = 'C0') => {
      const result = this.decodeValue(bitString, typeName, 0);
      if (result.position !== bitString.length) {
        throw new Error(`Incomplete decoding: expected to consume all ${bitString.length} bits, but only consumed ${result.position}`);
      }
      return result.value;
    };
  }

  // Encode a Value instance to bit string
  encodeValue(value, typeName) {
    const strategy = this.encodingMap.get(typeName);
    if (!strategy) {
      throw new Error(`Unknown type: ${typeName}`);
    }

    if (strategy.kind === 'union') {
      return this.encodeUnion(value, strategy);
    } else if (strategy.kind === 'product') {
      return this.encodeProduct(value, strategy);
    }
  }

  // Encode union type
  encodeUnion(value, strategy) {
    // For unions, we need to determine which member matches the value
    // This implementation assumes the value contains metadata to indicate which branch
    
    if (value instanceof Product && value.product._unionTag !== undefined) {
      // Value has explicit union tag
      const tagIndex = value.product._unionTag;
      if (tagIndex >= 0 && tagIndex < strategy.members.length) {
        const member = strategy.members[tagIndex];
        const memberValue = value.product._unionValue;
        
        if (member.kind === 'type_ref') {
          const memberBits = this.encodeValue(memberValue, member.typeName);
          return member.code + memberBits;
        } else if (member.kind === 'literal') {
          return member.code;
        }
      }
    }
    
    // Fallback: try to match against each member
    for (let i = 0; i < strategy.members.length; i++) {
      const member = strategy.members[i];
      
      if (member.kind === 'literal') {
        // Check if value matches the literal
        if (this.valueMatchesLiteral(value, member.value)) {
          return member.code;
        }
      } else if (member.kind === 'type_ref') {
        // For recursive types, we need special handling
        if (member.typeName === 'C1' && value instanceof Product) {
          // This is the C1"_" case - empty product
          const memberBits = this.encodeValue(value, member.typeName);
          return member.code + memberBits;
        }
      }
    }
    
    throw new Error(`Value ${value} does not match any union member in type`);
  }

  // Encode product type
  encodeProduct(value, strategy) {
    if (strategy.members.length === 0) {
      // Empty product
      return '';
    }
    
    if (!(value instanceof Product)) {
      throw new Error(`Expected Product value for product type, got ${value.constructor.name}`);
    }
    
    let result = '';
    for (const member of strategy.members) {
      if (member.kind === 'type_ref') {
        const memberValue = value.product[member.literal || ''];
        if (memberValue === undefined) {
          throw new Error(`Missing product member: ${member.literal}`);
        }
        result += this.encodeValue(memberValue, member.typeName);
      }
    }
    
    return result;
  }

  // Decode bit string to Value
  decodeValue(bitString, typeName, position) {
    const strategy = this.encodingMap.get(typeName);
    if (!strategy) {
      throw new Error(`Unknown type: ${typeName}`);
    }

    if (strategy.kind === 'union') {
      return this.decodeUnion(bitString, strategy, position);
    } else if (strategy.kind === 'product') {
      return this.decodeProduct(bitString, strategy, position);
    }
  }

  // Decode union type
  decodeUnion(bitString, strategy, position) {
    if (position + strategy.bitsNeeded > bitString.length) {
      throw new Error(`Not enough bits to decode union discriminator`);
    }
    
    const discriminator = bitString.substr(position, strategy.bitsNeeded);
    const memberIndex = parseInt(discriminator, 2);
    
    if (memberIndex >= strategy.members.length) {
      throw new Error(`Invalid union discriminator: ${discriminator}`);
    }
    
    const member = strategy.members[memberIndex];
    position += strategy.bitsNeeded;
    
    if (member.kind === 'literal') {
      // Return literal value wrapped in appropriate Value class
      return {
        value: this.createValueFromLiteral(member.value),
        position: position
      };
    } else if (member.kind === 'type_ref') {
      // Recursively decode with referenced type
      const result = this.decodeValue(bitString, member.typeName, position);
      
      // Wrap in union container to preserve which branch was taken
      return {
        value: new Product({
          _unionTag: memberIndex,
          _unionValue: result.value,
          _unionType: member.typeName,
          _unionLiteral: member.literal
        }),
        position: result.position
      };
    }
  }

  // Decode product type
  decodeProduct(bitString, strategy, position) {
    if (strategy.members.length === 0) {
      // Empty product
      return {
        value: new Product({}),
        position: position
      };
    }
    
    const productData = {};
    
    for (const member of strategy.members) {
      if (member.kind === 'type_ref') {
        const result = this.decodeValue(bitString, member.typeName, position);
        productData[member.literal || ''] = result.value;
        position = result.position;
      }
    }
    
    return {
      value: new Product(productData),
      position: position
    };
  }

  // Helper methods
  valueMatchesLiteral(value, literal) {
    // Simple matching - extend as needed
    return value.toString() === literal.toString();
  }

  createValueFromLiteral(literal) {
    // Create appropriate Value instance from literal
    if (typeof literal === 'string') {
      return new Product({ value: literal }); // Simple wrapper
    }
    return new Product({ value: literal });
  }
}

// Factory function to create encoder from type definition
export function createTypeEncoder(typeDefinition) {
  const encoder = new CanonicalTypeEncoder(typeDefinition);
  
  return {
    toBits: encoder.generateToBitsFunction(),
    fromBits: encoder.generateFromBitsFunction(),
    types: encoder.types,
    encodingMap: encoder.encodingMap
  };
}

// Demo function
export function demonstrateTypeEncoder() {
  console.log('=== Canonical Type Encoder Demo ===\n');
  
  const typeDefinition = '$C0=<C0"0",C0"1",C1"_">;$C1={};';
  console.log('Type definition:', typeDefinition);
  
  const { toBits, fromBits, types, encodingMap } = createTypeEncoder(typeDefinition);
  
  console.log('\nParsed types:');
  for (const [name, type] of types) {
    console.log(`${name}:`, JSON.stringify(type, null, 2));
  }
  
  console.log('\nEncoding strategies:');
  for (const [name, strategy] of encodingMap) {
    console.log(`${name}:`, JSON.stringify(strategy, null, 2));
  }
  
  // Test with example values
  console.log('\nTesting encoding/decoding:');
  
  try {
    // Test empty product (C1)
    const emptyProduct = new Product({});
    const emptyBits = toBits(emptyProduct, 'C1');
    console.log(`C1 (empty product) -> "${emptyBits}"`);
    
    const decodedEmpty = fromBits(emptyBits, 'C1');
    console.log(`"${emptyBits}" -> ${decodedEmpty}`);
    console.log();
    
    // Test union with C1"_" (third option - code "10")
    const unionC1 = new Product({
      _unionTag: 2,  // Third member (C1"_")
      _unionValue: new Product({})  // Empty C1
    });
    const unionBits = toBits(unionC1, 'C0');
    console.log(`C0 with C1"_" option -> "${unionBits}"`);
    
    const decodedUnion = fromBits(unionBits, 'C0');
    console.log(`"${unionBits}" -> ${JSON.stringify(decodedUnion.toJSON(), null, 2)}`);
    
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Stack:', error.stack);
  }
}

export { CanonicalTypeEncoder };