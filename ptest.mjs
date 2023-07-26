import { parse } from "./parser.mjs";
import { minimize, normalizeAll } from "./codes.mjs";
import { patterns } from "./patterns.mjs";
import fs from "node:fs";

function finalize(codes) {
  const representatives = minimize(codes).representatives;
  return {
    codes: normalizeAll(codes, representatives),
    representatives
  };
}

function annotate(script) {
  const { defs, exp } = parse(script);
  const { codes, representatives } = finalize(defs.codes);

  const rels = {...defs.rels, "__main__": [exp]};

  const pats = patterns(codes, representatives, rels);

  return {rels,codes,representatives, ...pats}
}

function t(script) {
  const annotated = annotate(script);
  console.log(JSON.stringify(annotated, "", 2));
}


// t("{}");

// t(`$b = < {} true, {} false > ;
//    true = {{} true} $b;
//    false = {{} false} $b; 
//    not = $b < .true false, .false true >;
//    not not
// `)


// t(`
// $bnat = < {} _, bnat 0, bnat 1 >;
// remove_leading_zeros = $bnat 
// < .0 remove_leading_zeros, () >;
// remove_leading_zeros
// `);

// t(`u = ();one = $nat {() 1}; 
// $nat = <nat 1, {} _>; $bnat = < {} _, bnat 0, bnat 1 >;
// $<nat 1, {} _> $bnat`);

// t(fs.readFileSync("./Examples/bnat-patterns.k").toString("utf8"))

// t('_ = ${} {{} _}; {} _')

// t('< .x, () >');

t(' {2 a} { 1 1, "a" a, () c} .c.a');
// t('"a"');

export default { t };
export { t };

