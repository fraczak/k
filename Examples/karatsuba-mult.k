-- Karatsuba multiplication O(n^1.585)
-- Self-contained and minimal implementation
-- for arbitrary-precision integers

$ yes_no = < {} yes, {} no >;
yes = {} | yes $yes_no;
no = {} | no $yes_no;

$ bits = < {} _, bits 0, bits 1 >;
0b = {} | _;
0 = 0b |0;
1 = 0b |1;

$ unat = < {} _, unat 1 >;
0u = {} | _ $unat;

empty = $bits < /_ yes, no >;
empty? = {empty /yes if, () then} .then;

inv = {()x, 0b r} _inv;
_inv = ${bits x, bits r}
<
  {.x empty? if, .r then} .then,
  <
    {.x /0 x, .r |0 r},
    {.x /1 x, .r |1 r}
  > _inv
>;

concat = ${bits x, bits y} {.x inv x, .y y} concat_;
concat_ = ${bits x, bits y}
<
  {.x empty? if, .y then} .then,
  <
    {.x /0 x, .y |0 y},
    {.x /1 x, .y |1 y}
  > concat_
>;

remove_leading_zeros = < /0 remove_leading_zeros, () >;
nat = remove_leading_zeros <empty? 0, ()>;

$ int = < bits '+', bits '-' >;
int = nat | '+' $int;
abs = $int </'+', /'-'>;

$ sign = < {} '+', {} '-' >;
sign_plus = {} | '+' $sign;
sign_minus = {} | '-' $sign;
swap_sign = < /'+' | '-', /'-' | '+' >;

$ carry = < {} 0, {} 1 >;
c0 = {} | 0 $carry;
c1 = {} | 1 $carry;

_plus = {.x x, .y y, .c c, 0b r} _plus_;
_plus_ = ${bits x, bits y, carry c, bits r}
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
>;

_minus = {.x x, .y y, .c c, 0b r} _minus_;
_minus_ = ${bits x, bits y, carry c, bits r}
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
>;

plus_bits = ${bits x, bits y} {.x inv x, .y inv y, c0 c} _plus inv nat;
minus_bits = ${bits x, bits y} {.x inv x, .y inv y, c0 c} _minus inv nat;

_times = ${bits result, bits _x, bits y}
<
  {.y empty? if, .result then} .then,
  <
    {.result |0 result, ._x _x, .y /0 y},
    {{._x x, .result |0 y, c0 c} _plus result, ._x _x, .y /1 y}
  > _times
>;
times_bits = ${bits x, bits y} {0 result, .x inv _x, .y y} _times inv nat;

unat_to_zeros = $unat < /_ 0b, /1 unat_to_zeros |0 > $bits;
unat_to_double_zeros = $unat
  < /_ 0b, /1 unat_to_double_zeros |0 |0 > $bits;

_peel2 = < </0,/1> </0,/1>, </0,/1>, () >;
_half_unat = ${bits x, bits y, unat m}
<
  {.x empty? if, .y empty? and, .m then} .then,
  {.x _peel2 x, .y _peel2 y, .m |1 m} _half_unat
>;
half_unat = {.x x, .y y, 0u m} _half_unat;

_split_rev_u = ${bits x_rev, unat m, bits low}
<
  {.m /_ if, {.low nat low, .x_rev inv nat high} then} .then,
  {.x_rev empty? if, {.low nat low, 0 high} then} .then,
  <
    {.x_rev /0 x_rev, .m /1 m, .low |0 low},
    {.x_rev /1 x_rev, .m /1 m, .low |1 low}
  > _split_rev_u
>;
split_at = {.x inv x_rev, .m m, 0b low} _split_rev_u;

at_least_256_u? = <
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1
  yes, no
>;

shift_bits_u = ${bits val, unat m}
<
  {.val empty? if, 0b then} .then,
  {.val x, .m unat_to_zeros y} concat
>;

shift2_bits_u = ${bits val, unat m}
<
  {.val empty? if, 0b then} .then,
  {.val x, .m unat_to_double_zeros y} concat
>;

_karatsuba = ${bits x, bits y}
<
  -- Base case: if m < 256 (< 512 bits), fall back to times_bits
  {{.x x, .y y} half_unat m, .x x, .y y}
  <
    {
      .m at_least_256_u? /no if,
      {.x x, .y y} times_bits then
    } .then,
    -- Recursive Karatsuba:
    {
      {.x x, .m m} split_at sx,
      {.y x, .m m} split_at sy,
      .m m
    }
    {
      {.sx.high x, .sy.high y} _karatsuba z2,
      {.sx.low  x, .sy.low  y} _karatsuba z0,
      {
        {.sx.high x, .sx.low y} plus_bits x,
        {.sy.high x, .sy.low y} plus_bits y
      } _karatsuba z_sum,
      .m m
    }
    {
      .z2 z2,
      .z0 z0,
      {{.z_sum x, .z2 y} minus_bits x, .z0 y} minus_bits z1,
      .m m
    }
    {
      {.z2 val, .m m} shift2_bits_u z2_s,
      {.z1 val, .m m} shift_bits_u  z1_s,
      .z0 z0
    }
    {{.z2_s x, .z1_s y} plus_bits x, .z0 y} plus_bits
  >
>;

karatsuba = ${int x, int y}
{
  <
    {.x/'+' if, .y /'+' and} sign_plus,
    {.x/'-' if, .y /'-' and} sign_plus,
    sign_minus
  > sign,
  {.x abs x, .y abs y} _karatsuba result
}
<
  {.sign/'+' if, .result int then} .then,
  {.sign/'-' if, .result int swap_sign then} .then
>;

()
