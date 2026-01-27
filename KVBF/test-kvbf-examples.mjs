import fs from "node:fs";
import path from "node:path";
import { parse } from "../parser.mjs";
import run from "../run.mjs";
import t from "../codes.mjs";
import { Product as ValueProduct, Variant as ValueVariant } from "../Value.mjs";
import { Product, Variant, TypedValue } from "../TypedValue.mjs";
import { decodeKVBF, encodeKVBF } from "./kvbf.mjs";
import { formatValueNative } from "./kvalue-text.mjs";

const unit = new ValueProduct({});
const examplesRoot = "Examples";
const exampleFiles = fs
  .readdirSync(examplesRoot)
  .filter((name) => name.endsWith(".k"));
  
function toTypedValue(value) {
  if (value && value.tag !== undefined && value.value !== undefined) {
    return new Variant(value.tag, toTypedValue(value.value));
  }
  if (value && value.product !== undefined) {
    const result = {};
    for (const [label, child] of Object.entries(value.product)) {
      result[label] = toTypedValue(child);
    }
    return new Product(result);
  }
  throw new Error("Unsupported value for TypedValue conversion");
}

function verifyType(typeId, value) {
  const code = t.find(typeId);
  if (!code || code.code === "undefined") return false;
  if (code.code === "product") {
    if (!(value instanceof ValueProduct)) return false;
    const labels = Object.keys(code.product);
    if (Object.keys(value.product).length !== labels.length) return false;
    return labels.every((label) => value.product.hasOwnProperty(label)
      && verifyType(code.product[label], value.product[label]));
  }
  if (code.code === "union") {
    if (!(value instanceof ValueVariant)) return false;
    if (!Object.prototype.hasOwnProperty.call(code.union, value.tag)) return false;
    return verifyType(code.union[value.tag], value.value);
  }
  return false;
}

function collectTypeIds(defs, representatives) {
  const ids = new Set();
  for (const name of Object.keys(defs.codes)) {
    const rep = representatives[name];
    if (rep) ids.add(rep);
  }
  return Array.from(ids);
}

function normalizeRelCodes(rel, representatives) {
  switch (rel.op) {
    case "product":
      rel.product.forEach(({ exp }) => normalizeRelCodes(exp, representatives));
      break;
    case "union":
      rel.union.forEach((exp) => normalizeRelCodes(exp, representatives));
      break;
    case "comp":
      rel.comp.forEach((exp) => normalizeRelCodes(exp, representatives));
      break;
    case "code":
      rel.code = representatives[rel.code] || rel.code;
      break;
    case "ref":
    case "identity":
    case "dot":
    case "div":
    case "vid":
    case "filter":
      break;
    default:
      break;
  }
}

function roundTrip(label, typedValue, registry) {
  const before = formatValueNative(typedValue.value);
  for (const idEncoding of ["bnat", "uleb128"]) {
    const encoded = encodeKVBF(typedValue, registry, { idEncoding });
    const decoded = decodeKVBF(encoded, registry, { idEncoding });
    const after = formatValueNative(decoded.value);
    if (before !== after) {
      throw new Error(`KVBF round-trip mismatch (${label}, ${idEncoding})`);
    }
  }
}

let total = 0;
const perFile = {};

for (const file of exampleFiles) {
  const filePath = path.join(examplesRoot, file);
  const script = fs.readFileSync(filePath, "utf8");
  const { defs } = parse(`${script}\n()`);
  const representatives = t.register(defs.codes);
  const typeIds = collectTypeIds(defs, representatives);

  for (const rel of Object.values(defs.rels)) {
    normalizeRelCodes(rel.def, representatives);
  }

  run.defs = { rels: defs.rels };

  let fileCount = 0;
  for (const [name, rel] of Object.entries(defs.rels)) {
    if (name === "__main__") continue;
    const output = run(rel.def, unit);
    if (output === undefined) continue;
    const matches = typeIds.filter((typeId) => verifyType(typeId, output));
    if (matches.length !== 1) continue;

    const typedValue = new TypedValue(matches[0], toTypedValue(output));
    roundTrip(`${file}:${name}`, typedValue, t.dump());
    fileCount += 1;
    total += 1;
  }
  perFile[file] = fileCount;
}

const totals = Object.values(perFile).reduce((a, b) => a + b, 0);
if (totals < 10) {
  throw new Error(`Expected extensive coverage; only ${totals} values tested.`);
}

console.log("KVBF example round-trips ok");
console.log(JSON.stringify(perFile, null, 2));
