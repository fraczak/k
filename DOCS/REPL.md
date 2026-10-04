# k Interpreter

`repl.mjs` is the interactive k interpreter. After linking or installing
the package, start it with `k-repl`.

The interpreter keeps a live `.klib`-style state in memory:

- registered codes
- compiled relations
- human aliases for both
- metadata origins used to recover aliases
- the current value flowing through the session

Raw k snippets compile on top of that state. You can also export the
active library closure as a `.klib` file or compile an executable `.ko`
object from an expression in the session context.

## Prompt Model

There are two kinds of input:

- commands, starting with `:`
- raw k source

Commands execute immediately, but only when there is no open raw snippet
in the buffer.

Raw k source is accumulated until the interpreter can decide the snippet
is complete.

## Commands

| Command | Meaning |
| --- | --- |
| `:help` | Show command summary |
| `:engine [wasm\|js]` | Display or switch evaluation engine (`wasm` or `js`) |
| `:wasm` / `:js` | Shortcut to switch engine |
| `:rel name` | Show relation definition |
| `:type name` | Show the canonical definition of a type |
| `:types` | List type aliases |
| `:rels` | List relation aliases |
| `:code name` | Alias for `:C name` |
| `:C name` | Show canonical code definition |
| `:codec load file` | Load a codec from an ES module file (e.g. `:codec load codecs/int.mjs`) |
| `:codec unload name` | Unload a registered codec |
| `:codec list` | List loaded REPL codecs (alias: `:codecs`) |
| `:input <codec.mjs> [text]` | Read next input line or parse inline text using specified codec |
| `:load [--no-alias] file` | Load `.k` source or `.klib` into the current state |
| `:klib file` | Export the active relation closure as a `.klib` library |
| `:ko file expr` | Export a `.ko` executable with `expr` as main |
| `:reset` | Reset interpreter state |
| `:quit` / `:exit` | Exit |

## Raw Snippets

Raw input is compiled as k source on top of the current state.

Examples:

```k
> {} |ok
```

```k
> $ bool = <{} true, {} false>;
```

```k
> $ bool = <{} true, {} false>
  ; not = $bool </true | false, {} | true >
  ; {} |true not
```

The interpreter uses these rules, in order:

