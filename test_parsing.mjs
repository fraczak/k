#!/usr/bin/env node

// Quick test to see what parseProductElements returns
import { CFGRuleEncoder } from './rule_based_encoding.mjs';

const encoder = new CFGRuleEncoder();
const testString = 'C3"head",C0"tail"';
console.log('Input:', testString);
console.log('Parsed elements:', encoder.parseProductElements(testString));

// Test k notation generation
const elements = encoder.parseProductElements(testString);
console.log('K notation: {' + elements.join(', ') + '}');
console.log('Spaced notation: {' + elements.map(e => e.match(/^C\d+/) ? e : ` ${e}`).join(', ') + '}');