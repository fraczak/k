# Project Dependency Graph

```mermaid
graph TD
    %% Base styling (no colors)
    classDef default fill:#fff,stroke:#333,stroke-width:2px,color:#000;

    %% High-level API & Execution
    k["k.mjs (2.4 KB)<br/>██"] --> index["index.mjs (1.4 KB)<br/>█"]
    k --> valueParser["valueParser.jison (5.5 KB)<br/>██████"]
    
    repl["repl.mjs (7.2 KB)<br/>███████"] --> index
    repl --> run["run.mjs (3.1 KB)<br/>███"]
    repl --> pretty["pretty.mjs (5.5 KB)<br/>██████"]
    repl --> codes["codes.mjs (8.1 KB)<br/>████████"]
    repl --> compiler["compiler.mjs (3.2 KB)<br/>███"]
    
    index --> parser["parser.jison (11.6 KB)<br/>████████████"]
    index --> Value["Value.mjs (2.1 KB)<br/>██"]
    index --> valueParser
    index --> compiler
    index --> run
    index --> codes

    %% Execution Semantics
    run --> Value

    %% Type Derivation & Compiler
    compiler --> typing["typing.mjs (8.4 KB)<br/>████████"]
    compiler --> codes
    compiler --> Graph["Graph.mjs (2.0 KB)<br/>██"]
    compiler --> hash["hash.mjs (1.1 KB)<br/>█"]
    compiler --> export["export.mjs (5.2 KB)<br/>█████"]
    compiler --> augmentation["augmentation.mjs (5.5 KB)<br/>██████"]
    compiler --> convergence["convergence.mjs (4.6 KB)<br/>█████"]
    
    export --> pretty
    export --> hash
    
    augmentation --> codes
    
    convergence --> pretty

    pretty --> typing
    
    %% Core Registries & Types
    codes --> hash
    typing --> Graph
    typing --> TypeGraph["TypeGraph.mjs (1.5 KB)<br/>██"]
    typing --> unification["unification.mjs (6.2 KB)<br/>██████"]
    typing --> compression["compression.mjs (3.9 KB)<br/>████"]

    compression --> typing

    %% Parsers (Jison dependencies)
    parser --> symbolTable["symbol-table.mjs (2.7 KB)<br/>███"]
    symbolTable --> hash
    
    valueParser --> Value
```
