# From `k` Source To Executable Backend

A short walk-through of one simple `k` program as it moves through the current compiler pipeline and runs as a native executable.

---

## 1. The Source Program

We will use the small natural-number example from [`Examples/nat.k`](/Users/wojtek/gits/k/Examples/nat.k).

```k
$ nat = < {} zero, nat succ >;
zero = {} | zero ;
zero? = {/zero if, () then} .then;
succ = | succ;
add = ?X <
    {.x /succ x, .y succ y} ?X add,
    .y
>;
mult = <
    <.x zero?, .y zero?> zero,
    {{.x/succ x, .y y} mult x, .y y} add
>;

$nat zero?
```

The exported entrypoint is the last line:

- Input type: `nat`
- Program body: `zero?`
- Meaning: accept a natural number and succeed only when the input is `zero`

---

## 2. What The Compiler Does

The pipeline currently has four stages:

1. Parse and annotate `k` source using the existing JS frontend.
2. Lower annotated expressions into compiler IR.
3. Emit backend source.
   In this repo that means:
   - C source
   - LLVM-like textual IR
4. Link generated C against the small runtime and execute it.

---

## 3. Frontend Bundle

Run:

```bash
node k_compiler/compile.mjs --stage frontend Examples/nat.k
```

The frontend bundle contains:

- `rels`: annotated relation definitions
- `relAlias`: canonical function ids
- `registry`: canonical type registry
- `registryMetadata`: sorted field/variant metadata for backend lookup

For `nat`, the interesting registry fact is:

```json
{
  "@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF": {
    "kind": "union",
    "labels": ["succ", "zero"],
    "indexByLabel": {
      "succ": 0,
      "zero": 1
    }
  }
}
```

So the backend knows that `nat` is a union with two variants.

---

## 4. Lowered Compiler IR

Run:

```bash
node k_compiler/compile.mjs --stage ir Examples/nat.k
```

The `zero?` relation lowers to a regular IR shape:

```json
{
  "name": "zero?",
  "body": {
    "op": "SEQ",
    "steps": [
      { "op": "CHECK_SHAPE", "shape": "union" },
      { "op": "MAKE_PRODUCT", "fields": [
        { "label": "if", "build": { "op": "PROJECT_VARIANT", "label": "zero" } },
        { "label": "then", "build": { "op": "RETURN_INPUT" } }
      ]},
      { "op": "PROJECT_FIELD", "label": "then" },
      { "op": "CHECK_TYPE_VAR", "name": "X0" }
    ]
  }
}
```

Read this as:

1. Confirm the input has union shape.
2. Try to project the `zero` branch.
3. If that works, keep the original input as `then`.
4. Return `then`.

This is already close to executable control flow.

---

## 5. Generated C Backend

Run:

```bash
node k_compiler/compile.mjs --stage c Examples/nat.k
```

The entry function ends up calling the compiled form of `zero?`:

```c
KOpt kfn_227p5FPVzZxF4qFe77EaaQNFyMPU5xSbpHWz6vaEwmrN(KValue input) {
  KOpt tmp_1 = krt_guard_code(input, "@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF");
  if (!tmp_1.ok) return krt_fail();
  KOpt tmp_2 = kfn_nXXqMAi2PVsBzSN2KidWgg74hYhBbHQt5hw5TgPKvEy5(tmp_1.value);
  if (!tmp_2.ok) return krt_fail();
  KOpt tmp_3 = krt_guard_code(tmp_2.value, "@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF");
  if (!tmp_3.ok) return krt_fail();
  return tmp_3;
}

KOpt k_entry(KValue input) {
  return kfn_227p5FPVzZxF4qFe77EaaQNFyMPU5xSbpHWz6vaEwmrN(input);
}
```

That is already a normal native backend contract:

- `KValue input`
- `KOpt` result
- runtime helper calls for guards, projection, and construction

---

## 6. The Runtime Layer

The generated C links against:

- [`k_compiler/runtime.h`](/Users/wojtek/gits/k/k_compiler/runtime.h)
- [`k_compiler/runtime.c`](/Users/wojtek/gits/k/k_compiler/runtime.c)

The runtime currently provides:

- node allocation for products and variants
- code guards
- shallow shape guards
- field projection
- variant projection
- value printing for debugging

The current representation is intentionally simple:

```c
struct KNode {
  KNodeKind kind;
  const char *type_id;
  union {
    struct {
      int field_count;
      KField *fields;
    } product;
    struct {
      const char *tag;
      KValue child;
    } variant;
  } as;
};
```

---

## 7. Compile And Run Natively

The repo now contains a native smoke test in [`test-native-backend.mjs`](/Users/wojtek/gits/k/test-native-backend.mjs).

Run:

```bash
node test-native-backend.mjs
```

What it does:

1. Compiles `Examples/nat.k` to C.
2. Writes a tiny C driver.
3. Builds everything with `clang`.
4. Runs the executable.
5. Verifies behavior for two inputs.

The driver feeds:

- `zero({})`
- `succ(zero({}))`

Expected behavior:

- `zero` should succeed
- `succ(zero)` should be undefined

---

## 8. Native Result

The native test checks for output equivalent to:

```text
zero:1:zero({})
succ:0:undefined
```

Interpretation:

- `zero:1:zero({})`
  The compiled program accepted the input and returned the original `zero` value.
- `succ:0:undefined`
  The compiled program rejected `succ(zero)`, which matches the meaning of `zero?`.

---

## 9. LLVM-Like Output

Run:

```bash
node k_compiler/compile.mjs --stage llvm Examples/nat.k
```

This emits a textual backend module with:

- `%KValue` and `%KOpt` types
- runtime declarations such as `@krt_project_field`
- one generated function per compiled relation
- a single `@k_entry` entrypoint

This backend is still prototype-level, but it gives us a clean bridge toward a stricter LLVM lowering.

---

## 10. What This Demonstrates

This example now works end to end:

```text
k source
  -> typed frontend bundle
  -> compiler IR
  -> generated C backend
  -> linked runtime
  -> executable program
```

That means the project is no longer only an interpreter experiment.
It now has a real compiler path with a backend that can emit native code and run a compiled example.

---

## 11. Current Limits

The backend is still intentionally small:

- `CHECK_TYPE_VAR` is permissive
- shape checking is shallow
- some access/guard logic is still descriptor-driven
- LLVM output is inspectable text, not yet a verified machine-code path

But the foundation is now in place to replace descriptor-driven calls with more direct metadata-driven lowering.

---

## 12. Demo Commands

```bash
node test-compiler.mjs
node test-backend.mjs
node test-native-backend.mjs

node k_compiler/compile.mjs --stage frontend Examples/nat.k
node k_compiler/compile.mjs --stage ir Examples/nat.k
node k_compiler/compile.mjs --stage c Examples/nat.k
node k_compiler/compile.mjs --stage llvm Examples/nat.k
```

---

## 13. Suggested Closing Message

The important milestone is not “we can print backend text.”

The important milestone is:

> a small `k` program now compiles through the new pipeline, links against a runtime, and executes as native code with the expected result.
