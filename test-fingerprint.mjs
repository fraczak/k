import k from './index.mjs';
import { encodeCodeToString, find } from './codes.mjs';
import hash from './hash.mjs';
[
    `
    $nat = < {} zero, nat succ>;
    $pair = {nat x, nat y};
    $b = {int"x", bool y};
    $vector = [int];
    $tree = <{nat value, tree left, tree right} binary, nat leaf, {nat value, tree tree} unary, [tree] list_of_trees>;
  
    succ = { $nat succ} $nat;
    plus = $pair <
      {.x.zero stop, .y result} .result,
      {.x.succ x, .y succ y } plus
    > $nat;
  {{} zero} succ succ {() x, () y} plus
    `     
  ].map(function (script) {
    console.log("test-fingerprint:");
    // console.log(`k_expression = '${script}';`);
    const annotated = k.annotate(script);
    // console.log(annotated);
    let ERRORS = 0;
    for (const code in annotated.representatives) {
      // console.log(`CODE: ${code}`);
      const s = encodeCodeToString(annotated.representatives[code]);
      // console.log(` - DEFS: ${s}`);;
      const annotated2 = k.annotate(s+" {}");;
      const s2 = encodeCodeToString(annotated2.representatives["C0"]);
      // console.log(` - reparsed FINGERPRINT: ${hash(s2)}`);
      if (!((s === s2) && (hash(s) === hash(s2)))) {
        ERRORS++;
        console.log(` ERROR - reparsed FINGERPRINT for ${code} is different`);
      } 
    }
    if (ERRORS === 0) {
      console.log("OK");
    } else {
      console.log(" ----- ERRORS");
    }
  });
  