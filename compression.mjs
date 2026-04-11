import { TypePatternGraph } from "./typing.mjs";

function asSet(vector) { 
  return Array.from(new Set(vector));
};

export function getCompressed(typePatternGraph) {
  const newTypePatternGraph = new TypePatternGraph(typePatternGraph.registerCodeDef, typePatternGraph.findCode);
  const renamed = typePatternGraph.cloneAll(newTypePatternGraph);

  newTypePatternGraph.turnSingletonPatternsIntoCodes();

  Object.keys(renamed).forEach( id => {
    renamed[id] = newTypePatternGraph.find(renamed[id]);
  });

  const rootPatternIds = newTypePatternGraph.patterns.nodes.map((x,i) => i)
  .filter(x => newTypePatternGraph.find(x) == x);

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

  const compressedTypePatternGraph = new TypePatternGraph(typePatternGraph.registerCodeDef, typePatternGraph.findCode);
  const newIds = {};
  for (const eqClass of equivalence) {
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
    if (pattern.pattern == 'type') 
      continue;
    const edges = newTypePatternGraph.edges[oldId];
    compressedTypePatternGraph.edges[newId] = {};
    for (const lab in edges) {
      compressedTypePatternGraph.edges[newId][lab] = asSet(edges[lab].map(x => 
        newIds[reps[newTypePatternGraph.find(x)][0]]));
    }
  }

  const remapping = Object.keys(renamed).reduce( (remapping,id) => {
    return {...remapping, [id]: newIds[ reps[renamed[id]][0] ]};
  }, {});
  
  return {typePatternGraph: compressedTypePatternGraph, remapping};
}
