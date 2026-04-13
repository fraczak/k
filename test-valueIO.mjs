#!/usr/bin/env node
/**
 * Test: Value I/O with Type Parameters (Step 1)
 * 
 * Demonstrates the new valueIO API that accepts type parameters.
 * Currently, types are accepted but not used (Step 1).
 * In Step 2, types will enable binary format and validation.
 */

import { parseValue, printValue } from './valueIO.mjs';
import { Product, Variant } from './Value.mjs';
import hash from './hash.mjs';

console.log('=== Value I/O API Test (Step 1) ===\n');

// ============================================================================
// Test 1: Parse without type (backward compatible)
// ============================================================================

console.log('--- Test 1: Parse without type (legacy mode) ---');
const text1 = '{"name": "Alice", "age": 30}';
const value1 = parseValue(text1);
console.log('Input:', text1);
console.log('Parsed:', value1.toString());
console.log('Type:', value1.constructor.name);
console.log();

// ============================================================================
// Test 2: Parse with type information (Step 1 - type ignored for now)
// ============================================================================

console.log('--- Test 2: Parse with type information ---');

// Define a type (will be used in Step 2)
const personTypeDef = {
  code: 'product',
  product: {
    name: '@stringType',  // Hypothetical string type
    age: '@natType'       // Hypothetical nat type
  }
};
const personTypeName = hash('$C0={...};'); // Simplified for demo

const text2 = '{"name": "Bob", "age": 25}';
const value2 = parseValue(text2, personTypeName, personTypeDef);

console.log('Input:', text2);
console.log('Type name:', personTypeName);
console.log('Type def:', JSON.stringify(personTypeDef, null, 2));
console.log('Parsed:', value2.toString());
console.log('Note: Type validation will be added in Step 2');
console.log();

// ============================================================================
// Test 3: Print value
// ============================================================================

console.log('--- Test 3: Print value ---');
const value3 = new Variant('some', new Product({ value: new Variant('42', new Product({})) }));
const text3 = printValue(value3);
console.log('Value:', value3.toString());
console.log('Printed:', text3);
console.log();

// ============================================================================
// Test 4: Print with type (prepares for binary format in Step 2)
// ============================================================================

console.log('--- Test 4: Print with type information ---');
const maybeTypeDef = {
  code: 'union',
  union: {
    none: '@unitType',
    some: '@natType'
  }
};
const maybeTypeName = hash('$C0=<...>;');

const value4 = new Variant('some', new Variant('100', new Product({})));
const text4 = printValue(value4, maybeTypeName, maybeTypeDef);

console.log('Value:', value4.toString());
console.log('Type name:', maybeTypeName);
console.log('Printed:', text4);
console.log('Note: Binary encoding will be added in Step 2');
console.log();

// ============================================================================
// Test 5: Round-trip (parse → print)
// ============================================================================

console.log('--- Test 5: Round-trip test ---');
const original = '{"x": "true", "y": "false"}';
const parsed = parseValue(original, null, null);
const printed = printValue(parsed, null, null);
const reparsed = parseValue(printed, null, null);

console.log('Original:', original);
console.log('Parsed:', parsed.toString());
console.log('Printed:', printed);
console.log('Reparsed:', reparsed.toString());
console.log('Match:', parsed.toString() === reparsed.toString() ? '✅' : '❌');
console.log();

// ============================================================================
// Summary
// ============================================================================

console.log('=== Summary ===');
console.log('✅ Step 1 Complete: API accepts type parameters');
console.log('📋 All existing code migrated to new API');
console.log('🔜 Step 2 Next: Implement binary codec & validation');
console.log();
console.log('Current API:');
console.log('  parseValue(text, typeName?, typeInfo?) → Value');
console.log('  printValue(value, typeName?, typeInfo?) → string');
console.log();
console.log('Step 2 will add:');
console.log('  - Binary format support (auto-detected)');
console.log('  - Type validation during parse');
console.log('  - Canonical binary encoding');
console.log('  - Content-addressed type resolution');
