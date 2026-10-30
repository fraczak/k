-- IEEE binary64 types and text conversion. Load core.k first.
-- Arithmetic operations live in ieee-arithmetics.k.

bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[];
bits[] = @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb[];
unicode[] = @AhRir67FipnHnJfDU7fSQ3Xhcg6BTJYwtq6HGsWwZtbi[];
string[] = @Pt3MwQwzUPxQKu58zXR3qUBHWTzfycx5bSZGzcK6EZQK[];

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

-- Parse one complete decimal spelling, optionally prefixed by + or -, or
-- Infinity/NaN. Decimal syntax otherwise follows JSON. Overflow becomes
-- infinity; NaN spellings use one canonical payload.
parseFloat64 = ?string[] _ieee_ws scanFloat64 {
  .rest _ieee_ws /nil end, .value value
} .value ?float64[];

-- Prefix scanner shared with the JSON parser, which applies finite_float64?.
scanFloat64 = ?string[] < _ieee_plus _ieee_number, _ieee_number, _ieee_special > ?_ieee_result[];
natToFloat64 = ?bits[] _ieee_trim <
  /_ pos_zero,
  { () n, _ieee_one d } _ieee_ratio { + sign, .exponent exponent, .fraction fraction }
> ?float64[];

-- Print an exact decimal expansion (no shortest-format rounding). Signed zero
-- and infinities retain their signs; every NaN prints the canonical word NaN.
printFloat64 = ?float64[] <
  nan_float64? _ieee_nan_text,
  { inf_float64? if, .sign /- and, _ieee_negative_infinity_text then } .then,
  inf_float64? _ieee_infinity_text,
  { zero_float64? if, .sign /- and, _ieee_negative_zero_text then } .then,
  zero_float64? _ieee_zero_text,
  { () value, _ieee_print_ratio _ieee_format_decimal text } <
    { .value.sign /- if, { _ieee_minus_char car, .text cdr } |cons then } .then,
    .text
  >
> ?string[];

_ieee_nil = {} |nil;
_ieee_ws = ?string[] <
  < _ieee_space, _ieee_tab, _ieee_lf, _ieee_cr > _ieee_ws,
  ()
> ?string[];

-- Small constructors and classification filters.
0 = {} |0 ;

1 = {} |1 ;

+ = {} |+ ;

- = {} |- ;

0? =  {/0 if, () then} .then ;

1? =  {/1 if, () then} .then ;

+? =  {/+ if, () then} .then ;

-? =  {/- if, () then} .then ;

zero_exponent? =
  {.0 0? if0, .1 0? if1, .2 0? if2, .3 0? if3, .4 0? if4, .5 0? if5, .6 0? if6, .7 0? if7, .8 0? if8, .9 0? if9, .10 0? if10, () then} .then
  ;

all_ones_exponent? =
  {.0 1? if0, .1 1? if1, .2 1? if2, .3 1? if3, .4 1? if4, .5 1? if5, .6 1? if6, .7 1? if7, .8 1? if8, .9 1? if9, .10 1? if10, () then} .then
  ;

not_all_ones_exponent? =
  {<.10 0?, .9 0?, .8 0?, .7 0?, .6 0?, .5 0?, .4 0?, .3 0?, .2 0?, .1 0?, .0 0?> if, () then} .then
  ;

zero_fraction? =
  {.51 0? if51, .50 0? if50, .49 0? if49, .48 0? if48, .47 0? if47, .46 0? if46, .45 0? if45, .44 0? if44, .43 0? if43, .42 0? if42,
   .41 0? if41, .40 0? if40, .39 0? if39, .38 0? if38, .37 0? if37, .36 0? if36, .35 0? if35, .34 0? if34, .33 0? if33, .32 0? if32,
   .31 0? if31, .30 0? if30, .29 0? if29, .28 0? if28, .27 0? if27, .26 0? if26, .25 0? if25, .24 0? if24, .23 0? if23, .22 0? if22,
   .21 0? if21, .20 0? if20, .19 0? if19, .18 0? if18, .17 0? if17, .16 0? if16, .15 0? if15, .14 0? if14, .13 0? if13, .12 0? if12,
   .11 0? if11, .10 0? if10, .9 0? if9, .8 0? if8, .7 0? if7, .6 0? if6, .5 0? if5, .4 0? if4, .3 0? if3, .2 0? if2, .1 0? if1, .0 0? if0,
   () then} .then
  ;

nonzero_fraction? =
  {<.51 1?, .50 1?, .49 1?, .48 1?, .47 1?, .46 1?, .45 1?, .44 1?, .43 1?, .42 1?,
    .41 1?, .40 1?, .39 1?, .38 1?, .37 1?, .36 1?, .35 1?, .34 1?, .33 1?, .32 1?,
    .31 1?, .30 1?, .29 1?, .28 1?, .27 1?, .26 1?, .25 1?, .24 1?, .23 1?, .22 1?,
    .21 1?, .20 1?, .19 1?, .18 1?, .17 1?, .16 1?, .15 1?, .14 1?, .13 1?, .12 1?,
    .11 1?, .10 1?, .9 1?, .8 1?, .7 1?, .6 1?, .5 1?, .4 1?, .3 1?, .2 1?, .1 1?, .0 1?> if, () then} .then
  ;

nan_float64? =
  {.exponent all_ones_exponent? ife, .fraction nonzero_fraction? iff, () then} .then
  ;

inf_float64? =
  {.exponent all_ones_exponent? ife, .fraction zero_fraction? iff, () then} .then
  ;

finite_float64? =
  {.exponent not_all_ones_exponent? ife, () then} .then
  ;

zero_float64? =
  {.exponent zero_exponent? ife, .fraction zero_fraction? iff, () then} .then
  ;

exp0 = {} {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10} ;

exp_all1 = {} {1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} ;

frac0 = {} {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
            0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
            0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
            0 48, 0 49, 0 50, 0 51} ;

frac_lsb1 = {} {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
                0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
                0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
                0 48, 0 49, 0 50, 0 51} ;

pos_zero = {} {+ sign, exp0 exponent, frac0 fraction} ;

neg_zero = {} {- sign, exp0 exponent, frac0 fraction} ;

pos_inf  = {} {+ sign, exp_all1 exponent, frac0 fraction} ;

neg_inf  = {} {- sign, exp_all1 exponent, frac0 fraction} ;

qnan = {} {+ sign, exp_all1 exponent, frac_lsb1 fraction} ;

flip_sign =
  <
    {+? if, {} |-  then} .then,
    {-? if, {} |+  then} .then
  > ;

negate_float64 =
  {.sign flip_sign sign, .exponent exponent, .fraction fraction}
  ;

