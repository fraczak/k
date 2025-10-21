
---
title: "k-language"
author: "W. Fraczak"
---

<div align="center">

```
      { }                         { }
     /   \       {.lang name}      |
   lang   by          -->         name
    |      |                       |
   'k'  'wojtek'                  'k'
```

</div>

## **Chapter 1 — Introduction**

### **1.1  The purpose of this book**

This book describes a small programming language called **k**.
It is meant to show how data can be represented and transformed in a uniform, precise way.
The goal is not to replace existing languages but to expose a clear and minimal model of computation.

Anyone who understands basic programming and data structures can read this book.
Formulas will appear later, but every idea can be followed by reading the text and studying examples.

---

### **1.2  Data as trees**

All information in k is treated as a **tree**.
A tree has:

* a single root,
* labeled edges (field names or tags),
* and possibly subtrees.

A JSON object or an XML document are both trees in this sense.
Every k value is such a finite labeled tree.

---

### **1.3  Functions that may fail**

In ordinary mathematics a function always returns a result.
In k, a function may be **undefined** for some inputs.
For example, asking for the field `.age` in a record that has no `age` is undefined.

We call such mappings **partial functions**.
They describe what a program *can* compute, and quietly leave other cases unspecified.

---

### **1.4  Simplicity over features**

k avoids most language constructs:
no loops, no variables, no control statements.
It has only:

1. **types** (which describe tree shapes), and
2. **partial functions** (which transform one tree into another).

These two ingredients are sufficient to express structured computation.

---

### **1.5  Why study k**

* k shows how data types can be treated as *automata* that recognize tree structures.
* It connects programming with the theory of finite representations.
* It offers a concrete path from abstract syntax to real machine code.

The same ideas appear in modern compilers and schema systems, but here they are reduced to their essentials.

---

### **1.6  What follows**

Part I introduces:

* the notation for writing values and functions,
* how types are formed, and
* how functions are combined.

Later parts describe how to represent values in memory and how to compile k programs into LLVM code.

At the end of the first part, the reader should be able to read and understand small k programs, even without writing a compiler.

---

## **Chapter 2 — Syntax and Values**

### **2.1 Language fragments**

The k language has only one kind of program element: a **definition**.
A program is a sequence of definitions of two kinds:

```
$ type_name = type_expression ;
function_name = expression ;
```

The last expression in the file is the *main expression*; it represents the partial function defined by the program as a whole.

There is no special syntax for values.
Every syntactic form describes a **function**—possibly a constant function that always returns the same value.

---

### **2.2 Types**

A type describes the possible **tree shapes** of values.
Types are formed from two constructors:

1. **Product**  – written `{ t₁ l₁, t₂ l₂, … }`
   represents records with fixed labeled fields.

2. **Union**  – written `< t₁ l₁, t₂ l₂, … >`
   represents a choice between labeled alternatives.

Both are finite and fully explicit.
Every type denotes a finite tree automaton whose accepted trees are the possible values of that type.

---

### **2.3 Special and limiting cases**

1. **Singleton product**
   A product with one field, `{ T x }`, is **equivalent** to the union `< T x >`.
   The language treats them as the same.
   For readability either form may appear, but internally it is always a union.

2. **Empty product**
   `{}` has no fields.
   It represents the *unit* type: a type that admits exactly one value, also written `{}`.
   There is nothing exceptional about it; it is simply the degenerate case of a product with zero fields.

3. **Empty union**
   `<>` has no variants.
   It represents a type with no possible values.

---

### **2.4 Constant functions**

Since k has no literal value syntax, constants are written as functions that ignore their argument and return a fixed tree.
For example:

```
true_bool  =  {{ } true} $bool ;
false_bool =  {{ } false} $bool ;
```

Each constant definition constructs a function of type `?X → $bool`.
When applied to any input, it produces the same result.

There are no integers, strings, or other primitive atoms.
All data must be built from algebraic types using the product and union constructors.

---

### **2.5 Functions**

Expressions combine partial functions using three operators:

1. **Composition** `(f g h)` — sequential application.
2. **Union (concurrent)** `< f₁, f₂, … >` — try each in order, first defined wins.
3. **Product (parallel)** `{ f₁ l₁, f₂ l₂, … }` — apply all to the same input, succeed only if all succeed.

Parentheses may be omitted except for the empty composition `()` —the identity function.

---

### **2.6 Example**

```
$bool = < {} true, {} false >;
true_bool  = {{ } true} $bool ;
false_bool = {{ } false} $bool ;
neg = $bool < .true false_bool, .false true_bool > $bool ;
```

This defines a two-variant union type and three functions: two constants and one transformation exchanging the variants.

---

### **2.7 Summary**

* All types describe tree shapes.
* `< T x >` and `{ T x }` are the same type.
* `{}` is the empty product (unit).
* Values appear only as results of constant functions.
* There are no primitive literals, only algebraic data types.
* Functions, not values, are the only expressions in k.

---

## **Chapter 3 — Types as Finite Automata**

### **3.1 Motivation**

A type in k is a description of a set of finite labeled trees.
This set can be recognized by a finite tree automaton (FTA).
An FTA is similar in idea to a finite state machine for strings, but it accepts trees instead of words.

Representing types as automata gives each type a well-defined structure, independent of the names used in source code.
It also allows for canonical normal forms and for comparing types for equality by structure alone.

---

### **3.2 States and transitions**

Each type definition introduces one or more *states*.
Every product or union corresponds to a state with transitions labeled by field or variant names.

Example:

```
$bool = < {} true, {} false >;
```

This produces two states:

```
C0 -> < C1 "true", C1 "false" >
C1 -> {}
```

Here `C0` is the main state of the type `bool`.
`C1` represents the empty product `{}`, which is the leaf state.

---

### **3.3 Canonical form**

Different type expressions may describe the same automaton.
For example:

```
$pair = { bool x, bool y };
$pair' = { < {} true, {} false > x, < {} true, {} false > y };
```

Both are structurally equivalent.
Canonicalization removes names and renumbers states to obtain a single, stable representation.

Formally, each canonical type is a set of rules of the form:

```
C_i  ->  < C_j "label", … >   (for unions)
C_i  ->  { C_j "label", … }   (for products)
```

States are numbered so that `C0` is the root.
Each state refers only to states with smaller numbers.

---

### **3.4 Examples**

For the unary natural numbers:

```
$bnat = < bnat 0, bnat 1, {} _ >;
```

the canonical form is:

```
$C0 = < C0 "0", C0 "1", C1 "_" >;
$C1 = {};
```

The automaton has two states.
`C0` recognizes numbers composed of 0’s and 1’s ending in the unit state `C1`.
Each value of type `bnat` corresponds to a finite derivation in this grammar.

---

### **3.5 Normalization process**

When compiling a program:

1. Collect all types appearing in definitions.
2. Expand named types until only products and unions remain.
3. Eliminate duplicates by structural comparison.
4. Assign stable state numbers and produce canonical text.

This process is deterministic; the same type always produces the same canonical representation.

---

### **3.6 Hash-based naming**

To avoid name clashes, the compiler computes a hash of each canonical form.
The hash becomes the official type name:

```
$C0=<C0"0",C0"1",C1"_">;$C1={}
→  hash →  @BsAqRMv
```

Program objects can refer to types by hash without ambiguity.

---

### **3.7 Interpretation**

The canonical representation of a type is thus:

* a finite set of states `C0…Cn`,
* each state is a product or union,
* transitions labeled by strings (field or variant names).

Every value of the type is a finite tree accepted by this automaton.

---

### **3.8 Summary**

* Types in k denote finite labeled trees.
* Every type can be expressed as a finite tree automaton.
* Canonical form removes naming differences.
* The empty product becomes a terminal state.
* Hash-based names give each canonical type a unique identity.


---

## **Chapter 4 — Partial Functions and Composition**

### **4.1  Partial functions**

A **partial function** is a mapping that may be undefined for some inputs.
In k, every expression denotes such a function.
If the function is undefined on a value, no result exists; evaluation stops.

There is no notion of error or exception.
Undefined means simply “no output”.

---

### **4.2  Composition**

Composition combines two or more partial functions sequentially.
If `f` and `g` are functions, `(f g)` means “apply `f`, then apply `g` to the result”.

A composition `(f g)` is defined on a value `x` if and only if:

* `f` is defined on `x`, and
* `g` is defined on the result of `f(x)`.

Otherwise, the composition is undefined.

Composition is **associative**:

```
((f g) h)  ≡  (f (g h))
```

Therefore, parentheses are unnecessary except for the special case of the **empty composition**, written `()`, which acts as the identity function:

```
() x  =  x
```

---

### **4.3  Product composition**

Product composition creates a function that applies several subfunctions in parallel to the same input and gathers their results into a product value.

Syntax:

```
{ f₁ l₁, f₂ l₂, …, fₙ lₙ }
```

This expression is defined on an input value if all component functions are defined on that input.
Its result is a product with fields labeled `l₁ … lₙ`, each containing the corresponding subresult.

Example:

```
{ .x X, .y Y }
```

maps a record with fields `x` and `y` to another record `{ X, Y }` if both fields exist.

---

### **4.4  Union composition**

