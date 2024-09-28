
import { prettyCode, prettyRel, patterns2filters } from "./pretty.mjs";
import { hash } from "./hash.mjs";

const printRel = prettyRel.bind(null, prettyCode.bind(null, {}));


function simplifyRel(relDef) {
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
      case "vector":
        newRel.vector = rel.vector.map(exp => prune(exp));
        break;
      case "caret":
        newRel.caret = prune(rel.caret);
        break;
      case 'code':
      case 'filter':
        newRel.op = "identity";
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
    return filters[0]; 

  if (newRel.op == "comp") { 
    resultRel.comp = [ filters[0], ...newRel.comp, filters[1] ];
    return resultRel;
  }
  return {
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
      case "vector":
        newRel.vector = rel.vector.map(exp => reNameX(exp));
        break;
      case "caret":
        newRel.caret = reNameX(rel.caret);
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
  const resultRelStr = printRel(newRel);
  // console.log(` ${name} = ${resultRelStr}`);
  const newName = hash(resultRelStr);
  return newName;
};

function assignCanonicalNames(scc, rels, relAlias) {
  const newAlias = scc.reduce( (newAlias,relName) => {
    const relDef = rels[relName];
    if (relDef.def.op == "ref" && rels[relDef.def.ref] != undefined) {
      // inlining if direct alias to a non built-in relation
      relDef.simplified = simplifyRel(rels[relDef.def.ref]);
    } else {
      relDef.simplified = simplifyRel(relDef);
    }
    newAlias[relName] = theID(relAlias, relDef.simplified, scc, relName);
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

export default { assignCanonicalNames };
export { assignCanonicalNames};
