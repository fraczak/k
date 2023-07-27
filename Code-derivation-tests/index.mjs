import { annotate } from "../index.mjs";

function in_out(annotated) {
  const [input,output] = annotated.rels.__main__[0].patterns.map( (pat) => 
    annotated.patternNodes[pat]
  );
  return { input, output };
}


function t(script, cb = (annotated) => console.log(in_out(annotated))) {
  // console.log("--- Testing Code Derivation ---");
  const annotated = annotate(script);
  // console.log(JSON.stringify(annotated, "", 2));
  return cb(annotated); 
}

export default { t, in_out };
export { t, in_out };

