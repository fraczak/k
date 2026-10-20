// named-patterns.mjs
// Expansion of named patterns and parameterized type schemes in k ASTs.

function cloneFilter(filter) {
  if (!filter || typeof filter !== "object") return filter;
  const copy = { ...filter };
  if (filter.fields) {
    copy.fields = {};
    for (const [k, v] of Object.entries(filter.fields)) {
      copy.fields[k] = cloneFilter(v);
    }
  }
  if (filter.args) {
    copy.args = filter.args.map(cloneFilter);
  }
  return copy;
}

export function expandFilter(
  filter,
  patterns = {},
  stack = new Set(),
  uniqueIdRef = { val: 0 }
) {
  if (!filter || typeof filter !== "object") return filter;

  if (filter.type === "pattern_apply") {
    const patternName = filter.pattern;
    const template = patterns[patternName];
    if (!template) {
      const pos = filter.start
        ? ` (lines ${filter.start.line}:${filter.start.column})`
        : "";
      throw new Error(
        `Unknown pattern template '${patternName}[]'${pos}`
      );
    }

    if (stack.has(patternName)) {
      const cycle = [...stack, patternName].join(" -> ");
      throw new Error(
        `Cyclic pattern template dependency detected: ${cycle}`
      );
    }

    const expectedArity = template.params.length;
    const actualArity = (filter.args || []).length;
    if (expectedArity !== actualArity) {
      const pos = filter.start
        ? ` (lines ${filter.start.line}:${filter.start.column})`
        : "";
      throw new Error(
        `Pattern '${patternName}' expects ${expectedArity} ` +
        `argument${expectedArity === 1 ? "" : "s"}, ` +
        `got ${actualArity}${pos}`
      );
    }

    // Expand arguments in caller scope first
    const expandedArgs = (filter.args || []).map((arg) =>
      expandFilter(arg, patterns, stack, uniqueIdRef)
    );

    // Map internal variables and knots to unique fresh names
    const varSubst = {};
    const rootKnot = template.filter?.name;
    if (rootKnot && !template.params.includes(rootKnot)) {
      varSubst[rootKnot] =
        filter.name || `_${rootKnot}_np${++uniqueIdRef.val}`;
    }

    function collectInternalVars(node) {
      if (!node || typeof node !== "object") return;
      if (node.name && !template.params.includes(node.name)) {
        if (!varSubst[node.name]) {
          varSubst[node.name] = `_${node.name}_np${++uniqueIdRef.val}`;
        }
      }
      if (node.fields) {
        for (const f of Object.values(node.fields)) {
          collectInternalVars(f);
        }
      }
      if (node.args) {
        for (const a of node.args) {
          collectInternalVars(a);
        }
      }
    }
    collectInternalVars(template.filter);

    const nextStack = new Set(stack);
    nextStack.add(patternName);

    function substitute(node) {
      if (!node || typeof node !== "object") return node;

      if (node.type === "name") {
        const paramIdx = template.params.indexOf(node.name);
        if (paramIdx !== -1) {
          const clonedArg = cloneFilter(expandedArgs[paramIdx]);
          if (node.name && node.name !== template.params[paramIdx]) {
            clonedArg.name = varSubst[node.name] || node.name;
          }
          return clonedArg;
        } else {
          const renamed = varSubst[node.name] || node.name;
          return { ...node, name: renamed };
        }
      }

      let knotName = undefined;
      if (node.name) {
        const paramIdx = template.params.indexOf(node.name);
        if (paramIdx === -1) {
          knotName = varSubst[node.name] || node.name;
        } else {
          knotName = node.name;
        }
      }

      if (node.type === "union" || node.type === "product") {
        const newFields = {};
        for (const [key, fieldFilter] of Object.entries(
          node.fields || {}
        )) {
          newFields[key] = substitute(fieldFilter);
        }
        const res = { ...node, fields: newFields };
        if (knotName !== undefined) res.name = knotName;
        else delete res.name;
        return res;
      }

      if (node.type === "pattern_apply") {
        const newArgs = (node.args || []).map(substitute);
        const nestedApply = {
          ...node,
          args: newArgs,
        };
        if (knotName !== undefined) nestedApply.name = knotName;
        else delete nestedApply.name;
        return expandFilter(
          nestedApply,
          patterns,
          nextStack,
          uniqueIdRef
        );
      }

      const res = { ...node };
      if (knotName !== undefined) res.name = knotName;
      else delete res.name;
      return res;
    }

    const instantiated = substitute(template.filter);
    if (filter.name) {
      instantiated.name = filter.name;
    }
    return instantiated;
  }

  if (filter.type === "union" || filter.type === "product") {
    const newFields = {};
    for (const [key, fieldFilter] of Object.entries(
      filter.fields || {}
    )) {
      newFields[key] = expandFilter(
        fieldFilter,
        patterns,
        stack,
        uniqueIdRef
      );
    }
    return { ...filter, fields: newFields };
  }

  return cloneFilter(filter);
}

export function expandExp(
  exp,
  patterns = {},
  stack = new Set(),
  uniqueIdRef = { val: 0 }
) {
  if (!exp || typeof exp !== "object") return exp;

  switch (exp.op) {
    case "filter":
      return {
        ...exp,
        filter: expandFilter(exp.filter, patterns, stack, uniqueIdRef),
      };
    case "pattern_apply":
      return {
        op: "filter",
        filter: expandFilter(
          { type: "pattern_apply", pattern: exp.pattern, args: exp.args },
          patterns,
          stack,
          uniqueIdRef
        ),
        start: exp.start,
        end: exp.end,
      };
    case "comp":
      return {
        ...exp,
        comp: exp.comp.map((subExp) =>
          expandExp(subExp, patterns, stack, uniqueIdRef)
        ),
      };
    case "union":
      return {
        ...exp,
        union: exp.union.map((subExp) =>
          expandExp(subExp, patterns, stack, uniqueIdRef)
        ),
      };
    case "product":
      return {
        ...exp,
        product: exp.product.map(({ label, exp: subExp }) => ({
          label,
          exp: expandExp(subExp, patterns, stack, uniqueIdRef),
        })),
      };
    default:
      return exp;
  }
}

export function expandPatternsInRels(rels, patterns = {}, options = {}) {
  const allPatterns = { ...(options.patterns || {}), ...patterns };
  if (options.libraries) {
    for (const lib of options.libraries) {
      const libPatterns =
        lib.patterns ||
        lib.defs?.patterns ||
        lib.sourceDefs?.patterns ||
        {};
      for (const [name, pat] of Object.entries(libPatterns)) {
        if (!(name in allPatterns)) {
          allPatterns[name] = pat;
        }
      }
    }
  }

  const uniqueIdRef = { val: 0 };
  for (const relName of Object.keys(rels)) {
    const rel = rels[relName];
    if (rel?.def) {
      rel.def = expandExp(rel.def, allPatterns, new Set(), uniqueIdRef);
    }
  }

  return rels;
}

export default {
  expandFilter,
  expandExp,
  expandPatternsInRels,
};
