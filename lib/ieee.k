# --lib lib/bits.k --use push_bits3 push_bits4 take_byte take_nibble unpack16 trim inv inc inc_lsb dec cmp lt? plus minus twice tenfold
# --lib lib/list.k --use reverse
# --lib lib/string.k --use unicode[] string[] _0_ _1_ _2_ _3_ _4_ _5_ _6_ _7_ _8_ _9_ _minus_ _dot_ _I_ _n_ _f_ _i_ _t_ _y_ _N_ _a_ e_char E_char minus_char plus_char dot_char I_char n_char f_char i_char t_char y_char N_char a_char ws scan_digit digit c1023

-- lib/ieee.k — IEEE-754 binary64 floating-point (float64[]) and exact decimal conversion

---------------------------------------------------------------
-- §1. Base Patterns & Primitives
---------------------------------------------------------------

bit[]          = < {} 0, {} 1 >;
order[]        = < {} lt, {} eq, {} gt >;
bits[]         = < {} _, B 0, B 1 > = B;
list[X]        = < {} nil, { X car, L cdr } cons > = L;

digit_result[] = { bits[] value, string[] rest };

0     = {} |0 ?bit[];
1     = {} |1 ?bit[];
0?    = ?X /0 |0 ?X;
1?    = ?X /1 |1 ?X;
is0   = ?bit[] /0;
is1   = ?bit[] /1;
un_lt = ?order[] /lt;
un_eq = ?order[] /eq;
un_gt = ?order[] /gt;

_   = {} |_ ?bits[];
0b  = |0 ?bits[];
1b  = |1 ?bits[];
un_ = ?bits[] /_;
un0 = ?bits[] /0;
un1 = ?bits[] /1;
_?  = un_ _;
c1  = _ 1b;

nil    = {} |nil ?list[X];
cons   = |cons ?list[X];
un_nil = ?list[X] /nil;
car    = ?list[X] /cons .car;
cdr    = ?list[X] /cons .cdr;

---------------------------------------------------------------
-- §2. Patterns & Primitive Constructors/Destructors
---------------------------------------------------------------

sign[] = < {} "+", {} "-" >;

exp11[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3, bit[] 4,
  bit[] 5, bit[] 6, bit[] 7, bit[] 8, bit[] 9, bit[] 10
};

frac52[] = {
  bit[] 0,  bit[] 1,  bit[] 2,  bit[] 3,  bit[] 4,  bit[] 5,
  bit[] 6,  bit[] 7,  bit[] 8,  bit[] 9,  bit[] 10, bit[] 11,
  bit[] 12, bit[] 13, bit[] 14, bit[] 15, bit[] 16, bit[] 17,
  bit[] 18, bit[] 19, bit[] 20, bit[] 21, bit[] 22, bit[] 23,
  bit[] 24, bit[] 25, bit[] 26, bit[] 27, bit[] 28, bit[] 29,
  bit[] 30, bit[] 31, bit[] 32, bit[] 33, bit[] 34, bit[] 35,
  bit[] 36, bit[] 37, bit[] 38, bit[] 39, bit[] 40, bit[] 41,
  bit[] 42, bit[] 43, bit[] 44, bit[] 45, bit[] 46, bit[] 47,
  bit[] 48, bit[] 49, bit[] 50, bit[] 51
};

float64[] = { sign[] sign, exp11[] exponent, frac52[] fraction };

decimal[] = {
  string[] rest, bits[] n, bits[] d, bits[] count
};
result[] = { string[] rest, float64[] value };

digit_value[] = < {} 0, {} 1, {} 2, {} 3, {} 4, {} 5, {} 6, {} 7, {} 8, {} 9 >;
digits[]      = list[digit_value[]];
factor[]      = < {} 2, {} 5 >;

-- Primitive constructors and destructors
+    = {} |+ ?sign[];
-    = {} |- ?sign[];
un_+ = ?sign[] /+;
un_- = ?sign[] /-;

+? = un_+ +;
-? = un_- -;

