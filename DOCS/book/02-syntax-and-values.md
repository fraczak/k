# Chapter 2 — Syntax and Values

## **2.1 Language fragments**

The k language has only one kind of program element: a **definition**.
A program is a sequence of definitions of two kinds:

```
$ type_name = type_expression ;
function_name = expression ;
```

The last expression in the file is the *main expression*; it represents the partial function defined by the program as a whole.

There is no special syntax for values.
Every syntactic form describes a **function**—possibly a constant function that always returns the same value.

---

## **2.2 Types**

A type describes the possible **tree shapes** of values.
Types are formed from two constructors:

1. **Product**  – written `{ t₁ l₁, t₂ l₂, … }`
   represents records with fixed labeled fields.

2. **Union**  – written `< t₁ l₁, t₂ l₂, … >`
   represents a choice between labeled alternatives.

Both are finite and fully explicit.
Every type denotes a finite tree automaton whose accepted trees are the possible values of that type.

---

## **2.3 Special and limiting cases**

1. **Singleton equivalence**
   A product with one field, `{T x}`, is **equivalent** to the union `<T x>`.
   However, with two or more labels, the constructors must match: `{A x, B y} ≢ <A x, B y>`.
   This equivalence only applies to singleton cases.

2. **Empty product**
   `{}` has no fields.
   It represents the *unit* type: a type that admits exactly one value, also written `{}`.
   There is nothing exceptional about it; it is simply the degenerate case of a product with zero fields.

3. **Empty union**
   `<>` has no variants.
   It represents a type with no possible values.

---

## **2.4 Constant functions**

Since k has no literal value syntax, constants are written as functions that ignore their argument and return a fixed tree.
For example:

```
$ bool = < {} true, {} false >;
true_bool  = {{} true} $ bool;
false_bool = {{} false} $ bool;
```

Each constant definition constructs a function that produces the same variant value and then applies the type identity function `$ bool` to ensure the result is of the correct type.
The syntax `{{} true}` creates a variant value: the empty product `{}` tagged as `true`.
The `$ bool` acts as an identity function defined only on values of type `bool`.

Note that whitespace is optional: `{{} true} $ bool` is equivalent to `{{}true}$bool`.

There are no integers, strings, or other primitive atoms.
All data must be built from algebraic types using the product and union constructors.

---

## **2.5 Functions**

Expressions combine partial functions using three operators:

1. **Composition** `(f g h)` — sequential application.
2. **Union** `< f₁, f₂, … >` — try each in order, first defined wins.
3. **Product (parallel)** `{ f₁ l₁, f₂ l₂, … }` — apply all to the same input, succeed only if all succeed.

Parentheses may be omitted except for the empty composition `()` —the identity function.

---

## **2.6 Example**

```
$ bool = < {} true, {} false >;
true_bool  = {{} true} $ bool;
false_bool = {{} false} $ bool;
neg = $ bool < .true false_bool, .false true_bool > $ bool;
```

This defines a two-variant union type and three functions: two constants and one transformation exchanging the variants.

---

## **2.7 Summary**

* All types describe tree shapes.
* `< T x >` and `{ T x }` are the same type.
* `{}` is the empty product (unit).
* Values appear only as results of constant functions.
* There are no primitive literals, only algebraic data types.
* Functions, not values, are the only expressions in k.

---