-- Exact decimal parsing and shared bit helpers.
_ieee_nat_pair[] = { bits[] x, bits[] y };
_ieee_order[] = < {} lt, {} eq, {} gt >;
_ieee_decimal[] = {
  string[] rest, bits[] n, bits[] d, bits[] count, sign[] sign
};
_ieee_result[] = { string[] rest, float64[] value };

_ieee_zero = {} | _;

_ieee_push_bit = ?{ < {} 0, {} 1 > b, < {} _, BITS 0, BITS 1 >=BITS acc } <
  { .b /0 if, .acc |0 then } .then,
  { .b /1 if, .acc |1 then } .then
> ?bits[];

_ieee_push_bits1 = { .x .0 b, .acc acc } _ieee_push_bit;

_ieee_push_bits2 = { .x .1 b, { .x x, .acc acc } _ieee_push_bits1 acc } _ieee_push_bit;

_ieee_push_bits3 = { .x .2 b, { .x x, .acc acc } _ieee_push_bits2 acc } _ieee_push_bit;

_ieee_push_bits4 = { .x .3 b, { .x x, .acc acc } _ieee_push_bits3 acc } _ieee_push_bit;

_ieee_push_bits5 = { .x .4 b, { .x x, .acc acc } _ieee_push_bits4 acc } _ieee_push_bit;

_ieee_push_bits6 = { .x .5 b, { .x x, .acc acc } _ieee_push_bits5 acc } _ieee_push_bit;

_ieee_push_bits7 = { .x .6 b, { .x x, .acc acc } _ieee_push_bits6 acc } _ieee_push_bit;

_ieee_inv = ?{ < {} _, B 0, B 1 >=B x, B r } <
  { .x /_ if, .r then } .then,
  { .x /0 x, .r |0 r } _ieee_inv,
  { .x /1 x, .r |1 r } _ieee_inv
> ?bits[];

_ieee_inc_loop = ?{ < {} _, B 0, B 1 >=B x, B y } <
  { .x /_ if, .y |1 then } .then,
  { .x /0 x, .y |1 r } _ieee_inv,
  { .x /1 x, .y |0 y } _ieee_inc_loop
> ?bits[];

_ieee_nat_inc = { { () x, _ieee_zero r } _ieee_inv x, _ieee_zero y } _ieee_inc_loop;

_ieee_half_adder = <
  { .a /0 a, .c_in /0 c_in } { 0 sum, 0 carry },
  { .a /0 a, .c_in /1 c_in } { 1 sum, 0 carry },
  { .a /1 a, .c_in /0 c_in } { 1 sum, 0 carry },
  { .a /1 a, .c_in /1 c_in } { 0 sum, 1 carry }
>;

_ieee_trim = ?bits[] <
  /0 /0 /0 /0 /0 /0 /0 /0 _ieee_trim,
  /0 _ieee_trim, ()
> ?bits[];

_ieee_one = _ieee_zero |1;

_ieee_twice = _ieee_reverse_bits |0 _ieee_reverse_bits _ieee_trim;

_ieee_tenfold = { _ieee_twice x, _ieee_twice _ieee_twice _ieee_twice y } _ieee_add;

_ieee_lsb = ?bits[] <
  /0 { 0 bit, () rest },
  /1 { 1 bit, () rest },
  /_ { 0 bit, _ieee_zero rest }
>;

_ieee_reverse_bits = { () x, _ieee_zero acc } _ieee_reverse_bits_loop;

_ieee_reverse_bits_step = ?{ bits[] x, bits[] acc } <
  { .x /0 x, .acc |0 acc }, { .x /1 x, .acc |1 acc }
>;

_ieee_reverse_bits8 =
  _ieee_reverse_bits_step _ieee_reverse_bits_step _ieee_reverse_bits_step _ieee_reverse_bits_step
  _ieee_reverse_bits_step _ieee_reverse_bits_step _ieee_reverse_bits_step _ieee_reverse_bits_step;

_ieee_reverse_bits_loop = ?{ bits[] x, bits[] acc } <
  { .x /_ if, .acc then } .then,
  < _ieee_reverse_bits8, _ieee_reverse_bits_step > _ieee_reverse_bits_loop
> ?bits[];

_ieee_pair_step = ?_ieee_nat_pair[] { .x </0, /1> x, .y </0, /1> y };

_ieee_pair8 =
  _ieee_pair_step _ieee_pair_step _ieee_pair_step _ieee_pair_step
  _ieee_pair_step _ieee_pair_step _ieee_pair_step _ieee_pair_step;

_ieee_width = ?_ieee_nat_pair[] <
  { .x /_ a, .y /_ b } {} |eq,
  { .x /_ if, {} |lt then } .then,
  { .y /_ if, {} |gt then } .then,
  < _ieee_pair8, _ieee_pair_step > _ieee_width
> ?_ieee_order[];

_ieee_lex = ?_ieee_nat_pair[] <
  { .x /_ a, .y /_ b } {} |eq,
  { .x /0 a, .y /1 b } {} |lt,
  { .x /1 a, .y /0 b } {} |gt,
  < _ieee_lex8, _ieee_lex_step > _ieee_lex
> ?_ieee_order[];

_ieee_lex_step = ?_ieee_nat_pair[] <
  { .x /0 x, .y /0 y }, { .x /1 x, .y /1 y }
>;

_ieee_lex8 =
  _ieee_lex_step _ieee_lex_step _ieee_lex_step _ieee_lex_step
  _ieee_lex_step _ieee_lex_step _ieee_lex_step _ieee_lex_step;

_ieee_cmp = ?_ieee_nat_pair[] { () pair, _ieee_width order } <
  { .order /eq if, .pair _ieee_lex then } .then,
  .order
>;

_ieee_lt = { _ieee_cmp /lt if, () then } .then;

_ieee_add_bit = {
  { .a a, .carry c_in } _ieee_half_adder first,
  .b b
} {
  { .first.sum a, .b c_in } _ieee_half_adder second,
  .first.carry carry
} {
  .second.sum bit,
  < .carry /1 1, .second.carry > carry
};

_ieee_add = ?_ieee_nat_pair[] {
  .x _ieee_reverse_bits x, .y _ieee_reverse_bits y, 0 carry, _ieee_zero acc
} _ieee_add_loop;

_ieee_add_loop = ?{ bits[] x, bits[] y, bit[] carry, bits[] acc } <
  {
    .x /_ a, .y /_ b,
    < { .carry /0 if, .acc then } .then, .acc |1 > _ieee_trim then
  } .then,
  < _ieee_add8, _ieee_add_step > _ieee_add_loop
> ?bits[];

