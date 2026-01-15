# k-registry

This document defines the k-registry as a global store of canonical k entities and the
transactional process used to extend it.

## Overview

- The registry is an append-only store keyed by canonical hashes of normalized k definitions.
- Identity is `@hash`; names are non-authoritative and only used for local readability.
- The registry stores two kinds of entities:
  - **Types**: canonical automaton definitions.
  - **Functions**: normalized k programs (polymorphic or non-polymorphic).

## Transactions (evaluate)

Every registry transaction is an **evaluation** of a k program with a specified
input and encoding parameters:

```
{ k-program, inEnc, input, outEnc }
```

The program must define `__main__`. The transaction runs `__main__` on `input`,
decoding it from `inEnc` and encoding the result to `outEnc`.

Rules:

- The payload contains only k code: type definitions, function definitions,
  and aliases to existing entities via `@hash`.
- The payload carries no embedded metadata (no headers). Submission metadata is
  attached by the registry service at ingestion time.

Special cases expressed as `evaluate`:

- **Register**: the program introduces new entities; `__main__` is optional in
  meaning but its output is returned (can serve as a self-test).
- **Validate**: `__main__` is a filter/identity for a type `$T` and
  `inEnc = outEnc`.
- **Re-encode**: same as validate but `inEnc != outEnc`.

## Ingestion (registry build step)

Given a transaction payload, the registry service:

1. Parses the payload as a k program.
2. Normalizes all new type definitions and computes their hashes.
3. Normalizes all new functions and computes their hashes.
4. Verifies every referenced `@hash` already exists in the registry.
5. Typechecks `__main__` (execution policy is a separate decision).
6. Evaluates `__main__` on the decoded input and encodes the output.
7. Stores new entities keyed by their hashes.
8. Records the transaction event (payload + ingestion metadata).

By default, all functions defined in the module are considered exported (a
registry-side convention, not a semantic rule).

Note: the distinction between non-polymorphic ("base") and polymorphic functions
may affect downstream processing (e.g., code generation, execution strategy), but
the registry itself does not impose that restriction.

## Value validation and encoding

The registry exposes endpoints for validating and re-encoding values for a given
type hash. Serialization is treated as an encoding of k values, not as a foreign
schema system.

Initial focus:

- **JSON** as a canonical debug encoding.
- **Protobuf** as the first binary adapter.

The canonical bitstream format is always derivable from the canonical type
automaton; additional adapters are defined per type or per adapter family.

## Transaction log and registry state

The registry state is defined by the **sequence of transactions**.
The transaction log is kept for traceability and observability (similar to a log of
write queries in a database). The log can be compacted, discarded, or transformed,
since the canonical registry state can be reconstructed from it.

Each registry entry keeps references to the transaction(s) that touched it,
providing provenance for debugging and audit. Pruning/compaction is deferred.

Transaction identity includes the full evaluation request plus attached metadata
(e.g., submitter public key, signature, timestamp).

## Roles and metering

The registry assumes a single submitter role. Access control is handled via
metering (quotas, fees, or rate limits) rather than trust levels, since all
entries are content-addressed and verifiable.
