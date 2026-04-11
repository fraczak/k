import { prettyFilter, patterns2filters } from "./pretty.mjs";

export function signature(relDef) {
  const typePatternGraph = relDef.typePatternGraph;
  const filters = patterns2filters(typePatternGraph, ...relDef.def.patterns);
  const result = filters.map( prettyFilter ).join("  -->  ");
  return result;
}

export function relDefToString(relDef) {
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

export function compactRel(relDef, name = "") {
  const start = new Date().getTime();
  const {def, typePatternGraph, varRefs } = relDef;

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

export function convergeScc(scc, rels) {
  const maxNumberOfIterations = 2 + scc.length;
  let converged = false;
  
  for (let iteration = 1; iteration <= maxNumberOfIterations; iteration++) {
    let before = JSON.stringify(scc.map( relName => {
      const relDef = rels[relName];
      rels[relName] = compactRel(relDef,relName);
      return signature(rels[relName]);
    }));

    let after = JSON.stringify(scc.map( relName => {
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
          e.message = `Type Error in definition of '${relName}' at call to '${varName}': lines ${varRel.start?.line}:${varRel.start?.column}...${varRel.end?.line}:${varRel.end?.column}):\n - ${e.message}`;       
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
      converged = true;
      break;
    }
  }

   if (!converged) {
     const details = scc.map( relName => {
       const relDef = rels[relName];
       return `\x1b[94m${relName}\x1b[0m: ${signature(relDef)}`;
     }).join('\n  ');
     console.warn(`WARNING ⚠️  : Type derivation did NOT converge after ${maxNumberOfIterations} iterations:\n  ${details}\n  Consider adding filter expressions when defining recursive polymorphic functions.`);
   }
}
