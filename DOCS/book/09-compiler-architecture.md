# Chapter 9 — Compiler Architecture

## **9.1  What the compiler does**

A *compiler* for the k language is a program that reads another program (written in k) and produces a lower-level version of it.
The lower-level version can then be executed efficiently by a computer.

For k, the compiler’s task is simple in concept:

1. **Read** the definitions of types and functions.
2. **Understand** their structure and the relationships between them.
3. **Translate** them into equivalent instructions that follow the runtime conventions described in Chapters 6–8.

The compiler must ensure that every function in the source program becomes a machine-level function that behaves in exactly the same way:
it takes a value as input, may or may not be defined for it, and, if defined, produces another value.

---

## **9.2  The main stages**

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

## **9.3  Internal structure**

A minimal compiler can be viewed as three connected modules:

* **Front end** — reads source code, builds the AST, performs type analysis.
* **Middle** — resolves all references, normalizes types, and simplifies expressions.
* **Back end** — produces the executable form.

Although these terms are traditional, the distinction is simple:
the front end *understands* the program, the back end *emits* it, and the middle part connects the two.

---

## **9.4  Data kept by the compiler**

During translation the compiler maintains several tables:

| Name               | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| **Type table**     | Maps type names to canonical forms and assigns numeric state IDs. |
| **Field table**    | For each product type, records the order and index of its fields. |
| **Variant table**  | For each union type, records the tags and their numeric indices.  |
| **Function table** | Associates function names with their input and output types.      |

These tables ensure that generated code can find fields and variants by number rather than by name, which simplifies execution.

---

## **9.5  Example of transformation**

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

## **9.6  Intermediate representation**

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

## **9.7  Linking with the runtime**

The generated code does not contain memory allocation or type tables itself.
Instead, it relies on the runtime library (`krt`), which provides:

* functions such as `k_project` and `k_make_union`,
* metadata tables for each canonical type, and
* the unit value `{}` shared by all programs.

When the compiler finishes, it outputs a text file in the target language plus references to this runtime library.
The two together form an executable program.

---

## **9.8  Simplicity of the model**

Because every expression in k takes exactly one input and may return one output or be undefined,
the compiler never has to deal with variable environments, loops, or side effects.
This makes the structure of the generated program very regular:

```
input → [series of calls and checks] → output or undefined
```

Each compiled function is independent and stateless.
This regularity is what allows k to map cleanly to low-level code.

---

## **9.9  Summary**

* The compiler transforms k programs into executable form through a sequence of simple, deterministic steps.
* Type information and structure are resolved before code generation.
* All generated functions follow the same calling convention (`ok`, `val`).
* The runtime library provides the shared operations needed by every program.
* The entire process mirrors the formal semantics defined earlier but expresses it as concrete machine operations.

---