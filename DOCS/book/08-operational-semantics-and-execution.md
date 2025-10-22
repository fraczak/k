# Chapter 8 — Operational Semantics and Execution

## **8.1  Purpose**

The **operational semantics** of k describe how expressions are evaluated step by step on actual value trees.
It defines when a function is *defined* for a particular input and what value it returns.
All execution—interpretive or compiled—follows these rules.

---

## **8.2  Evaluation relation**

Evaluation is written as:

```
⟨ e , v ⟩ ⇓ r
```

meaning that expression `e` applied to value `v` yields result `r`.
If `e` is undefined for `v`, the relation does not hold.

`r` is always a tree (or node) in memory, represented as described in Chapter 6.
Undefined results are expressed by the absence of any rule that produces `r`.

---

## **8.3  Rules for base expressions**

### **Identity**

```
⟨ () , v ⟩ ⇓ v
```

The empty composition `()` returns its argument unchanged.

### **Constant**

```
⟨ c , v ⟩ ⇓ r₀
```

for any `v`.
The constant function ignores its input and returns its predefined value `r₀`.

### **Projection**

Let `label` be a field or variant name.
If `v` has a child under `label`,

```
⟨ .label , v ⟩ ⇓ v.label
```

Otherwise the projection is undefined.

### **Type expression**

For a type `$T`,

```
⟨ $T , v ⟩ ⇓ v     if v ∈ T
```

and undefined otherwise.
Type expressions thus act as identity functions restricted to their type.

---

## **8.4  Rules for composition**

### **Sequential composition**

```
⟨ (f g) , v ⟩ ⇓ r
```

if there exists `u` such that
`⟨ f , v ⟩ ⇓ u` and `⟨ g , u ⟩ ⇓ r`.

If either step is undefined, the composition is undefined.
Because composition is associative,

```
(f (g h))  ≡  ((f g) h)  ≡  (f g h)
```

Parentheses are needed only for `()`.

---

## **8.5  Rules for product composition**

```
⟨ { f₁ l₁ , f₂ l₂ , … , fₙ lₙ } , v ⟩ ⇓ { r₁ l₁ , r₂ l₂ , … , rₙ lₙ }
```

if and only if all subfunctions `fᵢ` are defined on `v` and yield `rᵢ`.
If any subfunction is undefined, the whole product composition is undefined.

A product composition constructs a new product node;
each result `rᵢ` becomes one child in canonical field order.

---

## **8.6  Rules for union composition**

```
⟨ < f₁ , f₂ , … , fₙ > , v ⟩ ⇓ rⱼ
```

if there exists the smallest index `j` such that
`⟨ fⱼ , v ⟩ ⇓ rⱼ`.

If no subfunction is defined, the union composition is undefined.

---

## **8.7  Rules for filters**

If a filter `?F` matches the type of value `v`,

```
⟨ ?F , v ⟩ ⇓ v
```

otherwise it is undefined.

Filters therefore act as partial identities defined for all types satisfying the filter pattern.

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

```
$bool = < {} true, {} false >;
neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
```

and input value `{ {} true } $bool`,
evaluation steps are:

1. `⟨ $bool , { {} true } ⟩ ⇓ { {} true }`
2. `⟨ < .true {{ } false}, .false {{ } true} > , { {} true } ⟩ ⇓ {{ } false}`
3. `⟨ $bool , {{ } false} ⟩ ⇓ {{ } false}`

Final result: `{{ } false}`.
If the input were of another type, step 1 would be undefined.

---

## **8.10  Implementation correspondence**

The evaluation rules map directly onto the runtime ABI:

| Semantic rule       | Runtime operation                     |
| ------------------- | ------------------------------------- |
| Projection          | `k_project`                           |
| Product composition | multiple subcalls + `k_make_product`  |
| Union composition   | sequential subcalls with early return |
| Type/Filter         | runtime check of `state` or `arity`   |
| Constant            | predefined node pointer               |
| Composition         | function call chain                   |

In compiled form, the `ok` flag of `KOpt` represents whether a rule applies;
the node pointer represents the result value.

---

## **8.11  Summary**

* Execution follows deterministic, left-to-right rules.
* All expressions denote partial functions on value trees.
* Type and filter expressions act as restricted identities.
* Composition is associative; undefined propagates automatically.
* Runtime semantics match the formal evaluation relation exactly.

---