# objects/

CLI tools for compiling and inspecting k object files (`.ko`), library
files (`.klib`), and polymorphic kVM template files (`.kvm`).

## Tools

### `k-compile`

Compiles `.k` source into an executable object file (`.ko`), library
file (`.klib`), or polymorphic kVM backend artifact (`.kvm`). Output
format is inferred from the output extension, or from `--format`.

```bash
k-compile [--lib lib-file] [--export spec]... \
  [--format ko|klib|kvm] [source-snippet | input-file [output-file]]
```

Existing input paths are read as files. A non-existing input with `.k`,
`.ko`, or `.klib` extension is reported as a missing file; otherwise it
is compiled as inline k source, in the same style as `k.mjs`.

`.kvm` is a polymorphic kVM template artifact (`layer: "KVM-P"`). It
carries relational function definitions, principal pattern graphs,
and lowered kVM instruction streams ready for runtime specialization
when enveloped values arrive (`specializeKVM`).

When linking a `--lib` dependency, all relations are loaded under their
canonical content-addressed hashes (`@hash`). To use human-readable
alias names in an expression or script, explicitly map them into the
local scope using `--export <alias>` or
`--export <libAlias>:<localAlias>`.
Alternatively, canonical `@hash` names may always be referenced directly.

### `k-decompile`

Decompiles a `.ko` or `.klib` back into human-readable k source.

```bash
k-decompile [object-file [k-file]]
```

### `k-extract-aliases`

Extracts metadata aliases from a `.ko` or `.klib` as a valid k
definition snippet. Output is grouped by metadata type (`code`, then
`rel`), then sorted by alias name and `compiledAt`.

```bash
k-extract-aliases [object-file [k-file]]
```

### `k-inspect-object`

Inspects a `.ko` or `.klib`. By default it prints a compact object
summary. With `--kir`, it prints the current KIR-P export used by
backend experiments.

```bash
k-inspect-object [--summary | --kir] [object-file]
```

For scripts that only need KIR-P export, `k-kir [object-file]` is the
direct exporter backed by `kir.mjs`.

### `k-validate-object`

Validates a `.ko` or `.klib` object and its derived KIR-P export. With
`--kir`, it validates an already exported KIR-P artifact.

```bash
k-validate-object [--kir] [input-file]
```

The installed names are `k-` plus the source basename without `.mjs`.
Every installed object binary supports `-h` and `--help`.

## Current Format Notes

- For full specifications, see
  [`DOCS/FILE_FORMATS.md`](../DOCS/FILE_FORMATS.md).
- Both `.ko` and `.klib` are ahead-of-time (AOT) type-checked artifacts.
  Parsing, relation expansion, type derivation, and constraint
  convergence are completed in advance.
- `.klib` files are plain UTF-8 JSON, not binary containers
  (`main: null`).
- `.ko` files use the `KOBJ\n` binary header followed by a JSON payload
  (`main: "__main__"`).
- There is no object payload version field in either format.
- `typeDerivation` belongs only to relations and currently stores only
  `status`.
- Source `start` / `end` ranges live on `meta[hash].origins[]` entries.
- Origin entries do not have `kind`; the metadata entry has `type: "code"`
  or `type: "rel"`.
- Stored relation bodies do not include generated input/output filters.
- KIR-P is available as an inspection/export contract; it does not change
  the stored `.ko` or `.klib` payload.
- `.kvm` is a polymorphic backend template artifact (`layer: "KVM-P"`),
  lowered from KIR-P for runtime execution and JIT specialization.

## Further reading

- [DOCS/FILE_FORMATS.md](../DOCS/FILE_FORMATS.md) — guide to
  .k, .ko, .klib, and .kvm formats
- [DOCS/OBJECT_FILE_AND_PATTERN.md](../DOCS/OBJECT_FILE_AND_PATTERN.md) —
  object file format and pattern encoding
- [DOCS/KIR_V1.md](../DOCS/KIR_V1.md) — KIR-P inspection/export contract
  for backends
- [DOCS/TYPE_DERIVATION.md](../DOCS/TYPE_DERIVATION.md) — type
  derivation (what compilation skips when loading a `.ko`/`.klib`)
- [DOCS/CONVERGENCE.md](../DOCS/CONVERGENCE.md) — convergence strategies
  for type inference
