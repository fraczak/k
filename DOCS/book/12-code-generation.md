# Chapter 12 — Code Generation

## **12.1  Purpose**

The **code generation** phase translates the intermediate representation (IR) of each k function into executable code using the LLVM format described in Chapter 11.
This translation is systematic: every IR operation corresponds to a specific sequence of LLVM instructions or calls to the runtime library.

The compiler’s objective is to produce code that behaves exactly like the formal semantics of k—no more and no less.
Each step of the translation can therefore be viewed as a mechanical implementation of one of the rules introduced in Chapter 8.

---

## **12.2  Structure of generated functions**

Each k function becomes a stand-alone LLVM function with the signature:

```llvm
define %KOpt @f_name(%KVal %in)
```

Internally, the function has one or more *basic blocks*.
Each block performs a small action: a projection, a check, a call, or a node construction.
Blocks are connected by explicit branches that depend on the `ok` flag of intermediate results.

At the end of the function, exactly one `%KOpt` value is returned.

---

## **12.3  Translating core operations**

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

## **12.4  Example: sequential composition**

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

## **12.5  Example: product composition**

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

## **12.6  Example: union composition**

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

## **12.7  Managing constants and types**

Whenever an expression references a constant value or a type restriction:

* **Constant values** are replaced by pointers to global constant nodes.
* **Type expressions `$T`** are compiled to a `TYPECHECK` instruction:
  if `input->state != T_state`, the function returns undefined.

This approach removes all high-level notation before reaching machine level.

---

## **12.8  Optimizing during generation**

Because the structure of k is very regular, many optimizations can be applied while generating code:

* **Eliminate redundant checks** — consecutive type checks on the same state can be merged.
* **Inline small functions** — short constant or projection functions can be inserted directly into their callers.
* **Remove unreachable branches** — if a type restriction guarantees that one union branch can never apply, it is omitted.

Such simplifications can be done by the compiler itself or delegated to LLVM’s optimization passes.

---

## **12.9  Interaction with the runtime**

All allocation and field access are performed through runtime calls.
The compiler never manipulates pointers directly beyond passing them to these helpers.
This design ensures that compiled code is independent of the internal memory layout.

The generated functions thus resemble small graphs of calls and conditionals built entirely on top of the fixed ABI.

---

## **12.10  Linking and verification**

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

## **12.11  Summary**

* Code generation turns IR into real executable instructions.
* Each k function maps to an LLVM function returning `{ok, value}`.
* Projection, composition, union, and product translate into small, fixed code patterns.
* Type restrictions become simple integer comparisons.
* The compiler can apply immediate simplifications during translation.
* The final output is a verified LLVM module ready for optimization and linking.

---