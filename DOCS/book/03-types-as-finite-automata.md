# Chapter 3 — Types as Finite Automata

## **3.1 Motivation**

A type in `k` is a description of a set of finite labeled trees.
This set can be recognized by a finite tree automaton (FTA).
Equivalently, type definition can be seen as a Context Free Grammar (CFG); the values of the type are derivation trees of the grammar.

The following recursive type definition of `list`:

```k-lang
$ bool = < {} true, {} false >;
$ list = < {} nil, { bool head, list tail } cons >;
```

can be seen as the following 4 rule grammar:

```bnf
1: <bool> ::= {} true             
2: <bool> ::= {} false
3: <list> ::= {} nil
4: <list> ::= { <bool> head, <list> tail } cons
```

The following derivation tree:

```derivation-tree
            <list>
               |
              (4)
               |
               V
  { <bool> head, <list> tail } cons
       |            |
      (1)          (3)
       |            |
       V            V
    {} true       {} nil
```

intuitively represents a list with one boolean value `true`.

Representing types as automata (or CFG) gives each type a well-defined structure, independent of the type names used in source code.
It also allows for canonical normal forms and for comparing types for equality by structure alone.

---

## **3.2 States and transitions**

Each type definition introduces one or more *states*.
Every product or union corresponds to a state with transitions labeled by field or variant names.

Example:

```k-lang
$ bool = < {} true, {} false >;
```

This produces two states:

```automata
C0 -- true  --> C1 
C0 -- false --> C1
C1 = {}
```

Here `C0` is the root state of the type `$bool`.
`C1` represents the empty product `{}`, which is the leaf state.

---

## **3.3 Canonical form**

Different type expressions may describe the same automaton.
For example:

```k-lang
$ bool = < {} false, {} true >;
$ pair = { bool x, bool y };
$ pair2 = { < {} true, {} false > x, bool y };
```

Both types, `pair` and `pair2`, are structurally equivalent.
Canonicalization removes names and renumbers states to obtain a single, stable representation.

The canonical form uses breadth-first traversal starting from the root state C0:

1. Number the root as C0
2. Visit all immediate neighbors of C0 and assign them consecutive numbers (C1, C2, ...)
3. Continue with the next unnumbered state in order
4. This produces a unique numbering for any finite directed graph

States are numbered by breadth-first traversal, so C0 is always the root.

---

## **3.4 Examples**

For binary natural numbers:

```k-lang
$ bnat = < bnat 0, bnat 1, {} _ >;
```

the canonical form is:

```k-lang
$C0 = < C0 "0", C0 "1", C1 "_" >;
$C1 = {};
```

The automaton has two states.
`C0` recognizes numbers composed of 0’s and 1’s ending in the unit state `C1`.
Each value of type `bnat` corresponds to a finite derivation in this grammar.

---

## **3.5 Normalization process**

When compiling a program:

1. Collect all types appearing in the definitions and the main expression.
2. Expand named types until only products and unions remain.
3. Eliminate duplicates by structural comparison.
4. Assign stable state numbers and produce canonical text.

This process is deterministic; the same type always produces the same canonical representation.

---

## **3.6 Hash-based naming**

To avoid name clashes, the compiler computes a hash of each canonical form.
The hash becomes the official type name:

```k-lang
$C0=<C0"0",C0"1",C1"_">;$C1={}
→  hash →  @BsAqRMv
```

Program objects can refer to types by hash without ambiguity (only canonical names start with `@`).

---

## **3.7 Interpretation**

The canonical representation of a type is thus:

* a finite set of states `C0…Cn`,
* each state is a product or union,
* transitions labeled by strings (field or variant names).

Every value of the type is a finite tree accepted by this automaton.

---

## **3.8 Summary**

* Types in k denote (rational) sets of finite labeled trees.
* Every type can be expressed as a finite tree automaton.
* Canonical form removes naming differences.
* Hash-based names give each canonical type a unique identity.

---