d0 = {} |0 ?digit_value[];
d1 = {} |1 ?digit_value[];
d2 = {} |2 ?digit_value[];
d3 = {} |3 ?digit_value[];
d4 = {} |4 ?digit_value[];
d5 = {} |5 ?digit_value[];
d6 = {} |6 ?digit_value[];
d7 = {} |7 ?digit_value[];
d8 = {} |8 ?digit_value[];
d9 = {} |9 ?digit_value[];

un_d0 = ?digit_value[] /0;
un_d1 = ?digit_value[] /1;
un_d2 = ?digit_value[] /2;
un_d3 = ?digit_value[] /3;
un_d4 = ?digit_value[] /4;
un_d5 = ?digit_value[] /5;
un_d6 = ?digit_value[] /6;
un_d7 = ?digit_value[] /7;
un_d8 = ?digit_value[] /8;
un_d9 = ?digit_value[] /9;

f2    = {} |2 ?factor[];
f5    = {} |5 ?factor[];
un_f2 = ?factor[] /2;
un_f5 = ?factor[] /5;

---------------------------------------------------------------
-- §3. IEEE-754 Classification, Constants & Sign Operations
---------------------------------------------------------------

zero_exponent? = ?exp11[] {
  .0 0? 0, .1 0? 1, .2 0? 2, .3 0? 3, .4 0? 4, .5 0? 5,
  .6 0? 6, .7 0? 7, .8 0? 8, .9 0? 9, .10 0? 10
};

all_ones_exponent? = ?exp11[] {
  .0 1? 0, .1 1? 1, .2 1? 2, .3 1? 3, .4 1? 4, .5 1? 5,
  .6 1? 6, .7 1? 7, .8 1? 8, .9 1? 9, .10 1? 10
};

not_all_ones_exponent? = ?exp11[] {
  <.10 is0, .9 is0, .8 is0, .7 is0, .6 is0, .5 is0, .4 is0, .3 is0, .2 is0, .1 is0, .0 is0> if,
  () then
} .then;

zero_fraction? = ?frac52[] {
  .0 0? 0,   .1 0? 1,   .2 0? 2,   .3 0? 3,   .4 0? 4,   .5 0? 5,   .6 0? 6,   .7 0? 7,   .8 0? 8,   .9 0? 9,
  .10 0? 10, .11 0? 11, .12 0? 12, .13 0? 13, .14 0? 14, .15 0? 15, .16 0? 16, .17 0? 17, .18 0? 18, .19 0? 19,
  .20 0? 20, .21 0? 21, .22 0? 22, .23 0? 23, .24 0? 24, .25 0? 25, .26 0? 26, .27 0? 27, .28 0? 28, .29 0? 29,
  .30 0? 30, .31 0? 31, .32 0? 32, .33 0? 33, .34 0? 34, .35 0? 35, .36 0? 36, .37 0? 37, .38 0? 38, .39 0? 39,
  .40 0? 40, .41 0? 41, .42 0? 42, .43 0? 43, .44 0? 44, .45 0? 45, .46 0? 46, .47 0? 47, .48 0? 48, .49 0? 49,
  .50 0? 50, .51 0? 51
};

nonzero_fraction? = ?frac52[] {
  <.51 is1, .50 is1, .49 is1, .48 is1, .47 is1, .46 is1, .45 is1, .44 is1, .43 is1, .42 is1,
   .41 is1, .40 is1, .39 is1, .38 is1, .37 is1, .36 is1, .35 is1, .34 is1, .33 is1, .32 is1,
   .31 is1, .30 is1, .29 is1, .28 is1, .27 is1, .26 is1, .25 is1, .24 is1, .23 is1, .22 is1,
   .21 is1, .20 is1, .19 is1, .18 is1, .17 is1, .16 is1, .15 is1, .14 is1, .13 is1, .12 is1,
   .11 is1, .10 is1, .9 is1, .8 is1, .7 is1, .6 is1, .5 is1, .4 is1, .3 is1, .2 is1, .1 is1, .0 is1> if,
  () then
} .then;

