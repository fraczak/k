$bit  = < {} 0, {} 1 >;
$sign = < {} +, {} - >;

$bit_pair  = {bit x, bit y};
$sign_pair = {sign x, sign y};

$cmp_state = <{} eq, {} gt, {} lt>;
$cmp = <{} eq_exact, {} eq_zero, {} gt, {} lt, {} unordered_nan>;

$exp11  = {bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9, bit 10};
$frac52 = {bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9,
           bit 10, bit 11, bit 12, bit 13, bit 14, bit 15, bit 16, bit 17, bit 18, bit 19,
           bit 20, bit 21, bit 22, bit 23, bit 24, bit 25, bit 26, bit 27, bit 28, bit 29,
           bit 30, bit 31, bit 32, bit 33, bit 34, bit 35, bit 36, bit 37, bit 38, bit 39,
           bit 40, bit 41, bit 42, bit 43, bit 44, bit 45, bit 46, bit 47, bit 48, bit 49,
           bit 50, bit 51};

$float64 = {sign sign, exp11 exponent, frac52 fraction};
$float_pair = {float64 x, float64 y};

$exp_pair  = {exp11 x, exp11 y};
$frac_pair = {frac52 x, frac52 y};

$cmp_step_in  = {bit_pair bits, cmp_state state};
$cmp_exp_ctx  = {exp_pair pair, cmp_state state};
$cmp_frac_ctx = {frac_pair pair, cmp_state state};

0 = {} |0 $bit;
1 = {} |1 $bit;

+ = {} |+ $sign;
- = {} |- $sign;

eq = {} |eq $cmp_state;
gt = {} |gt $cmp_state;
lt = {} |lt $cmp_state;

eq_exact_cmp      = {} |eq_exact $cmp;
eq_zero_cmp       = {} |eq_zero $cmp;
gt_cmp            = {} |gt $cmp;
lt_cmp            = {} |lt $cmp;
unordered_nan_cmp = {} |unordered_nan $cmp;

0? = $bit {/0 if, () then} .then $bit;
1? = $bit {/1 if, () then} .then $bit;

+? = $sign {/+ if, () then} .then $sign;
-? = $sign {/- if, () then} .then $sign;

eq_bit? = $bit_pair
  <
    {.x 0? ifx, .y 0? ify, () then} .then,
    {.x 1? ifx, .y 1? ify, () then} .then
  > $bit_pair;

gt_bit? = $bit_pair
  {.x 1? ifx, .y 0? ify, () then} .then
  $bit_pair;

lt_bit? = $bit_pair
  {.x 0? ifx, .y 1? ify, () then} .then
  $bit_pair;

eq_sign? = $sign_pair
  <
    {.x +? ifx, .y +? ify, () then} .then,
    {.x -? ifx, .y -? ify, () then} .then
  > $sign_pair;

zero_exponent? = $exp11
  {.0 0? if0, .1 0? if1, .2 0? if2, .3 0? if3, .4 0? if4, .5 0? if5, .6 0? if6, .7 0? if7, .8 0? if8, .9 0? if9, .10 0? if10, () then} .then
  $exp11;

all_ones_exponent? = $exp11
  {.0 1? if0, .1 1? if1, .2 1? if2, .3 1? if3, .4 1? if4, .5 1? if5, .6 1? if6, .7 1? if7, .8 1? if8, .9 1? if9, .10 1? if10, () then} .then
  $exp11;

not_all_ones_exponent? = $exp11
  {<.10 0?, .9 0?, .8 0?, .7 0?, .6 0?, .5 0?, .4 0?, .3 0?, .2 0?, .1 0?, .0 0?> if, () then} .then
  $exp11;

