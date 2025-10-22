# Chapter 10 — From AST to Intermediate Representation

## **10.1  The purpose of an intermediate form**

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

## **10.2  Shape of the intermediate representation**

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

## **10.3  Example**

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

## **10.4  Relation to evaluation**

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

## **10.5  Building the IR**

The process of converting the AST to IR follows a recursive pattern:

1. **Projections and constants** become single instructions (`PROJECT`, `CONST`).
2. **Compositions** `(f g h)` become a `SEQ` list of their components.
3. **Unions** `<f,g>` become a `UNION` list.
4. **Products** `{f l₁, g l₂}` become a `PRODUCT` list with labeled entries.
5. **Type expressions** `$T` become `TYPECHECK` instructions.
6. **Filters** disappear; their meaning is already captured by typechecks.

Each transformation step produces IR nodes with fixed behavior and explicit order.

---

## **10.6  Verifying the IR**

Because k programs are defined by simple composition, a small set of checks ensures correctness:

1. Each `SEQ`, `UNION`, or `PRODUCT` list must have at least one element.
2. Every `PROJECT` or `CONST` must have a valid label or node reference.
3. Input and output states of consecutive steps must match.
4. A function must end in an operation that produces a result (`CONST`, `PROJECT`, `CALL`, or combination).

After verification, the IR is guaranteed to represent a valid partial function according to the semantics in Chapter 8.

---

## **10.7  Intermediate form as a small language**

The IR can be viewed as a minimal language on its own.
It has:

* one data type (`KNode*`),
* one universal value format (trees),
* and a fixed set of operators.

Its execution model is the same as the runtime ABI.
This means an interpreter for the IR can serve as a reference implementation of the k semantics before any machine code generation is added.

---

## **10.8  Example: product composition**

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

## **10.9  Why this representation is useful**

This intermediate form provides three practical benefits:

1. **Clarity** – every step is explicit and local.
2. **Verifiability** – type consistency and definedness can be checked mechanically.
3. **Flexibility** – the same IR can be translated to many targets (LLVM IR, C, or even interpreted directly).

Because of these advantages, most compilers for declarative languages use an intermediate form of this kind.

---

## **10.10  Summary**

* The abstract syntax tree is rewritten into a simpler, machine-oriented form.
* Each IR instruction represents one operation defined by the k semantics.
* Type and filter information appear as explicit checks.
* The IR is easy to verify and to translate into executable code.
* The IR can also serve as a precise description of how k functions behave step by step.

---