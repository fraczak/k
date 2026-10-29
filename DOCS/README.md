# Documentation

Start with [Getting started](GETTING_STARTED.md) for a complete walkthrough,
or [try the browser REPL](https://fraczak.github.io/k/).

## Language and tools

| Guide | Contents |
| --- | --- |
| [Patterns and relations](PATTERNS.md) | Core syntax, filters, named patterns, scope, and canonical identity |
| [REPL](REPL.md) | Session state, loading, codecs, engines, and exports |
| [File formats and tools](FILE_FORMATS.md) | Source, objects, libraries, kVM, PKIR, and CLI workflows |
| [Textual values](TEXTUAL_VALUES.md) | Boundary notation and singleton product/variant ambiguity |
| [Writing codecs](CODECS.md) | Codec module contract and a complete example |
| [Wire format](../codecs/WIRE_FORMAT.md) | Pattern framing and binary payload encoding |
| [Glossary](DICTIONARY.md) | The vocabulary used in these guides |

The published [paper](https://zenodo.org/records/23652382) has a
[local PDF](../paper/k-paper.pdf) and [LaTeX source](../paper/k-paper.tex).

## Implementation

- [Compiler and runtime](ARCHITECTURE.md)
- [Contract derivation](TYPE_DERIVATION.md)
- [KIR-P export](KIR_V1.md)
- [kVM execution](KVM_EXECUTION_MODEL.md)
- [PKIR and layout witnesses](POLYMORPHIC_IR.md)
- [Profiling and benchmarks](PROFILING_AND_TRACING.md)
- [WebAssembly backend](../backends/wasm/README.md)
- [LLVM backend](../backends/llvm/README.md)

For contributions, read [AGENTS.md](../AGENTS.md) and the
[test guide](../tests/README.md). Editor setup is documented in the
[VS Code extension](../k-vscode/README.md); release history is in
[CHANGELOG.md](../CHANGELOG.md).
