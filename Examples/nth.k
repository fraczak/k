incr = [$@int,1] PLUS;
decr = [$@int,-1] PLUS;
pos? = [$@int,0] GT .0;
empty? = <{ SNOC.car nope}, {() empty}> .empty;
singleton? = ?[X] <{.1 nope},{[.0] singleton}> .singleton;

take = 
--?{ $@int n, [(...)] list}
  {.n n, [] head, .list tail} take_
--?{[X] head, [X] tail}
;

take_ = 
?{ $@int n, [X] head, [X] tail}
<
  {.head inverse head, .tail empty? tail},
  {[.n,0] EQ if, {.head inverse head, .tail tail} then} .then,
  {.n decr n, {.tail SNOC.car car, .head cdr} CONS head, .tail SNOC.cdr tail} take_
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

inverse = ?[X] {() in, [] ?[X] out} inverse_;

inverse_ =
?{ [X] in, [X] out}
< 
  {.in empty? if, .out then} .then,
  {{.in SNOC.car car, .out cdr} CONS out, .in SNOC.cdr in} inverse_
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
  {.list empty? if, {.one inverse 0, .two inverse 1} then} .then,
  {.list SNOC.cdr             list, 
    {.list.0 car, .one cdr} CONS two, 
    .two                 one
  } split_
>
? {[X] 0, [X] 1}
;

merge = { .0 one, .1 two, [] result} merge_ inverse;

merge_ = ?{[X] one, [X] two, [X] result} 
<
  {.one empty? if, {.two in, .result out} inverse_ then} .then,
  {.two empty? if, {.one in, .result out} inverse_ then} .then,
  {[.two SNOC.car, .one SNOC.car] GT if, {.two one, .one two, .result result} merge_ then} .then,
  
  {.one SNOC.cdr one, .two two, {.one SNOC.car car, .result cdr} CONS result} merge_
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
  {[.0,.1] EQ if, SNOC.cdr uniq then} .then, { SNOC.car car, SNOC.cdr uniq cdr} CONS 
>;

min = 
?[X]
< 
  singleton? .0,
  SNOC {[.car, .cdr.0] <GT .1, .0> car, .cdr SNOC.cdr cdr} CONS min
>
?X
;

max = 
?[X]
< 
  singleton? .0,
  SNOC {[.car, .cdr.0] <GT .0, .1> car, .cdr SNOC.cdr cdr} CONS max
>
?X
;


cat = 
?{[X] x, [X] y} 
{.x inverse in, .y out} inverse_
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
  {.lists empty? if, .result then} .then inverse,
  < 
    {.lists SNOC.car empty? if, {.lists SNOC.cdr lists, .result result} then} .then,
    {.lists { SNOC.car SNOC.cdr car, SNOC.cdr cdr} CONS lists, {.lists SNOC.car SNOC.car car, .result cdr} CONS result}
  > cats_
>
?[X]
; 

range = {() n, [] result} range_;
range_ =
< 
  {.n.0 if, .result then} .then,
  {.n decr n, {.n car, .result cdr} CONS result} range_
>;


--  using PIPES:  join = [.list .0, [.with, .list SNOC.cdr |] ^ cats] CONS; 
join = 
?{[X] list, X with}
  {.list list, .with with, [] result} 
  join_ 
  inverse
?[X]
;

join_ = 
<
  {.list empty? if, .result then} .then,
  {.list singleton? if, {.list SNOC.car car, .result cdr} CONS then} .then,
  {.list SNOC.cdr list, .with with, {.with car, {.list.0 car, .result cdr} CONS cdr} CONS result} 
  join_
>;

-- vectors

-- len = | 1 ^ PLUS; -- using PIPES
len = {() list, 0 res} len_;
len_ = <
  {.list empty? if, .res then} .then,
  {.list SNOC.cdr list, .res incr res} len_
>;

get = 
-- {[@int] list, @int pos}
<
 {.pos.0 if, .list.0 then} .then,
 {.list SNOC.cdr list, [.pos, 0] GT .0 decr pos} get
>;

set = 
 {{.i n, .list list} take take, .v v} [.take.head, [.v], .take.tail SNOC.cdr] cats 
;

Zip = 
  ?{[X] x, [Y] y, ...} 
  {.x x, .y y, [] r} Zip_ inverse;
Zip_ = < 
  { .x SNOC.cdr x, .y SNOC.cdr y, {{.x SNOC.car x, .y SNOC.car y} car, .r cdr } CONS r} Zip_, 
  .r 
  >;

zip = Zip | [.x, .y] ^;

pascal_ = 
-- next line in pascal's triangle
  {{0 car,() cdr} CONS x, {0 car, inverse cdr} CONS inverse y} zip (| PLUS ^)
;

pascal = < 
  pos? decr pascal pascal_, 
  [1]
>;

MINUS = $[@int]
  SNOC [.car, [.cdr PLUS, -1] TIMES] PLUS;

nth = 
  ?{$@int n, [X] list}
  <
    {[.list len, 5] GT if, () then} .then 
    {.n n, .list list, {.list list, 5 n} part (| <{3 n, () list} nth, .0> ^) medians }
    {.n n, .list list, {[.medians len,2] DIV .div n, .medians list} nth median} 
    {
      .n n, 
      [.median, .list |] GT .1 ^ smaller,
      [.median, .list |] EQ .1 ^ equal,
      [.list |, .median] GT .0 ^ bigger
    }
    { 
      .n n, .smaller smaller, .equal equal, .bigger bigger,
      .smaller len smaller_len
    }
    < 
      {[.smaller_len, .n] <GT,EQ> if, {.n n, .smaller list} nth then} .then,
      { 
        .n n, .equal equal, .bigger bigger, .smaller_len smaller_len, 
        [.smaller_len, .equal len] PLUS smaller_equal_len
      }
      <
        {[.smaller_equal_len, .n] <GT,EQ> if, .equal .0 then} .then,
        {[.n, .smaller_equal_len] MINUS n, .bigger list} nth
      >
    >
    ,
    {.list sort inverse list, .n decr pos} get
  >
  ?X
;

qsort = 
  ?[X] 
  < empty?, 
    singleton?, 
    split_by_median
    [."<" qsort, ."=", .">" qsort] cats 
  >
;

cdr = SNOC.cdr;

split_by_median =
  {
    () list, 
    {() list, [len, 2] DIV .div n} nth pivot, 
    [] "<", 
    [] "=", 
    [] ">"
  } _split_by_pivot
;
_split_by_pivot = 
  ?{[X] list, X pivot, [X] "<", [X] "=", [X] ">"}
  <
    <
      {
        [.list .0, .pivot] EQ if, 
        {.list cdr list, .pivot pivot, ."<" "<", {.list.0 car, ."=" cdr} CONS "=", .">" ">"} then
      } .then,
      {
        [.list .0, .pivot] GT if, 
        {.list cdr list, .pivot pivot, ."<" "<", {.list.0 car, .">" cdr} CONS ">", ."=" "="} then
      } .then,
      {.list cdr list, .pivot pivot, ."=" "=", {.list.0 car, ."<" cdr} CONS "<", .">" ">"}
    > _split_by_pivot,
    
    {."<" inverse "<", ."=" inverse "=", .">" inverse ">"}
    
  >
  ;



-- loaded
()