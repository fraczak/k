# --lib lib/bit.k --use eq_bit?
# --lib lib/bits.k --use byte[] push_bits1 push_bits2 push_bits3 push_bits4 push_bits7 push_bits8 push_bits11 read_bit field7 trim inv unpack16 small1 small2 small3 small4 small7 inc lt? plus minus times16
# --lib lib/list.k --use reverse list_length
# --lib lib/btrie.k --use btrie[V] step_bits1 step_bits2 step_bits3 step_bits4 step_bits7 step_bits8 step_bits11 put_nth remove_nth

-- lib/string.k — ASCII, Unicode code points, and character strings (string[])

---------------------------------------------------------------
-- §1. Base Patterns & Primitives
---------------------------------------------------------------

bit[]   = < {} 0, {} 1 >;
bits[]  = < {} _, B 0, B 1 > = B;
list[X] = < {} nil, { X car, L cdr } cons > = L;
opt[V]  = < {} nil, V val >;

0   = {} |0 ?bit[];
1   = {} |1 ?bit[];
is0 = ?bit[] /0;

_   = {} |_ ?bits[];
0b  = |0 ?bits[];
1b  = |1 ?bits[];
un_ = ?bits[] /_;
un0 = ?bits[] /0;
un1 = ?bits[] /1;

nil    = {} |nil ?list[X];
cons   = |cons ?list[X];
un_nil = ?list[X] /nil;
car    = ?list[X] /cons .car;
cdr    = ?list[X] /cons .cdr;

un_nil_opt  = ?opt[V] /nil;
un_val      = ?opt[V] /val;
un_nil_trie = ?btrie[V] /nil;
trie_val    = ?btrie[V] /trie .val;
step_0      = ?btrie[V] /trie .0;
step_1      = ?btrie[V] /trie .1;

---------------------------------------------------------------
-- §2. Patterns & Primitive Constructors/Destructors
---------------------------------------------------------------

ascii[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6
};

bmp_hi_common[] = <
  { bit[] 0, bit[] 1, bit[] 2 } h08_0F,
  ascii[] h10_7F,
  ascii[] h80_CF,
  { bit[] 0, bit[] 1, bit[] 2 } hD0_D7,
  {} hF9,
  { bit[] 0 } hFA_FB,
  { bit[] 0 } hFC_FD,
  { bit[] 0 } hFE_FF
>;

bmp_hi_private_use[] = <
  { bit[] 0, bit[] 1, bit[] 2, bit[] 3 } hE0_EF,
  { bit[] 0, bit[] 1, bit[] 2 } hF0_F7,
  {} hF8
>;

bmp_hi[] = <
  bmp_hi_common[] common,
  bmp_hi_private_use[] private
>;

plane0[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3, bit[] 4,
  bit[] 5, bit[] 6, bit[] 7, bit[] 8, bit[] 9, bit[] 10
};

plane_02_10[] = <
  { bit[] 0 } p02_03,
  { bit[] 0, bit[] 1 } p04_07,
  { bit[] 0, bit[] 1, bit[] 2 } p08_0F,
  {} p10
>;

unicode[] = <
  ascii[] ascii,
  { bmp_hi_common[] hi, byte[] lo } bmp_common,
  { bmp_hi_private_use[] hi, byte[] lo } bmp_private_use,
  plane0[] plane0,
  { byte[] mid, byte[] lo } supplementary_plane1,
  { plane_02_10[] plane, byte[] mid, byte[] lo } supplementary_planes2_16
>;

string[] = list[unicode[]];
digit_result[] = { string[] rest, bits[] value };

