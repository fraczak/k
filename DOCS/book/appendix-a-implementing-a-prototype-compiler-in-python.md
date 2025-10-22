# Appendix A — Implementing a Prototype Compiler in Python
## **A.1  Purpose**

This appendix outlines how to implement a simple, working prototype of the k compiler in Python.
The goal is to let the reader experiment with parsing, type normalization, and LLVM code generation using only standard tools and a few small libraries.
The prototype does not need to support optimization or a full runtime—only the basic translation pipeline.

---

## **A.2  Required environment**

Install:

```bash
python3 -m venv kenv
source kenv/bin/activate
pip install llvmlite
```

`llvmlite` provides an interface to LLVM for code generation.
No additional dependencies are required.

---

## **A.3  Recommended directory structure**

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

## **A.4  The AST**

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

## **A.5  Type normalization**

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

## **A.6  Intermediate representation**

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

## **A.7  Generating LLVM code**

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

## **A.8  Minimal runtime**

Write a minimal `runtime.ll` that defines stubs for:

```llvm
declare %KOpt @k_project(%KVal %v, i32 %label)
declare %KVal @k_make_product(i32 %state, i32 %n, %KVal* %children)
declare %KVal @k_make_union(i32 %state, i32 %tag, %KVal %child)
```

These can simply return placeholder constants for testing.
Later, they can be replaced with the real runtime implemented in C.

---

## **A.9  Putting it together**

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

## **A.10  Suggested extensions**

1. Implement the runtime functions in Python for quick testing.
2. Add a textual REPL that reads a k expression and prints its IR.
3. Integrate a simple interpreter to compare interpreter and compiled results.
4. Use hashing of canonical forms to name generated LLVM functions.

---

## **A.11  Summary**

A prototype compiler can be realized in fewer than a thousand lines of Python.
It can parse k definitions, construct canonical types, translate expressions into IR, and generate valid LLVM code.
Such a prototype is enough to experiment with all ideas presented in this textbook and to verify the semantics of the k language in practice.
