import { parse } from "./parser.mjs";
import { patterns } from "./patterns.mjs";
import run from "./run.mjs";
import t from "./codes.mjs";
import hash from "./hash.mjs";

function finalize(codes) {
  const representatives = t.minimize(codes).representatives;
  const normalizedCodes = t.normalizeAll(codes, representatives);
  const globalNames = Object.keys(normalizedCodes).reduce((globalNames, name) => {
    const globalDef = t.encodeCodeToString(name, normalizedCodes);
    normalizedCodes[name].def = globalDef;
    globalNames[name] = hash(globalDef);
    return globalNames;
  }, {});
  const globalCodes = Object.keys(normalizedCodes).reduce((globalCodes, name) => {
    globalCodes[globalNames[name]] = normalizedCodes[name];
    return globalCodes;
  },{});
  // console.log("globalCodes",globalCodes);

  const extendedRepresentatives = Object.keys(representatives).reduce((result, name) => {
    result[name] = globalNames[representatives[name]] || name;
    return result;
  }, Object.values(globalNames).reduce((result, name) => ({[name]: name, ...result}),{}));
  // console.log("extendedRepresentatives",extendedRepresentatives);

  const normalizedGlobalCodes = t.normalizeAll(globalCodes, extendedRepresentatives);
  // console.log("normalizedGlobalCodes",normalizedGlobalCodes);

  
  return {
    codes: normalizedGlobalCodes,
    representatives: extendedRepresentatives
  };
}

function compile(script) {
  try {
    const {rels, codes, representatives } = annotate(script);
    run.defs = {rels, codes, representatives};
  } catch (e) {
    console.error(e);
    const { defs, exp } = parse(script);
    const { codes, representatives } = finalize(defs.codes);
    run.defs = {
      rels: {...defs.rels, "__main__": [exp]}, 
      codes, representatives
    };
    console.log("Compiled with type errors.");
  }
  return run.bind(null, run.defs.rels.__main__[0]);
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data) {
  return compile(script)(data);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";


function annotate(script) {
  const { defs, exp } = parse(script);
  const { codes, representatives } = finalize(defs.codes);

  const rels = {...defs.rels, "__main__": [exp]};

  const pats = patterns(codes, representatives, rels);
 
  return {rels,codes,representatives, ...pats}
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate };
export { compile, runScriptOnData as run, parse, annotate };
