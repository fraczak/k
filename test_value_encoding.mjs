import { ValueBasedEncoder } from './value_based_encoding.mjs';

// Example CFG - same structure but now thinking in terms of Value objects
const cfg = [
    "$C0=<C1\"list\",C2\"nil\">;",
    "$C1={C3\"head\",C0\"tail\"};", 
    "$C2={};",
    "$C3=<C3\"0\",C3\"1\",C2\"_\">;"
];

console.log('=== Value-Based Encoding: List Structure ===\n');

const encoder = new ValueBasedEncoder(cfg);

console.log('CFG representation:', cfg.join(''));
console.log();

encoder.printRules();
console.log();

console.log('=== Example Derivations ===\n');

// Test cases
const testCases = ['1', '0101', '0001', '000101'];

testCases.forEach(bits => {
    console.log(`Testing bit string "${bits}":`);
    const result = encoder.decodeBitString(bits);
    
    if (result.success) {
        console.log(`  Value object:`, result.value);
        console.log(`  K notation: ${result.kNotation}`);
        console.log(`  Bits used: ${result.bitsUsed}, Success: ${result.success}`);
    } else {
        console.log(`  Error: ${result.error}`);
        console.log(`  Bits used: ${result.bitsUsed}, Success: ${result.success}`);
    }
    console.log();
});

// Let's also trace the construction manually for "0101"
console.log('=== Manual trace for "0101" ===');
console.log('Expected derivation:');
console.log('1. C0 with bit "0" -> C1"list" (Product with list label)');
console.log('2. C1 -> {C3"head", C0"tail"} (Product with head and tail)');
console.log('3. C3 with bits "10" -> C2"_" (terminal "_")');
console.log('4. C2 -> {} (empty Product)');
console.log('5. C0 with bit "1" -> C2"nil" (Product with nil label)');
console.log('6. C2 -> {} (empty Product)');
console.log();
console.log('So the final structure should be:');
console.log('Product({ "list": Product({ "head": "_", "tail": Product({"nil": Product({})}) }) })');