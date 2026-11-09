-- lib/bits.k — Unary-tagged binary sequences (bits[]) and 8-bit octets (byte[])

---------------------------------------------------------------
-- §1. Base Patterns & Primitives (bit[], order[])
---------------------------------------------------------------

bit[]   = < {} 0, {} 1 >;
order[] = < {} lt, {} eq, {} gt >;

0     = {} |0 ?bit[];
1     = {} |1 ?bit[];
is0   = ?bit[] /0;
is1   = ?bit[] /1;
lt    = {} |lt ?order[];
eq    = {} |eq ?order[];
gt    = {} |gt ?order[];
un_lt = ?order[] /lt;
un_eq = ?order[] /eq;
un_gt = ?order[] /gt;

---------------------------------------------------------------
-- §2. Patterns & Primitive Constructors/Destructors
---------------------------------------------------------------

bits[] = < {} _, B 0, B 1 > = B;

byte[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6, bit[] 7
};

-- Only the 6 atomic primitives mention ?bits[]
_   = {} |_ ?bits[];
0b  = |0 ?bits[];
1b  = |1 ?bits[];
un_ = ?bits[] /_;
un0 = ?bits[] /0;
un1 = ?bits[] /1;

_?  = un_ _;
c0  = _ 0b;
c1  = _ 1b;

---------------------------------------------------------------
-- §3. Structural Bit & Byte Operations
---------------------------------------------------------------

push_bit = <
  { .b is0 if, .acc 0b then } .then,
  { .b is1 if, .acc 1b then } .then
>;

push_bits1  = { .x .0 b, .acc acc } push_bit;
push_bits2  = { .x .1 b, { .x x, .acc acc } push_bits1 acc } push_bit;
push_bits3  = { .x .2 b, { .x x, .acc acc } push_bits2 acc } push_bit;
push_bits4  = { .x .3 b, { .x x, .acc acc } push_bits3 acc } push_bit;
push_bits5  = { .x .4 b, { .x x, .acc acc } push_bits4 acc } push_bit;
push_bits6  = { .x .5 b, { .x x, .acc acc } push_bits5 acc } push_bit;
push_bits7  = { .x .6 b, { .x x, .acc acc } push_bits6 acc } push_bit;
push_bits8  = { .x .7 b, { .x x, .acc acc } push_bits7 acc } push_bit;
push_bits9  = { .x .8 b, { .x x, .acc acc } push_bits8 acc } push_bit;
push_bits10 = { .x .9 b, { .x x, .acc acc } push_bits9 acc } push_bit;
push_bits11 = { .x .10 b, { .x x, .acc acc } push_bits10 acc } push_bit;

read_bit = <
  { 0 bit, un0 rest },
  { 1 bit, un1 rest }
>;

lsb = <
  { 0 bit, un0 rest },
  { 1 bit, un1 rest },
  un_ { 0 bit, _ rest }
>;

take_nibble = lsb
  { .bit b0, .rest lsb tail }
  { .b0 b0, .tail.bit b1, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .tail.bit b2, .tail.rest lsb tail }
  { { .b0 0, .b1 1, .b2 2, .tail.bit 3 } byte, .tail.rest rest };

take_byte = lsb
  { .bit b0, .rest lsb tail }
  { .b0 b0, .tail.bit b1, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .tail.bit b2, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .tail.bit b3, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .tail.bit b4, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .tail.bit b5, .tail.rest lsb tail }
  { .b0 b0, .b1 b1, .b2 b2, .b3 b3, .b4 b4, .b5 b5, .tail.bit b6, .tail.rest lsb tail }
  { { .b0 0, .b1 1, .b2 2, .b3 3, .b4 4, .b5 5, .b6 6, .tail.bit 7 } byte, .tail.rest rest };

field1 = { .0 0 };
field2 = { .0 0, .1 1 };
field3 = { .0 0, .1 1, .2 2 };
field4 = { .0 0, .1 1, .2 2, .3 3 };
field7 = { .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6 };

---------------------------------------------------------------
-- §4. Binary Natural Arithmetic
---------------------------------------------------------------

trim = <
  un1 1b,
  _?,
  un0 trim
>;

inv_loop = <
  { .x _? if, .r then } .then,
  <
    { .x un0 x, .r 0b r },
    { .x un1 x, .r 1b r }
  > inv_loop
>;

inv = { () x, _ r } inv_loop;

unpack16 = inv take_byte
  { .byte lo, .rest take_byte high }
  { .lo lo, .high.byte hi, .high.rest inv trim plane };

