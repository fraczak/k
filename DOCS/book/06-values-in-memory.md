# Chapter 6 — Values in Memory

## **6.1  Trees as runtime objects**

At execution, every k value is represented as a finite labeled tree stored in memory.
Each node corresponds to one constructor of a product or union type.
Edges are labeled by field or variant names, and their order follows the canonical field order of the type.

Every node is immutable.
Evaluation of a k program creates new nodes but never modifies existing ones.

---

## **6.2  Uniform node layout**

All nodes share the same in-memory structure:

```
struct KNode {
    int  state;        // canonical type state (C0, C1,…)
    int  tag;          // variant index, −1 for product
    int  arity;        // number of children
    struct KNode* child[];  // array of pointers to children
};
```

The `state` identifies the canonical automaton state of the node.
The `tag` identifies the active variant when the node belongs to a union type;
for product and unit values, `tag = −1`.
The `arity` field determines the size of the `child[]` array - nodes are allocated with exactly `arity` child pointers.

---

## **6.3  Products and unions**

A node’s **arity** determines its structural kind:

* **arity = 0** — the empty product `{}` (unit);
* **arity > 1** — a product with that many fields;
* **arity = 1** — a union value.

Thus, by inspecting the number of children one can always distinguish product from union.
A union node has exactly one child—the value of its selected variant.
A product node has one child per field.
This rule holds for all types in k, including recursive ones.

---

## **6.4  Unit and empty union**

The empty product `{}` produces the single node with `arity = 0`.
It represents the unique value of the unit type.

The empty union `<>` has no possible nodes at all.
No value of that type can exist in memory.

---

## **6.5  Canonical folding (DAG representation)**

To avoid duplicate subtrees, identical substructures may be shared.
Each distinct combination of `(state, tag, child IDs)` appears once; all references point to that node.
The resulting structure is a **directed acyclic graph (DAG)** instead of a tree.
Two values are equal if and only if their root nodes are identical.

---

## **6.6  Allocation and immutability**

Nodes are allocated sequentially in an arena or shared pool.
Because they never change after creation, reference equality is safe for comparison and hashing.
Garbage collection is unnecessary if each evaluation allocates in a fresh arena released at the end.

---

## **6.7  Example**

For type:

```
$pair = { bool x, bool y };
$bool = < {} true, {} false >;
```

the value `{ true_bool x, false_bool y }` becomes:

```
pair-node (arity = 2, state=C0, tag=−1)
 ├─ child[0] → union-node(true)  (arity = 1, tag=0)
 │              └─ child[0] → unit-node (arity = 0)
 └─ child[1] → union-node(false) (arity = 1, tag=1)
                └─ child[0] → unit-node (arity = 0)
```

By inspecting each node’s `arity`, one can identify products (≥2 children) and unions (1 child).

---

## **6.8  Summary**

* Every value is a finite immutable tree (or DAG) of `KNode`s.
* Node fields: `state`, `tag`, `arity`, and `child[]`.
* A node with exactly one child is always a union value.
* `arity = 0` is the unit value; `arity > 1` indicates a product.
* Identical subtrees can be folded into shared nodes.
* The memory representation alone is sufficient to determine the kind of each value without consulting the type definition.

---