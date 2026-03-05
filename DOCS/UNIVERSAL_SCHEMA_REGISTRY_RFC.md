# Universal Schema Registry RFC (k)

Status: Draft  
Audience: language/runtime/compiler/registry maintainers  
Last updated: 2026-03-04

## 1. Purpose

Define an implementation-ready plan to evolve the current `k` POC into a production "Universal Schema Registry":

1. A global repository of canonical `codes` (types) and canonical `transformations` (partial functions).
2. A deterministic value layer with canonical serialization and pluggable adapters.
3. A compiler/runtime stack that can target multiple host languages while preserving k semantics.
4. An educational surface that teaches the same semantics used in production.

This RFC operationalizes ideas from:
- `DOCS/REGISTRY.md`
- `DOCS/REGISTRY_PLAN.md`
- `DOCS/HASHING.md`
- `DOCS/KVBF.md`
- `DOCS/TYPE_DERIVATION.md`
- `DOCS/book/16-toward-a-universal-schema-registry.md`

## 2. Principles

1. Canonical first: identity comes only from normalized structure, never from local names.
2. One semantic core: interpreter, compiler, registry, and educational tooling share the same formal model.
3. Append-only provenance: registry state is reproducible from transaction history.
4. Adapter isolation: JSON/Protobuf/etc. are transport adapters, not sources of semantic truth.
5. Deterministic execution envelope: evaluation behavior is reproducible under fixed policy.

## 3. Scope and Non-Goals

In scope:
- Registry APIs and ingestion/evaluation transaction model.
- Persistence schema and indexing.
- Hash/version governance.
- Canonical serialization boundary and adapter contracts.
- Compiler/runtime milestones for multi-language integration.
- Educational product track.

Out of scope for v1:
- Decentralized consensus protocol.
- Fine-grained multi-tenant permission model (single submitter role remains acceptable).
- Full optimizer completeness proofs.

## 4. Canonical Objects and Identity

## 4.1 Entity kinds

Registry stores immutable entities keyed by canonical hash:

1. `type`: canonical automaton definition.
2. `function`: normalized function/program representation.

## 4.2 Hash identity format

Use an explicit algorithm/version envelope:

```text
id = @<algo>:<version>:<digest>
```

Example:

```text
@sha256:v1:56b95dc611742a8e1cbb72d399660b5f18e4c3426dba0171f86dcdb2c41e9d91
```

Notes:
- Existing short/base56 names may be retained as aliases for display.
- Canonical identity must always use full digest.

## 4.3 Invariants (must hold in Continuous Integration)

1. Alpha-renaming invariant for functions.
2. SCC traversal/order invariant for mutual recursion normalization.
3. Alias-vs-inline equivalence invariant.
4. Canonical pretty-print determinism for hashed forms.
5. Filter normalization determinism.

(`DOCS/HASHING.md` test vectors become mandatory Continuous Integration gates.)

## 5. Registry API (v1)

Base path: `/v1`

## 5.1 Evaluate transaction

`POST /v1/evaluate`

Request:

```json
{
  "program": "k source code defining __main__",
  "inEnc": { "kind": "json", "options": {} },
  "input": "...encoding-specific payload...",
  "outEnc": { "kind": "json", "options": {} },
  "dryRun": false,
  "expect": {
    "newEntitiesMax": 1000,
    "timeMsMax": 2000
  }
}
```

Response:

```json
{
  "txId": "tx_01...",
  "status": "applied",
  "result": "...encoded payload...",
  "artifacts": {
    "newTypes": ["@sha256:v1:..."],
    "newFunctions": ["@sha256:v1:..."],
    "referenced": ["@sha256:v1:..."]
  },
  "metrics": {
    "parseMs": 6,
    "normalizeMs": 12,
    "evalMs": 2
  }
}
```

Status values:
- `applied`
- `rejected`
- `dry-run`

Common rejection reasons:
- unknown `@hash` reference
- normalization failure
- type derivation/convergence failure
- execution policy limit exceeded

## 5.2 Entity lookup

`GET /v1/entities/{id}`

Response:

