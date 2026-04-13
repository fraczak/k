import { Product, Variant } from "../../Value.mjs";

function typeDefsFromValue(value) {
  let nextId = 0;
  const defs = {};

  function visit(node) {
    const name = `:auto${nextId++}`;
    if (node instanceof Product) {
      const labels = Object.keys(node.product).sort();
      const product = {};
      for (const label of labels) {
        product[label] = visit(node.product[label]);
      }
      defs[name] = { code: "product", product };
      return name;
    }

    if (node instanceof Variant) {
      const childName = visit(node.value);
      defs[name] = { code: "union", union: { [node.tag]: childName } };
      return name;
    }

    throw new Error(`Unsupported runtime value node: ${node?.constructor?.name || typeof node}`);
  }

  const root = visit(value);
  defs.__root__ = { code: "ref", ref: `@${root}` };
  return { defs, root };
}

export { typeDefsFromValue };
export default { typeDefsFromValue };