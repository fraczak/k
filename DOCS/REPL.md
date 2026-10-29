# REPL

Run `node repl.mjs` from the repository root, or `k-repl` after `npm link`.
The [walkthrough](GETTING_STARTED.md) introduces language evaluation.

## Input and state

The current input begins as unit, `{}`. An expression transforms it, and a
successful result becomes the next input. An undefined result is printed
without replacing the current input.

Relation definitions (`name = expression;`) and named patterns
(`name[X] = pattern;`) extend session state. Definitions-only input reports
compilation timing; it does not evaluate a new value.

Input is buffered until a complete program is available. A trailing `\` forces
continuation. A line ending in `;` followed only by spaces closes the snippet.

Evaluated values print in native k notation followed by the carried envelope.
Loaded codecs add external renderings when they recognize the value. Timing
shows compilation and execution costs for the selected engine.

## Commands

| Command | Purpose |
| --- | --- |
| `:help` | Show command help |
| `:rel name` / `:rels` | Inspect a relation / list relation aliases |
| `:pat name` / `:pats` | Inspect a pattern / list pattern aliases |
| `:pattern` / `:patterns` | Long forms of the preceding pattern commands |
| `:load [--no-alias] file` | Load source or a compiled library |
| `:codec load file` | Register a codec module |
| `:codec unload name` | Remove a codec |
| `:codec list` / `:codecs` | List registered codecs |
| `:input codec.mjs [text]` | Parse inline text, or prompt for the next input line |
| `:engine [wasm\|pkir\|js]` | Show or select the evaluation engine |
| `:wasm` / `:pkir` / `:js` | Engine shortcuts |
| `:limit [number\|none]` | Show or change the output limit (default: 4096 characters) |
| `:klib file` | Export the current library |
| `:ko file expression` | Export an executable object |
| `:reset` | Clear session state |
| `:quit` / `:exit` | Exit the terminal REPL |

Regular evaluations include timing; there is no separate timing command.

## Loading and aliases

```text
:load Examples/arithmetics.k
:load Examples/poly.k
```

Libraries are loaded explicitly. `poly.k` depends on definitions in
`arithmetics.k`, so load them in that order. Loading a codec does not
automatically load its corresponding k library.

`:load` compiles a `.k` file in the current library context or loads a plain
JSON `.klib`. It recovers relation and pattern aliases unless `--no-alias`
is specified. Source libraries' terminal expressions are not run by `:load`.

Names are local aliases for canonical definitions. Rebinding a relation alias
leaves older definitions addressable by hash in the live session.
`:klib` includes relations reachable from current aliases rather than all
historical relations retained by the session.

## Pattern inspection

```text
pair[A, B] = { A first, B second };
same_pair[T] = { T first, T second };
:pats
:pat same_pair
```

`:pats` shows each template header, skeleton hash, and routing arguments.
The aliases above share a skeleton; their arguments are `[A,B]` and `[T,T]`.

`:pat alias` shows the alias definition with its canonical hash/routing
annotation. `:pat @hash` inspects a registered canonical template.
Inspecting an alias need not erase its author-chosen parameter names.
See [patterns and canonical identity](PATTERNS.md).

## Codecs

```text
:codec load codecs/int.mjs
:input int.mjs 42
inc
```

Load `Examples/arithmetics.k` before using `inc`. The codec supplies the
integer value; the library supplies the relation.

Codecs export `parse` and `print`. Input uses the codec explicitly selected
with `:input`. When the text is omitted, the next line is parsed as external
input rather than k source. `:input` without arguments shows usage and loaded
codecs.

After evaluation, each loaded codec attempts to print the result. Successful
renderings appear as `codec.mjs: text`; failed renderings are suppressed.
Use module `--help` for codec documentation, for example
`node codecs/int.mjs --help`. The REPL's `:help` displays general command help.

See [writing codecs](CODECS.md) for the module contract.

## Engines and output

The terminal REPL provides:

- `wasm` (default): compile and execute through WebAssembly;
- `pkir`: execute through the experimental polymorphic IR;
- `js`: use the envelope-aware JavaScript reference evaluator.

Choose an engine or output limit at startup:

```sh
node repl.mjs --engine=js
node repl.mjs --engine=pkir
node repl.mjs --engine=wasm --limit=8192
```

Large values are rendered iteratively and truncated at the configured limit.
Use `:limit none` to disable truncation.

Tab completion includes commands, file paths, relation aliases, codec names,
and canonical references.

## Export

```text
:klib session.klib
:ko increment.ko inc
```

The second command requires `inc` in the active session. Libraries store
definitions and aliases with `main: null`. Executable objects have a main
relation and a `KOBJ\n` container header.
See [file formats](FILE_FORMATS.md) for inspection, validation, and CLI execution.

## Browser REPL

`npm run build:repl-html` creates a self-contained `repl.html` with an
in-process WebAssembly backend, bundled libraries/codecs, and a virtual
filesystem. It is also [hosted online](https://fraczak.github.io/k/).

The browser adds file loading, codec management, interactive input dialogs, and
value-tree inspection. Uploaded and exported files use the virtual filesystem
and browser downloads rather than the terminal's filesystem access.
