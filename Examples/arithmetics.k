-- Examples for defining arithmetic functions natively
swap_yes_no = < /yes |no, /no |yes >;
yes = {}|yes;
no = yes swap_yes_no;

bits = ?< {} _, bits 0, bits 1 > = bits;

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

empty = < /_ yes, no >;
empty? = {empty /yes if, () then} .then;

concat = {.x inv x, .y y} concat_; 
concat_ = ?{ <X 0, X 1, {} _>=X x, ... }
  < 
    {.x empty? if, .y then} .then,
    < 
      {.x /0 x, .y |0 y}, 
      {.x /1 x, .y |1 y}
    > concat_ 
  >;
inv = {()x, 0b r} _inv; 
_inv = ?{ <X 0, X 1, {} _>=X x, ... }
  < 
    {.x empty? if, .r then} .then,
    < 
      {.x /0 x, .r |0 r}, 
      {.x /1 x, .r |1 r}
   > _inv
  >;

inOrder = {.x inv x, .y inv y, yes inOrder} inOrder_;
inOrder_ = ?{ <X 0, X 1, {} _>=X x, ... }
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
int = ?< <bits 0, bits 1, {} _>=bits "+", bits "-" >;

remove_leading_zeros = <
  /0 remove_leading_zeros, 
  ()
>;
nat = remove_leading_zeros <empty? 0, ()>;
int = nat | '+';
abs = </'+',/'-'>;

pos? = {/'+' remove_leading_zeros /1 if, () then} .then;
neg? = {/'-' if, () then} .then; 
zero_int? = {/'+' /0 empty? if, () then} .then;
minus_one? = {/'-' /1 empty? if, () then} .then;

inc = <
  /'+' {inv x, 0b y} _inc nat |'+',
  minus_one? 0 int,
  /'-' {inv x, 0b y} _dec nat |'-'
>;

_inc = ?{ <X 0, X 1, {} _>=X x, ... } <
    {.x empty? if, .y |1 then} .then,
    {.x /0 x, .y |1 y} concat_, 
    {.x /1 x, .y |0  y} _inc
>; 

dec = <
  zero_int? 1 |'-',
  /'+' {inv x, 0b y} _dec nat |'+',
  /'-' {inv x, 0b y} _inc nat |'-'
>;

_dec = ?{ <X 0, X 1, {} _>=X x, ... } <
    {.x /1 x, .y |0  y} concat_, 
    {.x /0 x, .y |1 y} _dec
>;

c0 = {}|0;
c1 = {}|1;

plus =
< 
  {.x/'+' inv x, .y/'+' inv y, c0 c } _plus inv nat | '+',
  {.x/'-' inv x, .y/'-' inv y, c0 c } _plus inv nat | '-',
  {.y/'-' x, .x/'+' y} GT {.x inv x, .y inv y, c0 c} _minus inv nat | '-',
  {.x/'+' inv x, .y/'-' inv y, c0 c} _minus inv nat |'+',
  {.x/'-' x, .y/'+' y} GT {.x inv x, .y inv y, c0 c} _minus inv nat | '-',
  {.y/'+' inv x, .x/'-' inv y, c0 c} _minus inv nat | '+'
>;

swap_sign = <
  zero_int?,
  /'+' | '-',
  /'-' | '+'
>;

minus =
  {.x x, .y swap_sign y} plus;

_plus = {.x x, .y y, .c c, 0b r} _plus_;

_plus_ =
  -- least significant bit first addition with carry
  ?{ <X 0, X 1, {} _>=X x, ... }
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
  ?{ <X 0, X 1, {} _>=X x, ... }
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

sign_plus = {}|'+';
sign_minus = {}|'-';
get_sign = </'+' sign_plus, /'-' sign_minus>;

times =
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
  ?{ <Y 0, Y 1, {} _>=Y y, ... }
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
// ----------------------------------------------------------------------

