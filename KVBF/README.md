# KVBF Sandbox

This folder contains the experimental KVBF tooling and tests.
It is intentionally isolated from the rest of the project so KVBF work
can evolve without touching the core runtime.

Contents:

- `kvbf.mjs`: KVBF encoder/decoder (bitstream + DAG compression).
- `kvalue-text.mjs`: strict native k value formatting utilities.
- `kvbf-encode.mjs`: CLI for typed literal -> KVBF bytes.
- `kvbf-decode.mjs`: CLI for KVBF bytes -> k program fragment.
- `PLAN.md`: implementation plan and design notes.
- `test-kvbf.mjs`: small KVBF round-trip test.
- `test-kvbf-examples.mjs`: extensive round-trip tests over `Examples/*.k`.

## Running tests

From repo root:

```bash
npm test
```

That runs the KVBF tests as part of the full suite.

To run just the KVBF tests:

```bash
node KVBF/test-kvbf.mjs
node KVBF/test-kvbf-examples.mjs
```

## CLI usage

```bash
node KVBF/kvbf-encode.mjs --in value.kvtxt --out value.kvbf
node KVBF/kvbf-decode.mjs --in value.kvbf --out roundtrip.kvtxt
```

Options:
- `--registry type_registry/registry.json`
- `--id-encoding bnat|uleb128`
- `--type-format hash|canonical` (decode only)
