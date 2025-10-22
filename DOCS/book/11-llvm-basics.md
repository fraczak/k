# Chapter 11 — LLVM Basics

## **11.1  Purpose**

The previous chapters described how a k program can be reduced to a small set of intermediate operations.
To execute these operations efficiently, the compiler must translate them into an actual machine language.
Instead of generating raw machine code directly, we use a common intermediate format called **LLVM IR** (LLVM *Intermediate Representation*).

LLVM IR is a low-level, strongly typed language that resembles a simplified form of assembly.
It can be read and written as text, analyzed, optimized, and compiled to machine code for almost any processor.
For the compiler writer, it provides a bridge between high-level language semantics and executable programs.

---

## **11.2  Structure of an LLVM program**

An LLVM program consists of **global definitions** and **functions**.

* *Global definitions* describe data structures shared between functions.
  In the k compiler, this includes the runtime metadata tables and constant nodes such as `{}`.

* *Functions* contain sequences of instructions grouped into **basic blocks**.
  A basic block is a straight-line segment of code with no branches except at the end.
  Branches connect blocks, forming a control-flow graph.

Each instruction produces a new value; values are immutable once created.
This property is called *single static assignment* (SSA).

---

## **11.3  Data types**

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

## **11.4  Function signatures**

Every compiled k function is translated into one LLVM function with the following signature:

```llvm
define %KOpt @f_name(%KVal %in) { ... }
```

The function takes a single argument `%in`, which holds the pointer to the input value.
It returns a `%KOpt` structure containing the success flag and the resulting value.

This mirrors the runtime ABI introduced in Chapter 7.
By using the same layout, all functions can call each other without conversions.

---

## **11.5  Control flow**

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

## **11.6  Memory operations**

Most functions in k do not modify existing nodes; they create new ones.
Node creation is implemented as calls to runtime functions:

```llvm
declare %KVal @k_make_product(i32 %state, i32 %n, %KVal* %children)
declare %KVal @k_make_union(i32 %state, i32 %tag, %KVal %child)
```

These calls allocate new immutable nodes.
The compiler provides the correct `state`, `tag`, and child references according to the canonical type.

---

## **11.7  Constants**

Constant values such as `{{} true}` are represented as global variables in LLVM:

```llvm
@unit_node  = constant %KNode { 1, -1, 0, [] }
@true_node  = constant %KNode { 0, 0, 1, [@unit_node] }
@false_node = constant %KNode { 0, 1, 1, [@unit_node] }
```

Each constant is a fully formed node with fixed fields.
When a constant function is called, the compiler returns a pointer to the corresponding global node.

---

## **11.8  From IR to LLVM**

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

## **11.9  Example**

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

## **11.10  Optimization and verification**

LLVM provides built-in passes that simplify generated code:

* **mem2reg** — removes unnecessary memory operations,
* **instcombine** — merges simple operations,
* **gvn** — removes redundant calculations,
* **simplifycfg** — cleans up control flow.

The compiler can run these passes automatically to produce compact and efficient output.
LLVM also verifies that all types and values are consistent before emitting machine code.

---

## **11.11  Summary**

* LLVM IR is a portable, low-level language ideal for code generation.
* Every k function becomes an LLVM function returning the pair `{ok, value}`.
* All constants, type checks, and runtime calls are represented explicitly.
* The translation from k’s intermediate form to LLVM is direct and systematic.
* Standard LLVM tools can then optimize and compile the result into executable machine code.

---