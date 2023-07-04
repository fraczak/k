// Assumptions:
// 1. Normalized code graph (i.e., codes and representatives)
// 2. a pattern is defined by triples:
//    { code: [null, codeId], 
//      type: [null, product, union, vector, code], 
//      closed: [true, false] }

var rels = null; // {"rlz": [{op: comp,...}, ...], ...}
var codes = null; // {"{}": {"code": "product", "product": {}}, ...}
var representatives = null; // {"{}": "{}", ...}
var pGraph = null; // {patternNodes: [{__id: 0, code: null, type: null, closed" false}], 
                   //  patternEdges: {0: {label: 2}, ...}, 
                   //  eq: [0, 1, 0, ...]}
function setCodes(theCodes,theRepresentatives, theRels, thePGraph) {
  codes = theCodes;
  representatives = theRepresentatives;
  rels = theRels;
  pGraph = thePGraph;
}

function patterns(codes, representatives, rels) {
  // will return annotated rels; each rel will have a pair of "patterns" property (inCode, outCode)
  // 1. initialize patterns (vector of patterns))

  setCodes(codes, representatives, rels, {patternNodes: [], patternEdges: {}, eq: {}});

  console.log(JSON.stringify({codes,representatives,rels}, null, 2));

  for (const relName in rels) {
    const defs = rels[relName];
    for (const def of defs) { augment(def, pGraph.patternNodes); }
  }
  pGraph.eq = pGraph.patternNodes.map((_, i) => i); // equivalence classes (int = pattern index, str = code name)

  // 2. loop until no more changes
  let changed = true;
  while (changed) { 
    changed = false;
    for (const relName in rels) {
      const defs = rels[relName];
      for (const def of defs) {
        changed = inspect(def, pGraph) || changed;
      }
    }
  }
  return {pGraph, rels};
}

function augment(rel, patterns) {
  const i = patterns.length;
  const pattern_i = {__id: i, code: null, type: null, closed: false}
  patterns.push(pattern_i); 
  const o = patterns.length;
  const pattern_o = {__id: o, code: null, type: null, closed: false}
  patterns.push(pattern_o);
  rel.patterns = [i, o];
  switch (rel.op) {
    case "product":
      rel["product"].forEach(({label, exp}) => augment(exp, patterns));
      break;
    case "union":
    case "comp":
    case "vector":
      rel[rel.op].forEach((exp) => augment(exp, patterns));
  }
}

function inspect(rel, pGraph) {
  const op = rel.op;
  console.log(`Inspecting ${op} ${JSON.stringify(rel)}`);
  switch (op) {
    case "product":
      return inspectProduct(rel, pGraph);
    case "union":
      return inspectUnion(rel, pGraph);
    case "comp": 
      return inspectComp(rel, pGraph);
    case "vector":
      return inspectVector(rel, pGraph);
    case "dot":
      return inspectDot(rel, pGraph);
    case "code": 
      return inspectCode(rel, pGraph);
    case "ref":
      return inspectRef(rel, pGraph);
  }
  throw new Error(`Unknown op: ${op}`);   
}

function getRep(eq, i) {
  while (eq[i] !== i) { i = eq[i]; }
  return i;
}

function updatePattern(pattern, {code, type, closed}) {
  if (code) {
    type = "code";
    closed = true;
    if (pattern.code == code && pattern.type == type && pattern.closed == closed) { 
      return false; 
    }
    if (pattern.code) {
      throw new Error(`Cannot update pattern with code: ${pattern.code} -> ${code}`);
    }
    if (pattern.type && pattern.type != codes[code].code) {
      throw new Error(`Cannot update pattern with code '${code}': pattern type: ${pattern.type} -> code type: ${codes[code].code}`);
    }
    pattern.code = code; 
    pattern.closed = true;
    pattern.type = "code";
    return true;
  }

  code = pattern.code;
  type = type ? type : pattern.type;
  closed = closed ? closed : pattern.closed;

  if (pattern.code == code && pattern.type == type && pattern.closed == closed) { 
    return false; 
  }

  if (type != pattern.type) {
    if (pattern.type) {
      throw new Error(`Cannot update pattern ${pattern} with  ${code, type, closed}`);
    }
    pattern.type = type;
  }
    
  pattern.closed = pattern.closed || closed;

  return true;    
}


function join(eq, i, j) {
  const iRep = getRep(eq, i);
  const jRep = getRep(eq, j);
  if (iRep == jRep) { return false; } 
  // jRep becomes new representative
  eq[iRep] = jRep;
  // we still have to merge patterns and migrate edges
  const iPattern = pGraph.patternNodes[iRep];
  const jPattern = pGraph.patternNodes[jRep];
  updatePattern(jPattern, iPattern); 
  migrateEdges(iRep, jRep);
  return true;  
}

function migrateEdges(i, j) {
  const iEdges = pGraph.patternEdges[i];
  const jEdges = pGraph.patternEdges[j];
  for (const label in iEdges) {
    const iTarget = iEdges[label];
    const jTarget = jEdges[label];
    if (jTarget) {
      join(pGraph.eq, iTarget, jTarget);
    } else {
      jEdges[label] = iTarget;
    }
  }
}