```json
{
  "id": "@sha256:v1:...",
  "kind": "type",
  "canonical": "$C0=<C0\"0\",C0\"1\",C1\"_\">;$C1={};",
  "meta": {
    "createdAt": "2026-03-04T12:00:00Z",
    "firstSeenTx": "tx_01..."
  }
}
```

Also provide kind-specific convenience endpoints:
- `GET /v1/types/{id}`
- `GET /v1/functions/{id}`

## 5.3 Function search

`POST /v1/functions/search`

Request:

```json
{
  "inputType": "@sha256:v1:...",
  "outputType": "@sha256:v1:...",
  "mode": "exact"
}
```

Modes:
- `exact`: exact input/output hash match.
- `compatible`: includes registry-supported subtype/pattern compatibility when available.

## 5.4 Value endpoints

1. `POST /v1/values/validate`
2. `POST /v1/values/reencode`

Request:

```json
{
  "typeId": "@sha256:v1:...",
  "inEnc": { "kind": "json", "options": {} },
  "input": "...",
  "outEnc": { "kind": "kvbf", "options": {} }
}
```

Response:

```json
{
  "ok": true,
  "output": "...",
  "canonicalDigest": "hex-32-byte-digest"
}
```

## 5.5 Operational endpoints

- `GET /v1/tx/{txId}`
- `GET /v1/health`
- `GET /v1/stats`

## 6. Persistence and Data Model

Recommended implementation: append-only transaction log + indexed relational/KV projections.

## 6.1 Core tables

1. `tx_log`
   - `tx_id` (pk)
   - `received_at`
   - `submitter_id`
   - `request_json`
   - `status`
   - `error_json`
   - `result_json`

2. `entity`
   - `id` (pk)
   - `kind` (`type` | `function`)
   - `canonical_text`
   - `hash_algo`
   - `hash_version`
   - `digest_hex`
   - `first_seen_tx`
   - `created_at`

3. `function_sig`
   - `function_id` (pk, fk `entity.id`)
   - `input_type_id` (fk `entity.id`)
   - `output_type_id` (fk `entity.id`)
   - `polymorphic` (bool)
   - `pattern_in` (nullable text)
   - `pattern_out` (nullable text)

4. `tx_entity`
   - `tx_id` (fk)
   - `entity_id` (fk)
   - `action` (`introduced` | `referenced`)
   - composite index `(entity_id, tx_id)`

5. `alias`
   - `alias`
   - `entity_id`
   - `scope` (`display` | `module-local`)
   - composite unique `(alias, scope)`

## 6.2 Required indexes

1. `entity(kind, digest_hex)`
2. `function_sig(input_type_id, output_type_id)`
3. `tx_entity(entity_id, tx_id desc)`
4. `tx_log(received_at desc)`

## 6.3 Retention and compaction

1. `tx_log` is append-only authoritative history.
2. Projections can be rebuilt from `tx_log`.
3. Compaction is allowed for derived indexes, not for canonical entity identity rows.

## 7. Canonical Spec Freeze Checklist (v1 gate)

Release `k-canonical-spec v1` only when all are complete:

1. Type canonicalization is deterministic across platforms.
2. Function normalization invariants in `DOCS/HASHING.md` are all automated.
3. Hash id envelope (`algo`, `version`, `digest`) is implemented end-to-end.
4. KVBF envelope and core bit semantics in `DOCS/KVBF.md` are frozen for v1.
5. Adapter contract states:
   - canonical representation is independent of adapter choice;
   - adapter conversion failures are explicit and non-canonical.
6. Type-derivation fixed-point convergence check upgraded from string snapshots to graph-semantic convergence (`DOCS/CONVERGENCE.md` direction).
7. Cross-implementation compatibility tests (interpreter vs compiler runtime) are green.

## 8. Compiler and Runtime Roadmap

## Phase 0: Baseline hardening (current JS POC)

Deliverables:
- deterministic normalization audit
- conformance tests for canonical forms and hashes
- divergence/convergence diagnostics for type derivation

Exit criteria:
- repeated runs produce identical entity ids and canonical text
- known problematic recursive examples converge or fail with structured diagnostics

## Phase 1: Registry ingestion service (MVP)

Deliverables:
- `/v1/evaluate`, `/v1/entities/{id}`, `/v1/tx/{txId}`
- persistence schema from Section 6
- unknown-reference checks and provenance links