nan_float64? = ?float64[] {
  .sign sign, .exponent all_ones_exponent? exponent, .fraction nonzero_fraction? fraction
};

inf_float64? = ?float64[] {
  .sign sign, .exponent all_ones_exponent? exponent, .fraction zero_fraction? fraction
};

finite_float64? = ?float64[] {
  .sign sign, .exponent not_all_ones_exponent? exponent, .fraction fraction
};

zero_float64? = ?float64[] {
  .sign sign, .exponent zero_exponent? exponent, .fraction zero_fraction? fraction
};

exp0     = { 0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10 };
exp_all1 = { 1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10 };

frac0 = {
  0 0,  0 1,  0 2,  0 3,  0 4,  0 5,  0 6,  0 7,  0 8,  0 9,  0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
  0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
  0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
  0 48, 0 49, 0 50, 0 51
};

frac_lsb1 = {
  1 0,  0 1,  0 2,  0 3,  0 4,  0 5,  0 6,  0 7,  0 8,  0 9,  0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
  0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
  0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
  0 48, 0 49, 0 50, 0 51
};

pos_zero = { + sign, exp0 exponent, frac0 fraction };
neg_zero = { - sign, exp0 exponent, frac0 fraction };
pos_inf  = { + sign, exp_all1 exponent, frac0 fraction };
neg_inf  = { - sign, exp_all1 exponent, frac0 fraction };
qnan     = { + sign, exp_all1 exponent, frac_lsb1 fraction };

flip_sign = < un_+ -, un_- + >;

negate_float64 = ?float64[]
  { .sign flip_sign sign, .exponent exponent, .fraction fraction };

---------------------------------------------------------------
-- §4. Exact Decimal Parsing & Natural-to-Float64 Conversion
---------------------------------------------------------------

exp_field = unpack16 {
  .lo.0 0, .lo.1 1, .lo.2 2, .lo.3 3, .lo.4 4, .lo.5 5, .lo.6 6, .lo.7 7,
  .hi.0 8, .hi.1 9, .hi.2 10
};

mantissa = take_byte { .byte b0, .rest take_byte tail }
  { .b0 b0, .tail.byte b1, .tail.rest take_byte tail }
  { .b0 b0, .b1 b1, .tail.byte b2, .tail.rest take_byte tail }
  { .b0 b0, .b1 b1, .b2 b2, .tail.byte b3, .tail.rest take_byte tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .tail.byte b4, .tail.rest take_byte tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .tail.byte b5, .tail.rest take_nibble tail }
  { {
    .b0.0 0,  .b0.1 1,  .b0.2 2,  .b0.3 3,
    .b0.4 4,  .b0.5 5,  .b0.6 6,  .b0.7 7,
    .b1.0 8,  .b1.1 9,  .b1.2 10, .b1.3 11,
    .b1.4 12, .b1.5 13, .b1.6 14, .b1.7 15,
    .b2.0 16, .b2.1 17, .b2.2 18, .b2.3 19,
    .b2.4 20, .b2.5 21, .b2.6 22, .b2.7 23,
    .b3.0 24, .b3.1 25, .b3.2 26, .b3.3 27,
    .b3.4 28, .b3.5 29, .b3.6 30, .b3.7 31,
    .b4.0 32, .b4.1 33, .b4.2 34, .b4.3 35,
    .b4.4 36, .b4.5 37, .b4.6 38, .b4.7 39,
    .b5.0 40, .b5.1 41, .b5.2 42, .b5.3 43,
    .b5.4 44, .b5.5 45, .b5.6 46, .b5.7 47,
    .tail.byte.0 48, .tail.byte.1 49, .tail.byte.2 50, .tail.byte.3 51
  } fraction, .tail.rest lead };

c52   = _ 0b 0b 1b 0b 1b 1b;
c400  = _ 0b 0b 0b 0b 1b 0b 0b 1b 1b;
c2047 = _ 1b 1b 1b 1b 1b 1b 1b 1b 1b 1b 1b;

