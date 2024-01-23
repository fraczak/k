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
  [[.n,0] EQ, {.head reverse head, .tail tail}] .1,
  {.n dec n, [.tail car, .head] CONS head, .tail cdr tail} take_
>
-- ${[int] head, [int] tail}
;

reverse = {() in, [] out} reverse_;

reverse_ =
-- ${[int] in, [int] out}
< 
  [.in empty?, .out] .1,
  {[.in car, .out] CONS out, .in cdr in} reverse_
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
    [.lists car empty?, {.lists cdr lists, .result result}] .1,
    {.lists [car cdr, cdr] CONS lists, [.lists car car, .result] CONS result}
  > cats_
>; 

range = $int {() n, [] result} range_ $[int];
range_ =
< 
  [.n.0, .result] .1,
  {.n dec n, [.n, .result] CONS result} range_
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
  [.list empty?, .res].1,
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
  
-- loaded
