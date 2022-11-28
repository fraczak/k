identity = op: "identity"

comp = (e1, e2) ->
    return e2 if e1.op is "identity"
    return e1 if e2.op is "identity"
    if e1.op is "comp" and e2.op is "comp"
      return {op: "comp", comp: [].concat(e1.comp,e2.comp)}
    if e1.op is "comp"
      return {op: "comp", comp: [].concat(e1.comp,[e2])}
    if e2.op is "comp"
      return {op: "comp", comp: [].concat([e1],e2.comp)}
    {op: "comp", comp: [e1,e2]}

module.exports = {identity, comp};