shift_in_0 = inv |0 inv nat;
shift_in_1 = inv |1 inv nat;
sub_bits = {.x inv x, .y inv y, c0 c} _minus inv nat;

_div_restoring =
  ?{ <X 0, X 1, {} _>=X x, ... }
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

_pad_down = ?{ <X 0, X 1, {} _>=X x, <S 0, S 1, {} _>=S steps, ... }
  <
    {.x empty? if, {._y _y, .steps steps} then} .then,
    {
      .x </0, /1> x,
      ._y |0 _y,
      .steps |0 steps
    } _pad_down
  >;

_align_down = ?{ <X 0, X 1, {} _>=X x, <Y 0, Y 1, {} _>=Y y, ... }
  <
    {
      .x </0, /1> x,
      .y </0, /1> y,
      ._y _y
    } _align_down,

    {
      .y empty? if,
      {.x x, ._y _y, 0b steps} _pad_down then
    } .then,

    {
      .x empty? if,
      .y empty? and,
      {._y _y, 0b steps} then
    } .then
  >;

_div_down = ?{ <X 0, X 1, {} _>=X steps, ... }
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
    {
      .test /yes if,
      {
        {.x int x, .y_scaled int y} minus /+ x,
        .q |1 q,
        ._y _y,
        .steps steps
      } then
    } .then,
    {
      .test /no if,
      {.x x, .q |0 q, ._y _y, .steps steps} then
    } .then
  >
  <
    {
      .steps empty? if,
      {.q inv int div, .x rem} then
    } .then,
    {
      .x x,
      ._y /0 _y,
      .steps /0 steps,
      .q q
    } _div_down
  >;

_check_2y = ?{ <X 0, X 1, {} _>=X x, <Y 0, Y 1, {} _>=Y y, ... }
  <
    {.x empty? if, {} | down_shift then} .then,
    {.y empty? if, {} | restore then} .then,
    {.x </0, /1> empty? if, {} | down_shift then} .then,
    {
      .x </0, /1> </0, /1> x,
      .y </0, /1> y
    } _check_2y
  >;

div =
  {
    <
      { .x/'+' if, .y get_sign then } .then,
      { .x/'-' if, .y swap_sign get_sign then } .then
    > sign,
    .x abs remove_leading_zeros x_norm,
    .y abs remove_leading_zeros y_norm
  }
  <
    {
      .x_norm empty? if,
      { 0 int div, 0 rem } then
    } .then,
    {
      {.y_norm x, .x_norm y} GT if,
      { 0 int div, .x_norm rem } then
    } .then,
    {
      .sign sign,
      {
        .x_norm x,
        .y_norm y,
        {.x_norm x, .y_norm y} _check_2y choice
      }
      <
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

mod =
  {{.x int x, .y int y} div .rem rem} .rem;

gcd =
  <
    {.y x, .x y} GT, 
    ()
  > _gcd
;

_gcd = ?{ <X 0, X 1, {} _>=X x, ... } <
  { .y remove_leading_zeros empty? if, .x nat then } .then,
  { .y x, mod y } _gcd
>;

lcm = 
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

fib = {() n, {1 int x, 0 int y} "fib(n),fib(n.1)"} fib_ .x;

--------------------

rat = {.n int n, .d int d } normalize_rat;

normalize_rat =
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
;

plus_rat = 
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
  { 
    {.x.n x,.y.n y} times n, 
    {.x.d x,.y.d y} times d
  } 
  normalize_rat;

minus_rat = 
  {
    .x x, 
    .y {.n swap_sign n, .d d} y
  } 
  plus_rat;

inverse_rat = 
  { .d n, .n d }
  normalize_rat
;

div_rat = 
  { .x x, .y inverse_rat y} times_rat
;

int_rat = 
  { .n n, .d d, {.n x,.d y} div div }
  { .div.div int, {.div.rem int n, .d d} rat}
;

()