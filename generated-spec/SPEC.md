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

**Nodes:** Patterns organized in a reps (representatives) forest, similar to union-find however a union of two (or more) trees always produces a new rep root node, joining the trees  
**Edges:** Labeled by field names, pointing to other patterns  
**Representatives:** Root nodes (called reps) represent equivalence classes

**Operations:**

- `find(p)` - get representative of pattern `p`
- `unify(p₁, ..., pₙ)` - merge patterns into equivalence class, potentailly adding a new rep
- `clone(patterns, target)` - copy subgraph to another graph

## 4. Unification

`unify(p₁, ..., pₙ)` computes the least upper bound (most specific common pattern); it may add new nodes (reps) into the find-union tree w/o modifying any existing pattern node.

**Rules:**

- **Open + Open:** Merge field sets, stay open
- **Open + Closed:** Check fields ⊆, become closed
- **Closed + Closed:** Check fields =, stay closed
- **Product ⊥ Union:** Error (incompatible)
- **Type T:** Unique (canonical name)

**Algorithm:**

```text
1. Find representatives of all patterns
2. Compute merged pattern descriptor
3. Create new representative node
4. Migrate edges from old representatives
5. Recursively unify edge destinations
```

Special care has to be done if the resuting pattern is a type, since type edges
are not explicitely represented in the pattern Graph (maybe they should?).

## 5. Local Typing Rules

For each expression type, define input/output pattern constraints:

### Composition `e₁ e₂ ... eₙ`

```text
in(e₁ e₂ ... eₙ) = in(e₁)
out(eᵢ) = in(eᵢ₊₁)  for i = 1..n-1
out(e₁ e₂ ... eₙ) = out(eₙ)
```

In case when `n=0`, identity, `()`

```text
in(()) = out(())
```

### Product `{e₁ l₁, ..., eₙ lₙ}`

```text
in(e₁) = ... = in(eₙ) = in({e₁ l₁, ..., eₙ lₙ})
out({e₁ l₁, ..., eₙ lₙ}) = {} with edges lᵢ → out(eᵢ)
```

### Variant `|l`

```text
out(|l) = <...> with edge l → in(|l)
```

### Union `<e₁, ..., eₙ>`

```text
in(e₁) = ... = in(eₙ) = in(<e₁, ..., eₙ>)
out(e₁) = ... = out(eₙ) = out(<e₁, ..., eₙ>)
```

### Projection

#### Dot `.l`

```text
in(.l) = {...} with edge l → out(.l)
```

#### Div `/t`

```text
in(/t) = <...> with edge t → out(/t)
```

### Variable `x`

```text
Clone definition patterns of x
Unify with local patterns
```

### Type `$ T`

```text
in(T) = out(T) = T
```

### Filter `? F`

```text
see patterns.filterToPattern(F)
```

## 6. Global Algorithm

### Phase 1: Initialization

```text
For each function definition:
  1. Create empty pattern graph
  2. Traverse expression AST
  3. Create [input, output] pattern pair per node
  4. Apply local typing rules
  5. Collect variable references
```

### Phase 2: Dependency Analysis

```text
1. Build dependency graph (function → referenced functions)
2. Compute strongly connected components (SCCs)
3. Topologically sort SCCs (bottom-up)
```

### Phase 3: Fixed-Point Iteration

```text
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

## 7. Compression

**Purpose:** replace all pattern nodes by their reps and replace all singleton patterns by types.

**Algorithm:**

```text
1. Build a new graph only on reps (keep the mappings from pattern node to its rep)
2. Identify singleton patterns (closed, no open ancestors)
3. Register singletons as named types and use them as type pattern nodes
```

## 8. Convergence

**Criterion:** Pattern graph structure unchanged between iterations

**Measured by:** Serialization of all [input, output] patterns

**Guarantee:** Monotonic refinement + iteration bound ensures termination

## 9. Error Handling

**Unification errors:**

- Product vs Union
- Closed pattern field mismatch
- Two distinct type patterns are always incompatible

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

- Use reps forest for organizing equivalence classes
- Compress only at the end of an iteration to keep unification reasons for error messages
