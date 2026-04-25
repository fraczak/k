# Patterns And Typed Values

## Abstract

This note proposes a semantic foundation for `k` patterns, types, typed values, and polymorphic values.
The central point is that a value in `k` is not a bare tree: it exists only in the context of a type.
Accordingly, a pattern denotes a set of types, and therefore also a set of **typed** values, not a set of raw trees.
This distinction is essential for reasoning about equality, polymorphism, and binary serialization with DAG compression.

## 1. Introduction

The `k` language manipulates algebraic values built from products and unions.
At first sight one may be tempted to define a value simply as a rooted labeled tree and then define types as sets of such trees.
For `k`, this is not the right semantic level.

Two trees with the same shape but belonging to different types are different values.
Type is part of value identity.

This leads to the following semantic ladder:

- a **type** denotes a set of typed values,
- a **pattern** denotes a set of types,
- therefore a **pattern** also denotes a set of typed values,
- a **polymorphic value** is a pattern together with a typed value compatible with that pattern.

The rest of this note makes these notions precise.

## 2. Types

A **type graph** is a finite rooted directed graph with labeled edges.
Each node is one of:

- `product`,
- `union`.

For a product node, outgoing edge labels are field names.
For a union node, outgoing edge labels are tags.
Edges are locally unique by label.

The graph may be cyclic, which allows recursive types.

Two type graphs that are equivalent as regular tree languages may be identified.
For types, minimization by bisimulation is appropriate.

### 2.1. Trees accepted by a type

Let `Tree(T)` denote the set of rooted value trees accepted by a type graph `T`.
Acceptance is defined in the standard way:

- a product tree is accepted by a product node when its fields match the outgoing labels of that node and each child tree is accepted by the corresponding target node,
- a union tree is accepted by a union node when it chooses exactly one outgoing tag and the child tree is accepted by the corresponding target node.

## 3. Typed Values

A **typed value** is a pair

```text
(T, t)
```

where:

- `T` is a type graph,
- `t ∈ Tree(T)`.

Thus a value is intrinsically typed.
The tree `t` is only a representation of the value; it is not, by itself, a semantic value of the language.

We write:

```text
Val(T) = { (T, t) : t ∈ Tree(T) }.
```

### 3.1. Identity of typed values

Typed values are intensional with respect to the type:

```text
(T, t) ≠ (U, t)    whenever T ≠ U.
```

Even when the same raw tree `t` is accepted by both `T` and `U`, the two typed values are different.

This point is essential for serialization: the identity of a value cannot be recovered from the raw tree alone.

## 4. Patterns

A **pattern graph** is a finite rooted directed graph with labeled edges.
Each node carries:

- a node kind:
  - `unknown`,
  - `product`,
  - `union`,
- an openness flag:
  - `open`,
  - `closed`.

For product and union nodes, outgoing edges are labeled by field names or tags.
Edges are locally unique by label.
Unknown-kind nodes use only the open form `(...)`; closed patterns must choose product or union kind explicitly.

Unlike the case of types, **node identity in a pattern graph is semantic**.
If two edges point to the same pattern node, this means that the corresponding positions must be inhabited by the very same type.

Therefore patterns are not quotiented by bisimulation in general.

## 5. Filters As Syntax

A filter expression is a textual way of describing a pattern graph.

Variables appearing in filters are not the semantic object itself.
They are a device for serializing and reusing pattern graph nodes in syntax.

For example, the two filters

```k
{ (...) x, (...) y, ... }
{ X x, X y, ... }
```

describe different pattern graphs:

- the first has two distinct target nodes for `x` and `y`,
- the second has one shared target node reached from both `x` and `y`.

These two patterns are semantically different.

## 6. Matching A Type Against A Pattern

Let `P` be a pattern graph and `T` a type graph.
We say that `T` **matches** `P`, written

```text
T ⊨ P,
```

if there exists a root-preserving graph morphism

