# Big Picture

`k` is a minimal, unified calculus of **content-addressable schemas** and
**relational data transformations**.

## Basics

The language describes first-order partial relations on labeled tree values.
Values are rooted, edge-labeled trees, intuitively similar to an XML or a JSON
document. Every value is self-describing at boundaries as a pair:
`(schema, payload)`.

### Schemas

Formally, a _schema_ is a finite tree automaton. The schema defines a set of
values, which corresponds to the language of trees accepted by the
automaton. Therefore, every schema admits a unique canonical normal form in
terms of its minimal deterministic tree automaton.

Schemas are built from two structural constructors:

1. **Product** (`{ ... }`)
2. **Union** (`< ... >`) (tagged or disjoint union of variants)

> Notation: Native k notation uses products `{ S l, ... }` and unions
> `< S t, ... >`. The empty product `{}` has a single value (the _unit_).
> The empty union `<>` has no values.

```bnf
schema ::= name | '{' schema_label_list '}' | '<' schema_label_list '>'
schema_label_list ::= /* empty */ | ( schema label ',' )* schema label
name ::= IDENTIFIER
label ::= STRING
```

Given a finite (possibly empty) set of schemas `s1, s2, ..., sn` and a
set of pairwise distinct labels `l1, l2, ..., ln`:

- `{ s1 l1, s2 l2, ..., sn ln }` defines a _product schema_ with
  `n` projection relations: `.l1`, `.l2`, `...`, `.ln`.
  Each projection maps a value matching the product schema into a value
  matching `s1`, `s2`, `...`, `sn`, respectively.
- `< s1 l1, s2 l2, ..., sn ln >` defines a _union schema_ with
  `n` projection relations `/l1`, `/l2`, `...`, `/ln`,
  mapping a variant into its payload matching `s1`, `s2`, `...`, `sn`.

#### Variant (Union) Values

- Variant values are constructed using "|" (pipe) followed by the tag:
  - Unit variant: `{} | nil`, `{} | zero`
  - Variant with payload `v` at tag: `v | tag`
- Example (list): with `list = ?< {} nil, { X car, L cdr } cons > = L;`:
  - Empty list `[]`: `{} | nil`
  - Singleton `[v]`: `{ v car, {} | nil cdr } | cons`
- Angle brackets `< ... >` denote ordered choice (union expressions); use
  `| tag` for variant construction.

#### Equivalence of Schemas (Bisimilarity)

Two (possibly recursive) schemas are equivalent iff they are bisimilar
over their definition graphs. Concretely, there exists a relation B
such that `(s1, s2) ∈ B` if and only if:
- `s1` and `s2` have exactly the same set of labels/tags;
- `s1` and `s2` are simultaneously products or simultaneously unions;
- for each label/tag `ℓ`, the subschemas under `ℓ` are again related by B.

Canonicalization erases local variable names and deterministically orders
states, so any two structurally equivalent schemas yield identical canonical text.

### Filters

A _filter_ is a syntactic expression `?schema` that acts as a partial identity
relation on values conforming to `schema`. If the input value matches the
schema, it passes through unchanged; otherwise, the relation is undefined.

In recursive relations, filters also serve as **inductive termination witnesses**,
ensuring type and contract derivation converges.

In general, a filter schema is defined by:

```bnf
filter ::= name | '{' filter_label_list '}'
   | '<' filter_label_list '>' | '(' filter_label_list ')'
   | filter '=' name
filter_label_list ::= /* empty */ | '...'
   | ( filter label ',' ) * filter label
```

Examples:

```text
  X                 -- unconstrained schema variable
  ( ... )           -- unconstrained schema
  { ... }           -- any product schema
  ( X x, X y )      -- any product schema with two fields of the same schema X
  < X x, ... > = X  -- a recursive variant schema X with variant x of schema X
```

### Partial functions

A _partial function_ is a function that is not defined for every value
of its domain.

There are three ways of combining partial functions:

1. __Composition__: we write a composition of `f` and `g` as `(f g)`,
   meaning that if `f` is defined on value `x` producing `y`, and `g`
   is defined on value `y` producing `z`, then `(f g)` is defined on
   value `x` producing `z`.
2. __Union__: we write `< f1, f2 >` for a union of two functions `f1`
   and `f2`, meaning that if `f1` is defined on value `x` producing
   `y`, then `< f1, f2 >` is defined on value `x` producing `y`.
   Otherwise, i.e., when `f1` is not defined for `x`, `< f1, f2 >`
   acts as `f2`.
3. __Product__: we write `{f1 lab1, f2 lab2 }` for a product of two
   functions `f1` and `f2`, meaning that if `f1` and `f2` are both
   defined on value `x` producing `y1` and `y2`, respectively, then
   `{f1 lab1, f2 lab2 }` is defined on value `x` producing
   `{y1 lab1, y2 lab2}`. Otherwise, `{f1 lab1, f2 lab2 }` is not
   defined for `x`.

