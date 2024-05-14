-- Examples for defining arithmetic functions natively

$rat = {int n, int d};

MINUS = SNOC [.0, .1 PLUS [(),-1] TIMES] PLUS;

abs = $int < [0, ()] GT [-1,.1] TIMES, ()>;

mod = 
${int 0, int 1}
{ .0 abs x, .1 abs y} mod_
;

mod_ = 
${int x, int y}
<
    [.y, .x] GT .1,
    { 
        {[.x,.y] MINUS x, [.y,2] TIMES y} mod_ x, 
        .y y
    } mod_
>
$int
;

// gratest common divisor
gcd = ${int 0, int 1}
  [.0 abs, .1 abs] <GT, [.1,.0]>
  gcd_
$int;

gcd_ = <
  [.0, .1.0] .0,
  [.1, mod] gcd_
>;

// div


log2_floor = ${int x, int step} 
-- finds the largest k, such that 'step * 2^k <= x',
-- returns k+1, i.e., 0 if x < step, and k+1 otherwise.
  {.x x, .step step, 0 log} log2_floor_;


log2_floor_ = <
  [[.step,.x] GT, .log] .1,
  {.x x, .step [(),()] PLUS step, .log [(),1] PLUS log} log2_floor_
>;

div = ${int 0, int 1} 
  // remember sign
  {
    <
      ["+", [0, .0] GT, [0, .1] GT ] .0,
      [0, .0] GT "-",
      [0, .1] GT "-",
      "+"
    > sign,
    {.0 abs x, .1 abs step, 0 res} div_ res_wo_sign
  }
  { < 
      [.sign."+", .res_wo_sign.div] .1,
      [0, .res_wo_sign.div] MINUS
    > div, 
    .res_wo_sign.rem rem
  };

rep = ${int x, int count}
  <
    .count.0 [],
    [.x, {.x x, .count [(),-1] PLUS count} rep] CONS
  >
$[int];

div_ =
  {
    .x x,
    .step step,
    .res res,
    {.x x, .step step} log2_floor log
  }
  < 
    [.log.0, {.res div, .x rem}] .1,
    { 
      {2 x, .log [(),1] MINUS count} rep TIMES factor,
      () i
    }
    {[.i.x, [.i.step, .factor] TIMES] MINUS x, .i.step step, [.i.res,.factor] PLUS res} div_
  >;

lcm = ${int 0, int 1}
  [(),gcd] [[.0.0,.1] div .div, .0.1] TIMES
$int;

-- lcm = [(),gcd] [[.0.1,.1] div .div, .0.0] TIMES;

--------------------

simple_rat =
  <$int, $rat > 
  < 
    $int {() n, 1 d },
    [ [0, .d] GT, 
      {
        [0, .n] MINUS n, 
        [0, .d] MINUS d
      }
    ] .1,
    ()
  >
  [(), [.n,.d] gcd]
  {
    [.0.n,.1] div .div n, 
    [.0.d,.1] div .div d
  }
$rat;

add_rat = ${rat x, rat y}
  { 
    [.x, .y] args,
    [.x.d,.y.d] lcm lcm
  }
  { 
    { .args | a, .lcm lcm} [.a.n, [.lcm, .a.d] div .div] TIMES ^ PLUS n, 
    .lcm d
  }
$rat;

mult_rat = ${rat x, rat y}
  { 
    [.x.n,.y.n] TIMES n, 
    [.x.d,.y.d] TIMES d
  } 
  simple_rat;

neg_rat = $rat
  { 
    [0, .n] MINUS n, 
    .d d
  }
; 
 
sub_rat = ${rat x, rat y}
  {.x x, .y neg_rat y} add_rat;

inverse_rat = $rat
  { .d n, .n d }
  simple_rat;