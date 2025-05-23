import { Graph } from "./Graph.mjs";
import codes from "./codes.mjs";

const unitCode = codes.unitCode;

function asSet(vector) { 
  return Array.from(new Set(vector));
};

function setUnion(...vectors) {
  const unionSet = new Set();
  for (const v of vectors) {
    for (const element of v) {
      unionSet.add(element);
    }
  }
  return Array.from(unionSet);
}

function subsetP(v1,v2) {
  const v2Set = new Set(v2);
  return v1.every(x => v2Set.has(x));
}

function eqsetP(v1,v2) {
  const v1Set = new Set(v1);
  const v2Set = new Set(v2);
  if (v1Set.size != v2Set.size) return false;

  for (const value of v1Set) {
    if (!v2Set.has(value)) {
      return false;
    }
  }
  return true;
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
      if (parent == result) {
        console.log("Can happen a loop in the forest? It shouldn't!");
        break;
      }
        
    }
    return result;
  }

  addChildren(parentId, childrenIds) {
    const parent = this.find(parentId);
    childrenIds.forEach(childId => {
      const child = this.find(childId);
      if (this.nodes[child].pattern != 'type')
        this.parent[child] = parent;
    });
  }

  addNewNode(flatTypePattern, children = []) {
    const that = this;
    const id = this.nodes.length;
    // const node = {...flatTypePattern, _id: id};
    const node = {...flatTypePattern}
    that.nodes.push(node);
    Array.from(new Set(children.map(that.find.bind(that))))
    .forEach(rep => {that.parent[rep] = id});
    return id;
  }
}

class TypePatternGraph {
  constructor() {
    this.patterns = new TypePatternForest();
    this.edges = []; // an edge at index i is a map {lab: asMapSet([i1,...]), ...}
                     // representing `patterns.node[i] --[lab]--> {i1:i1,...}, ...
    this.codeId = { }; // type-name -> index
  }

  turnSingletonPatternsIntoCodes() {
    const singletonPatterns = this.findSingletonPatterns();
    const newCodeDefs= {}
    for(const patternId of singletonPatterns) {
      const pattern = this.get_pattern(patternId);
      switch (pattern.pattern) {
        case '<>': 
        case '{}': {
          const code = (pattern.pattern == '<>') ? 'union' : 'product';
          const fieldsWithDest = this.edges[patternId];
          newCodeDefs[`-${patternId}-`] = {
            code: code,
            [code]: Object.keys(fieldsWithDest).reduce((fields, lab) => {
              const auxDests = Object.values(fieldsWithDest[lab]).map(id => this.find(id));
              const destAsMapSet = auxDests.reduce( (mapSet, x) => ({...mapSet, [JSON.stringify(x)]: x}), {});
              const dests = Object.values(destAsMapSet);
              if (dests.length != 1) {
                throw new Error(`Expected one destination for ${lab} in ${patternId}`); 
              }
              const destPattern = this.get_pattern(dests[0]);
              fields[lab] = (destPattern.pattern == 'type') ? destPattern.type : `-${dests[0]}-`;
              return fields;
            }, {})
          }; 
        }; break;
        case '[]': {
          const auxDests = Object.values(this.edges[patternId]["vector-member"]).map(id => this.find(id));
          const destAsMapSet = auxDests.reduce( (mapSet, x) => ({...mapSet, [JSON.stringify(x)]: x}), {});
          const dests = Object.values(destAsMapSet);
          if (dests.length != 1) {
            // console.log(dests.map(d => this.get_pattern(d)));
            throw new Error(`Expected one destination 'vector-member' in ${JSON.stringify(pattern)}, but got ${JSON.stringify(dests)}`); 
          }
          const destPattern = this.get_pattern(dests[0]);
          newCodeDefs[`-${patternId}-`] = {
            code: 'vector',
            vector: (destPattern.pattern == 'type') ? destPattern.type : `-${dests[0]}-`
          };
        }; break;
        default: 
          throw new Error(`Unexpected pattern ${JSON.stringify(pattern)}`);
      }
    } 
    //        - add them all to 'codes'
    const representatives  = codes.register(newCodeDefs);

    for( const id of singletonPatterns) {
      this.unify('singleton', id, this.getTypeId(representatives[`-${id}-`]));
    }
  }


  get_pattern(id) {
    return this.patterns.nodes[this.find(id)];
  }

  find(id) {
    return this.patterns.find(id);
  }

