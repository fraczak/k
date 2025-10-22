---
title: "k-language"
author: "W. Fraczak"
---

<div align="center">

```
      { }                         { }
     /   \       {.lang name}      |
   lang   by          -->         name
    |      |                       |
   'k'  'wojtek'                  'k'
```

</div>

# The k-language Book

This book describes the k programming language - a minimal functional language for transforming tree-structured data using partial functions and algebraic data types.

## Table of Contents

1. [Introduction](book/01-introduction.md)
2. [Syntax and Values](book/02-syntax-and-values.md)  
3. [Types as Finite Automata](book/03-types-as-finite-automata.md)
4. [Partial Functions and Composition](book/04-partial-functions-and-composition.md)
5. [Typing, Filters, and Normalization](book/05-typing-filters-and-normalization.md)
6. [Values in Memory](book/06-values-in-memory.md)
7. [The Partial Function ABI](book/07-the-partial-function-abi.md)
8. [Operational Semantics and Execution](book/08-operational-semantics-and-execution.md)
9. [Compiler Architecture](book/09-compiler-architecture.md)
10. [From AST to Intermediate Representation](book/10-from-ast-to-intermediate-representation.md)
11. [LLVM Basics](book/11-llvm-basics.md)
12. [Code Generation](book/12-code-generation.md)
13. [Linking and Execution](book/13-linking-and-execution.md)
14. [Canonical Serialization](book/14-canonical-serialization.md)
15. [Optimization and Folding](book/15-optimization-and-folding.md)
16. [Toward a Universal Schema Registry](book/16-toward-a-universal-schema-registry.md)

## Appendices

- [Appendix A: Implementing a Prototype Compiler in Python](book/appendix-a-implementing-a-prototype-compiler-in-python.md)
- [Appendix B: Incorporating External Predefined Types and Functions](book/appendix-b-incorporating-external-predefined-types-and-functions.md)

---

*Note: This is the master file. Individual chapters are stored in the `book/` directory for easier editing and maintenance. Each chapter can be edited independently and the changes will be reflected when the individual files are viewed.*

## Usage

- **For reading**: Click on any chapter link above to read individual chapters
- **For editing**: Edit the individual chapter files in the `book/` directory
- **For publishing**: Combine chapters as needed for different output formats
