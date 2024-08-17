import { annotate } from "../index.mjs";

function in_out(annotated) {
  const [input,output] = annotated.rels.__main__.def.patterns.map( (pat) => 
    annotated.rels.__main__.typePatternGraph.get_pattern(pat)
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

