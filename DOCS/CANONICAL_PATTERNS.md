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

---

## 2. Canonical Pattern Derivation

When a pattern is compiled:
```k
p[X] = {X x, Y y, Y z};
```
the compiler evaluates the right-hand filter into a minimal directed
graph (regular tree automaton).

### 2.1 Full Variable Node Discovery

In the graph representation:
- `X` is an open port referenced at field `x`.
- `Y` is an existential variable shared between fields `y` and `z`,
  constraining them to identical subtrees.

The canonicalizer walks the minimal automaton in deterministic
breadth-first traversal order, assigning canonical variable names
`X0`, `X1`, `X2`, ... to each open variable node discovered in the
graph.

Crucially, **all** variable nodes present in the filter graph are
retained in the canonical pattern definition. In the example above:
- `X` becomes canonical port `X0`.
- `Y` becomes canonical port `X1`.

The resulting minimal canonical pattern graph produces a deterministic
content hash (e.g. `@A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P`).
The canonical pattern definition is therefore:

```k
@A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[X0, X1] = {
  X0 x, X1 y, X1 z
};
```

Canonical patterns always take the full arity of all variable nodes
discovered in the graph.

---

## 3. Named Patterns as Parameter Routing Aliases

When an author defines an alias like:
```k
p[X] = {X x, Y y, Y z};
```
the user only exposed `X` in the parameter list `[X]`, leaving `Y`
unexposed.

The definition `p[X]` does **not** create a separate pattern graph.
Instead, it defines an alias that instantiates the underlying canonical
pattern `@A6vr...`, routing the author's parameter `X` to slot `X0`, and
plugging unexposed slots (here `X1`) with the open wildcard `(...)`:

```k
p[X] = @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[X, (...)];
```

### 3.1 Canonical Pattern Sharing Across Permutations

Multiple alias definitions with different parameter exposures or
orderings over isomorphic filter graphs share the exact same canonical
hash:

```k
a[]    = {X x, Y y};
b[X]   = {X x, Y y};
c[X,Y] = {X x, Y y};
d[Y,X] = {X x, Y y};
```

All four patterns compile to the identical canonical graph:
`@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X0, X1] = {X0 x, X1 y};`

Inspecting the aliases with `:pats` shows how each alias projects its
arguments into the shared canonical template:

```text
> :pats
a[] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[(...),(...)]
b[X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,(...)]
c[X,Y] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,Y]
d[Y,X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,Y]
```

Notice:
- `a[]` exposes no parameters, so both canonical ports are `(...)`.
- `b[X]` exposes only `X` (slot `X0`), so slot `X1` is filled with
  `(...)`.
- `c[X,Y]` routes caller arguments `[X, Y]` to canonical slots `[X0, X1]`.
- `d[Y,X]` routes caller arguments `[Y, X]` to canonical slots `[X0, X1]`.

---

## 4. Direct Usability of Canonical Patterns

Because the alias is just an abbreviation, canonical patterns can be used
everywhere relations and aliases can be used:

1. **Direct Inspection**:
   ```text
   > :pat @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P
   @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[X0, X1] = {
     X0 x, X1 y, X1 z
   };
   ```

2. **Direct Matching in Expressions**:
   Callers can instantiate canonical patterns directly by passing all
   canonical arguments:
   ```k
   { {} x, {} y, {} z } ? @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[
     {}, {}
   ];
   ```

3. **Explicit Definition by Hash**:
   Canonical pattern definitions are accepted directly by the grammar:
   ```k
   @A6vrY7TP9s34tvNgVZsk7N5m4Cr4ZJERYPBevgmqnK7P[X, Y] = {
     X x, Y y, Y z
   };
   ```

---

## 5. Unrestricted Patterns `(...)` as Anonymous Canonical Ports

An unrestricted pattern `(...)` represents an open wildcard hole with no
type constraints. In the type pattern graph, an unrestricted pattern
`(...)` and an unbound variable `X` lower to the exact same node type:
`{ pattern: '(...)' }`.

The canonicalizer treats every unrestricted node in the graph as an open
variable port. Consequently:
- Writing `{(...) x, (...) y, (...) z}` produces the **exact same
  canonical pattern** as `{X x, Y y, Z z}`:
  ```k
  @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X0, X1, X2] = {
    X0 x, X1 y, X2 z
  };
  ```
- An alias definition like:
  ```k
  p[X] = {X x, (...) y};
  ```
  derives the generic canonical pattern for `{X x, Y y}`:
  ```k
  @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X0, X1] = {
    X0 x, X1 y
  };
  ```
  and defines the alias routing `X` to port `X0` and wildcard `(...)`
  to port `X1`:
  ```k
  p[X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X, (...)];
  ```

This guarantees maximal canonical sharing: whether a hole is written as
a named variable or an inline `(...)`, both share the identical underlying
canonical template.

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
