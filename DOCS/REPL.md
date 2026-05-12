# k Interpreter

## Overview

`repl2.mjs` is the interactive k interpreter. It uses the `.klib` format as
its internal state: definitions accumulate incrementally, expressions compile
in the context of the current library state, and the session can be exported as
either a reusable `.klib` library or an executable `.ko` object.

`k-repl` and `k-repl2` both start this interpreter. The primary interface is
command-based: commands start with `:`, and raw k input remains available as a
short form for quick interactive work.

## State Model

```
┌─────────────────────────────────────────────────┐
│  codes:   { hash → code definition }            │  ← registered types
│  rels:    { @hash → typed relation }            │  ← compiled relations
│  aliases: { name → @hash }                      │  ← human names
│  value:   current value (with .pattern)         │  ← last result
│  lastMain: last relation/expression             │  ← default .ko main
└─────────────────────────────────────────────────┘
```

- `codes` and `rels` are the live .klib content.
- `aliases` maps human names to canonical hashes. Redefining a name updates
  the alias; the old definition remains in `rels` (content-addressed, no conflict).
- `value` is the current pipeline value, initially `{}`.

## Commands

Each line is a command. Multiline commands can be continued with a trailing
`\`.

Tab completion is available for command names, file paths in file-taking
commands such as `:load` and `:export`, and canonical names that start with
`@`.

| Command | Description |
|---------|-------------|
| `:type name = <...>` | Define a type |
| `:rel name = expr` | Define a relation |
| `:def name = expr` | Alias for `:rel` |
| `:run expr` | Run an expression on the current value |
| `:t name` | Show type signature of a relation |
| `:d name` | Show definition of a relation |
| `:type name` | Show definition of a type |
| `:codes` | List type aliases |
| `:rels` | List relation aliases |
| `:save file` | Save current state as `.klib` |
| `:klib file` | Export current state as `.klib` |
| `:ko file [expr]` | Export executable `.ko`; uses `expr` or the last relation/expression as main |
| `:export file [expr]` | Export by extension: `.klib` or `.ko` |
| `:load file` | Load `.k` source or `.klib` into state |
| `:val` | Print current value with full detail |
| `:reset` | Clear all state |
| `:help` | Show available commands |
| `:quit` | Exit |

The `/` character is never treated as a command prefix, because it is part of
k expression syntax.

## Shorthand Input

Raw k input is still accepted:

- `$ name = <...>;` is treated like `:type name = <...>`.
- `name = expr;` is treated like `:rel name = expr`.
- Any other non-command input is treated like `:run expr`.

For command-based use, semicolons are optional in `:type` and `:rel`.

## Input Handling

### Type Definition: `:type name = <...>`

- Parse and register the code via `codes.register`.
- Store canonical hash in `aliases[name]`.
- Print: `$ name = @hash`

### Relation Definition: `:rel name = expr`

- Build source: alias preamble + definition + `name` as main expression.
- Compile with current `{codes, rels}` as library context.
- Store compiled rel in `rels[@hash]`.
- Update `aliases[name] → @hash`.
- Print: `name = @hash`

### Expression Evaluation: `:run expr`

- Build source: alias preamble + expression as main.
- Compile with current library context.
- Run on current `value`.
- Update `value` with result.
- Print result with envelope (see Output Format).

## Alias Preamble

Before compiling any user input, the REPL prepends alias definitions so that
human names resolve to library relations:

```k
add = @mKEA...; succ = @Swjz...; nat = @w8iS...;
<user input>
```

For type aliases, the preamble uses `$ name = @hash;` syntax (referencing
an existing canonical code by hash).

This reuses the existing parser and compiler without modification.

## Output Format

Values are printed as:

```
<value-in-k-syntax> ?<pattern-as-filter>
```

Examples:

```
> {}|zero|succ|succ
{succ: {succ: {zero: {}}}} ?<{} zero, X succ>=X

> {{}|1 car, {}|nil cdr}|cons
{{{}|1 car, {}|nil cdr}|cons} ?<{} nil, {<{} 0, {} 1> car, X cdr} cons>=X
```

Uses `valueToK` and `propertyListToFilter` from
`codecs/runtime/show-value.mjs`.

When the result is `undefined`, print:

```
... undefined
```

## Loading Files

### `:load file.k`

- Parse and compile the source as a library in the current context.
- Merge resulting codes and rels into state.
- Update aliases from `relAlias` (source name → hash).

### `:load file.klib`

- Decode the .klib file.
- Merge codes and rels into state.
- Update aliases from `meta` (recover source names from origins).

## Exporting

### `:save file.klib`

- Serialize current `{codes, rels, meta, main: null}` as a .klib.
- `meta` is built from the alias table (each alias → origin entry).

### `:klib file.klib`

- Alias for saving the current state as a `.klib`.

### `:ko file.ko [expr]`

- Compile `expr` as the executable object's main expression.
- If `expr` is omitted, reuse the last relation definition or expression that
  was evaluated in the interpreter.
- The current `.klib` state is passed as the compilation library context.

### `:export file [expr]`

- If `file` ends in `.klib`, save the current library state.
- If `file` ends in `.ko`, compile an executable object using `expr` or the
  last main expression.

## Example

```
> :type nat = <{} zero, nat succ>
$ nat = @...
> :rel succ = |succ
succ = @...
> :run succ
{}|succ ?<{} succ, ...>
> :klib nat.klib
saved nat.klib
> :ko succ.ko succ
saved succ.ko (succ)
```
