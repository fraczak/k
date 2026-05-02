# Codec Wire Format Status

This note tracks the current `k-parse | k | k-print` pipeline after the move
to self-hosted binary pattern framing.

## Current Shape

The only wire format is:

```text
encode($pattern_value : $pattern) encode(value : decoded_pattern)
```

where:

- the first segment is a normal k value of type `$pattern`, encoded under the
  fixed singleton pattern for `$pattern` from [`core.k`](../core.k),
- that decoded pattern becomes the structural authority for the second segment,
- the second segment is the prefix-free value payload interpreted by that
  pattern.

Decoding the stream produces a materialized `Value` that carries the decoded
pattern as `value.pattern`. The evaluator propagates the carried pattern, and
encoding uses it by default.

There is no second JSON transport format. Property-list JSON may still appear in
tests or debug output as a readable notation for pattern graphs, but it is not a
codec container and is not accepted at the command boundary.

## Current Pipeline

1. `k-parse`: text value plus optional pattern/type script -> binary pattern+value stream
2. `k`: binary input -> `Value(pattern, tree)` -> evaluate `k` expression -> binary pattern+value stream
3. `k-print`: binary input -> JSON value text

This keeps the evaluator stage free of formatting concerns while staying close
to the new semantic codec model.

When `k-parse` has no explicit input pattern or type, it builds the pattern from
the parsed value tree. Empty nodes become closed products, multi-child nodes
become closed products, and one-child nodes become open unions by default. An
explicit product pattern can force a one-child node to be treated as a singleton
product.

The derived wire pattern is canonicalized by collapsing finite closed
subtrees from the leaves upward, starting at `["closed-product", []]`. Open
pattern nodes remain distinct. This is pattern graph canonicalization, not
value-payload DAG compression.

## Verified Workflow

```bash
echo '["zebara", "ela", "kupa", ala, owca]' | \
  ./codecs/k-parse.mjs | \
  ./k.mjs '{.1 0,.3 1}' | \
  ./codecs/k-print.mjs
```

Expected output:

```json
["ela","ala"]
```

## Open Work

- tighten the pattern/value validation rules,
- add direct coverage for more non-ASCII pattern labels in CLI fixtures,
- extend tests and examples for the prefix codec.

For the semantic design, see:

- [`codecs/README.md`](../codecs/README.md)
- [`codecs/POLYMORPHIC_BINARY_FORMAT.md`](../codecs/POLYMORPHIC_BINARY_FORMAT.md)
