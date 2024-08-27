inc = [$int,1] PLUS;
dec = [$int,-1] PLUS;
car = .0;
cdr = < SNOC.cdr, []>;
empty? = ?[X] <{.0 nope}, {() empty}> .empty;
singleton? = ?[X] <{.1 nope},{[.0] singleton}> .singleton;

take = 
?{ $int n, [X] list}
  {.n n, [] head, .list tail} take_
?{[X] head, [X] tail}
;

take_ = 
?{ $int n, [X] head, [X] tail}
<
  {.head reverse head, .tail empty? tail},
  {[.n,0] EQ if, {.head reverse head, .tail tail} then} .then,
  {.n dec n, {.tail car car, .head cdr} CONS head, .tail cdr tail} take_
>
?{ [X] head, [X] tail}
;

reverse = ?[X] {() in, [] out} reverse_ ?[X];

reverse_ =
?{ [X] in, [X] out}
< 
  {.in empty? if, .out then} .then,
  {{.in car car, .out cdr} CONS out, .in cdr in} reverse_
>
?[X]
;

split = 
? [X]
  {() list, [] one, [] two} split_
? { [X] 0, [X] 1 };

split_ =
? {[X] list, [X] one, [X] two}
<
  {.list empty? if, {.one reverse 0, .two reverse 1} then} .then,
  {.list cdr             list, 
    {.list.0 car, .one cdr} CONS two, 
    .two                 one
  } split_
>
? {[X] 0, [X] 1}
;

merge =
?{ [X] 0, [X] 1 }
 <
  {.0 SNOC 0, .1 SNOC 1}                      -- both lists are at least 2 element long
  ? {{X car, [X] cdr} 0, {X car, [X] cdr} 1}
  < 
    {[.0.car, .1.car] GT 0, .0.cdr 1, .1.cdr 2}, 
    {[.1.car, .0.car] 0, .1.cdr 1, .0.cdr 2}
  >
  ? {[X] 0, [X] 1, [X] 2}
  {.0.0 car, {.1 0, {.0.1 car, .2 cdr} CONS 1} merge cdr} CONS,
  
  < {.0 SNOC 0, .1.0 1}, {.1 SNOC 0, .0.0 1} >      -- one list has one element, other at least 2
  --? {{X car, [X] cdr} 0, X 1}
  <
    {[.0.car, .1] GT 0, .0.cdr 1}
    ?{[X] 0, [X] 1} 
    {.0.0 car, {.1 0, [.0.1] 1} merge cdr} CONS,

    {.1 car, .0 CONS cdr} CONS
  >,
  
  [.0.0, .1.0] < GT, [.1,.0] > ,          -- both lists are one element long
  .0,                                     -- first list has one element
  .1                                      -- otherwise
>
? [X]
;

sort = 
-- $[int]
<
  empty?,
  singleton?,
  split {.0 sort 0, .1 sort 1} merge
>
-- $[int]
;

merge_uniq =
-- ${[int] 0, [int] 1}
 <
  {.0 SNOC 0, .1 SNOC 1}                       -- both lists are at least 2 element long
    < 
      {[.0.car, .1.car] GT 0, .0.cdr 1, .1.cdr 2}, 
      {[.1.car, .0.car] 0, .1.cdr 1, .0.cdr 2}
    >
    -- ${[int] 0, [int] 1, [int] 2}
    < 
      {.0 EQ .0 car, {.1 0, .2 1} merge_uniq cdr},
      {.0.0 car, {.1 0, {.0.1 car, .2 cdr} CONS 1} merge_uniq cdr} 
    > CONS,

  <{.0 SNOC 0, .1.0 1}, {.1 SNOC 0, .0.0 1} >      -- one list has one element, other at least 2
  -- ${{int car, [int] cdr} 0, int 1}
    <
      {[.0.car, .1] EQ if, .0 CONS then} .then,
      {[.0.car, .1] GT 0, .0.cdr 1} 
      {.0.0 car, {.1 0, [.0.1] 1} merge_uniq cdr} CONS,
      {.1 car, .0 CONS cdr} CONS
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
  SNOC {[.car, .cdr.0] <GT .1, .0> car, .cdr cdr cdr} CONS min
>
-- $int
;
max = 
-- $[int]
< 
  singleton? .0,
  SNOC {[.car, .cdr.0] <GT .0, .1> car, .cdr cdr cdr} CONS max
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
  {.lists empty? if, .result then} .then reverse,
  < 
    {.lists car empty? if, {.lists cdr lists, .result result} then} .then,
    {.lists {car cdr car, cdr cdr} CONS lists, {.lists car car car, .result cdr} CONS result}
  > cats_
>
-- $[int]
; 

range = $int {() n, [] result} range_ $[int];
range_ =
< 
  {.n.0 if, .result then} .then,
  {.n dec n, {.n car, .result cdr} CONS result} range_
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
  {[.x car, .y car] car, {.x cdr x, .y cdr y} zip cdr} CONS, 
  []
>;

map_with_PLUS = $[[int]]
  < 
    {car PLUS car, cdr map_with_PLUS cdr} CONS,
    []
  >
  $[int];

pascal = 
-- next line in pascal's triangle
$[int]
{{0 car,() cdr} CONS x, {0 car, reverse cdr} CONS reverse y} zip map_with_PLUS
$[int]
;

// pascal2 = {{0 0,() 1} CONS x, [0,reverse] CONS reverse y} zip | PLUS ^;

-- loaded
()