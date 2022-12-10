
are_different = (classes, representatives, name1, name2, codes) ->
  return false if name1 is name2
  code1 = codes[name1]
  code2 = codes[name2]
  return true unless code1.op is code2.op
  switch code1.op
    when "union", "product"
      [fields1,fields2] = [code1, code2]. map (code) ->
        Object.keys(code[code.op]).reduce (fields, label) ->
          fields[label] = representatives[code[code.op][label]]
        , {}
      return true unless Object.keys(fields1).length is Object.keys(fields2).length
      for field,rep of fields1 
        return true unless fields2[field] is rep 
      return false
    when "vector"
      return representatives[code1.vector] isnt representatives[code2.vector]  
  false

minimize = (codes) ->
  names = Object.keys codes
  classes = {}
  classes["{}"] = names
  representatives = names.reduce (representatives, name) ->
    representatives[name] = "{}"
    representatives
  , {}
  changed = true
  while changed
    changed = false
    for name1, eq_names of classes
      code = codes[name1]
      [eq_names, dif_names] = eq_names.reduce ([eq_names, dif_names], name2) ->
        if are_different(classes, representatives, name1, name2, codes)
          dif_names.push name2
        else
          eq_names.push name2
        [eq_names,dif_names]
      , [[],[]]
      classes[name1] = eq_names
      do (new_rep = dif_names[0]) ->
        if new_rep?
          changed = true
          classes[new_rep] = dif_names
          for x in dif_names
            representatives[x] = new_rep
  {classes,representatives}

compareAs = (fn) ->
  (a,b) -> 
    [a,b] = [a,b].map fn
    return -1 if a < b
    return 1 if a > b
    0 

pretty_labels = (label_ref_map, codes, representatives) ->
  labels = Object.keys(label_ref_map)
  .sort compareAs (x) -> x
  .map (label) ->
    "#{pretty {op:"ref",ref:label_ref_map[label]}, codes, representatives} #{label}"
  .join ", "

pretty = (codeExp, codes, representatives) ->
  switch codeExp.op 
    when "ref"
      name = representatives[codeExp.ref] ? codeExp.ref
      if name.startsWith ":"
        pretty codes[name], codes, representatives
      else
        name
    when "product"
      "{#{pretty_labels codeExp.product, codes, representatives}}"
    when "union"
      "<#{pretty_labels codeExp.union, codes, representatives}>"
    when "vector"
      "[#{representatives[codeExp.ref] ? codeExp.ref}]"
    else    
      ":error"

     
normalize = (label_ref_map, representatives) ->
  Object.keys(label_ref_map).reduce (result, label) ->
    result[label] = representatives[label_ref_map[label]]
    result
  , {}

normalizeAll = (codes,representatives) ->
  names = Object.keys codes
  normalized = names.reduce (normalized, name) ->
    if name is representatives[name]
      do (code = codes[name]) ->
        switch code.op
          when "union", "product"
            normalized[name] = { op: code.op } 
            normalized[name][op] = normalize codes[name][op], representatives
          when "vector"
            normilized[name] = {op:"vector", vector: representatives[code.vector]}
  
    normalized    
  , {}

module.exports = {minimize,pretty,normalize,normalizeAll}


