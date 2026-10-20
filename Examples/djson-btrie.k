-- Examples/djson-btrie.k: Binary Bit-Trie JSON schema and helpers
-- Works with codecs/djson-btrie.mjs and codecs/utf8.mjs.

---------------------------------------------------------------
-- §1. Named Pattern Definitions & Component Schemas
---------------------------------------------------------------

bit[] = < {} 0, {} 1 >;

sign[] = < {} "+", {} "-" >;

exponent[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3, bit[] 4,
  bit[] 5, bit[] 6, bit[] 7, bit[] 8, bit[] 9, bit[] 10
};

fraction[] = {
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

number[] = {
  sign[] sign,
  exponent[] exponent,
  fraction[] fraction
};

byte[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6, bit[] 7
};

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

string[] = < {} nil, { unicode[] car, S cdr } cons > = S;

bool[] = < {} true, {} false >;

opt[V] = < {} nil, V val >;

btrie[V] = <
  {} nil,
  {
    opt[V] val,
    T 0,
    T 1
  } trie
> = T;

djson_btrie[] = <
  number[] number,
  string[] string,
  bool[] bool,
  {} null,
  btrie[J] list,
  btrie[J] object
> = J;

json? = ? djson_btrie[];

---------------------------------------------------------------
-- §2. Constructors and Projections
---------------------------------------------------------------

bits? = ?< {} _, B 0, B 1 > = B;
str_list? = ?< {} nil, { C car, S cdr } cons > = S;
trie? = ? btrie[V];

0b = {} | _;
0 = 0b | 0;
1 = 0b | 1;

nil = {} | nil;
null = {} | null json?;
true = {} | true | bool json?;
false = {} | false | bool json?;
number = | number json?;
string = | string json?;
bool = | bool json?;
list = | list json?;
object = | object json?;

---------------------------------------------------------------
-- §3. Direct Binary Bit-Trie Traversal (Zero Equality Checks)
---------------------------------------------------------------

-- Step one bit (0 or 1) in a binary trie
step_0 = /trie .0;
step_1 = /trie .1;

step_bit = <
  { .b /0 if, .t step_0 then } .then,
  { .b /1 if, .t step_1 then } .then
>;

-- Step N bits from MSB (.N-1) down to LSB (.0)
step_bits1 = { .x .0 b, .t t } step_bit;
step_bits2 = { .x x, { .x .1 b, .t t } step_bit t } step_bits1;
step_bits3 = { .x x, { .x .2 b, .t t } step_bit t } step_bits2;
step_bits4 = { .x x, { .x .3 b, .t t } step_bit t } step_bits3;
step_bits5 = { .x x, { .x .4 b, .t t } step_bit t } step_bits4;
step_bits6 = { .x x, { .x .5 b, .t t } step_bit t } step_bits5;
step_bits7 = { .x x, { .x .6 b, .t t } step_bit t } step_bits6;
step_bits8 = { .x x, { .x .7 b, .t t } step_bit t } step_bits7;
step_bits9 = { .x x, { .x .8 b, .t t } step_bit t } step_bits8;
step_bits10 = { .x x, { .x .9 b, .t t } step_bit t } step_bits9;
step_bits11 = { .x x, { .x .10 b, .t t } step_bit t } step_bits10;

step_bmp_common_hi = <
  { .hi /h08_0F x, .t step_0 step_0 step_0 t } step_bits3,
  { .hi /h10_7F x, .t step_0 step_0 step_1 t } step_bits7,
  { .hi /h80_CF x, .t step_0 step_1 step_0 t } step_bits7,
  { .hi /hD0_D7 x, .t step_0 step_1 step_1 t } step_bits3,
  { .hi /hF9 if, .t step_1 step_0 step_0 then } .then,
  { .hi /hFA_FB x, .t step_1 step_0 step_1 t } step_bits1,
  { .hi /hFC_FD x, .t step_1 step_1 step_0 t } step_bits1,
  { .hi /hFE_FF x, .t step_1 step_1 step_1 t } step_bits1
>;

step_bmp_priv_hi = <
  { .hi /hE0_EF x, .t step_0 t } step_bits4,
  { .hi /hF0_F7 x, .t step_1 step_0 t } step_bits3,
  { .hi /hF8 if, .t step_1 step_1 then } .then
>;

step_plane2_16 = <
  { .p /p02_03 x, .t step_0 step_0 t } step_bits1,
  { .p /p04_07 x, .t step_0 step_1 t } step_bits2,
  { .p /p08_0F x, .t step_1 step_0 t } step_bits3,
  { .p /p10 if, .t step_1 step_1 then } .then
>;

-- Advance trie by one Unicode character: { char, t } -> t
step_char = <
  { .char /ascii x, .t step_0 t } step_bits7,
  { .char /plane0 x, .t step_1 step_0 t } step_bits11,
  {
    .char /bmp_common .lo x,
    { .char /bmp_common .hi hi, .t step_1 step_1 step_0 t }
      step_bmp_common_hi t
  } step_bits8,
  {
    .char /bmp_private_use .lo x,
    { .char /bmp_private_use .hi hi, .t step_1 step_1 step_1 step_0 t }
      step_bmp_priv_hi t
  } step_bits8,
  {
    .char /supplementary_plane1 .lo x,
    {
      .char /supplementary_plane1 .mid x,
      .t step_1 step_1 step_1 step_1 step_0 t
    } step_bits8 t
  } step_bits8,
  {
    .char /supplementary_planes2_16 .lo x,
    {
      .char /supplementary_planes2_16 .mid x,
      {
        .char /supplementary_planes2_16 .plane p,
        .t step_1 step_1 step_1 step_1 step_1 t
      } step_plane2_16 t
    } step_bits8 t
  } step_bits8
>;

---------------------------------------------------------------
-- §4. Object & List Lookup Relations (dot, nth, has_key?)
---------------------------------------------------------------

-- Lookup string key in object trie: { key, object } -> value
dot = ?{ K key, T object } { .key str_list? key, .object trie? t } <
  { .key /nil if, .t /trie .val /val then } .then,
  {
    .key /cons .cdr key,
    { .key /cons .car char, .t t } step_char object
  } dot
>;

-- Filter: succeeds as identity if object contains key
has_key? = ?{ K key, O object } { dot if, () then } .then;

-- Lookup bits? index in list trie: { index, list } -> value
nth = ?{ K index, T list } { .index bits? index, .list trie? t } <
  { .index /_ if, .t /trie .val /val then } .then,
  { .index /0 index, .t /trie .0 list } nth,
  { .index /1 index, .t /trie .1 list } nth
>;

---------------------------------------------------------------
-- §5. Trie Update & Removal (put, remove, put_nth, remove_nth)
---------------------------------------------------------------

push_bit = ?{ < {} 0, {} 1 > b, < {} _, BITS 0, BITS 1 >=BITS acc } <
  { .b /0 if, .acc |0 then } .then,
  { .b /1 if, .acc |1 then } .then
> bits?;

push_bits1 = { .x .0 b, .acc acc } push_bit;
push_bits2 = { .x .1 b, { .x x, .acc acc } push_bits1 acc } push_bit;
push_bits3 = { .x .2 b, { .x x, .acc acc } push_bits2 acc } push_bit;
push_bits4 = { .x .3 b, { .x x, .acc acc } push_bits3 acc } push_bit;
push_bits5 = { .x .4 b, { .x x, .acc acc } push_bits4 acc } push_bit;
push_bits6 = { .x .5 b, { .x x, .acc acc } push_bits5 acc } push_bit;
push_bits7 = { .x .6 b, { .x x, .acc acc } push_bits6 acc } push_bit;
push_bits8 = { .x .7 b, { .x x, .acc acc } push_bits7 acc } push_bit;
push_bits9 = { .x .8 b, { .x x, .acc acc } push_bits8 acc } push_bit;
push_bits10 = { .x .9 b, { .x x, .acc acc } push_bits9 acc } push_bit;
push_bits11 = { .x .10 b, { .x x, .acc acc } push_bits10 acc } push_bit;

push_bmp_common_hi = <
  { .hi /h08_0F x, .acc acc } push_bits3 |0 |0 |0,
  { .hi /h10_7F x, .acc acc } push_bits7 |1 |0 |0,
  { .hi /h80_CF x, .acc acc } push_bits7 |0 |1 |0,
  { .hi /hD0_D7 x, .acc acc } push_bits3 |1 |1 |0,
  { .hi /hF9 if, .acc |0 |0 |1 then } .then,
  { .hi /hFA_FB x, .acc acc } push_bits1 |1 |0 |1,
  { .hi /hFC_FD x, .acc acc } push_bits1 |0 |1 |1,
  { .hi /hFE_FF x, .acc acc } push_bits1 |1 |1 |1
> bits?;

push_bmp_priv_hi = <
  { .hi /hE0_EF x, .acc acc } push_bits4 |0,
  { .hi /hF0_F7 x, .acc acc } push_bits3 |0 |1,
  { .hi /hF8 if, .acc |1 |1 then } .then
> bits?;

push_plane2_16 = <
  { .p /p02_03 x, .acc acc } push_bits1 |0 |0,
  { .p /p04_07 x, .acc acc } push_bits2 |1 |0,
  { .p /p08_0F x, .acc acc } push_bits3 |0 |1,
  { .p /p10 if, .acc |1 |1 then } .then
> bits?;

prepend_char_bits = <
  { .char /ascii x, .acc acc } push_bits7 |0,
  { .char /plane0 x, .acc acc } push_bits11 |0 |1,
  {
    .char /bmp_common .hi hi,
    { .char /bmp_common .lo x, .acc acc } push_bits8 acc
  } push_bmp_common_hi |0 |1 |1,
  {
    .char /bmp_private_use .hi hi,
    { .char /bmp_private_use .lo x, .acc acc } push_bits8 acc
  } push_bmp_priv_hi |0 |1 |1 |1,
  {
    .char /supplementary_plane1 .mid x,
    { .char /supplementary_plane1 .lo x, .acc acc } push_bits8 acc
  } push_bits8 |0 |1 |1 |1 |1,
  {
    .char /supplementary_planes2_16 .plane p,
    {
      .char /supplementary_planes2_16 .mid x,
      { .char /supplementary_planes2_16 .lo x, .acc acc } push_bits8 acc
    } push_bits8 acc
  } push_plane2_16 |1 |1 |1 |1 |1
> bits?;

str_to_bits = str_list? <
  /nil 0b,
  /cons { .car char, .cdr str_to_bits acc } prepend_char_bits
> bits?;

ensure_trie = trie? < /nil { nil val, nil 0, nil 1 }, /trie () >;

-- Insert or replace { index, val, list } -> list
put_nth = ?{ K index, V val, T list } {
  .index bits? index,
  .val val,
  .list trie? ensure_trie t
} <
  {
    .index /_ if,
    { .val |val val, .t .0 0, .t .1 1 } |trie then
  } .then,
  {
    .index /0 if,
    {
      .t .val val,
      { .index /0 index, .val val, .t .0 list } put_nth 0,
      .t .1 1
    } |trie then
  } .then,
  {
    .index /1 if,
    {
      .t .val val,
      .t .0 0,
      { .index /1 index, .val val, .t .1 list } put_nth 1
    } |trie then
  } .then
> trie?;

-- Remove entry at bits? index from trie: { index, list } -> list
remove_nth = ?{ K index, T list } { .index bits? index, .list trie? t } <
  { .t /nil if, nil then } .then,
  {
    .index /_ if,
    { nil val, .t /trie .0 0, .t /trie .1 1 } |trie then
  } .then,
  {
    .index /0 if,
    {
      .t /trie .val val,
      { .index /0 index, .t /trie .0 list } remove_nth 0,
      .t /trie .1 1
    } |trie then
  } .then,
  {
    .index /1 if,
    {
      .t /trie .val val,
      .t /trie .0 0,
      { .index /1 index, .t /trie .1 list } remove_nth 1
    } |trie then
  } .then
> trie?;

-- Insert or replace { key, val, object } -> object
put = ?{ K key, V val, O object } {
  .key str_to_bits index,
  .val val,
  .object list
} put_nth;

-- Remove key from object trie: { key, object } -> object
remove = ?{ K key, O object } {
  .key str_to_bits index,
  .object list
} remove_nth;

-- Count elements in list or object trie: trie -> bits?
_inv = ?{ < {} _, B 0, B 1 >=B x, B r } <
  { .x /_ if, .r then } .then,
  { .x /0 x, .r |0 r } _inv,
  { .x /1 x, .r |1 r } _inv
> bits?;
_inc = ?{ < {} _, B 0, B 1 >=B x, B y } <
  { .x /_ if, .y |1 then } .then,
  { .x /0 x, .y |1 r } _inv,
  { .x /1 x, .y |0 y } _inc
> bits?;
inc_nat = { { () x, 0b r } _inv x, 0b y } _inc;

_trie_size = ?{
  < {} nil, { < {} nil, V val > val, T 0, T 1 } trie >=T t,
  < {} _, B 0, B 1 >=B acc
} <
  { .t /nil if, .acc then } .then,
  {
    .t /trie .val /nil if,
    {
      .t /trie .1 t,
      { .t /trie .0 t, .acc acc } _trie_size acc
    } _trie_size then
  } .then,
  {
    .t /trie .val /val if,
    {
      .t /trie .1 t,
      { .t /trie .0 t, .acc inc_nat acc } _trie_size acc
    } _trie_size then
  } .then
> bits?;

list_size = { trie? t, 0 acc } _trie_size;
obj_size = { trie? t, 0 acc } _trie_size;
