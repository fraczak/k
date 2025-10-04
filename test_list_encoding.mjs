#!/usr/bin/env node

// Test rule-based encoding with the complex list structure
import { CFGRuleEncoder } from './rule_based_encoding.mjs';

async function testListStructure() {
  console.log('=== Rule-Based Encoding: List Structure ===\n');
  
  const encoder = new CFGRuleEncoder();
  
  // Use the CFG directly since we know it
  const cfgRepresentation = '$C0=<C1"list",C2"nil">;$C1={C3"head",C0"tail"};$C2={};$C3=<C3"0",C3"1",C2"_">;';
  console.log('CFG representation:', cfgRepresentation);
  
  try {
    // Parse into rules
    const rules = encoder.parseCFGIntoRules(cfgRepresentation);
    console.log('\nProduction rules (k notation):');
    rules.forEach((rule, index) => {
      console.log(`Rule ${rule.ruleId}: ${rule.kNotation || rule.lhs + ' -> ' + rule.rhs.join('')}`);
    });
    
    // Generate codes
    const codes = encoder.generateRuleCodes(rules);
    console.log('\nRule codes (k notation):');
    rules.forEach(rule => {
      const code = codes.get(rule.ruleId);
      console.log(`Rule ${rule.ruleId}: ${rule.kNotation || rule.lhs + ' -> ' + rule.rhs.join('')} => [${code}]`);
    });
    
    // Group by non-terminal to show prefix-free property
    console.log('\nCodes grouped by non-terminal:');
    const rulesByNT = new Map();
    rules.forEach(rule => {
      if (!rulesByNT.has(rule.lhs)) {
        rulesByNT.set(rule.lhs, []);
      }
      rulesByNT.get(rule.lhs).push(rule);
    });
    
    for (const [nt, ntRules] of rulesByNT) {
      console.log(`${nt}:`);
      ntRules.forEach(rule => {
        const code = codes.get(rule.ruleId);
        console.log(`  ${rule.kNotation || rule.lhs + ' -> ' + rule.rhs.join('')} => [${code}]`);
      });
    }
    
    // Verify prefix-free property
    const isPrefixFree = encoder.verifyPrefixFreeProperty(codes, rules);
    console.log(`\nPrefix-free property: ${isPrefixFree ? '✓ Valid' : '✗ Invalid'}`);
    
    // Test some example derivations
    console.log('\n=== Example Derivations ===');
    
    // Test 1: C0 -> C2"nil" (empty list)
    console.log('\n1. Deriving empty list (nil):');
    console.log('Expected: C0 -> C2"nil" (bit 1), then C2 -> {} (no bit)');
    const emptyList = encoder.decodeBitString('1', rules, codes, 'C0');
    console.log(`Bit string "1":`);
    console.log(`  Derivation: ${emptyList.derivation.join(' -> ')}`);
    console.log(`  Final result: "${emptyList.finalString}"`);
    console.log(`  Bits used: ${emptyList.bitsUsed}, Success: ${emptyList.success}`);
    
    // Test 2: Try manual step-by-step analysis
    console.log('\n2. Manual analysis of list structure:');
    console.log('Available rules and their codes:');
    console.log('C0 -> {C1 "list"} [0] or C0 -> {C2 "nil"} [1]');
    console.log('C1 -> {C3 "head", C0 "tail"} []');
    console.log('C2 -> {} []'); 
    console.log('C3 -> {C3 "0"} [00] or C3 -> {C3 "1"} [01] or C3 -> {C2 "_"} [10]');
    console.log('');
    
    // Let's trace what should happen for bit string "010"
    console.log('Tracing bit string "010":');
    console.log('1. Start with C0, read bit "0" -> apply rule C0 -> {C1 "list"}');
    console.log('2. Need to expand C1, single rule -> apply C1 -> {C3 "head", C0 "tail"}');
    console.log('3. Need to expand C3, read bits "10" -> apply rule C3 -> {C2 "_"}');
    console.log('4. Need to expand C2, single rule -> apply C2 -> {}');
    console.log('5. Still have C0 from tail, but no more bits');
    
    const trace010 = encoder.decodeBitString('010', rules, codes, 'C0');
    console.log(`\nActual result for "010":`);
    console.log(`  Derivation: ${trace010.derivation.join(' -> ')}`);
    console.log(`  Final result: "${trace010.finalString}"`);
    console.log(`  Bits used: ${trace010.bitsUsed}, Success: ${trace010.success}`);
    
    // Test 3: Complete list with underscore head and nil tail
    console.log('\n3. Complete single-element list [_ | nil]:');
    console.log('Expected: C0->{C1 "list"} [0], C1->{C3 "head", C0 "tail"} [], C3->{C2 "_"} [10], C0->{C2 "nil"} [1], C2->{} []');
    console.log('Bit sequence should be: 0 + 10 + 1 = "0101"');
    console.log('Bit sequence should be: 0 + 10 + 1 = "0101"');
    
    const completeList = encoder.decodeBitString('0101', rules, codes, 'C0');
    console.log(`\nActual result for "0101":`);
    console.log(`  Derivation: ${completeList.derivation.join(' -> ')}`);
    console.log(`  Final result: "${completeList.finalString}"`);
    console.log(`  Bits used: ${completeList.bitsUsed}, Success: ${completeList.success}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

// Run test
testListStructure();