zero_fraction? = $frac52
  {.51 0? if51, .50 0? if50, .49 0? if49, .48 0? if48, .47 0? if47, .46 0? if46, .45 0? if45, .44 0? if44, .43 0? if43, .42 0? if42,
   .41 0? if41, .40 0? if40, .39 0? if39, .38 0? if38, .37 0? if37, .36 0? if36, .35 0? if35, .34 0? if34, .33 0? if33, .32 0? if32,
   .31 0? if31, .30 0? if30, .29 0? if29, .28 0? if28, .27 0? if27, .26 0? if26, .25 0? if25, .24 0? if24, .23 0? if23, .22 0? if22,
   .21 0? if21, .20 0? if20, .19 0? if19, .18 0? if18, .17 0? if17, .16 0? if16, .15 0? if15, .14 0? if14, .13 0? if13, .12 0? if12,
   .11 0? if11, .10 0? if10, .9 0? if9, .8 0? if8, .7 0? if7, .6 0? if6, .5 0? if5, .4 0? if4, .3 0? if3, .2 0? if2, .1 0? if1, .0 0? if0,
   () then} .then
  $frac52;

nonzero_fraction? = $frac52
  {<.51 1?, .50 1?, .49 1?, .48 1?, .47 1?, .46 1?, .45 1?, .44 1?, .43 1?, .42 1?,
    .41 1?, .40 1?, .39 1?, .38 1?, .37 1?, .36 1?, .35 1?, .34 1?, .33 1?, .32 1?,
    .31 1?, .30 1?, .29 1?, .28 1?, .27 1?, .26 1?, .25 1?, .24 1?, .23 1?, .22 1?,
    .21 1?, .20 1?, .19 1?, .18 1?, .17 1?, .16 1?, .15 1?, .14 1?, .13 1?, .12 1?,
    .11 1?, .10 1?, .9 1?, .8 1?, .7 1?, .6 1?, .5 1?, .4 1?, .3 1?, .2 1?, .1 1?, .0 1?> if, () then} .then
  $frac52;

nan_float64? = $float64
  {.exponent all_ones_exponent? ife, .fraction nonzero_fraction? iff, () then} .then
  $float64;

inf_float64? = $float64
  {.exponent all_ones_exponent? ife, .fraction zero_fraction? iff, () then} .then
  $float64;

finite_float64? = $float64
  {.exponent not_all_ones_exponent? ife, () then} .then
  $float64;

ordered_float64? = $float64
  <finite_float64?, inf_float64?>
  $float64;

zero_float64? = $float64
  {.exponent zero_exponent? ife, .fraction zero_fraction? iff, () then} .then
  $float64;

cmp_step = $cmp_step_in
  <
    {.state /gt if, gt then} .then,
    {.state /lt if, lt then} .then,
    {.state /eq if,
      <
        {.bits gt_bit? if, gt then} .then,
        {.bits lt_bit? if, lt then} .then,
        {.bits eq_bit? if, eq then} .then
      > then
    } .then
  > $cmp_state;

