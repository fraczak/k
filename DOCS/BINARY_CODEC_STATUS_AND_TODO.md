# Codec Envelope Status

This note tracks the current `k-parse | k | k-print` pipeline after the move to
the new JSON bootstrap envelope.

## Current Shape

All three stages communicate using:

```json
{
  "pattern": [...],
  "value_bits": "..."
}
```

where:

- `pattern` is the canonical property-list pattern graph,
- `value_bits` is the prefix-free value payload carried as a compact string.

## Current Pipeline

1. `k-parse`: text value plus optional pattern/type script -> JSON envelope
2. `k`: JSON envelope -> evaluate `k` expression -> JSON envelope
3. `k-print`: JSON envelope -> JSON value text

This keeps the evaluator stage free of formatting concerns while staying close
to the new semantic codec model.

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
- decide the final compact self-hosted envelope that may replace the JSON
  bootstrap transport,
- extend tests and examples for the prefix codec.

For the semantic design, see:

- [`codecs/README.md`](../codecs/README.md)
- [`codecs/POLYMORPHIC_BINARY_FORMAT.md`](../codecs/POLYMORPHIC_BINARY_FORMAT.md)
