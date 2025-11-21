# Type Derivation Implementation

Clean, modular JavaScript implementation of the type derivation algorithm based on the formal specification in `../generated-spec/`.

## Architecture

### Core Modules

1. **Pattern.mjs** - Pattern representation
   - Open/closed variants for unknown, product, union
   - Type references
   - Field management

2. **UnionFind.mjs** - Equivalence class management
   - Path compression for efficiency
   - Parent tracking for pattern forest

3. **PatternGraph.mjs** - Main graph structure
   - Node management via UnionFind
   - Labeled edges between patterns
   - Unification with recursive edge merging
   - Cloning for function inlining

4. **Unification.mjs** - Pattern unification logic
   - Complete rule table implementation
   - Error handling for incompatible patterns
   - Set operations for field management

5. **LocalRules.mjs** - Expression typing rules
   - One method per expression type
   - Constraint generation
   - Pattern initialization

6. **TypeDerivation.mjs** - Main algorithm
   - Initialization phase
   - Dependency analysis
   - Fixed-point iteration
   - Convergence detection

7. **GraphUtils.mjs** - Graph algorithms
   - Tarjan's SCC algorithm
   - Topological sorting

## Usage

```javascript
import { TypeDerivation } from './index.mjs';

// Define code registry (type definitions)
const codeRegistry = new Map([
  ['nat', { type: 'union', fields: { zero: '{}', succ: 'nat' } }],
  ['{}', { type: 'product', fields: {} }]
]);

// Define program (AST)
const program = {
  rels: {
    swap: {
      op: 'product',
      product: [
        { label: 'a', exp: { op: 'dot', dot: 'y' } },
        { label: 'b', exp: { op: 'dot', dot: 'x' } }
      ]
    }
  }
};

// Run type derivation
const derivation = new TypeDerivation(codeRegistry);
const result = derivation.derive(program);

// Access results
for (const [name, relDef] of result) {
  const [inId, outId] = relDef.def.patterns;
  const inPattern = relDef.graph.getPattern(relDef.graph.find(inId));
  const outPattern = relDef.graph.getPattern(relDef.graph.find(outId));
  console.log(`${name}: ${inPattern.type} -> ${outPattern.type}`);
}
```

## Key Improvements Over Original

1. **Separation of Concerns**
   - Each module has single responsibility
   - Clear interfaces between components
   - Easy to test and maintain

2. **Type Safety**
   - Explicit pattern types
   - Clear error messages
   - Validation at boundaries

3. **Pattern Identity**
   - Each pattern node is a distinct type variable
   - Patterns are only merged via explicit unification
   - Open unknown patterns `(...)` never auto-merge
   - Preserves type variable independence

4. **Performance**
   - Path compression in UnionFind
   - Efficient set operations
   - Minimal redundant work

4. **Readability**
   - Descriptive names
   - Clear control flow
   - Well-documented

5. **Extensibility**
   - Easy to add new expression types
   - Pluggable code registry
   - Modular unification rules

## Testing Strategy

```javascript
// Unit tests for each module
import { unifyTwo } from './Unification.mjs';
import { Pattern } from './Pattern.mjs';

// Test unification
const p1 = Pattern.openProduct(['x']);
const p2 = Pattern.openProduct(['y']);
const result = unifyTwo(p1, p2, 'test');
// result should be open-product with fields {x, y}
```

## Integration with Existing Code

To integrate with the current k implementation:

1. Parse expressions into the AST format expected by TypeDerivation
2. Convert code definitions to the codeRegistry format
3. Run derivation
4. Convert results back to current format

See `../patterns.mjs` for the original implementation to compare.
