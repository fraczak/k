# Appendix B — Incorporating External Predefined Types and Functions
## **B.1  Purpose**

The k language is intentionally minimal.
Nevertheless, real systems often need to interact with data types and operations defined outside of k—for example, numeric values, text, or platform-specific constants.
This appendix explains how external predefined types and functions can be introduced into a k compiler without changing the language itself.

---

## **B.2  External types**

An **external type** is a canonical type that is *not* expressed through k's own product-and-union syntax but is known to the compiler through registration.

Each external type has:

| Field                 | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| **Name**              | symbolic name (e.g., `$int`, `$string`)                                      |
| **Hash**              | unique stable identifier, just like canonical types                          |
| **Runtime kind**      | how the value is stored in memory (pointer, immediate integer, etc.)         |
| **Adapter functions** | conversion between the external representation and the standard `KNode` tree |

Example registry entry:

```json
{
  "hash": "E001",
  "kind": "type",
  "external": true,
  "name": "$int",
  "runtime_kind": "primitive_i64"
}
```

The compiler treats such a type as an atomic node, represented internally as a single `KNode` with `arity = 0` but tagged as *external*.

---

## **B.3  External constructors**

External types may provide special constructors or constants.
For example, `$int` might include predefined constant functions:

```
zero  = {} $int;
one   = {} $int;
```

At compile time these appear as constant functions returning fixed external nodes provided by the runtime.

---

## **B.4  External functions**

External functions are partial functions implemented outside of k but declared inside a k program.
They have known input and output types, possibly external.

Declaration syntax:

```
extern add : $int $int → $int;
extern less : $int $int → $bool;
```

At compile time the compiler records the signature and associates it with a runtime symbol name such as `k_ext_add`.

When generating code, each external call becomes a standard function call following the ABI:

```llvm
declare %KOpt @k_ext_add(%KVal %a, %KVal %b)
```

The runtime library provides these implementations in a native language (C, C++, Rust, etc.).

---

## **B.5  Integration with canonical types**

External types are integrated into the canonical system as *leaf states*.
They can appear as components in products or unions just like built-in ones.

Example:

```
$point = { $int x, $int y };
```

Canonical form:

```
$C0 = { C1 "x", C1 "y" };
$C1 = external $int;
```

This allows normal serialization and type comparison; the external leaf is treated as opaque but identified by its hash.

---

## **B.6  Serialization and external values**

During serialization, an external node is encoded by:

1. Its type hash (to indicate which external kind it represents).
2. A binary blob produced by a runtime-supplied encoder for that type.

Deserialization reverses the process using the corresponding decoder.
All external codecs must be deterministic and version-stable to preserve canonical equality.

---

## **B.7  Example**

Suppose we introduce `$int` and external function `add`:

```
$pair_int = { $int a, $int b };
sum = { .a x, .b y } (add x y);
```

The compiler generates code that:

* projects fields `.a` and `.b`,
* passes them as `KVal` pointers to `@k_ext_add`,
* and returns the result as a new `$int` node.

All logic outside arithmetic remains standard k code.

---

## **B.8  Practical implementation**

In a Python prototype:

```python
EXTERNAL_TYPES = {
    "$int": {"hash": "E001", "kind": "external", "runtime_kind": "primitive_i64"}
}

EXTERNAL_FUNCS = {
    "add":  {"inputs": ["$int", "$int"], "output": "$int", "symbol": "k_ext_add"},
    "less": {"inputs": ["$int", "$int"], "output": "$bool", "symbol": "k_ext_less"}
}
```

During code generation, when a call refers to an external function, the compiler emits a call to the symbol given in the table.

---

## **B.9  Summary**

* External predefined types extend k without altering its core semantics.
* They are registered with hashes and treated as atomic nodes.
* External functions follow the same calling convention as normal ones.
* Serialization of external values uses type-specific codecs.
* This mechanism allows integration of native computations (numbers, strings, system data) while preserving the purity and determinism of the k language.
