import { SemanticEncoder } from './semantic_encoding.mjs';

console.log('=== Semantic-Aware Encoding Demo ===\n');

// Example grammar with encoding annotations
const cfg = [
    "$bnat@binary=<{}_,bnat\"0\",bnat\"1\">;",  // Binary encoding for bnat
    "$dnat@decimal=<{}_,dnat\"0\",dnat\"1\",dnat\"2\",dnat\"3\",dnat\"4\",dnat\"5\",dnat\"6\",dnat\"7\",dnat\"8\",dnat\"9\">;",  // Decimal encoding for dnat
    "$string@utf8=<\"\">;",  // UTF-8 encoding for strings
    "$list@tlv=<{}nil,{X\"head\",list\"tail\"}cons>;",  // TLV encoding for lists
    "$C0=<C1\"list\",C2\"nil\">;"  // Default prefix-free for unknown types
];

const encoder = new SemanticEncoder(cfg);

console.log('Grammar with encoding annotations:');
cfg.forEach(rule => console.log(`  ${rule}`));
console.log();

encoder.printEncodingRules();
console.log();

console.log('=== Encoding Examples ===\n');

// Examples of what we want to achieve:
console.log('Desired encodings:');
console.log('  bnat 5 → "101" (binary)');
console.log('  bnat 0 → "" (empty for zero)'); 
console.log('  dnat 5 → "5" (decimal)');
console.log('  dnat 42 → "42" (decimal)');
console.log('  string "hello" → "hello" (UTF-8)');
console.log('  list [1,2,3] → "L:7:[1,2,3]" (TLV)');
console.log('  complex structure → "001011" (prefix-free fallback)');
console.log();

console.log('=== Key Benefits ===\n');
console.log('1. Semantic preservation: bnat uses actual binary representation');
console.log('2. Human readability: dnat uses decimal, strings use UTF-8'); 
console.log('3. Flexibility: TLV for self-describing data');
console.log('4. Backwards compatibility: prefix-free fallback for complex cases');
console.log('5. Type safety: encoding method matches data semantics');
console.log();

console.log('=== Grammar Extensions ===\n');
console.log('Proposed encoding annotation syntax:');
console.log('  $typename@encoding = <alternatives>;');
console.log();
console.log('Supported encodings:');
console.log('  @binary   - Natural binary representation (for bnat)');
console.log('  @decimal  - Decimal representation (for dnat)'); 
console.log('  @utf8     - UTF-8 string encoding');
console.log('  @tlv      - Type-Length-Value with headers');
console.log('  @base64   - Base64 encoding for binary data');
console.log('  @varint   - Variable-length integer encoding');
console.log('  @custom   - User-defined encoding function');
console.log('  (default) - Prefix-free encoding');
console.log();

console.log('=== Breaking Prefix-Free Constraints ===\n');
console.log('This approach allows:');
console.log('- Mixed encoding schemes in one grammar');
console.log('- Context-dependent decoding based on type');
console.log('- Semantic preservation over mathematical optimality');
console.log('- Human-friendly representations where appropriate');
console.log();

console.log('The key insight: encoding should match the MEANING of the data,');
console.log('not just provide mathematical prefix-free properties!');

// Demo of how decoding would work
console.log('\n=== Decoding Strategy ===\n');
console.log('Input: Mixed format like "B:3:101,D:2:42,S:5:hello"');
console.log('1. Parse TLV headers to identify data types');
console.log('2. Route each chunk to appropriate decoder:');
console.log('   - B:3:101 → bnat decoder → binary "101" → value 5');
console.log('   - D:2:42 → dnat decoder → decimal "42" → value 42'); 
console.log('   - S:5:hello → string decoder → UTF-8 "hello" → "hello"');
console.log('3. Reconstruct k values using appropriate Value constructors');
console.log();

console.log('This gives us the best of all worlds:');
console.log('✓ Human-readable for numbers and strings');
console.log('✓ Efficient for appropriate data types');
console.log('✓ Self-describing with TLV headers');
console.log('✓ Extensible with custom encodings');
console.log('✓ Backwards compatible with prefix-free fallback');