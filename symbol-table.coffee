rels = Object.create null
codes = Object.create null
codes["{}"] = {code: "product", product: {}}

identity = op: "identity"

is_identity_rel = (rel) ->
  rel.op is "identity"

is_constant_rel = (rel) ->
  switch rel?.op
    when "int", "str"
      true
    when "vector"
      Object.values(rel[rel.op]).every is_constant_rel
    when "product"
      Object.values(rel[rel.op]).every ({exp}) -> 
        is_constant_rel exp
    else 
      false

is_empty_rel = (rel) ->
  rel.op is "union" and rel.union.length is 0
  
is_full_rel = (rel) ->
  return true if is_constant_rel rel
  switch rel.op
    when "int", "str", "identity"
      true
    when "comp"
      rel.comp.every is_full_rel
    when "vector"
      Object.values(rel[rel.op]).every is_full_rel
    when "product"
      Object.values(rel[rel.op]).every ({exp}) -> 
        is_full_rel exp
    else  
      false

comp_first = (e1, e2) ->
    return e2 if is_identity_rel e1
    return e1 if is_identity_rel e2
    return e1 if is_empty_rel e1
    return e2 if is_empty_rel e2
    if e1.op is "comp" and e2.op is "comp"
      return {op: "comp", comp: [].concat(e1.comp,e2.comp)}
    if e1.op is "comp"
      return {op: "comp", comp: [].concat(e1.comp,[e2])}
    if e2.op is "comp"
      return {op: "comp", comp: [].concat([e1],e2.comp)}
    {op: "comp", comp: [e1,e2]}

comp = (e1, e2) ->
  result = comp_first e1, e2
  return result unless result.op is "comp"
  result.comp = result.comp.reduceRight (c, e) ->
    if is_constant_rel(c[0]) and is_full_rel e
      return c
    return [e, c...]
  , []
  result

union = (rels) ->
  list = []
  do ->
    for rel in rels
      new_rels = if rel.op is "union"
        rel.union
      else 
        [rel]
      for rel in new_rels
        list.push rel
        return if is_full_rel rel 
  return list[0] if list.length is 1
  {op: "union", union: list}
    
as_ref = (codeExp) ->
  return codeExp.ref if codeExp.code is "ref"
  newName = ":#{Object.keys(codes).length}"
  codes[newName] = codeExp
  return newName

add_rel = (name, rel) ->
  rels[name] ?= [] 
  rels[name].push rel

add_code = (name, code) ->
  codes[name] = code

module.exports = {identity, comp, union, rels, codes, add_rel, add_code, as_ref};
