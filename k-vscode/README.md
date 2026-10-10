# k language — VS Code extension

Syntax highlighting and snippets for the **k language**: a small language for
typed data transformations over algebraic data types (products and tagged
unions).

## Features

- **Syntax highlighting** for all current k constructs:
  - Line comments (`--`, `//`, `%`, `#`) and block comments (`/* … */`)
  - Relation definitions: `name = …;`
  - All three operators: `.field` (product projection), `/tag` (union projection), `|tag` (variant introduction)
  - Filter expressions: `?< … > = X`, `?{ … } = X` with pattern variables
  - Canonical content-addressed references: `@base58hash`
  - Quoted label strings: `"label"`, `'label'` (with escape sequences)
  - The `...` any/open pattern marker
- **Nested expression backgrounds** for filters inside relations
- **k Contrast color theme** with:
  - Separate foreground colors for relation identifiers, labels, tags,
    filter variables, and canonical relation names
- **Snippets** for every common pattern (trigger via `Tab` after prefix):

| Prefix | Inserts |
|--------|---------|
| `fn` | Function definition |
| `comp` | Composition `(f g)` |
| `merge` | Merge `< f, g >` |
| `prod` | Product combinator `{ f l, g l }` |
| `filtunion` | Filter union `?< … > = X` |
| `filtprod` | Filter product `?{ … } = X` |
| `dot` | `.field` |
| `slash` | `/tag` |
| `vid` | `\|tag` |
| `id` | `()` identity |
| `unit` | `{}` empty product (leaf) |
| `undef` | `<>` always-undefined |

- **Bracket matching and auto-close** for `{ }`, `( )`, `< >`, `"…"`, `'…'`
- **Toggle line comment** bound to `--` (Ctrl+/ / Cmd+/)
- **Word selection** understands k identifiers including `?`, `!`, `+`, `-`

## Install

### Run locally (development)

1. Open the `k-vscode/` folder in VS Code.
2. Press **F5** — this opens an Extension Development Host with the extension loaded.
3. Expression backgrounds activate automatically. Run **Preferences: Color Theme**
   and select **k Contrast** to use the bundled foreground token palette.

### Build and install a VSIX

```bash
cd k-vscode
npm install
npx vsce package --no-dependencies  # produces k-language-0.2.0.vsix
```

Then in VS Code: **Extensions → ⋯ → Install from VSIX…** and select the generated file.

## Notes

- Language id: `k`
- File extension: `.k`
- The extension has no runtime dependencies.
