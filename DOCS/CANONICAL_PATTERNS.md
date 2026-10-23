# Content-Addressable Canonical Patterns and Parameter Aliasing

## 1. Overview and Core Philosophy

In k, all relations, codes, and patterns are **content-addressable**.
A human-readable name assigned to a pattern template (such as
`list[X]` or `pair[A, B]`) is purely a lexical **alias** pointing to an
underlying, uniquely identified canonical pattern graph addressed by its
cryptographic hash `@hash`.

This document specifies:
1. How canonical patterns are derived and hashed from directed graphs.
2. How user-defined named patterns act as parameter routing aliases
   using wildcards `(...)` for unexposed internal holes.
3. Why the variable pointing to the root of a recursive pattern graph
   (and cycle knots in general) is an internal structural fixed-point
   and cannot be exposed as an external parameter.
4. How canonical patterns, aliases, and argument routing are persisted
   in object files (`.klib` and `.ko`).

---

## 2. Canonical Pattern Derivation: The Pure Linear Skeleton

When a pattern is compiled:
```k
p[X] = {X x, Y y, Y z};
```
the compiler evaluates the right-hand filter into a
**pure linear skeleton**.

### 2.1 Never Equalizing Pattern Leaves

In the pure skeleton model, two leaves of a pattern graph are **never
equalized** in the canonical template:
- Even if an author repeats an existential variable (like `Y` at fields
  `y` and `z`), or repeats a formal parameter (like `T` in
  `same_pair[T] = { T first, T second }`), the canonicalizer assigns an
  independent, distinct canonical port `X0, X1, X2, ...` to every open
  leaf slot.
- Any non-linear equality constraint between leaves is represented
  outside the canonical graph, in the **diagonalized argument vector** of
  the alias definition.

In the example `p[X] = {X x, Y y, Y z}`:
- Field `x` becomes canonical port `X0`.
- Field `y` becomes canonical port `X1`.
- Field `z` becomes canonical port `X2`.

The canonical pattern is the 3-port linear product:
```k
@PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X0, X1, X2] = {
  X0 x, X1 y, X2 z
};
```

Canonical patterns always take the full arity of all leaf positions
discovered in the pattern skeleton.

---

## 3. Named Patterns as Parameter Routing and Diagonalization Aliases

When an author defines an alias like:
```k
p[X] = {X x, Y y, Y z};
```
the definition `p[X]` does **not** create a separate canonical pattern
graph. Instead, it defines an alias that routes:
- The author's formal parameter `X` to slot `X0`.
- The shared existential variable `Y` to both slots `X1` and `X2`:

```k
p[X] = @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X, Y, Y];
```

When `p` is instantiated (e.g. `p[int]`), the template expansion engine:
1. Substitutes formal parameter `X` with caller argument `int`.
2. Renames internal existential variable `Y` to a unique fresh variable
   `_Y_np1` across all occurrences in the argument list:
   `@PScs...[int, _Y_np1, _Y_np1]`.
3. Expands the canonical template with those arguments, yielding:
   `{ int x, _Y_np1 y, _Y_np1 z }`.
4. The type derivation engine unifies the type of field `y` with the type
   of field `z` via the shared fresh variable `_Y_np1`.

Thus, existential equality constraints are preserved with full type-safety
at use-time, while enabling maximum structural template deduplication.

### 3.1 Canonical Pattern Sharing Across Diagonalizations and Permutations

Under this architecture, all variations over the same underlying product
or union structure share the **exact same canonical pattern graph and
content hash**:

#### Example 1: Pair Variations
```k
pair[A, B]         = { A first, B second };
same_pair[T]       = { T first, T second };
closed_same_pair[] = { T first, T second };
any_pair[]         = { (...) first, (...) second };
```
All four compile to the single canonical skeleton:
```k
@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[X0, X1] = {
  X0 first, X1 second
};
```