integer_digits = ?decimal[] <
  { .rest scan_digit digit, () decimal } {
    .digit.rest rest,
    { .decimal.n tenfold x, .digit.value y } plus n,
    .decimal.d d, .decimal.count inc count
  } integer_digits,
  ()
>;

fraction_first = ?decimal[] {
  .rest dot_char scan_digit digit, () decimal
} {
  .digit.rest rest,
  { .decimal.n tenfold x, .digit.value y } plus n,
  .decimal.d tenfold d, .decimal.count inc count
};

fraction_digits = ?decimal[] <
  { .rest scan_digit digit, () decimal } {
    .digit.rest rest,
    { .decimal.n tenfold x, .digit.value y } plus n,
    .decimal.d tenfold d, .decimal.count inc count
  } fraction_digits,
  ()
>;

unsigned_decimal = scan_digit {
  .rest rest, .value n, c1 d, c1 count
} <
  { .n un_ if, () then } .then,
  integer_digits
> < fraction_first fraction_digits, () >;

exponent_digits = ?digit_result[] <
  { .rest scan_digit next, .value tenfold high }
  { .next.rest rest, { .high x, .next.value y } plus value }
    exponent_digits,
  ()
>;

exponent_part = < e_char, E_char > <
  minus_char { () rest, - sign },
  plus_char { () rest, + sign },
  { () rest, + sign }
> { .rest scan_digit exponent_digits digits, .sign sign }
  { .digits.rest rest, .digits.value value, .sign sign };

signed_zero = { .sign sign, exp0 exponent, frac0 fraction };

scale_decimal = <
  { .power un_ a, .direction <un_+, un_-> b, { .n n, .d d } then } .then,
  <
    { .n tenfold n, .d d, .power dec power, .direction +? direction },
    { .n n, .d tenfold d, .power dec power, .direction -? direction }
  > scale_decimal
>;

ratio_less? = { .n x, .d y } lt?;

round = {
  () state, { .n twice x, .d y } cmp order
} {
  .state.exponent exponent,
  <
    { .order un_gt if, .state.acc inc_lsb then } .then,
    { .order un_eq a, .state.acc un1 b, .state.acc inc_lsb then } .then,
    .state.acc
  > mantissa mantissa
} {
  .mantissa.fraction fraction,
  <
    { .exponent un_ a, .mantissa.lead un1 b, c1 then } .then,
    { .mantissa.lead un0 un1 un_ if, .exponent inc then } .then,
    .exponent
  > exponent
} {
  () fields,
  { .exponent x, c2047 y } cmp order
} <
  { .order un_lt if, { .fields.exponent exp_field exponent, .fields.fraction fraction } then } .then,
  { exp_all1 exponent, frac0 fraction }
>;

fraction_loop = <
  { .left un_ if, round then } .then,
  { .n twice n, .d d, .exponent exponent, .acc acc, .left dec left } <
    {
      { .n x, .d y } lt? .x n,
      .d d, .exponent exponent, .acc 0b acc, .left left
    },
    {
      { .n x, .d y } minus n,
      .d d, .exponent exponent, .acc 1b acc, .left left
    }
  > fraction_loop
>;

normalized = <
  {
    ratio_less? if,
    .exponent un1 un_ and,
    { .n n, .d d, _ exponent, _ acc, c52 left } fraction_loop then
  } .then,
  {
    ratio_less? if,
    {
      { .n twice x, .d y } minus n,
      .d d, .exponent dec exponent, c1 acc, c52 left
    } fraction_loop then
  } .then,
  {
    { .n x, .d y } minus n,
    .d d, .exponent exponent, c1 acc, c52 left
  } fraction_loop
>;

