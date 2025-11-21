# Type Derivation Algorithm - Formal Specification

## 1. Overview

This algorithm infers type constraints for programs consisting of mutually recursive partial functions over algebraic data types (products and unions).

**Input:** Program with function definitions (expressions)  
**Output:** Type pattern graph annotating each subexpression with input/output type constraints

## 2. Patterns

A **pattern** represents a set of types:

| Notation | Meaning | Fields |
|----------|---------|--------|
| `(...)` | Open unknown | Any |
| `{...}` | Open product | At least specified |
| `<...>` | Open union | At least specified |
| `()` | Closed unknown | Exactly specified |
| `{}` | Closed product | Exactly specified |
| `<>` | Closed union | Exactly specified |
| `T` | Named type | From type definition |

**Fields:** Each pattern has associated field labels. For open patterns, additional fields may exist. For closed patterns, the field set is exact.

## 3. Pattern Graph

**Nodes:** Patterns organized in a union-find forest  
**Edges:** Labeled by field names, pointing to other patterns  
**Representatives:** Root nodes represent equivalence classes

**Operations:**
- `find(p)` - get representative of pattern p
- `unify(p₁, ..., pₙ)` - merge patterns into equivalence class
- `clone(patterns, target)` - copy subgraph to another graph

## 4. Unification

`unify(p₁, ..., pₙ)` computes the least upper bound (most specific common pattern).

**Rules:**
- **Open + Open:** Merge field sets, stay open
- **Open + Closed:** Check fields ⊆, become closed
- **Closed + Closed:** Check fields =, stay closed
- **Product ⊥ Union:** Error (incompatible)
- **Type T:** Check structural compatibility

**Algorithm:**
```
1. Find representatives of all patterns
2. Compute merged pattern descriptor
3. Create new representative node
4. Migrate edges from old representatives
5. Recursively unify edge destinations
```

## 5. Local Typing Rules

For each expression type, define input/output pattern constraints:

### Composition `e₁ e₂ ... eₙ`
```
in(e₁ e₂ ... eₙ) = in(e₁)
out(eᵢ) = in(eᵢ₊₁)  for i = 1..n-1
out(e₁ e₂ ... eₙ) = out(eₙ)
```

### Product `{e₁ l₁, ..., eₙ lₙ}` (n ≥ 2)
```
in(e₁) = ... = in(eₙ) = in({...})
out({...}) = {} with edges lᵢ → out(eᵢ)
```

### Variant `{e l}` (n = 1)
```
in({e l}) = in(e)
out({e l}) = <...> with edge l → out(e)
```

### Union `<e₁, ..., eₙ>`
```
in(e₁) = ... = in(eₙ) = in(<...>)
out(e₁) = ... = out(eₙ) = out(<...>)
```

### Projection `.l`
```
in(.l) = (...) with edge l → out(.l)
out(.l) = fresh pattern
```

### Division `/t`
```
in(/t) = <...> with edge t → out(/t)
out(/t) = fresh pattern
```

### Identity `()`
```
in(()) = out(())
```

### Variable `x`
```
Clone definition patterns of x
Unify with local patterns
```

### Type literal `T`
```
in(T) = out(T) = T
```

## 6. Global Algorithm

### Phase 1: Initialization
```
For each function definition:
  1. Create empty pattern graph
  2. Traverse expression AST
  3. Create [input, output] pattern pair per node
  4. Apply local typing rules
  5. Collect variable references
```

### Phase 2: Dependency Analysis
```
1. Build dependency graph (function → referenced functions)
2. Compute strongly connected components (SCCs)
3. Topologically sort SCCs (bottom-up)
```

### Phase 3: Fixed-Point Iteration
```
For each SCC (in topological order):
  Repeat until convergence (max 10 iterations):
    For each function f in SCC:
      1. Compress f's pattern graph
      2. For each variable reference v in f:
         a. Clone v's input/output patterns into f's graph
         b. Unify cloned patterns with reference site patterns
      3. Compress again
    
    If pattern graphs unchanged: break
```

### Phase 4: Canonicalization
```
For each function:
  1. Serialize pattern graph
  2. Compute hash
  3. Assign canonical name
```

## 7. Compression

**Purpose:** Normalize and deduplicate patterns

**Algorithm:**
```
1. Clone entire graph
2. Identify singleton patterns (closed, no open ancestors)
3. Register singletons as named types
4. Group patterns by type:
   - Open patterns ((...), {...}, <...>) each in separate groups
   - Closed patterns ((), {}, <>) grouped together
   - Type patterns kept separate
5. Within each group, compute structural equivalence:
   - Patterns equivalent if same pattern type AND same edges to equivalent destinations
6. Merge structurally equivalent patterns within groups
7. Remap all pattern IDs
```

**Important:** Open unknown patterns `(...)` are NEVER merged with each other, even if they have identical edge structure. Each represents a potentially different type constraint. For example, 10 functions with `(...)` input/output patterns will have 20 distinct pattern nodes.

## 8. Convergence

**Criterion:** Pattern graph structure unchanged between iterations

**Measured by:** Serialization of all [input, output] patterns

**Guarantee:** Monotonic refinement + iteration bound ensures termination

## 9. Error Handling

**Unification errors:**
- Product vs Union
- Closed pattern field mismatch
- Type structural incompatibility

**Other errors:**
- Undefined variable reference
- Iteration limit exceeded

**Error reporting should include:**
- Source location
- Expression type
- Conflicting patterns
- Unification trace

## 10. Complexity

**Time:** O(N × I × U)
- N = AST size
- I = iterations per SCC (≤ 10)
- U = unification cost

**Space:** O(N × P)
- N = AST size
- P = patterns per node (small after compression)

## 11. Implementation Notes

- Use union-find for efficient equivalence classes
- Cache cloned subgraphs for repeated references
- Compress only when graph grows significantly
- Track unification reasons for error messages
- Serialize using canonical ordering for determinism
