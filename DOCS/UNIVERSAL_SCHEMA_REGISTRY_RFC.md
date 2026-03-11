# Universal Schema Registry RFC (k)

Status: Draft  
Audience: language/runtime/compiler/registry maintainers  
Last updated: 2026-03-11

## 1. Purpose

Define an implementation-ready plan to evolve the current `k` POC into a production "Universal Schema Registry":

1. A global repository of canonical `codes` (types) and canonical `transformations` (partial functions).
2. A deterministic value layer with canonical serialization and pluggable adapters.
3. A compiler/runtime stack that can target multiple host languages while preserving k semantics.
4. An educational surface that teaches the same semantics used in production.

## 2. Principles

1. Canonical first: identity comes only from normalized structure, never from local names.
2. One semantic core: interpreter, compiler, registry, and educational tooling share the same formal model.
3. Append-only provenance: registry state is reproducible from transaction history.
4. Adapter isolation: JSON/Protobuf/etc. are transport adapters, not sources of semantic truth.
5. Deterministic execution envelope: evaluation behavior is reproducible under fixed policy.

## 3. Scope and Non-Goals

In scope:
- Registry APIs and ingestion/run transaction model.
- Persistence schema and indexing.
- Hash stability governance (freeze current JS canonical `@...` behavior and lock it with tests).
- Canonical serialization boundary and adapter contracts.
- Compiler/runtime milestones for multi-language integration.
- Educational product track.
- Certified optimization proofs for explicitly restricted decidable fragments (for example, Presburger-constrained subsets where finite transducer compilation is guaranteed).

Out of scope for v1:
- Decentralized consensus protocol.
- Fine-grained multi-tenant permission model (single submitter role remains acceptable).
- General-case optimizer completeness/optimality proofs for all k programs (undecidable for a Turing-complete language).

## 4. Canonical Objects and Identity

## 4.1 Entity kinds

Registry stores immutable entities keyed by canonical hash:

1. `type`: canonical automaton definition.
2. `function`: normalized function/program representation.

## 4.2 Hash identity format

For v1, keep the current JS prototype canonical ID format unchanged:

```text
id = @<hash-body>
```

Example:

```text
@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb
```

Notes:
- Hash computation semantics are frozen exactly as implemented in `hash.mjs` (SHA-256 input digest + current base56/padding/trimming rules).
- Canonical identity is the full current `@...` name (no short-ID canonicalization).
- Any future ID-format change is deferred and requires a separate migration RFC.

## 4.3 Invariants (must hold in Continuous Integration)

1. Alpha-renaming invariant for functions.
2. Invariance under ordering of mutually recursive function groups:
   normalization and hashing must not change when we visit strongly connected components of the function-reference graph in a different order.
3. Alias-vs-inline equivalence invariant:
   if `f = g` and `g` has body `E`, then replacing `f` by `E` (inline expansion) must produce the same canonical hash for `f`.
4. Deterministic canonical text used for hashing:
   converting a normalized function/type into canonical text must always produce exactly the same string, so hashing is stable.
5. Filter normalization determinism.

(`DOCS/HASHING.md` test vectors become mandatory Continuous Integration gates.)

## 5. Registry API

## 5.1 Run transaction

`POST /run`

Request:

```json
{
  "program": "k source code defining __main__",
  "inEnc": "kenc:json",
  "input": "...encoding-specific payload...",
  "outEnc": "kenc:json",
  "gas": {
    "limit": 1000000,
    "policy": "abstract-gas; token-backing TBD"
  }
}
```

`inEnc` and `outEnc` are strings in the k-encoding-spec DSL (to be defined separately).
Examples: `kenc:json`, `kenc:kvbf`, `kenc:protobuf:<schemaRef>`, `kenc:avro:<schemaRef>`.
For Protobuf/Avro, `schemaRef` must point to an explicit adapter schema/mapping; there is no implicit field/tag inference.

Response:

