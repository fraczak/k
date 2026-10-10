# Chapter 5 — Schemas, Filters, and Contracts

## **5.1 Filters as partial identity relations**

Filters in `k` are introduced by `?` and appear wherever an expression is expected.
A filter behaves as a partial **identity** relation: it returns its payload unchanged when the payload matches the schema described by the filter, and it is undefined otherwise.
For example, `? < {} true, {} false >` is a partial identity: it returns its payload unchanged when the payload is a boolean variant, and it is undefined otherwise.

Beyond serving as runtime guards, filters serve as **inductive termination witnesses** that allow contract derivation for recursive relations to converge into finite-state automata.

---

## **5.2 Filters and Schemas**

A **filter** is a syntactic form that denotes a *schema graph* — a structural specification of payloads that share a common shape.

Filter expressions are introduced by `?` and can be:

- **Product filters** — `? { Filter1 field1, Filter2 field2 }`  
- **Union filters** — `? < Filter1 tag1, Filter2 tag2 >`
- **Any-schema filter** — `? ( ... )`
- **Schema variables** — `? X` (local metavariables representing schema graph nodes)
- **Schema bindings** — `? < X f, (...) = Y g, ... > = X`

Filters may contain `...` to indicate that additional fields or tags are allowed:
`? { Filter1 field1, ... }` matches any product with at least `field1`.

The filter `? (...)` matches any schema.
The filter `? {...}` matches any product schema.
The filter `? <...>` matches any union schema.
There is no closed unknown filter: use `?{}` for the empty product or `?<>` for the empty union.

---

## **5.3 Examples of filters**

- `?(...)` — represents any schema.
- `?< (...) f, (...) g >` — represents all union schemas having exactly two variants `f` and `g`.
- `?{ X f, X g }` — represents all product schemas with two fields `f` and `g`, both of the same schema.

A filter constrains where a relation is defined; it does not alter the output payload once defined.

---

## **5.4 Recursive schemas and filters**

Filters may be recursive.
They can describe families of recursive schemas by defining a metavariable in terms of a filter that references it.

Example (list definition):

```k-lang
?< {} nil, {X car, Y cdr} cons > = Y
```

This filter states that `Y` is a union schema with two variants: `nil` and `cons`.

- The `nil` variant holds an empty product `{}`.
- The `cons` variant is a product with two fields: `car` of some schema `X`, and `cdr` of schema `Y` itself.

This recursive structure defines a linked list where each element has a `car` (the payload) and a `cdr` (the rest of the list).
It thus denotes lists of elements of schema `X`.

---

## **5.5 Schema variables and scope**

A schema variable (an identifier, typically starting with an uppercase letter) introduced in a filter is visible within the enclosing relation definition.
For example:

```k-lang
car = ?< {} nil, {X car, Y cdr} cons > = Y /cons .car ?X;
```

Here:

- `X` and `Y` are schema variables.
- The filter `?<{}nil,{X car,Y cdr}cons>=Y` constrains the relation `car` to be defined only on inputs that match the recursive list structure.
- The expression `/cons` asserts the `cons` variant of the union.
- The expression `.car` accesses the `car` field of a `cons` variant.
- The final filter `?X` asserts that the result of the field access is of schema `X`, the schema of the list's elements.

---

## **5.6 Contract derivation and normalization**

Every `k` relation is analyzed by the compiler to derive its **contract**: a connected $(input, output)$ schema graph with shared vertices ($=X$) proving that input substructures are preserved through to the output.

Contract derivation and normalization proceed as follows:

1. Build a schema graph from explicit filters and primitive operations (projections, constructors, products).
2. Propagate schemas forward and backward through compositions, products, and choices.
3. Validate inductive convergence for recursive relations using filter witnesses.
4. Replace filters that match a single, concrete schema with that closed schema, adding any newly discovered schemas to the registry.
5. Repeat until a fixed point is reached.
6. Compute canonical forms and content-addressed hashes for all discovered schemas.

---

## **5.7 Summary**

- Filter expressions act as partial identity relations defined on payloads conforming to a schema.
- Filters describe schema constraints and inductive termination witnesses for recursive relations.
- Filters may be products, unions, or the unconstrained any-schema form, and can be recursive.
- Variables in filters have definition-level scope.
- Contract derivation computes an interconnected $(input, output)$ schema graph for every relation.
- The canonical form of a schema provides a universal content-addressable identity in the schema registry.

---
