# Pattern and its graph representation

Intuitively, a _pattern_ is an adhock description of a set of codes
by providing some characteristics of the codes. Those characteristics are:

  1. Is this product vs union?
  2. The code has to have field (label) leading to a type or another parretn
  
Code patterns is a graph with:

  1. edges labeled by `fields`
  2. nodes labeled by one of the:

    1. `/*/` - open unkown
    2. `{*}` - open product
    3. `<*>` - open union
    4. `//` - close uknown
    5. `{}` - close product
    6. `<>` - close union

A graph without "open" and "unknown" nodes is "code".

Actually every node in such a graph corresponds to a code pattern.

## Pattern Graph

Example:

    $nat = < {} _, nat 0, nat 1>;
    rlz = $nat <.0._ {{{} _} 0}, .0 rlz, ()>;

We get `codes`:

    id    |       code
    ------|----------------------
    '{}'  | {}
    'nat' | <nat 0, nat 1, {} _>

and the (singleton) forest of expressons:

    id    | ref-name | rel
    ------|----------|--------------
    0     | 'rlz'    | ($nat < (.0 ._ {{{} _} 0}), (.0 rlz), ()>)

### Initialize pattern graph

1. We annotate the expression forest by unique pattern ids, all initialized as `*`, e.g.:

        id | name  | rel*
        ---|-------|-----------------
        0  | 'rlz' |    (    $nat    <    (    .0    ._    {    {    {}    _}     0}     )    ,     (     .0     rlz     )     ,     ()     >     )     
           |       | %0 ( %1 $nat %2 < %3 ( %4 .0 %5 ._ %6 { %7 { %8 {} %9 _} %10 0} %11 ) %12, %13 ( %14 .0 %15 rlz %16 ) %17 , %18 () %19 > %20 ) %21

2. The pattern graph (with 22 nodes) has no edges.

### Pattern graph folding

Given a pattern graph, `(V,E)`, and an expression forest, `F`, we calculate a `folding` of the pattern graph,
which consists of:

1. equivalence classes `eq` over `V + C`
    - `%x $t $y` implies `%x ~ %y ~ $t`
    - `%x ( %y ...)` implies `%x ~ %y`
    - `(... %x ) %y` implies `%x ~ %y`
    - `%x () %y` implies `%x ~ %y`
    - `%x { %y1 ..., %y2 ..., ..., %yn ...}` implies `%x ~ %y1 ~ %y2 ~ ... ~ %yn`
    - `%x < %y1 ..., %y2 ..., ..., %yn ...>` implies `%x ~ %y1 ~ %y2 ~ ... ~ %yn`
    - `<... %y1, ... %y2, ..., ... %yn > %x` implies `%x ~ %y1 ~ %y2 ~ ... ~ %yn`
    - if `%x ~ $t` and `%x .field %y` implies `%y ~ $t.field`
2. new edges, `E'`
    - `%x .field %y` implies `%x -[field]-> %y`
    - `{..., ... %x field, ...} %y` implies `%y -[field]-> %x`
3. pattern refinements, `R`
    - `{... field} %x` implies `%x: <*>`
    - `{... field, ...} %y` implies `%y: {}`

In our example:

`eq: {0,1,nat,2,3,4,11,12,13,14,15,16,17,18,19,20,21}, {5}, {6,7,8}, {9}, {10}`

`E': (4 -[0]-> 5), (5 -[_]-> 6), (10 -[_]-> 9), (11 -[0]-> 10), (14 -[0]-> 15)`

`R: 9:{}, 10:<*>`

By folding the pattern graph with those information we get:

    %n ( %n $nat %n < %n ( %n .0 %n ._ %{} { %{} { %{} {} %{} _} %n 0} %n ) %n, %n ( %n .0 %n rlz %n ) %n , %n () %n > %n ) %n

### Another example

    dec = [(),-1] PLUS;
    zero? = [(),0] EQ 0;
    factorial = < zero? 1, [dec factorial, ()] TIMES >;
    { () x, factorial "x!" }

    name   | rel*
    -------|-----------------
    PLUS   | %1 $[int] %2 PLUS %3 $int %4  
    -1     | %5 {} %6 -1 %7 $int %8
    EQ     | %9 $[int] %10
    dec    | %11 [ %12 () %13, %14 -1 %15 ] %16 PLUS %17
    zero?  | %18 [ %19 () %20, %21 0 %22 ] %23 EQ %24 .0 %25
    

----
Other observations:

Product like {.x ..., .y ...} implies the input is a product (not really valid)
Pattern `p = <{p x, ...}>` implies, it is a union!, i.e., `p = < p x, ... >`, e.g, in `< .x, () >`.
