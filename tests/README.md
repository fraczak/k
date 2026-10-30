# Tests

Run commands below from the repository root after `npm install`.
Use Node.js 22+ for development: browser verification uses the global WebSocket
client. The source parser and runtime can run without a browser.

## Suite commands

| Command | Coverage |
| --- | --- |
| `npm test` | Registered runtime, patterns, paper examples, codecs, hashes, objects, REPL, browser, kVM, PKIR, library, and shell suites |
| `npm run conformance` | Shared source/object/KIR-P fixtures |
| `npm run test:wasm` | Wasm runtime/lowering and backend shell integration |
| `npm run test:llvm` | LLVM runtime/lowering, field-layout regression, shell integration, and shared fixtures |
| `npm run test:backends` | Both backend suites |
| `npm --prefix k-vscode test` | Editor grammar and expression-background tests |
| `node tests/test-paper-examples.mjs` | Publication examples, including canonical hashes and the half adder |
| `npm run test:package -- /path/to/installed/@fraczak/k` | Packed installation, API, command help, codec pipeline, objects, and Wasm |

The backend and editor suites are separate commands; `npm test` does not run
every suite in this table. The paper command is also available as a focused check.

The main runner executes suites sequentially, prints durations, and stops at
the first failure. Browser tests build `repl.html` and perform headless
verification if Chromium is found. Without Chromium, that browser execution
portion is skipped. LLVM execution checks require Clang; individual optional
checks report skips when their toolchain is unavailable.

## Registration and organization

Root suites are explicitly registered in
[scripts/run-tests.mjs](../scripts/run-tests.mjs).
Files ending in `.mjs` under [code-derivation/](code-derivation/) are discovered
automatically. The compact `core.mjs` table groups the elementary derivation
cases; shared helpers live outside the discovered directory.

| Area | Representative suites |
| --- | --- |
| Templates and routing | `test-named-patterns.mjs` |
| Derivation and envelope propagation | `code-derivation/` |
| Canonical identities | `test-hash-normalization.mjs` (including code fingerprints), `test-hash-fuzz.mjs` |
| Wire values and codecs | `test-codecs.mjs`, `test-deep-wire-value.mjs`, `test-structural-values.mjs` |
| Objects and portable export | `test-k-object.mjs`, `test-kir.mjs`, `test-validate-object.mjs` |
| Interactive state and browser UI | `test-repl.mjs`, `test-repl-html.mjs`, `test-tree-view.mjs` |
| Execution layers | `test-kvm.mjs`, `test-kvm-polymorphic.mjs`, `test-access-table.mjs`, `test-pkir.mjs` |
| Libraries | Arithmetic, IEEE, list, Karatsuba, and dynamic JSON suites |
| JSON text parsing | `test-parse-json.mjs`: grammar, Unicode escapes, binary64 boundaries, Wasm, and CLI |
| IEEE text conversion | `test-ieee-text.mjs`: parsing, exact printing, special values, and binary64 round-trips |

`test-hash-fuzz.mjs` uses a deterministic generator to check renaming and
definition-order invariance; it is not a general cryptographic collision test.

The [conformance fixtures](../conformance/) provide programs, input values,
expected values, and case descriptions reused by supported execution paths.
A rendered payload alone can hide envelope differences, so keep pattern
comparisons when checking structural correctness.

Arithmetic and Karatsuba tests share CLI setup in `helpers/cli.mjs`. They still
run the library through `k.mjs` and compare numerical results with BigInt;
codec modules prepare and decode the wire values in process. The dedicated
codec and shell suites cover the codec command-line boundary.

## Adding coverage

Use assertions for expected values, schemas, and failures. Register a new
root suite explicitly, or add a derivation case in the discovered directory.
Run the main suite and the relevant backend/editor checks. Grammar edits also
require `npm run prepare`; generated parser files should not be hand-edited.
