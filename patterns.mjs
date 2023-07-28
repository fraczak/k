
// import { prettyCode, prettyRel } from "./pretty.mjs";


// Assumptions:
// 1. Normalized code graph (i.e., codes and representatives)
// 2. a pattern is defined by triples:
//    { code: [null, codeId], 
//      type: [null, product, union, vector, code], 
//      closed: [true, false] }


function patterns(codes, representatives, rels) {
  // INPUT: 
  //   codes: {"{}": {"code": "product", "product": {}}, ...}
  //   representatives:{"{}": "{}", ...}
  //   rels: {"rlz": [{op: comp,...}, ...], ...}
  
  // OUTPUT: returns pattern graph: 
  //  { patternNodes: [{code,type,closed},...], 
  //    patternEdges: {src: {label: dst, ...}}...} 
  // as well as it will annotate rels; each rel node will have property "patterns: [i, o]"

  const patternNodes = []; // e.g.: [{ code: null, type: null, closed" false}], 
  const patternEdges = {}; // e.g.: {0: {label: 2}, ...}, 
  
  const codeToPattern = {}; // e.g., {"{}": 0, ...} - in order to collapse patterns resolved to the same code

  // 1 INITIALIZATION
  // 1.1 initialize patternNodes and rels

  function augment(rel) {
    const i = patternNodes.length;
    const pattern_i = { _id: i, code: null, type: null, closed: false}
    patternNodes.push(pattern_i); 
    switch (rel.op) {
      case "product":
        rel["product"].forEach(({label, exp}) => augment(exp));
        break;
      case "union":
      case "comp":
      case "vector":
        rel[rel.op].forEach((exp) => augment(exp));
    }

    const o = patternNodes.length;
    const pattern_o = { _id: o, code: null, type: null, closed: false}
    patternNodes.push(pattern_o);
    rel.patterns = [i, o];
  }

  for (const relName in rels) {
    const defs = rels[relName];
    for (const def of defs) { augment(def); }
  }

  // console.log(JSON.stringify(rels,"",2));

  // 1.2 initialize 'eq' (equivalence classes over patternNodes) and 'patternEdges'
  
  const eq = patternNodes.map((_, i) => i); // equivalence classes over patternNodes, e.g., [0, 1, 0, ...]}
  
  function getRep(i) {
    while (eq[i] !== i) { i = eq[i]; }
    return i;
  }
   
  for (const node_id in eq) { patternEdges[node_id]={}; }
  
  // -------- helper functions -------- 

  function inspect(rel) {
    const op = rel.op;
    // console.log(`Inspecting ${op} ${JSON.stringify(rel)}`);
    try {
      switch (op) {
        case "product":
          return inspectProduct(rel);
        case "union":
          return inspectUnion(rel);
        case "comp": 
          return inspectComp(rel);
        case "identity":
          return inspectIdentity(rel);
        case "vector":
          return inspectVector(rel);
        case "dot":
          return inspectDot(rel);
        case "code": 
          return inspectCode(rel);
        case "ref":
          return inspectRef(rel);
        case "int":
          return inspectInt(rel);
        case "str":
          return inspectStr(rel);

      }
      throw new Error(`Unknown op: ${op}`);
    } catch (e) {
      console.log(`Code Derivation Error for '${op}' (lines ${rel.start.line}:${rel.start.column}...${rel.end.line}:${rel.end.column}): ${e.message}.`);
      throw e;
    }   
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
  
    if (pattern.code) {
      // TODO: check for potential type mismatch between 'type' and 'code.code' 
      return false; 
    }

    let changed = false;
  
    if (type) {
      if (! pattern.type) {
        pattern.type = type;
        changed = true;
      } else if (pattern.type != type) {
        throw new Error(`Cannot update pattern ${JSON.stringify(pattern)} with ${JSON.stringify({code, type, closed})}`);
      }
    }

    if (closed && (! pattern.closed)) {
      pattern.closed = closed;
      return true; 
    }
      
    return changed;    
  }
  
  function join(i, j) {
    const iRep = getRep(i);
    const jRep = getRep(j);
    if (iRep == jRep) { return false; } 
    // create new representative
    const iPattern = patternNodes[iRep];
    const jPattern = patternNodes[jRep];

    const newRep = patternNodes.length;
    const newPattern = { 
      _id: newRep, 
      code: null, type: null, closed: false, 
      _from: `(${iPattern._from || iRep},${jPattern._from || jRep})`};
    patternNodes[newRep] = newPattern;
    patternEdges[newRep] = {};
    eq[iRep] = eq[jRep] = eq[newRep] = newRep;   
    // we still have to merge patterns and migrate edges
    updatePattern(newPattern, iPattern);
    updatePattern(newPattern, jPattern);
    migrateEdges(jRep, newRep);
    migrateEdges(iRep, newRep);
    
    return newRep;  
  }
  
  function migrateEdges(from_i, to_j) {
    const iEdges = patternEdges[from_i];
    const jEdges = patternEdges[to_j];
    for (const label in iEdges) {
      const iTarget = iEdges[label];
      const jTarget = jEdges[label];
      if (jTarget) {
        const newTarget = join(iTarget, jTarget);
        if (newTarget) {
          jEdges[label] = newTarget;
        }
      } else {
        jEdges[label] = iTarget;
      }
    }
  }
  
  function addEdge(src, label, target) {
    // console.log("addEdge", src, label, target, "old target", patternEdges[src][label] || "none");
    const srcPattern = patternNodes[getRep(src)];
    if (srcPattern.type == "code") {
      const code = codes[representatives[srcPattern.code] || srcPattern.code];
      if (code.code == "product" || code.code == "union" ) {
        return updatePattern(patternNodes[getRep(target)], {code: code[code.code][label]})
      }  
      throw new Error(`Cannot add edge ${label} to code ${JSON.stringify(code)}`);
    }
    const old_target = patternEdges[src][label];
    if (old_target) {
      const newTarget = join(old_target, target);
      if (newTarget) {
        patternEdges[src][label] = newTarget;
        return true;
      }
      return false;
    }
    patternEdges[src][label] = target;
    return true;
  }

  function inspectInt(rel) {
    const o_pattern = patternNodes[rel.patterns[1]];
    return updatePattern(o_pattern, {code: "int", type: "code", closed: true});
  }
  
  function inspectStr(rel) {
    const o_pattern = patternNodes[rel.patterns[1]];
    return updatePattern(o_pattern, {code: "string", type: "code", closed: true});
  }

  function inspectDot(rel) {
    const old_i = getRep(rel.patterns[0]);
    const old_o = getRep(rel.patterns[1]);
    const old_i_pattern = patternNodes[old_i];
    const old_o_pattern = patternNodes[old_o];
    const field = rel.dot;
    if (old_i_pattern.type == "code") {
      const code = codes[representatives[old_i_pattern.code] || old_i_pattern.code];
      if (code.code == "product" || code.code == "union" || code.code == "vector") {
        const target_code = code[code.code][field];
        if (target_code) 
          return updatePattern(old_o_pattern, {code: target_code});
      }
      throw new Error(`Cannot find field ${field} in code ${JSON.stringify(code)}`); 
    }

    return addEdge(old_i, field, old_o);
  }
  
  function inspectProduct(rel) {
    switch (rel.product.length) {
      case 0: {
        // unit
        const old_o = getRep(rel.patterns[1]);
        const old_o_pattern = patternNodes[old_o];
        return updatePattern(old_o_pattern, {code: "{}", type: "code", closed: true});
      }
      case 1: {
        // union constructor:  %old_i { %exp_i exp %exp_o field } %old_o 
        const field = rel.product[0].label;
        const exp = rel.product[0].exp;
        var modified = inspect(exp);
  
        const old_i = getRep(rel.patterns[0]);
        const old_o = getRep(rel.patterns[1]);
        const old_o_pattern = patternNodes[old_o];
        
        const exp_i = getRep(exp.patterns[0]);
        const exp_o = getRep(exp.patterns[1]);
        
        var modified = join(exp_i, old_i);
  
        modified = updatePattern(old_o_pattern, {code: null, type: "union", closed: false}) || modified;
        modified = addEdge(old_o, field, exp_o) || modified;
  
        return modified;
      }
    }
    // product constructor %old_i { %exp0_i exp0 %exp0_o field0, ... %expk_i expk %expk_o fieldk } %old_o
    var modified = rel.product.reduce((modified, {label,exp}) => 
      inspect(exp) || modified, false);
  
    const fields = rel.product.map(({label, exp}) => 
      ({label, exp_i: getRep(exp.patterns[0]), exp_o: getRep(exp.patterns[1])}));
  
    const old_i = getRep(rel.patterns[0]);
    const old_o = getRep(rel.patterns[1]);
    const old_o_pattern = patternNodes[old_o];
    
    for (const {label, exp_i, exp_o} of fields) {
      modified = join(exp_i, old_i) || modified;
      modified = addEdge(old_o, label, exp_o) || modified;
    }
    modified = updatePattern(old_o_pattern, {type: "product", closed: true}) || modified;
    return modified;
  }
  
  function inspectUnion(rel) {
  
    const old_o = getRep(rel.patterns[1]);
    if (rel.union.length == 0) {
      return updatePattern(patternNodes[old_o], {type: "union", closed: true}); 
    }
    // union: %old_i < %exp0_i exp0 %exp0_o, ... %expk_i expk %expk_o > %old_o
    
    const modified = rel.union.reduce((modified, exp) => {
      var new_modified = inspect(exp) || modified;
      new_modified = join(rel.patterns[0], exp.patterns[0]) || modified;
      new_modified = join(rel.patterns[1], exp.patterns[1]) || modified;
      return new_modified;
    }, false);
    return modified;
  }

  function inspectComp(rel) {
    if (rel.comp.length == 0) { return inspectIdentity(rel); }

    // comp: %old_i ( %exp0_i exp0 %exp0_o, ... %expk_i expk %expk_o ) %old_o
    const old_i = getRep(rel.patterns[0]);
    const [modified,pattern_o] = rel.comp.reduce(([modified,pattern_i], exp) => {
      var new_modified = inspect(exp) || modified;
      new_modified = join(pattern_i, exp.patterns[0]) || modified;
      return [new_modified, exp.patterns[1]];
    }, [false, old_i]);
    return join(pattern_o, rel.patterns[1]) || modified;
  }
  
  function inspectIdentity(rel) { 
    return join(rel.patterns[0], rel.patterns[1]);
  }
  
  function inspectVector(rel) { 
    const old_o = getRep(rel.patterns[1]);
    var modified = updatePattern(patternNodes[old_o], {type: "vector", closed: true});
    if (rel.vector.length == 0) {
      return modified; 
    }
    // vector: %old_i [ %exp0_i exp0 %exp0_o, ... %expk_i expk %expk_o] %old_o
    
    let member_o = patternEdges[old_o]["vector-member"];
    if (member_o) { 
      member_o =  getRep(patternEdges[old_o]["vector-member"]);
    } else {
      modified = true;
      member_o = patternNodes.length;
      patternNodes.push({ _id: member_o, code: null, type: null, closed: false})
      patternEdges[old_o]["vector-member"] = member_o;
      eq[member_o] = member_o;
    }

    modified = rel.vector.reduce((modified, exp) => {
      modified = inspect(exp) || modified;
      modified = join(rel.patterns[0], exp.patterns[0]) || modified;
      modified = join(member_o, exp.patterns[1]) || modified;
      return modified;
    }, modified);
    return modified;
  }
  
  function inspectCode(rel) {
    const old_i = getRep(rel.patterns[0]);
    var modified = updatePattern(patternNodes[old_i], {code: representatives[rel.code] || rel.code});
    return join(old_i, rel.patterns[1]) || modified;
  }
  
  function inspectRef(rel) { 
    const relDefs = rels[rel.ref];
    // For now we assume only the first def which does not throw!!!!
    // That's good enough if all defs are typed by different input codes.
    if (!relDefs) {
      switch (rel.ref) {
        case "true": 
        case "false": return updatePattern(patternNodes[rel.patterns[1]], {code: "bool"});
      }
      throw new Error(`No definition found for ${rel.ref}`);  
    }
    for (const def of relDefs) {
      try {
        var modified = join(def.patterns[0], rel.patterns[0]);
        modified = join(def.patterns[1], rel.patterns[1]) || modified;
        return modified;
      } catch (e) {}
    } 
    throw new Error(`No matching definition found for ${rel.ref}`);  
  }


  // --------- main loop --------------

  // 2. loop until no more changes

  let changed = true;
  while (changed) { 
    changed = false;
    for (const relName in rels) {
      const defs = rels[relName];
      for (const def of defs) {
        changed = inspect(def) || changed;
      }
    }
  }

  // 3. compress the pattern graph

  // 3.1. get representative nodes for each pattern
  // pNode = {repFromPatternNodes: 0, repFromPatternNodes: 1, ...}
  const pNodes = {};
  eq.map(getRep).forEach((p) => {
    pNodes[p] = p;
  });
  Object.keys(pNodes).map((p,i) => pNodes[p] = i);

  function updatePatterns(rel) {
    rel.patterns[0] = pNodes[getRep(rel.patterns[0])];
    rel.patterns[1] = pNodes[getRep(rel.patterns[1])];
    switch (rel.op) {
      case "product":
        rel["product"].forEach(({label, exp}) => updatePatterns(exp));
        break;
      case "union":
      case "comp":
      case "vector":
        rel[rel.op].forEach((exp) => updatePatterns(exp));
    }
  }

  for (const relName in rels) {
    const defs = rels[relName];
    for (const def of defs) { updatePatterns(def); }
  }

  const newPatternNodes = [];
  for (const i in pNodes) {
    newPatternNodes[pNodes[i]] = patternNodes[i];
  }
  const newPatternEdges = Object.keys(patternEdges).reduce(function (newPatternEdges, src) {
    const newSrc = pNodes[src];
    if (newSrc != undefined) { 
      newPatternEdges[newSrc] = Object.keys(patternEdges[src]).reduce(function (newPatternEdges, label) {
        newPatternEdges[label] = pNodes[getRep(patternEdges[src][label])];
        return newPatternEdges;
      }, {});
    }
    return newPatternEdges;
  }, {});

  // loops in the pattern graph are forcing the pattern to be union!

  for( const i in newPatternNodes) {
    const node = newPatternNodes[i];
    for (const label in newPatternEdges[i]) {
      if (newPatternEdges[i][label] == i) {
        if (node.type == "product") {
          throw new Error("Loop in product code!");
        }
        node.type = "union";
      }
    }
  }

  return { patternNodes: newPatternNodes, patternEdges: newPatternEdges };  
}



export default { patterns };
export { patterns };

