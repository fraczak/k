
split = < 
  [.0 SNOC, .1, .2] [.0.1, [.0.0, .2] CONS, .1] split, 
  [.1, [.0.0,.2] CONS] 
>;

merge =
 <
  [.0 SNOC, .1 SNOC]                      -- both lists are at least 2 element long
    < [[.0.0, .1.0] GT, .0.1, .1.1], [[.1.0, .0.0], .1.1, .0.1]>
    [.0.0, [.1, [.0.1, .2] CONS] merge] CONS,
  <[.0 SNOC, .1.0], [.1 SNOC, .0.0]>      -- one list has one element, other at least 2
    <
    [[.0.0, .1] GT, .0.1] [.0.0, [.1, [.0.1]] merge] CONS,
    [.1, .0 CONS] CONS
    >,
  [.0.0, .1.0] < GT, [.1,.0] > ,          -- both lists are one element long
  .0,                                     -- first list has one element
  .1                                      -- otherwise
>;


sort = <
  SNOC [.1,[.0],[]]  -- we need that for singleton lists 
  split _log! [.0  sort, .1 sort] merge,
  ()
>;

<.range,()> sort
