# Formal Data Structures Specification

## 1. Pattern Descriptors

A **Pattern** is one of:

```
Pattern ::= Open(Constructor, FieldSet)
         |  Closed(Constructor, FieldSet)  
         |  Type(CodeName)

Constructor ::= Product | Union | Unknown

FieldSet ::= Set<Label>

Label ::= String
CodeName ::= String
```

### Pattern Notation

- `(...)` = `Open(Unknown, {})`
- `{...}` = `Open(Product, {})`
- `<...>` = `Open(Union, {})`
- `()` = `Closed(Unknown, {})`
- `{}` = `Closed(Product, {})`
- `<>` = `Closed(Union, {})`
- `type` = `Type(codeName)`

When a pattern has fields, they are tracked in the FieldSet and represented as edges in the graph.

## 2. Type Pattern Forest

```
TypePatternForest ::= {
  nodes: Array<Pattern>,
  parent: Array<Optional<NodeId>>
}

NodeId ::= Natural
```

**Operations:**
- `find(id: NodeId) -> NodeId` - find representative (root) of equivalence class
- `addNode(pattern: Pattern) -> NodeId` - create new node
- `addChildren(parent: NodeId, children: Set<NodeId>)` - set parent pointers

**Invariant:** The parent relation forms a forest (no cycles).

## 3. Type Pattern Graph

```
TypePatternGraph ::= {
  patterns: TypePatternForest,
  edges: Array<EdgeMap>,
  codeId: Map<CodeName, NodeId>
}

EdgeMap ::= Map<Label, Set<NodeId>>
```

**Operations:**
- `find(id: NodeId) -> NodeId` - delegate to patterns.find
- `get_pattern(id: NodeId) -> Pattern` - get pattern of representative
- `addNewNode(pattern: Pattern, edges: EdgeMap) -> NodeId`
- `getTypeId(codeName: CodeName) -> NodeId` - get or create type node
- `unify(reason: String, ids: Set<NodeId>)` - merge equivalence classes
- `clone(roots: Set<NodeId>, target: TypePatternGraph) -> Map<NodeId, NodeId>`

## 4. AST with Annotations

```
Expression ::= Ref(name: String)
            |  Comp(exprs: Array<Expression>)
            |  Product(fields: Array<(Label, Expression)>)
            |  Union(exprs: Array<Expression>)
            |  Dot(label: Label)
            |  Div(tag: Label)
            |  Vid(tag: Label)
            |  Identity
            |  Code(codeName: CodeName)
            |  Filter(pattern: FilterPattern)

AnnotatedExpression ::= {
  expr: Expression,
  patterns: [NodeId, NodeId]  // [input, output]
}
```

## 5. Program Context

```
Program ::= {
  codes: Map<CodeName, CodeDef>,
  representatives: Map<CodeDef, CodeName>,
  rels: Map<RelName, RelDef>
}

RelDef ::= {
  def: AnnotatedExpression,
  typePatternGraph: TypePatternGraph,
  varRefs: Array<VarRef>
}

VarRef ::= {
  varName: String,
  inputPatternId: NodeId,
  outputPatternId: NodeId
}

CodeDef ::= Product(Map<Label, CodeName>)
         |  Union(Map<Label, CodeName>)
```

## 6. Algorithm State

During execution, the algorithm maintains:

```
State ::= {
  program: Program,
  sccGraph: DAG<Set<RelName>>,
  iteration: Natural
}
```

The SCC graph represents dependencies between strongly connected components of relation definitions.
