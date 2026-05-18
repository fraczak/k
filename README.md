# k-language

> **k** is a language for composing first-order partial functions over algebraic data types.

Values are tree-shaped and built solely from **products** (records) and **tagged unions** (variants).
There are no built-in primitive types — the only leaf in a non-recursive definition is the empty product `{}`.
Types (called *codes*) are finite tree automata; equivalence is bisimilarity.

---

## Quick Start

**Prerequisites:** Node.js 18+

```bash
npm install          # install dev deps and generate parsers
npm test             # run the full test suite
k-repl               # start the interactive REPL  (or: node repl2.mjs)
./k.mjs <file.k>     # execute a k script
```

> After `npm link` (or `npm install -g .`) the binaries `k`, `k-repl`, `k-parse`, `k-print`, etc. are available globally.

---

## CLI Binaries

| Binary | Source | Purpose |
|--------|--------|---------|
| `k` | `k.mjs` | Execute a `.k` script; reads binary pattern+value stream from stdin |
| `k-repl` / `k-repl2` | `repl2.mjs` | Interactive interpreter |
| `k-parse` | `codecs/k-parse.mjs` | Encode textual k values to the binary pattern+value wire format |
| `k-print` | `codecs/k-print.mjs` | Decode binary pattern+value stream to JSON-like textual k values |
| `k-pattern` | `patterns/from-k.mjs` | Extract the canonical root pattern from a k script |
| `k-compile-object` | `objects/compile.mjs` | Compile a `.k` source to an executable `.ko` object |
| `k-decompile-object` | `objects/decompile.mjs` | Decompile a `.ko` or `.klib` file back to k source |
| `k-extract-aliases` | `objects/extract-aliases.mjs` | Extract `.klib` metadata aliases as k source |

---

## Data Model: Codes = ADTs

Codes are algebraic data types built from two constructors:

| Constructor | Native k notation | JSON-like notation |
|-------------|------------------|--------------------|
| **Product** (record) | `{ A label1, B label2 }` | `{ label1: A, label2: B }` |
| **Tagged union** (variant) | `< A tag1, B tag2 >` | `< tag1: A, tag2: B >` |

Native k-like notation is canonical; JSON-like is supported as syntactic sugar.

For the JSON-like textual notation used by `k-parse` and `k-print`, see
[DOCS/TEXTUAL_VALUES.md](DOCS/TEXTUAL_VALUES.md).

### Defining codes (`$`)

```k
$ nat   = < {} zero, nat succ >;          -- Peano naturals
$ bit   = < {} 0, {} 1 >;
$ byte  = { bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7 };
$ list  = < {} nil, { bit car, list cdr } cons >;
```

Two codes are equal iff they are bisimilar: same label/tag sets, same constructor kind (product vs. union), and subcodes relate pointwise under each label/tag.

---

## Partial Functions

A partial function may be undefined on some inputs. Core primitives:

| Syntax | Name | Meaning |
|--------|------|---------|
| `.field` | product projection | extract `field` from a product value |
| `/tag` | union projection | assert value has tag `tag`, extract payload |
| `\|tag` | variant introduction | wrap value in tag `tag` |
| `()` | identity | pass value through unchanged |
| `<>` | always-undefined | undefined for all inputs |
| `{}` | empty product | map any input to `{}` |

**Examples:**

```text
.toto :
    { "toto": {"5":{}}, "titi": {"10":{}} }  -->  {"5":{}}
    { "titi": {"10":{}} }                         ... undefined

/toto :
    {"toto": {}}  -->  {}
    {"other": {}} ... undefined

|toto :
    {"5":{}}  -->  { "toto": {"5":{}} }
```

---

## Combining Functions

### 1. Composition — sequential application

`(f g h)` applies `f`, then `g`, then `h`. Parentheses can be omitted.

```text
(.toto .titi) :
    { "toto": { "titi": {} } }    -->  {}
    { "toto": { "other": {} } }   ...  undefined
```

### 2. Merge — first-defined wins

`<f, g>` tries `f` first; if undefined, tries `g`.

