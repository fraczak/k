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

