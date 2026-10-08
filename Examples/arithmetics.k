-- Examples for defining arithmetic functions natively
$ yes_no = < {} yes, {} no >;
swap_yes_no = < /yes |no, /no |yes > $yes_no;
yes = {}|yes $yes_no;
no = yes swap_yes_no;

$ bits = < {} _, bits 0, bits 1 >;

0b = {} | _;
-- |1 = | 1;
-- |0  = | 0;

0 = 0b |0;
succ = {inv x, 0b y} _inc;
1 = 0 succ;
2 = 1 succ;
3 = 2 succ;
4 = 3 succ;
5 = 4 succ;
6 = 5 succ;
7 = 6 succ;
8 = 7 succ;
9 = 8 succ;
10 = 9 succ;
11 = 10 succ;
12 = 11 succ;

empty = $bits < /_ yes, no >;
empty? = {empty /yes if, () then} .then;

concat = ${bits x, bits y} {.x inv x, .y y} concat_; 
concat_ = ${bits x, bits y} 
  < 
    {.x empty? if, .y then} .then,
    < 
      {.x /0 x, .y |0 y}, 
      {.x /1 x, .y |1 y}
    > concat_ 
  >;
inv = {()x, 0b r} _inv; 
_inv = ${bits x, bits r} 
  < 
    {.x empty? if, .r then} .then,
    < 
      {.x /0 x, .r |0 r}, 
      {.x /1 x, .r |1 r}
   > _inv
  >;

inOrder = ${bits x, bits y} {.x inv x, .y inv y, yes inOrder} inOrder_;
inOrder_ = ${bits x, bits y, yes_no inOrder} 
  < 
    {.x </0,/1> if1, .y /_ if2, .inOrder swap_yes_no then} .then,
    {.x /_ if, .inOrder then} .then,
    < 
      {.x /0 x, .y /0 y, .inOrder inOrder}, 
      {.x /1 x, .y /1 y, .inOrder inOrder},
      {.x /0 x, .y /1 y, .inOrder inOrder}, 
      {.x /1 y, .y /0 x, .inOrder swap_yes_no inOrder}
    > inOrder_
  >;

GT = {inOrder /no if, () then} . then;

EQ = {inOrder /yes if, {.x y, .y x} inOrder /yes and, () then} .then;

--------------------------------------
$ int = < bits '+', bits '-' >;

remove_leading_zeros = <
  /0 remove_leading_zeros, 
  ()
>;
nat = remove_leading_zeros <empty? 0, ()>;
int = nat | '+' $int;
abs = $int </'+',/'-'>;

pos? = $int {/'+' remove_leading_zeros /1 if, () then} .then;
neg? = $int {/'-' if, () then} .then; 
zero_int? = $int {/'+' /0 empty? if, () then} .then;
minus_one? = $int {/'-' /1 empty? if, () then} .then;

inc = $int <
  /'+' {inv x, 0b y} _inc nat |'+',
  minus_one? 0 int,
  /'-' {inv x, 0b y} _dec nat |'-'
> $int;

_inc = ${bits x, bits y} <
    {.x empty? if, .y |1 then} .then,
    {.x /0 x, .y |1 y} concat_, 
    {.x /1 x, .y |0  y} _inc
>; 

dec = $int <
  zero_int? 1 |'-',
  /'+' {inv x, 0b y} _dec nat |'+',
  /'-' {inv x, 0b y} _inc nat |'-'
> $int;

_dec = ${bits x, bits y} <
    {.x /1 x, .y |0  y} concat_, 
    {.x /0 x, .y |1 y} _dec
>;

$ carry = <{} 0, {} 1>;
c0 = {}|0 $carry;
c1 = {}|1 $carry;

plus = ${int x, int y}
< 
  {.x/'+' inv x, .y/'+' inv y, c0 c } _plus inv nat | '+',
  {.x/'-' inv x, .y/'-' inv y, c0 c } _plus inv nat | '-',
  {.y/'-' x, .x/'+' y} GT {.x inv x, .y inv y, c0 c} _minus inv nat | '-',
  {.x/'+' inv x, .y/'-' inv y, c0 c} _minus inv nat |'+',
  {.x/'-' x, .y/'+' y} GT {.x inv x, .y inv y, c0 c} _minus inv nat | '-',
  {.y/'+' inv x, .x/'-' inv y, c0 c} _minus inv nat | '+'