_ieee_add_step = ?{ bits[] x, bits[] y, bit[] carry, bits[] acc } {
  < .x /0, .x /1, .y /0, .y /1 > if,
  { .x _ieee_lsb x, .y _ieee_lsb y, .carry carry, .acc acc } then
} .then
  {
    .x.rest x, .y.rest y, .acc acc,
    { .x.bit a, .y.bit b, .carry carry } _ieee_add_bit sum
  }
  {
    .x x, .y y, .sum.carry carry,
    < { .sum.bit /0 if, .acc |0 then } .then, .acc |1 > acc
  };

_ieee_add8 =
  _ieee_add_step _ieee_add_step _ieee_add_step _ieee_add_step
  _ieee_add_step _ieee_add_step _ieee_add_step _ieee_add_step;

_ieee_sub_bit = <
  { .a /0 a, .b /0 b, .borrow /0 c } { 0 bit, 0 borrow },
  { .a /0 a, .b /0 b, .borrow /1 c } { 1 bit, 1 borrow },
  { .a /0 a, .b /1 b, .borrow /0 c } { 1 bit, 1 borrow },
  { .a /0 a, .b /1 b, .borrow /1 c } { 0 bit, 1 borrow },
  { .a /1 a, .b /0 b, .borrow /0 c } { 1 bit, 0 borrow },
  { .a /1 a, .b /0 b, .borrow /1 c } { 0 bit, 0 borrow },
  { .a /1 a, .b /1 b, .borrow /0 c } { 0 bit, 0 borrow },
  { .a /1 a, .b /1 b, .borrow /1 c } { 1 bit, 1 borrow }
>;

_ieee_sub = ?_ieee_nat_pair[] {
  .x _ieee_reverse_bits x, .y _ieee_reverse_bits y, 0 borrow, _ieee_zero acc
} _ieee_sub_loop;

_ieee_sub_loop = ?{ bits[] x, bits[] y, bit[] borrow, bits[] acc } <
  { .x /_ a, .y /_ b, .borrow /0 c, .acc _ieee_trim then } .then,
  < _ieee_sub8, _ieee_sub_step > _ieee_sub_loop
> ?bits[];

_ieee_sub_step = ?{ bits[] x, bits[] y, bit[] borrow, bits[] acc }
  {
    < .x /0, .x /1, .y /0, .y /1 > if,
    { .x _ieee_lsb x, .y _ieee_lsb y, .borrow borrow, .acc acc } then
  } .then
  {
    .x.rest x, .y.rest y, .acc acc,
    { .x.bit a, .y.bit b, .borrow borrow } _ieee_sub_bit difference
  }
  {
    .x x, .y y, .difference.borrow borrow,
    < { .difference.bit /0 if, .acc |0 then } .then, .acc |1 > acc
  };

_ieee_sub8 =
  _ieee_sub_step _ieee_sub_step _ieee_sub_step _ieee_sub_step
  _ieee_sub_step _ieee_sub_step _ieee_sub_step _ieee_sub_step;

_ieee_code = /ascii { () x, _ieee_zero acc } _ieee_push_bits7 _ieee_trim;

_ieee_e = /cons { .car _ieee_code /1 /1 /0 /0 /1 /0 /1 /_ if, .cdr then } .then;

_ieee_E = /cons { .car _ieee_code /1 /0 /0 /0 /1 /0 /1 /_ if, .cdr then } .then;

_ieee_minus = /cons { .car _ieee_code /1 /0 /1 /1 /0 /1 /_ if, .cdr then } .then;

_ieee_plus = /cons { .car _ieee_code /1 /0 /1 /0 /1 /1 /_ if, .cdr then } .then;

_ieee_dot = /cons { .car _ieee_code /1 /0 /1 /1 /1 /0 /_ if, .cdr then } .then;

_ieee_digit = /cons { .cdr rest, .car _ieee_code /1 /1 <
  /0 /0 /0 /0 /_ _ieee_zero,
  /0 /0 /0 /1 /_ _ieee_zero |1,
  /0 /0 /1 /0 /_ _ieee_zero |0 |1,
  /0 /0 /1 /1 /_ _ieee_zero |1 |1,
  /0 /1 /0 /0 /_ _ieee_zero |0 |0 |1,
  /0 /1 /0 /1 /_ _ieee_zero |1 |0 |1,
  /0 /1 /1 /0 /_ _ieee_zero |0 |1 |1,
  /0 /1 /1 /1 /_ _ieee_zero |1 |1 |1,
  /1 /0 /0 /0 /_ _ieee_zero |0 |0 |0 |1,
  /1 /0 /0 /1 /_ _ieee_zero |1 |0 |0 |1
> value };

_ieee_byte = _ieee_lsb
  { .bit b0, .rest _ieee_lsb tail }
  { .b0 b0, .tail.bit b1, .tail.rest _ieee_lsb tail }
  { .b0 b0, .b1 b1, .tail.bit b2, .tail.rest _ieee_lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .tail.bit b3, .tail.rest _ieee_lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .tail.bit b4, .tail.rest _ieee_lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .tail.bit b5, .tail.rest _ieee_lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .b5 b5, .tail.bit b6, .tail.rest _ieee_lsb tail }
  { { .b0 0, .b1 1, .b2 2, .b3 3, .b4 4, .b5 5, .b6 6, .tail.bit 7 } byte, .tail.rest rest };

_ieee_nibble = _ieee_lsb
  { .bit b0, .rest _ieee_lsb tail }
  { .b0 b0, .tail.bit b1, .tail.rest _ieee_lsb tail }
  { .b0 b0, .b1 b1, .tail.bit b2, .tail.rest _ieee_lsb tail }
  { { .b0 0, .b1 1, .b2 2, .tail.bit 3 } byte, .tail.rest rest };

_ieee_unpack16 = _ieee_reverse_bits _ieee_byte
  { .byte lo, .rest _ieee_byte high }
  { .lo lo, .high.byte hi, .high.rest _ieee_reverse_bits _ieee_trim plane };

_ieee_field1 = { .0 0 };

_ieee_field2 = { .0 0, .1 1 };

_ieee_field3 = { .0 0, .1 1, .2 2 };

_ieee_field4 = { .0 0, .1 1, .2 2, .3 3 };

_ieee_field7 = { .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6 };

_ieee_exp_field = _ieee_unpack16 { .lo.0 0, .lo.1 1, .lo.2 2, .lo.3 3, .lo.4 4, .lo.5 5, .lo.6 6, .lo.7 7, .hi.0 8, .hi.1 9, .hi.2 10 };

