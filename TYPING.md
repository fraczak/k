# Annotating subexpressions with type patterns

## Input

As input we get AST of a program in terms of a set of function definitions,
i.e., mappings from function names to expressions. Expressions are trees defined
by the following grammar:

```bfn-like
Expression := variable                                   -- reference to a function (has to be defined in AST or built-in)
           | COMP ( Expression, ..., Expression )        -- functional composition
           | type                                        -- identity function forcing type of its input and output
           | PROD { Expression label, ..., Expression label } -- product
           | MERGE < Expression, ..., Expression >       -- union (merge)
           | DOT label                                   -- projection
-- extended with 
           | VECT [ Expression, ..., Expression ]        -- vector 
-- extended with EXPERIMENTAL list-comprehension
           | CARET Expression                            -- list-comprehension aggregation
           | PIPE                                        -- unboxing for list-comprehension (only under CARET)
```

## Output

The output consists of the input AST with all of its nodes annotated with pairs of "type patterns".
Those type patterns define sets of types. Those tye patterns are represented by nodes of the
"type pattern graph" produced by the algorithm.
Ituitively, "type pattern graph" represents correlation between different subexpressions
in the input AST in terms of their input and output types.

More formally, a "type pattern graph" is a directed graph with nodes representing those
"type patterns" and edges, labeled by _projection labels_, representing
correlations between them.

Type pattern, i.e., node in the type pattern graph, is a value of the follwowing type:

```k
$typePattern = < string code, open? product, open? union, {} vector, open? unknown >;
$open? = <{} open, {} closed >;
```

The fields (from union and product types) are represented by edges coming out of the node. 
The edges are labeled by the corresponding labels of the product or union types.
Except for the vector type, which is represented by a unique `vector-member` edge
pointing to the type pattern of the vector memebers.
Flag `open?` indicates if a given type can have more fields than the fields
represented by the outgoing edges.
Variant `unknown` is used to represent an arbitrary type. 
Still, the fields corresponding to the out-going edges must exist in the type.

The output is a mapping from the nodes of the input AST to the nodes of the type pattern graph.

## Algorithm

For every node of the input AST, we define a pair of type patterns.
Intuitively, such a pair, `(in,out)`, represents the
type of the partial function defined by the subtree rooted at the given node.

Let `L` be the list of all those type patterns, i.e., a list of the length
twice the size of the input AST (mesured in number of nodes).
All patterns in `L` are set to `{{open open?} unknown}`.
The list `L` is used to build the type pattern graph by constructing equivalence
classes of the type patterns.
The representation of equivalence classes is slightly different from
the standard disjoint-set data structure, however
we have the same operaitions `find` and `union` on the type patterns.
The difference is that we never modify already exising type patterns, e.g.,
the union (or even just a modification) generates a new type pattern node, so that
the history of unions and modifications of type patterns is preserved.
The equvalence classes, the root nodes of the type patterns forest, are going to be
the nodes of the type pattern graph.


### Rules for type pattern derivation

#### Rule 1: Variable occurrence -- `ref`

In an expression, a variable is a reference to a function (build-in or defined in the AST).
The input and output type patterns of the variable expression have to match the type
patterns of the function.
Since the function can be used in many contexts, the type patterns of the function are
not modified by the expression using the variable.
Let `v` is an occurrence of the variable, i.e., a node in the AST, and `def(v)` is the definition, i.e.,
the root node of the AST subtree defining the function (or built-in) referenced by `v`.

```pseudo
  let (in_v, out_v) = annotation(v)
  let (in_def, out_def) = annotation(def(v))
  let cloned = clone([in_def, out_def])
  let rep_in_v = find(in_v)
  let rep_out_v = find(out_v)
  let rep_in_def = cloned[find(in_def)]
  let rep_out_def = cloned[find(out_def)]

  UNIFY(rep_in_v, rep_in_def) BECAUSE "ref: unified with $rep_in_def"  
  UNIFY(rep_out_v, rep_out_def) BECAUSE "ref: unified with $rep_out_def"
```

