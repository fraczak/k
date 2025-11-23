# Type Derivation - Mathematical Specification

## Syntax

### Expressions

```text
e ::= x                          (variable)
    | (e₁ e₂ ... eₙ)             (composition)
    | {e₁ l₁, ..., eₙ lₙ}        (product)
    | <e₁, ..., eₙ>              (union/merge)
    | .l                         (projection - dot)
    | /t                         (projection - div)
    | |l                         (variant constructor)
    | $ T                        (type)
    | ? F                        (filter expression)
```

### Patterns

```text
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
- Type T + any: check compatibility of 'any' with T (two times are compatiable only if equal)

## Typing Rules

```text
Γ ⊢ e : π₁ → π₂
```

**Composition:**

```text
Γ ⊢ e₁ : π₁ → π₂    Γ ⊢ e₂ : π₂ → π₃
────────────────────────────────────
Γ ⊢ e₁ e₂ : π₁ → π₃
```

**Product:**

```text
Γ ⊢ eᵢ : π → πᵢ  (i = 1..n, n ≥ 2)
────────────────────────────────────
Γ ⊢ {e₁ l₁, ..., eₙ lₙ} : π → {πᵢ lᵢ}
```

**Union:**

```text
Γ ⊢ eᵢ : π → ρ  (i = 1..n)
────────────────────────────
Γ ⊢ <e₁, ..., eₙ> : π → ρ
```

**Projection - dot:**

```text
────────────────────────
Γ ⊢ .l : {..., l: ρ} → ρ
```

**Projection - div:**

```text
────────────────────────
Γ ⊢ /l : <..., l: ρ> → ρ
```

## Algorithm

1. Generate constraints from expression structure
2. Solve via unification
3. For recursion: iterate to fixed point per SCC

## Properties

- **Soundness**: Derivable ⟹ well-typed
- **Termination**: Bounded iterations
- **Principal types**: Most general patterns