Their `:pats` alias representations reflect their respective parameter
routings and diagonalizations:
```text
> :pats
any_pair[] = @KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[(...),(...)]
closed_same_pair[] = @KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[T,T]
pair[A,B] = @KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[A,B]
same_pair[T] = @KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[T,T]
```

#### Example 2: Record `{ x, y }` Variations
```k
a[]      = { (...) x, (...) y };
b[X]     = { X x, (...) y };
c[X,Y]   = { X x, Y y };
d[Y,X]   = { X x, Y y };
diag_p[] = { X x, X y };
```
All five share `@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x`:
```text
> :pats
a[] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[(...),(...)]
b[X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,(...)]
c[X,Y] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,Y]
d[Y,X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,Y]
diag_p[] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,X]
```

---

## 4. Direct Usability of Canonical Patterns

Because the alias is just an abbreviation, canonical patterns can be used
everywhere relations and aliases can be used:

1. **Direct Inspection**:
   ```text
   > :pat @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR
   @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X0, X1, X2] = {
     X0 x, X1 y, X2 z
   };
   ```

2. **Direct Matching in Expressions**:
   Callers can instantiate canonical patterns directly by passing all
   canonical arguments:
   ```k
   { {} x, {} y, {} z } ? @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[
     {}, {}, {}
   ];
   ```

3. **Explicit Definition by Hash**:
   Canonical pattern definitions are accepted directly by the grammar:
   ```k
   @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X0, X1, X2] = {
     X0 x, X1 y, X2 z
   };
   ```

---

## 5. Alias Argument Generation Rules

For every canonical port `Xi` at path `P` in the canonical filter:
Let `t` be the token found at path `P` in the author's filter.
The corresponding alias argument is determined by:
1. **Wildcard leaf**: If `t` is absent or an explicit `(...)` wildcard,
   the argument is `"(...)"`.
2. **Formal parameter**: If `t` is declared in `pattern_params`, the
   argument is `t` (e.g. `[T, T]` for diagonalized parameter `T`).
3. **Repeated existential variable**: If `t` is an internal variable
   appearing $> 1$ times in the filter, the argument is `t` (e.g. `[X, X]`
   or `[Z, Y, Y]`), preserving existential equality across fields.
4. **Single-occurrence internal variable**: If `t` is an internal variable
   appearing only once, it imposes no constraints and is normalized to
   `"(...)"`.

---

## 6. Why Knots (and Root Knots) Cannot Be Exposed as Parameters

Consider the recursive linked list pattern:
```k
list[X] = < {} nil, { X car, Y cdr } cons > = Y;
```

In this definition:
- `= Y` binds the variable `Y` to the root union node of the pattern
  graph.
- Inside the second variant `{ X car, Y cdr } cons`, the field `cdr`
  references `Y`.
- This creates a directed back-edge from `cdr` to the root union, forming
  a recursive cycle ($\mu$-fixpoint).

### 6.1 The Fundamental Distinction: Open Ports vs. Bound Knots

There is a fundamental semantic contradiction between **parameters** and
**knots**:

| Feature | Parameter (`[P]`) | Knot (`= KnotName`) |
| :--- | :--- | :--- |
| **Quantification** | Universal ($\forall$) | Fixed-point ($\mu$) |
| **Binding State** | **Unbound / Open Port** | **Bound / Node** |
| **Role** | Hole to fill by caller | Internal back-edge cycle |
| **Scope** | Caller interface | Purely internal topology |

- An **external parameter** is an open socket waiting for caller input.
- A **cycle knot** is an internal wire already soldered to a concrete
  node in the graph.

### 6.2 The Shadowing Hazard: Destruction of Recursion

What happens if an author attempts to expose the root knot `Y` as a
parameter?
```k
list[X, Y] = < {} nil, { X car, Y cdr } cons > = Y;  -- INVALID!
```