```text
h : nodes(P) → nodes(T)
```

such that:

1. if `p` is `unknown`, then `h(p)` may be any type node,
2. if `p` is `product`, then `h(p)` is a product node,
3. if `p` is `union`, then `h(p)` is a union node,
4. if `p` is `closed`, then the outgoing labels of `h(p)` are exactly the outgoing labels of `p`,
5. if `p` is `open`, then the outgoing labels of `h(p)` contain at least the outgoing labels of `p`,
6. for every pattern edge

   ```text
   p --l--> q
   ```

   there is a corresponding type edge

   ```text
   h(p) --l--> h(q).
   ```

Condition 6 is the crucial one: if two edges of `P` point to the same node `q`, then the corresponding edges of `T` must point to the same type node `h(q)`.
This is how the graph structure of the pattern expresses “the same type”.

We define:

```text
Types(P) = { T : T ⊨ P }.
```

### Proposition 0

If `T ⊨ P`, then:

- the root kind of `T` is compatible with the root kind of `P`,
- every label explicitly present at the root of `P` is present at the root of `T`,
- if the root of `P` is closed, then `T` has no additional root labels.

#### Proof

All three statements are immediate from the definition of the root-preserving morphism `h` and conditions 1-5 above, applied at the root node of `P`.

## 7. Singleton Patterns And Types

Every type graph `T` determines a closed pattern `Pat(T)` obtained by forgetting that it is a type and viewing it as a closed pattern graph.

This gives the following proposition.

### Proposition 1

For every type `T`, the pattern `Pat(T)` is singleton:

```text
Types(Pat(T)) = { T }
```

up to the chosen notion of type equivalence.

#### Proof

The identity map from `nodes(Pat(T))` to `nodes(T)` witnesses `T ⊨ Pat(T)`.
Conversely, suppose `U ⊨ Pat(T)` via a root-preserving morphism `h`.
Because every node of `Pat(T)` is either product or union, every node kind is preserved.
Because every node is closed, the outgoing labels at each image node are exactly the outgoing labels of the corresponding node of `T`.
Because every pattern edge must be respected by `h`, all target-sharing constraints are preserved as well.
Therefore `h` is a graph isomorphism modulo the chosen equivalence on type graphs, and hence `U` is equivalent to `T`.

### Proposition 2

Conversely, every singleton pattern determines a unique type up to type equivalence.

#### Proof

Let `P` be singleton.
By definition, `Types(P)` contains exactly one type up to equivalence.
Choose any representative `T ∈ Types(P)`.
Then `T` is the unique type determined by `P`, again up to the chosen equivalence relation.

Thus types can be regarded as a special case of patterns.

## 8. Polymorphic Values

A **polymorphic value** is a pair

```text
(P, v)
```

where:

- `P` is a pattern graph,
- `v` is a typed value `(T, t)`,
- `T ⊨ P`.

Equivalently:

```text
PolyVal(P) = { (P, (T, t)) : T ⊨ P and t ∈ Tree(T) }.
```

In the current JavaScript implementation, this semantic pair is represented
directly in memory: `Product` and `Variant` carry the witness tree, and every
`Value` may also carry the root pattern as `value.pattern`. The JSON codec
envelope is the serialized form of the same object, not a separate concern
known only to the command-line wrapper.

So a pattern does not denote a set of raw trees.
It denotes a set of typed values:

```text
Val(P) = { (T, t) : T ⊨ P and t ∈ Tree(T) }.
```

This is a disjoint union over matching types, not an ordinary union of raw tree sets.

### Proposition 3

For every type `T`,

```text
Val(Pat(T)) = Val(T).
```

#### Proof

By Proposition 1, `Types(Pat(T)) = { T }` up to equivalence.
Substituting this into the definition of `Val(P)` yields exactly the set of typed values whose type is `T`.

## 9. Examples

### 9.1. Distinct pattern graphs

