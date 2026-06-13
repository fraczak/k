# objects/

CLI tools for compiling and inspecting k object files (`.ko`) and library files (`.klib`).

## Tools

### `k-compile`

Compiles `.k` source into an executable object file (`.ko`), library file
(`.klib`), or kVM JSON (`.kvm`). Output format is inferred from the output
extension, or from `--format`.

```bash
k-compile [--lib lib-file] [--format ko|klib|kvm] [source-snippet | input-file [output-file]]
```

Existing input paths are read as files. A non-existing input with `.k`, `.ko`,
or `.klib` extension is reported as a missing file; otherwise it is compiled as
inline k source, in the same style as `k.mjs`.

### `k-decompile`

Decompiles a `.ko` or `.klib` back into human-readable k source.

```bash
k-decompile [object-file [k-file]]
```

### `k-extract-aliases`

Extracts metadata aliases from a `.ko` or `.klib` as a valid k definition
snippet. Output is grouped by metadata type (`code`, then `rel`), then sorted by
alias name and `compiledAt`.

```bash
k-extract-aliases [object-file [k-file]]
```

### `k-inspect-object`

Inspects a `.ko` or `.klib`. By default it prints a compact object summary.
With `--kir`, it prints the KIR-P JSON view used by backend experiments.

```bash
k-inspect-object [--summary | --kir] [object-file]
```

For scripts that only need the KIR-P JSON view, `k-kir [object-file]` is the
direct exporter backed by `kir.mjs`.

### `k-validate-object`

Validates a `.ko` or `.klib` object and its derived KIR-P export view. With
`--kir`, it validates an already exported KIR-P JSON file.

```bash
k-validate-object [--kir] [input-file]
```

The installed names are `k-` plus the source basename without `.mjs`. Every
installed object binary supports `-h` and `--help`.

## Current Format Notes

- `.klib` files are plain UTF-8 JSON, not binary containers.
- `.ko` files use the `KOBJ\n` binary header followed by a JSON payload.
- There is no object payload version field in either format.
- `typeDerivation` belongs only to relations and currently stores only
  `status`.
- Source `start` / `end` ranges live on `meta[hash].origins[]` entries.
- Origin entries do not have `kind`; the metadata entry has `type: "code"` or
  `type: "rel"`.
- Stored relation bodies do not include generated input/output boundary filters.
- KIR-P is available as an inspection/export view; it does not change the
  stored `.ko` or `.klib` payload.

## Further reading

- [DOCS/OBJECT_FILE_AND_PATTERN.md](../DOCS/OBJECT_FILE_AND_PATTERN.md) — object file format and pattern encoding
- [DOCS/KIR_V1.md](../DOCS/KIR_V1.md) — KIR-P inspection/export view for backends
- [DOCS/TYPE_DERIVATION.md](../DOCS/TYPE_DERIVATION.md) — type derivation (what compilation skips when loading a `.ko`/`.klib`)
- [DOCS/CONVERGENCE.md](../DOCS/CONVERGENCE.md) — convergence strategies for type inference
