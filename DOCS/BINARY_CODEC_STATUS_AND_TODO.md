# Binary Codec Status And TODO

## Purpose

This document captures:
- where the project currently is after introducing `k-parse | k | k-print`,
- what is implemented and verified,
- what remains unresolved,
- a concrete TODO list for the next session.

It is intended as the handoff/reference point before revisiting format decisions.

## Current Direction (Implemented)

We moved from mixed text I/O in `k.mjs` to a pipeline architecture:

1. `k-parse`: text value + explicit input type -> binary envelope
2. `k`: binary envelope -> evaluate k expression -> binary envelope
3. `k-print`: binary envelope -> formatted text (JSON)

This enforces explicit typing for encoding and makes `k` a binary-processing stage.

## What Is Implemented

### CLI programs

- `k-parse` (new)
  - Input:
    - value text on stdin (or file)
    - `--input-type` as inline type script or path to type file
  - Behavior:
    - parses type script,
    - resolves selected root type from final expression (must end in a type name expression, e.g. `$v`),
    - parses text value,
    - encodes value in canonical binary payload,
    - wraps payload in envelope with reachable type table,
    - writes envelope to stdout.

- `k` (changed)
  - Input: binary envelope only.
  - Behavior:
    - unpacks envelope,
    - decodes typed payload into runtime value,
    - executes compiled k expression,
    - synthesizes concrete output type from runtime output value,
    - re-encodes output as binary payload,
    - packs output envelope,
    - writes envelope to stdout.

- `k-print` (new)
  - Input: binary envelope.
  - Behavior:
    - unpacks envelope,
    - decodes payload using embedded type table,
    - prints JSON.

### Runtime codec pieces

- Canonical payload encoder/decoder exists.
- Envelope layer exists (`KBIN1` magic + metadata + payload).
- Output type synthesis helper exists (derives a concrete type from runtime output value tree).

## Current Envelope / Payload Shape

Current wire stream between stages is:

- envelope header:
  - magic: `KBIN1`
  - metadata length (big-endian u32)
- metadata JSON:
  - `typeName`: canonical root type name
  - `types`: reachable type definitions map
- payload bytes:
  - canonical payload produced by codec (currently already includes root type hash per codec implementation)

Note: there is currently potential redundancy between envelope metadata and payload header semantics. This is one of the topics to settle.

## Verified Workflows

Both forms below were tested end-to-end:

- Inline type:

  ```bash
  echo '["zebara", "ela", "kupa", "ala", "owca"]' | \
    node ./codecs/k-parse.mjs --input-type '$x = <{} zebara, {}ela, {}kupa, {}ala, {}owca >;$v = {x 0, x 1, x 2, x 3, x 4}; $v' | \
    node ./k.mjs '{.1 0,.3 1}' | \
    node ./codecs/k-print.mjs
  ```

- Type file:

  ```bash
  echo '["zebara", "ela", "kupa", "ala", "owca"]' | \
    node ./codecs/k-parse.mjs --input-type input-type.k | \
    node ./k.mjs '{.1 0,.3 1}' | \
    node ./codecs/k-print.mjs
  ```

Expected output in both cases:

```json
[
  "ela",
  "ala"
]
```

## What This Solves

- Explicit type is provided at encode boundary (no hidden guessing for input encoding).
- `k` can be used in Unix-style binary pipelines.
- Input/output formatting is cleanly delegated to dedicated tools.

## Locked Direction: Typed DAG Semantics

The binary payload should represent a **typed value**, not just an untyped bit pattern.

- A runtime value is semantically a typed tree.
- For compact transport, the payload may encode the tree through its **unique minimal DAG quotient**.
- DAG sharing is **semantic**, not ad-hoc:
  - two subtrees may be merged only when they denote the same typed value,
  - equality of raw payload bytes alone is not sufficient,
  - equality must include the subtree's canonical type identity (equivalently: canonical subtype/state) together with its value.
- Therefore, two subtrees that happen to serialize to the same local payload under different types must remain distinct in the DAG.

