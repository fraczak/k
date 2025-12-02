# Chapter 4 — Partial Functions and Composition

## **4.1  Partial functions**

A **partial function** is a mapping that may be undefined for some inputs.
In `k`, every expression denotes such a function.
If a function is undefined for a given input, the evaluation process halts at that point, producing no result.

There is no notion of error or exception.
Undefined means simply “no output”.

---

## **4.2  Composition**

Composition combines two or more partial functions sequentially.
If `f` and `g` are functions, `(f g)` means “apply `f`, then apply `g` to the result”.

A composition `(f g)` is defined on a value `x` if and only if:

* `f` is defined on `x`, and
* `g` is defined on the result of `f(x)`.

Otherwise, the composition is undefined.

Composition is **associative**:

```math
(f (g h))  ≡  ((f g) h)
```

Therefore, parentheses are unnecessary, except for the special case of the **empty composition**, written `()`, which is the identity function:

```math
() x  =  x () = x
```

---

## **4.3  Product composition**

Product composition creates a function that applies several subfunctions in parallel to the same input and gathers their results into a product value.

Syntax:

```math
{ f₁ l₁, f₂ l₂, …, fₙ lₙ }
```

This expression is defined on an input value if all component functions are defined on that input.
Its result is a product with fields labeled `l₁ … lₙ`, each containing the result of the corresponding function.

---

## **4.4  Union composition**

Union composition represents concurrent evaluation with fallback:

```k-lang
< f₁, f₂, …, fₙ >
```

The result is defined for an input `x` if at least one subfunction is defined.
Evaluation proceeds left to right; the first defined result is used.
If none are defined, the result is undefined.

Example:

```k-lang
< /x, /y >
```

extracts variant `x` if present; otherwise `y` if present.

---

## **4.5  Constants**

A constant function is one that always returns the same value, regardless of its input.
Since `k` lacks a direct syntax for literal values, constants are created using functions that produce them.

For example, we can define functions that return `true` and `false`:

```k-lang
$ bool = < {} true, {} false >;
true_bool  =  {} |true $bool ;
false_bool =  {} |false $bool ;
```

Here, `true_bool` and `false_bool` are constant functions. They are also **total functions**, meaning they are defined for all inputs. Each function ignores its input and produces a fixed boolean value.

---

## **4.6  Projection and Variant Value constructor**

Projection selects a field or a variant from a product or union.
It is written with a leading dot `.` or a leading slash `/`, respectively:

```k-lang
.x     // Selects field 'x' from a product: { T x, ... }
/x     // Extracts the value from a union variant 'x': < T x, ... >
```

If the input is a product, `.x` returns the value of field `x`. If the input is a union, `/x` returns the value of variant `x`. In all other cases, the projection is undefined.

Variant value constructors for a given union type `T = <T₁ tag₁, T₂ tag₂, … >` are written as `|tag₁`, `|tag₂`, ….

```k-lang
|tag₁    // lift a value of type T₁ into a value of type T
```

Projections and variant constructors are the most basic partial functions.

---

## **4.7  Derived combinations**

Complex functions are built by nesting compositions.
For example:

```k-lang
{ .x field1, .y |tag field2 }
```

---

## **4.8  Identity and emptiness**

The empty composition `()` is the identity function.
The empty union `<>` is the always-undefined function.
The empty product `{}` is the constant function returning the unit value.

---

## **4.9  Summary**

* In `k`, all expressions denote **partial functions**.
* An undefined result simply means “no output,” not an error.
* **Composition** `(f g)` applies functions sequentially and is associative, so parentheses are often optional.
* The empty composition `()` is the **identity function**.
* **Product composition** `{...}` runs functions in parallel and gathers their results.
* **Union composition** `<...>` tries functions in order, returning the first successful result.
* **Projections** (`.x`, `/x`) are fundamental building blocks for accessing data structures.
* **Variant constructor** (`|tag`) allows lifting a value into a variant type value.

---