```text
< .x .y, .z .y > :
    { "x": {"y": {"5":{}}}, "z": {"y": {"10":{}}} }   -->  {"5":{}}
    { "x": {"o": {}},        "z": {"y": {"10":{}}} }   -->  {"10":{}}
    { "x": {"o": {}},        "z": {"o": {}} }          ...  undefined
```

### 3. Product — parallel, labelled collection

`{f label1, g label2}` applies `f` and `g` in parallel and builds a record.

```text
{ .toto TOTO, .titi TITI } :
    { "toto": {"5":{}}, "titi": {"10":{}}, "x":{} }
         -->  { "TOTO": {"5":{}}, "TITI": {"10":{}} }
```

---

## Syntactic Sugar

- Parentheses may be omitted (except for empty composition `()`).
- `.a .b /c` is equivalent to `(.a (.b /c))`.
- Comments: `//`, `--`, `%`, `#` (single-line) or `/* ... */` (multi-line).
- Both notation forms work in the same file.

---

## Interpreter

Start with `k-repl` (or `node repl2.mjs`). The prompt is `> `.

`repl2.mjs` keeps a live `.klib`-style state in memory. You can:

- define types and relations incrementally
- run expressions against the current value
- load `.k` or `.klib` files into the session
- export the session as `.klib`
- export an executable `.ko` from an expression in the current context

### Main commands

| Command | Effect |
|---------|--------|
| `:type name = <...>` | Define a type alias |
| `:rel name = expr` | Define a relation alias |
| `:run expr` | Evaluate an expression on the current value |
| `:t name` | Show relation input/output filters |
| `:d name` | Show relation definition |
| `:C name` | Show canonical code definition |
| `:codes` / `:rels` | List type or relation aliases |
| `:load [--no-alias] file` | Load `.k` or `.klib`; aliases are loaded unless `--no-alias` is used |
| `:klib file` | Export current state as `.klib` |
| `:ko file expr` | Export executable `.ko` |
| `:val` | Print current value |
| `:reset` | Clear state |
| `:help` | Show command summary |

### Raw snippets

Raw k input is also accepted. It compiles on top of the current interpreter
state.

```text
> $ bool = <{} true, {} false>;
> not = $bool </true | false, {} | true>;
> {} |true not
{false: {}} ?<{} true, {} false>
```

Definitions-only snippets extend the session silently. Snippets with a terminal
expression are evaluated immediately.

Tab completion covers:

- command names
- file paths for `:load`, `:klib`, and `:ko`
- aliases
- canonical names beginning with `@`

See [DOCS/REPL.md](DOCS/REPL.md) for the exact buffering and evaluation rules.

---

## Code Derivation and Patterns

A **pattern** (or *filter*) is a constraint on the type of values flowing through a function.
The type derivation engine infers patterns automatically and can optionally be guided with filter expressions:

```k
treeFilter = ?< (...) leaf, { T left, T right } tree > = T;
```

This tells the derivation engine that `treeFilter` operates on values that are either a `leaf` or a `tree` with matched left/right subtypes.

---

## Using k as a Library (Node.js)

```js
import k from "@fraczak/k";  // or "./index.mjs"

// compile + run
const fn = k.compile(`
  $ bool = < {} true, {} false >;
  not = < /true {} |false $bool, /false {} |true $bool >
`);

console.log(fn({ "true": {} }));   // { false: {} }

// annotate only (type-check without running)
const annotated = k.annotate(source, {
  convergence: { strategy: "auto" }  // "auto" | "single_pass" | "fixed_point"
});
console.log(annotated.compileStats);  // per-SCC strategy and iteration counts
```

### Convergence strategies

| Strategy | Behaviour |
|----------|-----------|
| `auto` *(default)* | Single-pass for non-recursive SCCs; fixed-point for recursive ones |
| `single_pass` | Force single-pass (fast, use for acyclic modules) |
| `fixed_point` | Force the full convergence loop (useful for debugging) |

---

## Standard Library — `core.k`

`core.k` is the k standard core library. It is **not** pre-loaded into ordinary k
programs or relation evaluation. Instead, it is the reference source for a few
canonical definitions that the binary codec depends on, especially `$pattern`.
It defines four things, in order:

