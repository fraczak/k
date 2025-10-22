# Chapter 3 — Types as Finite Automata

## **3.1 Motivation**

A type in k is a description of a set of finite labeled trees.
This set can be recognized by a finite tree automaton (FTA).
An FTA is similar in idea to a finite state machine for strings, but it accepts trees instead of words.

Representing types as automata gives each type a well-defined structure, independent of the names used in source code.
It also allows for canonical normal forms and for comparing types for equality by structure alone.

---

## **3.2 States and transitions**

Each type definition introduces one or more *states*.
Every product or union corresponds to a state with transitions labeled by field or variant names.

Example:

```
$ bool = < {} true, {} false >;
```

This produces two states:

```
C0 -> < C1 "true", C1 "false" >
C1 -> {}
```

Here `C0` is the main state of the type `$bool`.
`C1` represents the empty product `{}`, which is the leaf state.

---

## **3.3 Canonical form**

Different type expressions may describe the same automaton.
For example:

```
$pair = { bool x, bool y };
$pair' = { < {} true, {} false > x, < {} true, {} false > y };
```

Both are structurally equivalent.
Canonicalization removes names and renumbers states to obtain a single, stable representation.

The canonical form uses breadth-first traversal starting from the root state C0:
1. Number the root as C0
2. Visit all immediate neighbors of C0 and assign them consecutive numbers (C1, C2, ...)
3. Continue with the next unnumbered state in order
4. This produces a unique numbering for any finite directed graph

Formally, each canonical type is a set of rules of the form:

```
C_i  ->  < C_j "label", … >   (for unions)
C_i  ->  { C_j "label", … }   (for products)
```

States are numbered by breadth-first traversal, so C0 is always the root.

---

## **3.4 Examples**

For the unary natural numbers:

```
$ bnat = < bnat 0, bnat 1, {} _ >;
```

the canonical form is:

```
$C0 = < C0 "0", C0 "1", C1 "_" >;
$C1 = {};
```

The automaton has two states.
`C0` recognizes numbers composed of 0’s and 1’s ending in the unit state `C1`.
Each value of type `bnat` corresponds to a finite derivation in this grammar.

---

## **3.5 Normalization process**

When compiling a program:

1. Collect all types appearing in definitions.
2. Expand named types until only products and unions remain.
3. Eliminate duplicates by structural comparison.
4. Assign stable state numbers and produce canonical text.

This process is deterministic; the same type always produces the same canonical representation.

---

## **3.6 Hash-based naming**

To avoid name clashes, the compiler computes a hash of each canonical form.
The hash becomes the official type name:

```
$C0=<C0"0",C0"1",C1"_">;$C1={}
→  hash →  @BsAqRMv
```

Program objects can refer to types by hash without ambiguity.

---

## **3.7 Interpretation**

The canonical representation of a type is thus:

* a finite set of states `C0…Cn`,
* each state is a product or union,
* transitions labeled by strings (field or variant names).

Every value of the type is a finite tree accepted by this automaton.

---

## **3.8 Summary**

* Types in k denote finite labeled trees.
* Every type can be expressed as a finite tree automaton.
* Canonical form removes naming differences.
* The empty product becomes a terminal state.
* Hash-based names give each canonical type a unique identity.


---