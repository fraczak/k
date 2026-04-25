
// const nameRE = /^[a-zA-Z0-9_][a-zA-Z0-9_?!]*$/;
const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function pLabel(label) {
  return nameRE.test(label) ? `${label}` : `${JSON.stringify(label)}`;
}
const getFields = obj => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error("Not a map!");
  }
  return Object.keys(obj);
};

function fromObject(obj) {
  const fields = getFields(obj);
  if (fields.length === 1) {
    const field = fields[0];
    return new Variant(field, fromObject(obj[field]));
  } 
  return new Product(
    fields.reduce( (result, field) => {
      result[field] = fromObject(obj[field]);
      return result;
    }, {})
  );
};

class Value {
  constructor(type, pattern = null) {
    this.type = type;
    this.pattern = pattern;
  }
  toString() {
    return `${this.constructor.name}(type: ${this.type})`;
  }
  toJSON() {
    return { type: this.type };
  }
}

function toVector(m) {
  let vector = [];
  for (let i = 0; i < Object.keys(m).length; i++) {
    if (m[i] === undefined) {
      vector = [];
      break;
    }
    vector.push(m[i]);
  }
  return vector;
}

function cloneSubpattern(pattern, root = 0) {
  if (!pattern || pattern.length === 0) return null;
  const visited = new Map();
  const nodes = [];

  function visit(nodeId) {
    if (visited.has(nodeId)) return visited.get(nodeId);
    const newId = nodes.length;
    visited.set(nodeId, newId);
    const [kind, edges] = pattern[nodeId];
    nodes.push([kind, []]);
    nodes[newId][1] = edges.map(([label, target]) => [label, visit(target)]);
    return newId;
  }

  visit(root);
  return nodes;
}

function edgeSubpattern(pattern, label) {
  if (!pattern || pattern.length === 0) return null;
  const [, edges] = pattern[0];
  const edge = edges.find(([edgeLabel]) => edgeLabel === label);
  if (!edge) return null;
  return cloneSubpattern(pattern, edge[1]);
}

function composePattern(kind, entries) {
  if (entries.some(([, childPattern]) => !childPattern)) return null;
  const result = [[kind, []]];

  for (const [label, childPattern] of entries) {
    const offset = result.length;
    result[0][1].push([label, offset]);
    for (const [childKind, childEdges] of childPattern) {
      result.push([
        childKind,
        childEdges.map(([edgeLabel, target]) => [edgeLabel, target + offset])
      ]);
    }
  }

  return result;
}

function mergePatterns(declared, observed) {
  if (!declared || declared.length === 0) return observed;
  if (!observed || observed.length === 0) return declared;
  const nodes = [];
  const cloneMemo = new Map();
  const mergeMemo = new Map();

  function cloneInto(sourceTag, pattern, nodeId) {
    const key = `${sourceTag}:${nodeId}`;
    if (cloneMemo.has(key)) return cloneMemo.get(key);
    const newId = nodes.length;
    cloneMemo.set(key, newId);
    const [kind, edges] = pattern[nodeId];
    nodes.push([kind, []]);
    nodes[newId][1] = edges.map(([label, target]) => [label, cloneInto(sourceTag, pattern, target)]);
    return newId;
  }

  function visit(declaredId, observedId) {
    if (declaredId == null) return cloneInto("o", observed, observedId);
    if (observedId == null) return cloneInto("d", declared, declaredId);

    const key = `${declaredId}|${observedId}`;
    if (mergeMemo.has(key)) return mergeMemo.get(key);

    const [declaredKind, declaredEdges] = declared[declaredId];
    const [observedKind, observedEdges] = observed[observedId];

    if (declaredKind === "any") return cloneInto("o", observed, observedId);
    if (observedKind === "any") return cloneInto("d", declared, declaredId);
    if (declaredKind !== observedKind) return cloneInto("d", declared, declaredId);

    const newId = nodes.length;
    mergeMemo.set(key, newId);
    nodes.push([declaredKind, []]);

    nodes[newId][1] = declaredEdges.map(([label, declaredTarget]) => {
      const observedEdge = observedEdges.find(([edgeLabel]) => edgeLabel === label);
      return [label, visit(declaredTarget, observedEdge ? observedEdge[1] : null)];
    });

    return newId;
  }

  visit(0, 0);
  return nodes;
}

function withPattern(value, pattern) {
  if (!pattern) return value;
  if (value instanceof Product) return new Product(value.product, pattern);
  if (value instanceof Variant) return new Variant(value.tag, value.value, pattern);
  return value;
}

class Product extends Value {
  constructor(product, pattern = null) {
    super("{}", pattern);
    this.product = Object.freeze({ ...product });
    Object.freeze(this);
  }

  toString() {
    return `{${Object.entries(this.product).map(([k, v]) => `${JSON.stringify(k)}:${v.toString()}`).join(',')}}`;
  }

  toJSON() {
    let vector = toVector(this.product);
    if (vector.length > 0) return vector;
    return this.product; 
  }
}

class Variant extends Value {
  constructor(tag, value, pattern = null) {
    super("<>", pattern);
    this.tag = tag;
    this.value = value;
    Object.freeze(this);
  }

  toString() {
    // return `{${JSON.stringify(this.tag)}:${this.value.toString()}}`;
    return `${this.value.toString()}|${pLabel(this.tag)}`;
  }

  toJSON() {
    if (this.value instanceof Product && Object.keys(this.value.product).length === 0) {
      return this.tag;
    }
    return {[this.tag]: this.value.toJSON()};
  }
}
export { Value, Product, Variant, fromObject, cloneSubpattern, edgeSubpattern, composePattern, mergePatterns, withPattern };
export default { Value, Product, Variant, fromObject, cloneSubpattern, edgeSubpattern, composePattern, mergePatterns, withPattern };