Union composition represents concurrent evaluation with fallback:

```
< f₁, f₂, …, fₙ >
```

The result is defined for an input `x` if at least one subfunction is defined.
Evaluation proceeds left to right; the first defined result is used.
If none are defined, the result is undefined.

Example:

```
< .x, .y >
```

extracts `.x` if present; otherwise `.y` if present.

---

### **4.5  Constants**

A constant function always returns the same value, ignoring its argument.
Since k has no literal syntax for values, constants are expressed through construction:

```
true_bool  =  {{ } true} $bool ;
false_bool =  {{ } false} $bool ;
```

Each is a partial function defined for all inputs (total functions) producing a fixed value.

---

### **4.6  Projection**

Projection selects a field or variant from a product or union.
It is written with a leading dot:

```
.x
```

If the input is a product containing field `x`, the result is the value of that field.
If the input is a union currently in the variant `x`, the result is the contained value.
Otherwise the projection is undefined.

Projections are themselves partial functions.

---

### **4.7  Derived combinations**

Complex functions are built by nesting compositions.
For example:

```
< .x, .y >
```

means “take field `x`, or if absent, take field `y`”.

```
{ .x x_copy, .y y_copy }
```

copies both fields if they exist.

---

### **4.8  Identity and emptiness**

The empty composition `()` acts as the identity.
The empty union `<>` is the always-undefined function.
The empty product `{}` is the constant function returning the unit value `{}`.

---

### **4.9  Summary**

* All expressions denote partial functions.
* Composition `(f g)` is associative; parentheses can be omitted.
* `()` is identity.
* `{ … }` combines results in parallel; `< … >` tries alternatives.
* Projections and constants are the simplest partial functions.
* Undefined means “no output”, not “error”.

---

## **Chapter 5 — Typing, Filters, and Normalization**

### **5.1 Types as functions**

A type expression in k can appear wherever a function is expected.
In this context it behaves as an **identity** function that is defined only for values of that type.
For example, `$bool` used as an expression is a partial identity: it returns its argument unchanged when the argument is of type `bool`, and it is undefined otherwise.

This convention eliminates any special syntax for annotating sub-expressions with types.
An expression may be *restricted* to a type simply by composing it with the corresponding type expression.

---

### **5.2 Filters**

A **filter** is a syntactic form that denotes a *class of types*—a set of types sharing some structure.
Filters generalize type expressions in the same way that regular expressions generalize specific strings.

Filters are written with a leading question mark `?`.
They have the same syntactic shape as types but may contain *meta-variables* standing for unknown types.
A filter may describe:

* a **product** — `?{ … }`
* a **union** — `?< … >`
* a **product-or-union** — `?( … )`

Each form must have at least two labeled fields unless empty; the fields often share the same meta-type variable.

---

### **5.3 Examples of filters**

* `?( … )` — represents any type.
* `?()` — represents an empty product or empty union.
* `?< ( … ) f, ( … ) g >` — represents all union types having exactly two variants `f` and `g`.
* `?{ X f, X g }` — represents all product types with two fields `f` and `g`, both of the same element type `X`.

A filter constrains where a partial function is defined; it does not affect the operational behavior of the function once defined.

---

### **5.4 Recursive filters**

Filters may be recursive.
They can describe families of recursive types by equating one meta-variable to a filter containing it.

Example (list definition):

```
?< {} nil, {X car, Y cdr} cons > = Y
```

This filter states that `Y` is any type satisfying:
either the empty product `{}` labeled `nil`, or a product with two fields `car` of type `X` and `cdr` of type `Y` labeled `cons`.
It thus denotes lists of `X`.

---

### **5.5 Meta-variables and scope**

A meta-variable introduced in a filter is visible within the enclosing function definition.
For example:

```
car = ?< {} nil, {X car, Y cdr} cons > = Y .car ?X;
```

Here:

* `X` and `Y` are filter variables.
* `car` is a function defined on all union types matching the filter, i.e., any type that has a variant `cons` with field `car` of type `X` and field `cdr` of type `Y`.
* The expression `.car ?X` projects the `car` field and restricts its result to type `X`.

---

### **5.6 Type inference and normalization**

Every k program can be analyzed to assign an input and output type (or filter) to every sub-expression.

Normalization proceeds as follows:

1. Build a graph of all type references appearing in the program.
2. Annotate each expression node with a pair (input filter, output filter).
3. Replace singleton filters by their equivalent types and add resulting types to the graph.
4. Repeat until no change occurs.
5. Compute canonical automata for all newly introduced types.

After normalization, every expression has fully determined input and output types, and all references are to canonicalized forms.

---

### **5.7 Summary**

* Type expressions act as identity functions defined on values of that type.
* Filters describe sets of types and can constrain where a function is defined.
* Filters may be products, unions, or product-or-union forms, and can be recursive.
* Meta-variables in filters have function-level scope.
* Normalization computes explicit input/output types for every expression, producing a fully typed program.

---

## **Chapter 6 — Values in Memory**

### **6.1  Trees as runtime objects**

At execution, every k value is represented as a finite labeled tree stored in memory.
Each node corresponds to one constructor of a product or union type.
Edges are labeled by field or variant names, and their order follows the canonical field order of the type.

Every node is immutable.
Evaluation of a k program creates new nodes but never modifies existing ones.

---

### **6.2  Uniform node layout**

All nodes share the same in-memory structure:

```
struct KNode {
    int  state;        // canonical type state (C0, C1,…)
    int  tag;          // variant index, −1 for product
    int  arity;        // number of children
    struct KNode* child[];  // array of pointers to children
};
```

The `state` identifies the canonical automaton state of the node.
The `tag` identifies the active variant when the node belongs to a union type;
for product and unit values, `tag = −1`.

---

### **6.3  Products and unions**

A node’s **arity** determines its structural kind:

* **arity = 0** — the empty product `{}` (unit);
* **arity > 1** — a product with that many fields;
* **arity = 1** — a union value.

Thus, by inspecting the number of children one can always distinguish product from union.
A union node has exactly one child—the value of its selected variant.
A product node has one child per field.
This rule holds for all types in k, including recursive ones.

---

### **6.4  Unit and empty union**

The empty product `{}` produces the single node with `arity = 0`.
It represents the unique value of the unit type.

The empty union `<>` has no possible nodes at all.
No value of that type can exist in memory.

---

### **6.5  Canonical folding (DAG representation)**

To avoid duplicate subtrees, identical substructures may be shared.
Each distinct combination of `(state, tag, child IDs)` appears once; all references point to that node.
The resulting structure is a **directed acyclic graph (DAG)** instead of a tree.
Two values are equal if and only if their root nodes are identical.

---

### **6.6  Allocation and immutability**

Nodes are allocated sequentially in an arena or shared pool.
Because they never change after creation, reference equality is safe for comparison and hashing.
Garbage collection is unnecessary if each evaluation allocates in a fresh arena released at the end.

---

### **6.7  Example**

For type:

```
$pair = { bool x, bool y };
$bool = < {} true, {} false >;
```

the value `{ true_bool x, false_bool y }` becomes:

```
pair-node (arity = 2, state=C0, tag=−1)
 ├─ child[0] → union-node(true)  (arity = 1, tag=0)
 │              └─ child[0] → unit-node (arity = 0)
 └─ child[1] → union-node(false) (arity = 1, tag=1)
                └─ child[0] → unit-node (arity = 0)
```

By inspecting each node’s `arity`, one can identify products (≥2 children) and unions (1 child).

---

### **6.8  Summary**

* Every value is a finite immutable tree (or DAG) of `KNode`s.
* Node fields: `state`, `tag`, `arity`, and `child[]`.
* A node with exactly one child is always a union value.
* `arity = 0` is the unit value; `arity > 1` indicates a product.
* Identical subtrees can be folded into shared nodes.
* The memory representation alone is sufficient to determine the kind of each value without consulting the type definition.

---

## **Chapter 7 — The Partial Function ABI**

### **7.1  Purpose**

The **application binary interface (ABI)** defines how partial functions in k are represented and invoked at runtime.
Its goal is to make all functions—whether user-defined or compiled—compatible with the same calling convention and data layout.

Every compiled k function receives a single argument (a value tree) and may either produce a result or remain undefined.
The ABI provides a uniform way to express both outcomes.

---

### **7.2  Function result representation**

The result of every function call is a pair of fields:

```
struct KOpt {
    bool ok;     // 1 if function is defined for the given input
    struct KNode* val;  // valid only if ok == true
};
```

If `ok == 1`, the function succeeded and `val` points to the root node of the resulting value.
If `ok == 0`, the function is undefined for the input, and `val` is meaningless.

This structure carries both the success flag and the value pointer, allowing partiality to be expressed directly in generated code.

---

### **7.3  Function parameter representation**

Each function takes exactly one parameter:

```
struct KNode* input;
```

The parameter points to the root of the input value.
Since all values are immutable, the function must not modify this structure.

---

### **7.4  Calling convention**

Every k function compiled to machine code follows this C-style signature:

```c
struct KOpt k_function(struct KNode* input);
```

The return value indicates success or failure.
The convention is uniform for all functions, regardless of the specific types involved.

---

