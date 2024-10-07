inc = [$int,1] PLUS;
dec = [$int,-1] PLUS;
pos? = [$int,0] GT .0;
car = ?[X] .0;
cdr = ?[X] < SNOC.cdr, []>;
empty? = ?[X] <{.0 nope}, {() empty}> .empty;
singleton? = ?[X] <{.1 nope},{[.0] singleton}> .singleton;

take = 
--?{ $int n, [(...)] list}
  {.n n, [] head, .list tail} take_
--?{[X] head, [X] tail}
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

part = 
  { take a, .n n } 
  { .a.head car, 
    <
      .a.tail empty? [], 
      {.n n, .a.tail list} part
    >       cdr
  } CONS
;

reverse = ?[X] {() in, [] ?[X] out} reverse_;

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
  {() list, [] ?[X] one, [] ?[X] two} split_
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

merge = { .0 one, .1 two, [] result} merge_ reverse;

merge_ = ?{[X] one, [X] two, [X] result} 
<
  {.one empty? if, {.two in, .result out} reverse_ then} .then,
  {.two empty? if, {.one in, .result out} reverse_ then} .then,
  {[.two car, .one car] GT if, {.two one, .one two, .result result} merge_ then} .then,
  
  {.one cdr one, .two two, {.one car car, .result cdr} CONS result} merge_
>
;

sort = 
?[X]
<
  empty?,
  singleton?,
  split {.0 sort 0, .1 sort 1} merge
>
?[X]
;

uniq =  < 
  empty?, 
  singleton?, 
  {[.0,.1] EQ if, cdr uniq then} .then, {car car, cdr uniq cdr} CONS 
>;

min = 
?[X]
< 
  singleton? .0,
  SNOC {[.car, .cdr.0] <GT .1, .0> car, .cdr cdr cdr} CONS min
>
?X
;

max = 
?[X]
< 
  singleton? .0,
  SNOC {[.car, .cdr.0] <GT .0, .1> car, .cdr cdr cdr} CONS max
>
?X
;


cat = 
?{[X] x, [X] y} 
{.x reverse in, .y out} reverse_
?[X]
;

cats = 
?[[X]]
  {() lists, [] result} cats_
?[X]
;

cats_ =
?{[[X]] lists, [X] result}
< 
  {.lists empty? if, .result then} .then reverse,
  < 
    {.lists car empty? if, {.lists cdr lists, .result result} then} .then,
    {.lists {car cdr car, cdr cdr} CONS lists, {.lists car car car, .result cdr} CONS result}
  > cats_
>
?[X]
; 

range = {() n, [] result} range_;
range_ =
< 
  {.n.0 if, .result then} .then,
  {.n dec n, {.n car, .result cdr} CONS result} range_
>;


--  using PIPES:  join = [.list .0, [.with, .list cdr |] ^ cats] CONS; 
join = 
?{[X] list, X with}
  {.list list, .with with, [] result} 
  join_ 
  reverse
?[X]
;

join_ = 
<
  {.list empty? if, .result then} .then,
  {.list singleton? if, {.list car car, .result cdr} CONS then} .then,
  {.list cdr list, .with with, {.with car, {.list.0 car, .result cdr} CONS cdr} CONS result} 
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
 {.pos.0 if, .list.0 then} .then,
 {.list cdr list, [.pos, 0] GT .0 dec pos} get
>;

set = 
 {{.i n, .list list} take take, .v v} [.take.head, [.v], .take.tail cdr] cats 
;
  
// zip = 
// -- ${[int] x, [int] y} 
// < 
//   {[.x car, .y car] car, {.x cdr x, .y cdr y} zip cdr} CONS, 
//   []
// >;

Zip = 
  ?{[X] x, [Y] y, ...} 
  {.x x, .y y, [] r} Zip_ reverse;
Zip_ = < 
  { .x cdr x, .y cdr y, {{.x car x, .y car y} car, .r cdr } CONS r} Zip_, 
  .r 
  >;

zip = Zip | [.x, .y] ^;

pascal_ = 
-- next line in pascal's triangle
  {{0 car,() cdr} CONS x, {0 car, reverse cdr} CONS reverse y} zip (| PLUS ^)
;

pascal = < 
  pos? dec pascal pascal_, 
  [1]
>;


-- loaded
()