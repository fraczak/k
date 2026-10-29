# Repository Guidelines

## Project structure

- Root `.mjs` files contain the parser interface, compiler, runtime, and library API.
- `parser.jison` and `valueParser.jison` are the grammar sources.
- `Examples/` contains teaching examples and libraries; `core.k` defines core schemas.
- `codecs/` and `objects/` contain stream codecs and artifact tools.
- `backends/` contains the LLVM and WebAssembly implementations.
- `browser/` and `scripts/build-repl-html.mjs` implement the standalone Web REPL.
- `tests/` contains the main suites, including `tests/code-derivation/`.
- `conformance/` contains shared fixtures; `k-vscode/` has separate editor tests.
- `DOCS/README.md` is the documentation index; `paper/` holds the published paper.

See [the compiler guide](DOCS/ARCHITECTURE.md) for the implementation map.

## Commands

Use Node.js 22+ for development and browser tests.

- `npm install` installs dependencies and generates parsers.
- `npm run prepare` regenerates `parser.mjs` and `valueParser.mjs`.
- `npm test` runs the main registered suites, including shell and Web REPL checks.
- `npm run test:backends` runs the separate LLVM and WebAssembly suites.
- `npm --prefix k-vscode test` runs editor tests.
- `node tests/test-paper-examples.mjs` runs the paper examples alone; they also run under `npm test`.
- `node repl.mjs` starts the REPL.
- `node k.mjs <file-or-expression>` transforms a binary schema+payload input.

[Test requirements and registration](tests/README.md) describe the suite boundaries.

## Style and verification

JavaScript uses ES modules, two-space indentation, semicolons, `const`/`let`,
and small focused modules. Edit grammar sources rather than generated parsers.

Keep tests with the relevant runtime or derivation suite. Root test files need
an entry in `scripts/run-tests.mjs`; derivation files are discovered by directory.
Run `npm test` before opening a PR, plus the relevant backend/editor suites.

Commits use short, imperative, sentence-case summaries. PRs explain the behavior
change, commands run, and relevant documentation updates. Mention
`npm run prepare` when grammars change.
