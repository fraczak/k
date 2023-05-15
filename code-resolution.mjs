function resolveCode(rel, inCode, outCode) {
  const annotatedRel = {inCode, outCode, rel};
  return annotatedRel;
}

// pat:  { kind: [null, 'product', 'union'],
//         closed: [true, false],
//         fields: [{f: string, pat: pat}, ...]}
const emptyPat = { kind: 'union', closed: true, fields: [] };
const starPat = { kind: null, closed: false, fields: [] };
function isEmptyPat(pat) {
  const {kind, closed, fields} = pat;
  return kind === 'union' && closed && fields.length === 0;
}

function cap(pat1, pat2) {
  if (pat1 === pat2) return pat1;
  const {kind:kind1, closed:closed1, fields:fields1} = pat1;
  const {kind:kind2, closed:closed2, fields:fields2} = pat2;
  let kind, fields;
  if (kind1 === null) {
    kind = kind2;
  } else if (kind2 === null) {
    kind = kind1;
  } else if (kind1 === kind2) {
    kind = kind1;
  } else 
    return emptyPat;
  
  const map1 = new Map(fields1.map(({f, pat}) => [f, pat]));
  const map2 = new Map(fields2.map(({f, pat}) => [f, pat]));
  const fieldNames = new Set([...map1.keys(), ...map2.keys()]);
  fields = [...fieldNames].map(f => {
    const pat1 = map1.get(f) || starPat;
    const pat2 = map2.get(f) || starPat;
    const pat = cap(pat1, pat2);
    return {f, pat};
  });
  if (fields.some(({pat}) => isEmptyPat(pat))) {
    return emptyPat;
  }
  if ((closed1 && fields1.length !== fields.length) || (closed2 && fields2.length !== fields.length)) {
    return emptyPat;
  }
  return {kind, closed: closed1 || closed2, fields};
}  


export default { cap, starPat, emptyPat, isEmptyPat, resolveCode };
export { cap, starPat, emptyPat, isEmptyPat, resolveCode };

