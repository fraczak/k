# Chapter 14 — Canonical Serialization

## **14.1  Purpose**

Serialization is the process of converting a value in memory into a compact sequence of bits or bytes that can be stored or transmitted.
For the k language, serialization serves an additional goal: it defines a **canonical representation** of each value that is unique and independent of the machine on which it was produced.

A canonical encoding allows values to be compared, hashed, or stored in a registry in a reproducible way.
Two values that are structurally identical will always produce the same bit sequence.

---

## **14.2  Canonical type information**

Serialization always depends on the **canonical form of the type**.
A type in canonical form is a finite tree automaton (Chapter 3) that describes the structure of all its values.
Because this form is unique, every possible value of the type can be encoded deterministically.

Before any value is serialized, the compiler or runtime must know:

* the list of states (C0, C1, …),
* for each state, whether it is a product or a union,
* the number of possible transitions, and
* for unions, the order of their variants.

This information acts as the grammar from which all bit sequences are derived.

---

## **14.3  Encoding principle**

Each node in a value tree corresponds to one of the type’s states.

* **Product node** – emits no bits; the encoder simply serializes each child in canonical field order.
* **Union node** – emits a small binary code that identifies which variant is used, then serializes its single child.
* **Unit node** (empty product) – emits nothing; it has no children.
* **Empty union** – cannot be encoded because it has no possible values.

Thus, the sequence of bits records exactly which union branches were taken while descending the tree.

---

## **14.4  Fixed-length codes per state**

For simplicity, each union state uses fixed-length binary codes of equal size.

If a union has *m* variants, then

```
k = ceil(log2(m))
```

bits are needed.
Each variant is numbered in canonical order from 0 to m − 1 and represented by the binary form of its index.

Products and units use k = 0 and emit no bits.

This rule allows the decoder to know, from the type alone, how many bits to read at each step.

---

## **14.5  Example: natural numbers**

For the type

```
$bnat = < bnat 0, bnat 1, {} _ >;
```

the canonical form has three transitions from state C0.
Therefore, `k = ceil(log2(3)) = 2` bits are required per union node.

Assigning codes in order:

| Rule           | Code |
| -------------- | ---- |
| C0 → {C0 "0"}  | `00` |
| C0 → {C0 "1"}  | `01` |
| C0 → {C1 "_" } | `10` |

The value `{ {{ {} _ } 1 } 0 }` is encoded by concatenating the codes of the transitions chosen during a leftmost derivation:

```
00 → first C0
01 → next C0
10 → final C0
```

Resulting bit sequence: `000110`.

---

## **14.6  Decoding**

Decoding is deterministic and mirrors the encoding process:

1. Start at the root state (C0).
2. If the current state is a union, read k bits to choose a rule.
3. Create the corresponding node, then recursively decode its child or children.
4. For products, decode all children in order; for units, stop.

The decoder stops when the entire tree has been reconstructed and all bits have been consumed.

Because every union code is of fixed length, the decoding process requires no backtracking and can be implemented as a simple loop.

---

## **14.7  Folding repeated subtrees**

Many values contain repeated substructures.
To avoid serializing the same tree several times, identical subtrees can be *folded* into a **directed acyclic graph (DAG)** before encoding.

Each unique node is assigned an identifier.
When the encoder encounters a repeated node, it emits a reference to its identifier instead of encoding it again.

During decoding, the identifier is resolved to the corresponding subtree, reconstructing the shared structure.

Folding is optional; it saves space without changing the logical value.

---

## **14.8  Stream format**

A minimal canonical bitstream consists of:

1. **Header** – type hash (e.g., 8 bytes) identifying the canonical type.
2. **Node count** – integer *N* if DAG encoding is used.
3. **Encoded data** – concatenation of all fixed-length union codes and, if folded, node references.

If two systems share the same canonical type table, the bitstream alone is enough to reconstruct the original value.

---

## **14.9  Implementation sketch**

A compact encoder can be written as follows:

```
procedure encode(node):
    if node.arity == 0:
        return
    if node.arity == 1:
        write_bits(code_for(node.state, node.tag))
        encode(node.child[0])
    else:
        for each child in node.children:
            encode(child)
```

The corresponding decoder reverses the process.
Both procedures require only the canonical type tables and simple bit operations.

---

## **14.10  Determinism and equality**

Because encoding is fully determined by the canonical type and field order, two equal values always produce identical bit sequences.
Conversely, decoding the same bit sequence always yields the same tree.

This property allows equality comparison by direct byte comparison of serialized forms, without traversing the trees in memory.

---

## **14.11  Summary**

* Every type’s canonical automaton defines a unique bit-level grammar for its values.
* Products emit no bits; unions emit fixed-length variant codes.
* The number of bits required for each state depends only on the number of variants in that state.
* Optional DAG folding eliminates repeated subtrees.
* The resulting bitstream is compact, deterministic, and machine-independent.

---