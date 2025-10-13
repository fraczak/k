# Big Picture

`Kernel-code` is an experiment aiming to define a "perfect programming language".

## Basics

The language describes "partial first-order functions" on "printable" values.
The printable values can be seen as rooted, edge-labeled trees, intuitively similar to an
XML or a JSON document. The values are always typed.

### Types (codes)

Formally, a _type_ is a (subclass of) finite tree automata. The type defines a set of its values,
which corresponds to the set of trees accepted by the automaton.
Therefore, every type admits a unique normal form in terms of its minimal deterministic tree automaton.

Types are defined by two constructs:

1. Product
2. Union (also called tagged or disjoint union)

> Notation: We use native k-like notation as canonical — products `{ T l, ... }` and unions `< T t, ... >`.
> For convenience, JSON-like forms `{ l: T, ... }` and `< t: T, ... >` are also supported and equivalent in meaning.

```bnf
type ::= name | '{' type_label_list '}' | '<' type_label_list '>'
type_label_list ::= /* empty */ | ( type label ',' )* type label 
name ::= IDENTIFIER
label ::= STRING
```

Given a finite (possibly empty) set of types `t1, t2, ..., tn` and a set of pairwise different tags (labels) `l1, l2, ..., ln`,

- by `{ t1 l1, t2 l2, ..., tn ln }`, we define a _product type_ with exactly `n`
  _projection_ functions: `.l1`, `.l2`, `...`, `.ln`.
  Each projection function is mapping a value of type `{t1 l1, t2 l2, ..., tn ln}`
  into a value of type `t1`, `t2`, `...`, `tn`, respectively.
- by `< t1 l1, t2 l2, ..., tn ln >`, we define a _union type_ with exactly `n` projection functions `.l1`, `.l2`, `...`, `.ln`,
  mapping a value of type `<t1 l1, t2 l2, ..., tn ln>` into a value of type `t1`, `t2`, `...`, `tn`, respectively.

Intuitively, the projection functions on a product type are all total (meaning, they are defined for every value of the
input product type), whereas in the case of a union type, exactly one projection function is defined
for a given value of the union type.

Some properties of these types:

1. Singleton product and singleton union types, `{ t label }` and `< t label >`, are equivalent as they have
   the same set of values (and the same projection function `.label`). That's why, we not allow singleton product nor
   singleton union types in the syntax of the language. The other benefit is that we will be able to use the same syntax
   for writing out values of both product and union types, interpretting every singleton product-like value, e.g., `{ a_value label }`,
   as a union type value (a variant).  
2. The empty product type, `{}`, has a single value, called the _unit_
   and also denoted by `{}`, which has no fields.
3. The empty union type, `<>`, has no values.

##### Variant (union) value literal convention

- Variant values are written using single-field product notation.
  - Unit variant `tag`: `{{} tag}` (e.g., `{{} nil}`, `{{} zero}`)
  - Variant with payload `v` at label `tag`: `{ v tag }`
- Example (list): with `$list = < {} nil, {X car, list cdr} cons >`:
  - Empty list: `{{} nil}`
  - Singleton `[v]`: `{{ { v car, {{} nil} cdr } cons }}`
- Angle brackets are for type definitions and merge expressions, not for value literals.

#### Equivalence of types (bisimilarity)

Two (possibly recursive) codes are equivalent iff they are bisimilar over their definition graphs. Concretely, there exists a relation B such that `(t1, t2) ∈ B` if and only if:
- t1 and t2 have exactly the same set of labels/tags;
- if that set is not a singleton, then t1 and t2 are simultaneously products or simultaneously unions;
- for each label/tag `ℓ` in the set, the subcodes under `ℓ` are again related by B.

Equivalence is the largest such bisimulation. Consequences:
- `{ T x }  ≡  < T x >` (singleton product/union coincide),
- `{ A x, B y }  ≢  < A x, B y >` (with 2+ labels, constructors must match).

### Filters (patterns)

A _filter_ is a way of representing a _type class_, i.e, a set of types sharing some struture.
For example, if I wanted to refer to all product types that have a field `f` of type `T`,
I would write a pattern: `?{ T f, ... }`. In general, a filter is defined by:

```bnf
filter ::= name | '$' type_expr | '{' filter_label_list '}'
   | '<' filter_label_list '>' | '(' filter_label_list ')'
   | filter '=' name
filter_label_list ::= /* empty */ | '...'
   | ( filter label ',' ) * filter label
```

Examples:

