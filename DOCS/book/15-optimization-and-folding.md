# Chapter 15 — Optimization and Folding

## **15.1  Purpose**

Optimization in the k compiler is the process of simplifying functions without changing their meaning.
The goal is to make the generated code smaller, faster, and easier to verify.
Because k is purely functional and has no side effects, optimizations are safe whenever the simplified function is equivalent to the original one.

This chapter describes a few basic optimizations that follow directly from the semantics introduced earlier.

---

## **15.2  Constant folding**

A **constant** is a function that ignores its input and always produces the same value.
If a composition of functions can be evaluated entirely at compile time, it can be replaced by a single constant function.

Example:

```
true_bool  = {{ } true} $bool;
not_true   = (true_bool neg);
```

The compiler observes that `(true_bool neg)` always yields `false_bool`, so it replaces it with a constant:

```
not_true = {{ } false} $bool;
```

Constant folding removes unnecessary runtime computation.

---

## **15.3  Type-based simplifications**

Since type expressions act as identity functions defined only on specific values, they can be eliminated when redundant:

```
$bool $bool f   →  $bool f
```

If a function’s input or output type is already known from context, repeated checks can be omitted.
The compiler ensures that at least one valid check remains to preserve correctness.

---

## **15.4  Inlining**

Inlining replaces a call to a small function by its body.
It avoids the overhead of a function call and often exposes further simplifications.

Example:

```
id = ();
f  = (id g);
```

Because `id` is the identity function, `(id g)` is equivalent to `g`.
Inlining removes the useless call.

For larger functions, inlining is applied selectively—only when it shortens the resulting code or eliminates intermediate values.

---

## **15.5  Dead-branch elimination**

In a union composition `<f, g>`, if type analysis shows that the input type can only satisfy the first branch, the second branch can never be defined and is removed.

Example:

```
$bool = < {} true, {} false >;
f = $bool < .true {{ } false} >;
```

Here, since `$bool` restricts the input to only the two variants `true` and `false`, and the second variant `.false` is not handled, the compiler infers that `f` is undefined for `.false` and simplifies the code accordingly.

Dead-branch elimination keeps the generated control flow minimal.

---

## **15.6  Common subexpression elimination**

If the same partial function is applied multiple times to the same input, the result will always be the same.
The compiler can compute it once and reuse the result.

Example:

```
{ .x .y, .x .z }
```

Both fields start with the projection `.x`.
The compiler computes `.x` once, stores the result, and reuses it for `.y` and `.z`.
This optimization reduces repeated traversal of the same input structure.

---

## **15.7  Canonical folding**

During evaluation, many values share identical subtrees.
A **folding pass** replaces identical subtrees by shared nodes, forming a minimal DAG (directed acyclic graph).

At compile time, folding may also apply to constant expressions.
If two constant subtrees are identical, they are merged and stored as a single global node.

This process ensures that structural equality corresponds to pointer equality: two values are identical if they share the same root node.

---

## **15.8  Function canonicalization**

Every function can be normalized by expanding all type aliases, inlining trivial definitions, and folding identical subfunctions.
The normalized form of a function depends only on its semantics, not on the way it was written.

A stable hash computed from this canonical representation serves as a permanent identifier for the function, just as type hashes identify canonical types.

This property is essential for the schema registry described in the next chapter.

---

## **15.9  Runtime simplifications**

At runtime, additional micro-optimizations are possible:

* **Arena reuse:** allocate nodes in a memory region that is cleared after each function call.
* **Hash-consing:** maintain a small table of recently created nodes to reuse identical ones automatically.
* **Shortcut constants:** return pointers to global constants instead of allocating new copies for unit or boolean values.

Such optimizations reduce memory usage without changing program behavior.

---

## **15.10  Equivalence and correctness**

Each optimization must preserve *semantic equivalence*: for every input, the optimized function must be defined for exactly the same values and must return the same result when defined.

Because k’s semantics are purely functional, equivalence can be tested mechanically by comparing evaluation results on all finite inputs of a small type, or by structural reasoning when types are infinite.

---

## **15.11  Summary**

* Optimization in k relies on algebraic properties of pure functions.
* Common transformations include constant folding, inlining, dead-branch elimination, and subexpression reuse.
* Folding shared subtrees yields compact DAG representations of values.
* Canonical function forms allow stable hashing and reproducible compilation results.
* All optimizations preserve exact semantic behavior.

---