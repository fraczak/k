-- Karatsuba multiplication O(n^1.585)
-- Self-contained and minimal implementation
-- for arbitrary-precision integers

yes = {} | yes;
no = {} | no;

bits = ?< {} _, bits 0, bits 1 > = bits;
0b = {} | _;
0 = 0b |0;
1 = 0b |1;

unat = ?< {} _, unat 1 > = unat;
0u = {} | _;

empty = < /_ yes, no >;
empty? = {empty /yes if, () then} .then;

inv = {()x, 0b r} _inv;
_inv = ?{ <X 0, X 1, {} _>=X x, ... }
<
  {.x empty? if, .r then} .then,
  <
    {.x /0 x, .r |0 r},
    {.x /1 x, .r |1 r}
  > _inv
>;

concat = {.x inv x, .y y} concat_;
concat_ = ?{ <X 0, X 1, {} _>=X x, ... }
<
  {.x empty? if, .y then} .then,
  <
    {.x /0 x, .y |0 y},
    {.x /1 x, .y |1 y}
  > concat_
>;

remove_leading_zeros = < /0 remove_leading_zeros, () >;
nat = remove_leading_zeros <empty? 0, ()>;

int = nat | '+';
abs = </'+', /'-'>;

sign_plus = {} | '+';
sign_minus = {} | '-';
swap_sign = < /'+' | '-', /'-' | '+' >;

c0 = {} | 0;
c1 = {} | 1;

_plus = {.x x, .y y, .c c, 0b r} _plus_;
_plus_ = ?{ <X 0, X 1, {} _>=X x, ... }
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
_minus_ = ?{ <X 0, X 1, {} _>=X x, ... }
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

plus_bits = {.x inv x, .y inv y, c0 c} _plus inv nat;
minus_bits = {.x inv x, .y inv y, c0 c} _minus inv nat;

_times = ?{ <Y 0, Y 1, {} _>=Y y, ... }
<
  {.y empty? if, .result then} .then,
  <
    {.result |0 result, ._x _x, .y /0 y},
    {{._x x, .result |0 y, c0 c} _plus result, ._x _x, .y /1 y}
  > _times
>;
times_bits = {0 result, .x inv _x, .y y} _times inv nat;

unat_to_zeros = ?< {} _, X 1 >=X < /_ 0b, /1 unat_to_zeros |0 > ?< {} _, Z 0, Z 1 >=Z;
unat_to_double_zeros = ?< {} _, X 1 >=X
  < /_ 0b, /1 unat_to_double_zeros |0 |0 > ?< {} _, Z 0, Z 1 >=Z;

_peel2 = < </0,/1> </0,/1>, </0,/1>, () >;
_half_unat = ?{ <X 0, X 1, {} _>=X x, ... }
<
  {.x empty? if, .y empty? and, .m then} .then,
  {.x _peel2 x, .y _peel2 y, .m |1 m} _half_unat
>;
half_unat = {.x x, .y y, 0u m} _half_unat;

_split_rev_u = ?{ <X 0, X 1, {} _>=X x_rev, <M 1, {} _>=M m, ... }
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

shift_bits_u =
<
  {.val empty? if, 0b then} .then,
  {.val x, .m unat_to_zeros y} concat
>;

shift2_bits_u =
<
  {.val empty? if, 0b then} .then,
  {.val x, .m unat_to_double_zeros y} concat
>;

_karatsuba = ?{ <X 0, X 1, {} _>=X x, <Y 0, Y 1, {} _>=Y y }
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

karatsuba =
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
