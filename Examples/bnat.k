-- Standard binary encoding of natural numbers

$ bnat = < {} _, bnat 0, bnat 1 >;

_ = {{} _};
_1 = {() 1};
_0 = {() 0};

bnat_0  = _ $bnat;
bnat_1  = _ _1 $bnat;
bnat_2  = _ _0 _1 $bnat;
bnat_3  = _ _1 _1 $bnat;
bnat_4  = _ _0 _0 _1 $bnat;
bnat_5  = _ _1 _0 _1 $bnat;
bnat_6  = _ _0 _1 _1 $bnat;
bnat_7  = _ _1 _1 _1 $bnat;
bnat_8  = _ _0 _0 _0 _1 $bnat;
bnat_9  = _ _1 _0 _0 _1 $bnat;
bnat_10 = _ _0 _1 _0 _1 $bnat;

remove_leading_zeros = < .0 remove_leading_zeros, () >;

reverse = {() x, _ result} _reverse;

_reverse =
  ${bnat x, bnat result}
  <
    {.x._ if, .result then} .then,
    {.x.0 x, .result _0 result} _reverse,
    {.x.1 x, .result _1 result} _reverse
  >
;

append_0 = reverse _0 reverse; -- i.e., shift_left, double, or times2 

$carry = <{} 0, {} 1>;
c0 = {{} 0} $carry;
c1 = {{} 1} $carry;

$ pair = {bnat x, bnat y};

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
    -- else, i.e., if x < y then, (x mod y) = x 
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

$compare = <{} lt, {} eq, {} gt >;
lt = {{} lt};
eq = {{} eq};
gt = {{} gt};

compare = align _compare;
_compare = 
  ${bnat x, bnat y}
  <
    {.x._ if1, .y._ if2 } eq,
    {.x.0 x, .y.0 y} _compare,
    {.x.1 x, .y.1 y} _compare, 
    .x.0 lt,
    gt
  >
  $compare
;

zero? = remove_leading_zeros ._ bnat_0;
eq? = {compare .eq if, () then} .then;
gt? = {compare .gt if, () then} .then;
lt? = {compare .lt if, () then} .then;
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

half =
  reverse
  <
    {.0 reverse div, bnat_0 rem},
    {.1 reverse div, bnat_1 rem},
    {bnat_0 div, bnat_0 rem}
  >
;

pow =
  ${ bnat base, bnat exponent }
  <
    .exponent zero? bnat_1,
    {.base base, .exponent half half}
    {.base base, .half.rem extra, {.base base, .half.div exponent} pow {()x,()y} times pow}
    <
      {.extra zero? if, .pow then} .then,
      {.base x, .pow y} times
    >
  >
;

sqrt =
  <
    { () x, {bnat_1 min, () max} range } _sqrt
  >
;

_sqrt =
  { () input, {.range.max x, .range.min y} plus half .div middle }
  <
    { .input.range.min x, .middle y} eq? .x,
    { () aux, {.input.x x, .middle y} div .div middle }
    { 
      .aux.input.x x, 
      { .aux.middle x, .middle y } < gt?, {.x y, .y x} > {.y min, .x max} range
    } _sqrt
  >
;

--------------------

lcm 
