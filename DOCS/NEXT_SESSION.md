# Next session priorities

## Recap (decisions from last session)

- k-registry is a global, content-addressed store of canonical types and functions.
- Identity is `@hash`, resolved by context; no type/function prefix.
- All registry transactions are `evaluate` with `{ k-program, inEnc, input, outEnc }`.
- Payloads are plain k programs; metadata is attached by the registry service.
- Every transaction must define `__main__` (can be identity); used for validation or self-test.
- `@hash` references must already exist in the registry.
- Registry stores a full transaction log; entries keep back-references to touching transactions.
- Single submitter role with metering (quotas/fees/rate limits) instead of trust levels.
- Value layer: start with JSON (debug) then Protobuf; no implicit compatibility checks.

## Read first

- `DOCS/REGISTRY.md`
- `DOCS/REGISTRY_PLAN.md`
- `DOCS/UNIVERSAL_SCHEMA_REGISTRY_RFC.md`

1) Hash/normalization audit plan: define invariants + minimal test vectors.
2) Transaction model refinement: exact request/response fields for `evaluate`.
3) Value validation/encoding: JSON debug format spec + minimal endpoint design.
4) Incremental ingestion sketch: caching and dependency resolution.
5) Metering model brainstorm: quotas vs fees vs rate limits.
