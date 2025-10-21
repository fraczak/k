-- Examples for defining arithmetic functions natively
$ yes_no = < {} yes, {} no >;
swap_yes_no = < {.yes no}, {.no yes} > $yes_no;
yes = {{} yes} $yes_no;
no = yes swap_yes_no;

list? = ?< {} nil, {X car, Y cdr} cons > = Y;
nil = {{} nil} list?;
singleton = {{() car, nil cdr} cons} list?;
cons = {{.car car, .cdr cdr} cons} list?;
nil? = list? .nil nil;
car = list? .cons .car;
cdr = list? .cons .cdr;

$ bits = < {} _, bits 0, bits 1 >;

0b = {{} _};
1_ = {() 1};
0_ = {() 0};

0 = 0b 0_;
1 = 0b 1_;
2 = 0 1_;

empty = $bits < ._ yes, no >;
empty? = {empty .yes if, () then} .then;

concat = ${bits x, bits y} {.x inv x, .y y} concat_; 
concat_ = ${bits x, bits y} 
  < 
    {.x .0 x, .y 0_ y} concat_, 
    {.x .1 x, .y 1_ y} concat_, 
    .y 
  >;
inv = {()x, 0b r} _inv; 
_inv = < {.x .0 x, .r 0_ r} _inv, {.x .1 x, .r 1_ r} _inv, .r >;

inOrder = ${bits x, bits y} {.x inv x, .y inv y, yes inOrder} inOrder_;
inOrder_ = ${bits x, bits y, yes_no inOrder} 
  < 
    {.x .0 x, .y .0 y, .inOrder inOrder} inOrder_, 
    {.x .1 x, .y .1 y, .inOrder inOrder} inOrder_,
    {.x .0 x, .y .1 y, .inOrder inOrder} inOrder_, 
    {.x .1 y, .y .0 x, .inOrder swap_yes_no inOrder} inOrder_, 
    {.x <.0,.1> if, .inOrder swap_yes_no then} .then, 
    .inOrder
  >;

GT = {inOrder .no if, () then} . then;

EQ = GT {.x y, .y x} GT;

toBitList = {inv x, nil r} _toBitList; 
_toBitList = < 
  {.x empty? if, .r then }.then, 
  {.x .0 x, {0 car, .r cdr} cons r} _toBitList, 
  {.x .1 x, {1 car, .r cdr} cons r} _toBitList 
>;
fromBitList =
< 
  cdr <
    {car .0 if, cdr fromBitList 0_ then} .then, 
    {car .1 if, cdr fromBitList 1_ then} .then
  >, 
  0b
>;

--------------------------------------
$ int = < bits '+', bits '-' >;

remove_leading_zeros = <
  .0 remove_leading_zeros, 
  ()
>;
nat = remove_leading_zeros <empty? 0, ()>;
int = $bits { nat '+'} $int;
abs = $int <.'+',.'-'>;

pos? = $int {dec .'+' if, () then} .then;
neg? = $int {.'-' if, () then} .then; 
zero_int? = $int {.'+' .0 empty? if, () then} .then;
minus_one? = $int {.'-' .1 empty? if, () then} .then;

inc = $int <
  .'+' {inv x, 0b y} _inc {nat '+'},
  minus_one? 0 int,
  .'-' {inv x, 0b y} _dec {nat '-'}
>;

_inc = <
    {.x .0 x, .y 1_ y} concat_, 
    {.x .1 x, .y 0_ y} _inc,
    .y 1_
>; 

dec = $int <
  zero_int? {1 '-'},
  .'+' {inv x, 0b y} _dec {nat '+'},
  .'-' {inv x, 0b y} _inc {nat '-'}
>;

_dec = <
    {.x .1 x, .y 0_ y} concat_, 
    {.x .0 x, .y 1_ y} _dec
>;

$carry = <{} 0, {} 1>;
c0 = {{} 0} $carry;
c1 = {{} 1} $carry;

plus = ${int x, int y}
< 
  {.x.'+' inv x, .y.'+' inv y, c0 c } _plus inv {nat '+'},
  {.x.'-' inv x, .y.'-' inv y, c0 c } _plus inv {nat '-'},
  {.y.'-' x, .x.'+' y} GT {.x inv x, .y inv y, c0 c} _minus inv {nat '-'},
  {.x.'+' inv x, .y.'-' inv y, c0 c} _minus inv {nat '+'},
  {.x.'-' x, .y.'+' y} GT {.x inv x, .y inv y, c0 c} _minus inv {nat '-'},
  {.y.'+' inv x, .x.'-' inv y, c0 c} _minus inv {nat '+'}