> 
$int;

swap_sign = <
  zero_int?,
  /'+' | '-',
  /'-' | '+'
>;

minus = ${int x, int y}
  {.x x, .y swap_sign y} plus;

_plus = {.x x, .y y, .c c, 0b r} _plus_;

_plus_ =
  -- least significant bit first addition with carry
  ${bits x, bits y, carry c, bits r}
  <
    {.x empty? if, .y empty? and, .c/0 c, .r inv then} .then,
    {.x empty? if, .y empty? and, {.r x, 1 r} _inv then} .then,
    {.x empty? if, .c/0 and, {.r x, .y r} _inv then} .then,

    <
      {.x y, .y empty? x, .c c, .r r},
      {<.c/0 0, 1> x, .y y, .x empty? c0 c, .r r},

      {.x /0 x, .y /0 y, .c/0 c0 c, .r |0 r},
      {.x /0 x, .y /0 y, .c/1 c0 c, .r |1 r},

      {.x /0 x, .y /1 y, .c/0 c0 c, .r |1 r},
      {.x /0 x, .y /1 y, .c/1 c1 c, .r |0 r},
      {.x /1 x, .y /0 y, .c/0 c0 c, .r |1 r},
      {.x /1 x, .y /0 y, .c/1 c1 c, .r |0 r},

      {.x /1 x, .y /1 y, .c/0 c1 c, .r |0 r},
      {.x /1 x, .y /1 y, .c/1 c1 c, .r |1 r}
    > _plus_
  >
;

_minus = {.x x, .y y, .c c, 0b r} _minus_;

_minus_ =
  -- least significant bit first substraction with carry
  ${bits x, bits y, carry c, bits r}
  <
    {.y empty? if, .c/0 and, {.r x, .x r} _inv then} .then,
    <
      {.x/0 x, .y empty? y, .c/1 c1 c, .r |1 r},
      {.x/1 x, .y empty? y, .c/1 c0 c, .r |0 r},

      {.x/0 x, .y/0   y, .c/0 c0 c, .r |0 r},
      {.x/0 x, .y/0   y, .c/1 c1 c, .r |1 r},  
      {.x/0 x, .y/1   y, .c/0 c1 c, .r |1 r},
      {.x/0 x, .y/1   y, .c/1 c1 c, .r |0 r},
      {.x/1 x, .y/0   y, .c/0 c0 c, .r |1 r},
      {.x/1 x, .y/0   y, .c/1 c0 c, .r |0 r},
      {.x/1 x, .y/1   y, .c/0 c0 c, .r |0 r},
      {.x/1 x, .y/1   y, .c/1 c1 c, .r |1 r}
    > _minus_
  >
;

$ sign = < {} '+' , {} '-' >;
sign_plus = {}|'+' $sign;
sign_minus = {}|'-' $sign;
get_sign = $int </'+' sign_plus, /'-' sign_minus>;

times = ${int x, int y}
  {
    <
      {.x/'+' if, .y /'+' and} sign_plus, 
      {.x/'-' if, .y /'-' and} sign_plus, 
      sign_minus
    > sign,
    {
      0b result,
      .x abs inv _x,
      .y abs y
    } _times result
  }
  <
    {.sign/'+' if, .result inv int then} .then,
    {.sign/'-' if, .result inv int swap_sign then} .then 
  >
;

_times =
  ${bits result, bits _x, bits y}
  <
    { .y empty? if, .result then } .then,
    <
      { 
        .result |0  result, 
        ._x _x, 
        .y /0 y
      },
      { 
        {._x x, .result |0  y, c0 c } _plus result, 
        ._x _x, 
        .y /1 y 
      }
    > _times
  >
;





