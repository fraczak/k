# Chapter 1 — Introduction

## **1.1  The purpose of this book**

This book describes a small programming language called **k**.
It is meant to show how data can be represented and transformed in a uniform, precise way.

---

## **1.2 Data as trees**

All information in `k` is treated as a **tree**.
A tree has:

* a single root,
* labeled edges (field names or tags),
* and possibly subtrees.

Both JSON objects and XML documents are trees in this sense.
Every `k` value is such a finite labeled tree.

---

## **1.3 Functions that may fail**

In ordinary mathematics a function always returns a result.
In `k`, a function may be **undefined** for some inputs.
For example, asking for the field `age` in a record that has no `age` is undefined.

We call such mappings **partial functions**.

---

## **1.4 Simplicity over features**

`k` avoids most traditional language constructs: no *variables*, no *loops*, and no *control flow keywords*.
In `k`, programs are built from:

1. **schemas** (finite tree automata describing acceptable tree payloads), and
2. **relations** (partial mappings that transform one tree into another).

Schemas and transformations share the exact same syntax: a schema definition is simply a relation acting as a partial identity.

The language also provides **filters** (`?schema`). Syntactically, a filter acts as a partial identity relation on payloads conforming to the schema. Semantically, filters act as **inductive termination witnesses** during contract derivation for recursive relations, while also enabling polymorphic generic programming.

When analyzing a relation, the compiler derives its **contract**: a connected $(input, output)$ schema graph where shared vertices ($=X$) prove structure preservation from input through to output.

---
