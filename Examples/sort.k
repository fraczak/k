empty? = < .0 [], [()] > .0 ;
one? = < .1 [], () > [.0];
split = <
  SNOC         -- more than 2 elements
    [ .0, .1 SNOC ] {
      .0         first,
      .1.0       second,
      .1.1 split splitted_rest
    } [
      [.first,  .splitted_rest.0] CONS,
      [.second, .splitted_rest.1] CONS
    ],
  [[.0],[.1]], -- exactly two
  [[],()]      -- less
>;

merge = <
  [.0 SNOC, .1 SNOC]                      -- both lists are at least 2 element long
    < [[.0.0, .1.0] GT, .0.1, .1.1], [[.1.0, .0.0], .1.1, .0.1]>
    [.0.0, [.1, [.0.1, .2] CONS] merge] CONS,
  <[.0 SNOC, .1.0], [.1 SNOC, .0.0]>      -- one list has one element, other at least 2
    <
    [[.0.0, .1] GT, .0.1] [.0.0, [.1, [.0.1]] merge] CONS,
    [.1, .0 CONS] CONS
    >,
  [.0.0, .1.0] < GT, [.1,.0] > ,          -- both lists are one element long
  .0 one?,                                -- first list has one element
  .1                                      -- otherwise
>;

sort = <
  empty?,
  one?,
  split [.0  sort, .1 sort] merge
>;

<.range,()> sort
