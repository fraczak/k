import { parse } from "./parser.mjs";
import t from "./codes.mjs";
import p from "./patterns.mjs";

function finalize(codes) {
  const representatives = t.minimize(codes).representatives;
  return {
    codes: t.normalizeAll(codes, representatives),
    representatives,
  };
}

function getRep(eq) {
  return function (i, j) {
    while (eq[i] !== i) { i = eq[i]; }
    return [j,i];
  }
}
function test(script) {
  const { defs, exp } = parse(script);
  const { codes, representatives } = finalize(defs.codes);

  const rels = {...defs.rels, "__main__": [exp]};

  const t = p.patterns(codes, representatives, rels);

  console.log(JSON.stringify(t, null, 2));
  console.log(JSON.stringify(t.eq.map(getRep(t.eq))));
  console.log(JSON.stringify(rels, null, 2));
  console.log(JSON.stringify({nodes: t.newPatternNodes, edges: t.newPatternEdges, pNodes: t.pNodes}, null, 2) );
}

export default { test };
export { test };

