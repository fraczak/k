# Pattern Graph Convergence Detection

## Objective

Develop an algorithm to determine when pattern graphs have reached semantic equivalence during fixed-point iteration, replacing the current flawed serialization-based approach.

## Problem Statement

Current approach uses `relDefToString()` serialization which:
- Only captures partial graph state
- Misses structural changes that don't affect serialization
- Fails to detect true convergence (e.g., `bnat.k` examples)
- Cannot detect divergence patterns

## Semantic Equivalence Definition

Two pattern graphs G₁ and G₂ are semantically equivalent if:
1. **Bisimilar structure**: Same reachable pattern relationships
2. **Equivalent constraints**: Same type constraints at corresponding nodes
3. **Identical edge semantics**: Same field/tag relationships

## Approach 1: Graph Isomorphism with Canonical Forms

**Idea**: Compute canonical representation of pattern graph structure

**Algorithm**:
```text
canonical_form(graph):
  1. Build quotient graph on representatives only
  2. Compute canonical node ordering (e.g., by pattern signature)
  3. Generate canonical adjacency representation
  4. Include pattern descriptors in canonical order
```

**Pros**: Mathematically sound, detects true equivalence
**Cons**: Potentially expensive for large graphs

## Approach 2: Incremental Change Detection

**Idea**: Track what actually changes during unification

**Algorithm**:
```text
track_changes(before_unify, after_unify):
  1. Record new unifications performed
  2. Track edge additions/modifications
  3. Monitor pattern descriptor changes
  4. Converged = no changes recorded
```

**Pros**: Efficient, directly tracks meaningful changes
**Cons**: Requires careful change tracking implementation

## Approach 3: Fixpoint Witnesses

**Idea**: Maintain "witness" patterns that must stabilize for convergence

**Algorithm**:
```text
witness_convergence(scc_functions):
  1. Identify key patterns: function inputs/outputs, recursive call sites
  2. Track witness pattern evolution across iterations
  3. Converged = all witnesses unchanged
```

**Pros**: Focuses on semantically important patterns
**Cons**: May miss subtle but important changes

## Divergence Detection

**Objective**: Detect when iteration will not converge within reasonable bounds

**Indicators**:
1. **Pattern growth**: Unbounded increase in pattern complexity
2. **Cycle detection**: Repeating states with systematic changes
3. **Constraint accumulation**: Ever-growing constraint sets

**Algorithm**:
```text
detect_divergence():
  1. Track pattern graph "size" metrics over iterations
  2. Detect periodic behavior in graph evolution
  3. Monitor constraint complexity growth
  4. Trigger early termination with partial results
```

## Recommended Hybrid Approach

**Phase 1**: Incremental change detection (fast path)
**Phase 2**: Canonical form comparison (when changes detected)
**Phase 3**: Divergence detection (after N iterations)

```text
convergence_check(prev_graph, curr_graph, iteration):
  if no_tracked_changes():
    return CONVERGED
  
  if iteration > DIVERGENCE_THRESHOLD:
    if detect_divergence_pattern():
      return DIVERGED
  
  if canonical_form(prev_graph) == canonical_form(curr_graph):
    return CONVERGED
  
  return CONTINUE
```

## Implementation Priorities

1. **Canonical form computation** for pattern graphs
2. **Change tracking** during unification operations  
3. **Divergence metrics** and pattern detection
4. **Graceful degradation** when convergence fails

## Success Criteria

- Correctly detect convergence in `bnat.k` examples
- Identify divergence cases early
- Maintain performance for typical cases
- Provide meaningful diagnostics for non-convergent cases