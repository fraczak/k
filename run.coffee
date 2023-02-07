fs = require "fs"

valid = (x) ->
  return undefined if isNaN x
  return x if x?

builtin =
  "_log!": (arg) ->
    console.error "_log!: #{JSON.stringify arg}"
    arg
  "fromFILE": (fileName) ->
    fs.readFileSync(fileName).toString() 
  "toFILE": ([x,fileName]) ->
    fs.writeFileSync fileName, x
    return x 
  "GT": (args) ->
    [ok,_] = do ([last,args...] = args) ->
      args.reduce ([ok,last], x) ->
        [ok and (last > x), x ]
      , [true,last]
    return args if ok
  "EQ": (args) ->
    [ok,_] = do ([last,args...] = args) ->
      args.reduce ([ok,last], x) ->
        [ok and (last is x), x ]
      , [true,last]
    return args if ok
  "PLUS": (args) -> valid args.reduce ((res, x) -> res + x), 0
  "TIMES": (args) -> valid args.reduce ((res, x) -> res * x), 1
  "MINUS": (args) -> 
    return valid(- args) if 'number' is typeof args 
    do ([res,args...] = args) ->
      return valid (- res) if args.length is 0
      valid args.reduce ((res, x) -> res - x), res
  "DIV": ([x,y]) -> 
    div = x // y
    rem = x %% y
    return {div,rem} if x is div * y + rem
  "CONCAT": (strs) -> strs.join('')
  "true": -> true
  "false": -> false
  "null": -> null
  "toJSON": (x) -> JSON.stringify x
  "fromJSON": (x) -> JSON.parse x
  "CONS": ([x,y]) -> [x,y...]
  "SNOC": (x) ->
    return [x[0],x.slice 1] if x.length > 1 

codes =
  "int": (x) -> 
    Number.isInteger x
  "string": (x) ->
    (x instanceof String) or ('string' is typeof x) 
  "bool": (x) ->
    x is true or x is false

verify = (code, value) ->
  # representatives = run.defs.representatives
  # defCodes = JSON.stringify run.defs.codes
  # console.log {code,value, representatives, defCodes}
  return false unless code?
  switch code.code
    when "vector"
      return false unless Array.isArray value
      value.every (x) ->
        verify code.vector, x
    when "product"
      return false unless "object" is typeof value
      do (fields = Object.keys(value)) ->
        return false unless fields.length is Object.keys(code.product).length
        fields.every (label) ->
          verify code.product[label], value[label]
    when "union"
      return false unless "object" is typeof value
      do (fields = Object.keys(value)) ->
        return false unless fields.length is 1
        verify code.union[fields[0]], value[fields[0]]
    else 
      do (c = run.defs.codes[run.defs.representatives[code]]) ->
        return verify c, value if c?  
        codes[code] value

runMap = new Map [
  ["code", ({code},value) -> value if verify code, value ]
  ["identity", (exp, value) -> value ]
  ["str", ({str},value) -> str]
  ["int", ({int},value) -> int]
  ["ref", ({ref},value) ->
      defn = run.defs.rels[ref]
      return run defn[defn.length - 1], value if defn?
      builtin[ref] value ]
  ["dot", ({dot},value) -> value[dot] ]
  ["comp", ({comp}, value) ->
      comp.reduce (value, exp) ->
        run exp, value unless value is undefined
      , value ]
  ["union", ({union},value) ->
      for e in union
        result = run e, value
        return result unless result is undefined
      return undefined ]
  ["vector", ({vector},value) ->
      result = []
      for e in vector
        r = run e, value
        return if r is undefined
        result.push r
      return result ]
  ["product", ({product}, value) ->
      result = {}
      for {label,exp} in product
        r = run exp, value
        return if r is undefined
        result[label] = r
      result ]
]

run = (exp, value) ->
  "use strict"
  # console.log {exp,value}
  return undefined if value is undefined
  # if runMap.has exp.op
  #    return runMap.get(exp.op)(exp,value)
  switch exp.op
    when "code"
      return value if verify exp.code, value
    when "identity"
      return value
    when "str", "int"
      return exp[exp.op]
    when "ref"
      defn = run.defs.rels[exp.ref]
      return run defn[defn.length - 1], value if defn?
      return builtin[exp.ref] value 
    when "dot"
      return value[exp.dot]
    when "comp"
      return exp.comp.reduce (value, exp) ->
        run exp, value unless value is undefined
      , value
    when "union"
      for e in exp.union
        result = run e, value
        return result unless result is undefined
      return undefined
    when "vector"
      result = []
      for e in exp.vector
        r = run e, value
        return if r is undefined
        result.push r
      return result
    when "product"
      result = {}
      for {label,exp} in exp.product
        r = run exp, value
        return if r is undefined
        result[label] = r
      return result
    else  
      console.error exp.op

module.exports = run
