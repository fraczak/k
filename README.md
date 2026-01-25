# k-language

## Overview

**k** is a language and notation for defining and combining **first-order partial functions**
over algebraic data types (called "codes").
Codes are built solely from product (records) and tagged union (variants).
The data model is JSON/XML-like in that values are tree-shaped and serialize naturally,
but there are no built-in primitive types; the only leaf used in non-recursive definitions
is the empty product `{}`.

---

## Getting started

Prerequisites: Node.js 18+.

- Install dependencies (this also generates parsers via the `prepare` script):
  - `npm install`
- Start the REPL locally:
  - `node repl.mjs`
  - Optional: `npm link` then run `k-repl`
- Run the test suite:
  - `npm test`
- Regenerate parsers manually (only needed if you edited `parser.jison` or `valueParser.jison`):
  - `npm run prepare`

> Notes (from `package.json`):

> - Scripts: `prepare` compiles the grammars; `test` runs all tests.
> - Binaries: `k` and `k-repl` point to `k.mjs` and `repl.mjs`.

---

## Data model: Codes = ADTs

- Codes are standard algebraic data types built from two constructors:
  - Product (records): native k-like `{ A label1, B label2, ... }` (canonical). For convenience, JSON-like `{ label1: A, label2: B, ... }` is also supported.
  - Tagged union (variants): native k-like `< A tag1, B tag2, ... >` (canonical). For convenience, JSON-like `< tag1: A, tag2: B, ... >` is also supported.
- No built-in scalars (no string/int/bool, etc.).
- The only leaf allowed in a non-recursive definition is the empty product `{}`.
- Values are trees whose internal nodes are products or tagged unions; field/tag names carry the structure.
- Code equivalence is bisimilarity over definition graphs (recursion allowed): there exists a relation B such that (t1, t2) ∈ B iff
  - t1 and t2 have exactly the same set of labels/tags;
  - t1 and t2 are simultaneously products or simultaneously unions;
  - for each label/tag ℓ in the set, the subcodes under ℓ are again related by B.
  
  Equivalence is the largest such bisimulation. 

> Note: This documentation uses the native k-like notation by default. The JSON-like form is provided as syntactic sugar to ease onboarding.

### Notation equivalence examples

- Product:
  - `{ nat x, nat y }  ≡  { x: nat, y: nat }`
- Union:
  - `< {} zero, nat succ >  ≡  < zero: {}, succ: nat >`

**Examples from the repo:**

- Naturals as Peano numbers (note `{}` as the leaf):

```k-repl
$ nat = < {} zero, nat succ >;         -- native k-like
$ nat = < zero: {}, succ: nat >;       -- JSON-like (equivalent)
```

- Bits and bytes (8-tuple product of bits):

```k-repl
$ bit = < {} 0, {} 1 >;                -- native k-like
$ bit = < 0: {}, 1: {} >;              -- JSON-like (equivalent)
$ byte = { bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7 };
$ byte = { 0: bit, 1: bit, 2: bit, 3: bit, 4: bit, 5: bit, 6: bit, 7: bit };
```

- A recursive list of bits (variant of `nil` or `cons`):

```k-repl
$ bytes = < {} nil, { bit car, bytes cdr } cons >;   -- native k-like
$ bytes = < nil: {}, cons: { car: bit, cdr: bytes } >;  -- JSON-like (equivalent)
```

---

## Partial Functions

A **partial function** is a function that may not return a value for every possible input.
In k, common examples include:

- **Product projection (.field):** Extracts a field from a product type value.
- **Union projection (/tag):** Asserts that the input is a variant with the specified tag and extracts its value.
- **Variant introduction (|tag):** Wraps an input value in a tagged variant.

**Examples:**

- Product projection: `.toto` extracts the `toto` field from a product.
  ```text
  .toto :
      {"toto": {"5":{}}, "titi": {"10":{}}}  -->  {"5":{}}
      {"titi": {"10":{}}}                         ... undefined
  ```
- Union projection: `/toto` asserts the input is a `toto` variant and extracts its value.
- Variant introduction: `|toto` wraps the input value in a `toto` variant.
  ```text
  |toto :
      {"5":{}}  -->  {"5":{}}|toto
  ```

> **How to read:**

> - The first line is a k-expression (before `:`).
> - The following lines show example inputs and outputs.
> - If the function is defined for the input, the result is shown after `-->`.
> - If not, `... undefined` is shown.

---

## Combining Partial Functions

There are three ways to combine functions in k:

### 1. Composition

Apply functions in sequence. For example, `(.toto .titi)` extracts the `titi` field from the `toto` field.

```text
(.toto .titi) :
    {"toto": {"titi": {}}}    --> {}
    {"toto": {"other": {}}}   ... undefined
    {"other": {}}             ... undefined
```

