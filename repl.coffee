#!/usr/bin/env coffee
k = require "./"

do (val = {}, buffer = []) ->
  process.stdin.on 'data', (data) ->
    [first, rest...] = data.toString("utf8").split "\n"
    buffer.push first
    if rest.length > 0
      todo = buffer.join ""
      [rest..., last] = rest
      buffer = [last]
      todo = [todo, rest...]
      for line in todo
        if val is undefined
          val = {}
        if not line.match /^[ \n\t]*(?:#.*)?$/
          try
            val = k.run "#{line} ()", val 
            console.log "=> #{JSON.stringify val}"
          catch e 
            console.error "ERROR:"
            console.error e
        
