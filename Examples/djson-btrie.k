-- Examples/djson-btrie.k: Binary Bit-Trie JSON schema and helpers
-- Works with codecs/djson-btrie.mjs and codecs/utf8.mjs.

---------------------------------------------------------------
-- §1. Universal Binary Bit-Trie JSON Filter (json?)
---------------------------------------------------------------

json? = ?<
  {
    < {} "+", {} "-" > sign,
    {
      < {} 0, {} 1 >=Bit 0,
      Bit 1, Bit 2, Bit 3, Bit 4, Bit 5,
      Bit 6, Bit 7, Bit 8, Bit 9, Bit 10
    } exponent,
    {
      Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5,
      Bit 6, Bit 7, Bit 8, Bit 9, Bit 10, Bit 11,
      Bit 12, Bit 13, Bit 14, Bit 15, Bit 16, Bit 17,
      Bit 18, Bit 19, Bit 20, Bit 21, Bit 22, Bit 23,
      Bit 24, Bit 25, Bit 26, Bit 27, Bit 28, Bit 29,
      Bit 30, Bit 31, Bit 32, Bit 33, Bit 34, Bit 35,
      Bit 36, Bit 37, Bit 38, Bit 39, Bit 40, Bit 41,
      Bit 42, Bit 43, Bit 44, Bit 45, Bit 46, Bit 47,
      Bit 48, Bit 49, Bit 50, Bit 51
    } fraction
  } number,

  <
    {} nil,
    {
      <
        {
          Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6
        }=Bits7 ascii,
        {
          <
            { Bit 0, Bit 1, Bit 2 }=Bits3 h08_0F,
            Bits7 h10_7F,
            Bits7 h80_CF,
            Bits3 hD0_D7,
            {} hF9,
            { Bit 0 }=Bits1 hFA_FB,
            Bits1 hFC_FD,
            Bits1 hFE_FF
          > hi,
          {
            Bit 0, Bit 1, Bit 2, Bit 3,
            Bit 4, Bit 5, Bit 6, Bit 7
          }=Bits8 lo
        } bmp_common,
        {
          <
            { Bit 0, Bit 1, Bit 2, Bit 3 } hE0_EF,
            Bits3 hF0_F7,
            {} hF8
          > hi,
          Bits8 lo
        } bmp_private_use,
        {
          Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5,
          Bit 6, Bit 7, Bit 8, Bit 9, Bit 10
        } plane0,
        { Bits8 mid, Bits8 lo } supplementary_plane1,
        {
          <
            Bits1 p02_03,
            { Bit 0, Bit 1 } p04_07,
            Bits3 p08_0F,
            {} p10
          > plane,
          Bits8 mid,
          Bits8 lo
        } supplementary_planes2_16
      > car,
      Str cdr
    } cons
  >=Str string,

  < {} true, {} false > bool,
  {} null,

  <
    {} nil,
    {
      < {} nil, JSON val > val,
      TRIE 0,
      TRIE 1
    } trie
  >=TRIE list,

  TRIE object
>=JSON;

---------------------------------------------------------------
-- §2. Constructors and Projections
---------------------------------------------------------------

bits? = ?< {} _, bits? 0, bits? 1 > = bits?;
str_list? = ?< {} nil, { C car, S cdr } cons > = S;
trie? = ?< {} nil, { < {} nil, V val > val, T 0, T 1 } trie > = T;

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
