# Chapter 4 — Partial Functions and Composition

## **4.1  Partial functions**

A **partial function** is a mapping that may be undefined for some inputs.
In k, every expression denotes such a function.
If the function is undefined on a value, no result exists; evaluation stops.

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

```
(f g h)  ≡  ((f g) h)
```

Therefore, parentheses are unnecessary except for the special case of the **empty composition**, written `()`, which acts as the identity function:

```
() x  =  x
```

---

## **4.3  Product composition**

Product composition creates a function that applies several subfunctions in parallel to the same input and gathers their results into a product value.

Syntax:

```
{ f₁ l₁, f₂ l₂, …, fₙ lₙ }
```

This expression is defined on an input value if all component functions are defined on that input.
Its result is a product with fields labeled `l₁ … lₙ`, each containing the corresponding subresult.

Example:

```
{ .x X, .y Y }
```

maps a record with fields `x` and `y` to another record `{ X, Y }` if both fields exist.

---

## **4.4  Union composition**

Union composition represents concurrent evaluation with fallback:

```
< f₁, f₂, …, fₙ >
```

The result is defined for an input `x` if at least one subfunction is defined.
Evaluation proceeds left to right; the first defined result is used.
If none are defined, the result is undefined.

Example:

```
< .x, .y >
```

extracts `.x` if present; otherwise `.y` if present.

---

## **4.5  Constants**

A constant function always returns the same value, ignoring its argument.
Since k has no literal syntax for values, constants are expressed through construction:

```
true_bool  =  {{ } true} $bool ;
false_bool =  {{ } false} $bool ;
```

Each is a partial function defined for all inputs (total functions) producing a fixed value.

---

## **4.6  Projection**

Projection selects a field or variant from a product or union.
It is written with a leading dot:

```
.x
```

If the input is a product containing field `x`, the result is the value of that field.
If the input is a union currently in the variant `x`, the result is the contained value.
Otherwise the projection is undefined.

Projections are themselves partial functions.

---

## **4.7  Derived combinations**

Complex functions are built by nesting compositions.
For example:

```
< .x, .y >
```

means “take field `x`, or if absent, take field `y`”.

```
{ .x x_copy, .y y_copy }
```

copies both fields if they exist.

---

## **4.8  Identity and emptiness**

The empty composition `()` acts as the identity.
The empty union `<>` is the always-undefined function.
The empty product `{}` is the constant function returning the unit value `{}`.

---

## **4.9  Summary**

* All expressions denote partial functions.
* Composition `(f g)` is associative; parentheses can be omitted.
* `()` is identity.
* `{ … }` combines results in parallel; `< … >` tries alternatives.
* Projections and constants are the simplest partial functions.
* Undefined means “no output”, not “error”.

---