  findSingletonPatterns() {
    const gNodes = this.patterns.nodes.map((x,i) => i).filter(x => this.patterns.parent[x] == undefined);
    const gEdges = [].concat(
      ...gNodes.map(x => 
        [].concat( 
          ...Object.values(this.edges[x]).map( asMap =>
            [].concat(...Object.values(asMap).map(y => 
              ({src: x, dst: this.find(y)}))
            )
          )
        )
      )
    );

    const gEdgesWithoutParrallelEdges  = Array.from(new Set(gEdges));
    const gGraph = new Graph(gEdgesWithoutParrallelEdges);
    const queue = gNodes.filter(x => 
      this.patterns.nodes[x].pattern in {'()':1, '(...)':1,'{...}':1, '<...>':1});
    const excludedSet = new Set(queue);

    while (queue.length > 0) {
      const x = queue.pop();
      for (const e of gGraph.dst[x] || []) {
        const y = gGraph.edges[e].src;
        if (excludedSet.has(y)) continue;
        excludedSet.add(y);
        queue.push(y);
      }
    }

    return gNodes.filter(x => !((excludedSet.has(x)) || (this.patterns.nodes[x].pattern == 'type')));
  }

  getCompressed() {
    const newTypePatternGraph = new TypePatternGraph();
    const renamed = this.cloneAll(newTypePatternGraph);

    newTypePatternGraph.turnSingletonPatternsIntoCodes();

    Object.keys(renamed).forEach( id => {
      renamed[id] = newTypePatternGraph.find(renamed[id]);
    });

    // console.log("newTypePatternGraph", newTypePatternGraph);
    // console.log("nodes", newTypePatternGraph.patterns.nodes);
    // console.log("edges", newTypePatternGraph.edges);

    const rootPatternIds = newTypePatternGraph.patterns.nodes.map((x,i) => i)
    .filter(x => newTypePatternGraph.find(x) == x);

    // console.log("rootPatternIds", rootPatternIds);

    const equivalence = rootPatternIds.reduce( (equivalence,i) => {
      const pattern = newTypePatternGraph.get_pattern(i);
      switch (pattern.pattern) {
        case 'type':
        case '(...)':
        case '{...}':
        case '<...>':
          equivalence.push([i]);
          break; 
        default:
          equivalence[0].push(i);
      };
      return equivalence;
    }, [[]]).filter(x => x.length > 0);

    const reps = equivalence.reduce( (reps,eqClass) => {
      eqClass.forEach( x => reps[x] = eqClass);
      return reps;
    }, {});
    
    // console.log("equivalence", equivalence);

    let count = 0;
    const areDifferent = (i1,i2) => {
      count++;
      const p1 = newTypePatternGraph.get_pattern(i1);
      const p2 = newTypePatternGraph.get_pattern(i2);
      if (p1.pattern != p2.pattern) return true;
      const e1 = newTypePatternGraph.edges[i1];
      const e2 = newTypePatternGraph.edges[i2];
      if (Object.keys(e1).length != Object.keys(e2).length) return true;
      for (const lab in e1) {
        if (e2[lab] == undefined) return true;
        const dests1 = Object.values(e1[lab])[0];
        const dests2 = Object.values(e2[lab])[0];
        if (reps[dests1] != reps[dests2]) return true;
      }
      return false;
    }
    let changed = true;
    let count2 = 0;
    while (changed) {
      count2++;
      changed = false;
      const equivalenceSize = equivalence.length;
      for (let eqClassPos = 0; eqClassPos < equivalenceSize; eqClassPos++) {
        const eqClass = equivalence[eqClassPos];
        const oldClass = [eqClass[0]];
        const newClass = [];
        for (let i = 1; i < eqClass.length; i++) {
          if (areDifferent(oldClass[0],eqClass[i])) {
            newClass.push(eqClass[i]);
          } else {
            oldClass.push(eqClass[i]);
          }
        }
        if (newClass.length > 0) {
          changed = true;
          equivalence.push(newClass);
          equivalence[eqClassPos] = oldClass;
          for (const i of newClass) {
            reps[i] = newClass;
          }
          for (const i of oldClass) {
            reps[i] = oldClass;
          }
        }
      }
    }

    // console.log("equivalence (final)", equivalence);
    // console.log("reps", reps);

    const compressedTypePatternGraph = new TypePatternGraph();
    const newIds = {};
    for (const eqClass of equivalence) {
      // console.log("eqClass", eqClass);
      const oldId = eqClass[0];
      const pattern = newTypePatternGraph.get_pattern(oldId);
      const newId = (() => {
        if (pattern.pattern == 'type') return compressedTypePatternGraph.getTypeId(pattern.type);
        return compressedTypePatternGraph.patterns.addNewNode(pattern);
      })();
      newIds[oldId] = newId;
    }
    for (const oldId in newIds) {
      const newId = newIds[oldId];
      const pattern = newTypePatternGraph.get_pattern(oldId);
      // const newPattern = compressedTypePatternGraph.get_pattern(newId);
      // console.log("patterns", pattern, newPattern);
      if (pattern.pattern == 'type') 
        continue;
      const edges = newTypePatternGraph.edges[oldId];
      // console.log("edges", edges);
      compressedTypePatternGraph.edges[newId] = {};
      for (const lab in edges) {
        // console.log("edges[lab]", edges[lab]);
        compressedTypePatternGraph.edges[newId][lab] = asSet(edges[lab].map(x => 
          newIds[reps[newTypePatternGraph.find(x)][0]]));
      }
    }

    const remapping = Object.keys(renamed).reduce( (remapping,id) => {
      return {...remapping, [id]: newIds[ reps[renamed[id]][0] ]};
    }, {});
    
    // console.log("remapping", remapping);
    // console.log("compressedTypePatternGraph", compressedTypePatternGraph);
    // console.log("nodes", compressedTypePatternGraph.patterns.nodes);
    // console.log("edges", compressedTypePatternGraph.edges);
    // console.log("--------------------")

    return {typePatternGraph: compressedTypePatternGraph, remapping};
  }

