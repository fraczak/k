import hash from "./hash.mjs";

const unitCode = hash('$C0={};'); 

const identity = {op: "identity"}

function is_identity_rel(rel) {
  return rel.op === "identity";
}

function is_constant_rel(rel) {
  switch (rel.op) {
    case "int":
    case "str":
      return true;
    case "vector":
      return Object.values(rel[rel.op]).every(is_constant_rel);
    case "product":
      return Object.values(rel[rel.op]).every(({ exp }) =>
        is_constant_rel(exp)
      );
    default:
      return false;
  }
}

function is_empty_rel(rel) {
  return rel.op === "union" && rel.union.length === 0;
}

function is_full_rel(rel) {
  if (is_constant_rel(rel)) return true;
  switch (rel.op) {
    case "int":
    case "str":
    case "identity":
      return true;
    case "comp":
      return rel.comp.every(is_full_rel);
    case "vector":
      return Object.values(rel[rel.op]).every(is_full_rel);
    case "product":
      return Object.values(rel[rel.op]).every(({ exp }) =>
        is_full_rel(exp)
      );
    default:
      return false;
  }
}

function comp_first(e1, e2) {
  if (is_identity_rel(e1)) return e2;
  if (is_identity_rel(e2)) return e1;
  if (is_empty_rel(e1)) return e1;
  // if (is_empty_rel(e2)) return e2;
  if (e1.op === "comp" && e2.op === "comp") {
    return {
      op: "comp",
      comp: [].concat(e1.comp, e2.comp),
    };
  }
  if (e1.op === "comp") {
    return {
      op: "comp",
      comp: [].concat(e1.comp, [e2]),
    };
  }
  if (e2.op === "comp") {
    return {
      op: "comp",
      comp: [].concat([e1], e2.comp),
    };
  }
  return {
    op: "comp",
    comp: [e1, e2],
  };
}

function comp(e1, e2) {
  const result = comp_first(e1, e2);
  if (result.op !== "comp") return result;
  result.comp = result.comp.reduceRight(
    (c, e) => (c[0] && is_constant_rel(c[0]) && is_full_rel(e) ? c : [e, ...c]),
    []
  );
  return result;
}


function union(rels) {
  const list = [];
  label: for (const rel of rels) {
    const new_rels = rel.op === "union" ? rel.union : [rel];
    for (const new_rel of new_rels) {
      list.push(new_rel);
      // if (is_full_rel(new_rel)) break label;
    }
  }
  if (list.length === 1) return list[0];
  return {
    op: "union",
    union: list,
  };
}

class SymbolTable {
  constructor() {
    this.rels = {}; // name -> {def: rel_exp}
    this.codes = {
      [unitCode]: {
        code: "product",
        product: {},
      },
    };
  }

  as_ref(codeExp) {
    if (codeExp.code === "ref") return codeExp.ref;
    const newName = `:${Object.keys(this.codes).length}`;
    this.codes[newName] = codeExp;
    return newName;
  }

  add_rel(name, rel) {
    if (this.rels[name] != undefined)
      console.error(`SymbolTable: rel ${name} already defined (lines ${rel.start?.line}:${rel.start?.column}...${rel.end?.line}:${rel.end?.column})`);

    this.rels[name] = {def: rel};
  }

  add_code(name, code) {
    this.codes[name] = code;
  }
}

export default { SymbolTable, comp, union, identity };
export { SymbolTable, comp, union, identity };