// ----------------------------------------------------------------------
// Integer Division: Adaptive Hybrid Algorithm
//
// Combines two complementary strategies based on the bit-length
// comparison between dividend x and divisor y (|x| vs |y|):
//
// 1. Down-Shift Division (|x| < 2|y|, y is large relative to x):
//    - Scales y up to y_max = y * 2^k to match length(x) via 'y inv'
//      and prepending k zeros (|0).
//    - In each step: trial subtraction x = x - y_scaled, then down-shifts
//      y_scaled by 1 bit in O(1) by popping the outer zero (/_0).
//    - Runs in exactly (|x| - |y| + 1) iterations. When y ~= x, this
//      terminates in 1-2 steps rather than looping through all bits of x.
//
// 2. Restoring Division (|x| >= 2|y|, y is small relative to x):
//    - Consumes bits of x from MSB to LSB into remainder accumulator r.
//    - Remainder r stays small (r <= 2y), so trial subtractions operate
//      on tiny numbers of length |y| rather than full-length |x|.
//
// The crossover condition |x| < 2|y| is evaluated structurally in
// O(min(|y|, |x|/2)) by consuming 2 bits of x for every 1 bit of y.
// ----------------------------------------------------------------------

// Helpers for Restoring Division (shift-and-subtract)
shift_in_0 = inv |0 inv nat;
shift_in_1 = inv |1 inv nat;
sub_bits = ${bits x, bits y} {.x inv x, .y inv y, c0 c} _minus inv nat;

_div_restoring =
  ${bits x, bits y, bits r, bits q}
  <
    {.x empty? if, {.q inv int div, .r rem} then} .then,
    <
      {.x /0 x, .r shift_in_0 r, .y y, .q q},
      {.x /1 x, .r shift_in_1 r, .y y, .q q}
    >
    {
      .x x,
      .y y,
      .q q,
      .r r,
      {.y x, .r y} inOrder test
    }
    <
      {.test /yes if, {.x x, .y y, .q |1 q, {.r x, .y y} sub_bits r} then} .then,
      {.test /no  if, {.x x, .y y, .q |0 q, .r r} then} .then
    >
    _div_restoring
  >;

// Helpers for Down-Shift Division (align and shift divisor down)
// Phase 1: pad _y with |0 to match length of x, counting shift steps
_pad_down = ${bits x, bits _y, bits steps}
  <
    {.x empty? if, {._y _y, .steps steps} then} .then,
    {
      .x </0, /1> x,
      ._y |0 _y,
      .steps |0 steps
    } _pad_down
  >;

_align_down = ${bits x, bits y, bits _y}
  <
    // Both x and y have bits remaining: advance both
    {
      .x </0, /1> x,
      .y </0, /1> y,
      ._y _y
    } _align_down,

    // y is empty while x remains: pad _y with shift zeros
    {
      .y empty? if,
      {.x x, ._y _y, 0b steps} _pad_down then
    } .then,

    // Both x and y are empty: lengths equal (0 shift steps)
    {
      .x empty? if,
      .y empty? and,
      {._y _y, 0b steps} then
    } .then
  >;

// Phase 2: down-shift trial subtraction
_div_down = ${bits x, bits _y, bits steps, bits q}
  {
    .x x,
    ._y _y,
    .steps steps,
    .q q,
    ._y inv nat y_scaled
  }
  {
    .x x,
    ._y _y,
    .steps steps,
    .q q,
    .y_scaled y_scaled,
    {.y_scaled x, .x y} inOrder test
  }
  <
    // If x >= y_scaled, subtract and emit quotient bit 1
    {
      .test /yes if,
      {
        {.x int x, .y_scaled int y} minus /+ x,
        .q |1 q,
        ._y _y,
        .steps steps
      } then
    } .then,
    // If x < y_scaled, keep x and emit quotient bit 0
    {
      .test /no if,
      {.x x, .q |0 q, ._y _y, .steps steps} then
    } .then
  >
  <
    // If no more shift steps remaining, division is complete
    {
      .steps empty? if,
      {.q inv int div, .x rem} then
    } .then,
    // Otherwise down-shift: remove the last 0 from _y and steps
    {
      .x x,
      ._y /0 _y,
      .steps /0 steps,
      .q q
    } _div_down
  >;