stepE10 = $cmp_exp_ctx {{.state state, {.pair .x .10 x, .pair .y .10 y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE9  = $cmp_exp_ctx {{.state state, {.pair .x .9  x, .pair .y .9  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE8  = $cmp_exp_ctx {{.state state, {.pair .x .8  x, .pair .y .8  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE7  = $cmp_exp_ctx {{.state state, {.pair .x .7  x, .pair .y .7  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE6  = $cmp_exp_ctx {{.state state, {.pair .x .6  x, .pair .y .6  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE5  = $cmp_exp_ctx {{.state state, {.pair .x .5  x, .pair .y .5  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE4  = $cmp_exp_ctx {{.state state, {.pair .x .4  x, .pair .y .4  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE3  = $cmp_exp_ctx {{.state state, {.pair .x .3  x, .pair .y .3  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE2  = $cmp_exp_ctx {{.state state, {.pair .x .2  x, .pair .y .2  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE1  = $cmp_exp_ctx {{.state state, {.pair .x .1  x, .pair .y .1  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;
stepE0  = $cmp_exp_ctx {{.state state, {.pair .x .0  x, .pair .y .0  y} bits} cmp_step state, .pair pair} $cmp_exp_ctx;

cmp_exponent = $exp_pair
  {eq state, () pair} $cmp_exp_ctx
  stepE10 stepE9 stepE8 stepE7 stepE6 stepE5 stepE4 stepE3 stepE2 stepE1 stepE0
  .state
  $cmp_state;

gt_exponent? = $exp_pair {cmp_exponent /gt if, () then} .then $exp_pair;
eq_exponent? = $exp_pair {cmp_exponent /eq if, () then} .then $exp_pair;

stepF51 = $cmp_frac_ctx {{.state state, {.pair .x .51 x, .pair .y .51 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF50 = $cmp_frac_ctx {{.state state, {.pair .x .50 x, .pair .y .50 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF49 = $cmp_frac_ctx {{.state state, {.pair .x .49 x, .pair .y .49 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF48 = $cmp_frac_ctx {{.state state, {.pair .x .48 x, .pair .y .48 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF47 = $cmp_frac_ctx {{.state state, {.pair .x .47 x, .pair .y .47 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF46 = $cmp_frac_ctx {{.state state, {.pair .x .46 x, .pair .y .46 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF45 = $cmp_frac_ctx {{.state state, {.pair .x .45 x, .pair .y .45 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF44 = $cmp_frac_ctx {{.state state, {.pair .x .44 x, .pair .y .44 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF43 = $cmp_frac_ctx {{.state state, {.pair .x .43 x, .pair .y .43 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF42 = $cmp_frac_ctx {{.state state, {.pair .x .42 x, .pair .y .42 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF41 = $cmp_frac_ctx {{.state state, {.pair .x .41 x, .pair .y .41 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF40 = $cmp_frac_ctx {{.state state, {.pair .x .40 x, .pair .y .40 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF39 = $cmp_frac_ctx {{.state state, {.pair .x .39 x, .pair .y .39 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF38 = $cmp_frac_ctx {{.state state, {.pair .x .38 x, .pair .y .38 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF37 = $cmp_frac_ctx {{.state state, {.pair .x .37 x, .pair .y .37 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF36 = $cmp_frac_ctx {{.state state, {.pair .x .36 x, .pair .y .36 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF35 = $cmp_frac_ctx {{.state state, {.pair .x .35 x, .pair .y .35 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF34 = $cmp_frac_ctx {{.state state, {.pair .x .34 x, .pair .y .34 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF33 = $cmp_frac_ctx {{.state state, {.pair .x .33 x, .pair .y .33 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF32 = $cmp_frac_ctx {{.state state, {.pair .x .32 x, .pair .y .32 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF31 = $cmp_frac_ctx {{.state state, {.pair .x .31 x, .pair .y .31 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF30 = $cmp_frac_ctx {{.state state, {.pair .x .30 x, .pair .y .30 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF29 = $cmp_frac_ctx {{.state state, {.pair .x .29 x, .pair .y .29 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF28 = $cmp_frac_ctx {{.state state, {.pair .x .28 x, .pair .y .28 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF27 = $cmp_frac_ctx {{.state state, {.pair .x .27 x, .pair .y .27 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF26 = $cmp_frac_ctx {{.state state, {.pair .x .26 x, .pair .y .26 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF25 = $cmp_frac_ctx {{.state state, {.pair .x .25 x, .pair .y .25 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF24 = $cmp_frac_ctx {{.state state, {.pair .x .24 x, .pair .y .24 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF23 = $cmp_frac_ctx {{.state state, {.pair .x .23 x, .pair .y .23 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF22 = $cmp_frac_ctx {{.state state, {.pair .x .22 x, .pair .y .22 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF21 = $cmp_frac_ctx {{.state state, {.pair .x .21 x, .pair .y .21 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF20 = $cmp_frac_ctx {{.state state, {.pair .x .20 x, .pair .y .20 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF19 = $cmp_frac_ctx {{.state state, {.pair .x .19 x, .pair .y .19 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF18 = $cmp_frac_ctx {{.state state, {.pair .x .18 x, .pair .y .18 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF17 = $cmp_frac_ctx {{.state state, {.pair .x .17 x, .pair .y .17 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF16 = $cmp_frac_ctx {{.state state, {.pair .x .16 x, .pair .y .16 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF15 = $cmp_frac_ctx {{.state state, {.pair .x .15 x, .pair .y .15 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF14 = $cmp_frac_ctx {{.state state, {.pair .x .14 x, .pair .y .14 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF13 = $cmp_frac_ctx {{.state state, {.pair .x .13 x, .pair .y .13 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF12 = $cmp_frac_ctx {{.state state, {.pair .x .12 x, .pair .y .12 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF11 = $cmp_frac_ctx {{.state state, {.pair .x .11 x, .pair .y .11 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF10 = $cmp_frac_ctx {{.state state, {.pair .x .10 x, .pair .y .10 y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF9  = $cmp_frac_ctx {{.state state, {.pair .x .9  x, .pair .y .9  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF8  = $cmp_frac_ctx {{.state state, {.pair .x .8  x, .pair .y .8  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF7  = $cmp_frac_ctx {{.state state, {.pair .x .7  x, .pair .y .7  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF6  = $cmp_frac_ctx {{.state state, {.pair .x .6  x, .pair .y .6  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF5  = $cmp_frac_ctx {{.state state, {.pair .x .5  x, .pair .y .5  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF4  = $cmp_frac_ctx {{.state state, {.pair .x .4  x, .pair .y .4  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF3  = $cmp_frac_ctx {{.state state, {.pair .x .3  x, .pair .y .3  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF2  = $cmp_frac_ctx {{.state state, {.pair .x .2  x, .pair .y .2  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF1  = $cmp_frac_ctx {{.state state, {.pair .x .1  x, .pair .y .1  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;
stepF0  = $cmp_frac_ctx {{.state state, {.pair .x .0  x, .pair .y .0  y} bits} cmp_step state, .pair pair} $cmp_frac_ctx;

cmp_fraction = $frac_pair
  {eq state, () pair} $cmp_frac_ctx
  stepF51 stepF50 stepF49 stepF48 stepF47 stepF46 stepF45 stepF44 stepF43 stepF42 stepF41 stepF40 stepF39 stepF38 stepF37 stepF36 stepF35 stepF34 stepF33 stepF32 stepF31 stepF30
  stepF29 stepF28 stepF27 stepF26 stepF25 stepF24 stepF23 stepF22 stepF21 stepF20 stepF19 stepF18 stepF17 stepF16 stepF15 stepF14 stepF13 stepF12 stepF11 stepF10 stepF9 stepF8 stepF7 stepF6 stepF5 stepF4 stepF3 stepF2 stepF1 stepF0
  .state
  $cmp_state;

gt_fraction? = $frac_pair {cmp_fraction /gt if, () then} .then $frac_pair;
eq_fraction? = $frac_pair {cmp_fraction /eq if, () then} .then $frac_pair;

gt_magnitude_float64? = $float_pair
  <
    {{.x .exponent x, .y .exponent y} gt_exponent? if, () then} .then,
    {{.x .exponent x, .y .exponent y} eq_exponent? ife, {.x .fraction x, .y .fraction y} gt_fraction? iff, () then} .then
  > $float_pair;

cmp_float64 = $float_pair
  <
    {<.x nan_float64?, .y nan_float64?> if, unordered_nan_cmp then} .then,
    {.x zero_float64? ifx, .y zero_float64? ify, eq_zero_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify,
     {.x .sign x, .y .sign y} eq_sign? ifs,
     {.x .exponent x, .y .exponent y} eq_exponent? ife,
     {.x .fraction x, .y .fraction y} eq_fraction? iff,
     eq_exact_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify, .x .sign +? ifsx, .y .sign -? ifsy, gt_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify, .x .sign -? ifsx, .y .sign +? ifsy, lt_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify, .x .sign +? ifsx, .y .sign +? ifsy, gt_magnitude_float64? ifm, gt_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify, .x .sign +? ifsx, .y .sign +? ifsy, {.y x, .x y} gt_magnitude_float64? ifm, lt_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify, .x .sign -? ifsx, .y .sign -? ifsy, {.y x, .x y} gt_magnitude_float64? ifm, gt_cmp then} .then,
    {.x ordered_float64? ifx, .y ordered_float64? ify, .x .sign -? ifsx, .y .sign -? ifsy, gt_magnitude_float64? ifm, lt_cmp then} .then
  > $cmp;

eq_float64? = $float_pair {<cmp_float64 /eq_zero, cmp_float64 /eq_exact> if, () then} .then $float_pair;
gt_float64? = $float_pair {cmp_float64 /gt if, () then} .then $float_pair;
lt_float64? = $float_pair {cmp_float64 /lt if, () then} .then $float_pair;
le_float64? = $float_pair {<cmp_float64 /lt, cmp_float64 /eq_zero, cmp_float64 /eq_exact> if, () then} .then $float_pair;
ge_float64? = $float_pair {<cmp_float64 /gt, cmp_float64 /eq_zero, cmp_float64 /eq_exact> if, () then} .then $float_pair;

exp0 = {} {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10} $exp11;
exp_all1 = {} {1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} $exp11;

frac0 = {} {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
            0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
            0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
            0 48, 0 49, 0 50, 0 51} $frac52;

frac_lsb1 = {} {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
                0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
                0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
                0 48, 0 49, 0 50, 0 51} $frac52;

pos_zero = {} {+ sign, exp0 exponent, frac0 fraction} $float64;
neg_zero = {} {- sign, exp0 exponent, frac0 fraction} $float64;

pos_inf  = {} {+ sign, exp_all1 exponent, frac0 fraction} $float64;
neg_inf  = {} {- sign, exp_all1 exponent, frac0 fraction} $float64;

qnan = {} {+ sign, exp_all1 exponent, frac_lsb1 fraction} $float64;

flip_sign = $sign
  <
    {+? if, {} |- $sign then} .then,
    {-? if, {} |+ $sign then} .then
  > $sign;

xor_sign = $sign_pair
  <
    {.x +? ifx, .y +? ify, {} |+ $sign then} .then,
    {.x +? ifx, .y -? ify, {} |- $sign then} .then,
    {.x -? ifx, .y +? ify, {} |- $sign then} .then,
    {.x -? ifx, .y -? ify, {} |+ $sign then} .then
  > $sign;

opp_sign? = $sign_pair
  <
    {.x +? ifx, .y -? ify, () then} .then,
    {.x -? ifx, .y +? ify, () then} .then
  > $sign_pair;

inf_of_sign = $sign
  <
    {+? if, pos_inf then} .then,
    {-? if, neg_inf then} .then
  > $float64;

zero_of_sign = $sign
  <
    {+? if, pos_zero then} .then,
    {-? if, neg_zero then} .then
  > $float64;

negate_float64 = $float64
  {.sign flip_sign sign, .exponent exponent, .fraction fraction}
  $float64;

pair_signs = $float_pair
  {.x .sign x, .y .sign y}
  $sign_pair;

xor_sign_of_pair = $float_pair
  pair_signs xor_sign
  $sign;

opp_signs_of_pair? = $float_pair
  pair_signs opp_sign?
  $sign_pair;

inf_from_pair_sign = $float_pair
  xor_sign_of_pair inf_of_sign
  $float64;

zero_from_pair_sign = $float_pair
  xor_sign_of_pair zero_of_sign
  $float64;

add_float64 = $float_pair
  <
    {.x nan_float64? ifx, qnan then} .then,
    {.y nan_float64? ify, qnan then} .then,
    {.x inf_float64? ifx, .y inf_float64? ify, opp_signs_of_pair? ifs, qnan then} .then,
    {.x inf_float64? ifx, .x then} .then,
    {.y inf_float64? ify, .y then} .then,
    {.x zero_float64? ifx, .y zero_float64? ify, pos_zero then} .then,
    {.x zero_float64? ifx, .y then} .then,
    {.y zero_float64? ify, .x then} .then
  > $float64;

negate_y_pair = $float_pair
  {.x x, (.y negate_float64) y}
  $float_pair;

sub_float64 = $float_pair
  negate_y_pair
  add_float64
  $float64;

mul_float64 = $float_pair
  <
    {.x nan_float64? ifx, qnan then} .then,
    {.y nan_float64? ify, qnan then} .then,
    {.x inf_float64? ifx, .y zero_float64? ify, qnan then} .then,
    {.x zero_float64? ifx, .y inf_float64? ify, qnan then} .then,
    {.x inf_float64? ifx, .y ordered_float64? ify, inf_from_pair_sign then} .then,
    {.y inf_float64? ify, .x ordered_float64? ifx, inf_from_pair_sign then} .then,
    {.x zero_float64? ifx, .y ordered_float64? ify, zero_from_pair_sign then} .then,
    {.y zero_float64? ify, .x ordered_float64? ifx, zero_from_pair_sign then} .then
  > $float64;

div_float64 = $float_pair
  <
    {.x nan_float64? ifx, qnan then} .then,
    {.y nan_float64? ify, qnan then} .then,
    {.x zero_float64? ifx, .y zero_float64? ify, qnan then} .then,
    {.x inf_float64? ifx, .y inf_float64? ify, qnan then} .then,
    {.x inf_float64? ifx, .y ordered_float64? ify, inf_from_pair_sign then} .then,
    {.x ordered_float64? ifx, .y inf_float64? ify, zero_from_pair_sign then} .then,
    {.x ordered_float64? ifx, .y zero_float64? ify, inf_from_pair_sign then} .then,
    {.x zero_float64? ifx, .y ordered_float64? ify, zero_from_pair_sign then} .then
  > $float64;

# --- useful float64 constants (IEEE-754 binary64) ---

# 1.0  exponent = 1023 = 0b01111111111
exp_1 = {} {1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 0 10} $exp11;

# 10.0 exponent = 1026 = 1023 + 3 = 0b10000000010
exp_10 = {} {0 0, 1 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 1 10} $exp11;

# 10.0 significand = 1.01b => fraction bit 50 = 1 (2^-2), everything else 0
frac_10 = {} {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
              0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
              0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
              0 48, 0 49, 1 50, 0 51} $frac52;

# signed zeros (aliases)
0+f = pos_zero;
0-f = neg_zero;

# 1.0, -1.0, 10.0
1f  = {} {+ sign,  exp_1  exponent, frac0   fraction} $float64;
-1f = {} {- sign,  exp_1  exponent, frac0   fraction} $float64;
10f = {} {+ sign,  exp_10 exponent, frac_10 fraction} $float64;


-- TESTS --
# -----------------------------------------------------------------------------
# Extra constants (finite) for comparisons
# -----------------------------------------------------------------------------

# exponent = 1023 (bias): 0b01111111111  (bit10 is MSB in your cmp loop)
exp_1023 = {}
  { 0 10,
    1 9, 1 8, 1 7, 1 6, 1 5, 1 4, 1 3, 1 2, 1 1, 1 0
  } $exp11;

# exponent = 1024: 0b10000000000
exp_1024 = {}
  { 1 10,
    0 9, 0 8, 0 7, 0 6, 0 5, 0 4, 0 3, 0 2, 0 1, 0 0
  } $exp11;

one     = {+ sign, exp_1023 exponent, frac0 fraction} $float64;
two     = {+ sign, exp_1024 exponent, frac0 fraction} $float64;
neg_one = {- sign, exp_1023 exponent, frac0 fraction} $float64;

# smallest positive subnormal: exponent=0, fraction LSB=1
pos_denorm_min = {+ sign, exp0 exponent, frac_lsb1 fraction} $float64;
neg_denorm_min = {- sign, exp0 exponent, frac_lsb1 fraction} $float64;

# -----------------------------------------------------------------------------
# Expanded test product (make sure THIS is the last expression in the file)
# -----------------------------------------------------------------------------

{
  # --- cmp_float64 -----------------------------------------------------------
  ({pos_zero x, neg_zero y} cmp_float64) cmp_pz_nz,
  ({neg_zero x, pos_zero y} cmp_float64) cmp_nz_pz,
  ({pos_zero x, pos_zero y} cmp_float64) cmp_pz_pz,
  ({neg_zero x, neg_zero y} cmp_float64) cmp_nz_nz,

  ({pos_zero x, pos_inf y}  cmp_float64) cmp_pz_pinf,
  ({pos_zero x, neg_inf y}  cmp_float64) cmp_pz_ninf,
  ({neg_zero x, pos_inf y}  cmp_float64) cmp_nz_pinf,
  ({neg_zero x, neg_inf y}  cmp_float64) cmp_nz_ninf,

  ({pos_inf x, pos_zero y}  cmp_float64) cmp_pinf_pz,
  ({neg_inf x, pos_zero y}  cmp_float64) cmp_ninf_pz,

  ({pos_inf x, neg_inf y}   cmp_float64) cmp_pinf_ninf,
  ({neg_inf x, pos_inf y}   cmp_float64) cmp_ninf_pinf,
  ({pos_inf x, pos_inf y}   cmp_float64) cmp_pinf_pinf,
  ({neg_inf x, neg_inf y}   cmp_float64) cmp_ninf_ninf,

  ({qnan x, pos_zero y}     cmp_float64) cmp_qnan_pz,
  ({pos_zero x, qnan y}     cmp_float64) cmp_pz_qnan,
  ({qnan x, qnan y}         cmp_float64) cmp_qnan_qnan,
  ({qnan x, pos_inf y}      cmp_float64) cmp_qnan_pinf,
  ({pos_inf x, qnan y}      cmp_float64) cmp_pinf_qnan,

  # --- add_float64 -----------------------------------------------------------
  ({qnan x, pos_zero y}     add_float64) add_qnan_pz,
  ({pos_zero x, qnan y}     add_float64) add_pz_qnan,
  ({qnan x, qnan y}         add_float64) add_qnan_qnan,

  ({pos_inf x, neg_inf y}   add_float64) add_pinf_ninf,
  ({neg_inf x, pos_inf y}   add_float64) add_ninf_pinf,

  ({pos_inf x, pos_zero y}  add_float64) add_pinf_pz,
  ({pos_inf x, neg_zero y}  add_float64) add_pinf_nz,
  ({neg_inf x, pos_zero y}  add_float64) add_ninf_pz,
  ({neg_inf x, neg_zero y}  add_float64) add_ninf_nz,

  ({pos_zero x, pos_inf y}  add_float64) add_pz_pinf,
  ({neg_zero x, pos_inf y}  add_float64) add_nz_pinf,
  ({pos_zero x, neg_inf y}  add_float64) add_pz_ninf,
  ({neg_zero x, neg_inf y}  add_float64) add_nz_ninf,

  ({pos_zero x, neg_zero y} add_float64) add_pz_nz,
  ({neg_zero x, pos_zero y} add_float64) add_nz_pz,
  ({pos_zero x, pos_zero y} add_float64) add_pz_pz,
  ({neg_zero x, neg_zero y} add_float64) add_nz_nz,

  # --- sub_float64 -----------------------------------------------------------
  ({qnan x, pos_zero y}     sub_float64) sub_qnan_pz,
  ({pos_zero x, qnan y}     sub_float64) sub_pz_qnan,

  ({pos_zero x, pos_zero y} sub_float64) sub_pz_pz,
  ({pos_zero x, neg_zero y} sub_float64) sub_pz_nz,
  ({neg_zero x, pos_zero y} sub_float64) sub_nz_pz,
  ({neg_zero x, neg_zero y} sub_float64) sub_nz_nz,

  ({pos_inf x, pos_inf y}   sub_float64) sub_pinf_pinf,
  ({pos_inf x, neg_inf y}   sub_float64) sub_pinf_ninf,
  ({neg_inf x, pos_inf y}   sub_float64) sub_ninf_pinf,
  ({neg_inf x, neg_inf y}   sub_float64) sub_ninf_ninf,

  # --- mul_float64 -----------------------------------------------------------
  ({qnan x, pos_zero y}     mul_float64) mul_qnan_pz,
  ({pos_zero x, qnan y}     mul_float64) mul_pz_qnan,

  ({pos_inf x, pos_inf y}   mul_float64) mul_pinf_pinf,
  ({pos_inf x, neg_inf y}   mul_float64) mul_pinf_ninf,
  ({neg_inf x, pos_inf y}   mul_float64) mul_ninf_pinf,
  ({neg_inf x, neg_inf y}   mul_float64) mul_ninf_ninf,

  ({pos_inf x, pos_zero y}  mul_float64) mul_pinf_pz,
  ({pos_inf x, neg_zero y}  mul_float64) mul_pinf_nz,
  ({neg_inf x, pos_zero y}  mul_float64) mul_ninf_pz,
  ({neg_inf x, neg_zero y}  mul_float64) mul_ninf_nz,

  ({pos_zero x, pos_inf y}  mul_float64) mul_pz_pinf,
  ({neg_zero x, pos_inf y}  mul_float64) mul_nz_pinf,
  ({pos_zero x, neg_inf y}  mul_float64) mul_pz_ninf,
  ({neg_zero x, neg_inf y}  mul_float64) mul_nz_ninf,

  ({pos_zero x, pos_zero y} mul_float64) mul_pz_pz,
  ({pos_zero x, neg_zero y} mul_float64) mul_pz_nz,
  ({neg_zero x, pos_zero y} mul_float64) mul_nz_pz,
  ({neg_zero x, neg_zero y} mul_float64) mul_nz_nz,

  # --- div_float64 -----------------------------------------------------------
  ({qnan x, pos_zero y}     div_float64) div_qnan_pz,
  ({pos_zero x, qnan y}     div_float64) div_pz_qnan,

  ({pos_zero x, pos_zero y} div_float64) div_pz_pz,
  ({pos_zero x, neg_zero y} div_float64) div_pz_nz,
  ({neg_zero x, pos_zero y} div_float64) div_nz_pz,
  ({neg_zero x, neg_zero y} div_float64) div_nz_nz,

  ({pos_inf x, pos_inf y}   div_float64) div_pinf_pinf,
  ({pos_inf x, neg_inf y}   div_float64) div_pinf_ninf,
  ({neg_inf x, pos_inf y}   div_float64) div_ninf_pinf,
  ({neg_inf x, neg_inf y}   div_float64) div_ninf_ninf,

  ({pos_inf x, pos_zero y}  div_float64) div_pinf_pz,
  ({pos_inf x, neg_zero y}  div_float64) div_pinf_nz,
  ({neg_inf x, pos_zero y}  div_float64) div_ninf_pz,
  ({neg_inf x, neg_zero y}  div_float64) div_ninf_nz,

  ({pos_zero x, pos_inf y}  div_float64) div_pz_pinf,
  ({neg_zero x, pos_inf y}  div_float64) div_nz_pinf,
  ({pos_zero x, neg_inf y}  div_float64) div_pz_ninf,
  ({neg_zero x, neg_inf y}  div_float64) div_nz_ninf
}
