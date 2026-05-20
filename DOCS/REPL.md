# k Interpreter

`repl2.mjs` is the interactive k interpreter. `k-repl` and `k-repl2` both
start it.

The interpreter keeps a live `.klib`-style state in memory:

- registered codes
- compiled relations
- human aliases for both
- metadata origins used to recover aliases
- the current value flowing through the session

Raw k snippets compile on top of that state. You can also export the current
session as a `.klib` library or compile an executable `.ko` object from an
expression in the session context.

## Prompt Model

There are two kinds of input:

- commands, starting with `:`
- raw k source

Commands execute immediately, but only when there is no open raw snippet in the
buffer.

Raw k source is accumulated until the interpreter can decide the snippet is
complete.

## Commands

| Command | Meaning |
| --- | --- |
| `:help` | Show command summary |
| `:type name = <...>` | Define a type alias |
| `:type name` | Show the canonical definition of a type |
| `:code name` | Alias for `:C name` |
| `:rel name = expr` | Define a relation alias |
| `:def name = expr` | Alias for `:rel` |
| `:run expr` | Evaluate `expr` on the current value |
| `:eval expr` | Alias for `:run` |
| `:t name` | Show relation input/output filters |
| `:d name` | Show relation definition |
| `:C name` | Show canonical code definition |
| `:codes` | List type aliases |
| `:rels` | List relation aliases |
| `:load [--no-alias] file` | Load `.k` source or `.klib` into the current state |
| `:klib file` | Export current state as a `.klib` library |
| `:ko file expr` | Export a `.ko` executable with `expr` as main |
| `:val` | Print current value and JSON form |
| `:reset` | Reset interpreter state |
| `:quit` / `:exit` | Exit |

## Raw Snippets

Raw input is compiled as k source on top of the current state.

Examples:

```k
> {} |succ
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
2. If the line ends with `;` followed only by spaces, that line definitively
   closes the snippet.
3. Otherwise, try to parse the buffered snippet:
   - if it is a complete k program, compile it now
   - if it is a valid prefix, wait for more input
   - otherwise report the parse error immediately

After a snippet is accepted:

- if it has a terminal expression, compile it and evaluate it on the current
  value
- if it is definitions only, compile it into the current state and print
  nothing on success

This makes raw snippets useful both for interactive evaluation and for growing
the live library context.

## State

The interpreter keeps:

- `codes`: canonical code definitions
- `rels`: canonical compiled relations
- `typeAliases`: human type names to canonical hashes
- `relAliases`: human relation names to canonical hashes
- `value`: current value, initially `{}`

Definitions are content-addressed. Rebinding an alias changes the name-to-hash
mapping, but older canonical definitions remain available by hash.

## Alias Resolution

Before compiling user input, the interpreter injects an alias preamble so human
names can be reused naturally:

```k
$ nat = @...;
succ = @...;
<user snippet>
```

Type aliases use `$ name = @hash;`. Relation aliases use `name = @hash;`.

Diagnostic locations are remapped back to the visible user snippet, so error
line numbers do not count the hidden preamble.

## Completion

Tab completion covers:

- command names after `:`
- file paths for `:load`, `:klib`, and `:ko`
- type aliases
- relation aliases
- canonical names beginning with `@`

Type aliases also complete in `$name` position inside raw k input.

## Loading

### `:load [--no-alias] file.k`

Compiles the source in the current library context, merges the resulting codes
and relations into the session, and recovers aliases from user-defined names in
the file unless `--no-alias` is used.

### `:load [--no-alias] file.klib`

Reads the plain-JSON library file and merges its codes, relations, aliases, and
metadata into the session. Aliases are recovered from `meta[hash].origins[]`
unless `--no-alias` is used.

## Export

### `:klib file`

Writes the current interpreter state as a plain-JSON `.klib` library. The
library has `main: null`; it has no binary header and no object payload version.

### `:ko file expr`

Compiles `expr` as the main expression in the current interpreter context and
writes the resulting executable `.ko` object.

## Output

Evaluated values print in k syntax together with the inferred envelope:

```text
{succ: {succ: {zero: {}}}} ?<{} zero, X succ>=X
```

`undefined` prints as:

```text
... undefined
```

`valueToK`, `propertyListToFilter`, and `valueWithEnvelopeToK` from
`codecs/runtime/show-value.mjs` are used for rendering.

## Example Session

```text
> :type nat = <{} zero, nat succ>
$ nat = @...
> :rel succ = |succ
succ = @...
> {} |zero
{zero: {}} ?<{} zero, X succ>=X
> :t succ
succ : ?X  -->  ?<{} zero, X succ>=X  (@...)
> :klib nat.klib
saved nat.klib
> :ko succ.ko succ
saved succ.ko (succ)
```