function addEdge(src, label, target) {
  const old_target = pGraph.patternEdges[src][label];
  if (old_target) {
    return join(pGraph.eq, old_target, target);
  }
  pGraph.patternEdges[src][label] = target;
  return true;
}

function inspectDot(rel, pGraph) {
  const old_i = getRep(pGraph.eq, rel.patterns[0]);
  const old_o = getRep(pGraph.eq, rel.patterns[1]);
  const old_i_pattern = pGraph.patternNodes[old_i];
  const old_o_pattern = pGraph.patternNodes[old_o];
  const field = rel.dot;
  if (old_i_pattern.type == "code") {
    const code = codes[representatives[old_i_pattern.code]];
    if (code.code == "product" || code.code == "union" || code.code == "vector") {
      const target_code = code[code.code][field];
      if (target_code) 
        return updatePattern(old_o_pattern, {code: target_code});
    }
    throw new Error(`Cannot find field ${field} in code ${code}`); 
  }
  console.log
  return addEdge(old_i, field, old_o);
}

function inspectProduct(rel, pGraph) {
  switch (rel.product.length) {
    case 0: {
      // unit
      // const old_i = getRep(pGraph.eq, rel.patterns[0]);
      const old_o = getRep(pGraph.eq, rel.patterns[1]);
      const old_o_pattern = pGraph.patternNodes[old_o];
      return updatePattern(old_o_pattern, {code: "{}", type: "code", closed: true});
    }
    case 1: {
      // union constructor:  %old_i { %exp_i exp %exp_o field } %old_o 
      const field = rel.product[0].label;
      const exp = rel.product[0].exp;
      var modified = inspect(exp, pGraph);

      const old_i = getRep(pGraph.eq, rel.patterns[0]);
      const old_o = getRep(pGraph.eq, rel.patterns[1]);
      const old_i_pattern = pGraph.patternNodes[old_i];
      const old_o_pattern = pGraph.patternNodes[old_o];
      
      const exp_i = getRep(pGraph.eq, exp.patterns[0]);
      const exp_o = getRep(pGraph.eq, exp.patterns[1]);
      
      var modified = join(pGraph.eq, exp_i, old_i);

      modified = updatePattern(old_o_pattern, {code: null, type: "union", closed: false}) || modified;
      modified = addEdge(old_o, field, exp_o) || modified;

      return modified;
    }
  }
  // product constructor %old_i { %exp0_i exp0 %exp0_o field0, ... %expk_i expk %expk_o fieldk } %old_o
  var modified = rel.product.reduce((modified, exp) => 
    inspect(exp, pGraph) || modified, false);

  const fields = rel.product.map(({label, exp}) => 
    ({label, exp_i: getRep(pGraph.eq, exp.patterns[0]), exp_o: getRep(pGraph.eq, exp.patterns[1])}));


  const old_i = getRep(pGraph.eq, rel.patterns[0]);
  const old_o = getRep(pGraph.eq, rel.patterns[1]);
  const old_i_pattern = pGraph.patternNodes[old_i];
  const old_o_pattern = pGraph.patternNodes[old_o];
  
  for (const {label, exp_i, exp_o} of fields) {
    modified = join(pGraph.eq, exp_i, old_i) || modified;
    modified = addEdge(old_o, label, exp_o) || modified;
  }
  return modified;
}

function inspectUnion(rel, pGraph) {
  return false;
}

function inspectComp(rel, pGraph) {

  const old_i = getRep(pGraph.eq, rel.patterns[0]);
  if (rel.comp.length == 0) {
    return join(pGraph.eq, old_i, getRep(pGraph.eq, rel.patterns[1]));
  }
  // comp: %old_i ( %exp0_i exp0 %exp0_o, ... %expk_i expk %expk_o ) %old_o
  
  const [modified,pattern_o] = rel.comp.reduce(([modified,pattern_i], exp) => {
    var new_modified = inspect(exp, pGraph) || modified;
    new_modified = join(pGraph.eq, pattern_i, exp.patterns[0]) || modified;
    new_modified = inspect(exp, pGraph) || new_modified;
    return [new_modified, exp.patterns[1]];
  }, [false, old_i]);
  return join(pGraph.eq, pattern_o, getRep(pGraph.eq, rel.patterns[1])) || modified;
}

function inspectVector(rel, pGraph) { 
  return false;
}

function inspectCode(rel, pGraph) {
  const old_i = getRep(pGraph.eq, rel.patterns[0]);
  var modified = updatePattern(pGraph.patternNodes[old_i], {code: rel.code});
  return join(pGraph.eq, old_i, getRep(pGraph.eq, rel.patterns[1])) || modified;
}

function inspectRef(rel, pGraph) { 
  const relDefs = rels[rel.ref];
  return relDefs.reduce((modified, def) => {
    var new_modified = join(pGraph.eq, getRep(pGraph.eq, def.patterns[0]), getRep(pGraph.eq, rel.patterns[0])) || modified;
    new_modified = join(pGraph.eq, getRep(pGraph.eq, def.patterns[1]), getRep(pGraph.eq, rel.patterns[1])) || new_modified;
    return new_modified;
  }, false);

}

export default { augment, patterns };
export { augment, patterns };

