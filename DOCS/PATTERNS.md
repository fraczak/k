# Patterns and relations

k source defines relations, named patterns, and a terminal expression.
The terminal expression is the entry relation when executing a source file.
The REPL also accepts definitions on their own.

## Core relations

Every expression denotes a first-order partial function over product/variant
values.

| Syntax | Meaning |
| --- | --- |
| `()` | Identity |
| `{}` | Constant unit |
| `<>` | Always undefined |
| `.field` | Project a product field |
| `/tag` | Extract a matching variant payload |
| `\|tag` | Wrap the input in a variant |
| `(f g)` | Apply `f`, then `g` |
| `{f a, g b}` | Apply both relations to the same input and construct fields `a` and `b` |
| `<f, g>` | Try `f`, then `g` if `f` is undefined |
| `?P` | Constrain the schema to pattern `P` without changing the payload |
| `name` or `@hash` | Reference a relation |

Composition can omit parentheses when grouping is unambiguous.
A product is undefined if a field computation is undefined. Choice preserves
source priority; an earlier nonterminating branch does not fall through.

Definitions use `name = expression;`. There are no builtin numeric or string
values in relation syntax: a numeric identifier such as `5` is a relation
name, and quoted strings in label positions are labels. Use
[codecs](../codecs/README.md) for external numbers, text, or JSON.

Relations can refer to other definitions in the same source, including recursive
references. Labels can be identifiers or quoted strings with escapes. Line
comments use `--`, `//`, `#`, or `%`; block comments use `/* ... */`.

## Pattern syntax

Patterns describe schema constraints rather than computations:

| Pattern | Constraint |
| --- | --- |
| `(...)` or an unbound variable `X` | An unconstrained schema position |
| `{P a, Q b}` | A product with exactly the listed fields |
| `{P a, ...}` | A product with at least the listed fields |
| `<P a, Q b>` | A union with exactly the listed tags |
| `<P a, ...>` | A union allowing additional tags |
| `{}` | Empty product schema |
| `<>` | Empty union schema |
| `P = X` | Bind the pattern node as `X`, allowing recursive references |
| `name[P, Q]` | Instantiate a named pattern |

The distinction between open and closed union schemas concerns the schema's
available tags. A variant payload still selects one tag.

Repeated variables express equality of schema constraints:

```k
?{ X first, X second }
```

The two fields must have compatible shared schema constraints; their payloads
need not be equal. Anonymous wildcards do not impose that sharing:

```k
?{ (...) first, (...) second }
```

Pattern variables in a relation have relation-definition scope.

## Named patterns

Square brackets distinguish reusable templates from bare variables:

```k
bit[] = < {} 0, {} 1 >;
bits[] = < {} _, B 0, B 1 > = B;
pair[A, B] = { A first, B second };
list[X] = < {} nil, { X car, Y cdr } cons > = Y;
```

A filter applies a template:

```k
?pair[bit[], bits[]]
```

Template applications can be nested inside patterns, including arguments such
as `list[pair[A, B]]`. Every application must resolve in scope and have the
declared arity.

Variables have three roles:

- Parameters in a header such as `[X]` are supplied by callers.
- Other free variables are private existential constraints. Repeated uses share
  a constraint; different instantiations receive fresh private names.
- Bound variables such as `= Y` are internal cycle knots.

Knots cannot be parameters. For example,
`list[X, Y] = <{} nil, {X car, Y cdr} cons> = Y;` is rejected.
Template dependency cycles are also rejected: recursion uses a knot inside a
template, rather than the template calling itself. Undefined templates and
arity mismatches are rejected even in unused definitions.

## Filters and contracts

A relation can combine structural guards with ordinary computation:

```k
bool[] = < {} false, {} true >;
not = ?bool[] < /false |true, /true |false > ?bool[];
```

Both boundaries have the boolean schema, although the relation changes the
payload. Shared contract nodes describe schema relationships, not a separate
proof of preservation of the original data.

Explicit recursive patterns can make contract derivation converge. This is a
compiler property, not a guarantee of execution termination. See
[contract derivation](TYPE_DERIVATION.md).

In the envelope-aware runtime, constraints intersect the carried pattern and
contradictions raise type errors. Optimized execution may erase guards proved
by specialization. Ordinary partial failure remains distinct from a schema
contradiction.

## Canonical identity and routing

Relations are hashed from normalized definitions; that does not decide general
semantic equality of programs.

Named patterns factor into a canonical linear skeleton and alias arguments.
Every open leaf slot of the skeleton has its own port:

```k
pair[A, B] = { A first, B second };
same_pair[T] = { T first, T second };
closed_same_pair[] = { T first, T second };
any_pair[] = { (...) first, (...) second };
```

All four use the skeleton:

```k
@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[X0, X1] = {
  X0 first, X1 second
};
```

Their arguments retain the differences:

| Alias | Skeleton arguments |
| --- | --- |
| `pair[A, B]` | `[A, B]` |
| `same_pair[T]` | `[T, T]` |
| `closed_same_pair[]` | `[T, T]`, with a fresh private `T` per instantiation |
| `any_pair[]` | `[(...), (...)]` |

Formal parameters route to their supplied arguments. A repeated private
variable routes the same fresh variable to multiple slots. A private variable
used only once becomes a wildcard. Knots remain internal to the graph.

Consequently, the skeleton hash alone does not identify all constraints of an
alias: its routing arguments matter too. Structural canonicalization also
does not identify every graph accepting the same finite-tree language; for
example, the current implementation distinguishes different unproductive
recursive structures.

## Inspection and persistence

In the REPL, `:pats` lists aliases with parameters, skeleton hashes, and routing
arguments. `:pat name` shows the alias definition; `:pat @hash` inspects a
registered canonical pattern. Hash-addressed patterns can also be defined or
instantiated directly, with all canonical arguments supplied.

Object and library containers preserve:

- `patterns[hash]`: canonical template parameters and filter AST;
- `patternAlias[name]`: alias-to-skeleton hash;
- `meta[hash].origins[]`: original alias parameters and `aliasArgs` routing.

Repeated existential variables must survive export and loading. The
[file-format reference](FILE_FORMATS.md) describes the complete container.

For a host-side pattern export, use:

```sh
printf '%s\n' '?< {} nil, { {} car, X cdr } cons > = X' |
  node patterns/from-k.mjs
```

Run this from the repository root. The canonical property-list result is:

```json
[
  ["closed-union", [["cons", 1], ["nil", 2]]],
  ["closed-product", [["car", 2], ["cdr", 0]]],
  ["closed-product", []]
]
```

This is an inspection representation. The [wire format](../codecs/WIRE_FORMAT.md)
encodes the graph as an ordinary value under the fixed `pattern[]` schema.
