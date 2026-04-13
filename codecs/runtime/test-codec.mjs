#!/usr/bin/env node
/**
 * Test the binary codec with basic k types
 */

import { encode, decode } from './codec.mjs';
import { Product, Variant } from '../../Value.mjs';
import hash from '../../hash.mjs';

// Type repository
const types = {};

// Define unit type: {}
const unitTypeDef = { code: 'product', product: {} };
const unitTypeStr = '$C0={};';
const unitTypeName = hash(unitTypeStr);
types[unitTypeName] = unitTypeDef;

console.log('Unit type name:', unitTypeName);

// Define bool type: <{} false, {} true>
const boolTypeDef = {
  code: 'union',
  union: {
    false: unitTypeName,
    true: unitTypeName
  }
};
const boolTypeStr = `$C0=<${unitTypeName}"false",${unitTypeName}"true">;`;
const boolTypeName = hash(boolTypeStr);
types[boolTypeName] = boolTypeDef;

console.log('Bool type name:', boolTypeName);

// Resolver function
function resolveType(typeName) {
  if (!types[typeName]) {
    throw new Error(`Unknown type: ${typeName}`);
  }
  return types[typeName];
}

// Test 1: Unit value
console.log('\n=== Test 1: Unit ===');
const unitValue = new Product({});
console.log('Encoding unit:', unitValue.toString());

const unitEncoded = encode(unitValue, unitTypeName, unitTypeDef, resolveType);
console.log('Encoded bytes:', unitEncoded.length, 'bytes');
console.log('Hex:', unitEncoded.toString('hex'));

const unitDecoded = decode(unitEncoded, resolveType);
console.log('Decoded type:', unitDecoded.typeName);
console.log('Decoded value:', unitDecoded.value.toString());
console.log('Match:', unitDecoded.value instanceof Product && 
            Object.keys(unitDecoded.value.product).length === 0);

// Test 2: Bool false
console.log('\n=== Test 2: Bool (false) ===');
const falseValue = new Variant('false', new Product({}));
console.log('Encoding false:', falseValue.toString());

const falseEncoded = encode(falseValue, boolTypeName, boolTypeDef, resolveType);
console.log('Encoded bytes:', falseEncoded.length, 'bytes');
console.log('Hex:', falseEncoded.toString('hex'));
console.log('Payload (after hash):', falseEncoded.slice(32).toString('hex'));

const falseDecoded = decode(falseEncoded, resolveType);
console.log('Decoded type:', falseDecoded.typeName);
console.log('Decoded value:', falseDecoded.value.toString());
console.log('Match:', falseDecoded.value instanceof Variant && 
            falseDecoded.value.tag === 'false');

// Test 3: Bool true
console.log('\n=== Test 3: Bool (true) ===');
const trueValue = new Variant('true', new Product({}));
console.log('Encoding true:', trueValue.toString());

const trueEncoded = encode(trueValue, boolTypeName, boolTypeDef, resolveType);
console.log('Encoded bytes:', trueEncoded.length, 'bytes');
console.log('Hex:', trueEncoded.toString('hex'));
console.log('Payload (after hash):', trueEncoded.slice(32).toString('hex'));

const trueDecoded = decode(trueEncoded, resolveType);
console.log('Decoded type:', trueDecoded.typeName);
console.log('Decoded value:', trueDecoded.value.toString());
console.log('Match:', trueDecoded.value instanceof Variant && 
            trueDecoded.value.tag === 'true');

console.log('\n=== All tests complete ===');
