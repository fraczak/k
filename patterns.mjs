const emptyPat = new Pattern("union",true); 
const starPat = new Pattern(); 
function isEmptyPat(pat) {
  const {kind, closed, fields} = pat;
  return kind === 'union' && closed && fields.size === 0;
}

function areMapsEqual(m1, m2) {
  return m1.size === m2.size && Array.from(m1.keys()).every((key) => 
    m1.get(key) === m2.get(key));
}

function cap(pat1, pat2, eq) {
  if (pat1 === pat2) return pat1;
  let kind, fields;
  if (pat1.kind === null) {
    kind = pat2.kind;
  } else if (pat2.kind === null) {
    kind = pat1.kind;
  } else if (pat1.kind === pat2.kind) {
    kind = pat1.kind;
  } else 
    return emptyPat;
  
  const fieldNames = new Set([...pat1.fields.keys(), ...pat2.fields.keys()]);

  if ((pat1.closed && pat1.fields.size !== fieldNames.size) || 
      (pat2.closed && pat2.fields.size !== fieldNames.size))
    return emptyPat;
  
  fields = [...fieldNames].map(f => {
    if (!pat1.fields.has(f)) 
      return [f, findRep(eq, pat2.fields.get(f))];
    if (!pat2.fields.has(f))
      return [f, findRep(eq, pat1.fields.get(f))];
    return [f, union(eq, pat1.fields.get(f), pat2.fields.get(f))];
  });
  return new Pattern(kind, closed1 || closed2, fields);
}  

class Pattern {
  constructor(type=null, closed=null, fields=null) {
    this.code = null; // null or normalized type
    this.type = type; // null, "union", "product"
    this.closed = closed; // true, false (=null)
    this.fields = new Map(fields); // Map<field, PatternIdx>
  }
  isEmpty() {
    return isEmptyPat(this);
  }
}

function annotate(rel, patterns) {
  const i = patterns.length;
  patterns.push(new Pattern()); 
  const o = patterns.length;
  patterns.push(new Pattern());
  rel.patterns = [i, o];
  switch (rel.op) {
    case "product":
      rel["product"].forEach(({label, exp}) => annotate(exp, patterns));
      break;
    case "union":
    case "vector":
      rel[rel.op].forEach((exp) => annotate(exp, patterns));
  }
}

function union(eq,i,j) {
  const ri = findRep(eq,i);
  const rj = findRep(eq,j);
  if (ri !== rj) {
    if (Number.isInteger(ri)) {
      eq[ri] = rj;
      return rj;
    } else if (Number.isInteger(rj)) {
      eq[rj] = ri;
      return ri;
    } else
      throw new Error("Cannot have two different codes in the same equivalence class");
  }
  return rj;
}

function findRep(eq, i) {
  if (!Number.isInteger(i)) return i;
  let j = i;
  const path = [];
  while (eq[j] !== j) {
    path.push(j);
    j = eq[j];
  }
  path.forEach((k) => (eq[k] = j));
  return j;
}

function inspect(rel, patterns, eq) {
  let changed = false;
  switch (rel.op) {
    case "code":
      if ((findRep(eq,rel.patterns[0]) != rel.code) || 
          (findRep(eq,rel.patterns[1]) != rel.code)) {
        changed = true;
        union(eq, eq,rel.patterns[0], union(eq, rel.patterns[1], rel.code));
        return true;
      }
    case "product":
      // TODO: 
      break;
    case "union":
    case "vector":
     
  }
}

function patterns(codes, representatives, rels) {
  // will return annotated rels; each rel will have a pair of "patterns" property (inCode, outCode)
  // 1. initialize patterns (vector of patterns))
  const patterns = [];
  for (const relName in rels) {
    const defs = rels[relName];
    for (const def of defs) { annotate(def, patterns); }
  }
  const eq = patterns.map((_, i) => i); // equivalence classes (int = pattern index, str = code name)

  // 2. loop until no more changes
  let changed = true;
  while (changed) { 
    changed = false;
    for (const relName in rels) {
      const defs = rels[relName];
      for (const def of defs) {
        changed = inspect(def, patterns, eq) || changed;
      }
    }
  }
  
}