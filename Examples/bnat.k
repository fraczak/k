-- Standard binary encoding of natural numbers

$ bnat = < {} _, bnat 0, bnat 1 >;

_ = {{} _};
_1 = {() 1};
_0 = {() 0};

bnat_0 = _ $bnat;
bnat_1 = _ _1 $bnat;
bnat_2 = _ _0 _1 $bnat;
bnat_3 = _ _1 _1 $bnat;
bnat_4 = _ _0 _0 _1 $bnat;
bnat_5 = _ _1 _0 _1 $bnat;
bnat_6 = _ _0 _1 _1 $bnat;
bnat_7 = _ _1 _1 _1 $bnat;
bnat_8 = _ _0 _0 _0 _1 $bnat;
bnat_9 = _ _1 _0 _0 _1 $bnat;
bnat_10 = _ _0 _1 _0 _1 $bnat;

remove_leading_zeros =
  < .0 remove_leading_zeros, () >
;

reverse = {() x, bnat_0 result} _reverse;

_reverse =
  ${bnat x, bnat result}
  <
    {.x._ if, .result then} .then,
    {.x.0 x, .result _0 result} _reverse,
    {.x.1 x, .result _1 result} _reverse
  >
;

append_0 =
  -- i.e., shift_left, double, or times2 
  reverse _0 reverse
  -- <._ _0, .0 append_0 _0, .1 append_0 _1>
;

$carry = <{} 0, {} 1>;
c0 = {{} 0} $carry;
c1 = {{} 1} $carry;


plus = 
  ${bnat x, bnat y} 
  { 
    .x remove_leading_zeros reverse x, 
    .y remove_leading_zeros reverse y, 
    c0 c 
  } 
  _plus 
  reverse
;

_plus =
  -- least significant bit first addition with carry
  ${bnat x, bnat y, carry c}
  <
    {.x._ if1, .y._ if2, <.c.0 bnat_0, bnat_1> then} .then,
    {.x._ if1, .c.0 if2, .y                    then} .then,

    {.x     y, .y._ _ x, .c      c} _plus, --swap x with y, if y = 0
    {.x._ <.c.0 bnat_0, bnat_1> 
            x, .y     y, c0      c} _plus,

    {.x.0   x, .y.0   y, .c.0 c0 c} _plus _0,
    {.x.0   x, .y.0   y, .c.1 c0 c} _plus _1,

    {.x.0   x, .y.1   y, .c.0 c0 c} _plus _1,
    {.x.0   x, .y.1   y, .c.1 c1 c} _plus _0,
    
    {.x.1   x, .y.0   y, .c.0 c0 c} _plus _1,
    {.x.1   x, .y.0   y, .c.1 c1 c} _plus _0,
    
    {.x.1   x, .y.1   y, .c.0 c1 c} _plus _0,
    {.x.1   x, .y.1   y, .c.1 c1 c} _plus _1     
  >
;

minus =
  ${bnat x, bnat y}
  { 
    .x remove_leading_zeros reverse x,
    .y remove_leading_zeros reverse y,
    c0 c
  }
  _minus
  reverse 
  remove_leading_zeros
;

_minus =
  -- least significat bit first substraction with carry
  ${bnat x, bnat y, carry c}
  <
    {.x   x, .y._   y, .c.0   if} .x,
    {.x.1 x, .y._   y, .c.1   if} .x _0,
    {.x.0 x, .y._ _ y, .c.1 c1 c} _minus _1,
    {.x.0 x, .y.0   y, .c.0 c0 c} _minus _0,
    {.x.0 x, .y.0   y, .c.1 c1 c} _minus _1,  
    {.x.0 x, .y.1   y, .c.0 c1 c} _minus _1,
    {.x.0 x, .y.1   y, .c.1 c1 c} _minus _0,
    {.x.1 x, .y.0   y, .c.0 c0 c} _minus _1,
    {.x.1 x, .y.0   y, .c.1 c0 c} _minus _0,
    {.x.1 x, .y.1   y, .c.0 c0 c} _minus _0,
    {.x.1 x, .y.1   y, .c.1 c1 c} _minus _1
  >
