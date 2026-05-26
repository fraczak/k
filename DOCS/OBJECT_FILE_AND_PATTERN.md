# Object File And Pattern Type

This note records the representation boundary after parsing and type derivation.
The codec boundary is no longer a JSON object. A serialized value is one binary
stream:

```text
encode($pattern_value : $pattern) encode(value : decoded_pattern)
```

The pattern is the framing protocol. There is no separate envelope type.

## Pattern Schema

[`core.k`](../core.k) defines the canonical self-hosted pattern type:

```k
$ edge = { string label, bits target };
$ edges = < {} nil, { edge car, edges cdr } cons >;

$ pattern-node = <
  {} any,
  edges open-product,
  edges open-union,
  edges closed-product,
  edges closed-union
>;

$ pattern = < {} nil, { pattern-node car, pattern cdr } cons >;
```

This does not mean `core.k` is pre-loaded into ordinary program execution. The
special role of `core.k` here is that the wire codec relies on the canonical
`$pattern` definition from that file.

In this schema:

- the first pattern-list element is node `0`, the root,
- an edge target is a node index encoded as `$bits`,
- labels are `$string` values and therefore Unicode scalar-value strings,
- edge lists are sorted by label,
- `any` carries no edges,
- the four product/union node kinds carry their edge list directly.

The fixed singleton pattern of `$pattern` is the first decoder context for all
k wire values. Decoding any value first decodes a `$pattern` value under that
constant, then decodes the remaining bits under the pattern just obtained.

## Debug Notation

Documentation and tests often show patterns as property-list JSON because it is
compact to read:

```json
[
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]
```

That notation is not a transport format. It is only a host-side rendering of
the same abstract graph.

## Object File Direction

The parser plus type-derivation phase should eventually emit an object value
rather than executable JavaScript structures. A minimal first object shape is:

```k
$ object-file = {
  pattern input-pattern,
  pattern output-pattern,
  pattern value-pattern
};
```

The concrete input payload is then stored in the same binary stream form:
`encode(value-pattern) encode(input : value-pattern)`. The exact object-file
type still needs design work because the concrete input value is typed by the
decoded pattern. The important boundary is that object files should carry
ordinary k values and patterns, not a JSON codec object.

The format can add relation IR, constant tables, symbol dictionaries,
relocation/linking records, optimization metadata, and optional indexes as the
implementation changes.

## Object And Library Containers

The current executable `.ko` format is a small binary container:

```text
"KOBJ" 0x0a
uint32-be payload-byte-length
utf8-json-payload
```

Library files (`.klib`) are plain UTF-8 JSON with no binary header.

Both containers use the same JSON payload shape. Executable `.ko` files set
`main` to the entry relation name. Library `.klib` files set `main` to `null`.
There is no payload version field.

The payload stores:

- the normalized code repository needed by the object,
- the compiled relation IR without generated boundary filters,
- each relation's type-pattern graph state,
- each relation's `typeDerivation.status`,
- relation aliases in `relAlias`,
- compiler convergence details in top-level `compileStats`,
- metadata, including aliases and origin source locations,
- the main relation name.

Relation `def` values do not store source `start` / `end` markers. Source
locations live on `meta[hash].origins[]` entries. Each metadata entry has
`type: "code"` or `type: "rel"`. Origin entries hold `source`, `name`,
`compiledAt`, and optional `start` / `end`; origin entries do not have `kind`.

Relation `def` values also do not store the generated input/output filters.
Those filters are derived from `def.patterns` and `typePatternGraph` when
printing or enforcing relation boundaries.

Codes/types do not carry `typeDerivation`. Type derivation is a relation
property, and the persisted `typeDerivation` object currently contains only
`status`.

Loading an object hydrates the type-pattern graphs back into runtime
`TypePatternGraph` instances and executes relation boundaries through
`run.mjs`. This avoids source parsing and type derivation on the execution path.

Object execution through `k.mjs`:

```sh
echo "..." | some-codec --parse | k -k path/to/program.ko | some-codec --print
```

The `-k` option accepts either an object file or a source `.k` file. `k.mjs`
tries to load the file as an object first, then falls back to source parsing and
compilation.

Standalone helpers live in `objects/`:

