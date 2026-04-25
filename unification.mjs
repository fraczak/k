function subsetP(v1,v2) {
  const v2Set = new Set(v2);
  return v1.every(x => v2Set.has(x));
}

function eqsetP(v1,v2) {
  const v1Set = new Set(v1);
  const v2Set = new Set(v2);
  if (v1Set.size != v2Set.size) return false;

  for (const value of v1Set) {
    if (!v2Set.has(value)) {
      return false;
    }
  }
  return true;
}

function setUnion(...vectors) {
  const unionSet = new Set();
  for (const v of vectors) {
    for (const element of v) {
      unionSet.add(element);
    }
  }
  return Array.from(unionSet);
}

export function unify_two_patterns(findCode, p1, p2) {
  // console.log(`unify_two_patterns(${JSON.stringify(p1)}, ${JSON.stringify(p2)})`);
  if (p1.pattern === '()' || p2.pattern === '()') {
    throw new Error("Closed unknown pattern '()' is not supported. Use '{}' or '<>' to choose product or union.");
  }
  if ((p1.pattern === '(...)' && (p1.fields || []).length !== 0) || (p2.pattern === '(...)' && (p2.fields || []).length !== 0)) {
    throw new Error("Unknown-kind pattern '(...)' cannot have fields.");
  }
  switch (p1.pattern) {
    case '(...)':
      switch (p2.pattern) {
        case '(...)':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '{...}':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '<...>':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '{}':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields},...) with {${p2.fields}}`);
        case '<>':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify (${p1.fields},...) with <${p2.fields}>`);
        case 'type': {
            const code = findCode(p2.type);
            // console.log(JSON.stringify({p1,p2,code}));
            switch (code.code) {
              case 'product':
              case 'union': {
                let p2_fields = Object.keys(code[code.code]);
                if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
              }; break;
            }
            throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
          }
        } ;
      break;
    case '{...}':
      switch (p2.pattern) {
        case '{...}':
          return {...p2, fields: setUnion(p1.fields, p2.fields)};
        case '<...>':
          throw new Error('Cannot unify {...} with <...>');
        case '{}':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify {${p1.fields},...} with {${p2.fields}}`);
        case '<>':
          throw new Error('Cannot unify {...} with <>');
        case 'type': {
          const code = findCode(p2.type);
          switch (code.code) {
            case 'product':{
              let p2_fields = Object.keys(code[code.code]);
              if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
            };
          }
          throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
        }
      };
      break;
    case '<...>':
      switch (p2.pattern) {
        case '<...>':
          return {pattern: '<...>', fields: setUnion(p1.fields, p2.fields)};
        case '{}':
          throw new Error('Cannot unify <...> with {}');
        case '<>':
          if (subsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify <${p1.fields},...> with <${p2.fields}>`);
        case 'type':{
          const code = findCode(p2.type);
          switch (code.code) {
            
            case 'union': {
              let p2_fields = Object.keys(code[code.code]);
              if (subsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
            }
          }
          throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
        };
      }; 
      break;
    case '{}':
      switch (p2.pattern) {
        case '{}':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify {${p1.fields}} with {${p2.fields}}`);
        case '<>':
          throw new Error('Cannot unify {} with <>');
        case 'type': {
          const code = findCode(p2.type);
          switch (code.code) {
            case 'product':{
              let p2_fields = Object.keys(code[code.code]);
              if (eqsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
            };
          }
          throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
        }
      };
      break;
    case '<>':
      switch (p2.pattern) {
        case '<>':
          if (eqsetP(p1.fields, p2.fields)) return p2;
          throw new Error(`Cannot unify <${p1.fields}> with <${p2.fields}>`);
        case 'type': {
          const code = findCode(p2.type);
          switch (code.code) {
            case 'union':{
              let p2_fields = Object.keys(code[code.code]);
              if (eqsetP(p1.fields, p2_fields)) return {...p2, fields: p2_fields};
            };
          }
          throw new Error(`Cannot unify ${JSON.stringify(p1)} with code ${p2.type}:${code.def}`);
        }
      };
      break;
    case 'type':
      switch (p2.pattern) {
        case 'type': 
          if (p1.type != p2.type)
            throw new Error(`Cannot unify different types: ${p1.type}:${findCode(p1.type).def} and ${p2.type}:${findCode(p2.type).def}`);
          return p2;
      };
      break;
  }
  return unify_two_patterns(findCode, p2, p1);
}