align_down = <
  {
    .steps un_ if,
    { .n n, .denominator inv d, .exponent exponent } normalized then
  } .then,
  {
    .exponent un1 un1 un1 un1 un1 un1 un1 un1 un1 un1 un1 un_ if,
    { exp_all1 exponent, frac0 fraction } then
  } .then,
  { .n n, .denominator 0b denominator, .steps <un0, un1> steps, .exponent inc exponent } align_down
>;

align_up = <
  {
    < .steps un_, .exponent un1 un_ > if,
    { .numerator inv n, .d d, .exponent exponent } normalized then
  } .then,
  { .numerator 0b numerator, .d d, .steps <un0, un1> steps, .exponent dec exponent } align_up
>;

align = <
  { .x un_ a, .y un_ b, { .n n, .d d, .exponent exponent } normalized then } .then,
  {
    .y un_ if,
    { .n n, .d inv denominator, .x steps, .exponent exponent } align_down then
  } .then,
  {
    .x un_ if,
    { .n inv numerator, .d d, .y steps, .exponent exponent } align_up then
  } .then,
  { .n n, .d d, .x <un0, un1> x, .y <un0, un1> y, .exponent exponent } align
>;

ratio = {
  .n n, .d d, .n x, .d y, c1023 exponent
} align;

decimal_float = <
  { .n un_ if, signed_zero then } .then,
  {
    () decimal,
    { .exponent.value x, { .count x, c400 y } plus y } cmp order
  } <
    {
      .order un_gt a, .decimal.exponent.sign un_- b,
      .decimal signed_zero then
    } .then,
    {
      .order un_gt a, .decimal.exponent.sign un_+ b,
      { .decimal.sign sign, exp_all1 exponent, frac0 fraction } then
    } .then,
    {
      .order <un_lt, un_eq> if,
      {
        {
          .decimal.n n, .decimal.d d,
          .decimal.exponent.value power, .decimal.exponent.sign direction
        } scale_decimal ratio fields,
        .decimal.sign sign
      } { .sign sign, .fields.exponent exponent, .fields.fraction fraction } then
    } .then
  >
>;

signed_decimal = {
  .rest unsigned_decimal decimal, .sign sign
} {
  .decimal decimal, .sign sign,
  < .decimal.rest exponent_part, { .decimal.rest rest, _ value, + sign } > exponent
} {
  .exponent.rest rest,
  {
    .decimal.n n, .decimal.d d, .decimal.count count,
    .sign sign, .exponent exponent
  } decimal_float value
};

number = <
  minus_char { () rest, - sign },
  { () rest, + sign }
> signed_decimal;

infinity_word = I_char n_char f_char i_char n_char i_char t_char y_char;
nan_word      = N_char a_char N_char;

special = <
  minus_char infinity_word { () rest, neg_inf value },
  plus_char infinity_word { () rest, pos_inf value },
  infinity_word { () rest, pos_inf value },
  < minus_char, plus_char, ?string[] > nan_word { () rest, qnan value }
>;

scanFloat64 = <
  plus_char { () rest, + sign } signed_decimal,
  number,
  special
>;

parseFloat64 = ws scanFloat64 {
  .rest ws un_nil end, .value value
} .value;

natToFloat64 = trim <
  un_ pos_zero,
  { () n, c1 d } ratio { + sign, .exponent exponent, .fraction fraction }
>;

---------------------------------------------------------------
-- §5. Exact Decimal Printing
---------------------------------------------------------------

zero_text          = { _0_ car, nil cdr } cons;
negative_zero_text = { _minus_ car, zero_text cdr } cons;
infinity_text = {
  _I_ car, { _n_ car, { _f_ car, { _i_ car, {
    _n_ car, { _i_ car, { _t_ car, { _y_ car, nil cdr } cons cdr } cons cdr } cons cdr
  } cons cdr } cons cdr } cons cdr } cons cdr
} cons;
negative_infinity_text = { _minus_ car, infinity_text cdr } cons;
nan_text = { _N_ car, { _a_ car, { _N_ car, nil cdr } cons cdr } cons cdr } cons;

