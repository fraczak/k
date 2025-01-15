-- Examples for defining arithmetic functions natively

$rat = {int n, int d};

MINUS = SNOC [.car, .cdr PLUS [(),-1] TIMES] PLUS;

abs = < [0, ()] GT [-1,.1] TIMES, ()>;

mod = 
-- ${int x, int y}
{ .x abs x, .y abs y} mod_
;

mod_ = 
-- ${int x, int y}
<
    [.y, .x] GT .1,
    { 
        {[.x,.y] MINUS x, [.y,2] TIMES y} mod_ x, 
        .y y
    } mod_
>
-- $int
;

// gratest common divisor
gcd = 
--${int x, int y}
  [.x abs, .y abs] <GT {.0 x, .1 y}, {.1 x,.0 y}>
  gcd_
--$int
;

gcd_ = <
  { .y.0 if, .x then } .then,
  { .y x, mod y } gcd_
>;

// div

log2_floor =
-- ${int x, int step} 
-- finds the largest k, such that 'step * 2^k <= x',
-- returns k+1, i.e., 0 if x < step, and k+1 otherwise.
  {.x x, .step step, 0 log} log2_floor_;

log2_floor_ = <
  {[.step,.x] GT if, .log then} .then,
  {.x x, [.step,0] GT [.0,2] TIMES step, .log [(),1] PLUS log} log2_floor_
>;

div = 
-- ${int x, int y} 
  // remember sign
  {
    <
      { [0, .x] GT, [0, .y] GT if, "+" then } .then,
      [0, .x] GT "-",
      [0, .y] GT "-",
      "+"
    > sign,
    {.x abs x, .y abs step, 0 res} div_ res_wo_sign
  }
  < 
    {.sign."+" if, {.res_wo_sign.div div, .res_wo_sign.rem rem} then} .then,
    { [0, .res_wo_sign.div] MINUS div, [0,.res_wo_sign.rem] MINUS rem }
  > 
  ;

rep = 
-- ${int x, int count}
  <
    .count.0 [],
    {.x car, {.x x, .count [(),-1] PLUS count} rep cdr} CONS
  >
-- $[int]
;

div_ =
  {
    .x x,
    .step step,
    .res res,
    {.x x, .step step} log2_floor log
  }
  < 
    { .log.0 if, {.res div, .x rem} then } .then,
    { 
      {2 x, .log [(),1] MINUS count} rep TIMES factor,
      () i
    }
    {[.i.x, [.i.step, .factor] TIMES] MINUS x, .i.step step, [.i.res,.factor] PLUS res} div_
  >;

lcm = 
-- ${int x, int y}
  {() x, gcd y} [{.x.x x , .y y} div .div, .x.x] TIMES
-- $int
;

-- lcm = [(),gcd] [[.0.1,.1] div .div, .0.0] TIMES;

--------------------

normalize_rat =
  -- $rat 
  < 
    { [0, .d] GT if, 
      {
        [0, .n] MINUS n, 
        [0, .d] MINUS d
      } then
     } .then,
    ()
  >
  {() x, {.n x,.d y} gcd y}
  {
    {.x.n x,.y y} div .div n, 
    {.x.d x,.y y} div .div d
  }
-- $rat
;

plus_rat = 
-- ${rat x, rat y}
  { 
    [.x, .y] args,
    {.x.d x,.y.d y} lcm lcm
  }
  { 
    [
      { .args.0 a, .lcm lcm} [.a.n, {.lcm x, .a.d y} div .div] TIMES,
      { .args.1 a, .lcm lcm} [.a.n, {.lcm x, .a.d y} div .div] TIMES
    ] PLUS n, 
    .lcm d
  }
  normalize_rat;

times_rat = 
-- ${rat x, rat y}
  { 
    [.x.n,.y.n] TIMES n, 
    [.x.d,.y.d] TIMES d
  } 
  normalize_rat;
 
minus_rat = 
-- ${rat x, rat y}
  {
    .x x, 
    .y {[0, .n] MINUS n, .d d} y
  } 
  plus_rat;

inverse_rat = 
-- $rat
  { .d n, .n d }
  normalize_rat
;

div_rat = 
-- ${rat x, rat y}
  { .x x, .y inverse_rat y} times_rat
;

--------------------

int_rat = 
-- $rat 
  { .n n, .d d, {.n x,.d y} div div }
  { .div.div int, {.div.rem n, .d d} rat}
-- ${int int, rat rat}
;

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
-- $string
;

_rat! = $rat {
  () carryOn, 
  ratToString _log! drop
 } .carryOn;

()