import hash from "./hash.mjs";
import { TypePatternGraph } from "./TypePatternGraph.mjs";
import { Graph, sccs, topoOrder } from "./Graph.mjs";
import codes from "./codes.mjs";
import { augment } from "./augmentation.mjs";
import { assignCanonicalNames } from "./export.mjs";
import { convergeScc, relDefToString } from "./convergence.mjs";

function compileTypes(representatives, rels, options = {}) {
  // INPUT: 
  //   representatives: {"{}": "KL", ...} - mapping from types to their canonical names
  //   rels: {"rlz": {def: {op: comp,...}, ...}, ...} - relation definitions
  //   options: {
  //     convergence: {
  //       strategy: "auto" | "single_pass" | "fixed_point",  // type derivation strategy
  //       maxIterations: number  // max iterations for fixed_point (default: 2 + scc.length)
  //     }
  //   }
 
  const relAlias = {};
  const compileStats = {
    sccs: []
  };

  // 1 INITIALIZATION
  // 1.1 initialize patternNodes and rels
  // ==================================================================================
  // ----------------------------------------------------------------------------------
  // 1. Initialize the typePatternGraph and varRefs for each relation

  for (const relName in rels) {
    const rootDef = rels[relName];
    rootDef.typePatternGraph = new TypePatternGraph(codes.register, codes.find);
    rootDef.varRefs = []; // the list of references to non-builtin rels as pointers to AST nodes
    rootDef.patternVars = {};
    rootDef.rels = rels;
    rootDef.representatives = representatives; 
    augment(rootDef.def, rootDef, rels, representatives);
    delete rootDef.patternVars;
    delete rootDef.rels;
    delete rootDef.representatives;
  }
   
  
  // 2. Compute DAG of strongly connected components in varRefs
  //    A rel_1 -> rel_2 if rel1,varRefs contains a reference to {op: "ref", ref: rel_2}
  
  const graph = new Graph(
    // 1st argument: edges
    [].concat(...Object.keys(rels).map( relName => 
      rels[relName].varRefs.map( ({varName}) => 
        ({src: relName, dst: varName})))),
    // 2nd argument: vertices
    rels
  );

  const sccs_ = sccs(graph);

  const DAGnodes = sccs_.reduce ((nodes, scc) => 
    ({...nodes, [scc[0]]: {scc}}), {});
  const fromRelNameToDAGnode = Object.keys(DAGnodes).reduce((map, node) =>
    DAGnodes[node].scc.reduce((map, relName) => ({...map, [relName]: node}), map), {});
  const DAGedges = [].concat(
    ...Object.keys(rels).map( x =>
      rels[x].varRefs.map(({ varName }) => 
        ({src: fromRelNameToDAGnode[x], dst: fromRelNameToDAGnode[varName]})
      ) // don't forget to remove loops
      .filter(({src, dst}) => src !== dst )
    )
  );
  const DAG = new Graph(DAGedges, DAGnodes);

  // 3. Topological sort of the DAG

  const sccInOrder = topoOrder(DAG).reverse();

  // 4. For each strongly connected component C in a bottom-up order
  //    we will also generate the canonical representation of the relations in C and replace 
  //    the name to the relation by the hash of the canonical representation    

  for (const scc of sccInOrder) {
    const currentScc = DAGnodes[scc].scc;

    const convergenceStats = convergeScc(currentScc, rels, options.convergence);
    compileStats.sccs.push({
      members: [...currentScc],
      ...convergenceStats
    });

    currentScc.forEach( relName => {
      const relDef = rels[relName];
      const canonical = relDefToString(relDef);
      const h = hash(canonical);
      relAlias[relName] = h;
    });

    assignCanonicalNames(currentScc, rels, relAlias);
  }
  
  compileStats.sccCount = compileStats.sccs.length;
  return { relAlias, compileStats };
}

export default { compileTypes, assignCanonicalNames };
export { compileTypes, assignCanonicalNames };