### **7.5  Core runtime operations**

The runtime provides a small set of primitive functions implementing the fundamental operations of k:

| Operation                              | Purpose                       | Result                                            |
| -------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `k_project(input, label_id)`           | projection `.label`           | defined if the field or variant `label_id` exists |
| `k_make_product(state, children[], n)` | construct a product node      | always defined                                    |
| `k_make_union(state, tag, child)`      | construct a union node        | always defined                                    |
| `k_fail()`                             | represent undefined result    | returns `{ ok = 0 }`                              |
| `k_unit()`                             | return the constant unit node | returns `{ ok = 1, val = &unit_node }`            |

All user-defined functions can be compiled entirely in terms of these operations.

---

### **7.6  Metadata tables**

To interpret or construct nodes correctly, the runtime holds constant tables derived from canonical type definitions:

* `state_kind[state]` — `0` for product, `1` for union,
* `state_arity[state]` — number of child fields for products (always 1 for unions),
* `field_index[state][label_id]` — index of field in product (or `-1` if absent),
* `variant_index[state][label_id]` — index of variant in union (or `-1` if absent).

These tables are read-only and known at compile time for each canonical type.

---

### **7.7  Example: projection**

To implement the projection `.x`:

```c
struct KOpt k_project_x(struct KNode* input) {
    int state = input->state;
    int kind  = state_kind[state];

    if (kind == PRODUCT) {
        int idx = field_index[state]["x"];
        if (idx < 0 || idx >= input->arity)
            return (struct KOpt){0, NULL};
        return (struct KOpt){1, input->child[idx]};
    }

    if (kind == UNION) {
        int tag  = variant_index[state]["x"];
        if (tag < 0 || input->tag != tag)
            return (struct KOpt){0, NULL};
        return (struct KOpt){1, input->child[0]};
    }

    return (struct KOpt){0, NULL};
}
```

This code demonstrates the generic principle:
the projection is defined if and only if the input has a field or variant named `x`.

---

### **7.8  Error propagation**

When one function calls another, the success flag `ok` propagates forward.
If a subcall returns `ok == 0`, the caller must return `{0, NULL}` immediately.
This makes undefinedness explicit and local—no exceptions, no global flags.

---

### **7.9  Summary**

* Every function has the form `KOpt f(KNode*)`.
* Partiality is expressed by the `ok` flag.
* Runtime operations handle projection and construction.
* Metadata tables describe field positions and variant indices.
* By inspecting `arity`, `state`, and `tag`, the runtime can interpret any value correctly.
* This ABI ensures all generated and runtime functions can interoperate safely.

---

## **Chapter 8 — Operational Semantics and Execution**

### **8.1  Purpose**

The **operational semantics** of k describe how expressions are evaluated step by step on actual value trees.
It defines when a function is *defined* for a particular input and what value it returns.
All execution—interpretive or compiled—follows these rules.

---

### **8.2  Evaluation relation**

Evaluation is written as:

```
⟨ e , v ⟩ ⇓ r
```

meaning that expression `e` applied to value `v` yields result `r`.
If `e` is undefined for `v`, the relation does not hold.

`r` is always a tree (or node) in memory, represented as described in Chapter 6.
Undefined results are expressed by the absence of any rule that produces `r`.

---

### **8.3  Rules for base expressions**

#### **Identity**

```
⟨ () , v ⟩ ⇓ v
```

The empty composition `()` returns its argument unchanged.

#### **Constant**

```
⟨ c , v ⟩ ⇓ r₀
```

for any `v`.
The constant function ignores its input and returns its predefined value `r₀`.

#### **Projection**

Let `label` be a field or variant name.
If `v` has a child under `label`,

```
⟨ .label , v ⟩ ⇓ v.label
```

Otherwise the projection is undefined.

#### **Type expression**

For a type `$T`,

```
⟨ $T , v ⟩ ⇓ v     if v ∈ T
```

and undefined otherwise.
Type expressions thus act as identity functions restricted to their type.

---

### **8.4  Rules for composition**

#### **Sequential composition**

```
⟨ (f g) , v ⟩ ⇓ r
```

if there exists `u` such that
`⟨ f , v ⟩ ⇓ u` and `⟨ g , u ⟩ ⇓ r`.

If either step is undefined, the composition is undefined.
Because composition is associative,

```
(f (g h))  ≡  ((f g) h)  ≡  (f g h)
```

Parentheses are needed only for `()`.

---

### **8.5  Rules for product composition**

```
⟨ { f₁ l₁ , f₂ l₂ , … , fₙ lₙ } , v ⟩ ⇓ { r₁ l₁ , r₂ l₂ , … , rₙ lₙ }
```

if and only if all subfunctions `fᵢ` are defined on `v` and yield `rᵢ`.
If any subfunction is undefined, the whole product composition is undefined.

A product composition constructs a new product node;
each result `rᵢ` becomes one child in canonical field order.

---

### **8.6  Rules for union composition**

```
⟨ < f₁ , f₂ , … , fₙ > , v ⟩ ⇓ rⱼ
```

if there exists the smallest index `j` such that
`⟨ fⱼ , v ⟩ ⇓ rⱼ`.

If no subfunction is defined, the union composition is undefined.

---

### **8.7  Rules for filters**

If a filter `?F` matches the type of value `v`,

```
⟨ ?F , v ⟩ ⇓ v
```

otherwise it is undefined.

Filters therefore act as partial identities defined for all types satisfying the filter pattern.

---

### **8.8  Evaluation order**

Evaluation proceeds left to right.
In products, all subfunctions receive the same input;
in unions, later functions are evaluated only if earlier ones fail.

The semantics are deterministic:
for any given input, at most one result tree can be produced.

---

### **8.9  Example**

Given:

```
$bool = < {} true, {} false >;
neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
```

and input value `{ {} true } $bool`,
evaluation steps are:

1. `⟨ $bool , { {} true } ⟩ ⇓ { {} true }`
2. `⟨ < .true {{ } false}, .false {{ } true} > , { {} true } ⟩ ⇓ {{ } false}`
3. `⟨ $bool , {{ } false} ⟩ ⇓ {{ } false}`

Final result: `{{ } false}`.
If the input were of another type, step 1 would be undefined.

---

### **8.10  Implementation correspondence**

The evaluation rules map directly onto the runtime ABI:

| Semantic rule       | Runtime operation                     |
| ------------------- | ------------------------------------- |
| Projection          | `k_project`                           |
| Product composition | multiple subcalls + `k_make_product`  |
| Union composition   | sequential subcalls with early return |
| Type/Filter         | runtime check of `state` or `arity`   |
| Constant            | predefined node pointer               |
| Composition         | function call chain                   |

In compiled form, the `ok` flag of `KOpt` represents whether a rule applies;
the node pointer represents the result value.

---

### **8.11  Summary**

* Execution follows deterministic, left-to-right rules.
* All expressions denote partial functions on value trees.
* Type and filter expressions act as restricted identities.
* Composition is associative; undefined propagates automatically.
* Runtime semantics match the formal evaluation relation exactly.

---

## **Chapter 9 — Compiler Architecture**

### **9.1  What the compiler does**

A *compiler* for the k language is a program that reads another program (written in k) and produces a lower-level version of it.
The lower-level version can then be executed efficiently by a computer.

For k, the compiler’s task is simple in concept:

1. **Read** the definitions of types and functions.
2. **Understand** their structure and the relationships between them.
3. **Translate** them into equivalent instructions that follow the runtime conventions described in Chapters 6–8.

The compiler must ensure that every function in the source program becomes a machine-level function that behaves in exactly the same way:
it takes a value as input, may or may not be defined for it, and, if defined, produces another value.

---

### **9.2  The main stages**

A k compiler is organized as a sequence of well-defined stages.
Each stage transforms one representation of the program into another, simpler one.

1. **Reading and parsing** — The compiler converts the source text into a tree of syntactic objects.
   This tree is called the *abstract syntax tree* (AST).
   It records the structure of expressions such as `{ .x a, .y b }` or `< .x, .y >`.

2. **Type analysis and normalization** —
   The compiler expands type names, checks their correctness, and replaces all filters and meta-variables by concrete type information, following the procedure from Chapter 5.
   The result is a fully typed AST.

3. **Preparation for execution** —
   The compiler builds a *type table* for all canonical type states (C0, C1, …).
   For each type, it records whether it is a product or a union and the number and names of its fields or variants.
   These tables become the metadata used at runtime.

4. **Code generation** —
   Finally, the compiler walks through the typed AST and produces an equivalent description in a lower-level form that follows the runtime conventions: functions returning a success flag and a value pointer.
   This form can be expressed directly in C or in the *LLVM intermediate representation*, which is a platform-independent format understood by many compilers.

---

### **9.3  Internal structure**

A minimal compiler can be viewed as three connected modules:

* **Front end** — reads source code, builds the AST, performs type analysis.
* **Middle** — resolves all references, normalizes types, and simplifies expressions.
* **Back end** — produces the executable form.

Although these terms are traditional, the distinction is simple:
the front end *understands* the program, the back end *emits* it, and the middle part connects the two.

---

### **9.4  Data kept by the compiler**

During translation the compiler maintains several tables:

