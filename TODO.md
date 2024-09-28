# To do list for canonical names

- [ ] Write a script to search for conflicting names
- [ ] Export a relation. i.e., rewrite it as a list of all
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
