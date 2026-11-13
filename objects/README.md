# Object tools

Run these modules with `node` from a checkout, or use the installed names after
`npm link`.

| Command | Purpose |
| --- | --- |
| `k-compile` | Compile source into `.ko`, `.klib`, or `.kvm`; infer output format from the extension |
| `k-decompile` | Render object/library definitions as k source |
| `k-extract-aliases` | Recover aliases as source definitions |
| `k-inspect-object` | Inspect a summary, or export KIR-P with `--kir` |
| `k-validate-object` | Validate an object, library, or exported KIR-P (`--kir`) |
| `k-kir` | Export KIR-P directly |

```sh
node objects/compile.mjs '{} |ok' /tmp/k-ok.ko
node objects/inspect.mjs /tmp/k-ok.ko
node objects/validate.mjs /tmp/k-ok.ko
```

`--lib` loads a dependency. It does not select library output; use a `.klib`
output filename or `--format klib`.

Leading `# --lib <dependency> --use <specs>` lines in source files are ordinary
human-readable comments documenting expected dependencies. When `--lib` is
provided on the command line, library definitions are available in memory
indexed strictly by content hash (`@<hash>`), and CLI `--use` flags explicitly
bring requested friendly names or aliases into compilation scope.

The [file-format reference](../DOCS/FILE_FORMATS.md) is the source for container
fields, executable/library distinctions, dependency comments, aliases, and
complete workflows.
[KIR-P](../DOCS/KIR_V1.md) documents the portable backend export.