| Name               | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| **Type table**     | Maps type names to canonical forms and assigns numeric state IDs. |
| **Field table**    | For each product type, records the order and index of its fields. |
| **Variant table**  | For each union type, records the tags and their numeric indices.  |
| **Function table** | Associates function names with their input and output types.      |

These tables ensure that generated code can find fields and variants by number rather than by name, which simplifies execution.

---

### **9.5  Example of transformation**

Consider a simple k program:

```
$bool = < {} true, {} false >;
neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
```

1. **Parsing:**
   The compiler recognizes a type definition `$bool` and a function `neg`.

2. **Type analysis:**
   Both the input and output of `neg` are of type `bool`.

3. **Internal representation:**
   The compiler constructs an internal tree describing that
   `< .true f₁, .false f₂ >` means:
   try the projection `.true`, then `.false`, each producing a constant value.

4. **Generated form:**
   In the target language, `neg` becomes a small function that:

   * calls `k_project` to check which variant the input has,
   * creates a new node with the opposite variant using `k_make_union`, and
   * returns the result with `ok = 1`.

This sequence of steps is fully automatic and follows directly from the semantic rules in Chapter 8.

---

### **9.6  Intermediate representation**

Before producing final code, many compilers use an *intermediate representation* (IR).
It is a language designed to be easy to generate and easy to translate further into real machine code.
For k, the IR mirrors the structure of partial functions:

| Concept in k          | IR operation                     |
| --------------------- | -------------------------------- |
| Projection `.x`       | `PROJECT label_id`               |
| Composition `(f g)`   | `CALL f; CALL g`                 |
| Union `<f,g>`         | `TRY f; IF undefined THEN TRY g` |
| Product `{f,g}`       | `CALL f; CALL g; COMBINE`        |
| Constant              | `MAKE_CONST node_id`             |
| Type restriction `$T` | `CHECK_TYPE state_id`            |

The compiler converts each AST node into one or more IR instructions.
Later, these instructions are translated into LLVM or C code using the runtime ABI.

---

### **9.7  Linking with the runtime**

The generated code does not contain memory allocation or type tables itself.
Instead, it relies on the runtime library (`krt`), which provides:

* functions such as `k_project` and `k_make_union`,
* metadata tables for each canonical type, and
* the unit value `{}` shared by all programs.

When the compiler finishes, it outputs a text file in the target language plus references to this runtime library.
The two together form an executable program.

---

### **9.8  Simplicity of the model**

Because every expression in k takes exactly one input and may return one output or be undefined,
the compiler never has to deal with variable environments, loops, or side effects.
This makes the structure of the generated program very regular:

```
input → [series of calls and checks] → output or undefined
```

Each compiled function is independent and stateless.
This regularity is what allows k to map cleanly to low-level code.

---

### **9.9  Summary**

* The compiler transforms k programs into executable form through a sequence of simple, deterministic steps.
* Type information and structure are resolved before code generation.
* All generated functions follow the same calling convention (`ok`, `val`).
* The runtime library provides the shared operations needed by every program.
* The entire process mirrors the formal semantics defined earlier but expresses it as concrete machine operations.

---

## **Chapter 10 — From AST to Intermediate Representation**

### **10.1  The purpose of an intermediate form**

The abstract syntax tree (AST) of a k program directly reflects how the source code was written.
It is easy to read but not convenient for generating machine code.
Before code can be produced, the compiler rewrites this tree into a **simpler, regular structure** called the *intermediate representation* (IR).

The IR is close to what the machine will execute, but it still looks like a structured program rather than raw binary instructions.
Each node in the IR corresponds to a single, well-defined operation such as *project a field*, *apply a function*, or *combine results*.

Using an intermediate form helps in three ways:

1. It separates understanding of the language from machine details.
2. It allows the compiler to verify that every function is well formed.
3. It provides a uniform surface for optimization and for later translation into C or LLVM.

---

### **10.2  Shape of the intermediate representation**

Each IR instruction corresponds to one semantic rule from Chapter 8.
The IR does not need to represent filters or meta-variables, since those are resolved earlier.
Only concrete actions remain.

| Operation                     | Meaning                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| **PROJECT label_id**          | Apply `.label` to the input value.                               |
| **TYPECHECK state_id**        | Accept the input only if its root has the given canonical state. |
| **CALL function_id**          | Invoke another function following the ABI.                       |
| **UNION [f₁, f₂, …]**         | Try several functions in order until one succeeds.               |
| **PRODUCT [l₁=f₁, l₂=f₂, …]** | Apply each function to the same input and combine results.       |
| **CONST node_id**             | Return a fixed value.                                            |
| **FAIL**                      | Always undefined.                                                |
| **SEQ [f₁, f₂, …]**           | Apply functions in sequence (composition).                       |

Each function in the program becomes a small list or tree of such IR instructions.

---

### **10.3  Example**

Source program:

```
$bool = < {} true, {} false >;
neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
```

The IR for `neg` can be written informally as:

```
neg:
  TYPECHECK bool
  UNION [
    SEQ [ PROJECT true, CONST false ],
    SEQ [ PROJECT false, CONST true ]
  ]
  TYPECHECK bool
```

This IR expresses the same logic as the source:
check the type, then try the first projection `.true`, otherwise the second, and finally ensure the result is again of type `$bool`.

---

### **10.4  Relation to evaluation**

Every IR operation corresponds to a runtime action:

| IR operation | Runtime function or behavior                        |
| ------------ | --------------------------------------------------- |
| PROJECT      | `k_project(input, label_id)`                        |
| TYPECHECK    | verify `input->state == state_id`                   |
| CALL         | call another generated function                     |
| UNION        | sequential `if`–`else` test on success flags        |
| PRODUCT      | multiple subcalls + `k_make_product`                |
| CONST        | constant node pointer                               |
| FAIL         | return `{ ok = 0 }` immediately                     |
| SEQ          | connect the output of one step as input to the next |

By describing computation in these terms, the compiler can generate executable code simply by replacing each IR instruction with its runtime equivalent.

---

### **10.5  Building the IR**

The process of converting the AST to IR follows a recursive pattern:

1. **Projections and constants** become single instructions (`PROJECT`, `CONST`).
2. **Compositions** `(f g h)` become a `SEQ` list of their components.
3. **Unions** `<f,g>` become a `UNION` list.
4. **Products** `{f l₁, g l₂}` become a `PRODUCT` list with labeled entries.
5. **Type expressions** `$T` become `TYPECHECK` instructions.
6. **Filters** disappear; their meaning is already captured by typechecks.

Each transformation step produces IR nodes with fixed behavior and explicit order.

---

### **10.6  Verifying the IR**

Because k programs are defined by simple composition, a small set of checks ensures correctness:

1. Each `SEQ`, `UNION`, or `PRODUCT` list must have at least one element.
2. Every `PROJECT` or `CONST` must have a valid label or node reference.
3. Input and output states of consecutive steps must match.
4. A function must end in an operation that produces a result (`CONST`, `PROJECT`, `CALL`, or combination).

After verification, the IR is guaranteed to represent a valid partial function according to the semantics in Chapter 8.

---

### **10.7  Intermediate form as a small language**

The IR can be viewed as a minimal language on its own.
It has:

* one data type (`KNode*`),
* one universal value format (trees),
* and a fixed set of operators.

Its execution model is the same as the runtime ABI.
This means an interpreter for the IR can serve as a reference implementation of the k semantics before any machine code generation is added.

---

### **10.8  Example: product composition**

For input function `{ .x a, .y b }`,
the IR is:

```
TYPECHECK pair
PRODUCT [
  a = PROJECT x,
  b = PROJECT y
]
```

The runtime sequence is:

1. Check that the input is a product with two fields.
2. Apply each projection.
3. If both succeed, build a new node with two children in order `(a,b)`.

This pattern covers all record-building operations in the language.

---

### **10.9  Why this representation is useful**

This intermediate form provides three practical benefits:

1. **Clarity** – every step is explicit and local.
2. **Verifiability** – type consistency and definedness can be checked mechanically.
3. **Flexibility** – the same IR can be translated to many targets (LLVM IR, C, or even interpreted directly).

Because of these advantages, most compilers for declarative languages use an intermediate form of this kind.

---

### **10.10  Summary**

* The abstract syntax tree is rewritten into a simpler, machine-oriented form.
* Each IR instruction represents one operation defined by the k semantics.
* Type and filter information appear as explicit checks.
* The IR is easy to verify and to translate into executable code.
* The IR can also serve as a precise description of how k functions behave step by step.

---

## **Chapter 11 — LLVM Basics**

### **11.1  Purpose**

The previous chapters described how a k program can be reduced to a small set of intermediate operations.
To execute these operations efficiently, the compiler must translate them into an actual machine language.
Instead of generating raw machine code directly, we use a common intermediate format called **LLVM IR** (LLVM *Intermediate Representation*).

LLVM IR is a low-level, strongly typed language that resembles a simplified form of assembly.
It can be read and written as text, analyzed, optimized, and compiled to machine code for almost any processor.
For the compiler writer, it provides a bridge between high-level language semantics and executable programs.

---

### **11.2  Structure of an LLVM program**

