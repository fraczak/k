
function asMapSet(vector) { 
  return vector.reduce( (mapSet, x) => ({...mapSet, [JSON.stringify(x)]: x}), {})
};

function setUnion(...vectors) {
  return Object.values(asMapSet([].concat(...vectors)));
}

function subsetP(v1,v2) {
  const v2Set = asMapSet(v2);
  return Object.keys(asMapSet(v1)).every(x => x in v2Set);
}
function eqsetP(v1,v2) {
  return subsetP(v1,v2) && subsetP(v2,v1);
}

/*
$Pattern = < 
  string code, 
  open? product, 
  open? union, 
  {} vector, 
   open? unknown
>;
$open? = < {} open, {} closed >;

we use the string notation: 
'(...)' | '{...}' | '<...>' |  '()'  |  '[]'  |  '{}'  | '<>'  | 'type'
e.g.:
{pattern: '()'}, 
{pattern: '<...>'}
{pattern: 'type', type: code_name}
*/

function f_unify(p1, p2) {
  switch (p1.pattern) {
    case '(...)':
      switch (p2.pattern) {
        case '(...)':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '{...}':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '<...>':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '()':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields},...) with (${p2.fields})`);
        case '[]':
          return p2;
        case '{}':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields},...) with {${p2.fields}}`);
        case '<>':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields},...) with <${p2.fields}>`);
        case 'type':
          // TODO: check if p2.type includes all fields of p1!!!!
          return p2;
      };
      break;
    case '{...}':
      switch (p2.pattern) {
        case '{...}':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '<...>':
          throw new Error('Cannot unify {...} with <...>');
        case '()':
          if (subsetP(p1.fields, p2.fields))
            return {pattern: '{}', fields: p2.fields};
        case '[]':
          return p2;
        case '{}':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify {${p1.fields},...} with {${p2.fields}}`);
        case '<>':
          throw new Error('Cannot unify {...} with <>');
        case 'type':
          // TODO: check if p2.type is a product type with all fields of p1!!!!
          return p2;
      };
      break;
    case '<...>':
      switch (p2.pattern) {
        case '<...>':
          return {pattern: '<...>', fields: setUnion(p1.fields, p2.fields)};
        case '()':
          if (subsetP(p1.fields, p2.fields))
            return {pattern: '<>', fields: p2.fields};
          throw new Error(`Cannot unify <${p1.fields},...> with (${p2.fields})`);
        case '[]':
          throw new Error('Cannot unify <...> with []');
        case '{}':
          throw new Error('Cannot unify <...> with {}');
        case '<>':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify <${p1.fields},...> with <${p2.fields}>`);
        case 'type':
          //TODO: check if p2.type is a union type with all fields of p1!!!!
          return p2;
        }; 
        break;
    case '()':
      switch (p2.pattern) {
        case '()':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields}) with (${p2.fields})`);
        case '{}':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields}) with {${p2.fields}}`);
        case '[]':
          return p2;
        case '<>':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields}) with <${p2.fields}>`);
        case 'type':
          // TODO: check the fields!!!
          return p2;
      };
      break;
    case '[]':
      switch (p2.pattern) {
        case '[]':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify [${p1.fields}] with [${p2.fields}]`);
        case '{}':
          return p1;
        case '<>':
          throw new Error('Cannot unify [] with <>');
        case 'type':
          //TODO: check if p2.type is a vector type!!!!
          return p2;
      };    
      break;
    case '{}':
      switch (p2.pattern) {
        case '{}':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify {${p1.fields}} with {${p2.fields}}`);
        case '<>':
          throw new Error('Cannot unify {} with <>');
        case 'type':
          //TODO: check if p2.type is a product type and fields!!!!
          return p2;
      };
      break;
    case '<>':
      switch (p2.pattern) {
        case '<>':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify <${p1.fields}> with <${p2.fields}>`);
        case 'type':
          //TODO: check if p2.type is a union type and fields!!!!
          return p2;
      };
      break;
    case 'type':
      switch (p2.pattern) {
        case 'type': 
          if (p2.type != p2.type)
            throw new Error(`Cannot unify different types: ${p1.type} and ${p2.type}`);
          return p2;
      };
      break;
  }
  console.log('p1', p1, 'p2', p2);
  return f_unify(p2, p1);
}  

function flat_unify(...patterns) {  
  return patterns.reduce(f_unify, {pattern: '(...)', fields: []});
}

class typePatternForest {
  constructor() {
    this.nodes = [];
    this.parent = [];
  }

  // Find the root of the set containing `x`
  find(x) {
    if (this.nodes[x] == undefined) 
      throw new Error(`Node index ${x} not found in the forest`);
    let result = x;
    let parent = this.parent[result];
    while (parent != undefined) {
      parent = this.parent[result = parent];
    }
    return result;
  }

  addNewNode(flatTypePattern, children = []) {
    const that = this;
    const id = this.nodes.length;
    const node = {...flatTypePattern, _id: id};
    that.nodes.push(node);
    Object.values(asMapSet(children.map(that.find.bind(that))))
    .forEach(rep => {that.parent[rep] = id});
    return id;
  }
}

class typePatternGraph {
  constructor() {
    this.patterns = new typePatternForest();
    this.edges = []; // an edge at index i is a map {lab: asMapSet([i1,...]), ...}
                     // representing `patterns.node[i] --[lab]--> {i1:i1,...}, ...
  }

  clone(ids,targetGraph = this) {
    const result = {}; // mapping from original ids to cloned ids
    const that = this;
    const find = that.patterns.find.bind(that.patterns);
    while (ids.length > 0) {
      const i = find(ids.pop());
      if (i in result) continue;
      const cloned = targetGraph.patterns.addNewNode(that.patterns.nodes[i]);
      result[i] = cloned;
      const edges = that.edges[i];
      for (const lab in edges) {
        ids = ids.concat(Object.values(edges[lab]));
      }
    }
    for (const i in result) {
      const edges = that.edges[i];
      targetGraph.edges[result[i]] = {};
      for (const lab in edges) {
        console.log('lab', lab, 'edges[lab]', edges[lab]);
        targetGraph.edges[result[i]][lab] = asMapSet(Object.values(edges[lab]).map(x => result[find(x)]));
      }
    }
    return result;
  }

  unify(rule, ...ids) {
    const that = this;
    const find = that.patterns.find.bind(that.patterns);
    const reps = Object.values(asMapSet(ids.map(find)));
    if (reps.length < 2) return false;
    const rep_patters = reps.map(x => {
      const pattern = that.patterns.nodes[x];
      const fields = Object.keys(that.edges[x]);
      return {...pattern, fields: fields};
    });
    const new_pattern = {...flat_unify(...rep_patters), rule : rule};
    const new_id = that.patterns.addNewNode(new_pattern, reps);
    that.edges[new_id] = {};
    for (const i of reps) {
      const edges = that.edges[i];
      for (const lab in edges) {
        const new_edges = that.edges[new_id][lab] || {};
        // if the pattern is [] all labels are treated as 'vector-member'
        const new_lab = new_pattern.pattern == '[]' ? 'vector-member' : lab;
        that.edges[new_id][new_lab] = {...new_edges, ...edges[new_lab]};
      }
    }
    for ( const aSet of Object.values(that.edges[new_id]) )
      that.unify(rule, ...Object.values(aSet));      

    return true;
  }


  addNewNode(pattern, vec_edges = {}) {
    const that = this;
    const id = this.patterns.addNewNode(pattern);
    that.edges[id] = {};
    for (const [lab,dest] of Object.entries(vec_edges)) {
      console.log('lab', lab, 'dest', dest);
      that.edges[id][lab] = asMapSet(dest.map(that.patterns.find.bind(that.patterns)));
    }
    return id;
  }

}
export {typePatternForest, typePatternGraph, flat_unify};
export default {typePatternForest, typePatternGraph, flat_unify};