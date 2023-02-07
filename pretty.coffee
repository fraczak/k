
compareAs = (fn) ->
  (a,b) -> 
    [a,b] = [a,b].map fn
    return -1 if a < b
    return 1 if a > b
    0 

prettyCode_labels = (label_ref_map, codes, representatives) ->
  labels = Object.keys(label_ref_map)
  .sort compareAs (x) -> x
  .map (label) ->
    "#{prettyCode {code:"ref",ref:label_ref_map[label]}, codes, representatives} #{label}"
  .join ", "

prettyCode = (codeExp, codes, representatives) ->
  switch codeExp.code 
    when "ref"
      name = representatives[codeExp.ref] ? codeExp.ref
      if name.startsWith ":"
        prettyCode codes[name], codes, representatives
      else
        name
    when "product"
      "{#{prettyCode_labels codeExp.product, codes, representatives}}"
    when "union"
      "<#{prettyCode_labels codeExp.union, codes, representatives}>"
    when "vector"
      "[#{representatives[codeExp.ref] ? codeExp.ref}]"
    else    
      ":error"

prettyRelMap = new Map [
    ['vector', ({vector=[]}) -> 
        "[#{vector.map(prettyRel).join()}]"]
    ['union', ({union=[]}) ->
        "<#{union.map(prettyRel).join()}>"]
    ['ref', ({ref}) -> ref]
    ['identity', -> "()"]
    ['comp', ({comp=[]}) -> 
        "(#{comp.map(prettyRel).join(" ")})"]
    ['str', ({str}) -> "'#{str}'"]
    ['int', ({int}) -> int]
    ['dot', ({dot}) -> 
        if 'number' is typeof dot
            ".#{doc}"
        else if /^[a-zA-Z_][a-zA-Z0-9_?!]*$/.test dot
            ".#{dot}"
        else    
            "'#{dot}'"]
    ['code', ({code}) -> "$"+code ] 
    ['product', ({product}) ->
        labelled = product.map ({label,exp}) ->
            if /^[a-zA-Z_][a-zA-Z0-9_?!]*$/.test label
                "#{prettyRel exp} #{label}"
            else    
                "#{prettyRel} '#{label}'"
        "{#{labelled.join()}}"
        ]
]

prettyRel = (codeExp) => 
    prettyRelMap.get(codeExp.op) codeExp

module.exports = { prettyCode, prettyRel }