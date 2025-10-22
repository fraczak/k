# Chapter 7 — The Partial Function ABI

## **7.1  Purpose**

The **application binary interface (ABI)** defines how partial functions in k are represented and invoked at runtime.
Its goal is to make all functions—whether user-defined or compiled—compatible with the same calling convention and data layout.

Every compiled k function receives a single argument (a value tree) and may either produce a result or remain undefined.
The ABI provides a uniform way to express both outcomes.

---

## **7.2  Function result representation**

The result of every function call is a pair of fields:

```
struct KOpt {
    bool ok;     // 1 if function is defined for the given input
    struct KNode* val;  // valid only if ok == true
};
```

If `ok == 1`, the function succeeded and `val` points to the root node of the resulting value.
If `ok == 0`, the function is undefined for the input, and `val` is meaningless.

This structure carries both the success flag and the value pointer, allowing partiality to be expressed directly in generated code.

---

## **7.3  Function parameter representation**

Each function takes exactly one parameter:

```
struct KNode* input;
```

The parameter points to the root of the input value.
Since all values are immutable, the function must not modify this structure.

---

## **7.4  Calling convention**

Every k function compiled to machine code follows this C-style signature:

```c
struct KOpt k_function(struct KNode* input);
```

The return value indicates success or failure.
The convention is uniform for all functions, regardless of the specific types involved.

---

## **7.5  Core runtime operations**

The runtime provides a small set of primitive functions implementing the fundamental operations of k:

| Operation                              | Purpose                       | Result                                            |
| -------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `k_project(input, label_id)`           | projection `.label`           | defined if the field or variant `label_id` exists |
| `k_make_product(state, children[], n)` | construct a product node      | always defined                                    |
| `k_make_union(state, tag, child)`      | construct a union node        | always defined                                    |
| `k_fail()`                             | represent undefined result    | returns `{ ok = 0 }`                              |
| `k_unit()`                             | return the constant unit node | returns `{ ok = 1, val = &unit_node }`            |

All user-defined functions can be compiled entirely in terms of these operations.

---

## **7.6  Metadata tables**

To interpret or construct nodes correctly, the runtime holds constant tables derived from canonical type definitions:

* `state_kind[state]` — `0` for product, `1` for union,
* `state_arity[state]` — number of child fields for products (always 1 for unions),
* `field_index[state][label_id]` — index of field in product (or `-1` if absent),
* `variant_index[state][label_id]` — index of variant in union (or `-1` if absent).

These tables are read-only and known at compile time for each canonical type.

---

## **7.7  Example: projection**

To implement the projection `.x`:

```c
struct KOpt k_project_x(struct KNode* input) {
    int state = input->state;
    int kind  = state_kind[state];

    if (kind == PRODUCT) {
        int idx = field_index[state]["x"];
        if (idx < 0 || idx >= input->arity)
            return (struct KOpt){0, NULL};
        return (struct KOpt){1, input->child[idx]};
    }

    if (kind == UNION) {
        int tag  = variant_index[state]["x"];
        if (tag < 0 || input->tag != tag)
            return (struct KOpt){0, NULL};
        return (struct KOpt){1, input->child[0]};
    }

    return (struct KOpt){0, NULL};
}
```

This code demonstrates the generic principle:
the projection is defined if and only if the input has a field or variant named `x`.

---

## **7.8  Error propagation**

When one function calls another, the success flag `ok` propagates forward.
If a subcall returns `ok == 0`, the caller must return `{0, NULL}` immediately.
This makes undefinedness explicit and local—no exceptions, no global flags.

---

## **7.9  Summary**

* Every function has the form `KOpt f(KNode*)`.
* Partiality is expressed by the `ok` flag.
* Runtime operations handle projection and construction.
* Metadata tables describe field positions and variant indices.
* By inspecting `arity`, `state`, and `tag`, the runtime can interpret any value correctly.
* This ABI ensures all generated and runtime functions can interoperate safely.

---