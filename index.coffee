{parse} = require "./parser.js"
run = require "./run"
t = require "./codes"


finalize = (codes) ->
  representatives = t.minimize(codes).representatives
  codes = t.normalizeAll codes, representatives

  {codes, representatives}


compile = (script) ->
  do ({defs,exp} = parse script) ->
    # console.log defs
    {codes, representatives} = finalize defs.codes
    # console.log {codes, representatives}
    run.defs = {codes, representatives, rels: defs.rels}
    
    (data) -> run exp, data
    
compile.doc = "Transforms k-script (string) into a function"

runScriptOnData = (script, data) ->
  compile(script) data
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data"

module.exports = {compile, run: runScriptOnData, parse}
