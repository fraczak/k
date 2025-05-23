
import hash from "./hash.mjs";
import { TypePatternGraph } from "./typing.mjs";
import { Graph, sccs, topoOrder } from "./Graph.mjs";
import codes from "./codes.mjs";
import { Bits } from "./bits.mjs";
import { assignCanonicalNames } from "./export.mjs";

const unitCode = codes.unitCode;

function relDefToString(relDef) {
  const start = new Date().getTime();
  const dumpPatterns = (rel) => {
    switch (rel.op) {
      case "product":
        return [].concat(rel.patterns, ...rel.product.map(({exp}) => dumpPatterns(exp)));
      case "union":
        return [].concat(rel.patterns, ...rel.union.map(exp => dumpPatterns(exp)));
      case "comp":
        return [].concat(rel.patterns, ...rel.comp.map(exp => dumpPatterns(exp)));
      case "vector":
        return [].concat(rel.patterns, ...rel.vector.map(exp => dumpPatterns(exp)));
      case "caret":
        return [].concat(rel.patterns, dumpPatterns(rel.caret));
      case "ref":
      case "int":
      case "str":
      case "bits":
      case "identity":
      case "dot":
      case "div":
      case "times":
      case "code":
      case "pipe":  
      case "filter":
        return [...rel.patterns]; 
    }
    throw new Error("NOT EXPECTED OP:", JSON.stringify(rel, null, 2));
  };

  // console.log("SIZE", relDef.typePatternGraph.size());
  // console.log(relDef.typePatternGraph.patterns.nodes);
  // console.log(relDef.typePatternGraph.edges);
  // console.log(relDef.def);
  
  const result = JSON.stringify(dumpPatterns(relDef.def).map((x) => {
    const { pattern, fields, type} = relDef.typePatternGraph.get_pattern(x);
    return {pattern, fields, type};
  }));

  let took = new Date().getTime() - start;
  if (took > 200) {
    console.log(` -- RelDefToString: size=${result.length}, took ${took} msecs`);
  }
  return result;
}

function compactRel(relDef, name = "") {
  const start = new Date().getTime();
  const {def, typePatternGraph, varRefs } = relDef;
  // console.log("COMPACTING typePatternGraph of size", typePatternGraph.size());

  const {typePatternGraph : newTypePatternGraph, remapping: renumbering}  = typePatternGraph.getCompressed();

  const copyRel = (rel) => {
    const newRel = {...rel, patterns:[renumbering[rel.patterns[0]], renumbering[rel.patterns[1]]]};
    switch (rel.op) {
      case "product":
        newRel.product = rel.product.map(({label, exp}) => ({label, exp: copyRel(exp)}));
        break;
      case "union":
        newRel.union = rel.union.map(exp => copyRel(exp));
        break;
      case "comp":
        newRel.comp = rel.comp.map(exp => copyRel(exp));
        break;
      case "vector":
        newRel.vector = rel.vector.map(exp => copyRel(exp));
        break;
      case "caret":
        newRel.caret = copyRel(rel.caret);
        break;
      case "ref":
      case "int":
      case "str":
      case "bits":
      case "identity":
      case "dot":
      case "div":
      case "times":
      case "code":
      case "pipe":
      case "filter":
        break;
      default:
        console.error("NOT EXPECTED OP:", JSON.stringify(rel, null, 2));
        break;
    };
    return newRel;
  };
  const newDef = copyRel(def);
  const newVarRefs = varRefs.map(x => ({
    ...x,
    inputPatternId: renumbering[x.inputPatternId],
    outputPatternId: renumbering[x.outputPatternId]
  }));;
    
  const time = new Date().getTime() - start;
  if (time > 500 ) {
    console.log(`[${new Date().getTime() - start} msecs] - COMPACTED ${name}.typePatternGraph [${typePatternGraph.size()}->${newTypePatternGraph.size()}]`);
  }
  return {def: newDef, typePatternGraph: newTypePatternGraph, varRefs: newVarRefs};
}