```sh
k-compile path/to/program.k path/to/program.ko
k-compile-lib path/to/library.k path/to/library.klib
k-decompile path/to/program.ko path/to/program.decompiled.k
k-extract-aliases path/to/library.klib path/to/aliases.k
```

With no arguments, the helpers read from stdin and write to stdout:

```sh
cat path/to/program.k | k-compile > path/to/program.ko
cat path/to/program.ko | k-decompile > path/to/program.decompiled.k
```

The decompiled source is canonical source regenerated from object IR. It uses
shortest unique prefixes of the object's hash-based names for type and relation
definitions, with a minimum prefix length of `4`. It is intended to be runnable
and inspectable, not a byte-for-byte reconstruction of the original source.

## Small Object Example

For a tiny source file:

```k
-- id.k
()
```

compile it with:

```sh
k-compile id.k id.ko
```

The first bytes of `id.ko` are the binary container header:

```text
4b 4f 42 4a 0a 00 00 03 0b ...
K  O  B  J  \n payload-length
```

After the header, the payload is UTF-8 JSON. Pretty-printed and shortened, the
payload has this shape:

```json
{
  "format": "k-object",
  "codes": {},
  "main": "__main__",
  "rels": {
    "__main__": {
      "def": { "op": "identity", "patterns": [0, 0] },
      "typeDerivation": {
        "status": "converged"
      },
      "typePatternGraph": {
        "patterns": {
          "nodes": [{ "pattern": "(...)", "fields": [] }],
          "parent": []
        },
        "edges": [{}],
        "codeId": {}
      }
    }
  },
  "relAlias": { "__main__": "@QfyLpmn56wuppuGvrrUJz8LKtgaXfbMtad7RnzBcFk2S" },
  "compileStats": { "sccs": [...], "sccCount": 1 },
  "meta": {
    "@QfyLpmn56wuppuGvrrUJz8LKtgaXfbMtad7RnzBcFk2S": {
      "type": "rel",
      "origins": [
        {
          "source": "id.k",
          "name": "__main__",
          "compiledAt": "2026-05-20T00:00:00.000Z",
          "start": { "line": 1, "column": 1 },
          "end": { "line": 1, "column": 3 }
        }
      ]
    }
  }
}
```

The `codes` field is the type repository snapshot needed by this object. The
`rels.__main__.def` field is the executable relation body. The
`typePatternGraph` field is the compiled pattern graph used by `run.mjs` for
relation-boundary refinement. Loading the object reconstructs live
`TypePatternGraph` instances from this JSON state and then evaluates the input
value against the compiled IR.

Decompiling this object produces canonical source with generated prefix names:

```k
----- codes -----
----- rels -----
QfyL = ?(...) () ?(...);
----- main -----
?(...) QfyL ?(...)
```

In the `rels` section, relation definitions are printed in the same SCC order
recorded during compilation. Non-empty SCC groups are separated by a blank line.

## Small Library Example

For a definitions-only source file:

```k
-- defs.k
$ nat = <{} zero, nat succ>;
succ = |succ;
```

compile it with:

```sh
k-compile-lib defs.k defs.klib
```

The output file is plain JSON and starts with `{`, not a binary prefix. Its
shape is the same object payload shape with `main: null`:

```json
{
  "format": "k-object",
  "codes": {
    "@...": {
      "code": "union",
      "union": { "zero": "@...", "succ": "@..." },
      "def": "$C0=<C1\"succ\",C2\"zero\">;..."
    }
  },
  "rels": {
    "@...": {
      "def": { "op": "vid", "vid": "succ", "patterns": [0, 1] },
      "typeDerivation": { "status": "converged" },
      "typePatternGraph": { "patterns": "...", "edges": "...", "codeId": "..." }
    }
  },
  "relAlias": { "succ": "@..." },
  "compileStats": { "sccs": [...], "sccCount": 1 },
  "meta": {
    "@...": {
      "type": "rel",
      "origins": [
        {
          "source": "defs.k",
          "name": "succ",
          "compiledAt": "2026-05-20T00:00:00.000Z",
          "start": { "line": 3, "column": 8 },
          "end": { "line": 3, "column": 13 }
        }
      ]
    }
  },
  "main": null
}
```

When a library is compiled with `--lib`, the output is the merged library
closure. Imported codes, relations, aliases, and metadata are preserved, and the
new source adds its own origins.