c1074 = _ 0b 1b 0b 0b 1b 1b 0b 0b 0b 0b 1b;
c1075 = _ 1b 1b 0b 0b 1b 1b 0b 0b 0b 0b 1b;

exponent_bits = { () source, _ acc }
  { .source source,
    { { .source.0 0, .source.1 1, .source.2 2, .source.3 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.4 0, .source.5 1, .source.6 2, .source.7 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.8 0, .source.9 1, .source.10 2 } x, .acc acc } push_bits3 acc
  }
  .acc;

fraction_bits = { () source, _ acc }
  { .source source,
    { { .source.0 0, .source.1 1, .source.2 2, .source.3 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.4 0, .source.5 1, .source.6 2, .source.7 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.8 0, .source.9 1, .source.10 2, .source.11 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.12 0, .source.13 1, .source.14 2, .source.15 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.16 0, .source.17 1, .source.18 2, .source.19 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.20 0, .source.21 1, .source.22 2, .source.23 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.24 0, .source.25 1, .source.26 2, .source.27 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.28 0, .source.29 1, .source.30 2, .source.31 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.32 0, .source.33 1, .source.34 2, .source.35 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.36 0, .source.37 1, .source.38 2, .source.39 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.40 0, .source.41 1, .source.42 2, .source.43 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.44 0, .source.45 1, .source.46 2, .source.47 3 } x, .acc acc } push_bits4 acc
  }
  { .source source,
    { { .source.48 0, .source.49 1, .source.50 2, .source.51 3 } x, .acc acc } push_bits4 acc
  }
  .acc;

digit_ascii = <
  un_d0 _0_, un_d1 _1_, un_d2 _2_, un_d3 _3_, un_d4 _4_,
  un_d5 _5_, un_d6 _6_, un_d7 _7_, un_d8 _8_, un_d9 _9_
>;

digit_mul2 = <
  { .digit un_d0 a, .carry un_d0 b } { d0 digit, d0 carry },
  { .digit un_d0 a, .carry un_d1 b } { d1 digit, d0 carry },
  { .digit un_d1 a, .carry un_d0 b } { d2 digit, d0 carry },
  { .digit un_d1 a, .carry un_d1 b } { d3 digit, d0 carry },
  { .digit un_d2 a, .carry un_d0 b } { d4 digit, d0 carry },
  { .digit un_d2 a, .carry un_d1 b } { d5 digit, d0 carry },
  { .digit un_d3 a, .carry un_d0 b } { d6 digit, d0 carry },
  { .digit un_d3 a, .carry un_d1 b } { d7 digit, d0 carry },
  { .digit un_d4 a, .carry un_d0 b } { d8 digit, d0 carry },
  { .digit un_d4 a, .carry un_d1 b } { d9 digit, d0 carry },
  { .digit un_d5 a, .carry un_d0 b } { d0 digit, d1 carry },
  { .digit un_d5 a, .carry un_d1 b } { d1 digit, d1 carry },
  { .digit un_d6 a, .carry un_d0 b } { d2 digit, d1 carry },
  { .digit un_d6 a, .carry un_d1 b } { d3 digit, d1 carry },
  { .digit un_d7 a, .carry un_d0 b } { d4 digit, d1 carry },
  { .digit un_d7 a, .carry un_d1 b } { d5 digit, d1 carry },
  { .digit un_d8 a, .carry un_d0 b } { d6 digit, d1 carry },
  { .digit un_d8 a, .carry un_d1 b } { d7 digit, d1 carry },
  { .digit un_d9 a, .carry un_d0 b } { d8 digit, d1 carry },
  { .digit un_d9 a, .carry un_d1 b } { d9 digit, d1 carry }
>;