> 
$int;

swap_sign = <
  zero_int?,
  {.'+' '-'},
  {.'-' '+'}  
>;

minus = ${int x, int y}
  {.x x, .y swap_sign y} plus;

_plus =
  -- least significant bit first addition with carry
  ${bits x, bits y, carry c}
  <
    {.x empty? if, .y empty? and, <.c.0 0, 1> then} .then,
    {.x empty? if, .c.0 and, .y then} .then,

    {.x y, .y empty? x, .c c} _plus,
    {<.c.0 0, 1> x, 
              .y y, .x empty? c0 c} _plus,

    {.x .0 x, .y .0 y, .c.0 c0 c} _plus 0_,
    {.x .0 x, .y .0 y, .c.1 c0 c} _plus 1_,

    {.x .0 x, .y .1 y, .c.0 c0 c} _plus 1_,
    {.x .0 x, .y .1 y, .c.1 c1 c} _plus 0_,

    {.x .1 x, .y .0 y, .c.0 c0 c} _plus 1_,
    {.x .1 x, .y .0 y, .c.1 c1 c} _plus 0_,

    {.x .1 x, .y .1 y, .c.0 c1 c} _plus 0_,
    {.x .1 x, .y .1 y, .c.1 c1 c} _plus 1_
  >
;

_minus =
  -- least significat bit first substraction with carry
  ${bits x, bits y, carry c}
  <
    {.x then, .y empty? if, .c.0 and} .then,
    {.x.1 then, .y empty? if, .c.1 and} .then 0_,
    {.x.0 x, .y empty? y, .c.1 c1 c} _minus 1_,
    {.x.0 x, .y.0   y, .c.0 c0 c} _minus 0_,
    {.x.0 x, .y.0   y, .c.1 c1 c} _minus 1_,  
    {.x.0 x, .y.1   y, .c.0 c1 c} _minus 1_,
    {.x.0 x, .y.1   y, .c.1 c1 c} _minus 0_,
    {.x.1 x, .y.0   y, .c.0 c0 c} _minus 1_,
    {.x.1 x, .y.0   y, .c.1 c0 c} _minus 0_,
    {.x.1 x, .y.1   y, .c.0 c0 c} _minus 0_,
    {.x.1 x, .y.1   y, .c.1 c1 c} _minus 1_
  >
;

$ sign = < {} '+' , {} '-' >;
sign_plus = {{} '+'} $sign;
sign_minus = {{} '-'} $sign;
get_sign = $int <.'+' sign_plus, .'-' sign_minus>;

times = ${int x, int y}
  {
    <
      {.x.'+' if, .y .'+' and} sign_plus, 
      {.x.'-' if, .y .'-' and} sign_plus, 
      sign_minus
    > sign,
    {
      0 result,
      .x abs inv _x,
      .y abs y
    } _times result
  }
  <
    {.sign.'+' if, .result inv int then} .then,
    {.sign.'-' if, .result inv int swap_sign then} .then 
  >
;

_times =
  ${bits result, bits _x, bits y}
  <
    { .y empty? if, .result then } .then,
    { 
      .result 0_ result, 
      ._x _x, 
      .y .0 y
    } _times,
    { 
      {._x x, .result 0_ y, c0 c } _plus result, 
      ._x _x, 
      .y .1 y 
    } _times
  >
;


mod =
  ${bits x, bits y}
  < 
    -- if y > x then (x mod y) = x 
    {.y x, .x y} GT .y,
    -- else, i.e.
    -- if x >= y then (x mod y) = ((x-y mod 2y) mod y)
    { 
      {  
        {.x int x, .y int y} minus ."+" x, 
        .y inv 0_ inv y
      } mod x, 
      .y y 
    } mod
  >
; 


// gratest common divisor
gcd = ${bits x, bits y}
  <
    {.y x, .x y} GT, 
    ()
  > _gcd
;

_gcd = <
  { .y .0 if, .x then } .then,
  { .y x, mod y } _gcd
>;



// div

log2_floor =
  ${bits x, bits step} 
-- finds the largest k, such that 'step * 2^k <= x',
-- returns k1_, i.e., 0 if x < step, and k1_ otherwise.
  {.x x, .step step, 0 log} log2_floor_;