The procedure `UNIFY` will be difined later.

#### Rule 2: Functional composition -- `comp`

The input and output type patterns of the composition, `e = COMP(e1, ..., en)`, have to match 
the input type pattern of `e1` and the output type pattern of `en`, respectively. 
In addition, the output type pattern of `ei` has to match the input type pattern of `ei+1`.

```pseudo
  let (in_e, out_e) = annotation(e)
  let (in_e1, out_e1) = annotation(e1)
  ...
  let (in_en, out_en) = annotation(en)
  let rep_in_e = find(in_e)
  let rep_out_e = find(out_e)
  let rep_in_e1 = find(in_e1)
  let rep_out_e1 = find(out_e1)
  ...
  let rep_in_en = find(in_en)
  let rep_out_en = find(out_en)

  UNIFY(rep_in_e, rep_in_e1) BECAUSE "comp: start"  
  UNIFY(rep_out_e, rep_out_en) BECAUSE "comp: end"

  for i = 2 to n:
    let rep_in_ei = find(in_ei)
    let rep_out_ei = find(out_ei)
    UNIFY(rep_out_ei-1, rep_in_ei) BECAUSE "comp: chaining"
  ```  

#### Rule 3: Type -- `type`

The input and output type patterns of a type expression, `type`, are the same,
namely `{type code}`, where `type` is the canonical name for the type.

```pseudo
  let (in_type, out_type) = annotation(type)
  let rep_in_type = find(in_type)
  let rep_out_type = find(out_type)
  let type_node = CREATE_OR_FIND_TYPE_PATTERN_GRAPH_NODE_FOR_TYPE(type)
  UNIFY (type_node, rep_in_type ,rep_out_type) BECAUSE "type"
```

#### Rule 3: Product -- `prod` and `variant`

Let `p = PROD{e1 l1, ..., en ln}` be a product expression, i.e., n != 1.
There are two rules, one saying that input types of all inner
expressions must be the same and it is the input type of `p`.
The second rule says, that the output type is a product with
fiels `l1, ..., ln` of types corresponding to the output
types of `e1,..., en`, respectively.

```pseudo
  let (in_p, out_p) = annotation(p)
  let rep_in_p = find(in_p)
  let rep_out_p = find(out_p)
  for i = 1 to n
    let (in_ei,out_ei) = annotation(ei)
    let rep_in_ei = find(in_ei)
    let rep_out_ei = find(out_ei)
  UNIFY(rep_in_p, rep_in_e1, ..., rep_in_en) BECAUSE "prod: input"

  IF : CHECK IF WE SHOULD DO IT BY CHECKING IF rep_out_p IS ALREADY
     : a closed product and has the edges going where they should
    let aux_out_p = CREATE_TYPE_PATTERN_GRAPH_NODE({}) WITH_EDGES  
      TO rep_out_e1 BY l1, 
         ..., 
         rep_out_en BY ln
    UNIFY(aux_out_p, rep_out_p) BECAUSE "prod: output"
```

If `p = {e1 l1}`, the result will be of variant type, with at least one variant 
label `l1` and of type corresponding to output type of `e1`.

```pseudo
  let (in_p, out_p) = annotation(p)
  let rep_in_p = find(in_p)
  let rep_out_p = find(out_p)
  let (in_e1,out_e1) = annotation(e1)
  let rep_in_e1 = find(in_e1)
  let_rep_out_e1 = find(out_e1)
  UNIFY(rep_in_p, rep_in_e1) BECAUSE "variant: input"

  IF : CHECK IF WE SHOULD DO IT BY CHECKING IF rep_out_p IS ALREADY
     : an open union and has an edge labeled by l1 going to rep_out_e1
    let aux_out_p = CREATE_TYPE_PATTERN_GRAPH_NODE(<...>) WITH_EDGES  
      TO rep_out_e1 BY l1
    UNIFY(aux_out_p, rep_out_p) BECAUSE "variant: output"
```

