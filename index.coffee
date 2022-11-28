fs = require "fs"
{parse} = require "./parser.js"
run = require "./run"

compile = (script) ->
  do (exp = parse script) ->
    (data) -> run exp, data
compile.doc = "Transforms k-script (string) into a function"

compile_file = (fileName) ->
  compile fs.readFileSync(fileName).toString "utf8"
compile_file.doc = "Transforms k-script (from file) into a function"

runScriptOnData = (script, data) ->
  compile(script) data
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data"

module.exports = {compile, compile_file, run: runScriptOnData, parse: parse}
