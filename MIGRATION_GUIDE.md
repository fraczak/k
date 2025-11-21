# Migration Guide: Old patterns.mjs → New Implementation

## Why Not Direct Replacement?

The old `patterns.mjs` is tightly coupled with:
- Specific AST structure from parser
- `typing.mjs` TypePatternGraph implementation
- `export.mjs` canonicalization
- `codes.mjs` code registry format

A direct replacement would require:
1. Extensive testing of all edge cases
2. Ensuring backward compatibility
3. Risk of breaking existing functionality

## Recommended Approach: Gradual Migration

### Phase 1: Validation (Current)
- Keep old implementation as-is
- Use new implementation for testing/validation
- Compare results on test suite

### Phase 2: Refactor Old Code (Recommended)
Use the new implementation as a **reference** to refactor the old code:

1. **Extract Pattern class** from typing.mjs
   ```javascript
   // Instead of: {pattern: '(...)', fields: [...]}
   // Use: Pattern.openUnknown([...])
   ```

2. **Extract Unification** into separate module
   ```javascript
   // Move unify_two_patterns logic to Unification.mjs
   // Keep same interface, cleaner implementation
   ```

3. **Separate LocalRules** from patterns.mjs
   ```javascript
   // Move augment* functions to LocalRules.mjs
   // One function per expression type
   ```

4. **Improve Error Messages**
   ```javascript
   // Add reason chains like new implementation
   // Better context in error messages
   ```

### Phase 3: Incremental Replacement
Replace modules one at a time:

1. Replace UnionFind implementation
2. Replace Pattern representation
3. Replace Unification logic
4. Replace LocalRules
5. Finally replace main algorithm

## Quick Wins (Low Risk)

You can immediately adopt these improvements:

### 1. Better Error Messages
```javascript
// In typing.mjs unify_two_patterns:
throw new Error(`${reason}: Cannot unify ${p1.pattern} with ${p2.pattern}`);
```

### 2. Convergence Warning
✅ Already added in current commit

### 3. Pattern Type Constants
```javascript
// Add to typing.mjs:
const PATTERN_TYPES = {
  OPEN_UNKNOWN: '(...)',
  OPEN_PRODUCT: '{...}',
  OPEN_UNION: '<...>',
  CLOSED_UNKNOWN: '()',
  CLOSED_PRODUCT: '{}',
  CLOSED_UNION: '<>',
  TYPE: 'type'
};
```

### 4. Separate Test File
```javascript
// Create patterns.test.mjs
// Test each function independently
```

## Testing Strategy

Before any replacement:

1. **Create comprehensive test suite**
   ```bash
   npm test  # Should pass with both implementations
   ```

2. **Compare outputs**
   ```javascript
   const oldResult = oldPatterns(representatives, rels);
   const newResult = newPatterns(representatives, rels);
   assert.deepEqual(oldResult, newResult);
   ```

3. **Performance benchmarks**
   ```javascript
   // Ensure new implementation isn't slower
   console.time('old'); oldPatterns(...); console.timeEnd('old');
   console.time('new'); newPatterns(...); console.timeEnd('new');
   ```

## If You Really Want Direct Replacement

⚠️ **Not recommended without extensive testing**

1. Backup current implementation:
   ```bash
   cp patterns.mjs patterns-old.mjs
   cp typing.mjs typing-old.mjs
   ```

2. Create adapter layer (see patterns-new.mjs)

3. Test extensively:
   ```bash
   npm test
   ./tests.sh
   # Test on all examples in Examples/
   ```

4. If all tests pass, gradually switch:
   ```javascript
   // In index.mjs:
   import { patterns } from "./patterns-new.mjs";  // Try new
   // import { patterns } from "./patterns.mjs";   // Fallback to old
   ```

## Conclusion

**Best approach:** Use new implementation as a **reference** to incrementally improve the old code, rather than wholesale replacement.

This minimizes risk while gaining benefits of cleaner architecture.
