// filter is of type: [name|code|null|union|product|vector],
// null|union|product have fields, and can be open

function unify_with_code(codes, code, filter, context){
  // console.log({code, filter, context});
  if (context == undefined) return undefined;
  if (code == undefined) return undefined;
  switch (filter.type) {
    case "code": {
      if (filter.code == code)
        return context;
      return undefined;
    }
    case "name": {
      const code_filter = {type: 'code', code: code};
      if (filter.name in context) {
        const new_filter = context[filter.name];
        const new_context = {... context, [filter.name]: code_filter};
        return unify_with_code(codes, code, new_filter, new_context);
      }
      return {...context, [filter.name]: {type: 'code', code: code}} 
    }
    case "product": 
    case "union":
    case null: {
      const ctype = codes[code]?.code;
      if (ctype != 'product' && ctype != 'union') return undefined;
      const code_fields = codes[code][ctype];
      const new_context = Object.keys(filter.fields).reduce((new_context, field) => 
        unify_with_code(codes, code_fields[field], filter.fields[field], new_context)
      , {...context});
      if (filter.open !== true && Object.keys(code_fields).length != Object.keys(filter.fields).length)
        return undefined;
      return new_context;
    }
    case "vector": {
      const ctype = codes[code]?.code;
      if (ctype != 'vector') return undefined;
      const code_vector = codes[code].vector;
      return unify_with_code(codes, code_vector, filter.vector, context);
    }
  }
}

// we assume the names occurring in both filters are disjoint
function unify(codes, filter1, filter2, context ) {
  if (context == undefined) return undefined;
  if (filter1 == undefined  ||  filter2 == undefined) return undefined;

  switch (filter1.type) {
    case "code":
      return unify_with_code(codes, filter1.code, filter2, context);
  }
}

export default { unify_with_code };
export { unify_with_code };