digit_mul5 = <
  { .digit un_d0 a, .carry un_d0 b } { d0 digit, d0 carry },
  { .digit un_d0 a, .carry un_d1 b } { d1 digit, d0 carry },
  { .digit un_d0 a, .carry un_d2 b } { d2 digit, d0 carry },
  { .digit un_d0 a, .carry un_d3 b } { d3 digit, d0 carry },
  { .digit un_d0 a, .carry un_d4 b } { d4 digit, d0 carry },
  { .digit un_d1 a, .carry un_d0 b } { d5 digit, d0 carry },
  { .digit un_d1 a, .carry un_d1 b } { d6 digit, d0 carry },
  { .digit un_d1 a, .carry un_d2 b } { d7 digit, d0 carry },
  { .digit un_d1 a, .carry un_d3 b } { d8 digit, d0 carry },
  { .digit un_d1 a, .carry un_d4 b } { d9 digit, d0 carry },
  { .digit un_d2 a, .carry un_d0 b } { d0 digit, d1 carry },
  { .digit un_d2 a, .carry un_d1 b } { d1 digit, d1 carry },
  { .digit un_d2 a, .carry un_d2 b } { d2 digit, d1 carry },
  { .digit un_d2 a, .carry un_d3 b } { d3 digit, d1 carry },
  { .digit un_d2 a, .carry un_d4 b } { d4 digit, d1 carry },
  { .digit un_d3 a, .carry un_d0 b } { d5 digit, d1 carry },
  { .digit un_d3 a, .carry un_d1 b } { d6 digit, d1 carry },
  { .digit un_d3 a, .carry un_d2 b } { d7 digit, d1 carry },
  { .digit un_d3 a, .carry un_d3 b } { d8 digit, d1 carry },
  { .digit un_d3 a, .carry un_d4 b } { d9 digit, d1 carry },
  { .digit un_d4 a, .carry un_d0 b } { d0 digit, d2 carry },
  { .digit un_d4 a, .carry un_d1 b } { d1 digit, d2 carry },
  { .digit un_d4 a, .carry un_d2 b } { d2 digit, d2 carry },
  { .digit un_d4 a, .carry un_d3 b } { d3 digit, d2 carry },
  { .digit un_d4 a, .carry un_d4 b } { d4 digit, d2 carry },
  { .digit un_d5 a, .carry un_d0 b } { d5 digit, d2 carry },
  { .digit un_d5 a, .carry un_d1 b } { d6 digit, d2 carry },
  { .digit un_d5 a, .carry un_d2 b } { d7 digit, d2 carry },
  { .digit un_d5 a, .carry un_d3 b } { d8 digit, d2 carry },
  { .digit un_d5 a, .carry un_d4 b } { d9 digit, d2 carry },
  { .digit un_d6 a, .carry un_d0 b } { d0 digit, d3 carry },
  { .digit un_d6 a, .carry un_d1 b } { d1 digit, d3 carry },
  { .digit un_d6 a, .carry un_d2 b } { d2 digit, d3 carry },
  { .digit un_d6 a, .carry un_d3 b } { d3 digit, d3 carry },
  { .digit un_d6 a, .carry un_d4 b } { d4 digit, d3 carry },
  { .digit un_d7 a, .carry un_d0 b } { d5 digit, d3 carry },
  { .digit un_d7 a, .carry un_d1 b } { d6 digit, d3 carry },
  { .digit un_d7 a, .carry un_d2 b } { d7 digit, d3 carry },
  { .digit un_d7 a, .carry un_d3 b } { d8 digit, d3 carry },
  { .digit un_d7 a, .carry un_d4 b } { d9 digit, d3 carry },
  { .digit un_d8 a, .carry un_d0 b } { d0 digit, d4 carry },
  { .digit un_d8 a, .carry un_d1 b } { d1 digit, d4 carry },
  { .digit un_d8 a, .carry un_d2 b } { d2 digit, d4 carry },
  { .digit un_d8 a, .carry un_d3 b } { d3 digit, d4 carry },
  { .digit un_d8 a, .carry un_d4 b } { d4 digit, d4 carry },
  { .digit un_d9 a, .carry un_d0 b } { d5 digit, d4 carry },
  { .digit un_d9 a, .carry un_d1 b } { d6 digit, d4 carry },
  { .digit un_d9 a, .carry un_d2 b } { d7 digit, d4 carry },
  { .digit un_d9 a, .carry un_d3 b } { d8 digit, d4 carry },
  { .digit un_d9 a, .carry un_d4 b } { d9 digit, d4 carry }
