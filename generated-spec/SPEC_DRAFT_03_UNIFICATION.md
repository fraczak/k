# Pattern Unification Specification

## Unification Operation

Given patterns `p1, p2, ..., pn`, compute their **least upper bound** in the pattern lattice.

### Notation

- `⊔` denotes the binary unification operation
- `⊥` denotes unification failure (incompatible patterns)
- `F1 ∪ F2` denotes set union of field sets
- `F1 ⊆ F2` denotes subset relation

## Binary Unification Table

The operation `p1 ⊔ p2` is defined by the following table (symmetric):

```
         | (...)      | {...}      | <...>      | ()         | {}         | <>         | Type(t)
---------|------------|------------|------------|------------|------------|------------|------------
(...)    | (...)∪     | {...}∪     | <...>∪     | ()⊇        | {}⊇        | <>⊇        | Type(t)⊇
{...}    |            | {...}∪     | ⊥          | {}⊇        | {}⊇        | ⊥          | Type(t)⊇
<...>    |            |            | <...>∪     | <>⊇        | ⊥          | <>⊇        | Type(t)⊇
()       |            |            |            | ()=        | {}=        | <>=        | Type(t)=
{}       |            |            |            |            | {}=        | ⊥          | Type(t)=
<>       |            |            |            |            |            | <>=        | Type(t)=
Type(t)  |            |            |            |            |            |            | Type(t)=
```

### Legend

- `∪` - union of field sets, keep openness
- `⊇` - check field subset, close if compatible
- `=` - check field equality
- `⊥` - incompatible (error)

## Detailed Rules

### Rule 1: Open Unknown `(...)` with anything

```
Open(Unknown, F1) ⊔ Open(Unknown, F2) = Open(Unknown, F1 ∪ F2)
Open(Unknown, F1) ⊔ Open(Product, F2) = Open(Product, F1 ∪ F2)
Open(Unknown, F1) ⊔ Open(Union, F2) = Open(Union, F1 ∪ F2)
Open(Unknown, F1) ⊔ Closed(c, F2) = Closed(c, F2)  if F1 ⊆ F2, else ⊥
Open(Unknown, F1) ⊔ Type(t) = Type(t)  if F1 ⊆ fields(t), else ⊥
```

### Rule 2: Open Product `{...}` 

```
Open(Product, F1) ⊔ Open(Product, F2) = Open(Product, F1 ∪ F2)
Open(Product, F1) ⊔ Open(Union, F2) = ⊥
Open(Product, F1) ⊔ Closed(Unknown, F2) = Closed(Product, F2)  if F1 ⊆ F2, else ⊥
Open(Product, F1) ⊔ Closed(Product, F2) = Closed(Product, F2)  if F1 ⊆ F2, else ⊥
Open(Product, F1) ⊔ Closed(Union, F2) = ⊥
Open(Product, F1) ⊔ Type(t) = Type(t)  if isProduct(t) ∧ F1 ⊆ fields(t), else ⊥
```

### Rule 3: Open Union `<...>`

```
Open(Union, F1) ⊔ Open(Union, F2) = Open(Union, F1 ∪ F2)
Open(Union, F1) ⊔ Closed(Unknown, F2) = Closed(Union, F2)  if F1 ⊆ F2, else ⊥
Open(Union, F1) ⊔ Closed(Product, F2) = ⊥
Open(Union, F1) ⊔ Closed(Union, F2) = Closed(Union, F2)  if F1 ⊆ F2, else ⊥
Open(Union, F1) ⊔ Type(t) = Type(t)  if isUnion(t) ∧ F1 ⊆ fields(t), else ⊥
```

### Rule 4: Closed Unknown `()`

```
Closed(Unknown, F1) ⊔ Closed(Unknown, F2) = Closed(Unknown, F1)  if F1 = F2, else ⊥
Closed(Unknown, F1) ⊔ Closed(Product, F2) = Closed(Product, F2)  if F1 = F2, else ⊥
Closed(Unknown, F1) ⊔ Closed(Union, F2) = Closed(Union, F2)  if F1 = F2, else ⊥
Closed(Unknown, F1) ⊔ Type(t) = Type(t)  if F1 = fields(t), else ⊥
```

### Rule 5: Closed Product `{}`

```
Closed(Product, F1) ⊔ Closed(Product, F2) = Closed(Product, F1)  if F1 = F2, else ⊥
Closed(Product, F1) ⊔ Closed(Union, F2) = ⊥
Closed(Product, F1) ⊔ Type(t) = Type(t)  if isProduct(t) ∧ F1 = fields(t), else ⊥
```

### Rule 6: Closed Union `<>`

```
Closed(Union, F1) ⊔ Closed(Union, F2) = Closed(Union, F1)  if F1 = F2, else ⊥
Closed(Union, F1) ⊔ Type(t) = Type(t)  if isUnion(t) ∧ F1 = fields(t), else ⊥
```

### Rule 7: Type

```
Type(t1) ⊔ Type(t2) = Type(t1)  if t1 ≡ t2, else ⊥
```

Where `t1 ≡ t2` means the codes are bisimilar (see README.md).

## N-ary Unification

```
unify(p1, ..., pn) = p1 ⊔ p2 ⊔ ... ⊔ pn
```

Computed left-to-right with initial value `Open(Unknown, {})`.

## UNIFY Procedure

```
UNIFY(reason: String, ids: Set<NodeId>):
  reps = { find(id) | id ∈ ids }
  if |reps| ≤ 1: return
  
  patterns = { get_pattern(r) with fields from edges(r) | r ∈ reps }
  new_pattern = unify(patterns...)
  
  new_id = addNewNode(new_pattern, parent=reps, reason=reason)
  
  // Migrate edges
  for each rep in reps:
    for each (label, dests) in edges[rep]:
      edges[new_id][label] = edges[new_id][label] ∪ dests
  
  // Handle Type edges
  if new_pattern is Type(t):
    for each field f in fields(t):
      target = getTypeId(type_of_field(t, f))
      edges[new_id][f] = edges[new_id][f] ∪ {target}
  
  // Recursively unify edge destinations
  for each (label, dests) in edges[new_id]:
    UNIFY(reason + "." + label, dests)
```
