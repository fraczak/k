# Chapter 8 — Operational Semantics and Execution

## **8.1  Purpose**

The **operational semantics** of `k` describe how expressions are evaluated step by step on runtime values.
It defines when a function is *defined* for a particular input and what value it returns.
All execution—interpretive or compiled—follows these rules.

In the current runtime, a value is a materialized tree together with an optional
root pattern. The tree determines the ordinary product/union computation; the
pattern records the polymorphic type context used by the codec stream and is
propagated by structural operations.

---

## **8.2  Evaluation relation**

Evaluation is written as:

```text
⟨ e , v ⟩ ⇓ r
```

meaning that expression `e` applied to value `v` yields result `r`.
If `e` is undefined for `v`, the relation does not hold.

`r` is a runtime value in memory, represented as described in Chapter 6.
Undefined results are expressed by the absence of any rule that produces `r`.

---

## **8.3  Rules for base expressions**

### **Identity**

```text
⟨ () , v ⟩ ⇓ v
```

The empty composition `()` returns its argument unchanged.

### **Projection**

Let `label` be a field or variant name.
If `v` has a child under `label`,

```text
⟨ .label , v ⟩ ⇓ v.label
```

Otherwise the projection is undefined.

If `v` carries a pattern, the result carries the subpattern reached by `label`.
For a union projection `/label`, the same rule applies to the selected tag's
payload.

### **Filter expression**

For a pattern filter `?F`,

```text
⟨ ?F , v ⟩ ⇓ v     if v ∈ L(F)
```

and undefined otherwise.
Filter expressions thus act as partial identity functions restricted to their pattern language.

---

## **8.4  Rules for composition**

### **Sequential composition**

```text
⟨ (f g) , v ⟩ ⇓ r
```

if there exists `u` such that
`⟨ f , v ⟩ ⇓ u` and `⟨ g , u ⟩ ⇓ r`.

If either step is undefined, the composition is undefined.
Because composition is associative,

```text
(f (g h))  ≡  ((f g) h)  ≡  (f g h)
```

Parentheses are needed only for `()`.

---

## **8.5  Rules for product composition**

```text
⟨ { f₁ l₁ , f₂ l₂ , … , fₙ lₙ } , v ⟩ ⇓ { r₁ l₁ , r₂ l₂ , … , rₙ lₙ }
```

if and only if all subfunctions `fᵢ` are defined on `v` and yield `rᵢ`.
If any subfunction is undefined, the whole product composition is undefined.

A product composition constructs a new product node;
each result `rᵢ` becomes one child in canonical field order.
If the component results carry patterns, the constructed value carries the
closed product pattern with field `lᵢ` pointing to the corresponding result
pattern.

---

## **8.6  Rules for union composition**

```text
⟨ < f₁ , f₂ , … , fₙ > , v ⟩ ⇓ rⱼ
```

if there exists the smallest index `j` such that
`⟨ fⱼ , v ⟩ ⇓ rⱼ`.

If no subfunction is defined, the union composition is undefined.

---

## **8.7  Rules for filters**

A filter `?F` validates that the input value conforms to the pattern:

```text
⟨ ?F , v ⟩ ⇓ v     if v matches pattern F
```

otherwise undefined.

Filters act as partial identity relations. At compile time, they guide type
derivation and provide inductive termination witnesses for recursive relations.
At runtime, filters succeed and preserve the input value when it conforms to
the pattern, or fail if the value does not match. Their pattern information is
carried by the runtime value's pattern envelope.

---

## **8.8  Evaluation order**

Evaluation proceeds left to right.
In products, all subfunctions receive the same input;
in unions, later functions are evaluated only if earlier ones fail.

The semantics are deterministic:
for any given input, at most one result tree can be produced.

---

## **8.9  Example**

Given:

```k-lang
bool = ?< {} true, {} false >;
neg = ?< {} true, {} false > < /true | false, /false | true >;
```

and input value `{} |true`, evaluation steps are:

1. `⟨ ?< {} true, {} false > , {} |true ⟩ ⇓ {} |true`
2. `⟨ < /true | false, /false | true > , {} |true ⟩ ⇓ {} |false`

Final result: `{} |false`.
If the input were of another shape, step 1 would be undefined.

---

## **8.10  Implementation correspondence**

The evaluation rules map directly onto the runtime ABI:

| Semantic rule       | Runtime operation                     |
| ------------------- | ------------------------------------- |
| Projection          | `k_project`                           |
| Product composition | multiple subcalls + `k_make_product`  |
| Union composition   | sequential subcalls with early return |
| Filter              | runtime check or identity             |
| Composition         | function call chain                   |

In compiled form, the `ok` flag of `KOpt` represents whether a rule applies;
the node pointer represents the result value.

---

## **8.11  Summary**

* Execution follows deterministic, left-to-right rules.
* All expressions denote partial functions on runtime values.
* Runtime values may carry patterns, and structural operations propagate them.
* Filter expressions act as restricted identities.
* Composition is associative; undefined propagates automatically.
* Runtime semantics match the formal evaluation relation exactly.

---
