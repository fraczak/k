import { Graph } from "./Graph.mjs";
import { unify_two_patterns } from "./unification.mjs";
import { getCompressed } from "./compression.mjs";
import { TypePatternForest } from "./TypeGraph.mjs";

function asSet(vector) { 
  return Array.from(new Set(vector));
};

const matchAllPattern = {pattern: '(...)', fields: []};
/*
$Pattern = < 
  string code, 
  open? product, 
  open? union, 
  open? unknown
>;
$open? = < {} open, {} closed >;

we use the string notation: 
'(...)' | '{...}' | '<...>' |  '()'  |  '{}'  | '<>'  | 'type'
e.g.:
{pattern: '()'}, 
{pattern: '<...>'}
{pattern: 'type', type: code_name}
*/

class TypePatternGraph {
  constructor(registerCodeDef, findCode) {
    this.patterns = new TypePatternForest();
    this.edges = []; // an edge at index i is a map {lab: asMapSet([i1,...]), ...}
                     // representing `patterns.node[i] --[lab]--> {i1:i1,...}, ...
    this.codeId = { }; // type-name -> index
    this.registerCodeDef = registerCodeDef;
    this.findCode = findCode;
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
        
        default: 
          throw new Error(`Unexpected pattern ${JSON.stringify(pattern)}`);
      }
    } 
    //        - add them all to 'codes'
    const representatives  = this.registerCodeDef(newCodeDefs);

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
    return getCompressed(this);
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

  unify_patterns(...patterns) {  
    const unifyFn = unify_two_patterns.bind(null, this.findCode);
    return patterns.reduce(unifyFn, {pattern: '(...)', fields: []});
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
    this.edges[new_id] = this.edges[new_id] || {};

    for (const i of reps) {
      const edges = this.edges[i];
      for (const lab in edges) {
        const dests = asSet(edges[lab].map(find));
        this.edges[new_id][lab] = asSet([...(this.edges[new_id][lab] || []), ...dests]);
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
    if ( this.codeId[type] == undefined ) {
      const code = this.findCode(type);
      if (code == undefined)
        throw new Error(`Type '${type}' is not defined in codes.`);
      const typeId = this.patterns.addNewNode({pattern: 'type', type: type});
      this.codeId[type] = typeId
      this.edges[typeId] = {};
      for ( const [lab, destType] of Object.entries(code[code.code]) ) {
        const destTypeId = this.getTypeId(destType);
        this.edges[typeId][lab] = asSet([destTypeId]);
      }
    }
    return this.codeId[type];

  }

  size() {
    const typeNodes = this.patterns.nodes.filter(x => x.pattern == 'type').length;
    return [this.patterns.nodes.length,typeNodes];
  }
}

export { TypePatternGraph };
export default { TypePatternGraph };