Actually, composition, union, and product combine any number of
partial functions, not only two. For example, empty composition,
`()`, defines the identity function.

### Program

A `kernel-core` program is a set of definitions of relations (partial
functions), followed by an _expression_, which is the relation the
program evaluates.

The language syntax is defined by:

```bnf
program ::= function_definition* expression
function_definition ::= name '=' expression ';'
expression ::= name | '?' filter 
   | projection | constructor | composition | union | product 
projection ::= '.' label | '/' label
constructor ::= '|' label
composition ::= '(' expression * ')'  
union ::= '<' (expression ',') * expression '>' 
product ::= '{' expr_label_list '}'
expr_label_list ::= /* empty */ 
   | (expression label_name ',')* expression label
```

We assume that in a `kernel-core` program the names (for relations
and labels) are identifiers (strings) such that:

1. All defined relation names are distinct.
2. All label names within a `product` expression are locally distinct.

Filters act as partial identity relations defined only for the values
matching the corresponding schema, while also serving as inductive witnesses
for recursive relation termination.

That's it.

No `builtin` types, no `if` statement, no `loop`, no `throw`, no
_closure_, no _annotations_, and no macros. Just _schemas_, _filters_,
and _relations_.

### Normalization and Content-Addressing

All schemas are normalized to the canonical text representation of their
minimal deterministic tree automaton. That canonical representation is their
true identity; `@hash` is an immutable, fixed-width index digest.

Every relation is identified canonically by the content-addressed hash
of its normalized definition AST.

There is no global symbol namespace. Human-readable names (such as
`plus`, `int`, or `5`) are local aliases recorded in object metadata
(`relAlias`). When libraries are loaded with `--lib`, definitions are
identified by their canonical `@hash`, but local aliases are not
implicitly exported into the importing scope unless explicitly mapped
via `--export`.

This approach completely solves the problem of modules, name collisions,
and unversioned imports, establishing a universal registry of
schemas and relations.

## Schemas, Contracts, and Derivation

The abstract syntax tree of a program consists of a dictionary of
relation definitions and an optional entry expression.

The compiler computes canonical representations for schemas and derives
a **contract** for every relation: a connected $(input, output)$ schema
graph where shared vertices ($=X$) prove that input substructures are
preserved through to the output.

The contract derivation steps are:

1. Initialize the schema graph from primitive operations (projections, constructors, products) and explicit filter annotations.
2. Propagate schemas forward and backward through compositions, products, and choices until reaching a fixed point.
3. Validate inductive convergence for recursive relations using filter witnesses.

### Examples

#### Example 1

```text
bit = ?< {} o, {} i >;
bit0 = | o;
bit1 = | i;

byte = ?{ bit b0, bit b1, bit b2, bit b3 };
zero = bit0 { () b0, () b1, () b2, () b3 };

inc = byte
   <
      { bit0 overflown,  { .b0 /o bit1 b0, .b1  b1,  .b2 b2,  .b3 b3 } byte }, 
      { bit0 overflown,  { bit0 b0, .b1 /o bit1 b1,  .b2 b2,  .b3 b3 } byte },
      { bit0 overflown,  { bit0 b0, bit0 b1, .b2 /o bit1 b2,  .b3 b3 } byte },
      { bit0 overflown,  { bit0 b0, bit0 b1, bit0 b2, .b3 /o bit1 b3 } byte },
      { bit1 overflown,  zero                                         byte }
   >  
;

-- inc with overflown flag
inc_o = 
  { .byte inc inc, .overflown overflown }  
  {
    .inc.byte                             byte, 
     <.overflown.i bit1, .inc.overflown > overflown
  }
;

inc3 = inc inc_o inc_o;

inc3
```

In the above program, we define relation `bit` as a union of two unit variants,
and relation `byte` as a product of four `bit`s.

Relations `bit0`, `bit1`, and `zero` are "constant polymorphic
relations", meaning:

- constant: if defined, they always return exactly the same value;
- polymorphic: they are defined for more than one pair of input and
  output schemas: relations `bit0` and `bit1` have contract `?X -> bit`,
  and `zero` has contract `?X -> byte`, where `?X` denotes an
  unconstrained open schema, also denoted as `?(...)`.

Relations `inc` and `inc3` are relations with contracts
`byte -> { bit overflown, byte byte }` and
`{ bit overflown, byte byte } -> { bit overflown, byte byte }`,
respectively.

Relation `inc_o` is a polymorphic relation with contract:
`?X -> { byte byte, bit overflown }` with the following input schema constraints:

