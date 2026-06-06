
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
    return Value.variant(field, fromObject(obj[field]));
  } 
  return Value.product(
    fields.reduce( (result, field) => {
      result[field] = fromObject(obj[field]);
      return result;
    }, {})
  );
};

function isObject(value) {
  return value !== null && typeof value === "object";
}

function isProduct(value) {
  return isObject(value) &&
    value.type === "{}" &&
    isObject(value.product) &&
    !Array.isArray(value.product);
}

function isVariant(value) {
  return isObject(value) &&
    value.type === "<>" &&
    typeof value.tag === "string" &&
    Object.hasOwn(value, "value");
}

function isValue(value) {
  return isProduct(value) || isVariant(value);
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
  if (value.pattern === pattern) return value;
  if (isProduct(value)) return Value.product(value.product, pattern);
  if (isVariant(value)) return Value.variant(value.tag, value.value, pattern);
  return value;
}

class Value {
  constructor(fields) {
    Object.assign(this, fields);
  }

  static product(product, pattern = null) {
    return new Value({ type: "{}", pattern, product });
  }

  static variant(tag, value, pattern = null) {
    return new Value({ type: "<>", pattern, tag, value });
  }

  toString() {
    if (isVariant(this)) {
      // return `{${JSON.stringify(this.tag)}:${this.value.toString()}}`;
      return `${this.value.toString()}|${pLabel(this.tag)}`;
    }
    if (isProduct(this)) {
      return `{${Object.entries(this.product).map(([k, v]) => `${JSON.stringify(k)}:${v.toString()}`).join(',')}}`;
    }
    return String(this.type);
  }

  toJSON() {
    if (isVariant(this)) {
      if (isProduct(this.value) && Object.keys(this.value.product).length === 0) {
        return this.tag;
      }
      return {[this.tag]: this.value.toJSON()};
    }
    if (!isProduct(this)) return { type: this.type };
    let vector = toVector(this.product);
    if (vector.length > 0) return vector;
    return this.product; 
  }
}
export { Value, fromObject, cloneSubpattern, edgeSubpattern, composePattern, mergePatterns, withPattern, isProduct, isVariant, isValue };
export default { Value, fromObject, cloneSubpattern, edgeSubpattern, composePattern, mergePatterns, withPattern, isProduct, isVariant, isValue };