Consider:

```k
P1 = { (...) x, (...) y, ... }
P2 = { X x, X y, ... }
```

Then `P1` and `P2` are different patterns.

- `P1` allows the types at `x` and `y` to differ.
- `P2` requires the types at `x` and `y` to be the same.

Hence:

```text
Types(P2) ⊊ Types(P1).
```

#### Proof sketch

Every type matching `P2` also matches `P1`, because identifying the target types of `x` and `y` is stronger than leaving them unrelated.
The inclusion is strict because a product type with distinct types at `x` and `y` matches `P1` but not `P2`.

### 9.2. Same tree, different typed values

Let `t = {}|x`.
Suppose `t` is accepted both by

```k
T1 = < {} x >
T2 = < {} x, {} y >
```

Then `(T1, t)` and `(T2, t)` are different typed values.

The raw tree is the same, but the type is different.

### Proposition 4

If `T ≠ U`, then:

```text
Val(T) ∩ Val(U) = ∅.
```

#### Proof

An element of `Val(T)` has the form `(T, t)`.
An element of `Val(U)` has the form `(U, u)`.
If `(T, t) = (U, u)`, then necessarily `T = U`.
Hence, when `T ≠ U`, the two sets are disjoint.

## 10. Consequences For Equality And Compression

Since values are intrinsically typed, raw tree equality is not sufficient for semantic equality.

This has an immediate consequence for DAG compression.
Suppose we have the raw tree

```k
{{}|x a, {}|x b, {}|x c}
```

and consider two patterns:

```k
P1 = { (...) a, (...) b, (...) c, ... }
P2 = { X a, X b, X c, ... }
```

If only the raw tree is considered, the three occurrences of `{}|x` appear identical and a naive compressor may merge them.
But semantically this is not always justified.

- Under `P1`, the three occurrences need not belong to the same type.
- Under `P2`, they must belong to the same type.

Therefore canonical value sharing, when used as an optimization, must be relative to the typing information supplied by the pattern and the witness type.
One must not collapse raw subtrees merely because they look the same as trees.

### Proposition 5

There is, in general, no canonical DAG compression procedure that depends only on the raw value tree and is correct for all polymorphic values.

#### Proof

Consider the raw tree

```text
{{}|x a, {}|x b, {}|x c}.
```

As a raw tree, the three subtrees under `a`, `b`, and `c` are isomorphic.
Hence any tree-only compressor cannot distinguish their occurrences by local tree structure alone.
Now compare the two valid pattern contexts:

```text
P1 = { (...) a, (...) b, (...) c, ... }
P2 = { X a, X b, X c, ... }.
```

Under `P1`, the three occurrences are not forced to have the same type.
Under `P2`, they are forced to have the same type because all three edges land in the same pattern node.
So a compressor that always merges these subtrees is unsound for `P1`, while a compressor that never merges them fails to capture the canonical sharing justified by `P2`.
Therefore no canonical sharing rule can be defined from the raw tree alone; typing information from the pattern and witness type is required.

### Proposition 6

For a fixed polymorphic value `(P, (T, t))`, any canonical DAG compression of `t` must be invariant under equality of **typed occurrences**, not merely equality of raw subtrees.

#### Proof sketch

By Proposition 4, typed values of different types are distinct even when represented by the same raw tree.
Within a fixed witness type `T`, the pattern graph still matters because distinct positions of `P` may or may not be identified.
Therefore the only semantically defensible sharing criterion is one that respects the typing/decorated occurrence information carried by `(P, T)`, not the undecorated tree `t` alone.

## 11. Topological Remark

There is a topology-like intuition behind patterns, but only for a fragment.

If one looks only at open positive patterns, they behave like observable structural properties of types and suggest a topology or, more precisely, an Alexandrov-style structure on the class of types ordered by refinement.

However, the full pattern formalism is richer than topology because it includes:

