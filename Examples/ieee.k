-- IEEE binary64 types and text conversion.
-- Arithmetic operations live in ieee-arithmetics.k.

-- Defined in 'core.k':
bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[];
bits[] = @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb[];
ascii[] = @VgLSCtg5j6bmqeMXzdk7rHrs9DPYcjxXntYmR6kMpuXc[];
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
parseFloat64 = ?string[] ws scanFloat64 {
  .rest ws /nil end, .value value
} .value ?float64[];

-- Prefix scanner shared with the JSON parser, which applies finite_float64?.
scanFloat64 = ?string[] <
  plus_char { () rest, + sign } signed_decimal,
  number,
  special
> ?result[];
natToFloat64 = ?bits[] trim <
  /_ pos_zero,
  { () n, 1b d } ratio { + sign, .exponent exponent, .fraction fraction }
> ?float64[];

-- Print an exact decimal expansion (no shortest-format rounding). Signed zero
-- and infinities retain their signs; every NaN prints the canonical word NaN.
printFloat64 = ?float64[] <
  nan_float64? nan_text,
  { inf_float64? if, .sign /- and, negative_infinity_text then } .then,
  inf_float64? infinity_text,
  { zero_float64? if, .sign /- and, negative_zero_text then } .then,
  zero_float64? zero_text,
  { () value, print_ratio format_decimal text } <
    { .value.sign /- if, { _minus_ car, .text cdr } cons then } .then,
    .text
  >
> ?string[];

nil = {} |nil;
ws = ?string[] <
  < space, tab, lf, cr > ws,
  ()
> ?string[];

-- Small constructors and classification filters.
0 = {} |0 ?bit[];
1 = {} |1 ?bit[];

+ = {} |+ ?sign[];
- = {} |- ?sign[];

0? = ?X /0 |0 ?X;
1? = ?X /1 |1 ?X;

+? = /+ |+ ?sign[];
-? = /- |- ?sign[];

zero_exponent? =  ?exp11[] {
  .0 0? 0, .1 0? 1, .2 0? 2, .3 0? 3, .4 0? 4, .5 0? 5,
  .6 0? 6, .7 0? 7, .8 0? 8, .9 0? 9, .10 0? 10
};

all_ones_exponent? = ?exp11[] {
  .0 1? 0, .1 1? 1, .2 1? 2, .3 1? 3, .4 1? 4, .5 1? 5,
  .6 1? 6, .7 1? 7, .8 1? 8, .9 1? 9, .10 1? 10
};

