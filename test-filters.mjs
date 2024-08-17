import {  unify_with_code } from './filters.mjs';
import k from './index.mjs';
// { compile, run, parse, annotate };

const annotated = k.annotate(`
  $nat = < {} _, nat s >;
  $pair = { nat x, nat y };
  $list = < {} empty, { nat x, list xs } list>;
  z = {{} _} $nat;
  s = { $nat s} $nat;
  f1 = ? { n x, ...};
  f2 = ? { <...> y, ...};
  f3 = ? < x empty, { $MWqNxWxHMy xs, ...} list >;
  {} 
  `);



// console.log(JSON.stringify(annotated, null, 2));



const test1 = unify_with_code(
  annotated.codes, 
  annotated.representatives["pair"], 
  annotated.rels['f1'].def.filter,
  {}
);
console.log(JSON.stringify(test1, null, 2));

const test2 = unify_with_code(
  annotated.codes, 
  annotated.representatives["pair"], 
  annotated.rels['f2'].def.filter,
  {}
);
console.log(JSON.stringify(test2, null, 2));

const test3 = unify_with_code(
  annotated.codes, 
  annotated.representatives["list"], 
  annotated.rels['f3'].def.filter,
  {}
);
console.log(JSON.stringify(test3, null, 2));