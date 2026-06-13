# KIR v1

KIR v1 is the first backend-facing JSON view of compiled k objects. It is an
inspection and export contract, not a replacement for the current `.ko` and
`.klib` containers.

The first layer is **KIR-P**, the portable polymorphic relation format. KIR-P
keeps the same pattern-carrying semantics as current object execution, but
normalizes names and graph IDs so backends can consume object contents without
depending on parser-shaped fields or `TypePatternGraph` internals.

## Scope

KIR v1 defines:

- a JSON-safe view over current `.ko` and `.klib` payloads;
- relation input and output pattern roots;
- a closed expression opcode vocabulary;
- dense per-relation pattern graph IDs;
- relation type-derivation status;
- object aliases, metadata, compile statistics, and code table pass-through.

KIR v1 does not define:

- KIR-R retyping output;
- KIR-M layout and ABI decisions;
- LLVM, Wasm, C, or native runtime layout;
- a new stored object format.

## Top-Level Shape

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
- `codes`, `relAlias`, `compileStats`, and `meta` preserve the current object
  payload content, sorted for stable inspection.
- KIR consumers must not infer backend eligibility from the top level alone.
  Each relation has its own `typeDerivation.status`.

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
- LLVM and optimized Wasm backends should reject relations whose status is not
  `converged`, unless they intentionally implement an envelope-aware reference
  mode.
- `sourceNodeMap` maps original object pattern graph representative IDs to KIR
  node IDs. It exists for inspection and debugging, not as a semantic contract.

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

Type nodes carry a code hash:

```json
{ "id": 2, "kind": "type", "code": "@..." }
```

Rules:

- Edge labels are sorted lexically.
- Parallel edges are represented as repeated edge records with the same label
  and different targets.
- Edge targets always name nodes in the same relation pattern graph.
- The graph is already union-find-normalized; KIR consumers should use KIR node
  IDs directly.

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
- `product.fields` preserve the relation body field list. Backends may sort or
  lay out fields later only after preserving observable semantics.
- `filter.filter` currently preserves the stored filter tree. A later KIR
  revision may normalize filter internals.

## Current Tooling

Use `k-inspect-object --kir` to print the KIR-P view:

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
graphs through the normal object loader, and exports KIR-P JSON.

## Backend Path

The intended backend pipeline remains:

```text
k source
  -> .ko / .klib object
  -> KIR-P
  -> KIR-R retyped for an input envelope
  -> KIR-M / kVM
  -> LLVM / Wasm / C / other backend
```

KIR-P is the shared semantic object contract. KIR-R and KIR-M are separate
contracts and should not be encoded by overloading KIR-P fields.
