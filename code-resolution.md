# code pattern

Every code can be seen as a singleton pattern. 

1. Product: `{c1 f1, c2 f2, c3 f3}`

    more general patterns:

    1. `{}

From other end:

`<{...}>` - any code
`{...}` - any product
`<...>` - any union
`<{ pattern fiels, ...}>`

Code pattern will be a tree (and-or rooted graph) with edges labeled by `fields` and the following nodes:

1. `*`
2. `{*}`
3. `<*>`
6. `//`
4. `{}`
5. `<>`

The graph only with "closed" nodes is "code".

Partial order over code patterns (should agree with sets of values):

- min element: single node `<>`,
- max element: single node `*`,
- `<*>(l1:p1) > <*>(l1:q1,l2:p2)`, if `p1 > q1`
- `{*}(l1:p1) > {*}(l1:q1,l2:p2)`, if `p1 > q1`
- `*(l1:p1) > <*>(l1:q1)`, if `p1 > q1`
- `*(l1:p1) > {*}(l1:q1)`, if `p1 > q1`

## Questions

1. How to decide whether `p1 > p2`?
2. greatest lower bound, least upper bound (lattice).

`{*}(l1:p1) \cap {*}(l2:p2) = {*}(l1:p1,l2:p2)`
`{}(l1:p1) \cap {}(l2:p2) = <>()` unless `l1=l2` otherwise `{}(l1:p1\cap p2)`

## Pettern Graph

Example:

    $nat = < {} _, nat 0, nat 1>;
    rlz = $nat <.0._ {{{} _} 0}, .0 rlz, ()>;

We get `codes`:

    id    |       code
    -----------------------------
    '{}'  | {}
    'nat' | <nat 0, nat 1, {} _>

and the (singleton) forest of expressons:

    id    | ref-name | rel
    --------------------------------
    0     | 'rlz'    | ($nat < (.0 ._ {{{} _} 0}), (.0 rlz), ()>)

### Initialize pattern graph

1. We annotate the expression forest by unique pattern ids, all initialized as `*`, e.g.:
   
    id    | ref-name | rel*
    --------------------------------
    0     | 'rlz'    |    (    $nat    <    (    .0    ._    {    {    {}    _}     0}     )    ,     (     .0     rlz     )     ,     ()     >     )     
          |          | %0 ( %1 $nat %2 < %3 ( %4 .0 %5 ._ %6 { %7 { %8 {} %9 _} %10 0} %11 ) %12, %13 ( %14 .0 %15 rlz %16 ) %17 , %18 () %19 > %20 ) %21

2. The pattern graph (with 22 nodes) has no edges.

### Pattern graph folding

Given a pattern graph, `(V,E)`, and an expression forest, `F`, we calculate a `folding` of the pattern graph,
which consists of:

1. equivalence classes `eq` over `V + C`
2. new edges, `E'`
3. pattern refinements, `R` 

In our example:

`eq: {0,1,nat,2,3,4,11,12,13,14,15,16,17,18,19,20,21}, {5}, {6,7,8}, {9}, {10}`
`E': (4 -[0]-> 5), (5 -[_]-> 6), (10 -[_]-> 9), (11 -[0]-> 10), (14 -[0]-> 15)`
`R`: 9:{}, 10:<*>

By folding the pattern graph with those information we get:

    %n ( %n $nat %n < %n ( %n .0 %n ._ %{} { %{} { %{} {} %{} _} %n 0} %n ) %n, %n ( %n .0 %n rlz %n ) %n , %n () %n > %n ) %n
