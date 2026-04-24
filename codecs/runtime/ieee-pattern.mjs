import fs from "node:fs";
import { parse as parseScript } from "../../parser.mjs";
import codes from "../../codes.mjs";
import { deriveClosedPattern } from "./codec.mjs";
import { patternToPropertyList } from "./pattern-json.mjs";

const IEEE_SCRIPT = fs.readFileSync(new URL("../../Examples/ieee.k", import.meta.url), "utf8");

function loadFloat64Pattern() {
  const { defs } = parseScript(IEEE_SCRIPT);
  const { codes: finalizedCodes, representatives } = codes.finalize(defs.codes);
  const typeName = representatives.float64 || "float64";
  const typeInfo = finalizedCodes[typeName];
  if (!typeInfo) {
    throw new Error("Could not resolve float64 type from Examples/ieee.k");
  }
  const resolveType = (name) => {
    const type = finalizedCodes[name];
    if (!type) {
      throw new Error(`Unknown IEEE helper type '${name}'`);
    }
    return type;
  };
  return patternToPropertyList(deriveClosedPattern(typeName, typeInfo, resolveType));
}

const FLOAT64_PATTERN = loadFloat64Pattern();

export { FLOAT64_PATTERN, loadFloat64Pattern };
export default { FLOAT64_PATTERN, loadFloat64Pattern };
