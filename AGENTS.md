# Repository Guidelines

## Project Structure & Module Organization
- Root `.mjs` files hold the core runtime and library entry points (e.g., `index.mjs`, `run.mjs`, `codes.mjs`, `typing.mjs`).
- `k_compiler/` contains the Python prototype compiler and supporting modules.
- `type_registry/` houses registry experiments and grammar artifacts.
- `Examples/` and `DOCS/` provide sample programs and design notes.
- Tests live in top-level `test*.mjs`, `Code-derivation-tests/`, and `tests.sh`.

## Build, Test, and Development Commands
- `npm install` installs dev dependencies and runs `prepare` to generate parsers.
- `npm run prepare` regenerates `parser.mjs` and `valueParser.mjs` from `.jison` grammars.
- `npm test` runs the full suite (`test.mjs`, `Code-derivation-tests/*.mjs`, `test-fingerprint.mjs`, `tests.sh`).
- `node repl.mjs` starts the interactive REPL.
- `./k.mjs <file.k>` executes a k script on binary input from stdin or a file; use `k-encode` and `k-decode` at the boundaries.

## Coding Style & Naming Conventions
- JavaScript uses ES modules (`.mjs`) with 2-space indentation and semicolons.
- Prefer `const`/`let`, small focused modules, and descriptive lower-case filenames.
- Python modules in `k_compiler/` follow 4-space indentation and standard snake_case.
- Grammar sources are `parser.jison` and `valueParser.jison`; generated files should not be hand-edited.

## Testing Guidelines
- Add runtime tests alongside `test.mjs` or new `test-*.mjs` files.
- Add type-derivation coverage in `Code-derivation-tests/` (one case per file is typical).
- Verify locally with `npm test` before opening a PR.

## Commit & Pull Request Guidelines
- Commits use short, imperative, sentence-case summaries (e.g., "Improve type derivation").
- PRs should include: a clear description, the commands run (`npm test` or specific subsets), and any relevant examples or docs updates.
- If changes touch parsing or grammars, note whether `npm run prepare` was run.

## Configuration Notes
- Requires Node.js 18+.
- The REPL and CLI binaries are `k-repl` and `k` (see `package.json` for mappings).
