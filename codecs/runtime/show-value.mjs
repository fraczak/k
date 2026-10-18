import { isProduct, isVariant } from "../../Value.mjs";

const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function pLabel(label) {
  return nameRE.test(label) ? ` ${label}` : ` ${JSON.stringify(label)}`;
}

function propertyListToFilter(
  propertyList,
  varPrefix = "X",
  limit = Infinity
) {
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
  let curLen = 0;

  function fmt(nodeId) {
    if (curLen >= limit) return "...";
    if (varNames.has(nodeId) && defined.has(nodeId)) {
      const name = varNames.get(nodeId);
      curLen += name.length;
      return name;
    }

    const [kind, edges] = propertyList[nodeId];
    const hasVar = varNames.has(nodeId);
    if (hasVar) defined.add(nodeId);

    const suffix = hasVar ? `=${varNames.get(nodeId)}` : "";

    if (kind === "any") {
      const s = (hasVar ? varNames.get(nodeId) : "(...)") + suffix;
      curLen += s.length;
      return s;
    }

    const isOpen = kind.startsWith("open-");
    const isProduct = kind.endsWith("product");
    const open = isProduct ? "{" : "<";
    const close = isProduct ? "}" : ">";

    if (edges.length === 0 && !isOpen) {
      const s = `${open}${close}${suffix}`;
      curLen += s.length;
      return s;
    }

    const fields = [];
    for (let i = 0; i < edges.length; i++) {
      if (curLen >= limit) {
        fields.push("...");
        break;
      }
      const [label, target] = edges[i];
      const targetStr = fmt(target);
      const labelStr = pLabel(label);
      fields.push(`${targetStr}${labelStr}`);
      curLen += targetStr.length + labelStr.length + 2;
    }
    if (isOpen) fields.push("...");
    return `${open}${fields.join(", ")}${close}${suffix}`;
  }

  return fmt(0);
}

function valueToK(root, limit = Infinity) {
  const out = [];
  let curLen = 0;
  const stack = [root];

  while (stack.length > 0) {
    if (curLen >= limit) {
      out.push("...");
      break;
    }
    const item = stack.pop();
    if (typeof item === "string") {
      if (curLen + item.length > limit) {
        out.push(item.slice(0, Math.max(0, limit - curLen)));
        out.push("...");
        break;
      }
      out.push(item);
      curLen += item.length;
      continue;
    }

    if (item == null) {
      const s = String(item);
      if (curLen + s.length > limit) {
        out.push(s.slice(0, Math.max(0, limit - curLen)));
        out.push("...");
        break;
      }
      out.push(s);
      curLen += s.length;
      continue;
    }

    if (isVariant(item)) {
      const tags = [];
      let curr = item;
      while (isVariant(curr)) {
        tags.push(pLabel(curr.tag).trimStart());
        curr = curr.value;
        if (tags.length > limit) break;
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
        curLen += 2;
        continue;
      }
      out.push("{");
      curLen += 1;
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

    const s = String(item);
    if (curLen + s.length > limit) {
      out.push(s.slice(0, Math.max(0, limit - curLen)));
      out.push("...");
      break;
    }
    out.push(s);
    curLen += s.length;
  }

  return out.join("");
}

function valueWithEnvelopeToK(value, limit = Infinity) {
  if (value === undefined) return "... undefined";
  const valStr = valueToK(value, limit);
  const patStr = propertyListToFilter(value.pattern, "X", limit);
  return `${valStr} ?${patStr}`;
}

export { propertyListToFilter, valueToK, valueWithEnvelopeToK };