1. If the line ends with `\` followed only by spaces, keep buffering.
2. If the line ends with `;` followed only by spaces, that line
   definitively closes the snippet.
3. Otherwise, try to parse the buffered snippet:
   - if it is a complete k program, compile it now
   - if it is a valid prefix, wait for more input
   - otherwise report the parse error immediately

After a snippet is accepted:

- if it has a terminal expression, compile it and evaluate it on the
  current value
- if it is definitions only, compile it into the current state and print
  nothing on success

This makes raw snippets useful both for interactive evaluation and for
growing the live library context.

## State

The interpreter keeps:

- `codes`: canonical code definitions
- `rels`: canonical compiled relations
- `typeAliases`: human type names to canonical hashes
- `relAliases`: human relation names to canonical hashes
- `value`: current value, initially `{}`

Definitions are content-addressed. Rebinding an alias changes the
name-to-hash mapping, but older canonical definitions remain available
by hash. They stay available in the live session, but `:klib` omits
historical relations that are no longer reachable from an active
relation alias.

## Alias Resolution

Before compiling user input, the interpreter injects an alias preamble
so human names can be reused naturally:

```k
$ nat = @...;
succ = @...;
<user snippet>
```

Type aliases use `$ name = @hash;`. Relation aliases use `name = @hash;`.

Diagnostic locations are remapped back to the visible user snippet, so
error line numbers do not count the hidden preamble.

## Completion

Tab completion covers:

- command names after `:`
- file paths for `:load`, `:klib`, and `:ko`
- type aliases
- relation aliases
- canonical names beginning with `@`

Type aliases also complete in `$name` position inside raw k input.

For codec commands, completion covers `:codec load`, `:codec unload`,
`:codec list`, file paths after `:codec load`, and codec names after
`:input`.

## Loading

### `:load [--no-alias] file.k`

Compiles the source in the current library context, merges the resulting
codes and relations into the session, and recovers aliases from
user-defined names in the file unless `--no-alias` is used.

### `:load [--no-alias] file.klib`

Reads the plain-JSON library file and merges its codes, relations,
aliases, and metadata into the session. Aliases are recovered from
`meta[hash].origins[]` unless `--no-alias` is used.

## Codecs and Numerical Values

In `k`, there are no primitive numbers or built-in numerical literals.
Values such as integers are represented as algebraic bit trees (e.g.
`$bits = < {} _, bits 0, bits 1 >`).

A codec translates between external text and enveloped *k* values:
- `parse(text)`: parses an external string into an enveloped *k* value.
- `print(value)`: serializes an enveloped *k* value to external string,
  throwing an `Error` if the value is not representable.

Codecs can define a family of target patterns (e.g. `int` parses/prints
single integers as well as lists like `[0,1,2]`).

For printing in the REPL, every value is printed with the standard *k*
envelope representation, followed by lines for all loaded codecs that can
format it:

```text
> :input int.mjs 42
{}|_|0|1|0|1|0|1|+ ?<{} _, ...>
int.mjs: 42
```

For a complete guide to writing a new codec module, see
[`CODECS.md`](./CODECS.md).

### `:codec load file`

Loads a codec module from an ES module file (e.g.
`:codec load codecs/int.mjs`). Codecs are identified by their file name,
and export `parse(text)` and `print(value)` functions.

### `:codec unload name`

Unloads a previously loaded codec by name (e.g. `:codec unload int.mjs`).

### `:codec list` (or `:codecs`)

Lists all currently loaded codecs and their source files.

### `:input <codec.mjs> [text]`

Parses external input using the specified codec file.

- **Interactive mode**: `:input <codec.mjs>` switches the REPL prompt
  to `<codec.mjs>> `, and the next input line is parsed using that codec:
  ```text
  > :input json.mjs
  json.mjs> {"hello": "world"}
  {...} ?<{...}>
  json.mjs: {"hello":"world"}
  ```

- **One-line mode**: `:input <codec.mjs> <text>` immediately parses
  `<text>`:
  ```text
  > :input int.mjs 42
  {}|_|0|1|0|1|0|1|+ ?<{} _, ...>
  int.mjs: 42

  > :input int.mjs [0,1,2]
  {...} ?<{...}>
  int.mjs: [0,1,2]
  ```

Entering `:input` with no arguments displays usage and a list of loaded
codecs.

## Evaluation Engines: WASM and JS

The REPL supports two evaluation engines:

- **`wasm`** (default): Compiles k expressions into WebAssembly
  bytecode via polymorphic kVM lowering. Provides near-native execution
  speed, tail-call optimization (TCO), and stack safety on deep recursion.
- **`js`**: The tree-walking JavaScript interpreter. Provides near-zero
  compilation latency (interprets parsed definitions directly) and
  convenient runtime inspection.

### Engine Commands

- `:engine` — displays active engine (`wasm` or `js`)
- `:engine wasm` (or `:wasm`) — switches to the WebAssembly engine
- `:engine js` (or `:js`) — switches to the JavaScript engine

### CLI Options

When starting `k-repl`, choose the engine with:

```bash
k-repl --engine=js    # or k-repl --js
k-repl --engine=wasm  # or k-repl --wasm (default)
```

## Timing and Profiling

Timing reporting is enabled by default for all evaluations, reporting
elapsed time broken down into compilation and runtime execution,
annotated with the active engine:

```text
> {10 int x, 5 int y} plus
{}|_|1|1|1|1|+ ?<{} _, ...>
/* comp: 12.4ms, exec: 0.8ms (wasm) */
```

## Web REPL (Studio)

The repository provides a standalone, single-file browser REPL:
`repl.html`.

- **Zero-install in-browser execution**: Powered by WebAssembly
  (`wasm-in-process`) and virtual filesystem (VFS).
- **Interactive UI**: Tab autocompletion, persistent text selection,
  execution timing badges (`comp: Xms | exec: Yms`), interactive Codecs
  management modal, and interactive `:input` popup modal.
- **Build**: Generate `repl.html` locally using:
  ```bash
  npm run build:repl-html
  ```
- **Live Demo**: Automatically deployed to GitHub Pages via
  `.github/workflows/pages.yml`.

## Export

The REPL can export session state to ahead-of-time (AOT) compiled
artifacts. For full details on all formats, see
[`DOCS/FILE_FORMATS.md`](./FILE_FORMATS.md).

### `:klib file`

Writes a plain-JSON `.klib` library rooted at the current relation
aliases. Relations referenced by those aliases are included
transitively. Historical relations retained in the live session are
omitted when no active alias depends on them. The registered code
snapshot is included. The library has `main: null`; it has no binary
header and no object payload version.

### `:ko file expr`

Compiles `expr` as the main expression (`main: "__main__"`) in the
current interpreter context and writes the resulting executable `.ko`
object container (prefixed by magic header `KOBJ\n`). Running this `.ko`
skips parsing and type derivation for instant execution.

## Output

Evaluated values print in k syntax together with the inferred envelope:

```text
{}|0|+1 ?<<{} 0, ...> +1, ...>
```

`undefined` prints as:

```text
... undefined
```

`valueToK`, `propertyListToFilter`, and `valueWithEnvelopeToK` from
`codecs/runtime/show-value.mjs` are used for rendering.

## Example Session

```text
> $ nat = < {} 0, nat +1 >;
> inc = | +1;
> {} | 0
{}|0 ?<{} 0, ...>
> :rel inc
inc = | +1;  -- @...
> :klib nat.klib
saved nat.klib
> :ko inc.ko inc
saved inc.ko (inc)
```

## Further Reading

- [DOCS/FILE_FORMATS.md](./FILE_FORMATS.md) —
  guide to .k, .ko, .klib, and .kvm formats
- [DOCS/DICTIONARY.md](./DICTIONARY.md) — concept names and terminology
- [DOCS/CODECS.md](./CODECS.md) — guide to writing codecs
