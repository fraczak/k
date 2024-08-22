
import hash from "./hash.mjs";
import { TypePatternGraph } from "./typing.mjs";
import { Graph, sccs, topoOrder } from "./Graph.mjs";

const unitCode = hash('$C0={};'); 

function patterns(codes, representatives, rels) {
  // INPUT: 
  //   codes: {"BG": {"code": "product", "product": {}}, ...}
  //   representatives:{"{}": "BG", ...}
  //   rels: {"rlz": [{op: comp,...}, ...], ...}
 

  // 1 INITIALIZATION
  // 1.1 initialize patternNodes and rels

  function augment(rel, rootDef) {
    try {
      switch (rel.op) {
        case "product":
          rel["product"].forEach(({label, exp}) => {
            augment(exp, rootDef)
          });
          augmentProduct(rel,rootDef);
          break;
        case "union":
          rel["union"].forEach((exp) => {
            augment(exp,rootDef);
          });
          augmentUnion(rel,rootDef);
          break;
        case "comp":
          rel["comp"].forEach((exp) => {
            augment(exp,rootDef);
          });
          augmentComp(rel,rootDef);
          break;
        case "vector":
          rel["vector"].forEach((exp) => {
            augment(exp,rootDef);
          });
          augmentVector(rel,rootDef);
          break;
        case "code":
          rel["code"] = representatives[rel.code] || rel.code;
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.getTypeId(rel["code"]);
          rel.patterns[1] = rel.patterns[0]; 
          break;
        case "caret":
          augment(rel.caret,rootDef);
          rel.patterns = [
            rel.caret.patterns[0],
            rootDef.typePatternGraph.addNewNode(
              {pattern: '[]'}, 
              {"vector-member": [rel.caret.patterns[1]]})
          ];
          break;
        case "pipe":
          rel.patterns = [];
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode(
            {pattern: '[]'}, 
            {"vector-member": [rel.patterns[1]]});
          break;

        case "ref":
            augmentRef(rel, rootDef);
            break;
          //----------------
        
        case "int":
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[1] = rootDef.typePatternGraph.getTypeId('int');
          break;
        case "str":
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[1] = rootDef.typePatternGraph.getTypeId('string');
          break;
        case "identity":
          rel.patterns = [];
          rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
          break;
        case "dot":
          rel.patterns = [];
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '(...)'}, { [rel.dot]: [rel.patterns[1]] }); 
          break;
        
        default:
          console.error("NOT EXPECTED OP:", rel);
          break;
      }
    } catch (e) {
      console.error(`Code Derivation Error for '${rel.op}' (lines ${rel.start?.line}:${rel.start?.column}...${rel.end?.line}:${rel.end?.column}): ${e.message}.`);
      throw e;
    }   
  }

  function augmentProduct(rel,rootDef) {
    rel.patterns = [];
    switch (rel.product.length) {
      case 0: 
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId(unitCode);
        break;
      case 1:
        // union/variant constructor:  %old_i { %exp_i exp %exp_o field } %old_o 
        rel.patterns[0] = rel.product[0].exp.patterns[0];
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '<...>'}, 
          {[rel.product[0].label]: [rel.product[0].exp.patterns[1]]});
        break;
      default:
        // product constructor %old_i { %exp0_i exp0 %exp0_o field0, ... %expk_i expk %expk_o fieldk } %old_o
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rootDef.typePatternGraph.unify(
          "product:input",
          rel.patterns[0], 
          ...rel.product.map(({exp}) => exp.patterns[0]));
        
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '{}'},
          rel.product.reduce((edges, {label, exp}) => {
            edges[label] = [exp.patterns[1]];
            return edges;
          }, {})
        );
    };
  }
  
  function augmentUnion(rel,rootDef) {
    rel.patterns = [];
    if (rel.union.length == 0) {
      rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
      rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '<>'}); 
    } else {
      rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
      rootDef.typePatternGraph.unify(
        "union:input",
        rel.patterns[0],
        ...rel.union.map(exp => exp.patterns[0]));
      
      rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
      rootDef.typePatternGraph.unify(
        "union:output",
        rel.patterns[1],
        ...rel.union.map(exp => exp.patterns[1]));
    }
  }

  function augmentComp(rel,rootDef) {
    rel.patterns = [];
    if (rel.comp.length == 0) { 
      rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
    } else {

      for (let i = 0; i < rel.comp.length - 1; i++) {
        rootDef.typePatternGraph.unify(
          "comp:chain",
          rel.comp[i].patterns[1],
          rel.comp[i+1].patterns[0]
        );
      }

      rel.patterns[0] = rel.comp[0].patterns[0];  
      rel.patterns[1] = rel.comp[rel.comp.length - 1].patterns[1];
    }
  }

  function augmentVector(rel,rootDef) {
    rel.patterns = []; 
    rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
    rootDef.typePatternGraph.unify(
      "vector:input",
      rel.patterns[0],
      ...rel.vector.map(exp => exp.patterns[0]));
      
    let member = rootDef.typePatternGraph.addNewNode();
    rootDef.typePatternGraph.unify(
      "vector:output",
      member,
      ...rel.vector.map(exp => exp.patterns[1])
    );
    rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [member]});
  }

  function augmentRef(rel,rootDef) { 
    rel.patterns = [];
    if (rel.ref in rels) {
      rootDef.varRefs.push(rel);
      rel.patterns = [rootDef.typePatternGraph.addNewNode(), rootDef.typePatternGraph.addNewNode()];
      return;
    }
    // it is built-in
    switch (rel.ref) {
      case "_log!":
        rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
        break;
      case "true": 
      case "false":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('bool');
        break;
      case "PLUS":
      case "TIMES": 
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('int');
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rel.patterns[1]]});
        break;
      case "CONCAT":
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('string');
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rel.patterns[1]]});
        break;
      case "toDateMsec":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('int');
        break;
      case "toJSON":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('string');
        break;
      case "toDateStr":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('string');
        break;
      case "GT":
      case "EQ":  
        rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rootDef.typePatternGraph.addNewNode()]});
        break;
      case "fromJSON":
        rel.patterns[0] = rootDef.typePatternGraph.getTypeId('string');
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
        break;
      case "CONS": {
        let member = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [member]});
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '{}'}, {"0": [member], "1": [rel.patterns[1]]});
        break;
      }
      // TO DO
      case "null":
      case "DIV":
      case "FDIV":
      case "SNOC":
        rel.patterns = [rootDef.typePatternGraph.addNewNode(), rootDef.typePatternGraph.addNewNode()];
        break;
      default:
        throw new Error(`No definition found for ${rel.ref}`);  
    }
  }  

  // 1. Initialize the typePatternGraph and varRefs for each relation

  for (const relName in rels) {
    const rootDef = rels[relName];
    rootDef.typePatternGraph = new TypePatternGraph(codes);
    rootDef.varRefs = []; // the list of non-built references as pointers to AST nodes
    augment(rootDef.def, rootDef);
  }
   
  
  // 2. Compute DAG of strongly connected components in varRefs
  //    A rel_1 -> rel_2 if rel1,varRefs contains a reference to {op: "ref", ref: rel_2}
  
  const graph = new Graph(
    // 1st argument: edges
    [].concat(...Object.keys(rels).map( relName => 
      rels[relName].varRefs.map(({ref}) => 
        ({src: relName, dst: ref})))),
    // 2nd argument: vertices
    rels
  );

  const sccs_ = sccs(graph);

  const DAGnodes = sccs_.reduce ((nodes, scc) => 
    ({...nodes, [scc[0]]: {scc}}), {});
  const fromRelNameToDAGnode = Object.keys(DAGnodes).reduce((map, node) =>
    DAGnodes[node].scc.reduce((map, relName) => ({...map, [relName]: node}), map), {});
  const DAGedges = [].concat(
    ...Object.keys(rels).map( x =>
      rels[x].varRefs.map(({ref}) => 
        ({src: fromRelNameToDAGnode[x], dst: fromRelNameToDAGnode[ref]})
      ) // don't forget to remove loops
      .filter(({src, dst}) => src !== dst )
    )
  );
  const DAG = new Graph(DAGedges, DAGnodes);

  // 3. Topological sort of the DAG

  const sccInOrder = topoOrder(DAG);

  // 4. For each strongly connected component C in a bottom-up order

  for (const scc of sccInOrder.reverse()) {
    console.log(`SCC[${scc}]: { ${DAGnodes[scc].scc} }`);
    
    //    4.1 For every r in C, compute the new typePatternGraph of r, i.e.:
    for(const relName of DAGnodes[scc].scc) {
      //        - find singleton 'patterns'
      const { def, typePatternGraph, varRefs } = rels[relName];
      typePatternGraph.turnSingletonPatternsIntoCodes();

      //        - merge those codes into the typePatternGraph
      //        - compress the typePatternGraph

    }

  //    4.2 For every r in C, and for every reference to x in varRefs, clone the typePatternGraph of x
  //        into the typePatternGraph of r
  //    4.3 Redo step 4.1 for every r in C
  //    4.3 If any of the typePatternGraphs of r has changed, got to 4.2
 
  }

  let changed = true;
  let count = 0;
  let count_max = 2;
  while (changed) {  
    changed = false;
    if (count_max > count) { 
      count++;
      console.log(` * Inspecting count: ${count}/${count_max}`);   
      for (const relName in rels) {
        const { def, typePatternGraph, varRefs } = rels[relName];
        console.log  (`    -- relation: ${relName}...`);
        for (let i = 0; i < varRefs.length; i++) {
          // console.log(`       - calling: ${varRefs[i].ref} [${i}]`);
          let varRel = varRefs[i];
          let varName = varRel.ref;
          try {
            let varRootDef = rels[varName];
            let varInputPatternId = varRootDef.typePatternGraph.find(varRootDef.def.patterns[0]);
            let varOutputPatternId = varRootDef.typePatternGraph.find(varRootDef.def.patterns[1]);
            let cloned = varRootDef.typePatternGraph.clone([varInputPatternId, varOutputPatternId], typePatternGraph);
            let aux_changed = !!(
              typePatternGraph.unify(
                "ref:input",
                varRel.patterns[0],
                cloned[varInputPatternId])
              |
              typePatternGraph.unify(
                "ref:output",
                varRel.patterns[1],
                cloned[varOutputPatternId]));
            changed = changed || aux_changed;
            let newInputPatternId = typePatternGraph.find(varRel.patterns[0]);
            let newOutputPatternId = typePatternGraph.find(varRel.patterns[1]);
          //   console.log(`        changed flag?: ${aux_changed}`);
          //   console.log(`        ${varRefs[i].ref}.patterns[0]: ${JSON.stringify(typePatternGraph.get_pattern(newInputPatternId))}`);
          //   console.log(`        ${varRefs[i].ref}.patterns[1]: ${JSON.stringify(typePatternGraph.get_pattern(newOutputPatternId))}`);
          //   // let g = new TypePatternGraph();
          //   // typePatternGraph.clone([newInputPatternId,newOutputPatternId], g);
          //   // console.log(JSON.stringify(g, null, 2));
          //   console.log(`        * ${relName}.patterns[0]: ${JSON.stringify(typePatternGraph.get_pattern(def.patterns[0]))}`);
          //   console.log(`        * ${relName}.patterns[1]: ${JSON.stringify(typePatternGraph.get_pattern(def.patterns[1]))}`);
          // //  console.log(JSON.stringify(typePatternGraph, null, 2));
          //   console.log("---------------------------------------------------");
          } catch (e) {
            console.error(`Type Error in call to ${varName} in definition of ${relName}: lines ${varRel.start?.line}:${varRel.start?.column}...${varRel.end?.line}:${varRel.end?.column}): ${e.message}.`);
      
            throw e;
          }
        }
      }
    } else 
      console.log("Done...");
  }

}



export default { patterns };
export { patterns };