If this definition were permitted:
1. `Y` would appear in the formal parameter list `[X, Y]`.
2. When the template is instantiated (e.g. `list[int[], MyTail]`), the
   argument `MyTail` would substitute every occurrence of `Y` in the
   body.
3. Consequently, `{ X car, Y cdr }` would become
   `{ int[] car, MyTail cdr }`.
4. The back-edge to the root union would be severed!
5. The recursive cycle would be destroyed, silently corrupting the
   recursive list into a non-recursive pair
   `<{} nil, {int[] car, MyTail cdr} cons>`.

### 6.3 Enforced Invariant: Conflict Rejection at Parse Time

Because cycle knots represent bound internal topology, exposing a knot
name in `pattern_params` is a direct contradiction.

The compiler strictly enforces that no formal parameter name may
conflict with any knot identifier in the filter:

```k
list[X, Y] = < {} nil, { X car, Y cdr } cons > = Y;
-- Parse Error: Pattern parameter 'Y' in pattern 'list'
-- conflicts with knot 'Y'. Knot variables cannot be pattern parameters.
```

The root node of a pattern graph is matched against incoming data by the
runtime; it is never an open parameter port.

---

## 7. Reflection of Patterns in Object Files (`.klib` and `.ko`)

Ahead-of-time compiled libraries (`.klib`) and executables (`.ko`) store
patterns in their top-level object container (`format: "k-object"`).
Patterns are persisted across three coordinated structures:

### 7.1 `patternAlias` (Lexical Names to Content Hashes)

Maps human-readable pattern names to their canonical content hashes.
All aliases sharing the same linear skeleton point to the same hash:

```json
"patternAlias": {
  "pair":             "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm",
  "same_pair":        "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm",
  "closed_same_pair": "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm",
  "p":                "@PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR"
}
```

### 7.2 `patterns` (Deduplicated Canonical ASTs)

The `patterns` dictionary stores the canonical template definition under
its content hash `@hash`:
- **Deduplicated**: Even if a program defines multiple variations over a
  pair or record, the canonical template is stored exactly once under
  its `@hash`.
- **Linear Multi-Hole Functor**: Every leaf position is an independent
  canonical parameter (`X0, X1, ...`), with no leaves unified in the
  persisted filter AST.

```json
"patterns": {
  "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm": {
    "params": ["X0", "X1"],
    "filter": {
      "type": "product",
      "fields": {
        "first":  { "type": "name", "name": "X0", "open": true },
        "second": { "type": "name", "name": "X1", "open": true }
      }
    }
  }
}
```

### 7.3 `meta` (Provenance & `aliasArgs` Routing Vectors)

The `meta` dictionary maps each `@hash` to its canonical port list
and an `origins` array recording how every alias projects caller
parameters into the linear skeleton:

```json
"meta": {
  "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm": {
    "type": "pattern",
    "params": ["X0", "X1"],
    "origins": [
      {
        "name": "pair",
        "params": ["A", "B"],
        "aliasArgs": ["A", "B"],
        "compiledAt": "2026-10-23T19:38:29.691Z"
      },
      {
        "name": "same_pair",
        "params": ["T"],
        "aliasArgs": ["T", "T"],
        "compiledAt": "2026-10-23T19:38:29.691Z"
      },
      {
        "name": "closed_same_pair",
        "params": [],
        "aliasArgs": ["T", "T"],
        "compiledAt": "2026-10-23T19:38:29.691Z"
      }
    ]
  }
}
```

The `aliasArgs` vector:
1. Records **parameter diagonalization** (e.g. `["T", "T"]`), instructing
   the runtime to supply formal argument `T` to both canonical ports.
2. Preserves **existential constraints** (e.g. `["X", "Y", "Y"]`),
   ensuring `Y` is renamed to a shared fresh variable when instantiated.
3. Enables **lossless alias export**: when generating `--export` preambles
   or exporting `.klib` files, `buildExportPreamble` reads `origin.params`
   and `origin.aliasArgs` to recreate the exact source-level alias
   definitions.
