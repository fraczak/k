
import hash from "./hash.mjs";
import { TypePatternGraph } from "./typing.mjs";

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

  for (const relName in rels) {
    const rootDef = rels[relName];
    rootDef.typePatternGraph = new TypePatternGraph(codes);
    rootDef.varRefs = []; // the list of non-built references as pointers to AST nodes
    augment(rootDef.def, rootDef);
  }
   
 
  //------


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
        rel.patterns[1] = rootDef.typePatternGraph.addNewNode();
        rel.patterns[0] = rootDef.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [rel.patterns[1]]});
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

  //-----
  
  function inspectInt(rel) {
    return rel.typePatternGraph.unify(
      "int:output",
      rel.patterns[1],
      rel.typePatternGraph.getTypeId('int')
    );
  }
  
  function inspectStr(rel) {
    return rel.typePatternGraph.unify(
      "str:output",
      rel.patterns[1],
      rel.typePatternGraph.getTypeId('string')
    );
  }

  function inspectPipe(rel) {
    return rel.typePatternGraph.unify(
      "pipe",
      rel.typePatternGraph.addNewNode(
        {pattern: '[]'}, 
        {"vector-member": [rel.patterns[1]]}),
      rel.patterns[0]); 
  }

  function inspectCaret(rel) {
    return !!(
      rel.typePatternGraph.unify(
        "caret:input",
        rel.patterns[0],
        rel.caret.patterns[0] ) 
      |
      rel.typePatternGraph.unify(
        "caret:output",
        rel.typePatternGraph.addNewNode(
          {pattern: '[]'}, 
          {"vector-member": [rel.caret.patterns[1]]}),
        rel.patterns[1]
      )
    );
  }

  function inspectDot(rel) {
    return rel.typePatternGraph.unify(
      "dot",
      rel.typePatternGraph.addNewNode(
        {pattern: '(...)'},
        {[rel.dot]: [rel.patterns[1]]}),
      rel.patterns[0]
    );
  }
  
  function inspectProduct(rel) {
    switch (rel.product.length) {
      case 0: 
        return rel.typePatternGraph.unify(
          "unit:output",
          rel.typePatternGraph.addNewNode({pattern: '()'}),
          rel.patterns[1]
        );
      case 1:
        // union/variant constructor:  %old_i { %exp_i exp %exp_o field } %old_o 
        return !!(
          rel.typePatternGraph.unify(
            "variant:output",
            rel.typePatternGraph.addNewNode({pattern: '<...>'}, 
              {[rel.product[0].label]: [rel.patterns[0]]}),
            rel.patterns[1]) 
          |
          rel.typePatternGraph.unify(
            "variant:input",
            rel.patterns[0],
            rel.product[0].exp.patterns[0])
        );
      default:
        // product constructor %old_i { %exp0_i exp0 %exp0_o field0, ... %expk_i expk %expk_o fieldk } %old_o
        return !!(
          rel.typePatternGraph.unify(
            "product:input",
            rel.patterns[0], 
            ...rel.product.map(({exp}) => exp.patterns[0]))
          | 
          rel.typePatternGraph.unify(
            "product:output",
            rel.typePatternGraph.addNewNode(
              {pattern: '{}'},
              rel.product.reduce((edges, {label, exp}) => {
                edges[label] = [exp.patterns[1]];
                return edges;
              }, {}),
              rel.patterns[1])
          )
        );
    };
  }
  
  function inspectUnion(rel) {
    if (rel.union.length == 0) {
      return rel.typePatternGraph.unify(
        "empty-union:output",
        rel.typePatternGraph.addNewNode({pattern: '<>'}),
        rel.patterns[1]
      );
    }

    return !!(
      rel.typePatternGraph.unify(
        "union:input",
        rel.patterns[0],
        ...rel.union.map(exp => exp.patterns[0]))
      |
      rel.typePatternGraph.unify(
        "union:output",
        rel.patterns[1],
        ...rel.union.map(exp => exp.patterns[1]))
    );
  }

  function inspectComp(rel) {
    if (rel.comp.length == 0) { return inspectIdentity(rel); }

    let modified = false;
    for (let i = 0; i < rel.comp.length - 1; i++) {
      modified = rel.typePatternGraph.unify(
        "comp:chain",
        rel.comp[i].patterns[1],
        rel.comp[i+1].patterns[0]
      ) || modified;
    }
    return !!(
      rel.typePatternGraph.unify(
        "comp:input",
        rel.patterns[0],
        rel.comp[0].patterns[0])
      |
      rel.typePatternGraph.unify(
        "comp:output",
        rel.patterns[1],
        rel.comp[rel.comp.length - 1].patterns[1])
    ) || modified;
  }
  
  function inspectIdentity(rel) { 
    return rel.typePatternGraph.unify(
      "identity",
      rel.patterns[0],
      rel.patterns[1]
    );
  }
  
  function inspectVector(rel) { 
    return !!(
      rel.typePatternGraph.unify(
        "vector:input",
        rel.patterns[0],
        ...rel.vector.map(exp => exp.patterns[0]))
      |
      rel.typePatternGraph.unify(
        "vector:output",
        rel.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": rel.vector.map(exp => exp.patterns[1])}),
        rel.patterns[1])
    );
  }
  
  function inspectCode(rel) {
    const {pattern, type} = rel.typePatternGraph.get(rel.patterns[0]) || {};
    if ((pattern == "type") && (type == (representatives[rel.code] || rel.code))) { 
      return false;
    }
    
    return rel.typePatternGraph.unify(
      "code",
      rel.typePatternGraph.getTypeId(representatives[rel.code] || rel.code),
      ...rel.patterns
    );
  }
  
  function inspectRef(rel) { 
    const relDefs = rels[rel.ref];
    if (!relDefs) {
      switch (rel.ref) {
        case "_log!":
          return inspectIdentity(rel);
        case "true": 
        case "false": 
          return ref.typePatternGraph.unify(
            "bool",
            rel.typePatternGraph.addNewNode({pattern: 'type', type: 'bool'}),
            rel.patterns[1]
          );
        case "PLUS":
        case "TIMES": {
          let int_pattern = ref.typePatternGraph.addNewNode({pattern: 'type', type: 'int'});
          return !!(
            rel.typePatternGraph.unify(
              `${rel.ref}:input`,
              rel.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [int_pattern]}),
              rel.patterns[0])
            |
            rel.typePatternGraph.unify(
              `${rel.ref}:output`,
              int_pattern,
              rel.patterns[1])
          );
        }
        case "CONCAT": {
          let string_pattern = ref.typePatternGraph.addNewNode({pattern: 'type', type: 'string'});
          return !!(
            rel.typePatternGraph.unify(
              `CONCAT:input`,
              rel.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [string_pattern]}),
              rel.patterns[0])
            |
            rel.typePatternGraph.unify(
              `CONCAT:output`,
              string_pattern,
              rel.patterns[1])
          );
        }
        case "toDateMsec":
          return rel.typePatternGraph.unify(
            `toDateMsec:output`,
            rel.typePatternGraph.addNewNode({pattern: 'type', type: 'int'}),
            rel.patterns[1]);

        case "toJSON":
          return rel.typePatternGraph.unify(
            `toJSON:output`,
            rel.typePatternGraph.addNewNode({pattern: 'type', type: 'string'}),
            rel.patterns[1]);

        case "toDateStr":
          return ref.typePatternGraph.unify(
            `toDateStr:output`,
            rel.typePatternGraph.addNewNode({pattern: 'type', type: 'string'}),
            rel.patterns[1]);
            

        case "GT":
          return ref.typePatternGraph.unify(
            "GT",
            rel.typePatternGraph.addNewNode({pattern: '[]'}),
            rel.patterns[0],
            rel.patterns[1]
          );
        case "EQ":  
          return ref.typePatternGraph.unify(
            "EQ",
            rel.typePatternGraph.addNewNode({pattern: '[]'}),
            rel.patterns[0],
            rel.patterns[1]
          );
        case "fromJSON":
          return ref.typePatternGraph.unify(
            "fromJSON:input",
            ref.typePatternGraph.addNewNode({pattern: 'type', type: 'string'}),
            rel.patterns[0]
          );
        case "CONS": {
          let member_pattern = ref.typePatternGraph.addNewNode();
          let vec_pattern = ref.typePatternGraph.addNewNode({pattern: '[]'}, {"vector-member": [member_pattern]});
          return !!(
            ref.typePatternGraph.unify(
              "CONS:input",
              rel.typePatternGraph.addNewNode({pattern: '{}'}, 
                {
                  "0": [member_pattern],
                  "1": [vec_pattern]
                }),
              rel.patterns[0])
            |
            ref.typePatternGraph.unify(
              "CONS:output",
              vec_pattern,
              rel.patterns[1])
          );
        } 
        // TO DO
        case "null":
        case "DIV":
        case "FDIV":
        case "SNOC":
          return false;
      }
      throw new Error(`No definition found for ${rel.ref}`);  
    }
    // We take the last definition.
    let def = relDefs[relDefs.length - 1];
    let ids = def.patterns.map( x => def.typePatternGraph.find(x) );
    let cloned = def.typePatternGraph.clone(ids, rel.typePatternGraph);
    return !!(
      rel.typePatternGraph.unify(
        "ref:input",
        rel.patterns[0],
        cloned[ids[0]])
      |
      rel.typePatternGraph.unify(
        "ref:output",
        rel.patterns[1],
        cloned[[1]])
    );
  }


  // --------- main loop --------------

  // 2. loop until no more changes

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

