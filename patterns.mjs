
// import { prettyCode, prettyRel } from "./pretty.mjs";


// Assumptions:
// 1. Normalized code graph (i.e., codes and representatives)
// 2. a pattern is defined by triples:
//    { code: [null, codeId], 
//      type: [null, product, union, vector, code], 
//      closed: [true, false] }

import hash from "./hash.mjs";

const unitCode = hash('$C0={};'); // it was '{}'

function patterns(codes, representatives, rels) {
  // INPUT: 
  //   codes: {"BG": {"code": "product", "product": {}}, ...}
  //   representatives:{"{}": "BG", ...}
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
        break;
      case "code":
        rel["code"] = representatives[rel.code] || rel.code;
        break;
      case "caret":
        augment(rel.caret);
        break;
      case "filter":
        // do nothing for now
        console.log("filter ignored", rel);
        break;
      case "ref":
        // do nothing
        break;
      case "pipe":
        break;
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
        case "caret":
          return inspectCaret(rel);
        case "pipe":
          return inspectPipe(rel);
        case "filter":
          return false;
      }
      throw new Error(`Unknown op: ${op}`);
    } catch (e) {
      console.error(`Code Derivation Error for '${op}' (lines ${rel.start?.line}:${rel.start?.column}...${rel.end?.line}:${rel.end?.column}): ${e.message}.`);
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
      if (pattern.type && pattern.type != codes[code]?.code) {
        throw new Error(`Cannot update pattern with code '${code}': pattern type: ${pattern.type} -> code type: ${codes[code]?.code || 'built-in'}`);
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
    if (srcPattern.type == 'vector') {
      if (/^(0|[1-9][0-9]*)$/.test(label)) {
        const old_target = patternEdges[src]['vector-member'];
        if (old_target) {
          const newTarget = join(old_target, target);
          if (newTarget) {
            patternEdges[src][label] = newTarget;
            return true;
          }
          return false;
        }
        patternEdges[src]['vector-member'] = target;
        return true;
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
    
    if (srcPattern.closed) {
      throw new Error(`Cannot add edge ${label} to pattern ${JSON.stringify(srcPattern)}`);
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

  function inspectPipe(rel) {
    const old_i = getRep(rel.patterns[0]);
    const old_o = getRep(rel.patterns[1]);
    const old_i_pattern = patternNodes[old_i];
  
    let modified = updatePattern(old_i_pattern, {type: "vector", closed: true});
     
    let member_i = patternEdges[old_i]["vector-member"];
    if (member_i == undefined ) { 
      modified = true;
      member_i = patternNodes.length;
      patternNodes.push({ _id: member_i, code: null, type: null, closed: false})
      patternEdges[old_i]["vector-member"] = member_i;
      eq[member_i] = member_i;
    }
    member_i =  getRep(member_i);
    modified = join(member_i, old_o) || modified;
    console.log([old_i,old_o,member_i].map( x => [x,patternNodes[x]]));
    return modified;
  }

  function inspectCaret(rel) {
    let modified  = join(rel.patterns[0], rel.caret.patterns[0]);
    const old_o = getRep(rel.patterns[1]);
    const old_o_pattern = patternNodes[old_o];
  
    modified = updatePattern(old_o_pattern, {type: "vector", closed: true});
     
    let member_o = patternEdges[old_o]["vector-member"];
    if (member_o == undefined ) {
      modified = true;
      member_o = patternNodes.length;
      patternNodes.push({ _id: member_o, code: null, type: null, closed: false})
      patternEdges[old_o]["vector-member"] = member_o;
      eq[member_o] = member_o;
    }
    member_o =  getRep(member_o);
    modified = join(rel.caret.patterns[1], member_o) || modified;
    return modified;
  }


  function inspectDot(rel) {
    const old_i = getRep(rel.patterns[0]);
    const old_o = getRep(rel.patterns[1]);
    const old_i_pattern = patternNodes[old_i];
    const old_o_pattern = patternNodes[old_o];
    const field = rel.dot;
    if (old_i_pattern.type == "code") {
      if (old_i_pattern.code == "int" || old_i_pattern.code == "bool" || old_i_pattern.code == "string") {
        return updatePattern(old_o_pattern, {code: "product", type: "code", closed: true, product: []});
      }
      const code = codes[representatives[old_i_pattern.code] || old_i_pattern.code];
      let target_code = null;
      if (code.code == "product" || code.code == "union")
        target_code = code[code.code][field];
      else if (code.code == "vector") 
        target_code = code.vector;
      if (target_code) 
        return updatePattern(old_o_pattern, {code: target_code});
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
        // check that there is no patternEdge from old_o
        for (const label in patternEdges[old_o]) {
          throw new Error(`Label ${label} in code '{}'.`);
        }
        return updatePattern(old_o_pattern, {code: unitCode, type: "code", closed: true});
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
    // check that patternEdges coincide with field labels
    const patternEdgeLabels = Object.keys(patternEdges[old_o]);
    const labels = fields.reduce( (labels,{label}) => 
      ({[label]: true, ...labels}), {});
   
    for (const label of patternEdgeLabels) {
      if (!labels[label]) {
        throw new Error(`Label '${label}' not allowed for pattern ${JSON.stringify({...old_o_pattern, fields})}`);
      }
    }
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
    if (!relDefs) {
      switch (rel.ref) {
        case "_log!":
          return inspectIdentity(rel);
        case "true": 
        case "false": return updatePattern(patternNodes[rel.patterns[1]], {code: "bool"});

        case "PLUS":
        case "TIMES": 
          // should add updating the input parrent to code `$[int]`
          // console.log("PLUS/TIMES", rel);
          return updatePattern(patternNodes[rel.patterns[1]], {code: "int"});
        case "CONCAT":
          return updatePattern(patternNodes[rel.patterns[1]], {code: "string"});
        case "toDateMsec":
          return updatePattern(patternNodes[rel.patterns[1]], {code: "int"});
        case "toJSON":
          return updatePattern(patternNodes[rel.patterns[1]], {code: "string"});
        case "toDateStr":
          return updatePattern(patternNodes[rel.patterns[1]], {code: "string"});

        // TO DO
        case "GT":
        case "EQ":
        case "null":
        case "DIV":
        case "FDIV":
        case "fromJSON":
        case "CONS":
        case "SNOC":
          return false;
      }
      throw new Error(`No definition found for ${rel.ref}`);  
    }
    // For now we assume only the first def which does not throw!!!!
    // That's good enough if all defs are typed by different input codes.
    for (const def of relDefs) {
      try {
        // var modified = join(def.patterns[0], rel.patterns[0]);
        var modified = updatePattern(
          patternNodes[getRep(rel.patterns[0])], 
          patternNodes[getRep(def.patterns[0])]
        );

        // modified = join(def.patterns[1], rel.patterns[1]) || modified;
        modified = updatePattern(
          patternNodes[getRep(rel.patterns[1])], 
          patternNodes[getRep(def.patterns[1])]
        ) || modified;

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

