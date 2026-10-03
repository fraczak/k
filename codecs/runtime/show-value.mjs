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
  let result = "";
  const stack = [{
    val: root,
    assign(s) { result = s; }
  }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.finishProduct) {
      frame.assign(`{${frame.parts.join(", ")}}`);
      continue;
    }
    if (frame.finishVariant) {
      const base = frame.base;
      const tags = frame.tags;
      frame.assign(tags.length === 0 ? base : `${base}|${tags.reverse().join("|")}`);
      continue;
    }

    const v = frame.val;
    if (isVariant(v)) {
      const tags = [];
      let curr = v;
      while (isVariant(curr)) {
        tags.push(pLabel(curr.tag).trimStart());
        curr = curr.value;
      }
      const finishFrame = {
        finishVariant: true,
        tags,
        base: "",
        assign: frame.assign
      };
      stack.push(finishFrame);
      stack.push({
        val: curr,
        assign(s) { finishFrame.base = s; }
      });
      continue;
    }

    if (isProduct(v)) {
      const keys = Object.keys(v.product);
      if (keys.length === 0) {
        frame.assign("{}");
        continue;
      }
      const parts = new Array(keys.length);
      const finishFrame = {
        finishProduct: true,
        parts,
        assign: frame.assign
      };
      stack.push(finishFrame);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        const label = pLabel(k);
        stack.push({
          val: v.product[k],
          assign(s) { parts[i] = `${s}${label}`; }
        });
      }
      continue;
    }

    frame.assign(String(v));
  }

  return result;
}

function valueWithEnvelopeToK(value) {
  if (value === undefined) return "... undefined";
  return `${valueToK(value)} ?${propertyListToFilter(value.pattern)}`;
}

export { propertyListToFilter, valueToK, valueWithEnvelopeToK };
