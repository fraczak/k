# k-registry foundation plan

This document outlines the initial work plan to turn the k-registry concept into
a running program.

## 1) Hash validation and invariants

- Revisit existing normalization and hashing code (`export.mjs`, `hash.mjs`).
- Define invariants (e.g., same normalized definition -> same hash).
- Create test vectors to validate stability and detect regressions.
- Decide whether to version the hash algorithm and how to handle changes.

## 2) Persistence and security

- Define the minimal storage schema:
  - Types, functions, module events, and attached metadata.
- Specify authentication, authorization, and identity model:
  - Submitter identity, permissions, audit log.
- Choose a persistence strategy (append-only log + KV index, or SQL + blob storage).

## 3) Incremental module processing

- Design a dependency cache so normalization and verification are reused.
- Specify resolution rules for `@hash` references without re-parsing everything.
- Plan concurrency handling for simultaneous submissions and conflict detection.

## 4) Value validation and encoding

- Define the codec interface: canonical bitstream plus adapters.
- Implement JSON debug encoding for canonical k values.
- Implement a Protobuf adapter and re-encoding endpoints.

## 5) Roles and metering

- Define the metering model (quotas, fees, or rate limits).
- Decide how metering is enforced and observed in the transaction log.
- Specify submitter identity requirements (keys, signatures).

## 6) Minimal registry service

- Implement module ingestion and lookup-by-hash APIs.
- Store and query the transaction log for traceability and observability.
- Add `__main__` validation hooks (execution policy TBD).
