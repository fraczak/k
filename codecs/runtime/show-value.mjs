import { isProduct, isVariant } from "../../Value.mjs";

const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function pLabel(label) {
  return nameRE.test(label) ? ` ${label}` : ` ${JSON.stringify(label)}`;
}

function propertyListToFilter(propertyList, varPrefix = "X") {
  if (!propertyList || propertyList.length === 0) return "(...)";

  const refCount = new Array(propertyList.length).fill(0);
  for (const [, edges] of propertyList) {
    for (const [, target] of edges) refCount[target]++;
  }
  refCount[0]++;

  const varNames = new Map();
  let varCounter = 0;
  for (let i = 0; i < propertyList.length; i++) {
    if (refCount[i] > 1) varNames.set(i, `${varPrefix}${varCounter++}`);
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

function valueToK(root) {
  const out = [];
  const stack = [root];

  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string") {
      out.push(item);
      continue;
    }

    if (item == null) {
      out.push(String(item));
      continue;
    }

    if (isVariant(item)) {
      const tags = [];
      let curr = item;
      while (isVariant(curr)) {
        tags.push(pLabel(curr.tag).trimStart());
        curr = curr.value;
      }
      if (tags.length > 0) {
        stack.push("|" + tags.reverse().join("|"));
      }
      stack.push(curr);
      continue;
    }

    if (isProduct(item)) {
      const keys = Object.keys(item.product);
      if (keys.length === 0) {
        out.push("{}");
        continue;
      }
      out.push("{");
      stack.push("}");
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        if (i < keys.length - 1) {
          stack.push(", ");
        }
        stack.push(pLabel(k));
        stack.push(item.product[k]);
      }
      continue;
    }

    out.push(String(item));
  }

  return out.join("");
}

function valueWithEnvelopeToK(value) {
  if (value === undefined) return "... undefined";
  return `${valueToK(value)} ?${propertyListToFilter(value.pattern)}`;
}

export { propertyListToFilter, valueToK, valueWithEnvelopeToK };
