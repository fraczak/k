# Binary Packaging Notes

This document no longer defines the active codec semantics.

The active target is the abstract pattern-plus-prefix-tree design described in
[`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md).

## Purpose Of This File

This file records the intended direction for a future compact binary container
once the new semantics are stable.

The design sequence is:

1. define the abstract pattern graph,
2. define prefix-free value-tree encoding relative to that graph,
3. bootstrap with a JSON envelope,
4. later encode the same objects in a compact binary package.

## Expected Container Shape

A future binary package will likely contain:

```text
pattern-representation + value-bitstream
```

where:

- the pattern representation encodes the same abstract graph as the JSON
  `pattern` property,
- the value bitstream is exactly the same prefix-free payload described by the
  semantic codec.

## Non-Goals

This future binary package should not redefine the semantic codec.

In particular, it should not introduce as part of the base semantics:

- byte-oriented node tables,
- mandatory DAG encoding,
- transport-driven structural compromises.

Those are explicitly outside the target architecture of the rewrite.

## Current Bootstrap

Until a compact binary package is designed, the working concrete format is:

```json
{
  "pattern": [...],
  "value_bits": "..."
}
```

That JSON envelope is the canonical bootstrap container for the new rewrite.
