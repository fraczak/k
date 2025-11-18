# Chapter 2 — Syntax and Values

## **2.1 Language fragments**

The `k` language has only one kind of program element: a **definition**.
A program is a sequence of definitions of two kinds:

```k-lang
$ type_name = ...type_expression... ;
function_name = ...expression... ;
```

The definitions are followed in the file by the *main expression*; it represents the partial function defined by the program as a whole.

There is no special syntax for values.
Every syntactic form in an expression describes a **function** -- possibly a constant function that always returns the same value.

---

## **2.2 Types**

A type describes the possible **tree shapes** of values.
Types are formed from two constructors:

1. **Product**  – written `{ T₁ l₁, T₂ l₂, … }`
   represents records with fixed labeled fields.

2. **Union**  – written `< T₁ l₁, T₂ l₂, … >`
   represents a choice between labeled alternatives.

Both are finite and fully explicit.
Every type denotes a finite tree automaton whose accepted trees are the possible values of that type.

---

## **2.3 Special and limiting cases**

1. **Singleton equivalence**
   A product with one field, `{T x}`, is **equivalent** to the union `<T x>`.
   This equivalence only applies to singleton cases.
   With two or more labels, we always have: `{A x, B y, ...} ≢ <A x, B y, ...>`.

2. **Empty product**
   `{}` has no fields.
   It represents the type that admits exactly one value, called *unit*.
   There is nothing exceptional about the type and its value; it is simply the degenerate case of a product with zero fields.

3. **Empty union**
   `<>` has no variants.
   It represents a type with no possible values.

---

## **2.4 Projections**

**Dot** notation is used for extracting a value of a field of a record (product type value), as well as asserting and extractiong a variant value of a union type value.
For example, `. x` is a partial function extracting the value of field `x` of a record, or asserting that the value of a union type is actually the variant `x` and, if this is the case, returning the variant value.

---

## **2.5 Functions**

Expressions combine partial functions using three operators:

1. **Composition** `(f₁, f₂, …)` — sequential application.
2. **Union** `< f₁, f₂, … >` — try each in order, first defined wins.
3. **Product (parallel)** `{ f₁ l₁, f₂ l₂, … }` — apply all to the same input, succeed only if all succeed.

Parentheses around a composition may be omitted except for the empty composition `()` — the identity function.
Empty product, `{ }`, defines a constant function (ignoring its input) returing *unit*.

---

## **2.6 Example**

```k-lang
$ bool = < {} true, {} false >;
true_bool  = {{} true} $ bool;
false_bool = {{} false} $ bool;
neg = $ bool < .true false_bool, .false true_bool >;
```

This defines a two-variant union type and three functions: two constants and one transformation exchanging the variants.

---

## **2.7 Summary**

* All types describe tree shapes.
* `< T x >` and `{ T x }` are the same type.
* `{}` is the empty product (with one value, called *unit*).
* Values appear in expressions only as results of constant functions.
* There are no primitive literals, only algebraic data types.
* Functions, not values, are the only expressions in `k`.

---