- closedness constraints,
- explicit graph sharing, which expresses sameness of type at different positions.

These two features go beyond ordinary open-set semantics.

### Proposition 7

The class of patterns is strictly richer than the open positive fragment.

#### Proof sketch

The open positive fragment can describe only monotone structural requirements such as "at least these labels" and "these positions have these subpatterns".
It cannot express exact closedness, because closedness is not monotone under refinement.
It also cannot express identification of two positions as "the same type" without preserving explicit graph sharing.
Since full patterns include both closedness and shared-node identity, they strictly extend the open positive fragment.

## 12. Summary

- A type is a regular rooted graph denoting a set of accepted trees.
- A typed value is a pair `(T, t)` with `t ∈ Tree(T)`.
- A pattern is a rooted graph with node kind, openness, and semantic node identity.
- A filter is only syntax for serializing a pattern graph.
- A type matches a pattern via a root-preserving morphism respecting node kind, openness, labels, and shared targets.
- A pattern denotes a set of types, and therefore a set of typed values, not a set of raw trees.
- A polymorphic value is a pair `(P, (T, t))` with `T ⊨ P`.
- Types are exactly the singleton-pattern case.
- DAG compression of values is a representation optimization only and must respect typing information.

## 13. Corollaries For Binary Serialization

The previous propositions impose strong constraints on any correct binary format.

### Corollary 1

The semantic payload of a serialized polymorphic value must determine:

- a pattern graph `P`,
- a witness typed value `(T, t)`,

with `T ⊨ P`.

It is not sufficient to serialize only a raw tree.

#### Justification

By Proposition 4, type is part of value identity.
By Proposition 5, the raw tree alone is insufficient to determine correct canonical sharing behavior.

### Corollary 2

A closed monomorphic typed value is the special case where the serialized pattern is singleton.

#### Justification

This is Proposition 1 together with Proposition 3.

### Corollary 3

Any canonical DAG representation of the witness value must be computed from the decorated object `(P, T, t)`, not from `t` alone.

#### Justification

This is exactly the content of Propositions 5 and 6.

### Corollary 4

Pattern serialization must preserve explicit pattern-node identity.

#### Justification

Pattern node sharing expresses sameness of type at different positions.
Replacing a pattern graph by any representation that forgets this identity changes its denotation.

### Corollary 5

For singleton patterns, one may replace the explicit serialized pattern graph by a canonical type reference as a compact optimization, provided that the decoding semantics is unchanged.

#### Justification

By Proposition 2, a singleton pattern determines a unique type up to equivalence.
Therefore the explicit graph may be recoverable from a canonical type identifier.

## 14. Practical Goal And Derived Toolbox

The ultimate engineering goal is not merely to classify values, but to transform them efficiently with `k` programs.
From a practical point of view, polymorphism is essential: it lets one write one transformation over a whole family of types instead of duplicating monomorphic programs.

This suggests the following operational point of view:

- `k` programs should be allowed to consume **polymorphic values**,
- `k` programs themselves may have **polymorphic input and output patterns**,
- runtime and storage mechanisms should preserve enough typing information to make such transformations sound and efficient.

The current evaluator follows this point of view for materialized values:
projection operations select the corresponding subpattern, product construction
builds a closed product pattern from its fields, and variant construction builds
a closed union pattern for the introduced tag. Boundary input/output patterns
from compilation are still used to constrain and merge with the pattern observed
on the runtime value.

From the semantic development above, the core toolbox should include at least the following components.

### 14.1. Pattern unification

Given two pattern graphs `P` and `Q`, compute their least common refinement when it exists.

This operation is needed for:

- type inference,
- composing polymorphic programs,
- checking compatibility of program boundaries,
- specializing generic transformations.

Because patterns carry semantic graph identity, unification must preserve shared nodes and must not collapse distinct positions merely by local structural similarity.

### 14.2. Encoding and decoding of polymorphic values

