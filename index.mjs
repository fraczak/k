import { parse } from "./parser.mjs";
import { Value, fromObject } from "./Value.mjs";
import { parseValue } from "./valueIO.mjs";
import { compileTypes } from "./compiler.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { withPattern } from "./Value.mjs";

function compile(script, options = {}) {
  run.defs = annotate(script, options);
  const mainRel = run.defs.rels.__main__;
  const outputPatternId = mainRel.typePatternGraph.find(mainRel.def.patterns[1]);
  const outputPattern = patternToPropertyList(
    exportPatternGraph(mainRel.typePatternGraph, outputPatternId)
  );
  return (value) => {
    const result = run(codes.find, mainRel.def, value, mainRel.typePatternGraph);
    if (result === undefined) return;
    return withPattern(result, outputPattern);
  };
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data, options = {}) {
  let parsedData;
  if (data instanceof Value) {
    parsedData = data;
  } else if (typeof data === "string") {
    parsedData = parseValue(data, null, null);
  } else  {
    parsedData = fromObject(data);
  }
  return compile(script, options)(parsedData);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";


function annotate(script, options = {}) {
  const { defs, exp } = parse(script);
  //const { codes, representatives } = codes.finalize(defs.codes);

  const representatives = codes.register(defs.codes);
  const rels = {...defs.rels, "__main__": {def: exp}};

  const { relAlias, compileStats } = compileTypes(representatives, rels, options);
 
  return {rels, representatives, relAlias, compileStats};
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate, parseValue, fromObject };
export { compile, runScriptOnData as run, parse, annotate, parseValue, fromObject };