```json
{
  "txId": "tx_01...",
  "result": "...encoded payload...",
  "ids": {
    "types": {
      "bnat": "@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb",
      "unit": "@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c"
    },
    "functions": {
      "normalize": "@FfJRYapBGtCeyV56bs5ZbVtPHxGf5GNMzzyVFxtv7geg",
      "__main__": "@Rk7h6m2Xq9vL5nP3tY8cJ4sD1wE0aBzNfUuQpM1kT2"
    }
  },
  "metrics": {
    "parseMs": 6,
    "normalizeMs": 12,
    "evalMs": 2,
    "gasUsed": 74210
  }
}
```

`ids.types` and `ids.functions` map all type/function definitions from `program` to canonical IDs.

`txId` identifies the append-only transaction-log entry for provenance, audit, and later lookup (`/tx/{txId}`).
If a deployment intentionally runs in stateless mode without a transaction log, `txId` may be omitted.

Failure/error signaling is handled by a higher-level protocol layer (to be specified separately).

## 5.2 Entity lookup

`GET /entities/{id}`

Response:

```json
{
  "id": "@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb",
  "kind": "type",
  "headDefinition": "$ @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb = < @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb 0, @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb 1, @NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c _ >;",
  "canonical": "$C0=<C0\"0\",C0\"1\",C1\"_\">;$C1={};",
  "definedIn": [
    {
      "txId": "tx_01...",
      "names": ["bnat", "binary_nat"]
    },
    {
      "txId": "tx_09...",
      "names": ["nat2"]
    }
  ]
}
```

Function response example:

```json
{
  "id": "@FfJRYapBGtCeyV56bs5ZbVtPHxGf5GNMzzyVFxtv7geg",
  "kind": "function",
  "headDefinition": "normalize = ?(...) ... ;",
  "inFilter": "?{ $@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb value, ... }",
  "outFilter": "?{ $@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c value, ... }",
  "canonical": "(normalized canonical function text)",
  "definedIn": [
    {
      "txId": "tx_01...",
      "names": ["normalize", "nf"]
    },
    {
      "txId": "tx_0B...",
      "names": ["normalize_v2_alias"]
    }
  ]
}
```

## 5.3 Function search

`POST /functions/search`

Request:

```json
{
  "inFilter": "?{ $@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb value, ... }",
  "outFilter": "?{ $@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c value, ... }"
}
```

`inFilter` and `outFilter` are filter expressions (not only singleton type IDs).

Value validation and re-encoding are expressed via `POST /run` (special cases), so there are no separate value endpoints.

## 5.4 Operational endpoints

- `GET /tx/{txId}`
- `GET /health`
- `GET /stats`

## 6. Persistence and Data Model

Recommended implementation: append-only transaction log + indexed relational/KV projections.

In simple terms:
1. Keep a full history log of all requests/results (`tx_log`) as the source of truth.
2. Keep indexed tables for fast lookup (`entity`, `function_sig`, `tx_entity`, `alias`).
3. Rebuild indexed tables from `tx_log` when needed.
4. Allow compaction of derived/indexed data, but not canonical entity identities.

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
   - `id_body` (hash body without `@`, optional denormalized field)
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
   - `names` (array/text list; all source-level names in that transaction that resolve to `entity_id`)
   - composite index `(entity_id, tx_id)`

5. `alias`
   - `alias`
   - `entity_id`
   - `scope` (`display` | `module-local`)
   - composite unique `(alias, scope)`

## 6.2 Required indexes

1. `entity(kind, id)`
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
3. Current JS hash ID format (`@...` from `hash.mjs`) is frozen and covered by regression vectors.
4. KVBF envelope and core bit semantics in `DOCS/KVBF.md` are frozen for v1.
5. Adapter contract states:
   - canonical representation is independent of adapter choice;
   - adapter conversion failures are explicit and non-canonical.
   - Protobuf/Avro mappings are explicit and deterministic (schema evolution rules are adapter-level, not canonical-level).
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
- `/run`, `/entities/{id}`, `/tx/{txId}`
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
- Avro adapter (non-canonical transport)