An LLVM program consists of **global definitions** and **functions**.

* *Global definitions* describe data structures shared between functions.
  In the k compiler, this includes the runtime metadata tables and constant nodes such as `{}`.

* *Functions* contain sequences of instructions grouped into **basic blocks**.
  A basic block is a straight-line segment of code with no branches except at the end.
  Branches connect blocks, forming a control-flow graph.

Each instruction produces a new value; values are immutable once created.
This property is called *single static assignment* (SSA).

---

### **11.3  Data types**

LLVM provides several primitive types.
Only a few are required for the k compiler:

| LLVM type       | Meaning                                            |
| --------------- | -------------------------------------------------- |
| `i1`            | one-bit boolean (used for success flag)            |
| `i32`           | 32-bit integer (used for state IDs, indices, tags) |
| `ptr` or `%T*`  | pointer to data in memory                          |
| `%struct {...}` | user-defined record (used for `KNode` and `KOpt`)  |

The main structures used by generated code are:

```llvm
%KNode = type { i32, i32, i32, [0 x %KNode*] }
%KVal  = type { %KNode* }
%KOpt  = type { i1, %KVal }
```

`%KNode` represents one tree node in memory;
`%KOpt` represents the result of a partial function, with an `ok` flag and a value pointer.

---

### **11.4  Function signatures**

Every compiled k function is translated into one LLVM function with the following signature:

```llvm
define %KOpt @f_name(%KVal %in) { ... }
```

The function takes a single argument `%in`, which holds the pointer to the input value.
It returns a `%KOpt` structure containing the success flag and the resulting value.

This mirrors the runtime ABI introduced in Chapter 7.
By using the same layout, all functions can call each other without conversions.

---

### **11.5  Control flow**

LLVM IR uses **conditional branches** to express choices and **phi-nodes** to merge results from different paths.

A typical pattern for union composition `<f,g>` is:

```llvm
%r1 = call %KOpt @f(%in)
%ok1 = extractvalue %KOpt %r1, 0
br i1 %ok1, label %success, label %try_next

try_next:
%r2 = call %KOpt @g(%in)
br label %merge

success:
br label %merge

merge:
%res = phi %KOpt [ %r1, %success ], [ %r2, %try_next ]
ret %res
```

This code means: try `f`; if it succeeds, use that result; otherwise, try `g`.
The `phi` instruction chooses between values coming from different blocks.

---

### **11.6  Memory operations**

Most functions in k do not modify existing nodes; they create new ones.
Node creation is implemented as calls to runtime functions:

```llvm
declare %KVal @k_make_product(i32 %state, i32 %n, %KVal* %children)
declare %KVal @k_make_union(i32 %state, i32 %tag, %KVal %child)
```

These calls allocate new immutable nodes.
The compiler provides the correct `state`, `tag`, and child references according to the canonical type.

---

### **11.7  Constants**

Constant values such as `{{} true}` are represented as global variables in LLVM:

```llvm
@unit_node  = constant %KNode { 1, -1, 0, [] }
@true_node  = constant %KNode { 0, 0, 1, [@unit_node] }
@false_node = constant %KNode { 0, 1, 1, [@unit_node] }
```

Each constant is a fully formed node with fixed fields.
When a constant function is called, the compiler returns a pointer to the corresponding global node.

---

### **11.8  From IR to LLVM**

Translating the compiler’s intermediate form (Chapter 10) into LLVM is mechanical:

| IR operation | LLVM translation                                       |
| ------------ | ------------------------------------------------------ |
| `PROJECT`    | call `@k_project`                                      |
| `TYPECHECK`  | compare `input->state` with constant                   |
| `CONST`      | return constant node                                   |
| `PRODUCT`    | evaluate subcalls, check flags, call `@k_make_product` |
| `UNION`      | generate branching structure as above                  |
| `SEQ`        | chain calls: feed output to next input                 |
| `FAIL`       | return `%KOpt { 0, undef }`                            |

These mappings produce correct, low-level code while remaining faithful to the language semantics.

---

### **11.9  Example**

For the function `neg` from earlier:

```
$bool = < {} true, {} false >;
neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
```

The simplified LLVM version may look as follows (comments added):

```llvm
define %KOpt @neg(%KVal %in) {
entry:
  ; Try the .true branch
  %r1 = call %KOpt @project_true(%in)
  %ok1 = extractvalue %KOpt %r1, 0
  br i1 %ok1, label %case_true, label %case_false

case_true:
  %res_true = insertvalue %KOpt undef, i1 1, 0
  %res_true2 = insertvalue %KOpt %res_true, %KVal @false_node, 1
  ret %KOpt %res_true2

case_false:
  %r2 = call %KOpt @project_false(%in)
  %ok2 = extractvalue %KOpt %r2, 0
  br i1 %ok2, label %case_false_valid, label %undefined

case_false_valid:
  %res_false = insertvalue %KOpt undef, i1 1, 0
  %res_false2 = insertvalue %KOpt %res_false, %KVal @true_node, 1
  ret %KOpt %res_false2

undefined:
  ret %KOpt { i1 0, %KVal undef }
}
```

While verbose, this code mirrors the evaluation rules exactly and can be optimized by standard LLVM tools.

---

### **11.10  Optimization and verification**

LLVM provides built-in passes that simplify generated code:

* **mem2reg** — removes unnecessary memory operations,
* **instcombine** — merges simple operations,
* **gvn** — removes redundant calculations,
* **simplifycfg** — cleans up control flow.

The compiler can run these passes automatically to produce compact and efficient output.
LLVM also verifies that all types and values are consistent before emitting machine code.

---

### **11.11  Summary**

* LLVM IR is a portable, low-level language ideal for code generation.
* Every k function becomes an LLVM function returning the pair `{ok, value}`.
* All constants, type checks, and runtime calls are represented explicitly.
* The translation from k’s intermediate form to LLVM is direct and systematic.
* Standard LLVM tools can then optimize and compile the result into executable machine code.

---

## **Chapter 12 — Code Generation**

### **12.1  Purpose**

The **code generation** phase translates the intermediate representation (IR) of each k function into executable code using the LLVM format described in Chapter 11.
This translation is systematic: every IR operation corresponds to a specific sequence of LLVM instructions or calls to the runtime library.

The compiler’s objective is to produce code that behaves exactly like the formal semantics of k—no more and no less.
Each step of the translation can therefore be viewed as a mechanical implementation of one of the rules introduced in Chapter 8.

---

### **12.2  Structure of generated functions**

Each k function becomes a stand-alone LLVM function with the signature:

```llvm
define %KOpt @f_name(%KVal %in)
```

Internally, the function has one or more *basic blocks*.
Each block performs a small action: a projection, a check, a call, or a node construction.
Blocks are connected by explicit branches that depend on the `ok` flag of intermediate results.

At the end of the function, exactly one `%KOpt` value is returned.

---

### **12.3  Translating core operations**

The compiler maintains a mapping from IR operations (Chapter 10) to LLVM code patterns.

| IR Operation           | Generated Code Pattern                                                             |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **PROJECT label**      | `call %KOpt @k_project(%KVal %in, i32 label_id)`                                   |
| **TYPECHECK state**    | Compare `input->state` with constant `state`; if unequal, return `{0, undef}`      |
| **CONST node**         | Return `{1, node_pointer}`                                                         |
| **SEQ [f₁,f₂,…]**      | Emit each function call in order, test `ok` after each                             |
| **UNION [f₁,f₂,…]**    | Emit chained `if` blocks; return first successful result                           |
| **PRODUCT [l₁=f₁, …]** | Call all subfunctions; if all succeed, collect children and call `@k_make_product` |
| **FAIL**               | Return `{0, undef}` immediately                                                    |

These templates cover the entire language.

---

### **12.4  Example: sequential composition**

For IR:

```
SEQ [ PROJECT x, CALL f, CALL g ]
```

the compiler emits:

```llvm
%r1 = call %KOpt @k_project_x(%in)
%ok1 = extractvalue %KOpt %r1, 0
br i1 %ok1, label %cont1, label %fail

cont1:
%r2 = call %KOpt @f(%r1.val)
%ok2 = extractvalue %KOpt %r2, 0
br i1 %ok2, label %cont2, label %fail

cont2:
%r3 = call %KOpt @g(%r2.val)
ret %KOpt %r3

fail:
ret %KOpt { i1 0, %KVal undef }
```

Each block corresponds to one stage in the composition.
The use of conditional branches ensures that undefinedness propagates correctly.

---

### **12.5  Example: product composition**

For IR:

```
PRODUCT [ a = PROJECT x, b = PROJECT y ]
```

the compiler generates code equivalent to:

```llvm
%ra = call %KOpt @k_project_x(%in)
%ok_a = extractvalue %KOpt %ra, 0
br i1 %ok_a, label %try_b, label %fail

try_b:
%rb = call %KOpt @k_project_y(%in)
%ok_b = extractvalue %KOpt %rb, 0
%ok_all = and i1 %ok_a, %ok_b
br i1 %ok_all, label %build, label %fail

build:
%children = alloca [%KVal, 2]
%p0 = getelementptr [%KVal,2], [%KVal,2]* %children, i32 0, i32 0
store %KVal (extractvalue %KOpt %ra, 1), %KVal* %p0
%p1 = getelementptr [%KVal,2], [%KVal,2]* %children, i32 0, i32 1
store %KVal (extractvalue %KOpt %rb, 1), %KVal* %p1
%res = call %KVal @k_make_product(i32 state_id, i32 2, %KVal* %children)
ret %KOpt { i1 1, %KVal %res }

fail:
ret %KOpt { i1 0, %KVal undef }
```

