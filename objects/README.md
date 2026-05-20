# objects/

CLI tools for compiling and inspecting k object files (`.ko`) and library files (`.klib`).

## Tools

### `k-compile`

Compiles a `.k` source file into an executable object file (`.ko`).
The output contains only the codes and relations reachable from `main`.
Each stored relation includes `typeDerivation.status` for backend eligibility.

```bash
k-compile [--lib lib-file]... [k-file [object-file]]
```

### `k-compile-lib`

Compiles a `.k` source file into a library file (`.klib`).
The output is plain JSON with no binary header. It contains the library closure
formed from loaded `--lib` dependencies plus the compiled source definitions,
with `main: null`.
Use `--lib` to build on top of existing libraries.
Each stored relation includes `typeDerivation.status`; libraries may contain a
mix of converged and non-converged relations.

```bash
k-compile-lib [--lib lib-file]... [k-file [lib-file]]
```

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

## Further reading

- [DOCS/OBJECT_FILE_AND_PATTERN.md](../DOCS/OBJECT_FILE_AND_PATTERN.md) — object file format and pattern encoding
- [DOCS/TYPE_DERIVATION.md](../DOCS/TYPE_DERIVATION.md) — type derivation (what compilation skips when loading a `.ko`/`.klib`)
- [DOCS/CONVERGENCE.md](../DOCS/CONVERGENCE.md) — convergence strategies for type inference
