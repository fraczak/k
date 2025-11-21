# Local Typing Rules

For each expression type, define how to initialize patterns and what unification constraints to apply.

## Notation

- `[in, out]` denotes the pattern pair for an expression
- `find(p)` returns the representative of pattern p
- `UNIFY(reason, p1, ..., pn)` unifies patterns
- `addNode(pattern, edges)` creates a new pattern node with labeled edges

## Rule 1: Identity `()`

```
Expression: ()
Patterns: [p, p] where p is fresh Open(Unknown, {})

Constraints: none
```

## Rule 2: Reference `ref(v)`

```
Expression: ref(v)
Patterns: [in_v, out_v] both fresh

Let [in_def, out_def] = patterns of definition of v
Let cloned = clone([in_def, out_def])

Constraints:
  UNIFY("ref:input", find(in_v), cloned[find(in_def)])
  UNIFY("ref:output", find(out_v), cloned[find(out_def)])
```

## Rule 3: Composition `comp(e1, ..., en)`

```
Expression: comp(e1, ..., en)
Patterns: [in_comp, out_comp] both fresh

For each ei, let [in_ei, out_ei] = patterns(ei)

Constraints:
  if n = 0:
    UNIFY("comp:empty", find(in_comp), find(out_comp))
  
  if n ≥ 1:
    UNIFY("comp:start", find(in_comp), find(in_e1))
    UNIFY("comp:end", find(out_comp), find(out_en))
    
    for i = 1 to n-1:
      UNIFY("comp:chain", find(out_ei), find(in_e(i+1)))
```

## Rule 4: Product `product([(l1, e1), ..., (ln, en)])`

### Case n = 0 (empty product)

```
Expression: product([])
Patterns: [in_p, out_p]

Let unit = getTypeId("{}") // the unit type

Constraints:
  in_p is fresh Open(Unknown, {})
  out_p = unit
```

### Case n = 1 (variant constructor)

```
Expression: product([(l1, e1)])
Patterns: [in_p, out_p]

Let [in_e1, out_e1] = patterns(e1)
Let out_p = addNode(Open(Union, {l1}), {l1: [find(out_e1)]})

Constraints:
  UNIFY("variant:input", find(in_p), find(in_e1))
```

### Case n ≥ 2 (product constructor)

```
Expression: product([(l1, e1), ..., (ln, en)])
Patterns: [in_p, out_p]

For each ei, let [in_ei, out_ei] = patterns(ei)
Let out_p = addNode(Closed(Product, {l1, ..., ln}), 
                    {l1: [find(out_e1)], ..., ln: [find(out_en)]})

Constraints:
  UNIFY("product:input", find(in_p), find(in_e1), ..., find(in_en))
```

## Rule 5: Union `union([e1, ..., en])`

```
Expression: union([e1, ..., en])
Patterns: [in_u, out_u]

For each ei, let [in_ei, out_ei] = patterns(ei)

Constraints:
  if n = 0:
    in_u and out_u are fresh Open(Unknown, {})
  
  if n ≥ 1:
    UNIFY("union:input", find(in_u), find(in_e1), ..., find(in_en))
    UNIFY("union:output", find(out_u), find(out_e1), ..., find(out_en))
```

## Rule 6: Projection `dot(l)`

```
Expression: dot(l)
Patterns: [in_d, out_d]

Let out_d be fresh Open(Unknown, {})
Let in_d = addNode(Open(Unknown, {l}), {l: [find(out_d)]})

Constraints: none (structure encoded in initialization)
```

## Rule 7: Division `div(t)` (union case selector)

```
Expression: div(t)
Patterns: [in_d, out_d]

Let out_d be fresh Open(Unknown, {})
Let in_d = addNode(Open(Union, {t}), {t: [find(out_d)]})

Constraints: none
```

## Rule 8: Variant Injection `vid(t)`

```
Expression: vid(t)
Patterns: [in_v, out_v]

Let in_v be fresh Open(Unknown, {})
Let out_v = addNode(Open(Union, {t}), {t: [find(in_v)]})

Constraints: none
```

## Rule 9: Code Literal `code(c)`

```
Expression: code(c)
Patterns: [in_c, out_c]

Let type_id = getTypeId(c)

Constraints:
  UNIFY("code", find(in_c), type_id, find(out_c))
```

## Rule 10: Filter `filter(f)`

```
Expression: filter(f)
Patterns: [in_f, out_f]

Let pattern_id = filterToPattern(f)

Constraints:
  UNIFY("filter", find(in_f), pattern_id, find(out_f))
```

Where `filterToPattern` converts a filter AST to a pattern node (see implementation details).

## Summary Table

| Expression | Input Pattern | Output Pattern | Unification |
|------------|---------------|----------------|-------------|
| `()` | fresh | same as input | none |
| `ref(v)` | fresh | fresh | clone def, unify both |
| `comp(e1,...,en)` | = in_e1 | = out_en | chain outputs to inputs |
| `product([])` | fresh | unit type | none |
| `product([(l,e)])` | = in_e | `<...>{l: out_e}` | none |
| `product([...])` | = all in_ei | `{}{l1: out_e1, ...}` | none |
| `union([e1,...])` | = all in_ei | = all out_ei | none |
| `dot(l)` | `(...){l: out}` | fresh | none |
| `div(t)` | `<...>{t: out}` | fresh | none |
| `vid(t)` | fresh | `<...>{t: in}` | none |
| `code(c)` | = type(c) | = type(c) | none |
| `filter(f)` | = pattern(f) | = pattern(f) | none |
