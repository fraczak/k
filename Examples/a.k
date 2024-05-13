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
  {.0 x, .1 step, 0 res} div_
${int div, int rem};

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
