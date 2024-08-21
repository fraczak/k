inc = [$int,1] PLUS;
dec = [$int,-1] PLUS;
car = .0;
cdr = < SNOC.1, []>;
empty? = <{.0 nope}, {() empty}> .empty;
singleton? = <{.1 nope},{[.0] singleton}> .singleton;

take = 
-- ${ int n, [int] list}
  {.n n, [] head, .list tail} take_
-- ${[int] head, [int] tail}
;

take_ = 
-- ${ int n, [int] head, [int] tail}
<
  {.head reverse head, .tail empty? tail},
  {[.n,0] EQ if, {.head reverse head, .tail tail} then} .then,
  {.n dec n, {.tail car 0, .head 1} CONS head, .tail cdr tail} take_
>
-- ${[int] head, [int] tail}
;

reverse = {() in, [] out} reverse_;

reverse_ =
-- ${[int] in, [int] out}
< 
  [.in empty?, .out] .1,
  {{.in car 0, .out 1} CONS out, .in cdr in} reverse_
>
-- $[int]
;

split = {() list, [] one, [] two} split_;

split_ =
-- ${[int] list, [int] one, [int] two}
<
  [.list empty?, [.one reverse, .two reverse] ] .1,
  {.list cdr             list, 
    [.list.0, .one] CONS two, 
    .two                 one
  } split_
>
-- ${[int] [int]}
;

merge =
-- ${[int] 0, [int] 1}
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
>
-- $[int]
;

sort = 
-- $[int]
<
  empty?,
  singleton?,
  split [.0 sort, .1 sort] merge
>
-- $[int]
;

merge_uniq =
-- ${[int] 0, [int] 1}
 <
  [.0 SNOC, .1 SNOC]                      -- both lists are at least 2 element long
    < 
      [[.0.0, .1.0] GT, .0.1, .1.1], 
      [[.1.0, .0.0], .1.1, .0.1]
    >
    < 
      [.0 EQ .0, [.1,.2] merge_uniq],
      [.0.0, [.1, [.0.1, .2] CONS] merge_uniq] 
    > CONS,
  <[.0 SNOC, .1.0], [.1 SNOC, .0.0]>      -- one list has one element, other at least 2
    <
      [[.0.0, .1] EQ, .0 CONS] .1,
      [[.0.0, .1] GT, .0.1] [.0.0, [.1, [.0.1]] merge_uniq] CONS,
      [.1, .0 CONS] CONS
    >,
  [.0.0, .1.0] < GT, EQ [.0], [.1,.0] > ,          -- both lists are one element long
  .0,                                     -- first list has one element
  .1                                      -- otherwise
>
-- $[int]
;

sort_uniq = <empty?, singleton?, split [.0 sort_uniq, .1 sort_uniq] merge_uniq >;

min = 
-- $[int]
< 
  singleton? .0,
  SNOC [[.0, .1.0] <GT .1, .0>, .1 cdr] CONS min
>
-- $int
;
max = 
-- $[int]
< 
  singleton? .0,
  SNOC [[.0, .1.0] <GT .0, .1>, .1 cdr] CONS max
>
-- $int
;

cat = 
-- ${[int] x, [int] y} 
{.x reverse in, .y out} reverse_
-- $[int]
;

cats = 
-- $ [[int]]
{() lists, [] result} cats_
-- $[int]
;

cats_ =
-- $ {[[int]] lists, [int] result}
< 
  [.lists empty?, .result] .1 reverse,
  < 
    {.lists car empty? if, {.lists cdr lists, .result result} then} .then,
    {.lists [car cdr, cdr] CONS lists, [.lists car car, .result] CONS result}
  > cats_
>; 

range = $int {() n, [] result} range_ $[int];
range_ =
< 
  {.n.0 if, .result then} .then,
  {.n dec n, {.n 0, .result 1} CONS result} range_
>;

--  using PIPES:  join = [.list .0, [.with, .list cdr |] ^ cats] CONS; 
join = 
-- ${[str] list, str with}
  {.list list, .with with, [] result} 
  join_ 
  reverse
-- $[str]
;

join_ = 
<
  [.list empty?, .result] .1,
  [.list singleton?, [.list car, .result] CONS] .1,
  {.list cdr list, .with with, [.with, [.list.0, .result] CONS] CONS result} 
  join_
>;

-- vectors

-- len = | 1 ^ PLUS; -- using PIPES
len = {() list, 0 res} len_;
len_ = <
  {.list empty? if, .res then} .then,
  {.list cdr list, .res inc res} len_
>;

get = 
-- {[int] list, int pos}
<
 [.pos.0, .list.0].1,
 {.list cdr list, [.pos, 0] GT .0 dec pos} get
>;

set = 
-- ${[int] list, int i, int v} 
 [{.i n, .list list} take, .v] [.0.head, [.1], .0.tail cdr] cats
-- $[int] 
;
  
zip = 
-- ${[int] x, [int] y} 
< 
  {[.x car, .y car] 0, {.x cdr x, .y cdr y} zip 1} CONS, 
  []
>;

map_with_PLUS = $[[int]]
  < 
    {car PLUS 0, cdr map_with_PLUS 1} CONS,
    []
  >
  $[int];

pascal = 
-- next line in pascal's triangle
$[int]
{{0 0,() 1} CONS x, {0 0, reverse 1} CONS reverse y} zip map_with_PLUS
$[int]
;

// pascal2 = {{0 0,() 1} CONS x, [0,reverse] CONS reverse y} zip | PLUS ^;

-- loaded
()