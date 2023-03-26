#!/usr/bin/env coffee
k = require "./"
run = require "./run"
{prettyCode, prettyRel} = require "./pretty"
fs = require "fs"

console.log "Very! experimental repl shell for 'k-language'..."

help = ->
  console.log " --h          print help"
  console.log " --a          print codes and relations"
  console.log " --c          print codes"
  console.log " --r          print rels"
  console.log " --l file.k   load 'file.k'"

help()

re = /^[ \n\t]*(?:--l[ ]+)(.+[^ ])[ ]*?$/

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
        if line.match /^[ \n\t]*(?:--h)?$/
          help()
        else if line.match re
          file = line.match(re)[1]
          console.log "-- loading file: #{file} ..."
          kScript = fs.readFileSync(file).toString();
          val = k.compile(kScript) val
          console.log "=> #{JSON.stringify val}"
        else if line.match /^[ \n\t]*(?:--a)?$/
          console.log JSON.stringify run.defs, " ", 2
        else if line.match /^[ \n\t]*(?:--r)?$/
          console.log do (defs = run.defs, result = {}) ->
            return result unless defs?
            do (prettyRel = prettyRel.bind null, prettyCode.bind null, defs.codes, defs.representatives) ->
              for relName, relExps of defs.rels
                result[relName] = relExps.map prettyRel
              result
        else if line.match /^[ \n\t]*(?:--c)?$/
          console.log do (defs = run.defs, result = {}) ->
            return result unless defs?
            for codeName, codeExp of defs.codes
              result[codeName] = prettyCode defs.codes, defs.representatives, codeExp
            result 
        else if not line.match /^[ \n\t]*(?:#.*)?$/
          try
            val = k.run "#{line} ()", val 
            console.log "=> #{JSON.stringify val}"
          catch e 
            console.error "ERROR:"
            console.error e
        
