import k from './index.mjs';
import { encodeCodeToString } from './codes.mjs';
import hash from './hash.mjs';
[
    `
    $nat = < {} zero, nat succ>;
    $pair = {nat x, nat y};
    $b = {int"x", bool y};
    $vector = [int];
    $tree = <{nat value, tree left, tree right} binary, {nat value} leaf, {nat value, tree tree} unary, [tree] list_of_trees>;
  
    succ = { $nat succ} $nat;
    plus = $pair <
      {.x.zero stop, .y result} .result,
      {.x.succ x, .y succ y } plus
    > $nat;
  {{} zero} succ succ {() x, () y} plus
    `     
  ].map(function (script) {
    console.log(`k_expression = '${script}';`);
    const annotated = k.annotate(script);
    for (const code in annotated.codes) {
      console.log(`CODE: ${code}`);
      const s = encodeCodeToString(code,annotated.codes);
      console.log(` - DEFS: ${s}`);;
      const annotated2 = k.annotate(s+" {}");;
      const s2 = encodeCodeToString(annotated2.representatives["C0"],annotated2.codes);
      console.log(` - reparsed FINGERPRINT: ${hash(s2)}`);
      if ((s === s2) && (hash(s) === hash(s2))) {
        console.log('--- OK');
      } else {
        console.log('--- ERROR');
      }

      console.log('-------------------');
    }
  });
  