# Named Patterns and Parameterized Type Schemes in k

## 1. Overview and Motivation

Following commit `a4eec258`, type code expressions (`$ code`) were
removed in favor of pure filter relations (`? <...> = Self;`).
While this eliminated the redundant dual syntax of static codes versus
runtime filters, practical development (notably in `djson` variants and
standard libraries) revealed a major drawback: **loss of pattern
composition and reuse**.

Without named, reusable patterns:
- Monolithic structures (such as UTF-8 decoding and IEEE-754 bit
  partitions) had to be copy-pasted inline across dozens of files.
- Common algebraic shapes like linked lists, pairs, dictionaries, and
  tries could not be defined generically; each variant had to inline
  its own structural definition.
- Filter relations (`rel?(x)`) perform runtime filtering but cannot be
  used directly as structural type shapes inside other pattern
  definitions.

This document establishes the specification for **Named Patterns**:
parameterized, compositional regular tree grammar templates that re-enable
reusable type definitions with zero syntax bloat, guaranteed
termination, and full integration with k's graph-based type system.

---

## 2. The Core Model: Patterns as Open Directed Graphs

In k, all values, patterns, and type codes are directed graphs
representing regular tree languages. A named pattern definition:

```k
name[ P1, P2, ... Pn ] = pattern_graph;
```

defines an **open directed graph** with an explicit boundary interface.

### 2.1 The Three Classes of Variables

Within a pattern definition, every variable identifier falls into one
of three orthogonal categories:

1. **External Ports ($\forall$ / Parameters)**:
   Any variable listed in the header brackets `[ P1, ... Pn ]` is an
   **external port**. These represent open inputs to be supplied by the
   caller upon instantiation.

2. **Internal Variables ($\exists$ / Unification Nodes)**:
   Any variable appearing on the right-hand side that is **not** listed
   in `[ P1, ... Pn ]` is an **internal variable**.
   - If an internal variable appears in multiple locations, it asserts
     **structural type equality (unification)** between those sites.
   - Internal variables are existentially quantified ($\exists$) and
     scoped strictly to the pattern definition.

3. **Cycle Knots ($\mu$ / Fixpoints)**:
   Any variable bound via `= KnotName` is an internal recursive knot.
   It creates a back-edge in the directed graph, closing a loop.
   Its scope is purely local: callers cannot see or reference it.

### 2.2 Knot and Variable Hiding ($\alpha$-Equivalence)

In:

```k
list[X] = < {}nil, { X car, Y cdr } cons > = Y;
```

- `X` is listed in `list[X]` $\implies$ **External Port**.
- `Y` is bound by `= Y` and omitted from `list[X]` $\implies$
  **Internal Knot**.

`Y` is strictly encapsulated. It can be $\alpha$-renamed to any
internal node ID (`#knot_0`) without changing the pattern's external
interface or behavior. Callers only interact with the port `X`.

---

## 3. The Four-Bracket Symmetry of k

Named patterns introduce square brackets `[...]` into k's grammar.
This completes an orthogonal four-bracket architecture where each
bracket style has a dedicated, non-overlapping semantic domain:

| Bracket Pair | Semantic Domain | Concrete Purpose |
| :--- | :--- | :--- |
| **`{ ... }`** | **Products** | Records, tuples, structs |
| **`< ... >`** | **Unions** | Variants, sums, choices |
| **`( ... )`** | **Relations** | Composition, grouping, identity |
| **`[ ... ]`** | **Patterns** | Type templates, instantiations |

No dollar prefix (`$`) is needed anywhere in the language.

### 3.1 Unambiguous Lexical Distinction

Because all pattern references carry `[...]`, the lexical distinction
between variables and patterns is 100% deterministic:

- **Identifier without `[...]`** (`X`, `T`, `car`, `Y`):
  - In label position: field or variant tag (`car`, `cdr`, `nil`).
  - In pattern position: variable node (`X`, `T`, knot `Y`).
- **Identifier with `[...]`** (`bit[]`, `list[T]`, `pair[A, B]`):
  - Always a pattern template lookup or instantiation.

---

## 4. Internal Variables as Unification Knots

A critical insight of k's graph-based model is that unparameterized
patterns can contain internal variables to express equality
constraints across fields:

```k
byte[] = { bit 0, bit 1, ... };
```

Here:
- `bit` does not have `[]`, so it is a **variable**, not a pattern.
- `bit` is not in the parameter list `byte[]`, so it is an **internal
  node**.
- Because `bit` appears at both field `0` and field `1`, it asserts
  that **field `0` and field `1` must share the exact same type**,
  without constraining what that type must be.

### 4.1 Comparison of Pattern Declarations

