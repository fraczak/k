# Type Derivation Algorithm

## 1. Overview

This algorithm infers type constraints for programs consisting of mutually recursive partial functions over algebraic data types (products and unions).

**Input:** AST of a `k` program, consisting of function definitions (expressions) - can be seen as a set of (recursive) equations.
**Output:** Annotated AST with type patterns (also called filters)

It is assumed that we have access (through APIs) to a universal "type registry", which provides us with unique (canonical) names for each type.

## 2. Patterns

A **pattern** represents a set of types:

| Notation | Meaning | Fields |
|----------|---------|--------|
| `(...)` | Open unknown | Any |
| `{...}` | Open product | At least specified |
| `<...>` | Open union | At least specified |
| `{}` | Closed product | Exactly specified |
| `<>` | Closed union | Exactly specified |
| `T` | Named type | From type definition |

**Fields:** Each pattern has associated field labels. For open patterns, additional fields may exist. For closed patterns, the field set is exact. 
Unknown-kind patterns have only the open form `(...)`; a closed filter must choose product `{...}`/`{}` or union `<...>`/`<>`.

A type pattern is a singleton pattern, i.e., only one type is captured by such a pattern.

## 3. Pattern Graph - a data structure used during type derivation

**Nodes:** Patterns organized in a "reps" (representatives) forest, similar to union-find. However, a union of two (or more) different trees always produces a new "rep" (root) node, joining the trees.
**Edges:** Labeled by field names, pointing to other patterns
**Representatives:** Root nodes (called reps) represent equivalence classes

**Operations:**

- `find(p)` - get representative of pattern `p`
- `unify(p₁, ..., pₙ)` - merge patterns into equivalence class, potentially adding a new rep (root); the rep gathers all edges of their children
- `clone(p₁, ..., pₙ)` - generate a copy of the pattern graph connected to the patterns
- `compact()` - discovers all singleton patterns and replaces them by "Named types"

## 4. Unification

`unify(p₁, ..., pₙ)` computes the least upper bound (most specific common pattern); it may add a new node (rep) into the reps forest; the operation does not modify any existing pattern node

**Rules:**

- **Open + Open:** Merge field sets, stay open
- **Open + Closed:** Check fields ⊆, become closed
- **Closed + Closed:** Check fields =, stay closed
- **Product ⊥ Union:** Error (incompatible)
- **Type T:** Unique (canonical name)

**Algorithm:**

```text
1. Find representatives of all patterns
2. If the set of reps is a singleton, return it as the result
3. Compute merged pattern descriptor
4. Create new representative node
5. Migrate edges from old representatives
6. Recursively unify edge destinations for each field name
```

## 5. Local Typing Rules

For each expression type, define input/output pattern constraints:

### Composition `(e₁ e₂ ... eₙ)`

```text
in((e₁ e₂ ... eₙ)) = in(e₁)
out(eᵢ) = in(eᵢ₊₁)  for i = 1..n-1
out((e₁ e₂ ... eₙ)) = out(eₙ)
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

### Variant constructor `|l`

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

### Function reference `f`

```text
in(f) = LOOKUP(in(f))
out(f) = LOOKUP(out(f))
```

Once the type derivation for the defining expression for `f` is done, the input and output patterns are stored and will be used.

### Type `$ T`

```text
in(T) = out(T) = pattern(T)
```

### Filter `? F`

```text
see patterns.filterToPattern(F)
```

Filter expression is a syntax for describing pattern graphs.

## 6. Global Algorithm

### Phase 1: Initialization

```text
For each function definition:
  1. Create empty pattern graph
  2. Traverse expression AST
  3. Create [input, output] pattern pair per node of the AST
  4. Apply local typing rules
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
    For each function `f` in SCC:
      1. Compact `f`'s pattern graph
      2. For each occurrence `o` of `g` in `f`, clone(in(g), out(g)) and unify input and output patterns of `o` with the corresponding cloned patterns
      
    If pattern graphs unchanged: break
```

## 7. Compaction

**Purpose:** Replace all pattern nodes by their reps and replace all singleton patterns by types.

**Algorithm:**

```text
1. Build a new graph only on reps (keep the mappings from pattern node to its rep)
2. Identify singleton patterns (closed patterns with no open ancestors)
3. Register singletons as named types and use them as type pattern nodes
```

## 8. Convergence

**Criterion:** Pattern graph structure unchanged between iterations

**Measured by:** 
1. Representative forest structure (parent pointers)
2. Edge sets for each representative
3. Pattern descriptors for each representative

**Algorithm:**
```text
For each function f in SCC:
  1. Serialize reps forest: {nodeId → parentId}
  2. Serialize edge structure: {repId → {label → [targetReps]}}
  3. Serialize pattern info: {repId → {pattern, fields, type}}
  4. Combine into canonical form

Converged = (current_state == previous_state)
```

**Guarantee:** Monotonic refinement + iteration bound ensures termination

## 9. Error Handling

**Unification errors:**

- Product vs Union
- Closed pattern field mismatch
- Two distinct type patterns (types with different canonical names) are always incompatible

**Other errors:**

- Undefined function reference
- Iteration limit exceeded

**Error reporting should include:**

- Source location
- Expression type
- Conflicting patterns
- Unification trace

## 10. Implementation Notes

- Use reps forest for performing and tracing unification
- Compact only at the end of an iteration to keep unification reasons for error messages