The resulting LLVM code faithfully follows the semantic rule: the product is defined only if all components are defined.

---

### **12.6  Example: union composition**

For IR:

```
UNION [ .x, .y ]
```

the compiler produces a branching structure:

```llvm
%r1 = call %KOpt @k_project_x(%in)
%ok1 = extractvalue %KOpt %r1, 0
br i1 %ok1, label %merge, label %try_next

try_next:
%r2 = call %KOpt @k_project_y(%in)
br label %merge

merge:
%res = phi %KOpt [ %r1, %ok1 ], [ %r2, %try_next ]
ret %KOpt %res
```

This pattern ensures that the first defined branch wins, as specified by the semantics.

---

### **12.7  Managing constants and types**

Whenever an expression references a constant value or a type restriction:

* **Constant values** are replaced by pointers to global constant nodes.
* **Type expressions `$T`** are compiled to a `TYPECHECK` instruction:
  if `input->state != T_state`, the function returns undefined.

This approach removes all high-level notation before reaching machine level.

---

### **12.8  Optimizing during generation**

Because the structure of k is very regular, many optimizations can be applied while generating code:

* **Eliminate redundant checks** — consecutive type checks on the same state can be merged.
* **Inline small functions** — short constant or projection functions can be inserted directly into their callers.
* **Remove unreachable branches** — if a type restriction guarantees that one union branch can never apply, it is omitted.

Such simplifications can be done by the compiler itself or delegated to LLVM’s optimization passes.

---

### **12.9  Interaction with the runtime**

All allocation and field access are performed through runtime calls.
The compiler never manipulates pointers directly beyond passing them to these helpers.
This design ensures that compiled code is independent of the internal memory layout.

The generated functions thus resemble small graphs of calls and conditionals built entirely on top of the fixed ABI.

---

### **12.10  Linking and verification**

After all functions are emitted, the compiler writes a single LLVM module containing:

* all generated functions,
* declarations of runtime primitives (`k_project`, `k_make_product`, etc.),
* and constant nodes representing literal values.

The LLVM verifier then checks that:

* every function returns a correctly typed `%KOpt`,
* all control-flow paths end with a `ret`,
* and all global references are defined.

Only verified code is passed to the optimizer or the machine-code generator.

---

### **12.11  Summary**

* Code generation turns IR into real executable instructions.
* Each k function maps to an LLVM function returning `{ok, value}`.
* Projection, composition, union, and product translate into small, fixed code patterns.
* Type restrictions become simple integer comparisons.
* The compiler can apply immediate simplifications during translation.
* The final output is a verified LLVM module ready for optimization and linking.

---

## **Chapter 13 — Linking and Execution**

### **13.1  Purpose**

The last stage of compilation connects the generated code with the runtime library and produces an executable program.
This process is called **linking**.
Once linked, the program can be run like any other compiled program: it reads input values, executes the compiled k functions, and returns a result.

The linking and execution stages ensure that the compiled code, the runtime library, and the data it manipulates all agree on structure and conventions.

---

### **13.2  The runtime library**

All compiled k programs depend on a small runtime component, often distributed as a file named `krt.c` or `krt.o`.
This library provides:

| Function                             | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| `k_make_product(state, n, children)` | Allocate a product node with `n` fields.           |
| `k_make_union(state, tag, child)`    | Allocate a union node with a single variant.       |
| `k_project(input, label_id)`         | Perform projection `.label`.                       |
| `k_fail()`                           | Return a predefined undefined result `{ ok = 0 }`. |
| `k_unit()`                           | Return the constant unit value `{}`.               |

These functions implement the same concepts as the semantic rules described earlier, but at the level of actual memory operations.
They are compiled once in a low-level language such as C and reused by all generated programs.

---

### **13.3  Metadata tables**

Along with the runtime functions, the compiler produces **metadata** describing each canonical type used in the program:

* `state_kind[state]` — `0` for product, `1` for union
* `state_arity[state]` — number of children
* `field_index[state][label_id]` — position of field `label_id` within product
* `variant_index[state][label_id]` — tag number for variant `label_id` within union

These tables are stored as constant arrays in the compiled module.
Runtime functions use them to interpret and construct nodes correctly without needing any dynamic reflection.

---

### **13.4  Linking**

The generated LLVM file is compiled and linked with the runtime library in two simple steps:

```bash
clang -O2 -c krt.c -o krt.o
clang -O2 program.ll krt.o -o program
```

The first command compiles the runtime once.
The second command combines the runtime with the program’s own functions and constant definitions.

The result is a native executable file named `program`.
When run, it behaves exactly like the original k program.

---

### **13.5  Initialization**

When the executable starts, it performs a few basic steps:

1. Allocate an **arena** for storing newly created nodes.
2. Initialize constant nodes such as the unit `{}` and any user-defined constants.
3. Optionally, prepare a table of function pointers for fast invocation.

After initialization, the main compiled function can be called directly.

---

### **13.6  Executing a compiled function**

Every compiled function has the signature:

```c
struct KOpt function(struct KNode* input);
```

To run a program, a caller must supply an input value tree in the expected canonical form.
The value is typically created by another function or loaded from serialized data.

For example, to execute a function `neg` expecting a `$bool`:

```c
struct KOpt result = neg(&true_node);
if (result.ok)
    print_value(result.val);
else
    printf("undefined\n");
```

If the input is `{ {} true }`, the output will be `{ {} false }`.

---

### **13.7  Input and output conventions**

At the machine level, a “value” is always represented by a pointer to a `KNode`.
Each compiled function expects exactly one such pointer.
When a function returns, its output pointer may refer to an existing constant node, a new node allocated in the arena, or nothing at all if undefined.

There is no special I/O system in k itself; printing or reading values is the responsibility of the host environment.
In practice, programs are tested by calling compiled functions from C or Python and inspecting their returned structures.

---

### **13.8  Debugging and inspection**

Because both the generated code and the runtime library are deterministic and memory-safe, debugging usually consists of examining node contents.

Two simple runtime utilities are useful:

* `print_value(node)` — prints a tree in human-readable form.
* `print_type(state)` — prints the canonical description of a type state.

They allow the user to confirm that compiled functions construct the correct tree shapes.

---

### **13.9  Verification**

After linking, the compiler can run a *self-verification pass*:

1. Construct small sample inputs for each exported function.
2. Execute the compiled function.
3. Compare results with the interpreter’s result using structural equality.

If all match, the compiler’s translation is confirmed correct for those test cases.
This method is especially valuable during compiler development and textbook exercises.

---

### **13.10  Example: complete run**

Example program:

```
$bool = < {} true, {} false >;
neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
```

Steps:

1. Compile to `neg.ll`.
2. Link with `krt.o`.
3. Run a small C driver that calls `neg`.

Output:

```
input  = {{ } true}
result = {{ } false}
```

If `input` is `{}` or any non-`$bool` value, the function is undefined and prints “undefined”.

---

### **13.11  Summary**

* Linking combines generated LLVM code with the shared runtime library.
* The runtime provides allocation, projection, and constant handling.
* Metadata tables describe type structure to the runtime.
* Every compiled function follows the uniform calling convention `KOpt f(KNode*)`.
* Execution produces immutable tree values exactly matching the semantics of k.
* Verification against the interpreter ensures correctness of the translation.

---

## **Chapter 14 — Canonical Serialization**

### **14.1  Purpose**

Serialization is the process of converting a value in memory into a compact sequence of bits or bytes that can be stored or transmitted.
For the k language, serialization serves an additional goal: it defines a **canonical representation** of each value that is unique and independent of the machine on which it was produced.

A canonical encoding allows values to be compared, hashed, or stored in a registry in a reproducible way.
Two values that are structurally identical will always produce the same bit sequence.

---

### **14.2  Canonical type information**

Serialization always depends on the **canonical form of the type**.
A type in canonical form is a finite tree automaton (Chapter 3) that describes the structure of all its values.
Because this form is unique, every possible value of the type can be encoded deterministically.

Before any value is serialized, the compiler or runtime must know:

* the list of states (C0, C1, …),
* for each state, whether it is a product or a union,
* the number of possible transitions, and
* for unions, the order of their variants.

This information acts as the grammar from which all bit sequences are derived.

---

### **14.3  Encoding principle**

Each node in a value tree corresponds to one of the type’s states.

* **Product node** – emits no bits; the encoder simply serializes each child in canonical field order.
* **Union node** – emits a small binary code that identifies which variant is used, then serializes its single child.
* **Unit node** (empty product) – emits nothing; it has no children.
* **Empty union** – cannot be encoded because it has no possible values.

Thus, the sequence of bits records exactly which union branches were taken while descending the tree.

---

### **14.4  Fixed-length codes per state**

