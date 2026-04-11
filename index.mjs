import { parse } from "./parser.mjs";
import { Value, fromObject } from "./Value.mjs";
import { parse as parseValue } from "./valueParser.mjs";
import { compileTypes } from "./compiler.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";

function compile(script) {
  run.defs = annotate(script);
  return run.bind(null, codes.find, run.defs.rels.__main__.def);
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data) {
  let parsedData;
  if (data instanceof Value) {
    parsedData = data;
  } else if (typeof data === "string") {
    parsedData = parseValue(data);
  } else  {
    parsedData = fromObject(data);
  }
  return compile(script)(parsedData);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";


function annotate(script) {
  const { defs, exp } = parse(script);
  //const { codes, representatives } = codes.finalize(defs.codes);

  const representatives = codes.register(defs.codes);
  const rels = {...defs.rels, "__main__": {def: exp}};

  const relAlias = compileTypes(representatives, rels);
 
  return {rels, representatives, relAlias};
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate, parseValue, fromObject };
export { compile, runScriptOnData as run, parse, annotate, parseValue, fromObject };
