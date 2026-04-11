import hash from "./hash.mjs";
import { TypePatternGraph } from "./typing.mjs";
import { Graph, sccs, topoOrder } from "./Graph.mjs";
import codes from "./codes.mjs";
import { prettyFilter, prettyRel, patterns2filters } from "./pretty.mjs";  

const unitCode = codes.unitCode;

function logNormalized(label, value, hashValue) {
  if (process.env.K_DUMP_NORMALIZED) {
    if (hashValue) {
      console.log(`[k-normalize] ${label}: ${hashValue} = ${value}`);
    } else {
      console.log(`[k-normalize] ${label}: ${value}`);
    }
  }
}

function simplifyRel(relDef,rels) {
  // remove filters and codes
  const prune = (rel) => {
    const newRel = {...rel};
    switch (rel.op) {
      case "product":
        newRel.product = rel.product.map(({label, exp}) => ({label, exp: prune(exp)}));
        break;
      case "union":
        newRel.union = rel.union.map(exp => prune(exp));
        break;
      case "comp":
        newRel.comp = rel.comp.reduce((list, exp) => {
          const newExp = prune(exp);
          if (newExp.op != "identity") 
            list.push(newExp);
          return list;
        },[]);
        if (newRel.comp.length == 0) 
          newRel.op = "identity";
        break;
      case 'code':
      case 'filter':
        newRel.op = "identity";
        break;
      case 'ref':
        // console.log("ref", rel.ref, rels[rel.ref]);
        if (["filter","code","identity"].includes(rels[rel.ref]?.def.op)){
          newRel.op = "identity";
        };
        break;
      default:
        break;
    };
    return newRel;
  };

  const rel = relDef.def;
  const filters = patterns2filters(relDef.typePatternGraph, ...rel.patterns).map( filter =>
    ({op: "filter", filter: filter}));
  const newRel = prune(rel);
  let resultRel = {...newRel};
  if (newRel.op == "identity")
    return {...resultRel, ...filters[0]}; 

  if (newRel.op == "comp") { 
    resultRel.comp = [ filters[0], ...newRel.comp, filters[1] ];
    return resultRel;
  }

  let oldOp = resultRel.op;
  delete resultRel[oldOp];
  return {...resultRel,
    op: "comp",
    comp: [filters[0], newRel, filters[1] ]
  };
};

function theID(alias, rel, scc, name) {
  const sccNames = new Set(scc);
  const auxNames = {[name]: "X0"};
  // rename and remove filters and codes
  const reNameX = (rel) => {
    const newRel = {...rel};
    switch (rel.op) {
      case "product":
        newRel.product = rel.product.map(({label, exp}) => ({label, exp: reNameX(exp)}));
        break;
      case "union":
        newRel.union = rel.union.map(exp => reNameX(exp));
        break;
      case "comp":
        newRel.comp = rel.comp.map(exp => reNameX(exp));
        break;
      case "ref": {
        const n = rel.ref;
        if (alias[n] != undefined) {
          newRel.ref = alias[n];
        } else if (auxNames[n] != undefined) {
          newRel.ref = auxNames[n];
        } else if (sccNames.has(n)) {
          auxNames[n] = `X${Object.keys(auxNames).length}`;
          newRel.ref = auxNames[n];
        };
      }; break;
      default:
        break;
    };
    return newRel;
  };

  const newRel = reNameX(rel);
  const resultRelStr = prettyRel(newRel);
  const newName = hash(resultRelStr);
  logNormalized(name, resultRelStr, newName);
  // console.log(` ${name} = ${resultRelStr}`);
  return newName;
};

function assignCanonicalNames(scc, rels, relAlias) {
  const newAlias = scc.reduce( (newAlias,relName) => {
    const relDef = rels[relName];
    if (relDef.def.op == "ref" && rels[relDef.def.ref] != undefined) {
      // inlining if direct alias to a non built-in relation
      // relDef.def = rels[relDef.def.ref]; // simplifyRel(rels[relDef.def.ref],rels);
      rels[relName] = rels[relDef.def.ref];
    }
    rels[relName].def = simplifyRel(rels[relName], rels);
    newAlias[relName] = theID(relAlias, rels[relName].def, scc, relName);
    return newAlias;
  }, {});
  const newNames = [...new Set(Object.values(newAlias))];
  // console.log(` --- SCC: {${scc.join(",")}} ---`);

  const sccCanonicalName = newNames.sort().join(":");
  for (let relName in newAlias) {
    if (newNames.length > 1)
      relAlias[relName] = hash(newAlias[relName]+":"+sccCanonicalName);
    else
      relAlias[relName] = newAlias[relName];
    // console.log(`  ${relName} -> ${relAlias[relName]}`);
  };  
}

function exportRelation(rels, alias, name) {
  const queue = [name];
  const inQueue = { [name]: true };
  const result = {};
  const reName = (rel) => {
    const newRel = {...rel};
    switch (rel.op) {
      case "product":
        newRel.product = rel.product.map(({label, exp}) => ({label, exp: reName(exp)}));
        break;
      case "union":
        newRel.union = rel.union.map(exp => reName(exp));
        break;
      case "comp":
        newRel.comp = rel.comp.map(exp => reName(exp));
        break;
      case "ref": {
        const n = rel.ref;
        if (alias[n] == undefined) // built-in
          return newRel; 
        newRel.ref = alias[n];
        if (! inQueue[n]) {
          inQueue[n] = true;
          queue.push(n);
        }
      }; break;
      default:
        break;
    };
    return newRel;
  };
  while (queue.length > 0 ) {
    const name = queue.shift();
    const canonicalName = alias[name];
    result[canonicalName] = {...rels[name], def: reName(rels[name].def), name: name};
  }
  return result;
}

