export { Pattern } from './Pattern.mjs';
export { PatternGraph } from './PatternGraph.mjs';
export { TypeDerivation } from './TypeDerivation.mjs';
export { unifyPatterns, unifyTwo } from './Unification.mjs';

// Example usage:
//
// import { TypeDerivation } from './index.mjs';
//
// const codeRegistry = new Map([
//   ['nat', { type: 'union', fields: { zero: '{}', succ: 'nat' } }],
//   ['{}', { type: 'product', fields: {} }]
// ]);
//
// const program = {
//   rels: {
//     swap: {
//       op: 'product',
//       product: [
//         { label: 'a', exp: { op: 'dot', dot: 'y', patterns: [] } },
//         { label: 'b', exp: { op: 'dot', dot: 'x', patterns: [] } }
//       ],
//       patterns: []
//     }
//   }
// };
//
// const derivation = new TypeDerivation(codeRegistry);
// const result = derivation.derive(program);
//
// for (const [name, relDef] of result) {
//   const [inId, outId] = relDef.def.patterns;
//   const inPattern = relDef.graph.getPattern(relDef.graph.find(inId));
//   const outPattern = relDef.graph.getPattern(relDef.graph.find(outId));
//   console.log(`${name}: ${inPattern.type} -> ${outPattern.type}`);
// }
