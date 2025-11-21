# Type Derivation - Mathematical Specification

## Syntax

### Expressions
```
e ::= x                          (variable)
    | e₁ e₂ ... eₙ              (composition)
    | {e₁ l₁, ..., eₙ lₙ}       (product)
    | <e₁, ..., eₙ>             (union/merge)
    | .l                         (projection)
    | /t                         (division)
    | ()                         (identity)
    | T                          (type literal)
```

### Patterns
```
π ::= (...)                      (open unknown)
    | {...}                      (open product)
    | <...>                      (open union)
    | ()                         (closed unknown)
    | {}                         (closed product)
    | <>                         (closed union)
    | T                          (type name)
```

Each pattern π has field set F(π) ⊆ Labels.

## Pattern Unification

π₁ ⊔ π₂ computes least upper bound:

- Open + Open: merge fields, keep open
- Open + Closed: check subset, close
- Closed + Closed: check equality
- Product ⊥ Union (incompatible)
- Type T: check structural match

## Typing Rules

Γ ⊢ e : π₁ → π₂

**Identity:**
```
Γ ⊢ () : π → π
```

**Composition:**
```
Γ ⊢ e₁ : π₁ → π₂    Γ ⊢ e₂ : π₂ → π₃
────────────────────────────────────
Γ ⊢ e₁ e₂ : π₁ → π₃
```

**Product:**
```
Γ ⊢ eᵢ : π → πᵢ  (i = 1..n, n ≥ 2)
────────────────────────────────────
Γ ⊢ {e₁ l₁, ..., eₙ lₙ} : π → {πᵢ lᵢ}
```

**Union:**
```
Γ ⊢ eᵢ : π → ρ  (i = 1..n)
────────────────────────────
Γ ⊢ <e₁, ..., eₙ> : π → ρ
```

**Projection:**
```
────────────────────────
Γ ⊢ .l : {..., l: ρ} → ρ
```

## Algorithm

1. Generate constraints from expression structure
2. Solve via unification
3. For recursion: iterate to fixed point per SCC
4. Compress via bisimulation equivalence

## Properties

- **Soundness**: Derivable ⟹ well-typed
- **Termination**: Bounded iterations
- **Principal types**: Most general patterns
