import { prettyFilter, patterns2filters } from "./pretty.mjs";
import { getCompressed } from "./typing.mjs";

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

  const {typePatternGraph : newTypePatternGraph, remapping: renumbering}  = getCompressed(typePatternGraph);

  const remapRel = (rel) => {
    rel.patterns = [renumbering[rel.patterns[0]], renumbering[rel.patterns[1]]];
    switch (rel.op) {
      case "product":
        rel.product.forEach(({ exp }) => remapRel(exp));
        break;
      case "union":
        rel.union.forEach(exp => remapRel(exp));
        break;
      case "comp":
        rel.comp.forEach(exp => remapRel(exp));
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
  };
  remapRel(def);
  const newVarRefs = varRefs.map(x => {
    x.inputPatternId = renumbering[x.inputPatternId];
    x.outputPatternId = renumbering[x.outputPatternId];
    return x;
  });
    
  const time = new Date().getTime() - start;
  if (time > 500 ) {
    console.log(`[${new Date().getTime() - start} msecs] - COMPACTED ${name}.typePatternGraph [${typePatternGraph.size()}->${newTypePatternGraph.size()}]`);
  }
  return {def, typePatternGraph: newTypePatternGraph, varRefs: newVarRefs};
}

function processReference(relName, relDef, rels, varRel, index) {
  const start = new Date().getTime();
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
    console.log(` ---- Processing ${relName}(.., x${index}=${relDef.varRefs[index].varName}, ..) took: ${tookMs} ms`);
  }
}

function propagateReferences(relName, relDef, rels) {
  for (let i = 0; i < relDef.varRefs.length; i++) {
    processReference(relName, relDef, rels, relDef.varRefs[i], i);
  }
}

function hasSelfReference(relName, relDef) {
  return relDef.varRefs.some(({ varName }) => varName === relName);
}

function resolveStrategy(scc, rels, options = {}) {
  const strategy = options.strategy || "auto";
  if (strategy !== "auto") {
    return strategy;
  }
  if (scc.length === 1 && !hasSelfReference(scc[0], rels[scc[0]])) {
    return "single_pass";
  }
  return "fixed_point";
}

function convergeSccSinglePass(scc, rels) {
  const relName = scc[0];
  const relDef = rels[relName];
  propagateReferences(relName, relDef, rels);
  rels[relName] = compactRel(relDef, relName);
  return {
    strategy: "single_pass",
    iterations: 1,
    converged: true
  };
}

function convergeSccFixedPoint(scc, rels, options = {}) {
  const maxNumberOfIterations = options.maxIterations || (2 + scc.length);
  let converged = false;
  let iterations = 0;
  
  for (let iteration = 1; iteration <= maxNumberOfIterations; iteration++) {
    iterations = iteration;
    let before = JSON.stringify(scc.map( relName => {
      const relDef = rels[relName];
      rels[relName] = compactRel(relDef,relName);
      return signature(rels[relName]);
    }));

    let after = JSON.stringify(scc.map( relName => {
      const relDef = compactRel(rels[relName],relName);
      propagateReferences(relName, relDef, rels);
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

  return {
    strategy: "fixed_point",
    iterations,
    converged
  };
}

export function convergeScc(scc, rels, options = {}) {
  const strategy = resolveStrategy(scc, rels, options);
  switch (strategy) {
    case "single_pass":
      if (scc.length !== 1) {
        throw new Error(`single_pass convergence requires a singleton SCC, got: ${JSON.stringify(scc)}`);
      }
      return convergeSccSinglePass(scc, rels);
    case "fixed_point":
      return convergeSccFixedPoint(scc, rels, options);
    default:
      throw new Error(`Unknown convergence strategy '${strategy}'`);
  }
}
