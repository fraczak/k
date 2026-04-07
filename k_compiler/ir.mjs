function exactTypeForPattern(patternGraph, patternId) {
  const node = patternGraph?.patterns?.nodes?.[patternId];
  if (!node || node.pattern !== "type") return null;
  return node.type || null;
}

function resolveMemberAccess(patternGraph, registryMetadata, patternId, label, kind) {
  const exactTypeId = exactTypeForPattern(patternGraph, patternId);
  if (exactTypeId) {
    const typeMetadata = registryMetadata.types[exactTypeId];
    const index = typeMetadata?.indexByLabel?.[label];
    if (index !== undefined) {
      return {
        kind: "direct",
        typeId: exactTypeId,
        memberKind: kind,
        label,
        index,
      };
    }
  }

  const candidates = [];
  const edges = patternGraph?.edges?.[patternId]?.[label] || [];
  for (const childPatternId of edges) {
    const childTypeId = exactTypeForPattern(patternGraph, childPatternId);
    if (!childTypeId) continue;
    const typeMetadata = registryMetadata.types[childTypeId];
    if (!typeMetadata) continue;
    const index = typeMetadata.indexByLabel[label];
    if (index === undefined) continue;
    candidates.push({
      typeId: childTypeId,
      index,
    });
  }

  return {
    kind: "dynamic",
    memberKind: kind,
    label,
    candidates,
  };
}

function lowerFilter(filter) {
  if (!filter) {
    return { op: "GUARD_ANY" };
  }

  if (filter.type === "code") {
    return {
      op: "CHECK_CODE",
      typeId: filter.code,
    };
  }

  if (filter.type === "name") {
    return {
      op: "CHECK_TYPE_VAR",
      name: filter.name,
    };
  }

  if (filter.type === "product" || filter.type === "union") {
    return {
      op: "CHECK_SHAPE",
      shape: filter.type,
      open: filter.open !== false,
      fields: Object.keys(filter.fields || {}).map((label) => ({
        label,
        guard: lowerFilter(filter.fields[label]),
      })),
      name: filter.name || null,
    };
  }

  return {
    op: "CHECK_SHAPE",
    shape: "any",
    open: filter.open !== false,
    fields: Object.keys(filter.fields || {}).map((label) => ({
      label,
      guard: lowerFilter(filter.fields[label]),
    })),
    name: filter.name || null,
  };
}

function lowerExp(exp, context) {
  const inputPatternId = exp?.patterns?.[0] ?? null;
  const outputPatternId = exp?.patterns?.[1] ?? null;

  switch (exp.op) {
    case "code":
      return {
        op: "CHECK_CODE",
        typeId: exp.code,
      };
    case "filter":
      return lowerFilter(exp.filter);
    case "identity":
      return {
        op: "RETURN_INPUT",
      };
    case "ref":
      return {
        op: "CALL",
        target: exp.ref,
        canonicalTarget: context.relAlias[exp.ref] || null,
      };
    case "dot":
      return {
        op: "PROJECT_FIELD",
        label: exp.dot,
        access: resolveMemberAccess(
          context.patternGraph,
          context.registryMetadata,
          inputPatternId,
          exp.dot,
          "field"
        ),
      };
    case "div":
      return {
        op: "PROJECT_VARIANT",
        label: exp.div,
        access: resolveMemberAccess(
          context.patternGraph,
          context.registryMetadata,
          inputPatternId,
          exp.div,
          "variant"
        ),
      };
    case "comp":
      return {
        op: "SEQ",
        steps: exp.comp.map((step) => lowerExp(step, context)),
      };
    case "union":
      return {
        op: "TRY",
        branches: exp.union.map((branch) => lowerExp(branch, context)),
      };
    case "product":
      return {
        op: "MAKE_PRODUCT",
        exactOutputType: exactTypeForPattern(context.patternGraph, outputPatternId),
        fields: exp.product.map(({ label, exp: childExp }) => ({
          label,
          build: lowerExp(childExp, context),
        })),
      };
    case "vid":
      return {
        op: "MAKE_VARIANT",
        label: exp.vid,
        exactOutputType: exactTypeForPattern(context.patternGraph, outputPatternId),
      };
    default:
      throw new Error(`Unsupported compiler op: ${exp.op}`);
  }
}

function compileIR(frontendBundle) {
  const functions = Object.keys(frontendBundle.rels).reduce((result, name) => {
    const rel = frontendBundle.rels[name];
    result[name] = {
      name,
      canonicalName: frontendBundle.relAlias[name] || null,
      varRefs: rel.varRefs || [],
      inputPatternId: rel.def?.patterns?.[0] ?? null,
      outputPatternId: rel.def?.patterns?.[1] ?? null,
      body: lowerExp(rel.def, {
        patternGraph: rel.typePatternGraph,
        registryMetadata: frontendBundle.registryMetadata,
        relAlias: frontendBundle.relAlias,
      }),
    };
    return result;
  }, {});

  return {
    format: "k-compiler-ir-v1",
    abi: "k-runtime-v1",
    entryRelation: frontendBundle.entryRelation,
    registryMetadata: frontendBundle.registryMetadata,
    functions,
  };
}

export { compileIR, exactTypeForPattern, lowerFilter, lowerExp, resolveMemberAccess };
export default { compileIR, exactTypeForPattern, lowerFilter, lowerExp, resolveMemberAccess };
