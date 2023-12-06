nth = 
${int n, [int] list}
--
$<int val, {} nothing>;

empty? = <{.0 nope}, {[] empty}>.empty;
singleton? =<{.1 nope},{[.0] singleton}> .singleton;
two? = <{.2 nope}, {[.0, .1] two}> .two;

take = 
${ int n, [int] list}
 {.n n, [] head, .list tail} take_
${[int] head, [int] tail};

take_ = 
${ int n, [int] head, [int] tail}
<
  {.head reverse head, .tail empty? tail},
  [[.n,0] EQ, {.head reverse head, .tail tail}] .1,
  {.n dec n, [.tail car, .head] CONS head, .tail cdr tail} take_
>
${[int] head, [int] tail};

reverse = {() in, [] out} reverse_;

reverse_ =
-- ${[int] in, [int] out}
< 
  [.in empty?, .out] .1,
  {[.in car, .out] CONS out, .in cdr in} reverse_
>;

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

split5 =
$[int]
<
  empty?,
  {5 n, () list} take [.head, .tail split5] CONS
>
$[[int]];

dec = [$int,-1] PLUS;
car = .0;
cdr = < SNOC.1, []>;

min = 
$[int]
< 
  singleton? .0,
  SNOC [[.0, .1.0] <GT .1, .0>, .1 cdr] CONS min
>
$int;

max = 
$[int]
< SNOC [.0, .1 max] <GT .0, .1>,
  .0 
>
$int;

run =
[(), split5 | {min min, max max} ^ [|.min ^ max, | .max ^ min] <GT, [.1,.0]>];

m5 = | [(),(),(),(),()] ^ cats;

cats = {() lists, [] result} cats_;
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


"a"