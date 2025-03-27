# To do list for canonical names

- [ ] Write a script to search for conflicting names
- [*] Export a relation. i.e., rewrite it as a list of all
      dependency definitions using canonical names
- [ ] Find a way of adding 'comments' or some way of 'tagging' the definitions
- [X] The definitions should be simplied by removing useless filters
- [X] Definitions, which are just aliases to non built-in rels should not introduce a new canonical name
- [ ] Can we inline some references w/o changing the canonical name?

## Simplification rules

It seems to me that after calculating input and output patterns, all
filters and code expressions could be replaced by just input and output
filters corresponding to the patterns. [DONE]

The filer variables have to be renamed for normalization if they take part of 
the canonical name calculation. [DONE]

## DESER

Serialization and deserialization of values.

### Can we define byte-array via prefix-free codes?

### Non prefix-free de/serialization

How programatically change encoding of a value? Is it possible to add some
annotations on the type graph? 

Maybe it belongs to "execution environment", e.g., `k --deser JSON`, 
`k --deser AVRO/UTF8`, where `JSON`, `AVRO`, `UTF8` are provided 
by some external spec?

E.g.:

```DESER:
 $ BsAqRMv = < BsAqRMv 0, BsAqRMv 1, KL _ >; -- $C0=<C0"0",C0"1",C1"_">;$C1={};

  $ bnat = < {} _ @as '', bnat 0 @as '0' , bnat 1 >;
  ::UTF8:: 
      {{} _} => ()
      {$bnat 0} => \u2602   

Ok, it looks for me like what we need is the "Monad", i.e., a set of
functions with side-effects (like `_log!`). 
Get straight, we have `write_0!`, `write_1!`, `read_0!`, and `read_1!`, 
or whatever is supported by the target.

#### How to implement `JSON`?



