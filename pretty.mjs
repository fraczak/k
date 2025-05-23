import { find } from "./codes.mjs";
import { TypePatternGraph } from "./typing.mjs";

const nameRE = /^[a-zA-Z0-9_][a-zA-Z0-9_?!]*$/;
function pLabel_(label) {
  return nameRE.test(label) ? ` ${label}` : `${JSON.stringify(label)}`;
}
function pLabel(label) {
  return nameRE.test(label) ? `${label}` : `${JSON.stringify(label)}`;
}

function prettyCode_labels (representatives, label_ref_map) {
  return Object.keys(label_ref_map)
    .sort()
    .map( (label) => {
      return `${prettyCode(representatives, {
        code: "ref",
        ref: label_ref_map[label],
      })}${pLabel_(label)}`;
    })
    .join(", ");
};

function prettyCode (representatives, codeExp) {
  switch (codeExp.code) {
    case "ref":
      const name = representatives[codeExp.ref] || codeExp.ref;
      if (name.startsWith(":")) {
        return prettyCode(representatives, find(name));
      } else {
        return name;
      }
    case "product":
      return `{${prettyCode_labels(representatives, codeExp.product)}}`;
    case "union":
      return `< ${prettyCode_labels(representatives, codeExp.union)} >`;
    case "vector":
      return `[${prettyCode(representatives, {code:'ref', ref:codeExp.vector})}]`;
      // return `[${representatives[codeExp.vector] || codeExp.vector}]`;
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
    
    case "code":
      return `$${filter.code}`;
    case "name":
      return filter.name;
    case "vector":
      return `[${prettyFilter(filter.vector)}]${filter.name ? "=" + filter.name : ""}`;
    case null:
      if (filter.name && Object.keys(filter.fields).length == 0) 
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
      case "pipe":
        return `|`;        
      case "caret":
        return `(${pretty(exp.caret)} ^)`;        
      case "vector":
        return `[${exp.vector.map(pretty).join(", ")}]`;
      case "union":
        return `<${exp.union.map(pretty).join(", ")}>`;
      case "ref":
        return exp.ref;
      case "identity":
        return "()";
      case "comp":
        return exp.comp.map(pretty).join(" ");
      case "bits":
        return `'${exp.bits}'`;
      case "dot":
        return `.${pLabel(exp.dot)}`;
      case "div":
        return `/${pLabel(exp.div)}`;
      case "times":
        return `/${pLabel(exp.times)}`;
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
  const newTypePatternGraph = new TypePatternGraph();
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
    if (variables[patternId] && pattern.pattern != 'type') {
      if (filterVars[patternId]) 
        return { type: 'name', name: filterVars[patternId] };
      filterVars[patternId] = `X${Object.keys(filterVars).length}`;
      named_filter = { name: filterVars[patternId] };
    }
    
    const edges = newTypePatternGraph.edges[patternId];
    const fields = () => 
      Object.keys(edges).sort().reduce( (fields, key) =>{
        fields[key] = buildFilter([...path, key], Object.values(edges[key])[0], i);
        return fields;
      }, {});

    switch (pattern.pattern) {
      case 'type':
        return {type: "code", code: pattern.type, ...named_filter};
      case '[]':
        return {
          type: "vector", 
          vector: buildFilter([...path, "vector-member"], Object.values(edges["vector-member"])[0], i),
          ...named_filter
        };
      case '(...)':
          return { type: null, open: true, fields: fields(), ...named_filter };
      case '{...}': 
        return { type: 'product', open: true, fields: fields(), ...named_filter };
      case '<...>': 
        return { type: 'union', open: true, fields: fields(), ...named_filter };
      case '()':
        return { type: null, fields: fields(), ...named_filter };
      case  '{}':
        return { type: 'product', fields: fields(), ...named_filter };
      case '<>':
        return { type: 'union', fields: fields(), ...named_filter };
    }
  };

  const filters = newPatternIds.map( (id, i) => buildFilter([], id, i) );
  return filters;

}

export default { prettyCode, prettyRel, patterns2filters };
export { prettyCode, prettyRel, patterns2filters };
