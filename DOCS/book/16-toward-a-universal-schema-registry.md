# Chapter 16 — Toward a Universal Schema Registry

## **16.1  Motivation**

Every canonical type and function in k has a unique structural form and a stable hash.
These hashes can serve as global identifiers.
A registry that maps such identifiers to definitions allows programs and systems to exchange schemas and functions safely and reproducibly.

---

## **16.2  Basic structure**

A schema registry stores entries of two kinds:

| Kind         | Example content                                               |
| ------------ | ------------------------------------------------------------- |
| **Type**     | canonical automaton text for a type hash                      |
| **Function** | canonical IR or serialized representation for a function hash |

Each entry is immutable.
New versions are added as new hashes.

---

## **16.3  Key operations**

1. **Lookup by hash** — return the canonical definition.
2. **Lookup by shape** — search for functions with given input/output type hashes.
3. **Verification** — ensure that two parties share the same canonical form before exchanging values.

These operations can be implemented as simple key–value queries.

---

## **16.4  Example format**

A minimal JSON entry:

```json
{
  "hash": "C0ABCDEF",
  "kind": "type",
  "definition": "$C0=<C0\"0\",C0\"1\",C1\"_\">;$C1={};"
}
```

or for a function:

```json
{
  "hash": "F7B1A2",
  "kind": "function",
  "input": "C0ABCDEF",
  "output": "C9FFF1",
  "ir": "SEQ [PROJECT x, CONST true]"
}
```

---

## **16.5  Uses**

* Preventing schema mismatches in distributed systems.
* Deduplicating identical definitions across projects.
* Enabling reproducible builds where all types and functions are referenced by hash.

---

## **16.6  Summary**

* Canonical types and functions can be globally identified by stable hashes.
* A simple registry provides lookup and verification of these definitions.
* Such registries make k programs portable, self-describing, and safe to share between systems.

---