- `?X` is a product with at least two fields: `byte` and
  `overflown`, denoted by:
   > `?{ byte byte, Z overflown, ...}`;
- `?Z` is a union with field `i` denoted by:
   > `?< V i, ...>`;
- `V` is unconstrained, denoted by `(...)`;

We can write it as: `?{ byte byte, <(...) i, ...> overflown, ...}`.

The target schema `{ byte byte, bit overflown }` corresponds to filter
`?{ byte byte, bit overflown }`. Such a schema is called a _closed
schema_, as all constructors are fully determined.

#### Example 2

Polymorphic list relations:

```text
list? = ?< {} nil, {X car, Y cdr} cons > = Y;
nil = {} |nil list?;
singleton = {() car, nil cdr} |cons list?;
cons = {.car car, .cdr cdr} | cons list?;
nil? = list? /nil nil;
car = list? /cons .car;
cdr = list? /cons .cdr;
```

For example, the definition for `car` is:

```text
> :rel car
car = list? /cons .car;  -- @...
```

## Universal Schema Registry

Since the normalization process for schemas is fast and deterministic,
we can build a universal schema registry that will store all discovered
schemas. The registry is a key-value store, where the primary identity is
the canonical textual definition (or fixed-width hash) of the normalized
schema, and the value is the normalized schema automaton itself.

All relations (monomorphic and polymorphic) are named by the hash
of their normalized definition and stored in a similar key-value store.

Relations can be indexed by their derived contracts—the connected $(input, output)$
schema graph—enabling instant lookup of transformations that map between specific schemas
or preserve specific subtrees ($=X$).

## Serialization and Compilation

The language is designed to transform self-describing binary streams of
`(schema, payload)`, where the payload is a labeled tree conforming to the
accompanying schema. The transformation is executed by partial relations
defined in the language. Non-recursive and tail-recursive (and even some
non-tail-recursive) relations can be compiled into deterministic finite
(pushdown) transducers.

Ahead-Of-Time (AOT) compilation produces four primary file formats (see
[`DOCS/FILE_FORMATS.md`](./FILE_FORMATS.md)):
- `.k`: Plain source text defining schemas and relations.
- `.ko`: AOT contract-checked executable object container (`KOBJ\n` + JSON).
- `.klib`: AOT contract-checked library container (JSON).
- `.kvm`: Polymorphic register-IR template (`layer: "KVM-P"`).

Downstream backends compile or specialize these into WebAssembly
(`.wasm`) and native binaries.

### AND-OR graphs for encoding and decoding payloads

This provides a generic and compact way to encode and decode payload
values under an algebraic schema. The idea is to use _prefix codes_ (a class of languages such
that no word is a prefix of another word) to encode variant payloads deterministically.

### Rust data structures

A schema can be translated into a Rust data structure, and a relation
can be translated into a Rust function.

## Linking with Other Languages

## Streams and Arrays (Map-Reduce)

## Bits and Absence of Built-in Numbers

In `k`, there are no primitive numbers or built-in integer literals.
Numerical identifiers such as `5` or `10` are nullary relations
(constants) mapping the unit `{}` to bit trees of contract `{} -> bits`.
Arithmetic relations operate on signed integers (`int`), requiring
conversion via `5 int`.

Bit trees are defined algebraically:

```text
bits = ?< {} _, B 0, B 1 > = B;
```

### Literals for `@bits` are:

- `0b` for 0 bits
- `0b10` for 2 bits
- `0xF` for 4 bits
- `0xF0` for 8 bits
- `0o1` for 3 bits
- `0o7` for 3 bits
- "" for 0 bits
- "ala" for 24 bits

### Two operations on `bits`:

#### Eat `/`

- `bits / bits` --- division, e.g., `0b1011 / 0b10` = `0b11`,
  `"abc" / "a"` = `"bc"`

#### Prepend `\`

- `bits \ bits` --- multiplication, e.g., `0b11 \ 0b10` = `0b1011`,
  `"bc" \ "a"` = `"abc"`

Empty `bits` can be checked by:

```k
kind = bits 
  < {/ 0b0 \ 0b0 starts_with_0}, {/ 0b1 \ 0b1 starts_with_1}, {() empty} > 
  < bits starts_with_0, bits starts_with_1, bits empty >;
```

## Further Reading

- [DOCS/FILE_FORMATS.md](./FILE_FORMATS.md) — guide to
  .k, .ko, .klib, and .kvm formats
- [DOCS/DICTIONARY.md](./DICTIONARY.md) — concept names and terminology
- [DOCS/TYPE_DERIVATION.md](./TYPE_DERIVATION.md) — type derivation
  algorithm
- [DOCS/OBJECT_FILE_AND_PATTERN.md](./OBJECT_FILE_AND_PATTERN.md) —
  object format and schema encoding
