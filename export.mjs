
import { prettyCode, prettyRel } from "./pretty.mjs";
import { hash } from "./hash.mjs";

const printRel = prettyRel.bind(null, prettyCode.bind(null, {}));

function theID(alias, rel, scc, name) {
  const sccNames = new Set(scc);
  const auxNames = {[name]: "X0"};
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
  const newRelStr = printRel(newRel);
  const newName = hash(newRelStr);
  return newName;
};


function assignCanonicalNames(scc, rels, relAlias) {
  const newAlias = scc.reduce( (newAlias,relName) => {
    newAlias[relName] = theID(relAlias, rels[relName].def, scc, relName);
    return newAlias;
  }, {});
  const newNames = [...new Set(Object.values(newAlias))];
  const sccCanonicalName = newNames.sort().join(":");
  console.log(` --- SCC: {${scc.join(",")}} -> ${sccCanonicalName}`);
  for (let relName in newAlias) {
    relAlias[relName] = hash(newAlias[relName]+":"+sccCanonicalName);
    console.log(`  ${relName} -> ${relAlias[relName]}`);
  };  
}


export default { assignCanonicalNames };
export { assignCanonicalNames};