  clone(roots,targetGraph = this) { 
    const result = {}; // mapping from original ids to cloned ids
    const find = (x) => this.find(x);
    let ids = [...roots];
    while (ids.length > 0) {
      const old_id = ids.pop();
      const i = find(old_id);
      if (i in result) {
        result[old_id] = result[i];
        continue;
      }
      const cloned = (pattern => {
        if (pattern.pattern == 'type') return targetGraph.getTypeId(pattern.type);
        return targetGraph.patterns.addNewNode(pattern);
      })(this.patterns.nodes[i]);
      result[i] = cloned;
      result[old_id] = cloned;
      if (this.patterns.nodes[i].pattern == 'type') 
        continue;
      const edges = this.edges[i];
      for (const lab in edges) {
        ids = ids.concat(Object.values(edges[lab]));
      }
    }
    for (const i in result) {
      if (i != find(i)) continue;
      if (this.patterns.nodes[i].pattern == 'type') 
        continue;
      const edges = this.edges[i];
      const new_id = result[i];
      targetGraph.edges[new_id] = {};
      for (const lab in edges) {
        targetGraph.edges[new_id][lab] = asSet(edges[lab].map(x => result[find(x)]));
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
            if (p1.fields.every(x => `${x}`.match(/^[0-9]+$/))) return p2;
            throw new Error(`Cannot unify [] with (${p1.fields},...)`);
          case '{}':
            if (subsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify (${p1.fields},...) with {${p2.fields}}`);
          case '<>':
            if (subsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify (${p1.fields},...) with <${p2.fields}>`);
          case 'type': {
              const code = codes.find(p2.type);
              // console.log(JSON.stringify({p1,p2,code}));
              switch (code.code) {
                case '@bits':
                  if (p1.fields.length == 0)
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
            if (p1.fields.every(x => `${x}`.match(/^[0-9]+$/))) return p2;
            throw new Error(`Cannot unify [] with {${p1.fields},...}`);
          case '{}':
            if (subsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify {${p1.fields},...} with {${p2.fields}}`);
          case '<>':
            throw new Error('Cannot unify {...} with <>');
          case 'type': {
            const code = codes.find(p2.type);
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
            const code = codes.find(p2.type);
            switch (code.code) {
              case '@bits':
                return p2;
              case 'union': {
                let p2_fields = Object.keys(code[code.code]);
                if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              }
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          };
        }; 
        break;
      case '()': // Pattern '()' can be introduced by filter e.g., ?(X x, Y x)
        switch (p2.pattern) {
          case '()':
            if (eqsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify (${p1.fields}) with (${p2.fields})`);
          case '{}':
            if (eqsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify (${p1.fields}) with {${p2.fields}}`);
          case '[]':
            if (p1.fields.every(x => `${x}`.match(/^[0-9]+$/))) return p2;
            throw new Error(`Cannot unify [] with (${p1.fields})`);
          case '<>':
            if (eqsetP(p1.fields, p2.fields)) return p2;
            throw new Error(`Cannot unify (${p1.fields}) with <${p2.fields}>`);
          case 'type':{
            const code = codes.find(p2.type);
            switch (code.code) {
              case '@bits':
                return p2;
              case 'product':
              case 'union': {
                let p2_fields = Object.keys(code[code.code]);
                if (eqsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              }; break;
              case 'vector':
                if (p1.fields.every(x => `${x}`.match(/^[0-9]+$/))) 
                  return {...p2, fields: ['vector-member']};
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          };
        };
        break;
      case '[]':
        switch (p2.pattern) {
          case '{}':
            // if (p2.fields.every(x => `${x}`.match(/^[0-9]+$/))) 
            // return p1;
            throw new Error(`Cannot unify [] with {${p2.fields}}`);
          case '[]':
            return p1;
          case '<>':
            throw new Error('Cannot unify [] with <>');
          case 'type': {
            const code = codes.find(p2.type);
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
            const code = codes.find(p2.type);
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
            const code = codes.find(p2.type);
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
              throw new Error(`Cannot unify different types: ${p1.type}:${codes.find(p1.type).def} and ${p2.type}:${codes.find(p2.type).def}`);
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
    const find = (x) => this.find(x);
    const reps = Array.from(new Set(ids.map(find))); 
    if (reps.length < 2) return false;
    const rep_patters = reps.map(x => {
      const pattern = this.get_pattern(x);
      const fields = Object.keys(this.edges[x] || {});
      return {...pattern, fields: fields};
    });

    const new_pattern = (() => { try {
      return {...this.unify_patterns(...rep_patters), rule : rule}
    } catch (e) {
      e.message = `Unification rule "${rule}"\n - ${e.message}`;
      throw e;
    } })();
    const new_id = (() => {
      if (new_pattern.pattern == 'type') {
        const id = this.getTypeId(new_pattern.type);
        this.patterns.addChildren(id, reps);
        return id;
      };
      return this.patterns.addNewNode(new_pattern, reps);
    })();
    // console.log("    * new ", JSON.stringify({new_id, new_pattern}));
    // console.log("          ", JSON.stringify(rep_patters));
    this.edges[new_id] = {};

    for (const i of reps) {
      const edges = this.edges[i];
      for (const lab in edges) {
        // if the pattern is [] all labels are treated as 'vector-member'
        const new_lab = new_pattern.pattern == '[]' ? 'vector-member' : lab;
        const dests = asSet(edges[lab].map(find));
        this.edges[new_id][new_lab] = asSet([...(this.edges[new_id][new_lab] || []), ...dests]);
      }
    }
    // add stuff for types
    if (new_pattern.pattern == 'type') {
      const code = codes.find(new_pattern.type);
        switch (code.code) {
          case '@bits': {
            // all edges are goin to unit type
            const unit_id = this.getTypeId(unitCode);
            for (const lab in this.edges[new_id]) {
              this.edges[new_id][lab] = asSet([unit_id]);
            }
          }; break;
          case 'product':
          case 'union':{
            const type_fields = Object.keys(code[code.code]);
            for (const lab of type_fields) {
              const target_type_id = this.getTypeId(code[code.code][lab]);
              this.edges[new_id][lab]= asSet([...(this.edges[new_id][lab] ||[]), target_type_id]);
            }
          }; break;
          case 'vector': {
            
            const target_type_id = this.getTypeId(code.vector);

            this.edges[new_id] = {
              'vector-member': asSet([ target_type_id, ...[].concat(...Object.values(this.edges[new_id]))])
            }
          }
        }
    }
    for ( const lab of Object.keys(this.edges[new_id]) ) {
      this.unify(rule+'.', ...this.edges[new_id][lab]);      
    }

    return true;
  }

  addNewNode(pattern = matchAllPattern, fields = {}) {
    const id = this.patterns.addNewNode(pattern);
    const find = (x) => this.patterns.find(x);
    this.edges[id] = {};
    for (const [lab,dest] of Object.entries(fields)) {
      this.edges[id][lab] = asSet(dest.map(find));
    }
    return id;
  }

  getTypeId(type) {
    if (type == undefined) throw new Error("code name cannot be 'undefined'! "); //TODO: remove after testing
    if ( this.codeId[type] == undefined )
      this.codeId[type] = this.addNewNode({pattern: 'type', type: type});
    return this.codeId[type];
  }

  size() {
    const typeNodes = this.patterns.nodes.filter(x => x.pattern == 'type').length;
    return [this.patterns.nodes.length,typeNodes];
  }
}

export { TypePatternGraph };
export default { TypePatternGraph };