small1 = inv take_byte .byte field1;
small2 = inv take_byte .byte field2;
small3 = inv take_byte .byte field3;
small4 = inv take_byte .byte field4;
small7 = inv take_byte .byte field7;

inc_rev = <
  { .x _? if, .r 1b then } .then,
  { .x un0 x, .r 1b r } inv_loop,
  { .x un1 x, .r 0b r } inc_rev
>;

inc = { inv x, _ r } inc_rev;
inc_lsb = { () x, _ r } inc_rev inv;

dec_rev = <
  { .x un1 x, .r 0b r } inv_loop,
  { .x un0 x, .r 1b r } dec_rev
>;

dec = { inv x, _ r } dec_rev trim;

cmp_loop = <
  { .x un_ a, .y un_ b, .order then } .then,
  { .x un_ a, .y <un0, un1> b } lt,
  { .x <un0, un1> a, .y un_ b } gt,
  <
    { .x un0 x, .y un1 y, .order un_eq lt order },
    { .x un1 x, .y un0 y, .order un_eq gt order },
    { .x <un0, un1> x, .y <un0, un1> y, .order order }
  > cmp_loop
>;

cmp = { .x x, .y y, eq order } cmp_loop;
lt? = { cmp un_lt if, () then } .then;
eq? = { cmp un_eq if, () then } .then;

plus_loop = <
  { .y un_ a, .c is0 b, { .x x, .r r } inv_loop trim then } .then,
  { .x un_ a, .c is0 b, { .y x, .r r } inv_loop trim then } .then,
  { .y un_ a, .c is1 b, { .x x, .r r } inc_rev trim then } .then,
  { .x un_ a, .c is1 b, { .y x, .r r } inc_rev trim then } .then,
  <
    { .x un0 x, .y un0 y, .c is0 0 c, .r 0b r },
    { .x un0 x, .y un0 y, .c is1 0 c, .r 1b r },
    { .x un0 x, .y un1 y, .c is0 0 c, .r 1b r },
    { .x un0 x, .y un1 y, .c is1 1 c, .r 0b r },
    { .x un1 x, .y un0 y, .c is0 0 c, .r 1b r },
    { .x un1 x, .y un0 y, .c is1 1 c, .r 0b r },
    { .x un1 x, .y un1 y, .c is0 1 c, .r 0b r },
    { .x un1 x, .y un1 y, .c is1 1 c, .r 1b r }
  > plus_loop
>;

plus = { .x inv x, .y inv y, 0 c, _ r } plus_loop;

minus_loop = <
  { .y un_ a, .c is0 b, { .x x, .r r } inv_loop trim then } .then,
  { .y un_ a, .c is1 b, { .x x, .r r } dec_rev trim then } .then,
  <
    { .x un0 x, .y un0 y, .c is0 0 c, .r 0b r },
    { .x un0 x, .y un0 y, .c is1 1 c, .r 1b r },
    { .x un0 x, .y un1 y, .c is0 1 c, .r 1b r },
    { .x un0 x, .y un1 y, .c is1 1 c, .r 0b r },
    { .x un1 x, .y un0 y, .c is0 0 c, .r 1b r },
    { .x un1 x, .y un0 y, .c is1 0 c, .r 0b r },
    { .x un1 x, .y un1 y, .c is0 0 c, .r 0b r },
    { .x un1 x, .y un1 y, .c is1 1 c, .r 1b r }
  > minus_loop
>;

minus = { .x inv x, .y inv y, 0 c, _ r } minus_loop;

twice = <
  _?,
  { inv 0b x, _ r } inv_loop
>;

tenfold = <
  _?,
  inv { 0b x, 0b 0b 0b y, 0 c, _ r } plus_loop
>;

times16 = <
  _?,
  { inv 0b 0b 0b 0b x, _ r } inv_loop
>;

times1024 = <
  _?,
  { inv 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b x, _ r } inv_loop
>;

mul_loop = <
  { .y un_ a, .x <_?, un0, un1> b, .acc inv trim then } .then,
  { .y un0 y, .x x, .acc 0b acc } mul_loop,
  { .y un1 y, .x x, { .x x, .acc 0b y, 0 c, _ r } plus_loop inv acc } mul_loop
>;

mul = { .x inv x, .y y, _ acc } mul_loop;

inc_bits   = inc;
dec_bits   = dec;
plus_bits  = plus;
minus_bits = minus;
mul_bits   = mul;
