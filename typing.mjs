import hash from "./hash.mjs";

const unitCode = hash('$C0={};');

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

const matchAllPattern = {pattern: '(...)', fields: []};
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

class TypePatternForest {
  constructor() {
    this.nodes = [];
    this.parent = [];
  }

  // Find the root of the set containing `x`
  find(x) {
    if (this.nodes[x] == undefined) 
      throw new Error(`Node of id='${x}' not found in the forest`);
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

class TypePatternGraph {
  constructor(codes = {}) {
    this.codes = codes;
    this.patterns = new TypePatternForest();
    this.edges = []; // an edge at index i is a map {lab: asMapSet([i1,...]), ...}
                     // representing `patterns.node[i] --[lab]--> {i1:i1,...}, ...
    this.codeId = { }; // type-name -> index
  }

  get_pattern(id) {
    return this.patterns.nodes[this.find(id)];
  }

  find(id) {
    return this.patterns.find(id);
  }

  clone(roots,targetGraph = this) { 
    const result = {}; // mapping from original ids to cloned ids
    const find = (x) => this.patterns.find(x);
    let ids = [...roots];
    while (ids.length > 0) {
      const old_id = ids.pop();
      const i = find(old_id);
      if (i in result) {
        result[old_id] = result[i];
        continue;
      }
      const cloned = targetGraph.patterns.addNewNode(this.patterns.nodes[i]);
      result[i] = cloned;
      result[old_id] = cloned;
      const edges = this.edges[i];
      for (const lab in edges) {
        ids = ids.concat(Object.values(edges[lab]));
      }
    }
    for (const i in result) {
      if (i != find(i)) continue;
      const edges = this.edges[i];
      const new_id = result[i];
      targetGraph.edges[new_id] = {};
      for (const lab in edges) {
        targetGraph.edges[new_id][lab] = asMapSet(Object.values(edges[lab]).map(x => result[find(x)]));
      }
    }
    return result;
  }

  cloneAll(targetGraph = this) {
    return this.clone(this.patterns.nodes.map((x,i) => i), targetGraph);
  }

  unify_two_patterns(p1, p2) {
    // console.log(`unify_two_patterns(${JSON.stringify(p1)}, ${JSON.stringify(p2)})`);
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
          case 'type': {
              const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
              switch (code.code) {
                case 'int':
                  // supports (2 .2) which returns unit
                  if (p1.fields.every(x => `${x}`.match(/^[0-9]+$/))) 
                    return p2;
                  break;
                case 'string':
                  return p2;
                case 'bool':
                  if (p1.fields.every(x => `${x}`.match(/^true|false$/)))
                    return p2;
                  break;
                case 'product':
                case 'union': {
                  let p2_fields = Object.keys(code[code.code]);
                  if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
                }; break;
                case 'vector':
                  return {...p2, fields: ['vector-member']};
              }
              throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
            }
          } ;
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
          case 'type': {
            const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
            switch (code.code) {
              case 'product':{
                let p2_fields = Object.keys(code[code.code]);
                if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              };
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          }
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
          case 'type':{
            const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
            switch (code.code) {
              case 'union': {
                let p2_fields = Object.keys(code[code.code]);
                if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              }
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          };
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
          case 'type':{
            const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
            switch (code.code) {
              case 'product':
              case 'union': {
                let p2_fields = Object.keys(code[code.code]);
                if (eqsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              }
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          };
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
          case 'type': {
            const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
            switch (code.code) {
              case 'vector':  
                return {...p2, fields: ['vector-member']};
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          };
        };    
        break;
      case '{}':
        switch (p2.pattern) {
          case '{}':
            if (eqsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify {${p1.fields}} with {${p2.fields}}`);
          case '<>':
            throw new Error('Cannot unify {} with <>');
          case 'type': {
            const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
            switch (code.code) {
              case 'product':{
                let p2_fields = Object.keys(code[code.code]);
                if (eqsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              };
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          }
        };
        break;
      case '<>':
        switch (p2.pattern) {
          case '<>':
            if (eqsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify <${p1.fields}> with <${p2.fields}>`);
          case 'type': {
            const code = this.codes[p2.type] || {code: p2.type, def: "build-in"};
            switch (code.code) {
              case 'union':{
                let p2_fields = Object.keys(code[code.code]);
                if (eqsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              };
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          }
        };
        break;
      case 'type':
        switch (p2.pattern) {
          case 'type': 
            if (p1.type != p2.type)
              throw new Error(`Cannot unify different types: ${p1.type} and ${p2.type}`);
            return p2;
        };
        break;
    }
    return this.unify_two_patterns(p2, p1);
}  


  unify_patterns(...patterns) {  
    const unify_two_patterns = this.unify_two_patterns.bind(this);
    return patterns.reduce(unify_two_patterns, {pattern: '(...)', fields: []});
  }

  unify(rule, ...ids) {
    const find = (x) => this.patterns.find(x);
    const reps = Object.values(asMapSet(ids.map(find)));
    if (reps.length < 2) return false;
    const rep_patters = reps.map(x => {
      const pattern = this.patterns.nodes[x];
      const fields = Object.keys(this.edges[x]);
      return {...pattern, fields: fields};
    });
    const new_pattern = {...this.unify_patterns(...rep_patters), rule : rule};
    const new_id = this.patterns.addNewNode(new_pattern, reps);
    this.edges[new_id] = {};

    for (const i of reps) {
      const edges = this.edges[i];
      for (const lab in edges) {
        const new_edges = this.edges[new_id][lab] || {};
        // if the pattern is [] all labels are treated as 'vector-member'
        const new_lab = new_pattern.pattern == '[]' ? 'vector-member' : lab;
        this.edges[new_id][new_lab] = {...new_edges, ...edges[new_lab]};
      }
    }
    // add stuff for types
    if (new_pattern.pattern == 'type') {
      const code = this.codes[new_pattern.type] || {code: new_pattern.type, def: "build-in"};
        switch (code.code) {
          case 'int':
          case 'string':
          case 'bool': {
            // all edges are goin to unit type
            const unit_id = this.getTypeId(unitCode);
            for (const lab in this.edges[new_id]) {
              this.edges[new_id][lab][unit_id] = unit_id;
            }
          }; break;
          case 'product':
          case 'union':{
            const type_fields = Object.keys(code[code.code]);
            for (const lab of type_fields) {
              const target_type_id = this.getTypeId(code[code.code][lab]);
              this.edges[new_id][lab] = {...this.edges[new_id][lab], [target_type_id]: target_type_id};
            }
          }; break;
          case 'vector': {
            const target_type_id = this.getTypeId(code[code.code]['vector-member']);
            this.edges[new_id]['vector-member'] = 
              asMapSet(
                setUnion(
                  [target_type_id],
                  this.edges[new_id].map(x => Object.values(x))
                )
              );
            }
        }
    }
    for ( const aSet of Object.values(this.edges[new_id]) )
      this.unify(rule, ...Object.values(aSet));      

    return true;
  }

  addNewNode(pattern = matchAllPattern, vec_edges = {}) {
    const id = this.patterns.addNewNode(pattern);
    const find = (x) => this.patterns.find(x);
    this.edges[id] = {};
    for (const [lab,dest] of Object.entries(vec_edges)) {
      this.edges[id][lab] = asMapSet(dest.map(find));
    }
    return id;
  }

  getTypeId(type) {
    if ( this.codeId[type] == undefined )
      this.codeId[type] = this.addNewNode({pattern: 'type', type: type});
    return this.codeId[type];
  }

}

export {TypePatternForest, TypePatternGraph};
export default {TypePatternForest, TypePatternGraph};