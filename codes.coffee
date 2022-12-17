
are_different = (classes, representatives, name1, name2, codes) ->
  # console.log {classes, representatives, name1, name2, codes}
  return false if name1 is name2
  code1 = codes[name1]
  code2 = codes[name2]
  # console.log {name1, code1, name2, code2}
  return true unless code1.code is code2.code
  switch code1.code
    when "union", "product"
      [fields1,fields2] = [code1, code2]. map (code) ->
        do (arg = code[code.code]) ->
          Object.keys(arg).reduce (fields, label) ->
            fields[label] = representatives[arg[label]] ? arg[label]
            fields
          , {}
      return true unless Object.keys(fields1).length is Object.keys(fields2).length
      for field,rep of fields1 
        # console.log {field,rep1:rep,rep2:fields2[field]}
        return true unless fields2[field] is rep 
    when "vector"
      [arg1,arg2] = [code1, code2]. map ({vector}) ->
        representatives[vector] ? vector
      return true unless arg1 is arg2
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
    "#{pretty {code:"ref",ref:label_ref_map[label]}, codes, representatives} #{label}"
  .join ", "

pretty = (codeExp, codes, representatives) ->
  switch codeExp.code 
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
  # console.log {label_ref_map, representatives}
  Object.keys(label_ref_map).reduce (result, label) ->
    result[label] = do (name = label_ref_map[label]) ->
      representatives[name] ? name
    result
  , {}

normalizeAll = (codes,representatives) ->
  names = Object.keys codes
  normalized = names.reduce (normalized, name) ->
    if name is representatives[name]
      do (code = codes[name]) ->
        switch code.code
          when "union", "product"
            normalized[name] = { code: code.code } 
            normalized[name][code.code] = normalize code[code.code], representatives
          when "vector"
            normalized[name] = {code:"vector", vector: representatives[code.vector]}
  
    normalized    
  , {}

module.exports = {minimize,pretty,normalize,normalizeAll}