### §1 & §2 — `$bits` and arithmetic

`$bits` is the canonical binary number type (LSB-first trie: empty `_`, extend with `0` or `1`).
It is also used as node-index encoding inside pattern graphs.

```k
$ bits = < {} _, bits 0, bits 1 >;
```

Built-in functions: `inv`, `concat`, `succ`, `plus`, `times`, and integer constants `0`–`10`.

### §3 — `$unicode` and `$string`

Full Unicode scalar-value type, partitioned by plane and BMP range, built up from `$bit` and `$byte`.
`$string` is a linked-list of `$unicode` values — used for field/tag label names in pattern graphs.

```k
$ string = < {} nil, { unicode car, string cdr } cons >;
```

### §4 — `$pattern`

The self-describing type of k pattern graphs. A pattern is a cons-list of `$pattern-node` values;
node 0 is the root; edges carry `$string` labels and `$bits` target indices.

```k
$ pattern-node = < {} any, edges open-product, edges open-union,
                         edges closed-product, edges closed-union >;
$ pattern       = < {} nil, { pattern-node car, pattern cdr } cons >;
```

The singleton pattern of `$pattern` itself is the fixed framing constant for the wire format:
every k binary stream starts with a `$pattern` encoded under that constant,
followed by the value encoded under the pattern just decoded.
This is why `core.k` ends with a bare `$pattern` expression — it pins that
canonical code/hash used by the wire codec for the leading pattern payload.

---

## Binary Codec Pipeline

The `k` CLI reads and writes a binary stream: a serialised pattern followed by the value encoded under that pattern.

```bash
echo '{"cons":{"car":{"1":{}},"cdr":{"nil":{}}}}' \
  | k-parse \
  | k ./Examples/nat.k \
  | k-print
```

See [`codecs/README.md`](codecs/README.md) for codec internals and format details.

For the textual boundary notation used by `k-parse` and `k-print`, see
[DOCS/TEXTUAL_VALUES.md](DOCS/TEXTUAL_VALUES.md). For canonical exported
patterns and `k-pattern`, see [DOCS/PATTERNS.md](DOCS/PATTERNS.md).

## Object and Library Files

The object toolchain is documented in [objects/README.md](objects/README.md).

- `.klib` stores compiled library state: codes, relations, aliases, metadata
- `.ko` stores an executable object with a main expression

Typical CLI usage:

```bash
./objects/compile-lib.mjs Examples/ieee.k ieee.klib
./objects/compile.mjs --lib ieee.klib Examples/nat.k nat.ko
./objects/extract-aliases.mjs ieee.klib aliases.k
./objects/decompile.mjs nat.ko
```

---

## Examples

The [`Examples/`](Examples/) directory contains ready-to-run `.k` scripts:

| File | Contents |
|------|----------|
| `nat.k` | Peano natural numbers |
| `list.k` | Polymorphic lists |
| `byte.k` | Byte type (8 bits) |
| `ieee.k` | IEEE 754 floating-point layout |
| `bnat.k` | Binary natural numbers |
| `arithmetics.k` | Integer and rational arithmetic (binary encoding) |

---

## Development

```bash
npm run prepare   # regenerate parsers from .jison grammars (after editing them)
npm test          # run full test suite
```

The test suite covers:

- `test.mjs` — core runtime and parser unit tests
- `Code-derivation-tests/*.mjs` — type derivation suite
- `test-fingerprint.mjs` — hash/fingerprint stability
- `test-k-object.mjs` — object file round-trip
- `test-repl2.mjs` — REPL scripted interaction
- `tests.sh` — shell integration tests

---

## Quiz

What does each of the following evaluate to?

| Expression | Hint |
|------------|------|
| `()` | Empty composition |
| `<>` | Empty merge |
| `{}` | Empty product |
| `\|s\|s\|s/s/s/s` | Tag and untag three times |
| `({{{() a} b} c} .c .b .a)` | Nest and project |

---

For more details see the [`DOCS/`](DOCS/) folder, and especially [`DOCS/book.md`](DOCS/book.md) for the language reference.