#### Rule 4: Merge -- 'merge'

Let `u = MERGE<e1, ..., en>` be a merge expression. There is one rule,
all pairs of types for `u, e1, ..., en` have to be the same.

```pseudo
  let (in_u, out_u) = annotation(u)
  let rep_in_u = find(in_u)
  let rep_out_u = find(out_u)
  for i = 1 to n
    let (in_ei,out_ei) = annotation(ei)
    let rep_in_ei = find(in_ei)
    let_rep_out_ei = find(out_ei)
  UNIFY(rep_in_u, rep_in_e1, ..., rep_in_en) BECAUSE "merge:input"
  UNIFY(rep_out_u, rep_out_e1, ..., rep_out_en) BECAUSE "merge:output"
```

#### Rule 5: Projection - `dot`

Let `d = DOT(l)` be a projection expression. The input type will have to have a field `l`.
The output type is the type of the field `l`.

WARNING: .3, .true. ."bla", etc... may be used with built-in types!!!

```pseudo
  let (in_d, out_d) = annatation(d)
  let rep_in_d = find(in_d)
  let rep_out_d = find(out_d)

  IF : CHECK IF WE SHOULD DO IT BY CHECKING IF rep_in_d 
     : has already an edge labeled by l going to rep_out_d
    let new_in_d = CREATE_TYPE_PATTERN_GRAPH_NODE((...)) WITH_EDGES  
      TO rep_out_d BY l
    UNIFY(aux_in_d, rep_in_d) BECAUSE "dot"
```

**Special cases are needed** for `vector` and built-in string, int, bool

#### Rule 6: Vector - `vector`

If `v = VECT[e1,...,en]` is a vector expression, then the input type for
`v, e1, ..., en` is the same, and the output type for all `e1, ..., en`
is the same, say `t`. 
The output type for `v` is `[t]`.

```pseudo
  let (in_v, out_v) = annotation(v)
  let rep_in_v = find(in_v)
  let rep_out_v = find(out_v)
  for i = 1 to n
    let (in_ei,out_ei) = annotation(ei)
    let rep_in_ei = find(in_ei)
    let_rep_out_ei = find(out_ei)
  UNIFY(rep_in_v, rep_in_e1, ..., rep_in_en) BECAUSE "vector: input"

  IF : CHECK IF WE SHOULD DO IT BY CHECKING IF rep_out_v is a vector 
     : with edge labeled by "vector-member" going to rep_in_v
    let new_out_v = CREATE_TYPE_PATTERN_GRAPH_NODE([]) WITH_EDGES  
      TO rep_in_v d BY 'vector-member'
    UNIFY(new_out_v, rep_out_v) BECAUSE "vector: output"
```

#### Rule 7: Caret - `caret`

Let `c = CARET(e)` be a list comprehension aggregation.
The input type is the same as the input type of `e`.
The output type of `c` is the vector of the output type of `e`.

```pseudo
  let (in_c, out_c) = annotation(c)
  let rep_in_c = find(in_c)
  let rep_out_c = find(out_c)
  let (in_e, out_e) = annotation(e)
  let rep_in_e = find(in_e)
  let rep_out_e = find(out_e)
  UNIFY(rep_in_c, rep_in_e) BECAUSE "caret: input"

  IF : CHECK IF WE SHOULD DO IT BY CHECKING IF rep_out_c is a vector 
     : with edge labeled by "vector-member" going to rep_out_e  
    let aux_out_c = CREATE_TYPE_PATTERN_GRAPH_NODE([]) WITH_EDGES 
      TO rep_out_e BY "vector_member"
    UNIFY(aux_out_c, rep_out_c) BECAUSE "caret: output"
```

#### Rule 8: Pipe - `pipe`

Let `p = PIPE` be an unboxing operator for list comprehension.
The input type is a vector type.
The output type is the type of the vector members.