```k-repl
  X                 -- any type
  ( ... )           -- any type
  { ... }           -- any product type
  ( X x, X y )      -- any type with two fields of the same type
  < X x, ... > = X  -- a (recursive) type, 'X', with variant 'x'
                    -- of the same type 'X' 
```

### Partial functions

A _partial function_ is a function that is not defined for every value of its domain.

There are three ways of combining partial functions:

1. __Composition__: we write a composition of `f` and `g` as `(f  g)`,
   meaning that if `f` is defined on value `x` producing `y`,
   and `g` is defined on value `y` producing `z`, then `(f g)` is defined on value `x` producing `z`.
2. __Union__: we write `< f1, f2 >` for a union of two functions `f1` and `f2`, meaning that
   if `f1` is defined on value `x` producing `y`, then `< f1, f2 >`
   is defined on value `x` producing `y`. Otherwise, i.e., when `f1` is not defined for `x`, `< f1 f2 >` acts as `f2`.
3. __Product__: we write `{f1 lab1, f2 lab2 }` for a product of two functions `f1` and `f2`,
   meaning that if `f1` and `f2` are both defined on value `x` producing `y1` and `y2`,
   respectively, then `{f1 lab1, f2 lab2 }` is defined on value `x` producing
   `{y1 lab1, y2 lab2}`. 
   Otherwise, `{f1 lab1, f2 lab2 }` is not defined for `x`.

Actually, composition, union, and product combine any number of partial functions, not only two. For example,
empty composition, `()`, defines the identity function.

### Program

A `kernel-core` program is a set of definitions of types and partial functions, followed by an _expression_,
which is the partial function the program defines.

The language syntax is defined by:

```bnf
program ::= (type_definition | function_definition)* expression
type_definition ::= '$' type_name '=' type ';'
function_definition ::= name '=' expression ';'
expression ::= name | '$' type | '?' filter 
   | projection | composition | union | product 
projection ::= '.' label
composition ::= '(' expression * ')'  
union ::= '<' (expression ',') + expression '>' 
product ::= '{' expr_label_list '}'
expr_label_list ::= /* empty */ 
   | (expression label_name ',')* expression label
```

We assume that in a `kernel-core` program the names (for types, functions, and labels) are identifiers (strings) such that:

1. All defined type names are distinct.
2. All defined function names are distinct.
3. All label names within a type definition or a `product` expression are locally distinct.

`Filter` or `type` expressions act as a type annotation, i.e., an identity
function defined only for the values of the corresponding types.

That's it.

No `builtin` types, no `if` statement, no `loop`, no `throw`, no _closure_, no _annotations_, and no macros.
Just _types_, _filters_, and _functions_.

### Normalization

All type names are replaced by the hash of their canonical representation.

We replace the function name by the hash of the normalized definition of the function as provided by the program defining the function.
Obviously, a function may have many different definitions so the hash-based names are not canonical. By using hash-based function names we avoid the problem of name clashes when bringing together many `kernel-core` programs.

This approach solves the problem of modules, imports, etc., and opens the door to a universal
registry of types (schemas) and functions.

## Typing and Polymorphism (codes and filters/patterns)

Abstract Syntax Tree of a program consists of a dictionary of _type definitions_,
a dictionary  of _function definitions_, and the final _main expression_.

In principle, the initial form of the Abstract Syntax Tree, _raw_ AST, is enough to evaluate
the program on an input.

Our objective however is to compute canonical representations for types and normalized
representations for functions, so they could be reused.

The normalization steps are:

1. Build the _type graph_ from all types used by the program, i.e., used in _type definitions_ 
   as well as type expressions used in _function definitions_ and the _main expression_.
2. Annotate the expressions with filters; every node of the AST is annotated with a pair of filters.
3. Turn the _singleton_ filters into types and add them to the _type graph_. Go to (2) unless no change.

### Examples

#### Example 1

