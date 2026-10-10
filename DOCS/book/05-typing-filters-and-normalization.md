# Chapter 5 — Typing, Filters, and Normalization

## **5.1 Filters as partial identity functions**

Filters in `k` are introduced by `?` and appear wherever an expression is expected.
A filter behaves as a partial **identity** function: it returns its argument unchanged when the argument matches the pattern graph described by the filter, and it is undefined otherwise.
For example, `? < {} true, {} false >` is a partial identity: it returns its argument unchanged when the argument is a boolean variant, and it is undefined otherwise.

Beyond serving as runtime type guards, filters serve as inductive termination witnesses that allow type derivation for recursive relations to converge into finite-state automata.

---

## **5.2 Filters**

A **filter** is a syntactic form that denotes a *pattern graph* — a structural specification of types that share a common shape.

Filter expressions are introduced by `?` and can be:

- **Product filters** — `? { Filter1 field1, Filter2 field2 }`  
- **Union filters** — `? < Filter1 tag1, Filter2 tag2 >`
- **Any-pattern filter** — `? ( ... )`
- **Filter variables** — `? X` (local metavariables representing pattern graph nodes)
- **Filter bindings** — `? < X f, (...) = Y g, ... > = X`

Filters may contain `...` to indicate that additional fields or tags are allowed:
`? { Filter1 field1, ... }` matches any product with at least `field1`.

The filter `? (...)` matches any pattern.
The filter `? {...}` matches any product pattern.
The filter `? <...>` matches any union pattern.
There is no closed unknown filter: use `?{}` for the empty product or `?<>` for the empty union.

---

## **5.3 Examples of filters**

- `?(...)` — represents any type.
- `?< (...) f, (...) g >` — represents all union types having exactly two variants `f` and `g`.
- `?{ X f, X g }` — represents all product types with two fields `f` and `g`, both of the same type.

A filter constrains where a partial function is defined; it does not affect the operational behavior of the function once defined.

---

## **5.4 Recursive filters**

Filters may be recursive.
They can describe families of recursive types by defining a metavariable in terms of a filter that references it.

Example (list definition):

```k-lang
?< {} nil, {X car, Y cdr} cons > = Y
```

This filter states that `Y` is a union type with two variants: `nil` and `cons`.

- The `nil` variant holds an empty product `{}`.
- The `cons` variant is a product with two fields: `car` of some type `X`, and `cdr` of type `Y` itself.

This recursive structure defines a linked list where each element has a `car` (the value) and a `cdr` (the rest of the list).
It thus denotes lists of elements of type `X`.

---

## **5.5 Type variables and scope**

A type variable (an identifier, typically starting with an uppercase letter) introduced in a filter is visible within the enclosing function definition.
For example:

```k-lang
car = ?< {} nil, {X car, Y cdr} cons > = Y /cons .car ?X;
```

Here:

- `X` and `Y` are type variables.
- The filter `?<{}nil,{X car,Y cdr}cons>=Y` constrains the function `car` to be defined only on types that match the recursive list structure.
- The expression `/cons` selects the `cons` variant of the union.
- The expression `.car` accesses the `car` field of a `cons` variant.
- The final filter `?X` asserts that the result of the field access is of type `X`, the type of the list's elements.

---

## **5.6 Type inference and normalization**

Every `k` program can be analyzed to assign an input and an output filter to every sub-expression. This process is called type inference and normalization.

Type inference and normalization proceed as follows:

1. Build a graph of all type references appearing explicitly and implicitly in the program.
2. Annotate each expression node with a pair of (input filter, output filter).
3. Replace filters that match a single, concrete type with that type expression, adding any newly discovered types to the graph.
4. Repeat until a fixed point is reached and no more changes occur.
5. Compute canonical forms for all newly introduced types.

---

## **5.7 Summary**

- Type expressions act as identity functions defined on values of that type.
- Filters describe sets of types and can constrain where a function is defined.
- Filters may be products, unions, or the unconstrained any-type form, and can be recursive.
- Variables in filters have definition-level scope.
- Normalization computes explicit input/output filters for every expression.
- Filters are used in the normalization and type checking process. They are ignored at runtime.

---
