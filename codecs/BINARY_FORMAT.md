# Binary Packaging Notes

This document no longer defines the active codec semantics.

The active format is the self-hosted pattern-plus-prefix-tree stream described
in [`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md):

```text
encode($pattern_value : $pattern) encode(value : decoded_pattern)
```

## Purpose Of This File

This file records constraints for any future optimized container layered above
the canonical stream.

The design sequence is:

1. define the abstract pattern graph,
2. define prefix-free value-tree encoding relative to that graph,
3. encode the pattern itself as a k `$pattern` value,
4. optionally add higher-level indexes or compression as separate layers.

## Expected Container Shape

The canonical stream contains:

```text
encoded-$pattern + value-bitstream
```

where:

- `encoded-$pattern` is the k value representation defined in `core.k`,
- the value bitstream is exactly the same prefix-free payload described by the
  semantic codec.

## Non-Goals

This future binary package should not redefine the semantic codec.

In particular, it should not introduce as part of the base semantics:

- byte-oriented node tables,
- mandatory DAG encoding,
- transport-driven structural compromises.

Those are explicitly outside the target architecture of the rewrite.

## Current Format

The working concrete format is the canonical stream above. JSON property-list
patterns are debug notation only, not a transport container.
