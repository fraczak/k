# Chapter 2 — Syntax and Values

## **2.1 Language fragments**

The `k` language has only one kind of program element: a **definition**.
A program is a sequence of definitions:

```k-lang
relation_name = ...expression... ;
```

The definitions are followed in the file by the *main expression*, which represents the partial function defined by the program as a whole.
There is no separate syntax for type declarations. Data shapes are defined by the relations and pattern filters (`? ...`) that manipulate them.

There is no syntax for values.
Every syntactic form in an expression describes a **function** -- possibly a constant function that always returns the same value.

---

## **2.2 Schemas**

A schema describes the possible **tree shapes** of payload values.
Schemas are formed from two constructors:

1. **Product**  – written `{ S₁ l₁, S₂ l₂, … }`
   represents records with fixed labeled fields.

2. **Union**  – written `< S₁ l₁, S₂ l₂, … >`
   represents a choice between labeled alternatives.

Both are finite and fully explicit.
Every schema denotes a finite tree automaton whose accepted trees are the possible payload values of that schema.

---

## **2.3 Special and limiting cases**

1. **Empty product**
   `{}` has no fields.
   It represents the unit schema that admits exactly one value, called *unit*.
   There is nothing exceptional about the unit schema and its value; it is simply the degenerate case of a product with zero fields.

2. **Empty union**
   `<>` has no variants.
   It represents a schema with no possible values.

---

## **2.4 Projections**

**Dot** notation, e.g.,

```k
 . field_name
```

is used for extracting the value of a field from a record (product type value).
**Div** notation, e.g.,

```k
 / variant_name
```

is used for asserting a particular variant of a union and extracting its value.
A product type `{ T₁ l₁, T₂ l₂, … , Tₙ lₙ }` naturally defines `n` partial functions: `.l₁, .l₂, … , .lₙ`,
and a union type `< T₁ l₁, T₂ l₂, … , Tₙ lₙ >` naturally defines `n` partial functions `/l₁, /l₂, … , /lₙ`.
Those partial functions are called **projections** and they constitute the basis for the definition
of all other partial functions in the `k` language.

---

## **2.5 Functions**

Expressions combine partial functions using the following operators:

1. **Composition** `(f₁ f₂ …)` — sequential application.
2. **Union** `< f₁, f₂, … >` — try each in order, first defined wins.
3. **Product (parallel)** `{ f₁ l₁, f₂ l₂, … }` — apply all to the same input, succeed only if all succeed.
4. **Variant construction** `| tag` — lift the input as a variant `tag` of a union type.

Parentheses around a composition may be omitted except for the empty composition `()` — the identity function.
Empty product, `{ }`, defines a constant function (ignoring its input) returning *unit*.

It is important to notice that after the three markers `dot (.)`, `div (/)`, or `pipe (|)`, there must be a constant label literal. For that reason, it is possible and recommended not to leave any blanks after the marker, e.g.:

```k-lang
  .field /'a-tag' |"strange and long tag name ✅"
```

---

## **2.6 Example**

```k-lang
true  = {} |true;
false = {} |false;
neg = < /true false, /false true >;
```

This defines three relations: two constants and one transformation exchanging the variants `/true` and `/false`. The contracts of their inputs and outputs are derived automatically by the compiler.

---

## **2.7 Summary**

* All schemas describe payload tree shapes.
* As an expression, `{}` is the empty product (with one value, called *unit*).
* Relations, not values, are the only expressions in `k`.

---
