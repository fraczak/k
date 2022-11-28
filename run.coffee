valid = (x) ->
  return undefined if isNaN x
  return x if x?

builtin = 
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


run = (exp, value) ->
  return undefined unless value?
  try 
    switch exp.op
      when "identity"
        return value
      when "str", "int"
        return exp[exp.op]
      when "ref"
        return do (value = builtin[exp.ref] value) ->
          throw new Error "Undefined" if value is undefined
          value          
      when "dot"
        return value[exp.dot]
      when "comp"
        return exp.comp.reduce (value, exp) ->
          value = run exp, value
          throw new Error "Undefined" unless value?
          value
        , value
      when "vector"
        return exp.vector.map (exp) -> 
          result = run exp, value
          throw new Error "Undefined" unless result?
          result
      when "union"
        for e in exp.union
          result = try run e, value
          return result if result?
        return undefined
      when "product"
        return exp.product.reduce (result, {label, exp}) ->
          do (value = run exp, value) ->
            throw new Error "Undefined" unless value?
            result[label] = value
            result
        , {}


module.exports = run