;

times = 
  ${bnat x, bnat y} 
  { 
    bnat_0 result, 
    .x remove_leading_zeros reverse _x, 
    .y remove_leading_zeros y 
  } 
  _times
  reverse
;

_times =
  ${bnat result, bnat _x, bnat y}
  <
    { .y._ if, .result then } .then,
    { .result _0                           result, ._x _x, .y.0 y } _times,
    { { ._x x, .result _0 y, c0 c } _plus  result, ._x _x, .y.1 y } _times
  >
;

inc = {() x, bnat_1 y} plus;
dec = {() x, bnat_1 y} minus;

mod =
  ${bnat x, bnat y}
  < 
    -- if x >= y then (x mod y) = ((x-y mod 2y) mod y)
    { { minus x, .y append_0 y } mod x, .y y } mod,
    -- if x < y then (x mod y) = x 
    .x
  >
; 

align = 
  ${bnat x, bnat y}
  {
    .x remove_leading_zeros reverse _x, 
    .y remove_leading_zeros reverse _y, 
    bnat_0 x, 
    bnat_0 y
  }
  _align 
;

_align = 
  ${bnat _x, bnat _y, bnat x, bnat y}
  <
    {._x._ if1, ._y._ if2, {.x x, .y y} then} .then,
    {._x <.0, ._ _> _x, ._y <.0, ._ _> _y, .x _0 x, .y _0 y} _align,
    {._x.1          _x, ._y <.0, ._ _> _y, .x _1 x, .y _0 y} _align,
    {._x <.0, ._ _> _x, ._y.1          _y, .x _0 x, .y _1 y} _align,
    {._x.1          _x, ._y.1          _y, .x _1 x, .y _1 y} _align
  >
;

$compare = <{} "<", {} "=", {} ">" >;
compare = align _compare;
_compare = 
  ${bnat x, bnat y}
  <
    {.x._ if1, .y._ if2, {{} "="} then} .then,
    {.x.0 x, .y.0 y} _compare,
    {.x.1 x, .y.1 y} _compare, 
    .x.0 {{} "<"},
    {{} ">"}
  >
  $compare
;

zero? = remove_leading_zeros ._ bnat_0;
eq? = {compare ."=" if, () then} .then;
gt? = {compare .">" if, () then} .then;
lt? = {compare ."<" if, () then} .then;
ge? = < gt?, eq? >;
le? = < lt?, eq? >;

// gratest common divisor
gcd = <gt?, {.y x,.x y}> _gcd;

_gcd = <
  { .y zero? if, .x then } .then,
  { .y x, mod y } _gcd
>;

log2_floor =
  ${bnat x, bnat step} 
-- finds the largest k, such that 'step * 2^k <= x',
-- returns k+1, i.e., 0 if x < step, and k+1 otherwise.
  {.x x, .step step, bnat_0 log} _log2_floor;

_log2_floor =
  <
    {{.step x, .x y} gt? if, .log then} .then,
    {.x x, {.step x, bnat_0 y} gt? .x append_0 step, .log inc log} _log2_floor
  >
;

append_n_times_0 = 
  ${bnat x, bnat n}
  <
    {.n zero? if, .x then} .then,
    {.x append_0 x, .n dec n} append_n_times_0
  >
;

div = 
  ${bnat x, bnat y}
  {.x x, .y step, bnat_0 res} _div
;

_div =
  {
    .x x,
    .step step,
    .res res,
    {.x x, .step step} log2_floor log
  }
  < 
    { .log zero? if, {.res div, .x rem} then } .then,
    { 
      -- {2 x, .log [(),1] MINUS count} rep TIMES factor,
      { bnat_1 x, .log dec n} append_n_times_0 factor,
      () i
    }
    {
      {.i.x x, {.i.step x, .factor y} times y} minus x, 
      .i.step step, 
      {.i.res x, .factor y} plus res
    } _div
  >
;

lcm = 
  ${bnat x, bnat y}
  {times x, gcd y}
  div .div 