For simplicity, each union state uses fixed-length binary codes of equal size.

If a union has *m* variants, then

```
k = ceil(log2(m))
```

bits are needed.
Each variant is numbered in canonical order from 0 to m − 1 and represented by the binary form of its index.

Products and units use k = 0 and emit no bits.

This rule allows the decoder to know, from the type alone, how many bits to read at each step.

---

### **14.5  Example: natural numbers**

For the type

```
$bnat = < bnat 0, bnat 1, {} _ >;
```

the canonical form has three transitions from state C0.
Therefore, `k = ceil(log2(3)) = 2` bits are required per union node.

Assigning codes in order:

| Rule           | Code |
| -------------- | ---- |
| C0 → {C0 "0"}  | `00` |
| C0 → {C0 "1"}  | `01` |
| C0 → {C1 "_" } | `10` |

The value `{ {{ {} _ } 1 } 0 }` is encoded by concatenating the codes of the transitions chosen during a leftmost derivation:

```
00 → first C0
01 → next C0
10 → final C0
```

Resulting bit sequence: `000110`.

---

### **14.6  Decoding**

Decoding is deterministic and mirrors the encoding process:

1. Start at the root state (C0).
2. If the current state is a union, read k bits to choose a rule.
3. Create the corresponding node, then recursively decode its child or children.
4. For products, decode all children in order; for units, stop.

The decoder stops when the entire tree has been reconstructed and all bits have been consumed.

Because every union code is of fixed length, the decoding process requires no backtracking and can be implemented as a simple loop.

---

### **14.7  Folding repeated subtrees**

Many values contain repeated substructures.
To avoid serializing the same tree several times, identical subtrees can be *folded* into a **directed acyclic graph (DAG)** before encoding.

Each unique node is assigned an identifier.
When the encoder encounters a repeated node, it emits a reference to its identifier instead of encoding it again.

During decoding, the identifier is resolved to the corresponding subtree, reconstructing the shared structure.

Folding is optional; it saves space without changing the logical value.

---

### **14.8  Stream format**

A minimal canonical bitstream consists of:

1. **Header** – type hash (e.g., 8 bytes) identifying the canonical type.
2. **Node count** – integer *N* if DAG encoding is used.
3. **Encoded data** – concatenation of all fixed-length union codes and, if folded, node references.

If two systems share the same canonical type table, the bitstream alone is enough to reconstruct the original value.

---

### **14.9  Implementation sketch**

A compact encoder can be written as follows:

```
procedure encode(node):
    if node.arity == 0:
        return
    if node.arity == 1:
        write_bits(code_for(node.state, node.tag))
        encode(node.child[0])
    else:
        for each child in node.children:
            encode(child)
```

The corresponding decoder reverses the process.
Both procedures require only the canonical type tables and simple bit operations.

---

### **14.10  Determinism and equality**

Because encoding is fully determined by the canonical type and field order, two equal values always produce identical bit sequences.
Conversely, decoding the same bit sequence always yields the same tree.

This property allows equality comparison by direct byte comparison of serialized forms, without traversing the trees in memory.

---

### **14.11  Summary**

* Every type’s canonical automaton defines a unique bit-level grammar for its values.
* Products emit no bits; unions emit fixed-length variant codes.
* The number of bits required for each state depends only on the number of variants in that state.
* Optional DAG folding eliminates repeated subtrees.
* The resulting bitstream is compact, deterministic, and machine-independent.

---

## **Chapter 15 — Optimization and Folding**

### **15.1  Purpose**

Optimization in the k compiler is the process of simplifying functions without changing their meaning.
The goal is to make the generated code smaller, faster, and easier to verify.
Because k is purely functional and has no side effects, optimizations are safe whenever the simplified function is equivalent to the original one.

This chapter describes a few basic optimizations that follow directly from the semantics introduced earlier.

---

### **15.2  Constant folding**

A **constant** is a function that ignores its input and always produces the same value.
If a composition of functions can be evaluated entirely at compile time, it can be replaced by a single constant function.

Example:

```
true_bool  = {{ } true} $bool;
not_true   = (true_bool neg);
```

The compiler observes that `(true_bool neg)` always yields `false_bool`, so it replaces it with a constant:

```
not_true = {{ } false} $bool;
```

Constant folding removes unnecessary runtime computation.

---

### **15.3  Type-based simplifications**

Since type expressions act as identity functions defined only on specific values, they can be eliminated when redundant:

```
$bool $bool f   →  $bool f
```

If a function’s input or output type is already known from context, repeated checks can be omitted.
The compiler ensures that at least one valid check remains to preserve correctness.

---

### **15.4  Inlining**

Inlining replaces a call to a small function by its body.
It avoids the overhead of a function call and often exposes further simplifications.

Example:

```
id = ();
f  = (id g);
```

Because `id` is the identity function, `(id g)` is equivalent to `g`.
Inlining removes the useless call.

For larger functions, inlining is applied selectively—only when it shortens the resulting code or eliminates intermediate values.

---

### **15.5  Dead-branch elimination**

In a union composition `<f, g>`, if type analysis shows that the input type can only satisfy the first branch, the second branch can never be defined and is removed.

Example:

```
$bool = < {} true, {} false >;
f = $bool < .true {{ } false} >;
```

Here, since `$bool` restricts the input to only the two variants `true` and `false`, and the second variant `.false` is not handled, the compiler infers that `f` is undefined for `.false` and simplifies the code accordingly.

Dead-branch elimination keeps the generated control flow minimal.

---

### **15.6  Common subexpression elimination**

If the same partial function is applied multiple times to the same input, the result will always be the same.
The compiler can compute it once and reuse the result.

Example:

```
{ .x .y, .x .z }
```

Both fields start with the projection `.x`.
The compiler computes `.x` once, stores the result, and reuses it for `.y` and `.z`.
This optimization reduces repeated traversal of the same input structure.

---

### **15.7  Canonical folding**

During evaluation, many values share identical subtrees.
A **folding pass** replaces identical subtrees by shared nodes, forming a minimal DAG (directed acyclic graph).

At compile time, folding may also apply to constant expressions.
If two constant subtrees are identical, they are merged and stored as a single global node.

This process ensures that structural equality corresponds to pointer equality: two values are identical if they share the same root node.

---

### **15.8  Function canonicalization**

Every function can be normalized by expanding all type aliases, inlining trivial definitions, and folding identical subfunctions.
The normalized form of a function depends only on its semantics, not on the way it was written.

A stable hash computed from this canonical representation serves as a permanent identifier for the function, just as type hashes identify canonical types.

This property is essential for the schema registry described in the next chapter.

---

### **15.9  Runtime simplifications**

At runtime, additional micro-optimizations are possible:

* **Arena reuse:** allocate nodes in a memory region that is cleared after each function call.
* **Hash-consing:** maintain a small table of recently created nodes to reuse identical ones automatically.
* **Shortcut constants:** return pointers to global constants instead of allocating new copies for unit or boolean values.

Such optimizations reduce memory usage without changing program behavior.

---

### **15.10  Equivalence and correctness**

Each optimization must preserve *semantic equivalence*: for every input, the optimized function must be defined for exactly the same values and must return the same result when defined.

Because k’s semantics are purely functional, equivalence can be tested mechanically by comparing evaluation results on all finite inputs of a small type, or by structural reasoning when types are infinite.

---

### **15.11  Summary**

* Optimization in k relies on algebraic properties of pure functions.
* Common transformations include constant folding, inlining, dead-branch elimination, and subexpression reuse.
* Folding shared subtrees yields compact DAG representations of values.
* Canonical function forms allow stable hashing and reproducible compilation results.
* All optimizations preserve exact semantic behavior.

---

## **Chapter 16 — Toward a Universal Schema Registry**

### **16.1  Motivation**

Every canonical type and function in k has a unique structural form and a stable hash.
These hashes can serve as global identifiers.
A registry that maps such identifiers to definitions allows programs and systems to exchange schemas and functions safely and reproducibly.

---

### **16.2  Basic structure**

A schema registry stores entries of two kinds:

| Kind         | Example content                                               |
| ------------ | ------------------------------------------------------------- |
| **Type**     | canonical automaton text for a type hash                      |
| **Function** | canonical IR or serialized representation for a function hash |

Each entry is immutable.
New versions are added as new hashes.

---

### **16.3  Key operations**

1. **Lookup by hash** — return the canonical definition.
2. **Lookup by shape** — search for functions with given input/output type hashes.
3. **Verification** — ensure that two parties share the same canonical form before exchanging values.

These operations can be implemented as simple key–value queries.

---

### **16.4  Example format**

A minimal JSON entry:

```json
{
  "hash": "C0ABCDEF",
  "kind": "type",
  "definition": "$C0=<C0\"0\",C0\"1\",C1\"_\">;$C1={};"
}
```

or for a function:

```json
{
  "hash": "F7B1A2",
  "kind": "function",
  "input": "C0ABCDEF",
  "output": "C9FFF1",
  "ir": "SEQ [PROJECT x, CONST true]"
}
```

---

### **16.5  Uses**

* Preventing schema mismatches in distributed systems.
* Deduplicating identical definitions across projects.
* Enabling reproducible builds where all types and functions are referenced by hash.

