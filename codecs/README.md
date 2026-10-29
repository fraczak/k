# Codecs

These tools translate text or external data to/from k's binary
schema+payload stream.

| Command | Boundary |
| --- | --- |
| `k-parse` / `k-print` | Textual k values ↔ binary stream |
| `k-show` | Pass through a stream while inspecting its value and pattern on stderr |
| `k-unit` | Unit |
| `k-int` | Decimal integers and integer lists |
| `k-ieee` | Floating-point text |
| `k-utf8` / `k-utf16` | External Unicode text encodings |
| `k-json` | JSON with a document-specific schema |
| `k-djson` | JSON with a universal recursive representation |

The external codecs use `--parse` and `--print`. All commands support
`--help`. From the repository root:

```sh
printf '42\n' | node codecs/int.mjs --parse | node codecs/int.mjs --print
```

The runtime carries the envelope as `value.pattern`. The leading wire pattern
is encoded under the fixed `pattern[]` schema defined in
[core.k](../core.k); user programs do not automatically import that library.

Read the [wire specification](WIRE_FORMAT.md) for encoding, the
[textual-value guide](../DOCS/TEXTUAL_VALUES.md) for `k-parse` notation, or
[Writing codecs](../DOCS/CODECS.md) to add a module.
