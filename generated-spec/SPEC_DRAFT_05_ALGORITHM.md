# Complete Type Derivation Algorithm

## Input

```
Program = {
  codes: Map<CodeName, CodeDef>,
  representatives: Map<CodeDef, CodeName>,
  rels: Map<RelName, Expression>
}
```

## Output

```
AnnotatedProgram = {
  codes: Map<CodeName, CodeDef>,
  representatives: Map<CodeDef, CodeName>,
  rels: Map<RelName, RelDef>
}

where RelDef = {
  def: AnnotatedExpression,
  typePatternGraph: TypePatternGraph,
  varRefs: Array<VarRef>
}
```

## Algorithm

### Phase 1: Initialization

For each relation `r` in `rels`:

```
1. Create empty TypePatternGraph for r
2. Recursively traverse r.def and:
   a. Create [in, out] pattern pair for each node
   b. Apply local typing rules (see SPEC_DRAFT_04)
   c. Collect varRefs (references to other relations)
3. Store annotated definition
```

### Phase 2: Dependency Analysis

```
1. Build dependency graph G:
   - Vertices: relation names
   - Edges: r1 -> r2 if r1 references r2
   
2. Compute strongly connected components (SCCs)

3. Build SCC DAG:
   - Vertices: SCCs
   - Edges: SCC1 -> SCC2 if any r1 ∈ SCC1 references any r2 ∈ SCC2
   
4. Compute topological order of SCC DAG (bottom-up)
```

### Phase 3: Fixed-Point Iteration

For each SCC in topological order (bottom-up):

```
repeat until convergence (max 10 iterations):
  
  for each relation r in SCC:
    
    // Compress current graph
    r' = compress(r)
    
    // Process each reference to other relations
    for each varRef in r'.varRefs:
      let target = rels[varRef.varName]
      
      // Clone target's input/output patterns into r's graph
      let cloned = target.typePatternGraph.clone(
        [target.def.patterns[0], target.def.patterns[1]],
        r'.typePatternGraph
      )
      
      // Unify with local reference patterns
      r'.typePatternGraph.UNIFY(
        "ref:input " + r.name + "(" + varRef.varName + ")",
        varRef.inputPatternId,
        cloned[target.def.patterns[0]]
      )
      
      r'.typePatternGraph.UNIFY(
        "ref:output",
        varRef.outputPatternId,
        cloned[target.def.patterns[1]]
      )
    
    // Compress again
    rels[r.name] = compress(r')
  
  // Check convergence
  current_state = serialize(SCC relations)
  if current_state == previous_state:
    break
  previous_state = current_state
```

### Phase 4: Canonicalization

For each SCC:

```
1. Compute canonical representation (hash of serialized patterns)
2. Assign canonical names based on hash
3. Update relation aliases
```

## Helper: compress(relDef)

```
compress(relDef):
  1. Clone entire typePatternGraph to new graph
  2. Identify singleton patterns (closed products/unions with no open parents)
  3. Register singletons as new code definitions
  4. Replace singleton patterns with Type nodes
  5. Group patterns by type:
     - Open patterns: ((...), {...}, <...>) each in separate groups
     - Closed patterns: ((), {}, <>) grouped together
     - Type patterns: kept separate
  6. Within each group, compute structural equivalence:
     - Two patterns are equivalent if:
       * Same pattern type
       * Same edge labels
       * Edge destinations are equivalent
  7. Create compressed graph with one node per equivalence class
  8. Remap all pattern IDs in relDef.def and relDef.varRefs
  9. Return compressed relDef

Note: Open unknown patterns (...) are NEVER merged, preserving distinct type variables.
      For example, 10 functions → 20 pattern nodes (input + output).
```

## Helper: serialize(relDef)

```
serialize(relDef):
  1. Traverse relDef.def AST
  2. For each node, collect its [in, out] pattern IDs
  3. For each pattern ID:
     - Find representative
     - Get pattern descriptor
     - Get edge labels and destinations
  4. Return JSON representation
```

## Convergence Criteria

The algorithm converges when:
- For all relations in an SCC, serialize(r) is unchanged after an iteration
- Or maximum iteration count (10) is reached

## Error Handling

Errors can occur during:
1. **Unification**: Incompatible patterns (e.g., `{}` with `<>`)
2. **Type checking**: Reference to undefined relation
3. **Recursion**: Infinite types (optional check)

Error messages should include:
- Source location (line, column)
- Expression type
- Conflicting patterns
- Unification trace (reason chain)

## Complexity

- **Time**: O(N × I × U) where:
  - N = total AST size
  - I = iterations per SCC (≤ 10)
  - U = unification cost (depends on graph size)
  
- **Space**: O(N × P) where:
  - N = total AST size
  - P = average patterns per node (typically small after compression)

## Optimizations

1. **Early termination**: Check convergence after each relation, not just SCC
2. **Incremental compression**: Only compress when graph grows significantly
3. **Memoization**: Cache cloned subgraphs for repeated references
4. **Lazy edge creation**: Only create edges when needed by unification
