# Chapter 2 — Syntax and Values

## **2.1 Language fragments**

The `k` language has only one kind of program element: a **definition**.
A program is a sequence of definitions of two kinds:

```k-lang
$ type_name = ...type_expression... ;
function_name = ...expression... ;
```

The definitions are followed in the file by the *main expression*; it represents the partial function defined by the program as a whole.

There is no syntax for values.
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

1. **Empty product**
   `{}` has no fields.
   It represents the type that admits exactly one value, called *unit*.
   There is nothing exceptional about the type and its value; it is simply the degenerate case of a product with zero fields.

2. **Empty union**
   `<>` has no variants.
   It represents a type with no possible values.

---

## **2.4 Projections**

**Dot** notation, e.g., `. field_name`, is used for extracting the value of a field from a record (product type value).
**Div** notation, e.g., `/ variant_name`, is used for asserting a particular variant of a union and extracting its value.
Product type `{ T₁ l₁, T₂ l₂, … , Tₙ lₙ }` naturally defines `n` partial functions: `.l₁, .l₂, … , .lₙ`,  
and union type `< T₁ l₁, T₂ l₂, … , Tₙ lₙ >` naturally defines `n` partial functions `/l₁, /l₂, … , /lₙ`.
Those partial functions are called **projections** and they constitute the basis for the definition
of all other partial functions in the `k` language.

---

## **2.5 Functions**

Expressions combine partial functions using the following operators:

1. **Composition** `(f₁ f₂ …)` — sequential application.
2. **Union** `< f₁, f₂, … >` — try each in order, first defined wins.
3. **Product (parallel)** `{ f₁ l₁, f₂ l₂, … }` — apply all to the same input, succeed only if all succeed.
4. **Variant construction** `| l` — lift the input as a variant `l` of a union type.

Parentheses around a composition may be omitted except for the empty composition `()` — the identity function.
Empty product, `{ }`, defines a constant function (ignoring its input) returning *unit*.

---

## **2.6 Example**

```k-lang
$ bool = < {} true, {} false >;
true_bool  = | true $ bool;
false_bool = | false $ bool;
neg = $ bool < / true false_bool, / false true_bool >;
```

This defines a two-variant union type and three functions: two constants and one transformation exchanging the variants.

---

## **2.7 Summary**

* All types describe tree shapes.
* `{}` is the empty product (with one value, called *unit*).
* Values appear in expressions only as results of constant functions.
* There are no primitive literals, only algebraic data types.
* Functions, not values, are the only expressions in `k`.

---