-- Primitive constructors and destructors
h08_0F    = |h08_0F ?bmp_hi_common[];
h10_7F    = |h10_7F ?bmp_hi_common[];
h80_CF    = |h80_CF ?bmp_hi_common[];
hD0_D7    = |hD0_D7 ?bmp_hi_common[];
hF9       = {} |hF9 ?bmp_hi_common[];
hFA_FB    = |hFA_FB ?bmp_hi_common[];
hFC_FD    = |hFC_FD ?bmp_hi_common[];
hFE_FF    = |hFE_FF ?bmp_hi_common[];
un_h08_0F = ?bmp_hi_common[] /h08_0F;
un_h10_7F = ?bmp_hi_common[] /h10_7F;
un_h80_CF = ?bmp_hi_common[] /h80_CF;
un_hD0_D7 = ?bmp_hi_common[] /hD0_D7;
un_hF9    = ?bmp_hi_common[] /hF9;
un_hFA_FB = ?bmp_hi_common[] /hFA_FB;
un_hFC_FD = ?bmp_hi_common[] /hFC_FD;
un_hFE_FF = ?bmp_hi_common[] /hFE_FF;

hE0_EF    = |hE0_EF ?bmp_hi_private_use[];
hF0_F7    = |hF0_F7 ?bmp_hi_private_use[];
hF8       = {} |hF8 ?bmp_hi_private_use[];
un_hE0_EF = ?bmp_hi_private_use[] /hE0_EF;
un_hF0_F7 = ?bmp_hi_private_use[] /hF0_F7;
un_hF8    = ?bmp_hi_private_use[] /hF8;

common     = |common ?bmp_hi[];
private    = |private ?bmp_hi[];
un_common  = ?bmp_hi[] /common;
un_private = ?bmp_hi[] /private;

p02_03    = |p02_03 ?plane_02_10[];
p04_07    = |p04_07 ?plane_02_10[];
p08_0F    = |p08_0F ?plane_02_10[];
p10       = {} |p10 ?plane_02_10[];
un_p02_03 = ?plane_02_10[] /p02_03;
un_p04_07 = ?plane_02_10[] /p04_07;
un_p08_0F = ?plane_02_10[] /p08_0F;
un_p10    = ?plane_02_10[] /p10;

ascii                    = |ascii ?unicode[];
bmp_common               = |bmp_common ?unicode[];
bmp_private_use          = |bmp_private_use ?unicode[];
plane0                   = |plane0 ?unicode[];
supplementary_plane1     = |supplementary_plane1 ?unicode[];
supplementary_planes2_16 = |supplementary_planes2_16 ?unicode[];

un_ascii                    = ?unicode[] /ascii;
un_bmp_common               = ?unicode[] /bmp_common;
un_bmp_private_use          = ?unicode[] /bmp_private_use;
un_plane0                   = ?unicode[] /plane0;
un_supplementary_plane1     = ?unicode[] /supplementary_plane1;
un_supplementary_planes2_16 = ?unicode[] /supplementary_planes2_16;

---------------------------------------------------------------
-- §3. Character Equality, ASCII Constants & Matchers
---------------------------------------------------------------

eq_ascii? = {
  { .x.0 x, .y.0 y } eq_bit? 0,
  { .x.1 x, .y.1 y } eq_bit? 1,
  { .x.2 x, .y.2 y } eq_bit? 2,
  { .x.3 x, .y.3 y } eq_bit? 3,
  { .x.4 x, .y.4 y } eq_bit? 4,
  { .x.5 x, .y.5 y } eq_bit? 5,
  { .x.6 x, .y.6 y } eq_bit? 6,
  () then
} .then;

