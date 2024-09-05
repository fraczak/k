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

The set of all types can be seen as the universal deterministic (infinite) tree automaton.
Every node of that automaton defines a type; only a finite set of nodes are reachable from
any node.

Types are defined by two constructs:

1. Product
2. Union (also called tagged or disjoint union)

Given a finite (possibly empty) set of types `t1, t2, ..., tn` and a set of pairwise different tags (labels) `l1, l2, ..., ln`,

- by `{ t1 l1, t2 l2, ..., tn ln }`, we define a _product type_ with exactly `n` projection functions `.l1`, `.l2`, `...`, `.ln`,
  mapping a value of type `{t1 l1, t2 l2, ..., tn ln}` into a value of type `t1`, `t2`, `...`, `tn`, respectively.
- by `< t1 l1, t2 l2, ..., tn ln >`, we define a _union type_ with exactly `n` projection functions `.l1`, `.l2`, `...`, `.ln`,
  mapping a value of type `<t1 l1, t2 l2, ..., tn ln>` into a value of type `t1`, `t2`, `...`, `tn`, respectively.

Intuitively, the projection functions on a product type are all total (meaning, they are defined for every value of the
input product type), whereas in the case of a union type, exactly one projection function is defined
for a given value of the union type.

Some properties of these types:

1. Singleton product and singleton union types, `{ t label }` and `< t label >`, are equivalent as they have
   the same set of values (and the same projection function `.label`). That's why, we not allow singleton product nor
   singleton union types in the syntax of the language. The other benefit is that we will be able to use the same systax
   for values of both product and union types, interpretting every singleton product-like value, e.g., `{ a_value label }`,
   as a union type value (a variant).  
2. The empty product type `{}` has a single value, called the _unit_ and also denoted by `{}`, which has no fields.
3. The empty union type `<>` has no values.

### Partial functions

A _partial function_ is a function that is not defined for every value of its domain.

There are three ways of combining partial functions:

1. __Composition__: we write a composition of `f` and `g` as `(f  g)`, meaning that if `f` is defined on valye `x` producing `y`,
   and `g` is defined on value `y` producing `z`, then `(f g)` is defined on value `x` producing `z`.
2. __Union__: we write `< f1, f2 >` for a union of two functions `f1` and `f2`, meaning that
   if `f1` is defined on value `x` producing `y`, then `< f1, f2 >`
   is defined on value `x` producing `y`. Otherwise, i.e., when `f1` is not defined for `x`, `< f1 f2 >` acts as `f2`.
3. __Product__: we write `{f1 lab1, f2 lab2 }` for a product of two functions `f1` and `f2`, meaning that if `f1` and `f2`
   are both defined on value `x` producing `y1` and `y2`, respectively, then `{f1 lab1, f2 lab2 }`
   is defined on value `x` producing `{y1 lab1, y2 lab2}`. Otherwise, `{f1 lab1, f2 lab2 }` is not defined for `x`.

Actually, all of the above operations take any number of arguments, not only two. For example,
empty composition, `()`, defines the identity function.

### Program

A `kernel-core` program is a set of definitions of types and partial functions, followed by an _expression_,
which is the partial function the program defines.

The language syntax is defined by:

```bnf
program ::= (type_definition | function_definition) * expression

type_definition ::= '$' type_name '=' type ';'
type ::= '{' type_label_list '}' | '<' type_label_list '>'
type_label_list ::= /* empty */ | ( type_expression label_name ',' ) + type_expression label_name
type_expression ::= type_name | type

function_definition ::= function_name '=' expression ';'
expression ::= projection | typing | composition | union | product | function_name
projection ::= '.' label_name
typing ::= '$' tape_expression 
composition ::= '(' expression * ')'  
union ::= '<' (expression ',') + expression '>' 
product ::= '{' expression_label_list '}'
expression_label_list ::= /* empty */ | ( expression label_name ',' ) * expression label
```

We assume that the `type_name`, `function_name`, and `label_name` are identifiers (strings) such that:

1. All defined type names are distinct.
2. All defined function names are distinct.
3. All label names within a type definition or a `product` expression are locally distinct.

The `typing` expression acts as a type annotation and can be seen as a 'filter', i.e., an identity
function defined only for the values of the corresponding type.

That's it.
No `builtin` types, no `if` statement, no `loop`, no `throw`, no _closure_, no _annotations_, and no macros.
Just types and partial functions.

### Normalization

All type names are replaced by the hash of their canonical representation.

We will also replace the function name by the hash of the normalized unfolded definition of the function.
Obviously, two different definitions of the same function may have different hashes.

This approach solves the problem of modules and imports and opens the door to a universal
registry of types (schemas) and functions.

## Typing and Polymorphism (codes and filters/patterns)

Abstract Syntax Tree of a program after parsing consists of a dictionary of _type definitions_,
a dictionary  of _function definitions_, and the final _main expression_.

In principle, the initial form of the Abstract Syntax Tree, _raw_ AST, is enough to evaluate
the program on an input.

Our objective however is to compute canonicals representations for types and normalized
representations for functions, so they could be effectively reused.

The normalization steps are:

1. Build the _type graph_ from all types used by the program, i.e., used in _type definitions_ 
   as well as type expressions used in _function definitions_ and the _main expression_.
2. Annotate the expressions with types or type patterns; every node of the AST is annotated with a pair of type patterns.
3. Turn the _singleton_ type patterns into types and add them to the _type graph_. Go to (2) unless no change.
4. Normalize the function definitions by rewriting them as the fix-point of a single equation.

### Example

```k
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
- polymorphic: they are defined for more than one pair of input and output type: functions
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

We could write it as: `?($byte byte, ((...) i, ...) overflown, ...)`.

The target type `${ byte byte, bit overflown }` was derived from pattern `?{ $byte byte, $bit overflown }`.
Such a pettern is called _singleton pattern_ as only one type fits the pattern.

## Universal Schema Registry

Since the normalization process for types is fast and deterministic, we can build a universal
schema registry that will store all invented types. 
The registry will be a key-value store, where the key is the hash of the normalized type,
and the value is the normalized type itself.

All functions (non-polymorphic and polymorphic) will be renamed by the hash of their normalized
definition and stored in the similar key-value store.

Non-polymorphic functions can be easily indexed by the hashes of their input and output types
so that we can quickly find the function we need.
Searching for polymorphic functions is more complicated, as we need to find the function
whose input and output type patterns fit given types.

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