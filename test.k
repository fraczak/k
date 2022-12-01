
pow = 
  < [(), 0] EQ 1,
    [[(), -1] PLUS pow, ()] TIMES
  >;

 ---------  comments start by #, --, or // ----------------------------------
<                          -- merge of 4 partial functions...
  ["x=", .x, " & y=", .y], -- produces a vector of 4 values, if fields 'x' and 'y' are present
  ["only x=", .x],         -- produces a pair '["only x=", "value-of-x"]', for input like {"x":"value-of-x"}
							-- it is defined only if field 'x' is present
  ["only y=", .y],
  ["no x nor y"]           -- defined for all input, returns always the same one element vector
> 
-- one of the string vectors is passed to the following partial function, 
-- which produces a record (map) with one field "x&y", whose value is the
-- result of concatenating elements of the passed in vector
{ CONCAT "x&y" } 
------------------------------------------------------------------------------