---

### **16.6  Summary**

* Canonical types and functions can be globally identified by stable hashes.
* A simple registry provides lookup and verification of these definitions.
* Such registries make k programs portable, self-describing, and safe to share between systems.

---

## **Appendix — Implementing a Prototype Compiler in Python**

### **A.1  Purpose**

This appendix outlines how to implement a simple, working prototype of the k compiler in Python.
The goal is to let the reader experiment with parsing, type normalization, and LLVM code generation using only standard tools and a few small libraries.
The prototype does not need to support optimization or a full runtime—only the basic translation pipeline.

---

### **A.2  Required environment**

Install:

```bash
python3 -m venv kenv
source kenv/bin/activate
pip install llvmlite
```

`llvmlite` provides an interface to LLVM for code generation.
No additional dependencies are required.

---

### **A.3  Recommended directory structure**

```
k-compiler/
 ├── main.py             # command-line driver
 ├── parser.py           # converts source text to AST
 ├── types.py            # canonical type construction
 ├── normalize.py        # filter resolution and typing
 ├── ir.py               # intermediate representation
 ├── codegen.py          # translation from IR to LLVM
 ├── runtime.ll          # minimal runtime in LLVM
 └── examples/           # sample k programs
```

Each module is small and focused on one task.

---

### **A.4  The AST**

Represent the language syntax with Python classes:

```python
class Expr: pass

class Composition(Expr):
    def __init__(self, parts): self.parts = parts

class Product(Expr):
    def __init__(self, fields): self.fields = fields  # [(label, expr), ...]

class Union(Expr):
    def __init__(self, options): self.options = options  # [expr, ...]

class Projection(Expr):
    def __init__(self, label): self.label = label

class Constant(Expr):
    def __init__(self, name): self.name = name
```

The parser builds these objects from source text.

---

### **A.5  Type normalization**

Maintain canonical type states as small Python objects:

```python
class TypeState:
    def __init__(self, kind, transitions):
        self.kind = kind      # 'product' or 'union'
        self.transitions = transitions  # [(label, next_state)]
```

Normalization expands type aliases and assigns numeric state IDs (`C0`, `C1`, …).
For a prototype, a simple structural hash (using `json.dumps`) can serve as the canonical identifier.

---

### **A.6  Intermediate representation**

Represent IR instructions as simple tuples or small classes:

```python
class Project:  def __init__(self, label): self.label = label
class Const:    def __init__(self, node):  self.node = node
class Seq:      def __init__(self, parts): self.parts = parts
class UnionIR:  def __init__(self, parts): self.parts = parts
class ProductIR:def __init__(self, fields):self.fields = fields
```

A recursive function converts an AST expression into IR following Chapter 10.

---

### **A.7  Generating LLVM code**

Using `llvmlite.ir`, create one LLVM function per compiled function:

```python
from llvmlite import ir

mod = ir.Module(name="k")

# LLVM type definitions
KNodePtr = ir.PointerType(ir.IntType(8))
KVal  = ir.LiteralStructType([KNodePtr])
KOpt  = ir.LiteralStructType([ir.IntType(1), KVal])

def emit_function(name, ir_expr):
    fn_type = ir.FunctionType(KOpt, [KVal])
    fn = ir.Function(mod, fn_type, name=name)
    block = fn.append_basic_block('entry')
    builder = ir.IRBuilder(block)
    # translate ir_expr recursively into builder calls
    builder.ret(ir.Constant(KOpt, (ir.Constant(ir.IntType(1), 0),
                                   ir.Constant(KVal, ir.Constant(KNodePtr, None)))))
```

The translation patterns follow those described in Chapter 12.
Each IR node is emitted as a call or conditional block using `builder.call`, `builder.if_then`, and so on.

---

### **A.8  Minimal runtime**

Write a minimal `runtime.ll` that defines stubs for:

```llvm
declare %KOpt @k_project(%KVal %v, i32 %label)
declare %KVal @k_make_product(i32 %state, i32 %n, %KVal* %children)
declare %KVal @k_make_union(i32 %state, i32 %tag, %KVal %child)
```

These can simply return placeholder constants for testing.
Later, they can be replaced with the real runtime implemented in C.

---

### **A.9  Putting it together**

A small driver script (`main.py`) can compile a file and emit LLVM text:

```python
import parser, normalize, ir, codegen

def compile_file(path):
    src = open(path).read()
    ast = parser.parse(src)
    typed = normalize.process(ast)
    ir_tree = ir.from_ast(typed)
    llvm_module = codegen.emit(ir_tree)
    print(str(llvm_module))
```

Run:

```bash
python main.py examples/neg.k > neg.ll
clang -O2 neg.ll runtime.ll -o neg
```

---

### **A.10  Suggested extensions**

1. Implement the runtime functions in Python for quick testing.
2. Add a textual REPL that reads a k expression and prints its IR.
3. Integrate a simple interpreter to compare interpreter and compiled results.
4. Use hashing of canonical forms to name generated LLVM functions.

---

### **A.11  Summary**

A prototype compiler can be realized in fewer than a thousand lines of Python.
It can parse k definitions, construct canonical types, translate expressions into IR, and generate valid LLVM code.
Such a prototype is enough to experiment with all ideas presented in this textbook and to verify the semantics of the k language in practice.

---

## **Appendix — Incorporating External Predefined Types and Functions**

### **B.1  Purpose**

The k language is intentionally minimal.
Nevertheless, real systems often need to interact with data types and operations defined outside of k—for example, numeric values, text, or platform-specific constants.
This appendix explains how external predefined types and functions can be introduced into a k compiler without changing the language itself.

---

### **B.2  External types**

An **external type** is a canonical type that is *not* expressed through k’s own product-and-union syntax but is known to the compiler through registration.

Each external type has:

| Field                 | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| **Name**              | symbolic name (e.g., `$int`, `$string`)                                      |
| **Hash**              | unique stable identifier, just like canonical types                          |
| **Runtime kind**      | how the value is stored in memory (pointer, immediate integer, etc.)         |
| **Adapter functions** | conversion between the external representation and the standard `KNode` tree |

Example registry entry:

```json
{
  "hash": "E001",
  "kind": "type",
  "external": true,
  "name": "$int",
  "runtime_kind": "primitive_i64"
}
```

The compiler treats such a type as an atomic node, represented internally as a single `KNode` with `arity = 0` but tagged as *external*.

---

### **B.3  External constructors**

External types may provide special constructors or constants.
For example, `$int` might include predefined constant functions:

```
zero  = {} $int;
one   = {} $int;
```

At compile time these appear as constant functions returning fixed external nodes provided by the runtime.

---

### **B.4  External functions**

External functions are partial functions implemented outside of k but declared inside a k program.
They have known input and output types, possibly external.

Declaration syntax:

```
extern add : $int $int → $int;
extern less : $int $int → $bool;
```

At compile time the compiler records the signature and associates it with a runtime symbol name such as `k_ext_add`.

When generating code, each external call becomes a standard function call following the ABI:

```llvm
declare %KOpt @k_ext_add(%KVal %a, %KVal %b)
```

The runtime library provides these implementations in a native language (C, C++, Rust, etc.).

---

### **B.5  Integration with canonical types**

External types are integrated into the canonical system as *leaf states*.
They can appear as components in products or unions just like built-in ones.

Example:

```
$point = { $int x, $int y };
```

Canonical form:

```
$C0 = { C1 "x", C1 "y" };
$C1 = external $int;
```

This allows normal serialization and type comparison; the external leaf is treated as opaque but identified by its hash.

---

### **B.6  Serialization and external values**

During serialization, an external node is encoded by:

1. Its type hash (to indicate which external kind it represents).
2. A binary blob produced by a runtime-supplied encoder for that type.

Deserialization reverses the process using the corresponding decoder.
All external codecs must be deterministic and version-stable to preserve canonical equality.

---

### **B.7  Example**

Suppose we introduce `$int` and external function `add`:

```
$pair_int = { $int a, $int b };
sum = { .a x, .b y } (add x y);
```

The compiler generates code that:

* projects fields `.a` and `.b`,
* passes them as `KVal` pointers to `@k_ext_add`,
* and returns the result as a new `$int` node.

All logic outside arithmetic remains standard k code.

---

### **B.8  Practical implementation**

In a Python prototype:

```python
EXTERNAL_TYPES = {
    "$int": {"hash": "E001", "kind": "external", "runtime_kind": "primitive_i64"}
}

EXTERNAL_FUNCS = {
    "add":  {"inputs": ["$int", "$int"], "output": "$int", "symbol": "k_ext_add"},
    "less": {"inputs": ["$int", "$int"], "output": "$bool", "symbol": "k_ext_less"}
}
```

During code generation, when a call refers to an external function, the compiler emits a call to the symbol given in the table.

---

### **B.9  Summary**

* External predefined types extend k without altering its core semantics.
* They are registered with hashes and treated as atomic nodes.
* External functions follow the same calling convention as normal ones.
* Serialization of external values uses type-specific codecs.
* This mechanism allows integration of native computations (numbers, strings, system data) while preserving the purity and determinism of the k language.

---
