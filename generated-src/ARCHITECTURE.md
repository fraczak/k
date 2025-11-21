# Architecture Overview

## Design Principles

1. **Modularity** - Each file has a single, clear responsibility
2. **Immutability** - Patterns are cloned, not mutated (except via unification)
3. **Explicit State** - No hidden global state
4. **Clear Interfaces** - Well-defined inputs and outputs
5. **Error Transparency** - Errors include context (reason chains)

## Module Dependencies

```
index.mjs
  └─ TypeDerivation.mjs
      ├─ PatternGraph.mjs
      │   ├─ Pattern.mjs
      │   ├─ UnionFind.mjs
      │   └─ Unification.mjs
      │       └─ Pattern.mjs
      ├─ LocalRules.mjs
      │   └─ Pattern.mjs
      └─ GraphUtils.mjs
```

## Data Flow

```
Program (AST)
    ↓
TypeDerivation.initialize()
    ↓
RelDef { graph, varRefs, def }
    ↓
TypeDerivation.analyzeDependencies()
    ↓
SCCs (topologically sorted)
    ↓
TypeDerivation.iterateToFixedPoint()
    ↓
    ├─ Clone referenced patterns
    ├─ Unify with local patterns
    └─ Check convergence
    ↓
Annotated Program
```

## Key Algorithms

### Unification (Unification.mjs)

```
unifyTwo(p1, p2):
  1. Check if both are types → verify equality
  2. Check if one is type → verify compatibility
  3. Handle open + open → merge fields
  4. Handle open + closed → check subset, close
  5. Handle closed + closed → check equality
  6. Throw error if incompatible
```

### Pattern Graph Unification (PatternGraph.mjs)

```
graph.unify(reason, ...ids):
  1. Find representatives
  2. Get patterns with edge fields
  3. Compute unified pattern
  4. Create new representative
  5. Migrate edges from old reps
  6. Recursively unify edge destinations
```

### Fixed-Point Iteration (TypeDerivation.mjs)

```
For each SCC (bottom-up):
  repeat (max 10 times):
    For each relation in SCC:
      For each variable reference:
        1. Clone target's patterns
        2. Unify with local patterns
    
    If serialization unchanged:
      break
```

## Complexity Analysis

### Time Complexity

- **Initialization**: O(N) where N = AST size
- **SCC computation**: O(V + E) where V = relations, E = references
- **Fixed-point iteration**: O(I × R × U) where:
  - I = iterations (≤ 10)
  - R = references per relation
  - U = unification cost (depends on graph size)
- **Total**: O(N + V + E + I × R × U)

### Space Complexity

- **Pattern nodes**: O(N) - one per AST node initially
- **Edges**: O(N × F) where F = average fields per pattern
- **UnionFind**: O(N) with path compression
- **Total**: O(N × F)

## Extension Points

### Adding New Expression Types

1. Add case to `LocalRules.mjs`
2. Define pattern initialization
3. Define unification constraints
4. Update `TypeDerivation.annotateExpression()`

### Adding New Pattern Types

1. Extend `Pattern.mjs` with new type
2. Add unification rules in `Unification.mjs`
3. Update serialization if needed

### Custom Code Registry

Implement interface:
```javascript
{
  get(typeName) {
    return { type: 'product'|'union', fields: {...} };
  }
}
```

## Testing Approach

### Unit Tests

- `Pattern.mjs`: Creation, cloning, field operations
- `UnionFind.mjs`: Find, union, path compression
- `Unification.mjs`: All pattern combinations (see spec table)
- `PatternGraph.mjs`: Node creation, edge management, unification
- `LocalRules.mjs`: Each expression type independently
- `GraphUtils.mjs`: SCC computation, topological sort

### Integration Tests

- Simple non-recursive functions
- Mutually recursive definitions
- Error cases (incompatible patterns)
- Large programs (performance)

### Property Tests

- Unification is commutative
- Unification is associative
- Find is idempotent
- Convergence is monotonic