This removes "best effort compression" from the canonical contract. The canonical representation is the minimal DAG of the typed tree, and implementation heuristics are only allowed to help compute that quotient, not to change which nodes are shared.

## Current Payload Proposal

The leading proposal for the canonical payload is now:

- root type hash identifies the canonical automaton,
- payload encodes the **minimal typed DAG** as a sequential node table,
- node IDs are assigned in deterministic postorder,
- root node is implicit: the last node,
- each node record begins with `state_id`,
- product nodes store child references in canonical field order,
- union nodes store discriminator ordinal first, then one child reference,
- child references are encoded as back-distances to earlier node IDs.

This shape is intentionally friendly to the primitive `k` navigations:

- `.label` can jump to a product slot by using the type's `label -> field-index` map,
- `/tag` can inspect the union discriminator before touching the child.

The detailed byte layout now lives in `codecs/BINARY_FORMAT.md`.

## Known Limitations / Open Design Areas

- Output type policy currently synthesizes a concrete type from produced value tree. This may or may not match the final desired contract model.
- Envelope currently carries type table metadata; long-term portability vs compactness tradeoff is undecided.
- Payload vs envelope responsibility boundary is not fully finalized.
- Canonicalization and versioning guarantees for long-term compatibility need to be formalized.

## TODO List For Next Session

### A. Envelope scope and ownership

1. Decide whether each value must carry full type metadata, or only canonical root hash.
2. Decide if envelope is transport-only (outside canonical payload) or part of format contract.
3. Decide whether `k` should preserve input type table, replace it, or always emit minimal reachable table.

### B. Payload contract

4. Decide if payload should contain root type hash when envelope already contains `typeName`.
5. Define strict canonical field/tag ordering rules and make them normative.
6. Decide whether `state_id`, `tag_ordinal`, and child references stay `uvarint`-encoded or get per-state tighter encodings.

### C. Type resolution model

7. Define authoritative source of type definitions at decode time:
   - embedded in envelope,
   - external registry,
   - hybrid fallback.
8. Define behavior on unknown type hash.
9. Define allowed/forbidden type aliases in transport metadata.

### D. Value model and structure sharing

10. Define the exact canonical encoding of the minimal typed DAG.
11. Define node identity formally (canonical subtype/state + value), so semantic sharing is testable.
12. Finalize node table/reference encoding rules and deterministic node ordering.
13. Clarify recursion representation and validation constraints.

### E. Output typing policy

14. Decide whether output type must be:
   - synthesized from runtime value (current behavior),
   - computed from compiler-derived relation output type,
   - provided externally.
15. Decide how strict output conformance should be (validate against declared output type vs infer).

### F. Compatibility and evolution

16. Introduce explicit format versioning policy (envelope and payload separately if needed).
17. Define forward/backward compatibility rules.
18. Define decoder strictness for trailing/extra bits and malformed metadata.

### G. CLI contract finalization

19. Decide stable CLI flags and error messages for:
  - `k-parse` (`--input-type`, source format options),
   - `k` (binary-only contract statement),
  - `k-print` (output formatting options).
20. Decide whether to support pretty/compact/developer debug modes.
21. Update README and examples after final decisions.

## Proposed Next-Session Agenda

1. Finalize ownership boundary: envelope vs payload.
2. Lock root type identity rules (where root type comes from and where it is stored).
3. Lock the canonical minimal typed-DAG payload layout.
4. Lock output typing policy.
5. Lock compatibility/versioning strategy.
6. Convert decisions into implementation tasks and tests.

## Test Plan To Add After Decisions

- Golden round-trip fixtures for representative algebraic values.
- Cross-tool contract tests (`k-parse | k | k-print`).
- Negative tests for unknown hashes/malformed metadata.
- Canonical equivalence tests (same value+type => identical bytes).
- Version compatibility tests when versioning is introduced.

## Summary

Current status is a working binary pipeline with explicit input typing at encode time and binary transport between stages. The remaining work is mostly design finalization of the binary contract and type-transport policy. Once those decisions are fixed, implementation can be hardened with compatibility tests and documentation updates.
