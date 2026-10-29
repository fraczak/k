# KIR-P export (version 1)

KIR-P is the portable backend export contract for compiled k objects.
It does not replace the stored `.ko` and `.klib` containers.

The format keeps the same pattern-carrying semantics as current object
execution, but normalizes names and graph IDs so backends can consume
object contents without depending on parser-shaped fields, current
object storage, or `TypePatternGraph` internals.

## Scope

KIR v1 defines:

- a serialization-ready contract over current `.ko` and `.klib` payloads;
- relation input and output pattern roots;
- a closed expression opcode vocabulary;
- dense per-relation pattern graph IDs;
- relation type-derivation status;
- object aliases, metadata, compile statistics, and code table
  pass-through.

KIR v1 does not define:

- execution layouts and target ABI decisions;
- LLVM, Wasm, C, or native runtime layout;
- a new stored object format;
- a required physical encoding.

## Top-Level Shape

The current textual export uses this field shape:

```json
{
  "format": "k-ir",
  "version": 1,
  "layer": "KIR-P",
  "sourceFormat": "k-object",
  "kind": "executable",
  "main": "__main__",
  "codes": {},
  "rels": {},
  "relAlias": {},
  "compileStats": {},
  "meta": {}
}
```

Rules:

- `kind` is `executable` when `main` names an entry relation.
- `kind` is `library` when `main` is `null`.
- `codes`, `relAlias`, `compileStats`, and `meta` preserve the current
  object payload content, sorted for stable inspection.
- KIR consumers must not infer backend eligibility from the top level
  alone. Each relation has its own `typeDerivation.status`.

## Relations

Each relation entry has this shape:

```json
{
  "inputPattern": 0,
  "outputPattern": 1,
  "typeDerivation": { "status": "converged" },
  "patternGraph": {
    "nodes": [],
    "sourceNodeMap": {}
  },
  "body": {}
}
```

Rules:

- `inputPattern` and `outputPattern` are node IDs in the relation's
  `patternGraph`.
- Valid type-derivation statuses are `converged`, `not-converged`, and
  `unknown`.
- Export validity alone does not establish backend eligibility. Code generators
  must establish the contracts needed by their execution path, using stored
  derivation status and input-envelope specialization as appropriate.
- `sourceNodeMap` maps original object pattern graph representative IDs
  to KIR node IDs. It exists for inspection and debugging, not as a
  semantic contract.

## Pattern Graphs

KIR-P pattern graph node IDs are dense and local to each relation.

```json
{
  "id": 0,
  "kind": "open-product",
  "edges": [{ "label": "x", "target": 1 }]
}
```

Valid `kind` values:

- `any`
- `open-product`
- `closed-product`
- `open-union`
- `closed-union`
- `type`

Type nodes carry a type-code hash:

```json
{ "id": 2, "kind": "type", "code": "@..." }
```

Rules:

- Edge labels are sorted lexically.
- Parallel edges are represented as repeated edge records with the same
  label and different targets.
- Edge targets always name nodes in the same relation pattern graph.
- The graph is already union-find-normalized; KIR consumers should use
  KIR node IDs directly.

## Expression Opcodes

KIR-P relation bodies use this closed opcode set:

```json
{ "op": "identity", "patterns": [0, 0] }
{ "op": "empty", "patterns": [0, 1] }
{ "op": "dot", "label": "x", "patterns": [0, 1] }
{ "op": "div", "tag": "some", "patterns": [0, 1] }
{ "op": "vid", "tag": "some", "patterns": [0, 1] }
{ "op": "code", "code": "@...", "patterns": [0, 1] }
{ "op": "filter", "filter": {}, "patterns": [0, 1] }
{ "op": "ref", "ref": "@...", "patterns": [0, 1] }
{ "op": "comp", "items": [], "patterns": [0, 1] }
{ "op": "union", "items": [], "patterns": [0, 1] }
{ "op": "product", "fields": [{ "label": "x", "expr": {} }], "patterns": [0, 1] }
```

Rules:

- `patterns` entries are KIR pattern graph node IDs.
- `comp.items` preserve composition order.
- `union.items` preserve source branch priority.
- `product.fields` preserve the relation body field list. Backends may
  sort or lay out fields later only after preserving observable semantics.
- `filter.filter` preserves the stored filter tree.

## Current Tooling

Use `k-inspect-object --kir` to print the current KIR-P export:

```sh
k-compile program.k program.ko
k-inspect-object --kir program.ko
```

Inside a checkout:

```sh
./objects/compile.mjs '()' /tmp/id.ko
./objects/inspect.mjs --kir /tmp/id.ko
```

This command decodes the current object format, hydrates relation pattern
graphs through the normal object loader, and emits the current KIR-P
textual encoding.

Use the conformance runner to compare source and object execution and
validate KIR-P export for deterministic fixtures:

```sh
npm run conformance
```

## Backend path

The current kVM lowerer consumes KIR-P relation bodies directly:

```text
k source -> .ko / .klib -> KIR-P -> kVM template
                                      + input envelope
                                      -> specialized kVM -> interpreter / Wasm / LLVM
```

KIR-P envelope specialization is also available as a separate derivation pass,
producing another KIR-P object. It is distinct from specialization of a lowered
kVM template. See [compiler architecture](ARCHITECTURE.md).

## Envelope Specialization

The API `retypeObjectRelation(object, relationName, inputPattern)` exports
envelope-specialized KIR-P. The pass re-runs contract derivation as
if the entry program were:

```k
?inputPattern relationName
```

The result is a normal KIR-P executable object:

- `layer: "KIR-P"`;
- `kind: "executable"`;
- `main` naming the specialized entry relation;
- relation `inputPattern` and `outputPattern` roots in the entry
  relation's `patternGraph`;
- ordinary KIR relation bodies in `rels`.

The specialized entry pattern is explicit through ordinary KIR-P relation typing.
Relation/input-pattern cache keys and
call-site worklists are local compiler data; they are not part of the
serialized KIR artifact.

- [DOCS/FILE_FORMATS.md](./FILE_FORMATS.md) —
  source, object, library, kVM, and PKIR workflows
- [DOCS/KVM_EXECUTION_MODEL.md](./KVM_EXECUTION_MODEL.md) —
  kVM execution model and bytecode design
- [DOCS/DICTIONARY.md](./DICTIONARY.md) — concept names and terminology