Exit criteria:
- `run`-based validate/re-encode workflows stable
- adapter roundtrip tests and canonical digest checks pass (including Protobuf and Avro reference vectors)

## Phase 3: Native compiler path

Deliverables:
- JS front-end (parse + type derivation + normalization export)
- backend codegen pipeline (initial LLVM or equivalent)
- runtime metadata loader keyed by type IDs

Exit criteria:
- compiled output matches interpreter for selected corpus
- polymorphic projection/function calls resolve via registry metadata

## Phase 4: Multi-language integration

Deliverables:
- host-language SDKs (at least JS and one systems language)
- generated type/function bindings from registry ids
- client-side cache and lazy registry fetch

Exit criteria:
- same `@...` ID executable in multiple host environments
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
   - certified-fragment optimization proofs and explicit undecidability boundaries for global optimality

## 9.3 Required tools

1. REPL with "explain derivation" mode for filters/pattern graph evolution.
2. Visualizer for canonical type automata and serialized bit traces.
3. Step evaluator showing where partial functions become undefined.
4. Registry-backed exercise runner where solutions are shareable by hash ID.

## 10. Security and Execution Policy

1. `run` must execute under deterministic resource limits (time, memory, recursion depth).
2. Payload must be pure k code; no embedded executable host-language snippets.
3. Sign and store submission metadata (submitter, signature, timestamp).
4. Enforce metering at API layer (quota/rate/fee policy), independent of content identity.

## 11. Risks and Mitigations

1. Normalization drift between implementations.
   - Mitigation: shared conformance vectors + differential tests.
2. Non-convergent or slow type derivation in mutually recursive function groups.
   - Mitigation: semantic convergence checks + divergence heuristics + bounded diagnostics.
3. Adapter ambiguity (JSON/Protobuf/Avro mapping corner cases).
   - Mitigation: explicit mapping specs and canonical digest comparison against KVBF.
4. Polymorphic search explosion in function discovery.
   - Mitigation: start with exact hash index; add compatible search in staged manner.

## 12. First 6-Week Execution Plan

Week 1-2:
1. Freeze the current JS hash format and add Continuous Integration invariants from `DOCS/HASHING.md`.
2. Implement semantic convergence detector skeleton in type derivation.

Week 3-4:
1. Build `/run` ingestion path with tx log and entity persistence.
2. Add lookup APIs and provenance links.

Week 5:
1. Implement validate/re-encode workflows via `run` with JSON + KVBF and Protobuf/Avro adapter mappings.
2. Publish adapter conformance tests.

Week 6:
1. Add interpreter-vs-compiled conformance smoke suite.
2. Ship educational REPL "explain mode" prototype using existing derivation artifacts.

## 13. Definition of Done for "Registry v1 Foundation"

All conditions must hold:

1. Canonical ID format is the current JS `@...` format and is enforced by regression tests.
2. Ingestion and lookup APIs are stable and documented.
3. Transaction log can rebuild registry projections.
4. JSON, KVBF, Protobuf, and Avro validation/re-encoding mappings are specified; conformance vectors pass for the reference type corpus.
5. Conformance suite passes across at least two execution paths.
6. Educational tools consume the same canonical/type-derivation artifacts as runtime/compiler.

## 14. Open Decisions

1. Whether to introduce a new ID envelope format in the future (explicitly deferred for v1).
2. KVBF back-reference ID encoding choice (ULEB128 vs native bnat).
3. Protobuf and Avro adapter mapping policy (required annotations, evolution constraints, unknown-field behavior).
4. Function search semantics for polymorphic compatibility ranking.
5. Execution model for untrusted `run` workloads (sandbox profile and limits).
6. Precise definition of the certified decidable optimization fragment(s) and proof artifact format.