### 2. Merge

Try each function in order, returning the first defined result. For example, `<.x.y, .z.y>` tries to extract `y` from `x`, then from `z`.

```text
< .x.y, .z.y > :
    {"x": {"y": {"5": {}}}, "z": {"y": {"10": {}}}}    --> {"5":{}}
    {"x": {"o": {}}, "z": {"y": {"10": {}}}}           --> {"10":{}}
    {"x": {"o": {}}, "z": {"o": {}}}                   ... undefined
```

### 3. Product

Apply multiple functions and collect their results into a new object with given labels.
For example, `{.toto TOTO, .titi TITI}` extracts two fields and builds a record.

```text
{.toto TOTO, .titi TITI} :
    {"toto": {"5": {}}, "titi": {"10": {}}, "x": {}}    --> {"TOTO": {"5": {}}, "TITI": {"10": {}}}
```

---

## Syntactic Sugar

- Parentheses can be omitted, except for the empty composition `()`.
- Projection symbols (`.`, `/`) act as property separators as well, so `.a.b/c` is the same as `(. a . b / c)`.
- Comments: Use `//`, `--`, `%`, `#` for single-line, or `/* ... */` for multi-line.
- Product/union lists support both forms. The native k-like form is canonical and preferred; the JSON-like form is provided as a convenience for readability.

### Variant (union) value representation

In k, variant values are represented by tagging their content. The `|tag` function is used to apply a tag to a value.

- Unit variants (variants without payload):
  - Example: `zero` (when its payload is `{}`) is represented as `{} | zero`.
  - Example: `nil` (when its payload is `{}`) is represented as `{} | nil`.
- Variants with payload:
  - If `cons` has payload `{X car, Y cdr}`, then a value is formed by tagging an object containing `v_car car` and `v_cdr cdr` with `cons`.
  - Example (list of bits): with `$bit = <{} 0, {} 1>` and `$bytes = <{} nil, {bit car, bytes cdr} cons>`, a singleton list `[1]` is:
    - `{ {}|1 car, {}|nil cdr } | cons`

**Example:**
`.toto.titi/1` is equivalent to `(.toto (.titi /1))`.

---

## Codes (Schemas / Types)

**Codes** define types or schemas using unions (`<...>`) and products (`{...}`), and can be named with `$`.

> We write examples in the native k-like notation first; a JSON-like equivalent follow for convenience.

**Example:**

```k-repl
$ nat = < {} zero, nat succ >;      -- native k-like
$ nat = < zero: {}, succ: nat >;    -- JSON-like (equivalent)
$ pair = { nat x, nat y };          -- native k-like
$ pair = { x: nat, y: nat };        -- JSON-like (equivalent)
```

- Codes are equivalent up to bisimulation (see Data model). Intuitively: same label/tag set;
  constructors must match; subcodes relate pointwise under each label/tag.
- There are no built-in types like `string`, `int`, or `bool`; use `{}` as the only leaf in non-recursive definitions.

Try in `k-repl`:

```k-repl
> $ nat = < {} zero, nat succ >; \
  $ pair = { nat x, nat y }; \
  $ myCode = {<{} zero, nat succ> x, nat y};
--> {}
> --C pair
 $ @wq9VvJgYt8sASQfevD23whSHj8bFZZgpzV8Wvp8jzZ6h = {@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF x, @w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF y}; -- $C0={C1"x",C1"y"};$C1=<C1"succ",C2"zero">;$C2={};
> --C myCode
 $ @wq9VvJgYt8sASQfevD23whSHj8bFZZgpzV8Wvp8jzZ6h = {@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF x, @w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF y}; -- $C0={C1"x",C1"y"};$C1=<C1"succ",C2"zero">;$C2={};
```

---

## Code Derivation and Patterns

A **pattern** represents collections of codes (types). Patterns are used for type inference and static analysis,
not during program execution.

**Example:**

```k-repl
> toto = .toto;
--R toto
  toto : ?(X0 toto, ...)  -->  ?X0

> rel = < .toto, () >;
--R rel
  rel : ?(X0 toto, ...)=X0  -->  ?X0
```

_Filter_ is the syntax for patterns available in the language.
Intuitively, a _filter_ acts as a filter function, which, for a given value returns it or it is undefined.
Filters are hints for code derivation; there are not considered during runtime (code execution).

```k-repl
treeFilter = ?<(...) leaf, {T left, T right} tree> = T;
```

---

## QUIZ

- What is the result of:

  - Empty composition: `()` ?
  - Empty merge: `<>` ?
  - Empty product: `{}` ?
  - `|s|s|s/s/s/s` ?
  - `({{{() a} b} c} .c .b .a)` ?

---

For more details and examples, see the full documentation or try out expressions in `k-repl`.
