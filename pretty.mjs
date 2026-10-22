import { TypePatternGraph } from "./TypePatternGraph.mjs";

// const nameRE = /^[a-zA-Z0-9_][a-zA-Z0-9_?!]*$/;
const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;
function pLabel_(label) {
  return nameRE.test(label) ? ` ${label}` : `${JSON.stringify(label)}`;
}
function pLabel(label) {
  return nameRE.test(label) ? `${label}` : `${JSON.stringify(label)}`;
}

function prettyCode_labels (representatives, findCode, label_ref_map) {
  return Object.keys(label_ref_map)
    .sort()
    .map( (label) => {
      return `${prettyCode(representatives, findCode, {
        code: "ref",
        ref: label_ref_map[label],
      })}${pLabel_(label)}`;
    })
    .join(", ");
};

function prettyCode (representatives, findCode, codeExp) {
  switch (codeExp.code) {
    case "ref":
      const name = representatives[codeExp.ref] || codeExp.ref;
      if (name.startsWith(":")) {
        return prettyCode(representatives, findCode, findCode(name));
      } else {
        return name;
      }
    case "product":
      return `{${prettyCode_labels(representatives, findCode, codeExp.product)}}`;
    case "union":
      return `< ${prettyCode_labels(representatives, findCode, codeExp.union)} >`;
    default:
      return ":error";
  }
};

function prettyFilter ( filter ) {
  const fieldsStr = () => {
    const fields = Object.keys(filter.fields).map( (key) => 
      `${prettyFilter(filter.fields[key])}${pLabel_(key)}` 
    );
    if (filter.open) fields.push("...");
    return fields.join(", ");
  } 
  switch (filter.type) {
    
    case "pattern_apply": {
      const argsStr = (filter.args || []).map(prettyFilter).join(", ");
      const knot = filter.name ? `=${filter.name}` : "";
      return `${filter.pattern}[${argsStr}]${knot}`;
    }
    case "code":
      return `$${filter.code}`;
    case "name":
      return filter.name;
    case null:
      if (!filter.open || Object.keys(filter.fields).length !== 0) {
        throw new Error(`Unknown-kind filters must be exactly (...): ${JSON.stringify(filter)}`);
      }
      if (filter.name)
        return filter.name;
      return `(${fieldsStr()})${filter.name ? "=" + filter.name : ""}`;
    case "union":
      return `<${fieldsStr()}>${filter.name ? "=" + filter.name : ""}`;
    case "product":
      return `{${fieldsStr()}}${filter.name ? "=" + filter.name : ""}`;
  }
  throw new Error(`Unknown filter type ${filter.type} in ${JSON.stringify(filter)}`);
}

function prettyRel (exp) {
  "use strict";
  const pretty = (exp) => {
    switch (exp.op) {
      case "filter":
        if (exp.filter.type == 'code') return `$${exp.filter.code}`;
        return `?${prettyFilter(exp.filter)}`;
      case "union":
        return `<${exp.union.map(pretty).join(", ")}>`;
      case "ref":
        return exp.ref;
      case "identity":
        return "()";
      case "comp":
        return exp.comp.map(pretty).join(" ");
      case "dot":
        return `.${pLabel(exp.dot)}`;
      case "div":
        return `/${pLabel(exp.div)}`;
      case "vid":
        return `|${pLabel(exp.vid)}`;
      case "code":
        return `$${exp.code}`;
      case "product":
        return (function (labelled) {
          return `{${labelled.join(", ")}}`;
        })(
          exp.product.map(function ({ label, exp }) {
              return `${pretty(exp)}${pLabel_(label)}`;
          })
        );
    }
  };
  return pretty(exp);
};


