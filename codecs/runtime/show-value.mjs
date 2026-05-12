import { Product, Variant } from "../../Value.mjs";

const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function pLabel(label) {
  return nameRE.test(label) ? ` ${label}` : ` ${JSON.stringify(label)}`;
}

function propertyListToFilter(propertyList) {
  if (!propertyList || propertyList.length === 0) return "(...)";

  const refCount = new Array(propertyList.length).fill(0);
  for (const [, edges] of propertyList) {
    for (const [, target] of edges) refCount[target]++;
  }
  refCount[0]++;

  const varNames = new Map();
  let varCounter = 0;
  for (let i = 0; i < propertyList.length; i++) {
    if (refCount[i] > 1) varNames.set(i, `X${varCounter++}`);
  }

  const defined = new Set();

  function fmt(nodeId) {
    if (varNames.has(nodeId) && defined.has(nodeId)) return varNames.get(nodeId);

    const [kind, edges] = propertyList[nodeId];
    const hasVar = varNames.has(nodeId);
    if (hasVar) defined.add(nodeId);

    const suffix = hasVar ? `=${varNames.get(nodeId)}` : "";

    if (kind === "any") return hasVar ? varNames.get(nodeId) : "(...)";

    const isOpen = kind.startsWith("open-");
    const isProduct = kind.endsWith("product");
    const open = isProduct ? "{" : "<";
    const close = isProduct ? "}" : ">";

    if (edges.length === 0 && !isOpen) return `${open}${close}${suffix}`;

    const fields = edges.map(([label, target]) => `${fmt(target)}${pLabel(label)}`);
    if (isOpen) fields.push("...");
    return `${open}${fields.join(", ")}${close}${suffix}`;
  }

  return fmt(0);
}

function valueToK(v) {
  if (v instanceof Variant) return `${valueToK(v.value)}|${pLabel(v.tag).trimStart()}`;
  if (v instanceof Product) {
    const keys = Object.keys(v.product);
    if (keys.length === 0) return "{}";
    const fields = keys.map((k) => `${valueToK(v.product[k])}${pLabel(k)}`);
    return `{${fields.join(", ")}}`;
  }
  return String(v);
}

function valueWithEnvelopeToK(value) {
  if (value === undefined) return "... undefined";
  return `${valueToK(value)} ?${propertyListToFilter(value.pattern)}`;
}

export { propertyListToFilter, valueToK, valueWithEnvelopeToK };
