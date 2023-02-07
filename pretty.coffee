
compareAs = (fn) ->
  (a,b) -> 
    [a,b] = [a,b].map fn
    return -1 if a < b
    return 1 if a > b
    0 

nameRE = /^[a-zA-Z_][a-zA-Z0-9_?!]*$/
prettyCode_labels = ( codes, representatives, label_ref_map) ->
  labels = Object.keys(label_ref_map)
  .sort compareAs (x) -> x
  .map (label) ->
    plabel = if /^[a-zA-Z_][a-zA-Z0-9_?!]*$/.test label
      label
    else    
      "'#{label}'" 
    "#{prettyCode codes, representatives, {code:"ref",ref:label_ref_map[label]}} #{plabel}"
  .join ", "

prettyCode = (codes, representatives, codeExp) ->
  switch codeExp.code 
    when "ref"
      name = representatives[codeExp.ref] ? codeExp.ref
      if name.startsWith ":"
        prettyCode codes, representatives, codes[name]
      else
        name
    when "product"
      "{#{prettyCode_labels codes, representatives, codeExp.product}}"
    when "union"
      "<#{prettyCode_labels codes, representatives, codeExp.union}>"
    when "vector"
      "[#{representatives[codeExp.vector] ? codeExp.vector}]"
    else    
      ":error"

prettyRel = (prettyCode, exp) ->
  "use strict"
  pretty = (exp) ->
    switch exp.op 
      when 'vector' 
        "[#{exp.vector.map(pretty).join(", ")}]"
      when 'union'
        "<#{exp.union.map(pretty).join(", ")}>"
      when 'ref'
        exp.ref
      when 'identity'
        "()"
      when 'comp'
        exp.comp.map(pretty).join(" ")
      when 'str'
        "'#{exp.str}'"
      when 'int'
        exp.int
      when 'dot'
        if 'number' is typeof exp.dot
          ".#{exp.dot}"
        else if nameRE.test exp.dot
          ".#{exp.dot}"
        else    
          "'#{exp.dot}'"
      when 'code'
        "$#{prettyCode {code:"ref",ref:exp.code}}"
      when 'product'
        do (labelled = exp.product.map ({label,exp}) ->
              if /^[a-zA-Z_][a-zA-Z0-9_?!]*$/.test label
                  "#{pretty exp} #{label}"
              else    
                  "#{pretty exp} '#{label}'") ->
          "{#{labelled.join(", ")}}"
  pretty exp
        
module.exports = { prettyCode, prettyRel }