not_all_ones_exponent? = ?exp11[] {
  <.10 /0, .9 /0, .8 /0, .7 /0, .6 /0, .5 /0, .4 /0, .3 /0, .2 /0, .1 /0, .0 /0> if,
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
  <.51 /1, .50 /1, .49 /1, .48 /1, .47 /1, .46 /1, .45 /1, .44 /1, .43 /1, .42 /1,
   .41 /1, .40 /1, .39 /1, .38 /1, .37 /1, .36 /1, .35 /1, .34 /1, .33 /1, .32 /1,
   .31 /1, .30 /1, .29 /1, .28 /1, .27 /1, .26 /1, .25 /1, .24 /1, .23 /1, .22 /1,
   .21 /1, .20 /1, .19 /1, .18 /1, .17 /1, .16 /1, .15 /1, .14 /1, .13 /1, .12 /1,
   .11 /1, .10 /1, .9 /1, .8 /1, .7 /1, .6 /1, .5 /1, .4 /1, .3 /1, .2 /1, .1 /1, .0 /1> if,
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

exp0 = {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10} ?exp11[];

exp_all1 = {1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} ?exp11[];

frac0 = {
  0 0,  0 1,  0 2,  0 3,  0 4,  0 5,  0 6,  0 7,  0 8,  0 9,  0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
  0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
  0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
  0 48, 0 49, 0 50, 0 51
} ?frac52[];

frac_lsb1 = {
  1 0,  0 1,  0 2,  0 3,  0 4,  0 5,  0 6,  0 7,  0 8,  0 9,  0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
  0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
  0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47,
  0 48, 0 49, 0 50, 0 51
} ?frac52[];

pos_zero = {+ sign, exp0 exponent, frac0 fraction} ?float64[];
neg_zero = {- sign, exp0 exponent, frac0 fraction} ?float64[];
pos_inf  = {+ sign, exp_all1 exponent, frac0 fraction} ?float64[];
neg_inf  = {- sign, exp_all1 exponent, frac0 fraction} ?float64[];
qnan     = {+ sign, exp_all1 exponent, frac_lsb1 fraction} ?float64[];

flip_sign = ?sign[] < /+ -, /- + >;

negate_float64 = ?float64[]
  {.sign flip_sign sign, .exponent exponent, .fraction fraction};

-- Exact decimal parsing and shared bit helpers.
nat_pair[] = { bits[] x, bits[] y };
order[] = < {} lt, {} eq, {} gt >;
decimal[] = {
  string[] rest, bits[] n, bits[] d, bits[] count
};
result[] = { string[] rest, float64[] value };
digit_result[] = { string[] rest, bits[] value };

_ = {} |_ ?bits[];
1b = _ |1 ?bits[];

lt = {} |lt ?order[];
eq = {} |eq ?order[];
gt = {} |gt ?order[];

eq_bit? = ?{ bit[] x, bit[] y } <
  { .x 0? x, .y 0? y },
  { .x 1? x, .y 1? y }
>;

eq_ascii? = ?{ ascii[] x, ascii[] y } {
  { .x.0 x, .y.0 y } eq_bit? 0,
  { .x.1 x, .y.1 y } eq_bit? 1,
  { .x.2 x, .y.2 y } eq_bit? 2,
  { .x.3 x, .y.3 y } eq_bit? 3,
  { .x.4 x, .y.4 y } eq_bit? 4,
  { .x.5 x, .y.5 y } eq_bit? 5,
  { .x.6 x, .y.6 y } eq_bit? 6,
  () then
} .then ;

eq_char? = ?{ unicode[] x, unicode[] y } {
  {.x /ascii x, .y /ascii y} eq_ascii? if,
  () then
} .then;

push_bit = ?{ bit[] b, bits[] acc } <
  { .b /0 if, .acc |0 then } .then,
  { .b /1 if, .acc |1 then } .then
> ?bits[];

push_bits1 = ?{ (...) x, bits[] acc } { .x .0 b, .acc acc } push_bit;
push_bits2 = ?{ (...) x, bits[] acc } { .x .1 b, { .x x, .acc acc } push_bits1 acc } push_bit;
push_bits3 = ?{ (...) x, bits[] acc } { .x .2 b, { .x x, .acc acc } push_bits2 acc } push_bit;
push_bits4 = ?{ (...) x, bits[] acc } { .x .3 b, { .x x, .acc acc } push_bits3 acc } push_bit;

trim = ?bits[] <
  /1 |1,
  /_ |_,
  /0 trim
> ?bits[];

inv_loop = ?{ bits[] x, bits[] r } <
  { .x /_ if, .r then } .then,
  <
    { .x /0 x, .r |0 r },
    { .x /1 x, .r |1 r }
  > inv_loop
> ?bits[];

inv = ?bits[] { () x, _ r } inv_loop;

inc_rev = ?{ bits[] x, bits[] r } <
  { .x /_ if, .r |1 then } .then,
  { .x /0 x, .r |1 r } inv_loop,
  { .x /1 x, .r |0 r } inc_rev
> ?bits[];

inc = ?bits[] { inv x, _ r } inc_rev;

dec_rev = ?{ bits[] x, bits[] r } <
  { .x /1 x, .r |0 r } inv_loop,
  { .x /0 x, .r |1 r } dec_rev
> ?bits[];

dec = ?bits[] { inv x, _ r } dec_rev trim;

cmp_loop = ?{ bits[] x, bits[] y, order[] order } <
  { .x /_ a, .y /_ b, .order then } .then,
  .x /_ lt,
  .y /_ gt,
  <
    { .x /0 x, .y /1 y, .order /eq lt order },
    { .x /1 x, .y /0 y, .order /eq gt order },
    { .x </0, /1> x, .y </0, /1> y, .order order }
  > cmp_loop
> ?order[];

cmp = ?nat_pair[] { .x x, .y y, eq order } cmp_loop;

lt? = { cmp /lt if, () then } .then;

plus_loop = ?{ bits[] x, bits[] y, bit[] c, bits[] r } <
  { .y /_ a, .c /0 b, { .x x, .r r } inv_loop trim then } .then,
  { .x /_ a, .c /0 b, { .y x, .r r } inv_loop trim then } .then,
  { .y /_ a, .c /1 b, { .x x, .r r } inc_rev trim then } .then,
  { .x /_ a, .c /1 b, { .y x, .r r } inc_rev trim then } .then,
  <
    { .x /0 x, .y /0 y, .c /0 |0 c, .r |0 r },
    { .x /0 x, .y /0 y, .c /1 |0 c, .r |1 r },
    { .x /0 x, .y /1 y, .c /0 |0 c, .r |1 r },
    { .x /0 x, .y /1 y, .c /1 |1 c, .r |0 r },
    { .x /1 x, .y /0 y, .c /0 |0 c, .r |1 r },
    { .x /1 x, .y /0 y, .c /1 |1 c, .r |0 r },
    { .x /1 x, .y /1 y, .c /0 |1 c, .r |0 r },
    { .x /1 x, .y /1 y, .c /1 |1 c, .r |1 r }
  > plus_loop
> ?bits[];

plus = ?nat_pair[] { .x inv x, .y inv y, 0 c, _ r } plus_loop;

minus_loop = ?{ bits[] x, bits[] y, bit[] c, bits[] r } <
  { .y /_ a, .c /0 b, { .x x, .r r } inv_loop trim then } .then,
  { .y /_ a, .c /1 b, { .x x, .r r } dec_rev trim then } .then,
  <
    { .x /0 x, .y /0 y, .c /0 |0 c, .r |0 r },
    { .x /0 x, .y /0 y, .c /1 |1 c, .r |1 r },
    { .x /0 x, .y /1 y, .c /0 |1 c, .r |1 r },
    { .x /0 x, .y /1 y, .c /1 |1 c, .r |0 r },
    { .x /1 x, .y /0 y, .c /0 |0 c, .r |1 r },
    { .x /1 x, .y /0 y, .c /1 |0 c, .r |0 r },
    { .x /1 x, .y /1 y, .c /0 |0 c, .r |0 r },
    { .x /1 x, .y /1 y, .c /1 |1 c, .r |1 r }
  > minus_loop
> ?bits[];

minus = ?nat_pair[] { .x inv x, .y inv y, 0 c, _ r } minus_loop;

twice = ?bits[] <
  /_ _,
  { inv |0 x, _ r } inv_loop
> ?bits[];

tenfold = ?bits[] <
  /_ _,
  inv { |0 x, |0 |0 |0 y, 0 c, _ r } plus_loop
> ?bits[];

lsb = ?bits[] <
  /0 { 0 bit, () rest },
  /1 { 1 bit, () rest },
  /_ { 0 bit, _ rest }
>;

ascii = |ascii ?unicode[];

_0_ = { 0 0, 0 1, 0 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_1_ = { 1 0, 0 1, 0 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_2_ = { 0 0, 1 1, 0 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_3_ = { 1 0, 1 1, 0 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_4_ = { 0 0, 0 1, 1 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_5_ = { 1 0, 0 1, 1 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_6_ = { 0 0, 1 1, 1 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_7_ = { 1 0, 1 1, 1 2, 0 3, 1 4, 1 5, 0 6 } ascii;
_8_ = { 0 0, 0 1, 0 2, 1 3, 1 4, 1 5, 0 6 } ascii;
_9_ = { 1 0, 0 1, 0 2, 1 3, 1 4, 1 5, 0 6 } ascii;

_plus_  = { 1 0, 1 1, 0 2, 1 3, 0 4, 1 5, 0 6 } ascii;
_minus_ = { 1 0, 0 1, 1 2, 1 3, 0 4, 1 5, 0 6 } ascii;
_dot_   = { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 0 6 } ascii;
_e_     = { 1 0, 0 1, 1 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_E_     = { 1 0, 0 1, 1 2, 0 3, 0 4, 0 5, 1 6 } ascii;

-- Match leading 'e' from string[]. Input: ?string[], Output: ?string[] (tail of string)
e_char     = ?string[] /cons { { .car x, _e_ y } eq_char? if, .cdr then } .then;
-- Match leading 'E' from string[]. Input: ?string[], Output: ?string[] (tail of string)
E_char     = ?string[] /cons { { .car x, _E_ y } eq_char? if, .cdr then } .then;
-- Match leading '-' from string[]. Input: ?string[], Output: ?string[] (tail of string)
minus_char = ?string[] /cons { { .car x, _minus_ y } eq_char? if, .cdr then } .then;
-- Match leading '+' from string[]. Input: ?string[], Output: ?string[] (tail of string)
plus_char  = ?string[] /cons { { .car x, _plus_ y } eq_char? if, .cdr then } .then;
-- Match leading '.' from string[]. Input: ?string[], Output: ?string[] (tail of string)
dot_char   = ?string[] /cons { { .car x, _dot_ y } eq_char? if, .cdr then } .then;

-- Parse one leading ASCII decimal digit ('0'..'9') from a character string.
-- Input:  ?string[]       - character string (list of unicode code points)
-- Output: ?digit_result[] - { rest: remaining string[], value: bits[] in 0..9 }
-- Fails if the string is empty or does not start with a decimal digit ('0'..'9').
scan_digit = ?string[] /cons { .cdr rest, .car <
  { () x, _0_ y } eq_char? _,
  { () x, _1_ y } eq_char? _ |1,
  { () x, _2_ y } eq_char? _ |0 |1,
  { () x, _3_ y } eq_char? _ |1 |1,
  { () x, _4_ y } eq_char? _ |0 |0 |1,
  { () x, _5_ y } eq_char? _ |1 |0 |1,
  { () x, _6_ y } eq_char? _ |0 |1 |1,
  { () x, _7_ y } eq_char? _ |1 |1 |1,
  { () x, _8_ y } eq_char? _ |0 |0 |0 |1,
  { () x, _9_ y } eq_char? _ |1 |0 |0 |1
> value } ?digit_result[];
parse_digit = scan_digit;
digit = scan_digit;

-- Unpack lowest 8 bits from bits[] into a byte record { 0..7 } and remaining bits.
-- Input:  bits[]
-- Output: { byte: { 0..7 }, rest: bits[] }
take_byte = lsb
  { .bit b0, .rest lsb tail }
  { .b0 b0, .tail.bit b1, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .tail.bit b2, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .tail.bit b3, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .tail.bit b4, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .tail.bit b5, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .b5 b5, .tail.bit b6, .tail.rest lsb tail }
  { { .b0 0, .b1 1, .b2 2, .b3 3, .b4 4, .b5 5, .b6 6, .tail.bit 7 } byte, .tail.rest rest };

-- Unpack lowest 4 bits from bits[] into a nibble record { 0..3 } and remaining bits.
-- Input:  bits[]
-- Output: { byte: { 0..3 }, rest: bits[] }
take_nibble = lsb
  { .bit b0, .rest lsb tail }
  { .b0 b0, .tail.bit b1, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .tail.bit b2, .tail.rest lsb tail }
  { { .b0 0, .b1 1, .b2 2, .tail.bit 3 } byte, .tail.rest rest };

-- Unpack a 16-bit integer and plane from bits[].
-- Input:  bits[]
-- Output: { lo: byte, hi: byte, plane: bits[] }
unpack16 = inv take_byte
  { .byte lo, .rest take_byte high }
  { .lo lo, .high.byte hi, .high.rest inv trim plane };

-- Bit field projections from a byte record { 0..7 }:
field1 = { .0 0 };
field2 = { .0 0, .1 1 };
field3 = { .0 0, .1 1, .2 2 };
field4 = { .0 0, .1 1, .2 2, .3 3 };
field7 = { .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6 };

-- Convert unpacked 16-bit lo/hi bytes into an 11-bit IEEE exponent field exp11[].
-- Input:  { lo: byte, hi: byte, ... }
-- Output: exp11[]
exp_field = unpack16 {
  .lo.0 0, .lo.1 1, .lo.2 2, .lo.3 3, .lo.4 4, .lo.5 5, .lo.6 6, .lo.7 7,
  .hi.0 8, .hi.1 9, .hi.2 10
};

-- Unpack 52 fraction bits and lead bit from bits[].
-- Input:  bits[]
-- Output: { fraction: frac52[], lead: bits[] }
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

c52   = _ |0 |0 |1 |0 |1 |1 ?bits[];
c400  = _ |0 |0 |0 |0 |1 |0 |0 |1 |1 ?bits[];
c1023 = _ |1 |1 |1 |1 |1 |1 |1 |1 |1 |1 ?bits[];
c2047 = _ |1 |1 |1 |1 |1 |1 |1 |1 |1 |1 |1 ?bits[];

-- Extract small bitfields (1, 2, 3, 4, 7 bits) from reversed bits[].
-- Input:  bits[]
-- Output: field struct (field1..field7)
small1 = inv take_byte .byte field1;
small2 = inv take_byte .byte field2;
small3 = inv take_byte .byte field3;
small4 = inv take_byte .byte field4;
small7 = inv take_byte .byte field7;

-- Parse an unsigned decimal number (leading integer digits, optional fraction).
-- Input:  ?string[]
-- Output: ?decimal[] = { rest: string[], n: bits[], d: bits[], count: bits[] }
unsigned_decimal = ?string[] scan_digit {
  .rest rest, .value n, 1b d, 1b count
} <
  { .n /_ if, () then } .then,
  integer_digits
> < fraction_first fraction_digits, () > ?decimal[];

-- Parse signed decimal and optional exponent, converted to binary64 float64[].
-- Input:  { rest: string[], sign: sign[] }
-- Output: ?result[] = { rest: string[], value: float64[] }
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
} ?result[];

-- Parse a decimal number with optional leading '-' or '+' sign.
-- Input:  ?string[]
-- Output: ?result[] = { rest: string[], value: float64[] }
number = ?string[] <
  minus_char { () rest, - sign },
  { () rest, + sign }
> signed_decimal ?result[];

-- Parse subsequent integer digits, accumulating n = n * 10 + digit.
-- Input:  ?decimal[]
-- Output: ?decimal[]
integer_digits = ?decimal[] <
  { .rest scan_digit digit, () decimal } {
    .digit.rest rest,
    { .decimal.n tenfold x, .digit.value y } plus n,
    .decimal.d d, .decimal.count inc count
  } integer_digits,
  ()
> ?decimal[];

-- Parse the decimal point '.' and the required first fraction digit.
-- Input:  ?decimal[]
-- Output: ?decimal[]
fraction_first = ?decimal[] {
  .rest dot_char scan_digit digit, () decimal
} {
  .digit.rest rest,
  { .decimal.n tenfold x, .digit.value y } plus n,
  .decimal.d tenfold d, .decimal.count inc count
};

-- Parse subsequent fractional digits, accumulating n = n * 10 + digit and d = d * 10.
-- Input:  ?decimal[]
-- Output: ?decimal[]
fraction_digits = ?decimal[] <
  { .rest scan_digit digit, () decimal } {
    .digit.rest rest,
    { .decimal.n tenfold x, .digit.value y } plus n,
    .decimal.d tenfold d, .decimal.count inc count
  } fraction_digits,
  ()
> ?decimal[];

-- Parse the exponent component ('e' or 'E' followed by optional sign and digits).
-- Input:  ?string[]
-- Output: { rest: string[], value: bits[], sign: sign[] }
exponent_part = < e_char, E_char > <
  minus_char { () rest, - sign },
  plus_char { () rest, + sign },
  { () rest, + sign }
> { .rest scan_digit exponent_digits digits, .sign sign }
  { .digits.rest rest, .digits.value value, .sign sign };

-- Parse exponent digits into bits[] accumulator.
-- Input:  ?digit_result[] = { string[] rest, bits[] value }
-- Output: ?digit_result[]
exponent_digits = ?digit_result[] <
  { .rest scan_digit next, .value tenfold high }
  { .next.rest rest, { .high x, .next.value y } plus value }
    exponent_digits,
  ()
> ?digit_result[];

signed_zero = { .sign sign, exp0 exponent, frac0 fraction };

decimal_float = <
  { .n /_ if, signed_zero then } .then,
  {
    () decimal,
    { .exponent.value x, { .count x, c400 y } plus y } cmp order
  } <
    {
      .order /gt a, .decimal.exponent.sign /- b,
      .decimal signed_zero then
    } .then,
    {
      .order /gt a, .decimal.exponent.sign /+ b,
      { .decimal.sign sign, exp_all1 exponent, frac0 fraction } then
    } .then,
    {
      .order </lt, /eq> if,
      {
        {
          .decimal.n n, .decimal.d d,
          .decimal.exponent.value power, .decimal.exponent.sign direction
        } scale_decimal ratio fields,
        .decimal.sign sign
      } { .sign sign, .fields.exponent exponent, .fields.fraction fraction } then
    } .then
  >
> ?float64[];

scale_decimal = ?{ bits[] n, bits[] d, bits[] power, sign[] direction } <
  { .power /_ if, { .n n, .d d } then } .then,
  <
    { .n tenfold n, .d d, .power dec power, .direction +? direction },
    { .n n, .d tenfold d, .power dec power, .direction -? direction }
  > scale_decimal
> ?{ bits[] n, bits[] d };

ratio = ?{ bits[] n, bits[] d } {
  .n n, .d d, .n x, .d y, c1023 exponent
} align;

align = ?{ bits[] n, bits[] d, bits[] x, bits[] y, bits[] exponent } <
  { .x /_ a, .y /_ b, { .n n, .d d, .exponent exponent } normalized then } .then,
  {
    .y /_ if,
    { .n n, .d inv denominator, .x steps, .exponent exponent } align_down then
  } .then,
  {
    .x /_ if,
    { .n inv numerator, .d d, .y steps, .exponent exponent } align_up then
  } .then,
  { .n n, .d d, .x </0, /1> x, .y </0, /1> y, .exponent exponent } align
> ?{ exp11[] exponent, frac52[] fraction };

align_down = ?{ bits[] n, bits[] denominator, bits[] steps, bits[] exponent } <
  {
    .steps /_ if,
    { .n n, .denominator inv d, .exponent exponent } normalized then
  } .then,
  {
    .exponent /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /_ if,
    { exp_all1 exponent, frac0 fraction } then
  } .then,
  { .n n, .denominator |0 denominator, .steps </0, /1> steps, .exponent inc exponent } align_down
> ?{ exp11[] exponent, frac52[] fraction };

align_up = ?{ bits[] numerator, bits[] d, bits[] steps, bits[] exponent } <
  {
    < .steps /_, .exponent /1 /_ > if,
    { .numerator inv n, .d d, .exponent exponent } normalized then
  } .then,
  { .numerator |0 numerator, .d d, .steps </0, /1> steps, .exponent dec exponent } align_up
> ?{ exp11[] exponent, frac52[] fraction };

ratio_less? = { .n x, .d y } lt?;

normalized = ?{ bits[] n, bits[] d, bits[] exponent } <
  {
    ratio_less? if,
    .exponent /1 /_ and,
    { .n n, .d d, _ exponent, _ acc, c52 left } fraction_loop then
  } .then,
  {
    ratio_less? if,
    {
      { .n twice x, .d y } minus n,
      .d d, .exponent dec exponent, 1b acc, c52 left
    } fraction_loop then
  } .then,
  {
    { .n x, .d y } minus n,
    .d d, .exponent exponent, 1b acc, c52 left
  } fraction_loop
> ?{ exp11[] exponent, frac52[] fraction };

fraction_loop = ?{
  bits[] n, bits[] d, bits[] exponent, bits[] acc, bits[] left
} <
  { .left /_ if, round then } .then,
  { .n twice n, .d d, .exponent exponent, .acc acc, .left dec left } <
    {
      { .n x, .d y } lt? .x n,
      .d d, .exponent exponent, .acc |0 acc, .left left
    },
    {
      { .n x, .d y } minus n,
      .d d, .exponent exponent, .acc |1 acc, .left left
    }
  > fraction_loop
> ?{ exp11[] exponent, frac52[] fraction };

inc_lsb = ?bits[] { () x, _ r } inc_rev inv;

round = {
  () state, { .n twice x, .d y } cmp order
} {
  .state.exponent exponent,
  <
    { .order /gt if, .state.acc inc_lsb then } .then,
    { .order /eq a, .state.acc /1 b, .state.acc inc_lsb then } .then,
    .state.acc
  > mantissa mantissa
} {
  .mantissa.fraction fraction,
  <
    { .exponent /_ a, .mantissa.lead /1 b, 1b then } .then,
    { .mantissa.lead /0 /1 /_ if, .exponent inc then } .then,
    .exponent
  > exponent
} {
  () fields,
  { .exponent x, c2047 y } cmp order
} <
  { .order /lt if, { .fields.exponent exp_field exponent, .fields.fraction fraction } then } .then,
  { exp_all1 exponent, frac0 fraction }
>;

-- Text boundary helpers.
_space_ = { 0 0, 0 1, 0 2, 0 3, 0 4, 1 5, 0 6 } ascii;
_tab_   = { 1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_lf_    = { 0 0, 1 1, 0 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_cr_    = { 1 0, 0 1, 1 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_I_     = { 1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 1 6 } ascii;
_n_     = { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 1 6 } ascii;
_f_     = { 0 0, 1 1, 1 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_i_     = { 1 0, 0 1, 0 2, 1 3, 0 4, 1 5, 1 6 } ascii;
_t_     = { 0 0, 0 1, 1 2, 0 3, 1 4, 1 5, 1 6 } ascii;
_y_     = { 1 0, 0 1, 0 2, 1 3, 1 4, 1 5, 1 6 } ascii;
_N_     = { 0 0, 1 1, 1 2, 1 3, 0 4, 0 5, 1 6 } ascii;
_a_     = { 1 0, 0 1, 0 2, 0 3, 0 4, 1 5, 1 6 } ascii;

-- Match and consume specific ASCII characters from a string[].
-- Input:  ?string[]
-- Output: ?string[] (tail of string)
space  = ?string[] /cons { { .car x, _space_ y } eq_char? if, .cdr then } .then;
tab    = ?string[] /cons { { .car x, _tab_ y } eq_char? if, .cdr then } .then;
lf     = ?string[] /cons { { .car x, _lf_ y } eq_char? if, .cdr then } .then;
cr     = ?string[] /cons { { .car x, _cr_ y } eq_char? if, .cdr then } .then;
I_char = ?string[] /cons { { .car x, _I_ y } eq_char? if, .cdr then } .then;
n_char = ?string[] /cons { { .car x, _n_ y } eq_char? if, .cdr then } .then;
f_char = ?string[] /cons { { .car x, _f_ y } eq_char? if, .cdr then } .then;
i_char = ?string[] /cons { { .car x, _i_ y } eq_char? if, .cdr then } .then;
t_char = ?string[] /cons { { .car x, _t_ y } eq_char? if, .cdr then } .then;
y_char = ?string[] /cons { { .car x, _y_ y } eq_char? if, .cdr then } .then;
N_char = ?string[] /cons { { .car x, _N_ y } eq_char? if, .cdr then } .then;
a_char = ?string[] /cons { { .car x, _a_ y } eq_char? if, .cdr then } .then;

infinity_word = I_char n_char f_char i_char n_char i_char t_char y_char;
nan_word = N_char a_char N_char;

-- Parse special IEEE binary64 words (+/-Infinity, Infinity, +/-NaN, NaN).
-- Input:  ?string[]
-- Output: ?result[] = { rest: string[], value: float64[] }
special = <
  minus_char infinity_word { () rest, neg_inf value },
  plus_char infinity_word { () rest, pos_inf value },
  infinity_word { () rest, pos_inf value },
  < minus_char, plus_char, () > nan_word { () rest, qnan value }
>;

zero_text = { _0_ car, nil cdr } cons ?string[];
negative_zero_text = { _minus_ car, zero_text cdr } cons ?string[];
infinity_text = {
  _I_ car, { _n_ car, { _f_ car, { _i_ car, {
    _n_ car, { _i_ car, { _t_ car, { _y_ car, nil cdr } cons cdr } cons cdr } cons cdr
  } cons cdr } cons cdr } cons cdr } cons cdr
} cons ?string[];
negative_infinity_text = { _minus_ car, infinity_text cdr } cons ?string[];
nan_text = { _N_ car, { _a_ car, { _N_ car, nil cdr } cons cdr } cons cdr } cons;

c1074 = _ |0 |1 |0 |0 |1 |1 |0 |0 |0 |0 |1 ?bits[];
c1075 = _ |1 |1 |0 |0 |1 |1 |0 |0 |0 |0 |1 ?bits[];

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

-- Decimal digit arithmetic for exact, round-trip-safe printing.
list[X] = < {} nil, { X car, L cdr } cons > = L;
cons = | cons ?list[X];
digit_value[] = < {} 0, {} 1, {} 2, {} 3, {} 4, {} 5, {} 6, {} 7, {} 8, {} 9 >;
digits[] = list[digit_value[]];
factor[] = < {} 2, {} 5 >;

d0 = {} |0;
d1 = {} |1;
d2 = {} |2;
d3 = {} |3;
d4 = {} |4;
d5 = {} |5;
d6 = {} |6;
d7 = {} |7;
d8 = {} |8;
d9 = {} |9;

digit_ascii = <
  /0 _0_, /1 _1_, /2 _2_, /3 _3_, /4 _4_,
  /5 _5_, /6 _6_, /7 _7_, /8 _8_, /9 _9_
>;

digit_mul2 = <
  { .digit /0 a, .carry /0 b } { d0 digit, d0 carry },
  { .digit /0 a, .carry /1 b } { d1 digit, d0 carry },
  { .digit /1 a, .carry /0 b } { d2 digit, d0 carry },
  { .digit /1 a, .carry /1 b } { d3 digit, d0 carry },
  { .digit /2 a, .carry /0 b } { d4 digit, d0 carry },
  { .digit /2 a, .carry /1 b } { d5 digit, d0 carry },
  { .digit /3 a, .carry /0 b } { d6 digit, d0 carry },
  { .digit /3 a, .carry /1 b } { d7 digit, d0 carry },
  { .digit /4 a, .carry /0 b } { d8 digit, d0 carry },
  { .digit /4 a, .carry /1 b } { d9 digit, d0 carry },
  { .digit /5 a, .carry /0 b } { d0 digit, d1 carry },
  { .digit /5 a, .carry /1 b } { d1 digit, d1 carry },
  { .digit /6 a, .carry /0 b } { d2 digit, d1 carry },
  { .digit /6 a, .carry /1 b } { d3 digit, d1 carry },
  { .digit /7 a, .carry /0 b } { d4 digit, d1 carry },
  { .digit /7 a, .carry /1 b } { d5 digit, d1 carry },
  { .digit /8 a, .carry /0 b } { d6 digit, d1 carry },
  { .digit /8 a, .carry /1 b } { d7 digit, d1 carry },
  { .digit /9 a, .carry /0 b } { d8 digit, d1 carry },
  { .digit /9 a, .carry /1 b } { d9 digit, d1 carry }
>;

digit_mul5 = <
  { .digit /0 a, .carry /0 b } { d0 digit, d0 carry },
  { .digit /0 a, .carry /1 b } { d1 digit, d0 carry },
  { .digit /0 a, .carry /2 b } { d2 digit, d0 carry },
  { .digit /0 a, .carry /3 b } { d3 digit, d0 carry },
  { .digit /0 a, .carry /4 b } { d4 digit, d0 carry },
  { .digit /1 a, .carry /0 b } { d5 digit, d0 carry },
  { .digit /1 a, .carry /1 b } { d6 digit, d0 carry },
  { .digit /1 a, .carry /2 b } { d7 digit, d0 carry },
  { .digit /1 a, .carry /3 b } { d8 digit, d0 carry },
  { .digit /1 a, .carry /4 b } { d9 digit, d0 carry },
  { .digit /2 a, .carry /0 b } { d0 digit, d1 carry },
  { .digit /2 a, .carry /1 b } { d1 digit, d1 carry },
  { .digit /2 a, .carry /2 b } { d2 digit, d1 carry },
  { .digit /2 a, .carry /3 b } { d3 digit, d1 carry },
  { .digit /2 a, .carry /4 b } { d4 digit, d1 carry },
  { .digit /3 a, .carry /0 b } { d5 digit, d1 carry },
  { .digit /3 a, .carry /1 b } { d6 digit, d1 carry },
  { .digit /3 a, .carry /2 b } { d7 digit, d1 carry },
  { .digit /3 a, .carry /3 b } { d8 digit, d1 carry },
  { .digit /3 a, .carry /4 b } { d9 digit, d1 carry },
  { .digit /4 a, .carry /0 b } { d0 digit, d2 carry },
  { .digit /4 a, .carry /1 b } { d1 digit, d2 carry },
  { .digit /4 a, .carry /2 b } { d2 digit, d2 carry },
  { .digit /4 a, .carry /3 b } { d3 digit, d2 carry },
  { .digit /4 a, .carry /4 b } { d4 digit, d2 carry },
  { .digit /5 a, .carry /0 b } { d5 digit, d2 carry },
  { .digit /5 a, .carry /1 b } { d6 digit, d2 carry },
  { .digit /5 a, .carry /2 b } { d7 digit, d2 carry },
  { .digit /5 a, .carry /3 b } { d8 digit, d2 carry },
  { .digit /5 a, .carry /4 b } { d9 digit, d2 carry },
  { .digit /6 a, .carry /0 b } { d0 digit, d3 carry },
  { .digit /6 a, .carry /1 b } { d1 digit, d3 carry },
  { .digit /6 a, .carry /2 b } { d2 digit, d3 carry },
  { .digit /6 a, .carry /3 b } { d3 digit, d3 carry },
  { .digit /6 a, .carry /4 b } { d4 digit, d3 carry },
  { .digit /7 a, .carry /0 b } { d5 digit, d3 carry },
  { .digit /7 a, .carry /1 b } { d6 digit, d3 carry },
  { .digit /7 a, .carry /2 b } { d7 digit, d3 carry },
  { .digit /7 a, .carry /3 b } { d8 digit, d3 carry },
  { .digit /7 a, .carry /4 b } { d9 digit, d3 carry },
  { .digit /8 a, .carry /0 b } { d0 digit, d4 carry },
  { .digit /8 a, .carry /1 b } { d1 digit, d4 carry },
  { .digit /8 a, .carry /2 b } { d2 digit, d4 carry },
  { .digit /8 a, .carry /3 b } { d3 digit, d4 carry },
  { .digit /8 a, .carry /4 b } { d4 digit, d4 carry },
  { .digit /9 a, .carry /0 b } { d5 digit, d4 carry },
  { .digit /9 a, .carry /1 b } { d6 digit, d4 carry },
  { .digit /9 a, .carry /2 b } { d7 digit, d4 carry },
  { .digit /9 a, .carry /3 b } { d8 digit, d4 carry },
  { .digit /9 a, .carry /4 b } { d9 digit, d4 carry }
>;

reverse_loop = ?{ list[X] x, list[X] acc } <
  { .x /nil if, .acc then } .then,
  { .x /cons .cdr x, { .x /cons .car car, .acc cdr } cons acc } reverse_loop
> ?list[X];

reverse = ?list[X] { () x, nil acc } reverse_loop ?list[X];

digits_multiply_loop = ?{
  digits[] x, factor[] factor, digit_value[] carry, digits[] acc
} <
  { .x /nil a, .carry /0 b, .acc reverse then } .then,
  { .x /nil if, { .carry car, .acc cdr } cons reverse then } .then,
  {
    .x /cons .cdr x, .factor factor, .acc acc,
    { .x /cons .car digit, .carry carry, .factor factor } <
      { .factor /2 if, { .digit digit, .carry carry } digit_mul2 then } .then,
      { .factor /5 if, { .digit digit, .carry carry } digit_mul5 then } .then
    > next
  } { .x x, .factor factor, .next.carry carry, { .next.digit car, .acc cdr } cons acc }
    digits_multiply_loop
> ?digits[];

digits_multiply = ?{ digits[] digits, factor[] factor, digit_value[] carry } {
  .digits x, .factor factor, .carry carry, nil acc
} digits_multiply_loop;

binary_digits_loop = ?{ bits[] bits, digits[] digits } <
  { .bits /_ if, .digits then } .then,
  <
    { .bits /0 bits, { .digits digits, d2 factor, d0 carry } digits_multiply digits },
    { .bits /1 bits, { .digits digits, d2 factor, d1 carry } digits_multiply digits }
  > binary_digits_loop
> ?digits[];

binary_digits = ?bits[] {
  () bits, { d0 car, nil cdr } cons digits
} binary_digits_loop;

digits_power = ?{ digits[] digits, factor[] factor, bits[] steps } <
  { .steps /_ if, .digits then } .then,
  {
    { .digits digits, .factor factor, d0 carry } digits_multiply digits,
    .factor factor,
    .steps dec steps
  } digits_power
> ?digits[];

-- Remove binary factors of two before generating fractional decimal places.
cancel_twos = ?{ bits[] reversed, bits[] places } <
  { < .places /_, .reversed </1 {}, /_> > if, () then } .then,
  { .reversed /0 reversed, .places dec places } cancel_twos
> ?{ bits[] reversed, bits[] places };

fraction_digits_print = cancel_twos {
  .reversed inv trim binary_digits digits,
  d5 factor, .places steps, .places places
} { { .digits digits, .factor factor, .steps steps } digits_power digits, .places places };

print_ratio = ?float64[] {
  .fraction fraction_bits fraction,
  .exponent exponent_bits trim exponent
} <
  {
    .exponent /_ if,
    { .fraction inv reversed, c1074 places } fraction_digits_print then
  } .then,
  {
    { .exponent x, c1075 y } lt? if,
    { .fraction |1 inv reversed,
      { c1075 x, .exponent y } minus places } fraction_digits_print then
  } .then,
  {
    .fraction |1 binary_digits digits, d2 factor,
    { .exponent x, c1075 y } minus steps
  } digits_power { () digits, _ places }
>;

-- Consume least-significant digits, prepending characters in display order.
fraction_text = ?{ digits[] digits, bits[] places, string[] acc } <
  { .places /_ if, { .digits digits, .acc acc } then } .then,
  {
    < .digits /cons .cdr, nil > digits,
    .places dec places,
    { < .digits /cons .car, d0 > digit_ascii car, .acc cdr } cons acc
  } fraction_text
> ?{ digits[] digits, string[] acc };

integer_text_loop = ?{ digits[] digits, string[] acc } <
  { .digits /nil if, .acc then } .then,
  {
    .digits /cons .cdr digits,
    { .digits /cons .car digit_ascii car, .acc cdr } cons acc
  } integer_text_loop
> ?string[];

integer_text = ?{ digits[] digits, string[] acc } <
  { .digits /nil if, { _0_ car, .acc cdr } cons then } .then,
  integer_text_loop
> ?string[];

format_decimal = ?{ digits[] digits, bits[] places } <
  { .places /_ if, { .digits digits, nil acc } integer_text then } .then,
  { .digits digits, .places places, nil acc } fraction_text
  { .digits digits, { _dot_ car, .acc cdr } cons acc } integer_text
> ?string[];
