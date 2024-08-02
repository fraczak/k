`Kernel-code` is an experiment aiming to define a "perfect programming language".

## Basics

The language describes "partial first-order functions" on "printable" values. 
The printable values can be seen as rooted, edge labeled, trees, intuitively similar to an
XML or a JSON document. The values are always typed.

### Types (codes)

Formally, a _type_ is a (subclass of) finite tree automata. The type defines a set of its values, 
which corresponds to the set of the trees accepted by the automaton.
Therfore, every type admits unique normal form in terms of its minimal deterministic tree automaton. 

The set of all types can be seen as the universal deterministic (infinit) tree atomaton.  
Every node of that automaton defines a type; only a finite set of nodes are reachable from 
any node.

Types are defined by two constructs:

1. product
2. union (also called tagged or disjoint union)

Given a set (possibly empty) of types `t1, t2, ..., tn` and a set of pairwise different tags (labels) `l1,l2, ... ln`, 

 - by `{ t1 l1, t2 l2, ..., tn ln }` we define a _product type_ with exactly `n` projection functions `.l1`, `.l2`, `...`, `.ln`,
   mapping a value of type `{t1 l1, t2 l2, ..., tn ln}` into a value of type `t1`, `t2`, `...`, `tn`, respectively.
 - by  `< t1 l1, t2 l2, ..., tn ln >` we define a _union type_ with exactly `n` projection functions `.l1`, `.l2`, `...`, `.ln`,
   mapping a value of type `{t1 l1, t2 l2, ..., tn ln}` into a value of type `t1`, `t2`, `...`, `tn`, respectively. 

Intuitively, the projection functions on a product type are all total (meaning, they are defined for every value of the 
input product type), whereas in case of a union type, exactly one projection function is defined 
for a given value of the union type.

Some properties of those types:

1. Singleton product and singleton union types, `{ t label }` and `< t label >`, are equivalent as they have
   the same set of values (and the same projection function `.label`).
2. The empty product type `{}` defines a single value, the one-node tree, also denoted as `{}`.
3. The empty union type `< >` defines no values.


Because of the first property, we will not allow singleton product nor singleton union types in the syntax of the language.
There are two reasons for that:

1. We make the definition of the semantics of a type as 'the set of all trees' work correctly
2. We will be able to use the same systax for values of both product and union types, interpretting a 
   singleton product-like value, e.g., `{ a_value label }`, as a union type value (a variant).  

### Partial functions

A _partial function_ is a function that is not defined for every value of its domain. 

There are three ways of composing partial functions:

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

A `kernel-core` program is a set of definitions of types and partial functions followed by an _expression_, 
which is the partial function the program defines. 

The syntax is as follows:

```
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

1. all defined type names are distinct
2. all defined function names are distinct
3. all label names within a type definition or a `product` expression are locally distinct

The `typing` expression acts as type annotation and can be seen as 'filter', i.e., an identity 
function defined only for the values of the corresponding type.

That's it. 

No `int`, no `if` statement, no `loop`, no `throw`, no _closure_, no _annotations_, and no macros.

Just types and partial functions.

### Normalization

All type names are replaced by the hash of their cannonical representation.

We will also replace the function name by the hash of the normalized unfolded definition of the function. 
Obviously, two different definitions of the same function amy have different hashes. 

This approach solves the problem of modules and imports and opens the door to a universal 
registry of types (schemas) and functions.

## Typing and polymorphism (codes and filters/patterns)

## Universal schema registry

## Serialization and Compilation

## Linking with other languages

## Streams and arrays (map-reduce)