eq_char? = {
  { .x un_ascii x, .y un_ascii y } eq_ascii? if,
  () then
} .then;

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
_space_ = { 0 0, 0 1, 0 2, 0 3, 0 4, 1 5, 0 6 } ascii;
_tab_   = { 1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_lf_    = { 0 0, 1 1, 0 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_cr_    = { 1 0, 0 1, 1 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_bs_    = { 0 0, 0 1, 0 2, 1 3, 0 4, 0 5, 0 6 } ascii;
_ff_    = { 0 0, 0 1, 1 2, 1 3, 0 4, 0 5, 0 6 } ascii;

_quote_        = { 0 0, 1 1, 0 2, 0 3, 0 4, 1 5, 0 6 } ascii;
_backslash_    = { 0 0, 0 1, 1 2, 1 3, 1 4, 0 5, 1 6 } ascii;
_slash_        = { 1 0, 1 1, 1 2, 1 3, 0 4, 1 5, 0 6 } ascii;
_comma_        = { 0 0, 0 1, 1 2, 1 3, 0 4, 1 5, 0 6 } ascii;
_colon_        = { 0 0, 1 1, 0 2, 1 3, 1 4, 1 5, 0 6 } ascii;
_open_array_   = { 1 0, 1 1, 0 2, 1 3, 1 4, 0 5, 1 6 } ascii;
_close_array_  = { 1 0, 0 1, 1 2, 1 3, 1 4, 0 5, 1 6 } ascii;
_open_object_  = { 1 0, 1 1, 0 2, 1 3, 1 4, 1 5, 1 6 } ascii;
_close_object_ = { 1 0, 0 1, 1 2, 1 3, 1 4, 1 5, 1 6 } ascii;

_A_ = { 1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 1 6 } ascii;
_B_ = { 0 0, 1 1, 0 2, 0 3, 0 4, 0 5, 1 6 } ascii;
_C_ = { 1 0, 1 1, 0 2, 0 3, 0 4, 0 5, 1 6 } ascii;
_D_ = { 0 0, 0 1, 1 2, 0 3, 0 4, 0 5, 1 6 } ascii;
_E_ = { 1 0, 0 1, 1 2, 0 3, 0 4, 0 5, 1 6 } ascii;
_F_ = { 0 0, 1 1, 1 2, 0 3, 0 4, 0 5, 1 6 } ascii;
_I_ = { 1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 1 6 } ascii;
_N_ = { 0 0, 1 1, 1 2, 1 3, 0 4, 0 5, 1 6 } ascii;

_a_ = { 1 0, 0 1, 0 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_b_ = { 0 0, 1 1, 0 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_c_ = { 1 0, 1 1, 0 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_d_ = { 0 0, 0 1, 1 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_e_ = { 1 0, 0 1, 1 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_f_ = { 0 0, 1 1, 1 2, 0 3, 0 4, 1 5, 1 6 } ascii;
_i_ = { 1 0, 0 1, 0 2, 1 3, 0 4, 1 5, 1 6 } ascii;
_l_ = { 0 0, 0 1, 1 2, 1 3, 0 4, 1 5, 1 6 } ascii;
_n_ = { 0 0, 1 1, 1 2, 1 3, 0 4, 1 5, 1 6 } ascii;
_r_ = { 0 0, 1 1, 0 2, 0 3, 1 4, 1 5, 1 6 } ascii;
_s_ = { 1 0, 1 1, 0 2, 0 3, 1 4, 1 5, 1 6 } ascii;
_t_ = { 0 0, 0 1, 1 2, 0 3, 1 4, 1 5, 1 6 } ascii;
_u_ = { 1 0, 0 1, 1 2, 0 3, 1 4, 1 5, 1 6 } ascii;
_y_ = { 1 0, 0 1, 0 2, 1 3, 1 4, 1 5, 1 6 } ascii;

space          = { { car x, _space_ y } eq_char? if, cdr then } .then;
tab            = { { car x, _tab_ y } eq_char? if, cdr then } .then;
lf             = { { car x, _lf_ y } eq_char? if, cdr then } .then;
cr             = { { car x, _cr_ y } eq_char? if, cdr then } .then;
e_char         = { { car x, _e_ y } eq_char? if, cdr then } .then;
E_char         = { { car x, _E_ y } eq_char? if, cdr then } .then;
minus_char     = { { car x, _minus_ y } eq_char? if, cdr then } .then;
plus_char      = { { car x, _plus_ y } eq_char? if, cdr then } .then;
dot_char       = { { car x, _dot_ y } eq_char? if, cdr then } .then;
I_char         = { { car x, _I_ y } eq_char? if, cdr then } .then;
n_char         = { { car x, _n_ y } eq_char? if, cdr then } .then;
f_char         = { { car x, _f_ y } eq_char? if, cdr then } .then;
i_char         = { { car x, _i_ y } eq_char? if, cdr then } .then;
t_char         = { { car x, _t_ y } eq_char? if, cdr then } .then;
y_char         = { { car x, _y_ y } eq_char? if, cdr then } .then;
N_char         = { { car x, _N_ y } eq_char? if, cdr then } .then;
a_char         = { { car x, _a_ y } eq_char? if, cdr then } .then;
quote_char     = { { car x, _quote_ y } eq_char? if, cdr then } .then;
backslash_char = { { car x, _backslash_ y } eq_char? if, cdr then } .then;
slash_char     = { { car x, _slash_ y } eq_char? if, cdr then } .then;
b_char         = { { car x, _b_ y } eq_char? if, cdr then } .then;
l_char         = { { car x, _l_ y } eq_char? if, cdr then } .then;
r_char         = { { car x, _r_ y } eq_char? if, cdr then } .then;
s_char         = { { car x, _s_ y } eq_char? if, cdr then } .then;
u_char         = { { car x, _u_ y } eq_char? if, cdr then } .then;
comma_char     = { { car x, _comma_ y } eq_char? if, cdr then } .then;
colon_char     = { { car x, _colon_ y } eq_char? if, cdr then } .then;
open_array     = { { car x, _open_array_ y } eq_char? if, cdr then } .then;
close_array    = { { car x, _close_array_ y } eq_char? if, cdr then } .then;
open_object    = { { car x, _open_object_ y } eq_char? if, cdr then } .then;
close_object   = { { car x, _close_object_ y } eq_char? if, cdr then } .then;

ws = <
  < space, tab, lf, cr > ws,
  ?string[]
>;

scan_digit = { cdr rest, car <
  { () x, _0_ y } eq_char? _,
  { () x, _1_ y } eq_char? _ 1b,
  { () x, _2_ y } eq_char? _ 0b 1b,
  { () x, _3_ y } eq_char? _ 1b 1b,
  { () x, _4_ y } eq_char? _ 0b 0b 1b,
  { () x, _5_ y } eq_char? _ 1b 0b 1b,
  { () x, _6_ y } eq_char? _ 0b 1b 1b,
  { () x, _7_ y } eq_char? _ 1b 1b 1b,
  { () x, _8_ y } eq_char? _ 0b 0b 0b 1b,
  { () x, _9_ y } eq_char? _ 1b 0b 0b 1b
> value };
parse_digit = scan_digit;
digit       = scan_digit;

hex_letter = <
  { () x, _a_ y } eq_char? _ 0b 1b 0b 1b,
  { () x, _A_ y } eq_char? _ 0b 1b 0b 1b,
  { () x, _b_ y } eq_char? _ 1b 1b 0b 1b,
  { () x, _B_ y } eq_char? _ 1b 1b 0b 1b,
  { () x, _c_ y } eq_char? _ 0b 0b 1b 1b,
  { () x, _C_ y } eq_char? _ 0b 0b 1b 1b,
  { () x, _d_ y } eq_char? _ 1b 0b 1b 1b,
  { () x, _D_ y } eq_char? _ 1b 0b 1b 1b,
  { () x, _e_ y } eq_char? _ 0b 1b 1b 1b,
  { () x, _E_ y } eq_char? _ 0b 1b 1b 1b,
  { () x, _f_ y } eq_char? _ 1b 1b 1b 1b,
  { () x, _F_ y } eq_char? _ 1b 1b 1b 1b
>;

hex = < digit, { cdr rest, car hex_letter value } >;

hex4 = hex
  { .rest hex next, .value times16 high }
  { .next.rest rest, { .high x, .next.value y } plus value }
  { .rest hex next, .value times16 high }
  { .next.rest rest, { .high x, .next.value y } plus value }
  { .rest hex next, .value times16 high }
  { .next.rest rest, { .high x, .next.value y } plus value };

---------------------------------------------------------------
-- §4. Unicode Bit-Trie Traversal, Key Encoding & Decoding
---------------------------------------------------------------

step_bmp_common_hi = <
  { .hi un_h08_0F x, .t step_0 step_0 step_0 t } step_bits3,
  { .hi un_h10_7F x, .t step_0 step_0 step_1 t } step_bits7,
  { .hi un_h80_CF x, .t step_0 step_1 step_0 t } step_bits7,
  { .hi un_hD0_D7 x, .t step_0 step_1 step_1 t } step_bits3,
  { .hi un_hF9 if, .t step_1 step_0 step_0 then } .then,
  { .hi un_hFA_FB x, .t step_1 step_0 step_1 t } step_bits1,
  { .hi un_hFC_FD x, .t step_1 step_1 step_0 t } step_bits1,
  { .hi un_hFE_FF x, .t step_1 step_1 step_1 t } step_bits1
>;

step_bmp_priv_hi = <
  { .hi un_hE0_EF x, .t step_0 t } step_bits4,
  { .hi un_hF0_F7 x, .t step_1 step_0 t } step_bits3,
  { .hi un_hF8 if, .t step_1 step_1 then } .then
>;

step_plane2_16 = <
  { .p un_p02_03 x, .t step_0 step_0 t } step_bits1,
  { .p un_p04_07 x, .t step_0 step_1 t } step_bits2,
  { .p un_p08_0F x, .t step_1 step_0 t } step_bits3,
  { .p un_p10 if, .t step_1 step_1 then } .then
>;

step_char = <
  { .char un_ascii x, .t step_0 t } step_bits7,
  { .char un_plane0 x, .t step_1 step_0 t } step_bits11,
  {
    .char un_bmp_common .lo x,
    { .char un_bmp_common .hi hi, .t step_1 step_1 step_0 t }
      step_bmp_common_hi t
  } step_bits8,
  {
    .char un_bmp_private_use .lo x,
    { .char un_bmp_private_use .hi hi, .t step_1 step_1 step_1 step_0 t }
      step_bmp_priv_hi t
  } step_bits8,
  {
    .char un_supplementary_plane1 .lo x,
    {
      .char un_supplementary_plane1 .mid x,
      .t step_1 step_1 step_1 step_1 step_0 t
    } step_bits8 t
  } step_bits8,
  {
    .char un_supplementary_planes2_16 .lo x,
    {
      .char un_supplementary_planes2_16 .mid x,
      {
        .char un_supplementary_planes2_16 .plane p,
        .t step_1 step_1 step_1 step_1 step_1 t
      } step_plane2_16 t
    } step_bits8 t
  } step_bits8
>;

dot = <
  { .key un_nil if, .object trie_val un_val then } .then,
  {
    .key cdr key,
    { .key car char, .object t } step_char object
  } dot
>;

push_bmp_common_hi = <
  { .hi un_h08_0F x, .acc acc } push_bits3 0b 0b 0b,
  { .hi un_h10_7F x, .acc acc } push_bits7 1b 0b 0b,
  { .hi un_h80_CF x, .acc acc } push_bits7 0b 1b 0b,
  { .hi un_hD0_D7 x, .acc acc } push_bits3 1b 1b 0b,
  { .hi un_hF9 if, .acc 0b 0b 1b then } .then,
  { .hi un_hFA_FB x, .acc acc } push_bits1 1b 0b 1b,
  { .hi un_hFC_FD x, .acc acc } push_bits1 0b 1b 1b,
  { .hi un_hFE_FF x, .acc acc } push_bits1 1b 1b 1b
>;

push_bmp_priv_hi = <
  { .hi un_hE0_EF x, .acc acc } push_bits4 0b,
  { .hi un_hF0_F7 x, .acc acc } push_bits3 0b 1b,
  { .hi un_hF8 if, .acc 1b 1b then } .then
>;

push_plane2_16 = <
  { .p un_p02_03 x, .acc acc } push_bits1 0b 0b,
  { .p un_p04_07 x, .acc acc } push_bits2 1b 0b,
  { .p un_p08_0F x, .acc acc } push_bits3 0b 1b,
  { .p un_p10 if, .acc 1b 1b then } .then
>;

prepend_char_bits = <
  { .char un_ascii x, .acc acc } push_bits7 0b,
  { .char un_plane0 x, .acc acc } push_bits11 0b 1b,
  {
    .char un_bmp_common .hi hi,
    { .char un_bmp_common .lo x, .acc acc } push_bits8 acc
  } push_bmp_common_hi 0b 1b 1b,
  {
    .char un_bmp_private_use .hi hi,
    { .char un_bmp_private_use .lo x, .acc acc } push_bits8 acc
  } push_bmp_priv_hi 0b 1b 1b 1b,
  {
    .char un_supplementary_plane1 .mid x,
    { .char un_supplementary_plane1 .lo x, .acc acc } push_bits8 acc
  } push_bits8 0b 1b 1b 1b 1b,
  {
    .char un_supplementary_planes2_16 .plane p,
    {
      .char un_supplementary_planes2_16 .mid x,
      { .char un_supplementary_planes2_16 .lo x, .acc acc } push_bits8 acc
    } push_bits8 acc
  } push_plane2_16 1b 1b 1b 1b 1b
>;

str_to_bits_loop = <
  { .str un_nil if, .acc then } .then,
  {
    .str cdr str,
    { .str car char, .acc acc } prepend_char_bits acc
  } str_to_bits_loop
>;

str_to_bits = { reverse str, _ acc } str_to_bits_loop;

put = {
  .key str_to_bits index,
  .val val,
  .object list
} put_nth;

remove = {
  .key str_to_bits index,
  .object list
} remove_nth;

read_bits7 =
  read_bit
  { .bit b6, (.rest read_bit) r5 }
  { .b6 b6, .r5 .bit b5, (.r5 .rest read_bit) r4 }
  { .b6 b6, .b5 b5, .r4 .bit b4, (.r4 .rest read_bit) r3 }
  { .b6 b6, .b5 b5, .b4 b4, .r3 .bit b3, (.r3 .rest read_bit) r2 }
  { .b6 b6, .b5 b5, .b4 b4, .b3 b3, .r2 .bit b2, (.r2 .rest read_bit) r1 }
  {
    .b6 b6, .b5 b5, .b4 b4, .b3 b3, .b2 b2,
    .r1 .bit b1, (.r1 .rest read_bit) r0
  }
  {
    { .r0 .bit 0, .b1 1, .b2 2, .b3 3, .b4 4, .b5 5, .b6 6 } ascii val,
    .r0 .rest rest
  };

read_char = un0 read_bits7;

bits_to_str_loop = <
  { .bits un_ if, .acc reverse then } .then,
  { .bits read_char next, .acc acc }
  { .next.rest bits, { .next.val car, .acc cdr } cons acc }
    bits_to_str_loop
>;

bits_to_str = { () bits, nil acc } bits_to_str_loop;

collect_keys = <
  { .tree un_nil_trie if, .acc then } .then,
  {
    .tree step_0 tree,
    .rev_path 0b rev_path,
    {
      .tree step_1 tree,
      .rev_path 1b rev_path,
      <
        { .tree trie_val un_nil_opt if, .acc then } .then,
        {
          .tree trie_val un_val if,
          { .rev_path inv bits_to_str car, .acc cdr } cons then
        } .then
      > acc
    } collect_keys acc
  } collect_keys
>;

obj_keys_raw = { () tree, _ rev_path, nil acc } collect_keys;

c2     = _ 0b 1b;
c4     = _ 0b 0b 1b;
c8     = _ 0b 0b 0b 1b;
c16    = _ 0b 0b 0b 0b 1b;
c128   = _ 0b 0b 0b 0b 0b 0b 0b 1b;
c208   = _ 0b 0b 0b 0b 1b 0b 1b 1b;
c216   = _ 0b 0b 0b 1b 1b 0b 1b 1b;
c224   = _ 0b 0b 0b 0b 0b 1b 1b 1b;
c240   = _ 0b 0b 0b 0b 1b 1b 1b 1b;
c248   = _ 0b 0b 0b 1b 1b 1b 1b 1b;
c249   = _ 1b 0b 0b 1b 1b 1b 1b 1b;
c250   = _ 0b 1b 0b 1b 1b 1b 1b 1b;
c252   = _ 0b 0b 1b 1b 1b 1b 1b 1b;
c254   = _ 0b 1b 1b 1b 1b 1b 1b 1b;
c1023  = _ 1b 1b 1b 1b 1b 1b 1b 1b 1b 1b;
c1024  = c1023 inc;
c55296 = _ 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 1b 1b 0b 1b 1b;
c56320 = _ 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 1b 1b 1b 0b 1b 1b;
c57344 = _ 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 1b 1b 1b;
c65536 = _ 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 0b 1b;

bmp_hi = <
  {
    { () x, c16 y } lt? if,
    { () x, c8 y } minus small3 h08_0F common then
  } .then,
  {
    { () x, c128 y } lt? if,
    { () x, c16 y } minus small7 h10_7F common then
  } .then,
  {
    { () x, c208 y } lt? if,
    { () x, c128 y } minus small7 h80_CF common then
  } .then,
  {
    { () x, c216 y } lt? if,
    { () x, c208 y } minus small3 hD0_D7 common then
  } .then,
  {
    { () x, c240 y } lt? if,
    { () x, c224 y } minus small4 hE0_EF private then
  } .then,
  {
    { () x, c248 y } lt? if,
    { () x, c240 y } minus small3 hF0_F7 private then
  } .then,
  { () x, c248 y } minus un_ hF8 private,
  { () x, c249 y } minus un_ hF9 common,
  {
    { () x, c252 y } lt? if,
    { () x, c250 y } minus small1 hFA_FB common then
  } .then,
  {
    { () x, c254 y } lt? if,
    { () x, c252 y } minus small1 hFC_FD common then
  } .then,
  { () x, c254 y } minus small1 hFE_FF common
>;

plane = <
  {
    { () x, c4 y } lt? if,
    { () x, c2 y } minus small1 p02_03 then
  } .then,
  {
    { () x, c8 y } lt? if,
    { () x, c4 y } minus small2 p04_07 then
  } .then,
  {
    { () x, c16 y } lt? if,
    { () x, c8 y } minus small3 p08_0F then
  } .then,
  un1 un0 un0 un0 un0 un_ p10
>;

bmp = {
  () parts, .hi { () x, _ acc } push_bits8 trim high
} <
  { .high un_ a, .parts.lo.7 is0 b, .parts.lo field7 ascii then } .then,
  {
    { .high x, c8 y } lt? if,
    {
      .parts.lo.0 0, .parts.lo.1 1, .parts.lo.2 2, .parts.lo.3 3,
      .parts.lo.4 4, .parts.lo.5 5, .parts.lo.6 6, .parts.lo.7 7,
      .parts.hi.0 8, .parts.hi.1 9, .parts.hi.2 10
    } plane0 then
  } .then,
  { .high bmp_hi high, .parts.lo lo } <
    { .high un_common hi, .lo lo } bmp_common,
    { .high un_private hi, .lo lo } bmp_private_use
  >
>;

to_unicode = unpack16 <
  { .plane un_ if, () bmp then } .then,
  {
    .plane un1 un_ if,
    { .hi mid, .lo lo } supplementary_plane1 then
  } .then,
  { .plane plane plane, .hi mid, .lo lo } supplementary_planes2_16
>;

str_len = ?string[] list_length;
