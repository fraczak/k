# Chapter 5 — Typing, Filters, and Normalization

## **5.1 Types as functions**

A type expression in k can appear wherever a function is expected.
In this context it behaves as an **identity** function that is defined only for values of that type.
For example, `$bool` used as an expression is a partial identity: it returns its argument unchanged when the argument is of type `bool`, and it is undefined otherwise.

This convention eliminates any special syntax for annotating sub-expressions with types.
An expression may be *restricted* to a type simply by composing it with the corresponding type expression.

---

## **5.2 Filters**

A **filter** is a syntactic form that denotes a *class of types*—a set of types sharing some structure.
Filters generalize type expressions in the same way that regular expressions generalize specific strings.

Filter expressions are introduced by `?` and can be:

* **Type expressions** — `? $bool`, `? < {} x, bool y >`
* **Product filters** — `? { Filter1 field1, Filter2 field2 }`  
* **Union filters** — `? < Filter1 tag1, Filter2 tag2 >`
* **Product-or-union filters** — `? ( Filter1 label1, Filter2 label2 )`
* **Filter variables** — `? X` (meta-variables standing for unknown types)
* **Filter bindings** — `? < X f, (...) g, ... > = X`

Filters may contain `...` to indicate additional fields/tags are allowed:
`? { Filter1 field1, ... }` matches any product with at least field `field1`.

The filter `? (...)` matches any type.
The filter `? {...}` matches any product type.
The filter `? <...>` matches any union type.

---

## **5.3 Examples of filters**

* `?( … )` — represents any type.
* `?()` — represents an empty product or empty union.
* `?< ( … ) f, ( … ) g >` — represents all union types having exactly two variants `f` and `g`.
* `?{ X f, X g }` — represents all product types with two fields `f` and `g`, both of the same element type `X`.

A filter constrains where a partial function is defined; it does not affect the operational behavior of the function once defined.

---

## **5.4 Recursive filters**

Filters may be recursive.
They can describe families of recursive types by equating one meta-variable to a filter containing it.

Example (list definition):

```
?< {} nil, {X car, Y cdr} cons > = Y
```

This filter states that `Y` is any type satisfying:
either the empty product `{}` labeled `nil`, or a product with two fields `car` of type `X` and `cdr` of type `Y` labeled `cons`.
It thus denotes lists of `X`.

---

## **5.5 Meta-variables and scope**

A meta-variable introduced in a filter is visible within the enclosing function definition.
For example:

```
car = ?< {} nil, {X car, Y cdr} cons > = Y .car ?X;
```

Here:

* `X` and `Y` are filter variables.
* `car` is a function defined on all union types matching the filter, i.e., any type that has a variant `cons` with field `car` of type `X` and field `cdr` of type `Y`.
* The expression `.car ?X` projects the `car` field and restricts its result to type `X`.

---

## **5.6 Type inference and normalization**

Every k program can be analyzed to assign an input and output type (or filter) to every sub-expression.

Normalization proceeds as follows:

1. Build a graph of all type references appearing in the program.
2. Annotate each expression node with a pair (input filter, output filter).
3. Replace singleton filters by their equivalent types and add resulting types to the graph.
4. Repeat until no change occurs.
5. Compute canonical automata for all newly introduced types.

After normalization, every expression has fully determined input and output types, and all references are to canonicalized forms.

---

## **5.7 Summary**

* Type expressions act as identity functions defined on values of that type.
* Filters describe sets of types and can constrain where a function is defined.
* Filters may be products, unions, or product-or-union forms, and can be recursive.
* Meta-variables in filters have function-level scope.
* Normalization computes explicit input/output types for every expression, producing a fully typed program.

---