```k-repl
$ bit = < {} o, {} i >;
bit0 = {{} o} $bit;
bit1 = {{} i} $bit;

$ byte = { bit b0, bit b1, bit b2, bit b3 };
zero = bit0 { () b0, () b1, () b2, () b3 } $byte;

inc = $byte
   <
      { .b0.o bit0  overflown,  {bit1 b0, .b1  b1,  .b2 b2,  .b3 b3 } byte }, 
      { .b1.o bit0  overflown,  {bit0 b0, bit1 b1,  .b2 b2,  .b3 b3 } byte },
      { .b2.o bit0  overflown,  {bit0 b0, bit0 b1, bit1 b2,  .b3 b3 } byte },
      { .b3.o bit0  overflown,  {bit0 b0, bit0 b1, bit0 b2, bit1 b3 } byte },
      { bit1        overflown,  zero                                  byte }
   >  
;

-- inc with overflown flag (polymorphism)
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

In the above program, we define a type `bit` a union of two unit types, 
and a type `byte` as a product, for simplicity, of four `bit`s. 

Functions `bit0`, `bit1`, and `zero` are "constant polymorphic functions", meaning:

- constant: if defined, they always return exactly the same value;
- polymorphic: they are defined for more than one pair of input and output types: functions
  `bit0` and `bit1` are of type `?X -> $bit`, and `zero` is of type `?X -> $byte`, where `?X`
  denotes an unconstrained type pattern, also denoted as `?(...)`.

Functions `inc` and `inc3` are (non-polymorphic) functions of types
`$byte -> ${ bit overflown, byte byte }` and
`${ bit overflown, byte byte } -> ${ bit overflown, byte byte }`, respectively.

Function `inc_o` is a polymorphic function of type patterns: `?X -> ${ byte byte, bit overflown }` 
with following constraints:

- `?X` is a product or union type with at least two fields: `byte` and `overflown`, denoted by:
   > `?( $byte byte, Z overflown, ...)`;
- `?Z` is a type (union or product) with field `i` denoted by:
   > `?( V i, ...)`;
- `V` is unconstrained, denoted by `(...)`;

We can write it as: `?($byte byte, ((...) i, ...) overflown, ...)`.

The target type `${ byte byte, bit overflown }` was derived from pattern `?{ $byte byte, $bit overflown }`.
Such a pattern is called _singleton pattern_, as only one type fits the pattern.

#### Example 2

Polymorphic list functions:

```k-repl
list? = ?< {} nil, {X car, Y cdr} cons > = Y;
nil = {{} nil} list?;
singleton = {{() car, nil cdr} cons} list?;
cons = {{.car car, .cdr cdr} cons} list?;
nil? = list? .nil nil;
car = list? .cons .car;
cdr = list? .cons .cdr;
```

For example, the filter annotation for `car` is:

```k-repl
--R car
{
  name: 'yRXGSJrIWCuKV',
  type: '?<{X1 car, X0 cdr} cons, $KL nil>=X0  -->  ?X1',
  def: '?<{X1 car, X0 cdr} cons, $KL nil>=X0 .cons .car ?X1'
}
--C KL
$ KL = {}; -- $C0={};
```

## Universal Schema Registry

Since the normalization process for types is fast and deterministic, we can build a universal
schema registry that will store all invented types.
The registry will be a key-value store, where the key is the hash of the normalized type,
and the value is the normalized type itself.

All functions (non-polymorphic and polymorphic) will be renamed by the hash of their normalized
definition and stored in the similar key-value store.

Non-polymorphic functions can be easily indexed by the hashes of their input and output types
so that we can quickly find the function we need.
Indexing polymorphic functions seems complicated (TODO).

## Serialization and Compilation

The language is designed to transform _codes_, i.e., serialized typed values, i.e., trees
accepted by a tree automaton, into other _codes_.
The transformation is done by partial functions as defined in the language.
The non-recursive and tail-recursive (and even some non-tail recursive) functions can
be compiled into deterministic finite (pushdown) transducers.

### AND-OR graphs for enconding and decoding codes

This could be generic and compact way to encode and decode typed values.
The idea is to use _prefix codes_ (a class of languages such that no word is a prefix of
another word) to encode the values.

### RUST data structures

A type can be translated into a Rust data structure, and a function can be translated into a Rust function.

## Linking with Other Languages

## Streams and Arrays (Map-Reduce)

## Bits

Extending `@string` into `@bits`. 

```k-repl
$ bits = < {} _, bits 0, bits 1 >;
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

### Two operations on `@bits`:

#### Eat `/`

- `$@bits / @bits` --- division, e.g., `0b1011 / 0b10` = `0b11`, `"abc" / "a"` = `"bc"`

#### Prepend `\`

- `$@bits \ @bits` --- multiplication, e.g., `0b11 \ 0b10` = `0b1011`, `"bc" \ "a"` = `"abc"`

Empty `bits` can be checked by

```k

kind = $@bits 
  < {/ 0b0 \ 0b0 starts_with_0}, {/ 0b1 \ 0b1 starts_with_1}, {() empty} > 
  $< @bits starts_with_0, @bits starts_with_1, @bits empty >;
```