```pseudo
  let (in_p, out_p) = annotation(p)
  let rep_in_p = find(in_p)
  let rep_out_p = find(out_p)

  IF : CHECK IF WE SHOULD DO IT BY CHECKING IF rep_in_p is a vector 
     : with edge labeled by "vector-member" going to rep_out_p  
    let aux_in_p = CREATE_TYPE_PATTERN_GRAPH_NODE([]) WITH_EDGES 
      TO rep_out_p BY "vector_member"
    UNIFY(aux_in_p, rep_in_p) BECAUSE "pipe"
```

---

## Helper functions

There are two data-structures: 

1. `typePatternForest` -- the leaves of the forest are the type patterns of
    the input AST nodes. Inner nodes are the type patterns generated by the rules.

2. `typePatternGraph` -- the nodes are the roots of the typePatternForest.
    The edges are labeled by the projection labels plus "vector_member", and
    in general can lead to many nodes (represented as a list w/o repetition).

### `UNIFY _, _, ...`

The procedure `UNIFY` takes as parameter a list of `typePatternGraph` nodes which all have to represent the same pattern.
The procedure modifies both, the `typePatternForest` and the `typePatternGraph`.

Also, the procedure may Fail if the nodes are not unifiable.

The recursive procedure `UNIFY(n1,...,nn)` is defined as follows:

```pseudo
   INPUT: n1,...,nn
   let rep_n1,...,rep_nn = find(n1), ..., find(nn)
   if rep_n1 = ... = rep_nn RETURN
   let new_rep = flat-unify(rep_n1, ..., rep_nn)
   ADD new_rep AS_REPRESENTATIVE_FOR rep_n1,..., rep_nn BY_RULE "unify"
   MIGRADE_EDGES_FROM rep_n1,..., rep_nn TO new_rep
   forech edge=(label,{x1,...xk}) FROM new-rep 
      CALL UNIFY(x1,...,xk)
```

Notice that UNIFY is no-op when called with none or one node.

#### `MIGRADE_EDGES_FROM _, _, ... TO _`

Just copy the edges from the source nodes to the target node by combining destinations of the edges by the same label into a set (list without repetition).

#### `flat-unify _, _, ...`

`Flat-unify` is defined as reduce over the list of nodes, with initial value being `(...)`.
The binary reduce function is defined as follows (it is commutative):

| f-unify  | (...) | {...} | <...> |  ()  |  []  |  {}  |  <>  | type
|----------|-------|-------|-------|------|------|------|------|------
|**type**  | type  | type  | type  | type | type | type | type
|**<>**    |  <>   | ERROR | <>    |  <>  | ERROR| ERROR| <>
|**{}**    |  {}   |  {}   | ERROR |  {}  | ERROR|  {}
|**[]**    |  []   |  []   | ERROR |  []  |  []
|**()**    |  ()   |  {}   | <>    |  ()
|**<...>** | <...> | ERROR | <...>
|**{...}** | {...} | {...}
|**(...)** | (...)


### `ADD _ AS_REPRESENTATIVE_FOR _, _, ... BY_RULE _`

Create a new type pattern node as a parrent in `typePatternForest` of other nodes.
A comment explaining how the node was created is added as well.

### `ADD_EDGES_FROM _ TO _, _, ... BY _`

As the name indicates, adds an edge which can lead to many nodes.

Repeat the procedure until the type pattern graph is not changing anymore.

## TODO:

- [X] Redefine built-in CONS and SNOC to allign with no support for non-homogeneous lists
- [X] Integrate filters into typePatters (execution is not affected)
- [/] better type error repporting - the info exists in the pattern parent tree ... in progress
- [ ] Introduce a space/time bounds for type derivation
- [ ] Check for loops, e.g., `$x = < x f, ...>`, `$x = [x]`, `$x = {x f, ...}` -- this
      looks a little arbitrary, but maybe this is actually an important part
