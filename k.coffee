#!/usr/bin/env coffee
fs = require "fs"
k = require "./"

prog = process.argv[1]

{kScript,jsonStream,oneJson} =
do (oneJson = false, args = process.argv.slice(2)) ->
  try 
    kScript = do (arg = args.shift()) ->
      throw new Error() unless arg?
      if arg is "-k"
        fs.readFileSync(args.shift()).toString "utf8"
      else
        arg

    kScript = k.compile kScript
    
    jsonStream = do (arg = args.shift()) ->
      if arg is "-1"
        oneJson = true
        arg = args.shift()      
      return process.stdin unless arg?
      fs.createReadStream arg

    {kScript, jsonStream, oneJson}
  catch e
    console.error e
    console.error "Usage: #{prog} ( k-expr | -k k-file ) [ -1 ] [ json-file ]"
    console.error "       E.g.,  echo '{\"a\": 12}' | #{prog} '[(),()]'"
    process.exit -1 

if oneJson
  do (buffer = []) ->
    jsonStream.on 'data', (data) ->
      buffer.push data
    jsonStream.on 'end', ->
      try
        console.log JSON.stringify kScript JSON.parse buffer.join('')
      catch e
        console.error e
else
  do (buffer = [], line = 0) ->
    jsonStream.on 'data', (data) ->
      [first, rest...] = data.toString("utf8").split "\n"
      buffer.push first
      if rest.length > 0
        todo = buffer.join ""
        [rest..., last] = rest
        buffer = [last]
        todo = [todo, rest...]
        for json in todo
          if not json.match /^[ \n\t]*(?:#.*)?$/
            try
              console.log JSON.stringify kScript JSON.parse json
            catch e 
              console.error "Problem [line #{line}]: '#{json}'"
              console.error e
          line = line + 1