function signature(relDef) {
  const typePatternGraph = relDef.typePatternGraph;
  const filters = patterns2filters(typePatternGraph, ...relDef.def.patterns);
  const result = filters.map( prettyFilter ).join("  -->  ");
  // console.log(` ---- signature: ${result}`);
  return result;
}

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
      case "ref":
      case "identity":
      case "dot":
      case "div":
      case "vid":
      case "code":
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
      case "ref":
      case "identity":
      case "dot":
      case "div":
      case "vid":  
      case "code":
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
        case "code":
          rel["code"] = representatives[rel.code] || rel.code;
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.getTypeId(rel["code"]);
          rel.patterns[1] = rel.patterns[0]; 
          break;
        case "ref":
            augmentRef(rel, rootDef);
            break;
          //----------------
        case "identity":
          rel.patterns = [];
          rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
          break;
        case "dot":
          rel.patterns = [];
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '{...}', fields: [rel.dot]}, { [rel.dot]: [rel.patterns[1]] }); 
          break;
        case "div":
          rel.patterns = [];
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '<...>', fields: [rel.div]}, { [rel.div]: [rel.patterns[1]] }); 
          //console.log(`AUGMENTED DIV: patterns=${JSON.stringify(rel.patterns.map(x => rootDef.typePatternGraph.get_pattern(x)))}`);
          break;
        case "vid":
          rel.patterns = [];
          rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
          rel.patterns[1] = rootDef.typePatternGraph.addNewNode({pattern: '<...>', fields: [rel.vid]}, { [rel.vid]: [rel.patterns[0]] }); 
          break;
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
          {pattern: filter.open ? '<...>' : '<>', fields: Object.keys(filter.fields || {})},
          getFields());
        break;
      case "product": 
        newPatternId = rootDef.typePatternGraph.addNewNode(
          {pattern: filter.open ? '{...}' : '{}', fields: Object.keys(filter.fields || {})},
          getFields());
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
    if (rel.product.length == 0) {
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[1] = rootDef.typePatternGraph.getTypeId(unitCode);
    } else {
        // product constructor %old_i { %exp0_i exp0 %exp0_o field0, ... %expk_i expk %expk_o fieldk } %old_o
      rel.patterns[0] = rootDef.typePatternGraph.addNewNode();
      rootDef.typePatternGraph.unify(
        "product:input",
        rel.patterns[0], 
        ...rel.product.map(({exp}) => exp.patterns[0]));
      
      rel.patterns[1] = rootDef.typePatternGraph.addNewNode(
        {pattern: '{}', fields: rel.product.map(({label}) => label)},
        rel.product.reduce((edges, {label, exp}) => {
          edges[label] = [ rootDef.typePatternGraph.find(exp.patterns[1])];
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
    // console.log(`AUGMENTING COMP: ${JSON.stringify(rel.comp)}`);
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
    // console.log(`AUGMENTED COMP: patterns=${JSON.stringify(rel.patterns.map(i => {
    //   const x = rootDef.typePatternGraph.find(i);
    //   return [x,rootDef.typePatternGraph.get_pattern(x)];
    // }))}`);
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
    // Check if it's a reference to a canonical type hash
    if (rel.ref.startsWith("@")) {
      const canonicalHash = rel.ref;
      const codeInRepo = codes.find(canonicalHash);
      if (codeInRepo.code !== "undefined") {
        // It's a valid canonical hash, treat it as identity with that type
        const patternId = rootDef.typePatternGraph.getTypeId(canonicalHash);
        rel.patterns[0] = rel.patterns[1] = patternId;
        return;
      }
    }
    // it is built-in
    switch (rel.ref) {
      case "_log!":
        rel.patterns[0] = rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
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
    rootDef.typePatternGraph = new TypePatternGraph(codes.register, codes.find);
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

    const maxNumberOfIterations = 2 + DAGnodes[scc].scc.length;
    let converged = false;
    
    for (let iteration = 1; iteration <= maxNumberOfIterations; iteration++) {
      
      // console.log(`-- Iteration ${iteration}/${maxNumberOfIterations} for SCC: { ${DAGnodes[scc].scc} }`);
      //    4.1 For every r in C, compute the new typePatternGraph of r, i.e.:

      let before = JSON.stringify(DAGnodes[scc].scc.map( relName => {
        const relDef = rels[relName];
        // console.log("-----------------------------------");
        // console.log(relDefToString(relDef));
        rels[relName] = compactRel(relDef,relName);
        // console.log(relDefToString(rels[relName]));
        return signature(rels[relName]);
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
        return signature(rels[relName]); 
      }));

      if (before == after) {
        // console.log("SUCCESS!");
        converged = true;
        break;
      }
    } // end of iteration loop

    if (!converged) {
      console.warn(`WARNING ⚠️  : Type derivation did NOT converge after ${maxNumberOfIterations} iterations:
  ${DAGnodes[scc].scc.map( relName => {
      const relDef = rels[relName];
      return `\x1b[94m${relName}\x1b[0m: ${signature(relDef)}`;
  }).join('\n  ')}
  Consider adding filter expressions when defining recursive polymorphic functions.`);
    }

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

export default { patterns, exportRelation, assignCanonicalNames };
export { patterns, exportRelation, assignCanonicalNames };