$ choose_div = < {} down_shift, {} restore >;

// Evaluates whether |x| < 2|y| by advancing 2 bits of x per 1 bit of y
_check_2y = ${bits x, bits y}
  <
    // x is empty -> |x| < 2|y| (choose down_shift)
    {.x empty? if, {} | down_shift $choose_div then} .then,
    // y is empty while x remains -> |x| >= 2|y| (choose restore)
    {.y empty? if, {} | restore $choose_div then} .then,
    // x has only 1 bit left while y remains -> |x| < 2|y|
    {.x </0, /1> empty? if, {} | down_shift $choose_div then} .then,
    // Advance 2 bits from x and 1 bit from y
    {
      .x </0, /1> </0, /1> x,
      .y </0, /1> y
    } _check_2y
  >;

// Public division interface
div = ${int x, int y}
  {
    <
      { .x/'+' if, .y get_sign then } .then,
      { .x/'-' if, .y swap_sign get_sign then } .then
    > sign,
    .x abs remove_leading_zeros x_norm,
    .y abs remove_leading_zeros y_norm
  }
  <
    // Case 1: x == 0 -> quotient 0, remainder 0
    {
      .x_norm empty? if,
      { 0 int div, 0 rem } then
    } .then,
    // Case 2: |x| < |y| -> x < y, quotient 0, remainder x
    {
      {.y_norm x, .x_norm y} GT if,
      { 0 int div, .x_norm rem } then
    } .then,
    // Case 3: general division via adaptive hybrid choice
    {
      .sign sign,
      {
        .x_norm x,
        .y_norm y,
        {.x_norm x, .y_norm y} _check_2y choice
      }
      <
        // If |x| < 2|y|, use down-shift division
        {
          .choice /down_shift if,
          {
            .x x,
            {.x x, .y y, .y inv _y} _align_down aligned
          }
          {
            .x x,
            .aligned._y _y,
            .aligned.steps steps,
            0b q
          } _div_down then
        } .then,
        // If |x| >= 2|y|, use restoring long division
        {
          .choice /restore if,
          {.x x, .y y, 0 r, 0b q} _div_restoring then
        } .then
      > res
    }
    <
      {.sign/'+' if, {.res.div div, .res.rem rem} then} .then,
      { .res.div swap_sign div, .res.rem rem }
    >
  >;


// ----------------------------------------------------------------------
// Number Theory: Modulo, Greatest Common Divisor, Least Common Multiple
// ----------------------------------------------------------------------

// Modulo: remainder of x divided by y in $bits, delegated to div
mod = ${bits x, bits y}
  {{.x int x, .y int y} div .rem rem} .rem;

// Greatest common divisor (Euclidean algorithm)
gcd = ${bits x, bits y}
  <
    {.y x, .x y} GT, 
    ()
  > _gcd
;

_gcd = <
  { .y remove_leading_zeros empty? if, .x nat then } .then,
  { .y x, mod y } _gcd
>;

// Least common multiple: (x / gcd(x, y)) * y
lcm = 
  ${bits x, bits y}
  {{.x int x, gcd int y} div .div x, .y int y} times abs
;

factorial = {()n, 1 int acc} factorial_;
factorial_ =  <
  {.n zero_int? if, .acc then} .then,
  {.n pos? dec n, {.n x, .acc y} times acc} factorial_
>;

fib_ =
  <
    {.n int zero_int? if, ."fib(n),fib(n.1)" then} .then,
    { .n int dec /"+" n,
      ."fib(n),fib(n.1)" {plus x, .x y} "fib(n),fib(n.1)"
    } fib_
  >
;

fib = {$bits n, {1 int x, 0 int y} "fib(n),fib(n.1)"} fib_ .x;


--------------------
$ rat = { int n, int d };

rat = ${bits n, bits d} {.n int n, .d int d } normalize_rat;

normalize_rat =
  $rat 
  < 
    { .d/"-" if, 
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
  ratToString drop
 } .carryOn;



*/

()