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

Later versions can add relation IR, constant tables, symbol dictionaries,
relocation/linking records, optimization metadata, and optional indexes.

## Executable Object Container v1

The current executable object format is a small binary container:

```text
"KOBJ" 0x00 0x01 0x0a
uint32-be payload-byte-length
utf8-json-payload
```

The payload stores:

- the normalized code repository needed by the object,
- the compiled relation IR,
- each relation's type-pattern graph state,
- the main relation name.

Loading an object hydrates the type-pattern graphs back into runtime
`TypePatternGraph` instances and executes them through `run.mjs`. This avoids
source parsing and type derivation on the execution path.

Object execution through `k.mjs`:

```sh
echo "..." | ./some-codec --parse | ./k.mjs -k path/to/program.ko | ./some-codec --print
```

The `-k` option accepts either an object file or a source `.k` file. `k.mjs`
tries to load the file as an object first, then falls back to source parsing and
compilation.

Standalone helpers live in `objects/`:

```sh
./objects/compile.mjs path/to/program.k path/to/program.ko
./objects/decompile.mjs path/to/program.ko path/to/program.decompiled.k
```

With no arguments, both helpers read from stdin and write to stdout:

```sh
cat path/to/program.k | ./objects/compile.mjs > path/to/program.ko
cat path/to/program.ko | ./objects/decompile.mjs > path/to/program.decompiled.k
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
./objects/compile.mjs id.k id.ko
```

The first bytes of `id.ko` are the binary container header:

```text
4b 4f 42 4a 00 01 0a 00 00 03 0b ...
K  O  B  J  \0 v1 \n payload-length
```

After the header, the payload is UTF-8 JSON. Pretty-printed and shortened, the
payload has this shape:

```json
{
  "format": "k-object",
  "version": 1,
  "codes": {
    "@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c": {
      "code": "product",
      "product": {},
      "def": "$C0={};"
    }
  },
  "main": "__main__",
  "defs": {
    "rels": {
      "__main__": {
        "def": {
          "op": "filter",
          "filter": { "type": null, "open": true, "fields": {}, "name": "X0" },
          "patterns": [0, 0],
          "start": { "line": 1, "column": 1 },
          "end": { "line": 1, "column": 3 }
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
    "representatives": {},
    "relAlias": { "__main__": "..." },
    "compileStats": { "sccs": [...], "sccCount": 1 }
  }
}
```

The `codes` field is the type repository snapshot needed by this object. The
`defs.rels.__main__.def` field is the executable relation IR. The
`typePatternGraph` field is the compiled pattern graph used by `run.mjs` for
input-envelope refinement. Loading the object reconstructs live
`TypePatternGraph` instances from this JSON state and then evaluates the input
value directly against the compiled IR.

Decompiling this object produces canonical source with generated prefix names:

```k
----- codes -----
$ NiDZ = {};
----- rels -----
QfyL = ?X0;
----- main -----
?(...) QfyL ?(...)
```

In the `rels` section, relation definitions are printed in the same SCC order
recorded during compilation. Non-empty SCC groups are separated by a blank line.