;

--- vector helpers

car = SNOC .car;
cdr = SNOC .cdr;
empty? =?[X] <{.0 nope}, {() yes}> .yes;
inverse = {?[X] list, [] result} _inverse;
_inverse =
  ?{[X] list, [X] result}  
  < 
    {.list empty? if, .result then} .then,
    {.list cdr list, {.list car car, .result cdr} CONS result} _inverse
  >
;

-- Conversion to and from binary

to2 = $bnat < ._ "0", {() x, [] acc} _to2 >;

_to2 = 
  ${bnat x, [string] acc}
  <
    { .x._ if, .acc then } .then inverse CONCAT,
    { .x.0 x, { "0" car, .acc cdr} CONS acc } _to2,
    { .x.1 x, { "1" car, .acc cdr} CONS acc } _to2
  >
;

from2 = $string toVEC _from2;
_from2 = 
  < 
    {car .0 if, cdr _from2 _0 then} .then, 
    {car .1 if, cdr _from2 _1 then} .then, 
    _
  >
;

--- Conversion to and from decimal

to10 = {$bnat b, [] v} _to10;
_to10 =
  <
    { .b._ if, <.v empty? ["0"], .v> then } .then CONCAT,
    { .b.0 b, .v double v} _to10,
    { .b.1 b, .v double_plus_1 v} _to10
  >
;

toDigit =
  $bnat 
  <
    ._ "0",
    .1._ "1",
    .1.0._ "2",
    .1.1._ "3",
    .1.0.0._ "4",
    .1.0.1._ "5",
    .1.1.0._ "6",
    .1.1.1._ "7",
    .1.0.0.0._ "8",
    .1.0.0.1._ "9"
  >
;

fromDigit =
  $string
  <
    .0 bnat_0,
    .1 bnat_1,
    .2 bnat_2,
    .3 bnat_3,
    .4 bnat_4,
    .5 bnat_5,
    .6 bnat_6,
    .7 bnat_7,
    .8 bnat_8,
    .9 bnat_9
  >
;

from10 = $string {toVEC v, bnat_0 b} _from10;
_from10 = 
  < 
    {.v cdr v, {{.b x, bnat_10 y} times x, .v.0 fromDigit y} plus b} _from10, 
    .b
  >
;

mod10 = {.x from10 x, .y from10 y} mod to10;
plus10 = {.x from10 x, .y from10 y} plus to10;
minus10 = {.x from10 x, .y from10 y} minus to10;
times10 = {.x from10 x, .y from10 y} times to10;
div10 = {.x from10 x, .y from10 y} div {.div to10 div, .rem to10 rem};

double = 
  $[ string ]
  { inverse input, c0 c, [] result }
  _double
; 
double_plus_1 = 
  $[ string ]
  { inverse input, c1 c, [] result }
  _double
; 
_double = 
  ${ [ string ] input, carry c, [ string ] result }
  < 
    {.input car .0 if, 
      { .input cdr input, c0 c, {<.c.0 "0", "1"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .1 if, 
      { .input cdr input, c0 c, {<.c.0 "2", "3"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .2 if, 
      { .input cdr input, c0 c, {<.c.0 "4", "5"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .3 if, 
      { .input cdr input, c0 c, {<.c.0 "6", "7"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .4 if, 
      { .input cdr input, c0 c, {<.c.0 "8", "9"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .5 if, 
      { .input cdr input, c1 c, {<.c.0 "0", "1"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .6 if, 
      { .input cdr input, c1 c, {<.c.0 "2", "3"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .7 if, 
      { .input cdr input, c1 c, {<.c.0 "4", "5"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .8 if, 
      { .input cdr input, c1 c, {<.c.0 "6", "7"> car, .result cdr} CONS result} then 
    } .then _double,
    {.input car .9 if, 
      { .input cdr input, c1 c, {<.c.0 "8", "9"> car, .result cdr} CONS result} then 
    } .then _double,
    {.c.0 if, .result then} .then,
    {"1" car, .result cdr} CONS
  >  
;

