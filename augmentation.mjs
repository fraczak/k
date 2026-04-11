import codes from "./codes.mjs";

const unitCode = codes.unitCode;

export function augment(rel, rootDef, rels, representatives) {
  try {
    switch (rel.op) {
      case "product":
        rel["product"].forEach(({label, exp}) => {
          augment(exp, rootDef, rels, representatives)
        });
        augmentProduct(rel,rootDef);
        break;
      case "union":
        rel["union"].forEach((exp) => {
          augment(exp,rootDef, rels, representatives);
        });
        augmentUnion(rel,rootDef);
        break;
      case "comp":
        rel["comp"].forEach((exp) => {
          augment(exp,rootDef, rels, representatives);
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
          augmentRef(rel, rootDef, rels);
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
        rel.patterns[1] = rel.patterns[0] = filterToPattern(rel.filter, rootDef, representatives);
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

function filterToPattern(filter, rootDef, representatives) {
  const context = rootDef.patternVars;
  const getFields = () => 
    Object.keys(filter.fields || {}).reduce( (fields, label) => {
      const patternId = filterToPattern(filter.fields[label], rootDef, representatives);
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

function augmentRef(rel,rootDef,rels) { 
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
