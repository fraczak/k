#!/usr/bin/env node
/**
 * Example: Demonstrating the codec pipeline
 * 
 * Shows how to:
 * 1. Define types with canonical names
 * 2. Create values
 * 3. Encode to binary
 * 4. Pass through "compiled program" (identity)
 * 5. Decode from binary
 * 6. Print result
 */

import { encode, decode } from './runtime/codec.mjs';
import { Product, Variant } from '../Value.mjs';
import hash from '../hash.mjs';

console.log('=== K Codec Pipeline Example ===\n');

// ============================================================================
// Step 1: Define types (normally from compiler)
// ============================================================================

const types = {};

// Unit: {}
const unitDef = { code: 'product', product: {} };
const unitName = hash('$C0={};');
types[unitName] = unitDef;

// Bool: <{} false, {} true>
const boolDef = {
  code: 'union',
  union: { false: unitName, true: unitName }
};
const boolName = hash(`$C0=<${unitName}"false",${unitName}"true">;`);
types[boolName] = boolDef;

// Maybe: <{} nothing, Bool something>
const maybeDef = {
  code: 'union',
  union: { nothing: unitName, something: boolName }
};
const maybeName = hash(
  `$C0=<${unitName}"nothing",${boolName}"something">;`
);
types[maybeName] = maybeDef;

console.log('Types defined:');
console.log('  unit:', unitName);
console.log('  bool:', boolName);
console.log('  maybe:', maybeName);
console.log();

// ============================================================================
// Step 2: Type resolver
// ============================================================================

function resolveType(typeName) {
  const def = types[typeName];
  if (!def) {
    throw new Error(`Unknown type: ${typeName}`);
  }
  return def;
}

// ============================================================================
// Step 3: Create input value: Maybe Bool = something(true)
// ============================================================================

const inputValue = new Variant(
  'something',
  new Variant('true', new Product({}))
);

console.log('Input value:', inputValue.toString());
console.log();

// ============================================================================
// Step 4: Parse (TEXT → BINARY)
// ============================================================================

console.log('--- PARSE (text → binary) ---');
const binaryInput = encode(inputValue, maybeName, maybeDef, resolveType);
console.log('Binary size:', binaryInput.length, 'bytes');
console.log('  Type hash (32 bytes):', binaryInput.slice(0, 32).toString('hex'));
console.log('  Payload:', binaryInput.slice(32).toString('hex'));
console.log('  Payload bits:', [...binaryInput.slice(32)]
  .map(b => b.toString(2).padStart(8, '0')).join(' '));
console.log();

// ============================================================================
// Step 5: Compiled k-program (BINARY → BINARY)
// ============================================================================

console.log('--- COMPILED PROGRAM (binary → binary) ---');

// Simulate a compiled k-program: decode → transform → encode
const { typeName: inTypeName, value: programInput } = decode(
  binaryInput,
  resolveType
);

console.log('Program sees type:', inTypeName);
console.log('Program sees value:', programInput.toString());

// Example transformation: NOT operation (flip bool inside Maybe)
let programOutput;
if (programInput instanceof Variant && programInput.tag === 'something') {
  const innerBool = programInput.value;
  if (innerBool instanceof Variant) {
    const flipped = new Variant(
      innerBool.tag === 'true' ? 'false' : 'true',
      innerBool.value
    );
    programOutput = new Variant('something', flipped);
  }
} else {
  programOutput = programInput; // nothing → nothing
}

console.log('Program output value:', programOutput.toString());

// Encode output
const binaryOutput = encode(
  programOutput,
  maybeName,
  maybeDef,
  resolveType
);

console.log('Binary output size:', binaryOutput.length, 'bytes');
console.log('  Payload:', binaryOutput.slice(32).toString('hex'));
console.log();

// ============================================================================
// Step 6: Print (BINARY → TEXT)
// ============================================================================

console.log('--- PRINT (binary → text) ---');
const { typeName: outTypeName, value: finalValue } = decode(
  binaryOutput,
  resolveType
);

console.log('Output type:', outTypeName);
console.log('Output value:', finalValue.toString());
console.log();

// ============================================================================
// Summary
// ============================================================================

console.log('=== Pipeline Summary ===');
console.log('Input:  ', inputValue.toString(), '(true inside Maybe)');
console.log('Transform: NOT operation on inner bool');
console.log('Output: ', finalValue.toString(), '(false inside Maybe)');
console.log();
console.log('Binary representations are canonical and type-safe!');
