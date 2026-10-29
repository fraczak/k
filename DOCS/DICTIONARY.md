# Glossary

These terms are used throughout the [documentation](README.md).

| Term | Meaning |
| --- | --- |
| **Relation** | A first-order partial function transforming one input value into one output value, or returning undefined. |
| **Product** | A value with labeled fields. A product expression applies every field relation to the same input. |
| **Variant** | One tag and its payload. A union schema lists possible tags; `\|tag` constructs a variant. |
| **Unit** | The empty product `{}`. |
| **Ordered choice** | `<f, g, ...>` tries relations in source order, selecting the first defined result. |
| **Schema** | A structural description of products and tagged unions, possibly recursive. |
| **Pattern** | A graph of schema constraints, including open positions and shared variables. Closed, fully determined patterns describe concrete schemas. |
| **Filter** | A relation `?P` that constrains the schema and leaves the payload unchanged. |
| **Named pattern** | A template declared as `name[A, ...] = P;` and instantiated as `name[argument, ...]`. |
| **Knot** | A binding `P = X` that makes occurrences of `X` refer back to a node in a recursive pattern. |
| **Envelope** | The pattern carried with a runtime payload. An enveloped value is the pair `(pattern, payload)`. |
| **Contract** | The input/output pattern graph derived for a relation. Shared nodes express shared schema constraints; they do not alone establish payload identity. |
| **Canonical skeleton** | The normalized structure of a named pattern with a separate port for each open leaf position. |
| **Routing vector** | Arguments connecting caller parameters, repeated variables, and wildcards to a canonical skeleton's ports. |
| **Content hash** | The `@hash` of a normalized definition. Named-pattern constraints also depend on their routing arguments. |
| **Alias** | A local friendly name for a canonical relation or pattern. |
| **Wire stream** | The binary representation of an envelope followed by a payload encoded under it. |
| **Codec** | A translator between an external representation and enveloped k values. |
| **Contract derivation** | Compiler propagation and unification of pattern constraints, with fixed-point iteration for recursive relation groups. |
| **Specialization** | Adapting a relation or execution artifact to a particular input envelope. The KIR-P and kVM passes use different mechanisms. |
| **Partial failure** | Ordinary undefinedness during execution, distinct from a schema contradiction or system error. |
| **Object / library** | Stored compiled definitions: `.ko` has an entry relation; `.klib` has no main entry. |
| **KIR-P** | Portable relation and pattern export from compiled objects. |
| **kVM** | Register-based execution representation, with polymorphic templates and specialized artifacts. |
| **PKIR** | A separate experimental representation using schema states and layout witnesses for structural access. |

A contract's input pattern is a static constraint, not necessarily the exact
mathematical domain of the relation. A relation can be undefined for values
whose schemas satisfy that constraint.

Canonicalization normalizes structural graphs; the implementation does not
provide general semantic equality of programs. For patterns, distinguish the
canonical skeleton from the routing constraints of an alias.

See [patterns](PATTERNS.md), [file formats](FILE_FORMATS.md), and
[compiler architecture](ARCHITECTURE.md) for the corresponding details.