There must be a concrete external representation of polymorphic values so they can be:

- printed,
- stored,
- sent between processes,
- consumed as input to `k` programs.

Semantically, such a representation must determine:

```text
(P, (T, t))
```

with `T ⊨ P`.

Implementation-wise, one may choose compact encodings of:

- the pattern graph,
- the witness type,
- the witness value tree,

with optional DAG compression for the value component.

### 14.3. Indexing `k` programs by input and output patterns

If a `k` program has boundary description

```text
Pin -> Pout,
```

then it should be searchable and composable by those patterns.

This supports:

- lookup of transformations applicable to a given polymorphic value,
- composition planning,
- registry-style discovery of programs by structural interface,
- optimization by selecting more specialized implementations when available.

The indexing problem is therefore pattern-theoretic rather than merely nominal.

### 14.4. Deriving a pattern from a raw value tree

Given a raw tree `t`, one wants to infer useful typing information from it.

This operation can have several variants, for example:

- derive the most specific singleton pattern compatible with `t`,
- derive a more general open pattern that exposes only the observed structure,
- derive repeated-shape constraints when justified by an external typing context.

This is not the same as recovering a unique semantic value from the tree alone, because a raw tree does not determine its type.
Still, such derivations are useful as heuristics, input assistance, and initialization of pattern inference.

The current codec envelope uses one such derivation when no input pattern or
type is supplied. Empty nodes derive the closed product `{}`. Multi-child nodes
derive closed products. A one-child node derives an open union by default, unless
an explicit product pattern is supplied to disambiguate it as a singleton
product.

For example:

```k
{a:{b:x,c:{}}}
```

derives the pattern:

```k
< { <{} x, ...> b, {} c } a, ... >
```

The derived envelope pattern may then be canonicalized by collapsing finite
closed subtrees from the leaves upward. The base case is the closed empty product
`{}`; two closed nodes collapse only when their kind, labels, and already
collapsed children are identical. Open pattern nodes keep their identity. This
closed-node collapse belongs to pattern graph construction and should not be
confused with DAG compression of the witness value tree.

### 14.5. Additional likely tools

The same framework naturally suggests further tools:

- checking whether a typed value matches a pattern,
- specializing a polymorphic value to a singleton pattern when possible,
- deriving the output pattern of a composed program,
- deciding whether one pattern is more specific than another,
- canonical textual printing of pattern graphs,
- canonical binary printing of pattern-and-value packages.

## 15. Research Program

The concepts introduced in this note suggest a concrete research and implementation sequence.

### Stage 1. Static semantics

Define precisely:

- type graphs,
- pattern graphs,
- matching `T ⊨ P`,
- typed values,
- polymorphic values,
- singleton patterns,
- refinement and unification of patterns.

### Stage 2. Canonical representations

Define canonical forms for:

- type graphs,
- pattern graphs,
- program boundary patterns.

This stage is foundational for indexing and content-addressed storage.

### Stage 3. Serialization

Define external formats for:

- patterns,
- typed values,
- polymorphic values.

The key semantic distinction must be preserved:

- the pattern is fundamentally graph-shaped,
- the witness value is fundamentally tree-shaped,
- DAG encoding of the witness value is an optimization only.

### Stage 4. Program indexing and execution

Use input and output patterns to:

- index `k` programs,
- choose compatible programs for a given input,
- guide specialization and composition,
- support efficient execution over serialized polymorphic values.

## 16. Final Perspective

The semantic distinction between types, patterns, typed values, and polymorphic values is not a purely academic refinement.
It directly determines what can be compressed, what can be indexed, and what information must survive serialization.

In particular:

- polymorphism is a first-class practical feature, not an afterthought,
- patterns are the correct interface language for polymorphic programming,
- typed values, not raw trees, are the right semantic runtime objects,
- and efficient execution must be built on top of those distinctions rather than by erasing them.
