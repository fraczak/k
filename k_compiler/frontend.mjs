import { annotate } from "../index.mjs";
import codes from "../codes.mjs";

function sortLabels(labels) {
  return labels.slice().sort((a, b) => {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

function buildTypeMetadata(typeId, entry) {
  const shape = entry[entry.code] || {};
  const labels = sortLabels(Object.keys(shape));
  const members = labels.map((label, index) => ({
    label,
    index,
    typeId: shape[label],
  }));
  return {
    typeId,
    kind: entry.code,
    def: entry.def,
    labels,
    members,
    indexByLabel: members.reduce((result, member) => {
      result[member.label] = member.index;
      return result;
    }, {}),
  };
}

function buildRegistryMetadata(registry) {
  const types = Object.keys(registry)
    .sort()
    .reduce((result, typeId) => {
      const entry = registry[typeId];
      if (entry.code === "product" || entry.code === "union") {
        result[typeId] = buildTypeMetadata(typeId, entry);
      }
      return result;
    }, {});

  return {
    typeCount: Object.keys(types).length,
    types,
  };
}

function compileFrontend(script, options = {}) {
  const analyzed = annotate(script);
  const registry = codes.dump();
  return {
    format: "k-compiler-frontend-v1",
    entryRelation: options.entryRelation || "__main__",
    rels: analyzed.rels,
    relAlias: analyzed.relAlias,
    representatives: analyzed.representatives,
    registry,
    registryMetadata: buildRegistryMetadata(registry),
  };
}

export { buildRegistryMetadata, compileFrontend };
export default { buildRegistryMetadata, compileFrontend };
