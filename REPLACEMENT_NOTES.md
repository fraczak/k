# Direct Replacement Attempt - Notes

## What Worked

✅ Basic structure and algorithm  
✅ Convergence warning  
✅ Some simple tests passed  

## What Failed

### 1. Built-in Type Handling

**Error:** `Type bool doesn't have fields: true`

**Issue:** The old implementation has special handling for built-in types like `bool`, `@bits`, etc. The new implementation doesn't know about these.

**Example:**
```k
$ bool = < {} true, {} false >;
true = {} | true $bool;
```

The `$bool` type reference needs special handling.

### 2. Code Registry Integration

The new implementation expects:
```javascript
codeRegistry.set('bool', {
  type: 'union',
  fields: { true: '{}', false: '{}' }
});
```

But the actual `codes.mjs` structure is more complex and includes built-in types that aren't in the standard format.

### 3. AST Structure Assumptions

The new implementation assumes a clean AST structure, but the actual parser produces:
- `rels[name] = {def: expr}` not just `expr`
- Various built-in expression types not documented
- Special cases for filters, vectors, etc.

## What's Needed for Successful Replacement

### Short Term (Quick Fixes)

1. **Add Built-in Type Support**
   ```javascript
   // In TypeDerivation.mjs
   const BUILTINS = new Set(['bool', '@bits', ...]);
   // Special handling in unification
   ```

2. **Better Code Registry Builder**
   ```javascript
   // In patterns.mjs
   function buildCodeRegistry() {
     // Handle all code types from codes.mjs
     // Including built-ins
   }
   ```

3. **Handle All Expression Types**
   - Check parser.jison for all `op` types
   - Add missing cases to LocalRules.mjs

### Medium Term (Refactoring)

1. **Incremental Migration** (as per MIGRATION_GUIDE.md)
   - Start with UnionFind
   - Then Pattern class
   - Then Unification
   - Finally main algorithm

2. **Comprehensive Test Suite**
   - Unit tests for each module
   - Integration tests for all expression types
   - Tests for built-in types

### Long Term (Clean Slate)

1. **Redesign AST**
   - Consistent structure
   - No special cases
   - Clear documentation

2. **Redesign Type System**
   - First-class built-in types
   - Clear extension points
   - Better error messages

## Recommendation

**Don't force direct replacement.** Instead:

1. Keep old implementation working
2. Use new implementation as **reference** for incremental improvements
3. Add new features to new implementation first
4. Gradually migrate when confident

The old code works. The new code is cleaner but incomplete. Bridge the gap incrementally.

## Files Created

- `patterns-old.mjs` - Backup of working implementation
- `patterns-new.mjs` - Attempted new implementation (incomplete)
- `patterns.mjs` - Restored to old implementation

## Next Steps

1. Add comprehensive tests to old implementation
2. Document all expression types and built-ins
3. Create adapter layer for gradual migration
4. Or: Fix new implementation to handle all cases (more work)