>;

digits_multiply_loop = <
  { .x un_nil a, .carry un_d0 b, .acc reverse then } .then,
  { .x un_nil if, { .carry car, .acc cdr } cons reverse then } .then,
  {
    .x cdr x, .factor factor, .acc acc,
    { .x car digit, .carry carry, .factor factor } <
      { .factor un_f2 if, { .digit digit, .carry carry } digit_mul2 then } .then,
      { .factor un_f5 if, { .digit digit, .carry carry } digit_mul5 then } .then
    > next
  } { .x x, .factor factor, .next.carry carry, { .next.digit car, .acc cdr } cons acc }
    digits_multiply_loop
>;

digits_multiply = {
  .digits x, .factor factor, .carry carry, nil acc
} digits_multiply_loop;

binary_digits_loop = <
  { .bits un_ if, .digits then } .then,
  <
    { .bits un0 bits, { .digits digits, f2 factor, d0 carry } digits_multiply digits },
    { .bits un1 bits, { .digits digits, f2 factor, d1 carry } digits_multiply digits }
  > binary_digits_loop
>;

binary_digits = {
  () bits, { d0 car, nil cdr } cons digits
} binary_digits_loop;

digits_power = <
  { .steps un_ if, .digits then } .then,
  {
    { .digits digits, .factor factor, d0 carry } digits_multiply digits,
    .factor factor,
    .steps dec steps
  } digits_power
>;

cancel_twos = <
  { < .places un_, .reversed <un1 {}, un_> > if, { .reversed reversed, .places places } then } .then,
  { .reversed un0 reversed, .places dec places } cancel_twos
>;

fraction_digits_print = cancel_twos {
  .reversed inv trim binary_digits digits,
  f5 factor, .places steps, .places places
} { { .digits digits, .factor factor, .steps steps } digits_power digits, .places places };

print_ratio = ?float64[] {
  .fraction fraction_bits fraction,
  .exponent exponent_bits trim exponent
} <
  {
    .exponent un_ if,
    { .fraction inv reversed, c1074 places } fraction_digits_print then
  } .then,
  {
    { .exponent x, c1075 y } lt? if,
    { .fraction 1b inv reversed,
      { c1075 x, .exponent y } minus places } fraction_digits_print then
  } .then,
  {
    .fraction 1b binary_digits digits, f2 factor,
    { .exponent x, c1075 y } minus steps
  } digits_power { () digits, _ places }
>;

fraction_text = <
  { .places un_ if, { .digits digits, .acc acc } then } .then,
  {
    < .digits cdr, .digits un_nil nil > digits,
    .places dec places,
    { < .digits car, .digits un_nil d0 > digit_ascii car, .acc cdr } cons acc
  } fraction_text
>;

integer_text_loop = <
  { .digits un_nil if, .acc then } .then,
  {
    .digits cdr digits,
    { .digits car digit_ascii car, .acc cdr } cons acc
  } integer_text_loop
>;

integer_text = <
  { .digits un_nil if, { _0_ car, .acc cdr } cons then } .then,
  integer_text_loop
>;

format_decimal = <
  { .places un_ if, { .digits digits, nil acc } integer_text then } .then,
  { .digits digits, .places places, nil acc } fraction_text
  { .digits digits, { _dot_ car, .acc cdr } cons acc } integer_text
>;

printFloat64 = ?float64[] <
  nan_float64? nan_text,
  { inf_float64? if, .sign un_- and, negative_infinity_text then } .then,
  inf_float64? infinity_text,
  { zero_float64? if, .sign un_- and, negative_zero_text then } .then,
  zero_float64? zero_text,
  { () value, print_ratio format_decimal text } <
    { .value.sign un_- if, { _minus_ car, .text cdr } cons then } .then,
    .text
  >
>;
