import t from './typing.mjs';
// const t = await import('./typing.mjs');
const g = new t.typePatternGraph();

const pu = {pattern: '(...)', fields: []};

// x = .x;     {   {   5   x }     x  i,  {   true   x }      x   b }
//    0   1   2  3   4   5    6  7  8    9  10    11    12  13  14  15

for (var i = 0; i < 16; i++) { g.addNewNode(pu); }

g.addNewNode({pattern: '(...)'}, {x: [1]}); // 16
g.unify("y:input", 0,16); // 17

// 
g.unify('main:input',2,3,4,9,10); // 18

g.addNewNode({pattern: '{}'}, {i: [8], b: [14]}); // 19
g.unify("main:output", 15,19); // 20

g.unify('comp:chain',6,7); // 21
g.unify('comp:chain',12,13); // 22


// {5 x}
g.addNewNode({pattern: '<...>'}, {x: [5]}); // 23
g.unify('variant:output',6,23); // 24

// {true x}
g.addNewNode({pattern: '<...>'}, {x: [11]}); // 25
g.unify('variant:output',12,25); // 26


// 5
g.addNewNode({pattern: 'type', type: 'int'}); // 27
g.unify('5:outout',5,27); // 28

// true
g.addNewNode({pattern: 'type', type: 'bool'}); // 29
g.unify('true:output',11,29); // 30