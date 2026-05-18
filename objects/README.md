# objects/

CLI tools for compiling and inspecting k object files (`.ko`) and library files (`.klib`).

## Tools

### compile.mjs

Compiles a `.k` source file into an executable object file (`.ko`).
The output contains only the codes and relations reachable from `main`.

```bash
./objects/compile.mjs [--lib lib-file]... [k-file [object-file]]
```

### compile-lib.mjs

Compiles a `.k` source file into a library file (`.klib`).
The output contains all codes and relations defined in the source (no main entry point).
Use `--lib` to build on top of existing libraries.

```bash
./objects/compile-lib.mjs [--lib lib-file]... [k-file [lib-file]]
```

### decompile.mjs

Decompiles a `.ko` or `.klib` back into human-readable k source.

```bash
./objects/decompile.mjs [object-file [k-file]]
```

### extract-aliases.mjs

Extracts metadata aliases from a `.ko` or `.klib` as a valid k definition
snippet. Output is grouped by metadata type (`code`, then `rel`), then sorted by
alias name and `compiledAt`.

```bash
./objects/extract-aliases.mjs [object-file [k-file]]
```

## Further reading

- [DOCS/OBJECT_FILE_AND_PATTERN.md](../DOCS/OBJECT_FILE_AND_PATTERN.md) — object file format and pattern encoding
- [DOCS/TYPE_DERIVATION.md](../DOCS/TYPE_DERIVATION.md) — type derivation (what compilation skips when loading a `.ko`/`.klib`)
- [DOCS/CONVERGENCE.md](../DOCS/CONVERGENCE.md) — convergence strategies for type inference