function patterns2filters(typePatternGraph, ...patternIds) {
  const newTypePatternGraph = new TypePatternGraph(typePatternGraph.registerCodeDef, typePatternGraph.findCode);
  const renamed = typePatternGraph.clone(patternIds, newTypePatternGraph);
  const newPatternIds = patternIds.map((id) => newTypePatternGraph.find(renamed[id]));

  // inDegree - all open patterns, i.e. (...), {...}, <...>, 
  // with inDegree > 1 are variables  
  const inDegree = newTypePatternGraph.patterns.nodes.map((x) => 0);
  newPatternIds.forEach( id => inDegree[id]++);
  newTypePatternGraph.edges.forEach( outEdges => 
    Object.values( outEdges ).forEach( destMap =>
      Object.values(destMap).forEach( dst =>  
        inDegree[dst]++ ) 
    )
  );

  // variables - variables which will have to be added as extra filters
  const variables = inDegree.reduce( (variables, degree, i) => {
    if (degree > 1) variables[i] = true;
    return variables;
  }, {});

  const filterVars = {};
  const buildFilter = (path, patternId, i) => {
    let named_filter = {};
    const pattern = newTypePatternGraph.get_pattern(patternId);
    if (variables[patternId]) {
      if (filterVars[patternId]) 
        return { type: 'name', name: filterVars[patternId] };
      filterVars[patternId] = `X${Object.keys(filterVars).length}`;
      named_filter = { name: filterVars[patternId] };
    }
    
    const edges = newTypePatternGraph.edges[patternId] || {};
    const fields = () => 
      Object.keys(edges).sort().reduce( (fields, key) =>{
        fields[key] = buildFilter([...path, key], Object.values(edges[key])[0], i);
        return fields;
      }, {});

    switch (pattern.pattern) {
      case 'type': {
        const code = newTypePatternGraph.findCode(pattern.type);
        if (code?.code === "product") {
          return { type: 'product', fields: fields(), ...named_filter };
        } else if (code?.code === "union") {
          return { type: 'union', fields: fields(), ...named_filter };
        }
        return { type: "code", code: pattern.type, ...named_filter };
      }
      case '(...)':
          return { type: null, open: true, fields: fields(), ...named_filter };
      case '{...}': 
        return { type: 'product', open: true, fields: fields(), ...named_filter };
      case '<...>': 
        return { type: 'union', open: true, fields: fields(), ...named_filter };
      case  '{}':
        return { type: 'product', fields: fields(), ...named_filter };
      case '<>':
        return { type: 'union', fields: fields(), ...named_filter };
    }
  };

  const filters = newPatternIds.map( (id, i) => buildFilter([], id, i) );
  return filters;

}

function patternGraphToCanonical(
  typePatternGraph,
  rootId,
  expectedParamCount = null
) {
  const newTypePatternGraph = new TypePatternGraph(
    typePatternGraph.registerCodeDef,
    typePatternGraph.findCode
  );
  const renamed = typePatternGraph.clone([rootId], newTypePatternGraph);
  const newRootId = newTypePatternGraph.find(renamed[rootId]);

  const inDegree = newTypePatternGraph.patterns.nodes.map(() => 0);
  inDegree[newRootId]++;
  newTypePatternGraph.edges.forEach((outEdges) =>
    Object.values(outEdges).forEach((destMap) =>
      Object.values(destMap).forEach((dst) => inDegree[dst]++)
    )
  );

  const variables = inDegree.reduce((vars, degree, i) => {
    const p = newTypePatternGraph.get_pattern(i);
    if (degree > 1) {
      vars[i] = true;
    }
    return vars;
  }, {});

  const filterVars = {};
  const canonicalParams = [];
  const maxParams =
    expectedParamCount != null ? expectedParamCount : Infinity;

  const buildFilter = (path, patternId) => {
    let named_filter = {};
    const pattern = newTypePatternGraph.get_pattern(patternId);
    const isParam =
      pattern.pattern === "(...)" &&
      !filterVars[patternId] &&
      canonicalParams.length < maxParams;

    if (variables[patternId] || isParam) {
      if (filterVars[patternId]) {
        return { type: "name", name: filterVars[patternId] };
      }
      const varName = `X${Object.keys(filterVars).length}`;
      filterVars[patternId] = varName;
      named_filter = { name: varName };
      if (
        isParam ||
        (pattern.pattern === "(...)" &&
          canonicalParams.length < maxParams)
      ) {
        canonicalParams.push(varName);
      }
    }

    const edges = newTypePatternGraph.edges[patternId] || {};
    const fields = () =>
      Object.keys(edges)
        .sort()
        .reduce((flds, key) => {
          flds[key] = buildFilter(
            [...path, key],
            Object.values(edges[key])[0]
          );
          return flds;
        }, {});

    switch (pattern.pattern) {
      case "type": {
        const code = newTypePatternGraph.findCode(pattern.type);
        if (code?.code === "product") {
          return { type: "product", fields: fields(), ...named_filter };
        } else if (code?.code === "union") {
          return { type: "union", fields: fields(), ...named_filter };
        }
        return { type: "code", code: pattern.type, ...named_filter };
      }
      case "(...)":
        return {
          type: null,
          open: true,
          fields: fields(),
          ...named_filter
        };
      case "{...}":
        return {
          type: "product",
          open: true,
          fields: fields(),
          ...named_filter
        };
      case "<...>":
        return {
          type: "union",
          open: true,
          fields: fields(),
          ...named_filter
        };
      case "{}":
        return { type: "product", fields: fields(), ...named_filter };
      case "<>":
        return { type: "union", fields: fields(), ...named_filter };
    }
  };

  const filter = buildFilter([], newRootId);
  return { filter, canonicalParams };
}

export default {
  prettyCode,
  prettyRel,
  prettyFilter,
  patterns2filters,
  patternGraphToCanonical
};
export {
  prettyCode,
  prettyRel,
  prettyFilter,
  patterns2filters,
  patternGraphToCanonical
};
