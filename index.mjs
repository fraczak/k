import { parse } from "./parser.mjs";
import { patterns } from "./patterns.mjs";
import run from "./run.mjs";
import t from "./codes.mjs";

function compile(script) {
  run.defs = annotate(script);
  return run.bind(null, run.defs.rels.__main__.def);
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data) {
  return compile(script)(data);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";


function annotate(script) {
  const { defs, exp } = parse(script);
  //const { codes, representatives } = t.finalize(defs.codes);

  const representatives = t.register(defs.codes);
  const rels = {...defs.rels, "__main__": {def: exp}};

  const relAlias = patterns(representatives, rels);
 
  return {rels, representatives, relAlias};
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate };
export { compile, runScriptOnData as run, parse, annotate };
