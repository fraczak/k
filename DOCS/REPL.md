# k Interpreter

`repl.mjs` is the interactive k interpreter. After linking or installing the
package, start it with `k-repl`.

The interpreter keeps a live `.klib`-style state in memory:

- registered codes
- compiled relations
- human aliases for both
- metadata origins used to recover aliases
- the current value flowing through the session

Raw k snippets compile on top of that state. You can also export the active
library closure as a `.klib` file or compile an executable `.ko` object from
an expression in the session context.

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
| `:codec load file` | Load an importable REPL codec module |
| `:codec list` | List loaded REPL codecs |
| `:input type [codec]` | Read the next line as codec input for a type |
| `:load [--no-alias] file` | Load `.k` source or `.klib` into the current state |
| `:klib file` | Export the active relation closure as a `.klib` library |
| `:ko file expr` | Export a `.ko` executable with `expr` as main |
| `:val` | Print current value and JSON form |
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
They stay available in the live session, but `:klib` omits historical
relations that are no longer reachable from an active relation alias.

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

For codec commands, completion covers `:codec load`, `:codec list`, file paths
after `:codec load`, type names after `:input`, and loaded codec names
after the input type.

## Loading

### `:load [--no-alias] file.k`

Compiles the source in the current library context, merges the resulting codes
and relations into the session, and recovers aliases from user-defined names in
the file unless `--no-alias` is used.

### `:load [--no-alias] file.klib`

Reads the plain-JSON library file and merges its codes, relations, aliases, and
metadata into the session. Aliases are recovered from `meta[hash].origins[]`
unless `--no-alias` is used.

## Codecs

REPL codecs are usually keyed by canonical code hashes. Patterns are not used
for codec dispatch. A codec may also export `universal = true` to make it
available for any type selected by `:input`; the parsed value is still validated
against the requested type before it enters the session.

For a complete guide to writing a new codec module, see
[`CODECS.md`](./CODECS.md).

### `:codec load file`

Loads an importable ES module that exports a codec shape:

```js
export const name = "utf8";
export const codes = ["@..."];
export function parse(text) { /* text -> Value */ }
export function print(value) { /* Value -> text */ }
```

A codec may export `patterns` instead of `codes`; each pattern must be a closed
property-list pattern that can be canonicalized to a code hash, and that hash is
recalculated by the REPL. A universal codec exports `universal = true` instead
of `codes` or `patterns`.

### `:input type [codec]`

Resolves `type` to a canonical code hash, selects the registered codec, and
consumes the next line verbatim as codec input. `type` may be a type alias, a
canonical code hash, or an inline type expression such as
`<{} true, {} false>`. The parsed value is validated against that type before
becoming the current value.

## Export

### `:klib file`

Writes a plain-JSON `.klib` library rooted at the current relation aliases.
Relations referenced by those aliases are included transitively. Historical
relations retained in the live session are omitted when no active alias
depends on them. The registered code snapshot is still included. The library
has `main: null`; it has no binary header and no object payload version.

### `:ko file expr`

Compiles `expr` as the main expression in the current interpreter context and
writes the resulting executable `.ko` object.

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
> :type nat = <{} 0, nat +1>
$ nat = @...
> :rel inc = |+1
inc = @...
> {} |0
{}|0 ?<{} 0, ...>
> :t inc
inc : ?X0  -->  ?<X0 +1, ...>  (@...)
> :klib nat.klib
saved nat.klib
> :ko inc.ko inc
saved inc.ko (inc)
```