function patterns(representatives, rels) {
  // INPUT: 
  //   codes: {"KL": {"code": "product", "product": {}}, ...}
  //   representatives:{"{}": "KL", ...}
  //   rels: {"rlz": [{op: comp,...}, ...], ...}
 
  const relAlias = {};

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
          rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@int');
          break;
        case "str":
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@string');
          break;
        case "bits":
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@bits');
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
        case "div":
        case "times": {
          let arg = rel.div || rel.times;
          rel.patterns = [];
          if (arg instanceof Bits) {
            rel.patterns[0] = rootDef.typePatternGraph.getTypeId('@bits');
            rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@bits');
          } else { /* it must be String, i.e. typeof arg == 'string' or arg instanceof Strig */
            rel.patterns[0] = rootDef.typePatternGraph.getTypeId('@string');
            rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@string');
          } 
          break;
        }
        
        case "filter":
          rel.patterns = [];
          rel.patterns[1] = rel.patterns[0] = filterToPattern(rel.filter, rootDef);
          break;
        default:
          console.error("NOT EXPECTED OP for augmentation:", JSON.stringify(rel, null, 2));
          break;
      }
    } catch (e) {
      e.message = `Type Error in '${rel.op}' (lines ${rel.start?.line}:${rel.start?.column}...${rel.end?.line}:${rel.end?.column})\n - ${e.message}`;
      throw e;
    }   
  }

  function filterToPattern(filter, rootDef) {
    const context = rootDef.patternVars;
    const getFields = () => 
      Object.keys(filter.fields || {}).reduce( (fields, label) => {
        const patternId = filterToPattern(filter.fields[label], rootDef);
        fields[label] = [patternId];
        return fields;
      }, {});
    if (filter.name && ! (filter.name in context)) {
      context[filter.name] = rootDef.typePatternGraph.addNewNode();
    }
    let newPatternId = null;
    switch (filter.type) {
      case "name":
        newPatternId = context[filter.name];
        break;
      case "code":
        newPatternId = rootDef.typePatternGraph.getTypeId(representatives[filter.code] || filter.code);
        break;
      case "union":
        newPatternId = rootDef.typePatternGraph.addNewNode(
          {pattern: filter.open ? '<...>' : '<>', fields:Object.keys(filter.fields || {})},
          getFields());
        break;
      case "product": 
        newPatternId = rootDef.typePatternGraph.addNewNode(
          {pattern: filter.open ? '{...}' : '{}', fields:Object.keys(filter.fields || {})},
          getFields());
        break;
      case "vector": {
          const vector = filterToPattern(filter.vector, rootDef);
          newPatternId = rootDef.typePatternGraph.addNewNode(
            {pattern: '[]', fields: ["vector-member"]},
            {"vector-member": [vector]});
        };
        break;
      default:
        newPatternId = rootDef.typePatternGraph.addNewNode(
          {pattern: filter.open ? '(...)' : '()'},
          getFields());
    }
    if (filter.name) {
      rootDef.typePatternGraph.unify(`filter: ${filter.name}`, newPatternId, context[filter.name]);
    }
    
    return newPatternId;
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
      rel.patterns[1] = rootDef.typePatternGraph.addNewNode(); 
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
      rel.patterns = [rootDef.typePatternGraph.addNewNode(), rootDef.typePatternGraph.addNewNode()];
      rootDef.varRefs.push( {
          varName: rel.ref, 
          inputPatternId: rel.patterns[0], 
          outputPatternId: rel.patterns[1],
          start: rel.start,
          end: rel.end
        });
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
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@bool');
        break;
      case "PLUS":
      case "TIMES": 
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@int');
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rel.patterns[1]]});
        break;
      case "CONCAT":
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@string');
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rel.patterns[1]]});
        break;
      case "toVEC":
        rel.patterns[0] = rootDef.typePatternGraph.getTypeId('@string')
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rel.patterns[0]]});
        break;
      case "toDateMsec":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@int');
        break;
      case "toJSON":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@string');
        break;
      case "toDateStr":
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId('@string');
        break;
      case "GT":
      case "EQ":  
        rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rootDef.typePatternGraph.addNewNode()]});
        break;
      case "fromJSON":
        rel.patterns[0] = rootDef.typePatternGraph.getTypeId('@string');
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
        break;
      case "CONS": {
          const member = rootDef.typePatternGraph.addNewNode();
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [member]});
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '{}'}, {"car": [member], "cdr": [rel.patterns[1]]});
        }; break;
      case "SNOC": {
          const member = rootDef.typePatternGraph.addNewNode();
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [member]});
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '{}'}, {"car": [member], "cdr": [rel.patterns[0]]});
        }; break;
      case "DIV": {
          const intId = rootDef.typePatternGraph.getTypeId('@int');
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [intId]});
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '{}'}, {"div": [intId], "rem": [intId]});
        }; break;
      break;
      // TO DO
      case "FDIV":
      case "null":
        rel.patterns = [rootDef.typePatternGraph.addNewNode(), rootDef.typePatternGraph.addNewNode()];
        break;
      default:
        throw new Error(`No definition found for '${rel.ref}'`);  
    }
  }  

  // ==================================================================================
  // ----------------------------------------------------------------------------------
  // 1. Initialize the typePatternGraph and varRefs for each relation

  for (const relName in rels) {
    const rootDef = rels[relName];
    rootDef.typePatternGraph = new TypePatternGraph();
    rootDef.varRefs = []; // the list of references to non-builtin rels as pointers to AST nodes
    rootDef.patternVars = {}; 
    augment(rootDef.def, rootDef);
    delete rootDef.patternVars;
  }
   
  
  // 2. Compute DAG of strongly connected components in varRefs
  //    A rel_1 -> rel_2 if rel1,varRefs contains a reference to {op: "ref", ref: rel_2}
  
  const graph = new Graph(
    // 1st argument: edges
    [].concat(...Object.keys(rels).map( relName => 
      rels[relName].varRefs.map( ({varName}) => 
        ({src: relName, dst: varName})))),
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
      rels[x].varRefs.map(({ varName }) => 
        ({src: fromRelNameToDAGnode[x], dst: fromRelNameToDAGnode[varName]})
      ) // don't forget to remove loops
      .filter(({src, dst}) => src !== dst )
    )
  );
  const DAG = new Graph(DAGedges, DAGnodes);

  // 3. Topological sort of the DAG

  const sccInOrder = topoOrder(DAG).reverse();

  // 4. For each strongly connected component C in a bottom-up order
  
  //    we will also generate the canonical representation of the relations in C and replace 
  //    the name to the relation by the hash of the canonical representation    

  // console.log("- SCC in order", sccInOrder);

  for (const scc of sccInOrder) {

    const maxNumberOfIterations = 10;
    
    for (let iteration = 1; iteration <= maxNumberOfIterations; iteration++) {
      
      // console.log(`-- Iteration ${iteration}/${maxNumberOfIterations} for SCC: { ${DAGnodes[scc].scc} }`);
      //    4.1 For every r in C, compute the new typePatternGraph of r, i.e.:

      let before = JSON.stringify(DAGnodes[scc].scc.map( relName => {
        const relDef = rels[relName];
        // console.log("-----------------------------------");
        // console.log(relDefToString(relDef));
        rels[relName] = compactRel(relDef,relName);
        // console.log(relDefToString(rels[relName]));
        return relDefToString(rels[relName]);
      }));

      let after = JSON.stringify(DAGnodes[scc].scc.map( relName => {
        const relDef = compactRel(rels[relName],relName);
        for (let i = 0; i < relDef.varRefs.length; i++) {
          const start = new Date().getTime();
          let varRel = relDef.varRefs[i];
          let { varName } = varRel;
          try {
            let varRootDef = rels[varName];
            let varInputPatternId = varRootDef.typePatternGraph.find(varRootDef.def.patterns[0]);
            let varOutputPatternId = varRootDef.typePatternGraph.find(varRootDef.def.patterns[1]);
            let cloned = varRootDef.typePatternGraph.clone([varInputPatternId, varOutputPatternId], relDef.typePatternGraph);
            relDef.typePatternGraph.unify(`ref:input ${relName}(${varName})`, varRel.inputPatternId, cloned[varInputPatternId]);
            relDef.typePatternGraph.unify("ref:output", varRel.outputPatternId, cloned[varOutputPatternId]);
          } catch (e) {
            e.message = 
`Type Error in definition of '${relName}' at call to '${varName}': lines ${varRel.start?.line}:${varRel.start?.column}...${varRel.end?.line}:${varRel.end?.column}):
 - ${e.message}`;       
            throw e;
          }
          const tookMs = new Date().getTime() - start;
          if (tookMs > 200) {
            console.log(` ---- Processing ${relName}(.., x${i}=${relDef.varRefs[i].varName}, ..) took: ${tookMs} ms`); 
          }
        }
        rels[relName] = compactRel(relDef,relName);
        return relDefToString(rels[relName]); 
      }));

      if (before == after) {
        // console.log("SUCCESS!");
        break;
      }
    } // end of iteration loop

    DAGnodes[scc].scc.forEach( relName => {
      const relDef = rels[relName];
      const canonical = relDefToString(relDef);
      const h = hash(canonical);
      relAlias[relName] = h;
    });

    assignCanonicalNames(DAGnodes[scc].scc, rels, relAlias);

  }
  return relAlias;
}

export default { patterns };
export { patterns };