_ieee_mantissa = _ieee_byte { .byte b0, .rest _ieee_byte tail }
  { .b0 b0, .tail.byte b1, .tail.rest _ieee_byte tail }
  { .b0 b0, .b1 b1, .tail.byte b2, .tail.rest _ieee_byte tail }
  { .b0 b0, .b1 b1, .b2 b2, .tail.byte b3, .tail.rest _ieee_byte tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .tail.byte b4, .tail.rest _ieee_byte tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .tail.byte b5, .tail.rest _ieee_nibble tail }
  { {
    .b0.0 0, .b0.1 1, .b0.2 2, .b0.3 3,
    .b0.4 4, .b0.5 5, .b0.6 6, .b0.7 7,
    .b1.0 8, .b1.1 9, .b1.2 10, .b1.3 11,
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

_ieee_c52 = _ieee_zero |0 |0 |1 |0 |1 |1;

_ieee_c400 = _ieee_zero |0 |0 |0 |0 |1 |0 |0 |1 |1;

_ieee_c1023 = _ieee_zero |1 |1 |1 |1 |1 |1 |1 |1 |1 |1;

_ieee_c2047 = _ieee_zero |1 |1 |1 |1 |1 |1 |1 |1 |1 |1 |1;

_ieee_small1 = _ieee_reverse_bits _ieee_byte .byte _ieee_field1;

_ieee_small2 = _ieee_reverse_bits _ieee_byte .byte _ieee_field2;

_ieee_small3 = _ieee_reverse_bits _ieee_byte .byte _ieee_field3;

_ieee_small4 = _ieee_reverse_bits _ieee_byte .byte _ieee_field4;

_ieee_small7 = _ieee_reverse_bits _ieee_byte .byte _ieee_field7;

_ieee_number = ?string[] <
  _ieee_minus { () rest, {} |"-" sign },
  { () rest, + sign }
> { .rest _ieee_digit digit, .sign sign } {
  .digit.rest rest, .digit.value n, _ieee_one d, _ieee_one count, .sign sign
} <
  { .n /_ if, () then } .then,
  _ieee_integer_digits
> < _ieee_fraction_first _ieee_fraction_digits, () > {
  () decimal,
  < .rest _ieee_exponent, { .rest rest, _ieee_zero value, + sign } > exponent
} {
  .exponent.rest rest,
  {
    .decimal.n n, .decimal.d d, .decimal.count count,
    .decimal.sign sign, .exponent exponent
  } _ieee_decimal_float value
} ?_ieee_result[];

_ieee_integer_digits = ?_ieee_decimal[] <
  { .rest _ieee_digit digit, () decimal } {
    .digit.rest rest,
    { .decimal.n _ieee_tenfold x, .digit.value y } _ieee_add n,
    .decimal.d d, .decimal.count _ieee_nat_inc count, .decimal.sign sign
  } _ieee_integer_digits,
  ()
> ?_ieee_decimal[];

_ieee_fraction_first = ?_ieee_decimal[] {
  .rest _ieee_dot rest, .n n, .d d, .count count, .sign sign
} _ieee_fraction_digit;

_ieee_fraction_digit = ?_ieee_decimal[] { .rest _ieee_digit digit, () decimal } {
  .digit.rest rest,
  { .decimal.n _ieee_tenfold x, .digit.value y } _ieee_add n,
  .decimal.d _ieee_tenfold d, .decimal.count _ieee_nat_inc count, .decimal.sign sign
};

_ieee_fraction_digits = ?_ieee_decimal[] <
  _ieee_fraction_digit _ieee_fraction_digits, ()
> ?_ieee_decimal[];

_ieee_exponent = < _ieee_e, _ieee_E > <
  _ieee_minus { () rest, {} |"-" sign },
  _ieee_plus { () rest, + sign },
  { () rest, + sign }
> { .rest _ieee_digit _ieee_exponent_digits digits, .sign sign }
  { .digits.rest rest, .digits.value value, .sign sign };

_ieee_exponent_digits = ?{ string[] rest, bits[] value } <
  { .rest _ieee_digit next, .value _ieee_tenfold high }
  { .next.rest rest, { .high x, .next.value y } _ieee_add value }
    _ieee_exponent_digits,
  ()
> ?{ string[] rest, bits[] value };

_ieee_dec = ?bits[] _ieee_reverse_bits _ieee_dec_lsb _ieee_reverse_bits _ieee_trim;

_ieee_dec_lsb = ?bits[] < /1 |0, /0 _ieee_dec_lsb |1 > ?bits[];

_ieee_inc_lsb = ?bits[] < /0 |1, /1 _ieee_inc_lsb |0, /_ _ieee_one > ?bits[];

_ieee_signed_zero = { .sign sign, pos_zero .exponent exponent, pos_zero .fraction fraction };

_ieee_decimal_float = <
  { .n /_ if, _ieee_signed_zero then } .then,
  {
    () decimal,
    { .exponent.value x, { .count x, _ieee_c400 y } _ieee_add y } _ieee_cmp order
  } <
    {
      .order /gt a, .decimal.exponent.sign /"-" b,
      .decimal _ieee_signed_zero then
    } .then,
    {
      .order /gt a, .decimal.exponent.sign /"+" b,
      { .decimal.sign sign, pos_inf .exponent exponent, frac0 fraction } then
    } .then,
    {
      .order </lt, /eq> if,
      {
        {
          .decimal.n n, .decimal.d d,
          .decimal.exponent.value power, .decimal.exponent.sign direction
        } _ieee_scale_decimal _ieee_ratio fields,
        .decimal.sign sign
      } { .sign sign, .fields.exponent exponent, .fields.fraction fraction } then
    } .then
  >
> ?float64[];

_ieee_scale_decimal = ?{ bits[] n, bits[] d, bits[] power, sign[] direction } <
  { .power /_ if, { .n n, .d d } then } .then,
  < _ieee_scale8, _ieee_scale_step > _ieee_scale_decimal
> ?{ bits[] n, bits[] d };

_ieee_scale_step = ?{ bits[] n, bits[] d, bits[] power, sign[] direction }
  <
    {
      .direction /"+" if,
      { .n _ieee_tenfold n, .d d, .power _ieee_dec power, .direction direction } then
    } .then,
    {
      .direction /"-" if,
      { .n n, .d _ieee_tenfold d, .power _ieee_dec power, .direction direction } then
    } .then
  >;

_ieee_scale8 =
  _ieee_scale_step _ieee_scale_step _ieee_scale_step _ieee_scale_step
  _ieee_scale_step _ieee_scale_step _ieee_scale_step _ieee_scale_step;

_ieee_ratio = ?{ bits[] n, bits[] d } {
  .n n, .d d, .n x, .d y, _ieee_c1023 exponent
} _ieee_align;

_ieee_align = ?{ bits[] n, bits[] d, bits[] x, bits[] y, bits[] exponent } <
  { .x /_ a, .y /_ b, { .n n, .d d, .exponent exponent } _ieee_normalized then } .then,
  {
    .y /_ if,
    { .n n, .d _ieee_reverse_bits denominator, .x steps, .exponent exponent } _ieee_align_down then
  } .then,
  {
    .x /_ if,
    { .n _ieee_reverse_bits numerator, .d d, .y steps, .exponent exponent } _ieee_align_up then
  } .then,
  < _ieee_align8, _ieee_align_step > _ieee_align
> ?{ exp11[] exponent, frac52[] fraction };

_ieee_align_step = ?{ bits[] n, bits[] d, bits[] x, bits[] y, bits[] exponent } {
  .n n, .d d, .x </0, /1> x, .y </0, /1> y, .exponent exponent
};

_ieee_align8 =
  _ieee_align_step _ieee_align_step _ieee_align_step _ieee_align_step
  _ieee_align_step _ieee_align_step _ieee_align_step _ieee_align_step;

_ieee_align_down = ?{ bits[] n, bits[] denominator, bits[] steps, bits[] exponent } <
  {
    .steps /_ if,
    { .n n, .denominator _ieee_reverse_bits d, .exponent exponent } _ieee_normalized then
  } .then,
  {
    .exponent /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /_ if,
    { exp_all1 exponent, frac0 fraction } then
  } .then,
  < _ieee_align_down8, _ieee_align_down_step > _ieee_align_down
> ?{ exp11[] exponent, frac52[] fraction };

_ieee_align_down_step = ?{ bits[] n, bits[] denominator, bits[] steps, bits[] exponent } {
  { .exponent x, _ieee_c2047 y } _ieee_lt if,
  {
    .n n, .denominator |0 denominator, .steps </0, /1> steps,
    .exponent _ieee_nat_inc exponent
  } then
} .then;

_ieee_align_down8 =
  _ieee_align_down_step _ieee_align_down_step _ieee_align_down_step _ieee_align_down_step
  _ieee_align_down_step _ieee_align_down_step _ieee_align_down_step _ieee_align_down_step;

_ieee_align_up = ?{ bits[] numerator, bits[] d, bits[] steps, bits[] exponent } <
  {
    < .steps /_, .exponent /1 /_ > if,
    { .numerator _ieee_reverse_bits n, .d d, .exponent exponent } _ieee_normalized then
  } .then,
  < _ieee_align_up8, _ieee_align_up_step > _ieee_align_up
> ?{ exp11[] exponent, frac52[] fraction };

_ieee_align_up_step = ?{ bits[] numerator, bits[] d, bits[] steps, bits[] exponent } {
  .exponent _ieee_dec /1 if,
  {
    .numerator |0 numerator, .d d, .steps </0, /1> steps,
    .exponent _ieee_dec exponent
  } then
} .then;

_ieee_align_up8 =
  _ieee_align_up_step _ieee_align_up_step _ieee_align_up_step _ieee_align_up_step
  _ieee_align_up_step _ieee_align_up_step _ieee_align_up_step _ieee_align_up_step;

_ieee_normalized = ?{ bits[] n, bits[] d, bits[] exponent } <
  {
    _ieee_ratio_less if,
    .exponent /1 /_ and,
    { .n n, .d d, _ieee_zero exponent, _ieee_zero acc, _ieee_c52 left } _ieee_fraction_loop then
  } .then,
  {
    _ieee_ratio_less if,
    {
      { .n _ieee_twice x, .d y } _ieee_sub n,
      .d d, .exponent _ieee_dec exponent, _ieee_one acc, _ieee_c52 left
    } _ieee_fraction_loop then
  } .then,
  {
    { .n x, .d y } _ieee_sub n,
    .d d, .exponent exponent, _ieee_one acc, _ieee_c52 left
  } _ieee_fraction_loop
> ?{ exp11[] exponent, frac52[] fraction };

_ieee_ratio_less = { .n x, .d y } _ieee_lt;

_ieee_fraction_loop = ?{
  bits[] n, bits[] d, bits[] exponent, bits[] acc, bits[] left
} <
  { .left /_ if, () _ieee_round then } .then,
  { .n _ieee_twice n, .d d, .exponent exponent, .acc acc, .left _ieee_dec left }
  <
    {
      _ieee_ratio_less if,
      { .n n, .d d, .exponent exponent, .acc |0 acc, .left left } then
    } .then,
    {
      { .n x, .d y } _ieee_sub n,
      .d d, .exponent exponent, .acc |1 acc, .left left
    }
  > _ieee_fraction_loop
> ?{ exp11[] exponent, frac52[] fraction };

_ieee_round = {
  () state, { .n _ieee_twice x, .d y } _ieee_cmp order
} {
  .state.exponent exponent,
  <
    { .order /gt if, .state.acc _ieee_inc_lsb then } .then,
    { .order /eq a, .state.acc /1 b, .state.acc _ieee_inc_lsb then } .then,
    .state.acc
  > _ieee_mantissa mantissa
} {
  .mantissa.fraction fraction,
  <
    { .exponent /_ a, .mantissa.lead /1 b, _ieee_one then } .then,
    { .mantissa.lead /0 /1 /_ if, .exponent _ieee_nat_inc then } .then,
    .exponent
  > exponent
} {
  () fields,
  { .exponent x, _ieee_c2047 y } _ieee_cmp order
} <
  { .order /lt if, { .fields.exponent _ieee_exp_field exponent, .fields.fraction fraction } then } .then,
  { exp_all1 exponent, frac0 fraction }
>;

-- Text boundary helpers.
_ieee_space = /cons { .car _ieee_code /1 /0 /0 /0 /0 /0 /_ if, .cdr then } .then;
_ieee_tab = /cons { .car _ieee_code /1 /0 /0 /1 /_ if, .cdr then } .then;
_ieee_lf = /cons { .car _ieee_code /1 /0 /1 /0 /_ if, .cdr then } .then;
_ieee_cr = /cons { .car _ieee_code /1 /1 /0 /1 /_ if, .cdr then } .then;
_ieee_I = /cons { .car _ieee_code /1 /0 /0 /1 /0 /0 /1 /_ if, .cdr then } .then;
_ieee_n = /cons { .car _ieee_code /1 /1 /0 /1 /1 /1 /0 /_ if, .cdr then } .then;
_ieee_f = /cons { .car _ieee_code /1 /1 /0 /0 /1 /1 /0 /_ if, .cdr then } .then;
_ieee_i = /cons { .car _ieee_code /1 /1 /0 /1 /0 /0 /1 /_ if, .cdr then } .then;
_ieee_t = /cons { .car _ieee_code /1 /1 /1 /0 /1 /0 /0 /_ if, .cdr then } .then;
_ieee_y = /cons { .car _ieee_code /1 /1 /1 /1 /0 /0 /1 /_ if, .cdr then } .then;
_ieee_N = /cons { .car _ieee_code /1 /0 /0 /1 /1 /1 /0 /_ if, .cdr then } .then;
_ieee_a = /cons { .car _ieee_code /1 /1 /0 /0 /0 /0 /1 /_ if, .cdr then } .then;
_ieee_infinity_word = _ieee_I _ieee_n _ieee_f _ieee_i _ieee_n _ieee_i _ieee_t _ieee_y;
_ieee_nan_word = _ieee_N _ieee_a _ieee_N;
_ieee_special = <
  _ieee_minus _ieee_infinity_word { () rest, neg_inf value },
  _ieee_plus _ieee_infinity_word { () rest, pos_inf value },
  _ieee_infinity_word { () rest, pos_inf value },
  < _ieee_minus, _ieee_plus, () > _ieee_nan_word { () rest, qnan value }
>;
_ieee_zero_text = { { 0 0, 0 1, 0 2, 0 3, 1 4, 1 5, 0 6 } |ascii car, _ieee_nil cdr } |cons;
_ieee_negative_zero_text = { { 1 0, 0 1, 1 2, 1 3, 0 4, 1 5, 0 6 } |ascii car, { { 0 0, 0 1, 0 2, 0 3, 1 4, 1 5, 0 6 } |ascii car, _ieee_nil cdr } |cons cdr } |cons;
_ieee_infinity_text = { { 1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 0 3, 0 4, 1 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 0 1, 1 2, 0 3, 1 4, 1 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 1 4, 1 5, 1 6 } |ascii car, _ieee_nil cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons;
_ieee_negative_infinity_text = { { 1 0, 0 1, 1 2, 1 3, 0 4, 1 5, 0 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 0 3, 0 4, 1 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 0 1, 1 2, 0 3, 1 4, 1 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 1 3, 1 4, 1 5, 1 6 } |ascii car, _ieee_nil cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons cdr } |cons;
_ieee_nan_text = { { 0 0, 1 1, 1 2, 1 3, 0 4, 0 5, 1 6 } |ascii car, { { 1 0, 0 1, 0 2, 0 3, 0 4, 1 5, 1 6 } |ascii car, { { 0 0, 1 1, 1 2, 1 3, 0 4, 0 5, 1 6 } |ascii car, _ieee_nil cdr } |cons cdr } |cons cdr } |cons;
_ieee_c2 = _ieee_zero |0 |1;
_ieee_c5 = _ieee_zero |1 |0 |1;
_ieee_c1074 = _ieee_zero |0 |1 |0 |0 |1 |1 |0 |0 |0 |0 |1;
_ieee_c1075 = _ieee_zero |1 |1 |0 |0 |1 |1 |0 |0 |0 |0 |1;
_ieee_exponent_bits = { () source, _ieee_zero acc }
  { .source source,
    { { .source.0 0, .source.1 1, .source.2 2, .source.3 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.4 0, .source.5 1, .source.6 2, .source.7 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.8 0, .source.9 1, .source.10 2 } x, .acc acc } _ieee_push_bits3 acc
  }
  .acc;
_ieee_fraction_bits = { () source, _ieee_zero acc }
  { .source source,
    { { .source.0 0, .source.1 1, .source.2 2, .source.3 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.4 0, .source.5 1, .source.6 2, .source.7 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.8 0, .source.9 1, .source.10 2, .source.11 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.12 0, .source.13 1, .source.14 2, .source.15 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.16 0, .source.17 1, .source.18 2, .source.19 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.20 0, .source.21 1, .source.22 2, .source.23 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.24 0, .source.25 1, .source.26 2, .source.27 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.28 0, .source.29 1, .source.30 2, .source.31 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.32 0, .source.33 1, .source.34 2, .source.35 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.36 0, .source.37 1, .source.38 2, .source.39 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.40 0, .source.41 1, .source.42 2, .source.43 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.44 0, .source.45 1, .source.46 2, .source.47 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  { .source source,
    { { .source.48 0, .source.49 1, .source.50 2, .source.51 3 } x, .acc acc } _ieee_push_bits4 acc
  }
  .acc;

-- Decimal digit arithmetic for exact, round-trip-safe printing.
_ieee_digit_value[] = < {} 0, {} 1, {} 2, {} 3, {} 4, {} 5, {} 6, {} 7, {} 8, {} 9 >;
_ieee_digits[] = < {} nil, { _ieee_digit_value[] car, D cdr } cons > = D;
_ieee_factor[] = < {} 2, {} 5 >;
_ieee_d0 = {} |0;
_ieee_d1 = {} |1;
_ieee_d2 = {} |2;
_ieee_d3 = {} |3;
_ieee_d4 = {} |4;
_ieee_d5 = {} |5;
_ieee_d6 = {} |6;
_ieee_d7 = {} |7;
_ieee_d8 = {} |8;
_ieee_d9 = {} |9;
_ieee_digit_char = <
  /0 { 0 0, 0 1, 0 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /1 { 1 0, 0 1, 0 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /2 { 0 0, 1 1, 0 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /3 { 1 0, 1 1, 0 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /4 { 0 0, 0 1, 1 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /5 { 1 0, 0 1, 1 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /6 { 0 0, 1 1, 1 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /7 { 1 0, 1 1, 1 2, 0 3, 1 4, 1 5, 0 6 } |ascii,
  /8 { 0 0, 0 1, 0 2, 1 3, 1 4, 1 5, 0 6 } |ascii,
  /9 { 1 0, 0 1, 0 2, 1 3, 1 4, 1 5, 0 6 } |ascii
>;
_ieee_dot_char = { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 0 6 } |ascii;
_ieee_minus_char = { 1 0, 0 1, 1 2, 1 3, 0 4, 1 5, 0 6 } |ascii;
_ieee_digit_mul2 = <
  { .digit /0 a, .carry /0 b } { _ieee_d0 digit, _ieee_d0 carry },
  { .digit /0 a, .carry /1 b } { _ieee_d1 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /0 b } { _ieee_d2 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /1 b } { _ieee_d3 digit, _ieee_d0 carry },
  { .digit /2 a, .carry /0 b } { _ieee_d4 digit, _ieee_d0 carry },
  { .digit /2 a, .carry /1 b } { _ieee_d5 digit, _ieee_d0 carry },
  { .digit /3 a, .carry /0 b } { _ieee_d6 digit, _ieee_d0 carry },
  { .digit /3 a, .carry /1 b } { _ieee_d7 digit, _ieee_d0 carry },
  { .digit /4 a, .carry /0 b } { _ieee_d8 digit, _ieee_d0 carry },
  { .digit /4 a, .carry /1 b } { _ieee_d9 digit, _ieee_d0 carry },
  { .digit /5 a, .carry /0 b } { _ieee_d0 digit, _ieee_d1 carry },
  { .digit /5 a, .carry /1 b } { _ieee_d1 digit, _ieee_d1 carry },
  { .digit /6 a, .carry /0 b } { _ieee_d2 digit, _ieee_d1 carry },
  { .digit /6 a, .carry /1 b } { _ieee_d3 digit, _ieee_d1 carry },
  { .digit /7 a, .carry /0 b } { _ieee_d4 digit, _ieee_d1 carry },
  { .digit /7 a, .carry /1 b } { _ieee_d5 digit, _ieee_d1 carry },
  { .digit /8 a, .carry /0 b } { _ieee_d6 digit, _ieee_d1 carry },
  { .digit /8 a, .carry /1 b } { _ieee_d7 digit, _ieee_d1 carry },
  { .digit /9 a, .carry /0 b } { _ieee_d8 digit, _ieee_d1 carry },
  { .digit /9 a, .carry /1 b } { _ieee_d9 digit, _ieee_d1 carry }
>;
_ieee_digit_mul5 = <
  { .digit /0 a, .carry /0 b } { _ieee_d0 digit, _ieee_d0 carry },
  { .digit /0 a, .carry /1 b } { _ieee_d1 digit, _ieee_d0 carry },
  { .digit /0 a, .carry /2 b } { _ieee_d2 digit, _ieee_d0 carry },
  { .digit /0 a, .carry /3 b } { _ieee_d3 digit, _ieee_d0 carry },
  { .digit /0 a, .carry /4 b } { _ieee_d4 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /0 b } { _ieee_d5 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /1 b } { _ieee_d6 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /2 b } { _ieee_d7 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /3 b } { _ieee_d8 digit, _ieee_d0 carry },
  { .digit /1 a, .carry /4 b } { _ieee_d9 digit, _ieee_d0 carry },
  { .digit /2 a, .carry /0 b } { _ieee_d0 digit, _ieee_d1 carry },
  { .digit /2 a, .carry /1 b } { _ieee_d1 digit, _ieee_d1 carry },
  { .digit /2 a, .carry /2 b } { _ieee_d2 digit, _ieee_d1 carry },
  { .digit /2 a, .carry /3 b } { _ieee_d3 digit, _ieee_d1 carry },
  { .digit /2 a, .carry /4 b } { _ieee_d4 digit, _ieee_d1 carry },
  { .digit /3 a, .carry /0 b } { _ieee_d5 digit, _ieee_d1 carry },
  { .digit /3 a, .carry /1 b } { _ieee_d6 digit, _ieee_d1 carry },
  { .digit /3 a, .carry /2 b } { _ieee_d7 digit, _ieee_d1 carry },
  { .digit /3 a, .carry /3 b } { _ieee_d8 digit, _ieee_d1 carry },
  { .digit /3 a, .carry /4 b } { _ieee_d9 digit, _ieee_d1 carry },
  { .digit /4 a, .carry /0 b } { _ieee_d0 digit, _ieee_d2 carry },
  { .digit /4 a, .carry /1 b } { _ieee_d1 digit, _ieee_d2 carry },
  { .digit /4 a, .carry /2 b } { _ieee_d2 digit, _ieee_d2 carry },
  { .digit /4 a, .carry /3 b } { _ieee_d3 digit, _ieee_d2 carry },
  { .digit /4 a, .carry /4 b } { _ieee_d4 digit, _ieee_d2 carry },
  { .digit /5 a, .carry /0 b } { _ieee_d5 digit, _ieee_d2 carry },
  { .digit /5 a, .carry /1 b } { _ieee_d6 digit, _ieee_d2 carry },
  { .digit /5 a, .carry /2 b } { _ieee_d7 digit, _ieee_d2 carry },
  { .digit /5 a, .carry /3 b } { _ieee_d8 digit, _ieee_d2 carry },
  { .digit /5 a, .carry /4 b } { _ieee_d9 digit, _ieee_d2 carry },
  { .digit /6 a, .carry /0 b } { _ieee_d0 digit, _ieee_d3 carry },
  { .digit /6 a, .carry /1 b } { _ieee_d1 digit, _ieee_d3 carry },
  { .digit /6 a, .carry /2 b } { _ieee_d2 digit, _ieee_d3 carry },
  { .digit /6 a, .carry /3 b } { _ieee_d3 digit, _ieee_d3 carry },
  { .digit /6 a, .carry /4 b } { _ieee_d4 digit, _ieee_d3 carry },
  { .digit /7 a, .carry /0 b } { _ieee_d5 digit, _ieee_d3 carry },
  { .digit /7 a, .carry /1 b } { _ieee_d6 digit, _ieee_d3 carry },
  { .digit /7 a, .carry /2 b } { _ieee_d7 digit, _ieee_d3 carry },
  { .digit /7 a, .carry /3 b } { _ieee_d8 digit, _ieee_d3 carry },
  { .digit /7 a, .carry /4 b } { _ieee_d9 digit, _ieee_d3 carry },
  { .digit /8 a, .carry /0 b } { _ieee_d0 digit, _ieee_d4 carry },
  { .digit /8 a, .carry /1 b } { _ieee_d1 digit, _ieee_d4 carry },
  { .digit /8 a, .carry /2 b } { _ieee_d2 digit, _ieee_d4 carry },
  { .digit /8 a, .carry /3 b } { _ieee_d3 digit, _ieee_d4 carry },
  { .digit /8 a, .carry /4 b } { _ieee_d4 digit, _ieee_d4 carry },
  { .digit /9 a, .carry /0 b } { _ieee_d5 digit, _ieee_d4 carry },
  { .digit /9 a, .carry /1 b } { _ieee_d6 digit, _ieee_d4 carry },
  { .digit /9 a, .carry /2 b } { _ieee_d7 digit, _ieee_d4 carry },
  { .digit /9 a, .carry /3 b } { _ieee_d8 digit, _ieee_d4 carry },
  { .digit /9 a, .carry /4 b } { _ieee_d9 digit, _ieee_d4 carry }
>;
_ieee_digits_reverse = { () x, _ieee_nil acc } _ieee_digits_reverse_loop;
_ieee_digits_reverse_step = ?{ _ieee_digits[] x, _ieee_digits[] acc } {
  .x /cons .cdr x, { .x /cons .car car, .acc cdr } |cons acc
};
_ieee_digits_reverse8 =
  _ieee_digits_reverse_step _ieee_digits_reverse_step _ieee_digits_reverse_step _ieee_digits_reverse_step
  _ieee_digits_reverse_step _ieee_digits_reverse_step _ieee_digits_reverse_step _ieee_digits_reverse_step;
_ieee_digits_reverse_loop = ?{ _ieee_digits[] x, _ieee_digits[] acc } <
  { .x /nil if, .acc then } .then,
  < _ieee_digits_reverse8, _ieee_digits_reverse_step > _ieee_digits_reverse_loop
> ?_ieee_digits[];

_ieee_digits_multiply = ?{ _ieee_digits[] digits, _ieee_factor[] factor, _ieee_digit_value[] carry } {
  .digits x, .factor factor, .carry carry, _ieee_nil acc
} _ieee_digits_multiply_loop;
_ieee_digits_multiply_step = ?{
  _ieee_digits[] x, _ieee_factor[] factor, _ieee_digit_value[] carry, _ieee_digits[] acc
} {
  .x /cons .cdr x, .factor factor, .acc acc,
  { .x /cons .car digit, .carry carry, .factor factor } <
    { .factor /2 if, { .digit digit, .carry carry } _ieee_digit_mul2 then } .then,
    { .factor /5 if, { .digit digit, .carry carry } _ieee_digit_mul5 then } .then
  > next
} { .x x, .factor factor, .next.carry carry, { .next.digit car, .acc cdr } |cons acc };
_ieee_digits_multiply8 =
  _ieee_digits_multiply_step _ieee_digits_multiply_step _ieee_digits_multiply_step _ieee_digits_multiply_step
  _ieee_digits_multiply_step _ieee_digits_multiply_step _ieee_digits_multiply_step _ieee_digits_multiply_step;
_ieee_digits_multiply_loop = ?{
  _ieee_digits[] x, _ieee_factor[] factor, _ieee_digit_value[] carry, _ieee_digits[] acc
} <
  { .x /nil a, .carry /0 b, .acc _ieee_digits_reverse then } .then,
  { .x /nil if, { .carry car, .acc cdr } |cons _ieee_digits_reverse then } .then,
  < _ieee_digits_multiply8, _ieee_digits_multiply_step > _ieee_digits_multiply_loop
> ?_ieee_digits[];

_ieee_binary_digits = ?bits[] {
  () bits, { _ieee_d0 car, _ieee_nil cdr } |cons digits
} _ieee_binary_digits_loop;
_ieee_binary_digits_loop = ?{ bits[] bits, _ieee_digits[] digits } <
  { .bits /_ if, .digits then } .then,
  <
    { .bits /0 bits, { .digits digits, {} |2 factor, _ieee_d0 carry } _ieee_digits_multiply digits },
    { .bits /1 bits, { .digits digits, {} |2 factor, _ieee_d1 carry } _ieee_digits_multiply digits }
  > _ieee_binary_digits_loop
> ?_ieee_digits[];

_ieee_digits_power = ?{ _ieee_digits[] digits, _ieee_factor[] factor, bits[] steps } <
  { .steps /_ if, .digits then } .then,
  < _ieee_digits_power8, _ieee_digits_power_step > _ieee_digits_power
> ?_ieee_digits[];
_ieee_digits_power_step = ?{ _ieee_digits[] digits, _ieee_factor[] factor, bits[] steps } {
  { .digits digits, .factor factor, _ieee_d0 carry } _ieee_digits_multiply digits,
  .factor factor, .steps _ieee_dec steps
};
_ieee_digits_power8 =
  _ieee_digits_power_step _ieee_digits_power_step _ieee_digits_power_step _ieee_digits_power_step
  _ieee_digits_power_step _ieee_digits_power_step _ieee_digits_power_step _ieee_digits_power_step;

-- Remove binary factors of two before generating fractional decimal places.
_ieee_cancel_twos = ?{ bits[] reversed, bits[] places } <
  { .places /_ if, () then } .then,
  { .reversed /0 reversed, .places _ieee_dec places } _ieee_cancel_twos,
  ()
> ?{ bits[] reversed, bits[] places };
_ieee_print_ratio = ?float64[] {
  .fraction _ieee_fraction_bits fraction,
  .exponent _ieee_exponent_bits _ieee_trim exponent
} <
  {
    .exponent /_ if,
    { .fraction _ieee_reverse_bits reversed, _ieee_c1074 places } _ieee_fraction_digits_print then
  } .then,
  {
    { .exponent x, _ieee_c1075 y } _ieee_lt if,
    { .fraction |1 _ieee_reverse_bits reversed,
      { _ieee_c1075 x, .exponent y } _ieee_sub places } _ieee_fraction_digits_print then
  } .then,
  {
    .fraction |1 _ieee_binary_digits digits, {} |2 factor,
    { .exponent x, _ieee_c1075 y } _ieee_sub steps
  } _ieee_digits_power { () digits, _ieee_zero places }
>;
_ieee_fraction_digits_print = _ieee_cancel_twos {
  .reversed _ieee_reverse_bits _ieee_trim _ieee_binary_digits digits,
  {} |5 factor, .places steps, .places places
} { { .digits digits, .factor factor, .steps steps } _ieee_digits_power digits, .places places };

-- Consume least-significant digits, prepending characters in display order.
_ieee_fraction_text = ?{ _ieee_digits[] digits, bits[] places, string[] acc } <
  { .places /_ if, { .digits digits, .acc acc } then } .then,
  < _ieee_fraction_text8, _ieee_fraction_text_step > _ieee_fraction_text
> ?{ _ieee_digits[] digits, string[] acc };
_ieee_fraction_text_step = ?{ _ieee_digits[] digits, bits[] places, string[] acc } {
  < .digits /cons .cdr, _ieee_nil > digits,
  .places _ieee_dec places,
  { < .digits /cons .car, _ieee_d0 > _ieee_digit_char car, .acc cdr } |cons acc
};
_ieee_fraction_text8 =
  _ieee_fraction_text_step _ieee_fraction_text_step _ieee_fraction_text_step _ieee_fraction_text_step
  _ieee_fraction_text_step _ieee_fraction_text_step _ieee_fraction_text_step _ieee_fraction_text_step;
_ieee_integer_text = ?{ _ieee_digits[] digits, string[] acc } <
  { .digits /nil if, { _ieee_d0 _ieee_digit_char car, .acc cdr } |cons then } .then,
  () _ieee_integer_text_loop
> ?string[];
_ieee_integer_text_loop = ?{ _ieee_digits[] digits, string[] acc } <
  { .digits /nil if, .acc then } .then,
  < _ieee_integer_text8, _ieee_integer_text_step > _ieee_integer_text_loop
> ?string[];
_ieee_integer_text_step = ?{ _ieee_digits[] digits, string[] acc } {
  .digits /cons .cdr digits,
  { .digits /cons .car _ieee_digit_char car, .acc cdr } |cons acc
};
_ieee_integer_text8 =
  _ieee_integer_text_step _ieee_integer_text_step _ieee_integer_text_step _ieee_integer_text_step
  _ieee_integer_text_step _ieee_integer_text_step _ieee_integer_text_step _ieee_integer_text_step;
_ieee_format_decimal = ?{ _ieee_digits[] digits, bits[] places } <
  { .places /_ if, { .digits digits, _ieee_nil acc } _ieee_integer_text then } .then,
  { .digits digits, .places places, _ieee_nil acc } _ieee_fraction_text
  { .digits digits, { _ieee_dot_char car, .acc cdr } |cons acc } _ieee_integer_text
> ?string[];
