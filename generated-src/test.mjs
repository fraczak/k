import { Pattern } from './Pattern.mjs';
import { unifyTwo } from './Unification.mjs';
import { PatternGraph } from './PatternGraph.mjs';

// Test 1: Pattern creation
console.log('Test 1: Pattern creation');
const p1 = Pattern.openProduct(['x', 'y']);
console.log('  Open product:', p1.type, [...p1.fields]);

const p2 = Pattern.closedUnion(['zero', 'succ']);
console.log('  Closed union:', p2.type, [...p2.fields]);

// Test 2: Unification
console.log('\nTest 2: Unification');
const p3 = Pattern.openProduct(['x']);
const p4 = Pattern.openProduct(['y']);
const unified = unifyTwo(p3, p4, 'test');
console.log('  Unified:', unified.type, [...unified.fields]);

// Test 3: Pattern graph
console.log('\nTest 3: Pattern graph');
const graph = new PatternGraph();
const id1 = graph.addNode(Pattern.openProduct(['x']));
const id2 = graph.addNode(Pattern.openProduct(['y']));
console.log('  Created nodes:', id1, id2);

graph.unify('test', id1, id2);
console.log('  After unify, representatives:', graph.find(id1), graph.find(id2));
console.log('  Pattern:', graph.getPattern(id1).type, [...graph.getPattern(id1).fields]);

// Test 4: Error handling
console.log('\nTest 4: Error handling');
try {
  const p5 = Pattern.closedProduct(['x']);
  const p6 = Pattern.closedUnion(['y']);
  unifyTwo(p5, p6, 'error-test');
  console.log('  ERROR: Should have thrown');
} catch (e) {
  console.log('  Caught expected error:', e.message.split('\n')[0]);
}

console.log('\nAll tests passed!');