Exit criteria:
- can ingest modules with inter-module `@hash` references
- can reconstruct projected state from tx log

## Phase 2: Value layer and adapters

Deliverables:
- JSON debug codec
- KVBF canonical codec
- Protobuf adapter (non-canonical transport)

Exit criteria:
- `validate`/`reencode` endpoints stable
- adapter roundtrip tests and canonical digest checks pass

## Phase 3: Native compiler path

Deliverables:
- JS front-end (parse + type derivation + normalization export)
- backend codegen pipeline (initial LLVM or equivalent)
- runtime metadata loader keyed by type ids

Exit criteria:
- compiled output matches interpreter for selected corpus
- polymorphic projection/function calls resolve via registry metadata

## Phase 4: Multi-language integration

Deliverables:
- host-language SDKs (at least JS and one systems language)
- generated type/function bindings from registry ids
- client-side cache and lazy registry fetch

Exit criteria:
- same `@id` executable in multiple host environments
- no semantic drift in conformance suite

## 9. Educational Track (same semantics, no toy fork)

## 9.1 Objective

Teach programming, typing, and serialization through k while keeping 1:1 alignment with production semantics.

## 9.2 Track design

1. Foundations
   - values as labeled trees
   - partial functions and definedness
   - products/unions and projections

2. Type reasoning
   - filters as structural polymorphism constraints
   - normalization and canonical types
   - recursive type intuition through automata/CFG visuals

3. Real systems
   - canonical serialization (KVBF)
   - schema/function identity by hash
   - registry lookup and compatibility workflows

4. Compilation
   - ABI mental model (`ok`, `value`)
   - IR and runtime mapping

## 9.3 Required tools

1. REPL with "explain derivation" mode for filters/pattern graph evolution.
2. Visualizer for canonical type automata and serialized bit traces.
3. Step evaluator showing where partial functions become undefined.
4. Registry-backed exercise runner where solutions are shareable by hash id.

## 10. Security and Execution Policy

1. `evaluate` must run under deterministic resource limits (time, memory, recursion depth).
2. Payload must be pure k code; no embedded executable host-language snippets.
3. Sign and store submission metadata (submitter, signature, timestamp).
4. Enforce metering at API layer (quota/rate/fee policy), independent of content identity.

## 11. Risks and Mitigations

1. Normalization drift between implementations.
   - Mitigation: shared conformance vectors + differential tests.
2. Non-convergent or slow type derivation in recursive SCCs.
   - Mitigation: semantic convergence checks + divergence heuristics + bounded diagnostics.
3. Adapter ambiguity (JSON/Proto mapping corner cases).
   - Mitigation: explicit mapping specs and canonical digest comparison against KVBF.
4. Polymorphic search explosion in function discovery.
   - Mitigation: start with exact hash index; add compatible search in staged manner.

## 12. First 6-Week Execution Plan

Week 1-2:
1. Freeze hash envelope and add Continuous Integration invariants from `DOCS/HASHING.md`.
2. Implement semantic convergence detector skeleton in type derivation.

Week 3-4:
1. Build `/v1/evaluate` ingestion path with tx log and entity persistence.
2. Add lookup APIs and provenance links.

Week 5:
1. Implement `validate` and `reencode` with JSON + KVBF.
2. Publish adapter conformance tests.

Week 6:
1. Add interpreter-vs-compiled conformance smoke suite.
2. Ship educational REPL "explain mode" prototype using existing derivation artifacts.

## 13. Definition of Done for "Registry v1 Foundation"

All conditions must hold:

1. Canonical id format with versioned hash is enforced.
2. Ingestion and lookup APIs are stable and documented.
3. Transaction log can rebuild registry projections.
4. JSON and KVBF validation/re-encoding works for reference type corpus.
5. Conformance suite passes across at least two execution paths.
6. Educational tools consume the same canonical/type-derivation artifacts as runtime/compiler.

## 14. Open Decisions

1. Final canonical hash algorithm selection (`sha256` vs alternatives), while preserving version envelope.
2. KVBF back-reference id encoding choice (ULEB128 vs native bnat).
3. Function search semantics for polymorphic compatibility ranking.
4. Execution model for untrusted `evaluate` workloads (sandbox profile and limits).
