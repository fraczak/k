# REPL v2 — Specification and Plan

## Overview

A new interactive REPL (`repl2.mjs`) that uses the `.klib` format as its
internal state. Definitions accumulate incrementally; expressions are compiled
in the context of the current library state. Values are always printed with
their type envelope.

## State Model

```
┌─────────────────────────────────────────────────┐
│  codes:   { hash → code definition }            │  ← registered types
│  rels:    { @hash → typed relation }            │  ← compiled relations
│  aliases: { name → @hash }                      │  ← human names (types + rels)
│  value:   current value (with .pattern)         │  ← last result
└─────────────────────────────────────────────────┘
```

- `codes` and `rels` are the live .klib content.
- `aliases` maps human names to canonical hashes. Redefining a name updates
  the alias; the old definition remains in `rels` (content-addressed, no conflict).
- `value` is the current pipeline value, initially `{}`.

## Input Handling

Each line (or multiline block ending with `\`) is classified:

### 1. Type definition: `$ name = <...>;`

- Parse and register the code via `codes.register`.
- Store canonical hash in `aliases[name]`.
- Print: `$ name = @hash`

### 2. Relation definition: `name = expr;`

- Build source: alias preamble + definition + `name` as main expression.
- Compile with current `{codes, rels}` as library context.
- Store compiled rel in `rels[@hash]`.
- Update `aliases[name] → @hash`.
- Print: `name = @hash`

### 3. Expression (no `=`, no `$`)

- Build source: alias preamble + expression as main.
- Compile with current library context.
- Run on current `value`.
- Update `value` with result.
- Print result with envelope (see Output Format).

### 4. Commands (`:` prefix)

| Command | Description |
|---------|-------------|
| `:t name` | Show type signature of a relation |
| `:d name` | Show definition of a relation |
| `:codes` | List type aliases |
| `:rels` | List relation aliases |
| `:save file` | Save current state as .klib |
| `:load file` | Load .k source or .klib into state |
| `:val` | Print current value with full detail |
| `:reset` | Clear all state |
| `:help` | Show available commands |

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

Uses `valueToK` and `propertyListToFilter` from `codecs/show.mjs`.

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

## Saving State

### `:save file.klib`

- Serialize current `{codes, rels, meta, main: null}` as a .klib.
- `meta` is built from the alias table (each alias → origin entry).

## Implementation Plan

1. **Extract `valueToK` and `propertyListToFilter` from `codecs/show.mjs`**
   into a shared module (e.g., `codecs/runtime/show-value.mjs`) so both
   `show.mjs` and the REPL can use them.

2. **Create `repl2.mjs`** with:
   - State: `codes` (via the global codes module), `rels` object,
     `aliases` map, `value`.
   - Input loop: readline with multiline (`\`) support.
   - Classifier: detect `$` defs, `name = ...;` defs, commands, expressions.
   - Alias preamble builder.
   - Compile + run pipeline using `annotate`/`compile` with `libraries` option.
   - Output: `valueToK(result) + " ?" + propertyListToFilter(result.pattern)`.

3. **Wire up commands** (`:t`, `:d`, `:codes`, `:rels`, `:save`, `:load`, `:reset`).

4. **Add `repl2` binary** to `package.json`.

5. **Test** with the nat.k workflow:
   ```
   > $ nat = <{} zero, nat succ>;
   > succ = |succ;
   > add = ...;
   > {}|zero|succ|succ
   > .x (.y add)
   ```