```k
-- 1. Homogeneous pair of two fields of the SAME arbitrary type:
same_pair[] = { T first, T second };

-- 2. Heterogeneous pair parameterized by the caller:
pair[A, B] = { A first, B second };

-- 3. Pair of concrete bits:
bit_pair[] = { bit[] first, bit[] second };

-- 4. Instantiation enforcing equality via shared variable:
diagonal_pair[] = pair[T, T];
```

In `diagonal_pair[] = pair[T, T]`:
- `T` is an internal variable.
- Instantiating `pair` with `T` for both arguments unifies both ports,
  producing a closed pattern requiring equal elements.

---

## 5. Instantiation Semantics (Option B)

Arguments inside `[...]` may be either **variables** or **patterns**:

1. **Passing a Variable (`T`, `X`)**:
   Connects the template's input port directly to that existing node in
   the pattern graph, enabling node sharing, unification, and
   polymorphic relations.

2. **Passing an Inline Pattern (`int[]`, `pair[K, V]`, `<{}0, {}1>`)**:
   Creates an anonymous node representing the pattern and connects the
   input port to it.

### 5.1 Equivalence to Variable Binding

Passing an inline pattern `P` is semantically equivalent to introducing
a fresh internal node variable:

$$name[P] \;\;\Longleftrightarrow\;\; (P = \_anon) \; name[\_anon]$$

Both forms construct isomorphic graph structures that minimize to the
exact same canonical DFA representation in `codes.mjs`.

### 5.2 Single-Step Finite Graph Substitution

Because recursive cycles are closed internally via knots (`= Y`),
instantiating a template does **not** require recursive unrolling or
fixpoint searching.

Instantiation is a single-step graph substitution:
1. Copy the template's graph structure (fresh private IDs for internal
   knots).
2. Substitute the caller's arguments into the designated open port nodes.
3. Minimize via Hopcroft/Moore DFA partition refinement in `codes.mjs`.

---

## 6. Safety Invariants and Termination

To guarantee decidability and termination:

1. **Acyclic Template Dependency Rule**:
   A pattern template `$ name[...]` cannot reference `name` in its own
   definition.
   - All recursion **must** be expressed through internal knots (`= Y`).
   - Consequently, the template dependency graph is a Strictly Acyclic
     Directed Graph (DAG).
   - Non-regular polymorphic recursion (nested datatypes) is structurally
     impossible, guaranteeing that every instantiated pattern is a
     finite regular tree automaton.

2. **Lexical Scope Independence**:
   Internal variable names and knot names are strictly private to each
   definition. Two patterns may both use knot name `Y` or variable `T`
   without collision.

3. **Canonical Confluence**:
   In k, type codes are structural, not nominal. Any two instantiations
   that yield isomorphic regular tree automata produce identical
   canonical hashes and wire encoders.

---

## 7. Concrete Library Examples

### 7.1 Core Data Types

```k
-- Canonical bit and bit-path numbers:
bit[]  = < {}0, {}1 >;
bits[] = < {} _, B 0, B 1 > = B;

-- Byte as an 8-bit octet product:
byte[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6, bit[] 7
};

-- 7-bit ASCII code points:
ascii[] = {
  bit[] 6, bit[] 5, bit[] 4, bit[] 3,
  bit[] 2, bit[] 1, bit[] 0
};
```

### 7.2 Generic Data Structures

```k
-- Generic pair:
pair[A, B] = { A fst, B snd };

-- Generic singly-linked list:
list[X] = < {}nil, { X car, Y cdr } cons > = Y;

-- Generic dictionary:
dict[K, V] = list[pair[K, V]];

-- Generic binary tree with internal knot T:
tree[X] = < {}nil, { X val, T left, T right } node > = T;
```

### 7.3 Usage in Relations

```k
-- Type guard filter:
int? = ? int[];

-- Polymorphic list destructuring with type unification:
head = ? { X car, list[X] cdr } X;

-- Concrete typed list destructuring:
sum = ? { int[] = T car, list[T] cdr } ...;

-- Anonymous pattern matching:
validate_ints = ? list[int[]];
```

---

## 8. Summary of Grammar Extensions

### 8.1 Lexer Tokens

```
"["   return 'LB';
"]"   return 'RB';
```

### 8.2 Top-Level Definitions

```
defs
    : /* empty */
    | defs name eq comp sc
    | defs name lb pattern_params rb eq filter sc
    ;

pattern_params
    : /* empty */
    | non_empty_pattern_params
    ;

non_empty_pattern_params
    : name
    | non_empty_pattern_params comma name
    ;
```

### 8.3 Pattern References and Instantiations

```
filter_
    : lp dots rp
    | la labelled_filters ra
    | lc labelled_filters rc
    | name lb pattern_args rb
    ;

pattern_args
    : /* empty */
    | non_empty_pattern_args
    ;

non_empty_pattern_args
    : filter
    | non_empty_pattern_args comma filter
    ;
```
