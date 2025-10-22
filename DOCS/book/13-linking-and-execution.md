# Chapter 13 — Linking and Execution

## **13.1  Purpose**

The last stage of compilation connects the generated code with the runtime library and produces an executable program.
This process is called **linking**.
Once linked, the program can be run like any other compiled program: it reads input values, executes the compiled k functions, and returns a result.

The linking and execution stages ensure that the compiled code, the runtime library, and the data it manipulates all agree on structure and conventions.

---

## **13.2  The runtime library**

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

## **13.3  Metadata tables**

Along with the runtime functions, the compiler produces **metadata** describing each canonical type used in the program:

* `state_kind[state]` — `0` for product, `1` for union
* `state_arity[state]` — number of children
* `field_index[state][label_id]` — position of field `label_id` within product
* `variant_index[state][label_id]` — tag number for variant `label_id` within union

These tables are stored as constant arrays in the compiled module.
Runtime functions use them to interpret and construct nodes correctly without needing any dynamic reflection.

---

## **13.4  Linking**

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

## **13.5  Initialization**

When the executable starts, it performs a few basic steps:

1. Allocate an **arena** for storing newly created nodes.
2. Initialize constant nodes such as the unit `{}` and any user-defined constants.
3. Optionally, prepare a table of function pointers for fast invocation.

After initialization, the main compiled function can be called directly.

---

## **13.6  Executing a compiled function**

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

## **13.7  Input and output conventions**

At the machine level, a “value” is always represented by a pointer to a `KNode`.
Each compiled function expects exactly one such pointer.
When a function returns, its output pointer may refer to an existing constant node, a new node allocated in the arena, or nothing at all if undefined.

There is no special I/O system in k itself; printing or reading values is the responsibility of the host environment.
In practice, programs are tested by calling compiled functions from C or Python and inspecting their returned structures.

---

## **13.8  Debugging and inspection**

Because both the generated code and the runtime library are deterministic and memory-safe, debugging usually consists of examining node contents.

Two simple runtime utilities are useful:

* `print_value(node)` — prints a tree in human-readable form.
* `print_type(state)` — prints the canonical description of a type state.

They allow the user to confirm that compiled functions construct the correct tree shapes.

---

## **13.9  Verification**

After linking, the compiler can run a *self-verification pass*:

1. Construct small sample inputs for each exported function.
2. Execute the compiled function.
3. Compare results with the interpreter’s result using structural equality.

If all match, the compiler’s translation is confirmed correct for those test cases.
This method is especially valuable during compiler development and textbook exercises.

---

## **13.10  Example: complete run**

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

## **13.11  Summary**

* Linking combines generated LLVM code with the shared runtime library.
* The runtime provides allocation, projection, and constant handling.
* Metadata tables describe type structure to the runtime.
* Every compiled function follows the uniform calling convention `KOpt f(KNode*)`.
* Execution produces immutable tree values exactly matching the semantics of k.
* Verification against the interpreter ensures correctness of the translation.

---