log2_floor_ = <
  {{.step x,.x y} GT if, .log then} .then,
  {.x x, {.step x,0 y} GT {.x x,2 y} {.x int x, .y int y} times abs step, .log int inc abs log} log2_floor_
>;


x_times_2_to_k =
  ${bits x, bits k}
  {.x inv _x, .k int k} _x_times_2_to_the_power_of_k inv
;

_x_times_2_to_the_power_of_k = <
  {.k zero_int? if, ._x then} .then,
  {._x 0_ _x, .k dec k} _x_times_2_to_the_power_of_k
>
;
 
div = 
  ${int x, int y} 
  // remember sign
  {
    <
      { .x.'+' if, .y get_sign then } .then,
      { .x.'-' if, .y  swap_sign get_sign then } .then
    > sign,
    {.x abs x, .y abs step, 0 int res} _div res_wo_sign
  }
  < 
    {.sign."+" if, {.res_wo_sign.div div, .res_wo_sign.rem rem} then} .then,
    { .res_wo_sign.div swap_sign div, .res_wo_sign.rem rem }
  > 
  ;

_div =
  {
    .x x,
    .step step,
    .res res,
    {.x x, .step step} log2_floor log
  }
  < 
    { .log int zero_int? if, {.res div, .x rem} then } .then,
    { 
      {1 x, .log int dec abs k} x_times_2_to_k factor,
      () i
    }
    {
      {.i.x int x, {.i.step int x, .factor int y} times y} minus abs x, 
      .i.step step, 
      {.i.res x, .factor int y} plus res
    } _div
  >;


lcm = 
  ${bits x, bits y}
  {{.x int x, .y int y} times x, gcd int y} div .div abs
;

 factorial = <
  zero_int? 1 int,
  ."+" int {dec factorial x, () y} times
>;

fib_ =
  <
    { .n int dec ."+" n,
      ."fib(n),fib(n.1)" {plus x, .x y} "fib(n),fib(n.1)"
    } fib_,
    ."fib(n),fib(n.1)"
  >
;

fib = {$bits n, {1 int x, 0 int y} "fib(n),fib(n.1)"} fib_ .x;


--------------------
$ rat = { int n, int d };

normalize_rat =
  $rat 
  < 
    { .d."-" if, 
      {
        .n swap_sign n, 
        .d swap_sign d
      } then
     } .then,
    ()
  >
  {() x, {.n abs x,.d abs y} gcd int y}
  {
    {.x.n x,.y y} div .div n, 
    {.x.d x,.y y} div .div d
  }
  $rat
;


plus_rat = 
  ${rat x, rat y}
  { 
    .x x, 
    .y y,
    {.x.d abs x,.y.d abs y} lcm int lcm
  }
  { 
    {
      {.x.n x, {.lcm x, .x.d y} div .div y} times x,
      {.y.n x, {.lcm x, .y.d y} div .div y} times y
     } plus n, 
    .lcm d
  }
  normalize_rat
;


times_rat = 
  ${rat x, rat y}
  { 
    {.x.n x,.y.n y} times n, 
    {.x.d x,.y.d y} times d
  } 
  normalize_rat;
 

minus_rat = 
  ${rat x, rat y}
  {
    .x x, 
    .y {.n swap_sign n, .d d} y
  } 
  plus_rat;

inverse_rat = 
  $rat
  { .d n, .n d }
  normalize_rat
;

div_rat = 
  ${rat x, rat y}
  { .x x, .y inverse_rat y} times_rat
;


--------------------

int_rat = 
  $rat 
  { .n n, .d d, {.n x,.d y} div div }
  { .div.div int, {.div.rem int n, .d d} rat}
  ${int int, rat rat}
;

/* 
ratToString = 
-- $rat
[
    .n toJSON, 
    "/", 
    .d toJSON, 
    " = ",
    normalize_rat
    <
      [.d,.n] GT [.1 toJSON ,"/", .0 toJSON] CONCAT,
      {.n 0,[.d,1] EQ 1} [.0 toJSON] CONCAT,
      int_rat [.int toJSON,"+",.rat.n toJSON,"/",.rat.d toJSON] CONCAT
    >
  ] CONCAT
-- $@string
;

_rat! = $rat {
  () carryOn, 
  ratToString _log! drop
 } .carryOn;



*/

()