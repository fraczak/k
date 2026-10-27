-- Examples/djson.k: Universal dynamic JSON schema and standard methods
-- Works with codecs/djson.mjs (k-djson) and codecs/utf8.mjs (k-utf8).

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

bits[] = < {} _, B 0, B 1 > = B;

list[X] = < {} nil, { X car, L cdr } cons > = L;

opt[V] = < {} nil, V val >;

btrie[V] = <
  {} nil,
  {
    opt[V] val,
    T 0,
    T 1
  } trie
> = T;

djson[] = <
  number[] number,
  string[] string,
  bool[] bool,
  {} null,
  btrie[J] list,
  btrie[J] object
> = J;

---------------------------------------------------------------
-- §2. Constructors and Projections
---------------------------------------------------------------

0b = {} | _;
0 = 0b | 0;
1 = 0b | 1;

nil = {} | nil;
null = {} | null ?djson[];
true = {} | true | bool ?djson[];
false = {} | false | bool ?djson[];
number = | number ?djson[];
string = | string ?djson[];
bool = | bool ?djson[];
list = | list ?djson[];
object = | object ?djson[];
empty_list = nil | list ?djson[];
empty_object = nil | object ?djson[];

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

-- Low-level lookup string key in object trie: { key, object } -> val
dot = ?{ K key, T object } { .key ?string[] key, .object ?btrie[V] t } <
  { .key /nil if, .t /trie .val /val then } .then,
  {
    .key /cons .cdr key,
    { .key /cons .car char, .t t } step_char object
  } dot
>;

-- Low-level lookup ?bits[] index in list trie: { index, list } -> val
_nth = ?{ bits[] index, btrie[V] list } <
  { .index /_ if, .list /trie .val /val then } .then,
  { .index /0 index, .list /trie .0 list } _nth,
  { .index /1 index, .list /trie .1 list } _nth
>;

-- Primary accessor: lookup string key in ?djson[] object -> ?djson[] val
get = ?{ string[] key, djson[] json } {
  .key key,
  .json /object object
} dot;

-- Primary accessor: lookup ?bits[] index in ?djson[] list -> ?djson[] elem
nth = ?{ K index, djson[] json } {
  .index ?bits[] index,
  .json /list list
} _nth;

-- Filter: succeeds as identity if ?djson[] object contains string key
has_key? = { get if, () then } .then;
has? = has_key?;

-- Filter: succeeds as identity if ?djson[] list contains index
has_index? = { nth if, () then } .then;
has_nth? = has_index?;

---------------------------------------------------------------
-- §5. Trie Update & Removal (put, remove, put_nth, remove_nth)
---------------------------------------------------------------

push_bit = ?{ < {} 0, {} 1 > b, < {} _, BITS 0, BITS 1 >=BITS acc } <
  { .b /0 if, .acc |0 then } .then,
  { .b /1 if, .acc |1 then } .then
> ?bits[];

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
> ?bits[];

push_bmp_priv_hi = <
  { .hi /hE0_EF x, .acc acc } push_bits4 |0,
  { .hi /hF0_F7 x, .acc acc } push_bits3 |0 |1,
  { .hi /hF8 if, .acc |1 |1 then } .then
> ?bits[];

push_plane2_16 = <
  { .p /p02_03 x, .acc acc } push_bits1 |0 |0,
  { .p /p04_07 x, .acc acc } push_bits2 |1 |0,
  { .p /p08_0F x, .acc acc } push_bits3 |0 |1,
  { .p /p10 if, .acc |1 |1 then } .then
> ?bits[];

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
> ?bits[];

str_to_bits = ?string[] <
  /nil 0b,
  /cons { .car char, .cdr str_to_bits acc } prepend_char_bits
> ?bits[];

ensure_trie = ?btrie[V] < /nil { nil val, nil 0, nil 1 }, /trie () >;

-- Insert or replace { index, val, list } -> list
put_nth = ?{ K index, V val, T list } = X {
  .index index,
  .val val,
  .list ensure_trie t
} <
  {
    .index /_ if,
    { .val |val val, .t .0 0, .t .1 1 } |trie then
  } .then,
  {
    .index /0 if,
    {
      .t .val val,
      { .index /0 index, .val val, .t .0 list } ?X put_nth 0,
      .t .1 1
    } |trie then
  } .then,
  {
    .index /1 if,
    {
      .t .val val,
      .t .0 0,
      { .index /1 index, .val val, .t .1 list } ?X put_nth 1
    } |trie then
  } .then
> ?btrie[V];

-- Remove entry at ?bits[] index from trie: { index, list } -> list
remove_nth = ?{ K index, T list } = X 
  { .index index, .list t } <
  { .t /nil if, nil then } .then,
  {
    .index /_ if,
    { nil val, .t /trie .0 0, .t /trie .1 1 } |trie then
  } .then,
  {
    .index /0 if,
    {
      .t /trie .val val,
      { .index /0 index, .t /trie .0 list } ?X remove_nth 0,
      .t /trie .1 1
    } |trie then
  } .then,
  {
    .index /1 if,
    {
      .t /trie .val val,
      .t /trie .0 0,
      { .index /1 index, .t /trie .1 list } ?X remove_nth 1
    } |trie then
  } .then
> ?btrie[V];

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

-- Set string key in ?djson[] object: { key, val, json } -> json
set = {.key key, .val val, .json /object object} 
  put |object ?djson[];

-- Remove string key from ?djson[] object: { key, json } -> json
del = ?{ string[] key, djson[] json } {
  .key key,
  .json /object object
} remove |object ?djson[];

-- Set element at ?bits[] index in ?djson[] list: { index, val, json } -> json
set_nth = ?{ bits[] index, djson[] val, djson[] json } {
  .index index,
  .val val,
  .json /list list
} put_nth |list ?djson[];

-- Remove element at ?bits[] index from ?djson[] list: { index, json } -> json
del_nth = ?{ bits[] index, djson[] json } {
  .index index,
  .json /list list
} remove_nth |list ?djson[];

---------------------------------------------------------------
-- §6. Cardinality & Length Relations
---------------------------------------------------------------

_inv = ?{ < {} _, B 0, B 1 >=B x, B r } <
  { .x /_ if, .r then } .then,
  { .x /0 x, .r |0 r } _inv,
  { .x /1 x, .r |1 r } _inv
> ?bits[];
_inc = ?{ < {} _, B 0, B 1 >=B x, B y } <
  { .x /_ if, .y |1 then } .then,
  { .x /0 x, .y |1 r } _inv,
  { .x /1 x, .y |0 y } _inc
> ?bits[];
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
> ?bits[];

list_size = { ?btrie[V] t, 0 acc } _trie_size;
obj_size = { ?btrie[V] t, 0 acc } _trie_size;

_str_len = ?{ string[] str, bits[] acc } <
  { .str /nil if, .acc then } .then,
  { .str /cons .cdr str, .acc inc_nat acc } _str_len
> ? bits[];
str_len = { ?string[] str, 0 acc } _str_len;

-- Count items in ?djson[] (object entries, list elements, or string chars)
length_nat = ?djson[] <
  /object obj_size,
  /list list_size,
  /string str_len
>;

pos_sign = {} |"+";
bit0 = {} |0;
bit1 = {} |1;

pos_zero = {
  pos_sign sign,
  {
    bit0 0, bit0 1, bit0 2, bit0 3, bit0 4,
    bit0 5, bit0 6, bit0 7, bit0 8, bit0 9, bit0 10
  } exponent,
  {
    bit0 0, bit0 1, bit0 2, bit0 3, bit0 4,
    bit0 5, bit0 6, bit0 7, bit0 8, bit0 9,
    bit0 10, bit0 11, bit0 12, bit0 13, bit0 14,
    bit0 15, bit0 16, bit0 17, bit0 18, bit0 19,
    bit0 20, bit0 21, bit0 22, bit0 23, bit0 24,
    bit0 25, bit0 26, bit0 27, bit0 28, bit0 29,
    bit0 30, bit0 31, bit0 32, bit0 33, bit0 34,
    bit0 35, bit0 36, bit0 37, bit0 38, bit0 39,
    bit0 40, bit0 41, bit0 42, bit0 43, bit0 44,
    bit0 45, bit0 46, bit0 47, bit0 48, bit0 49,
    bit0 50, bit0 51
  } fraction
};

exp_bias = {
  bit1 0, bit1 1, bit1 2, bit1 3, bit1 4,
  bit1 5, bit1 6, bit1 7, bit1 8, bit1 9, bit0 10
};

exp_half_adder = <
  { .a /0 a, .c_in /0 c_in } { bit0 sum, bit0 carry },
  { .a /0 a, .c_in /1 c_in } { bit1 sum, bit0 carry },
  { .a /1 a, .c_in /0 c_in } { bit1 sum, bit0 carry },
  { .a /1 a, .c_in /1 c_in } { bit0 sum, bit1 carry }
>;

inc_exp = {
  { .0 a, bit1 c_in } exp_half_adder e0,
  .1 b1, .2 b2, .3 b3, .4 b4, .5 b5, .6 b6, .7 b7, .8 b8, .9 b9, .10 b10
} {
  .e0.sum 0,
  { .b1 a, .e0.carry c_in } exp_half_adder e1,
  .b2 b2, .b3 b3, .b4 b4, .b5 b5, .b6 b6, .b7 b7, .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .e1.sum 1,
  { .b2 a, .e1.carry c_in } exp_half_adder e2,
  .b3 b3, .b4 b4, .b5 b5, .b6 b6, .b7 b7, .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .1 1, .e2.sum 2,
  { .b3 a, .e2.carry c_in } exp_half_adder e3,
  .b4 b4, .b5 b5, .b6 b6, .b7 b7, .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .1 1, .2 2, .e3.sum 3,
  { .b4 a, .e3.carry c_in } exp_half_adder e4,
  .b5 b5, .b6 b6, .b7 b7, .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .1 1, .2 2, .3 3, .e4.sum 4,
  { .b5 a, .e4.carry c_in } exp_half_adder e5,
  .b6 b6, .b7 b7, .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .1 1, .2 2, .3 3, .4 4, .e5.sum 5,
  { .b6 a, .e5.carry c_in } exp_half_adder e6,
  .b7 b7, .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .e6.sum 6,
  { .b7 a, .e6.carry c_in } exp_half_adder e7,
  .b8 b8, .b9 b9, .b10 b10
} {
  .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6, .e7.sum 7,
  { .b8 a, .e7.carry c_in } exp_half_adder e8,
  .b9 b9, .b10 b10
} {
  .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6, .7 7, .e8.sum 8,
  { .b9 a, .e8.carry c_in } exp_half_adder e9,
  .b10 b10
} {
  .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6, .7 7, .8 8, .e9.sum 9,
  { .b10 a, .e9.carry c_in } exp_half_adder e10
} {
  .0 0, .1 1, .2 2, .3 3, .4 4, .5 5, .6 6, .7 7, .8 8, .9 9, .e10.sum 10
};

shift_frac = ?{ bit[] b, fraction[] f } {
  .f.1 0,  .f.2 1,  .f.3 2,  .f.4 3,  .f.5 4,
  .f.6 5,  .f.7 6,  .f.8 7,  .f.9 8,  .f.10 9,
  .f.11 10, .f.12 11, .f.13 12, .f.14 13, .f.15 14,
  .f.16 15, .f.17 16, .f.18 17, .f.19 18, .f.20 19,
  .f.21 20, .f.22 21, .f.23 22, .f.24 23, .f.25 24,
  .f.26 25, .f.27 26, .f.28 27, .f.29 28, .f.30 29,
  .f.31 30, .f.32 31, .f.33 32, .f.34 33, .f.35 34,
  .f.36 35, .f.37 36, .f.38 37, .f.39 38, .f.40 39,
  .f.41 40, .f.42 41, .f.43 42, .f.44 43, .f.45 44,
  .f.46 45, .f.47 46, .f.48 47, .f.49 48, .f.50 49,
  .f.51 50, .b 51
};

_nat_step = ?{ bits[] bits, exponent[] exp, fraction[] frac } <
  {
    .bits /_ if,
    { pos_sign sign, .exp exponent, .frac fraction } then
  } .then,
  {
    .bits /0 bits,
    .exp inc_exp exp,
    { bit0 b, .frac f } shift_frac frac
  } _nat_step,
  {
    .bits /1 bits,
    .exp inc_exp exp,
    { bit1 b, .frac f } shift_frac frac
  } _nat_step
>;

inv_bits = { () x, 0b r } _inv;

nat_to_float64 = ?bits[] <
  /_ { pos_zero then } .then,
  /0 { pos_zero then } .then,
  /1 { () inv_bits bits, exp_bias exp, pos_zero .fraction frac } _nat_step
>;

-- Count items in ?djson[] -> ?djson[] number
length = length_nat nat_to_float64 |number ?djson[];

-- Append element to ?djson[] list: { val, json } -> json
push = ?{ djson[] val, djson[] json } {
  .json /list list_size index,
  .val val,
  .json json
} set_nth;

---------------------------------------------------------------
-- §7. Keys & Values Extraction
---------------------------------------------------------------

read_bit = ?bits[] <
  /0 { {} |0 bit, () rest },
  /1 { {} |1 bit, () rest }
>;

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
    { .r0 .bit 0, .b1 1, .b2 2, .b3 3, .b4 4, .b5 5, .b6 6 } |ascii val,
    .r0 .rest rest
  };

read_char = ?bits[] <
  /0 read_bits7
>;

bits_to_str = ?bits[] <
  /_ {} |nil,
  read_char { .val car, (.rest bits_to_str) cdr } |cons
> ?string[];

_collect_keys = ?{
  btrie[V] tree,
  bits[] rev_path,
  list[string[]] acc
} <
  { .tree /nil if, .acc then } .then,
  {
    .tree /trie .val /nil if,
    {
      .tree /trie .0 tree,
      .rev_path |0 rev_path,
      {
        .tree /trie .1 tree,
        .rev_path |1 rev_path,
        .acc acc
      } _collect_keys acc
    } _collect_keys then
  } .then,
  {
    .tree /trie .val /val if,
    {
      .tree /trie .0 tree,
      .rev_path |0 rev_path,
      {
        .tree /trie .1 tree,
        .rev_path |1 rev_path,
        {
          (.rev_path inv_bits bits_to_str) car,
          .acc cdr
        } |cons acc
      } _collect_keys acc
    } _collect_keys then
  } .then
> ? list[string[]];

_obj_keys_raw = { () tree, 0b rev_path, {} |nil acc } _collect_keys;

-- Extract all keys from ?djson[] object as raw list: ?djson[] -> list[string[]]
keys_raw = ?djson[] /object _obj_keys_raw;

_keys_to_trie = ?{
  list[string[]] klist,
  bits[] index,
  btrie[V] acc
} <
  { .klist /nil if, .acc then } .then,
  {
    .klist /cons .cdr klist,
    .index inc_nat index,
    {
      .index index,
      .klist /cons .car |string val,
      .acc list
    } put_nth acc
  } _keys_to_trie
>;

-- Extract all keys from ?djson[] object as a ?djson[] list: ?djson[] -> ?djson[]
keys = ?djson[] /object _obj_keys_raw
  { () klist, 0 index, {} |nil acc } _keys_to_trie
  |list ?djson[];

_collect_values = ?{
  btrie[V] tree,
  list[V] acc
} <
  { .tree /nil if, .acc then } .then,
  {
    .tree /trie .val /nil if,
    {
      .tree /trie .0 tree,
      { .tree /trie .1 tree, .acc acc } _collect_values acc
    } _collect_values then
  } .then,
  {
    .tree /trie .val /val if,
    {
      .tree /trie .0 tree,
      {
        .tree /trie .1 tree,
        { .tree /trie .val /val car, .acc cdr } |cons acc
      } _collect_values acc
    } _collect_values then
  } .then
> ? list[V];

_obj_values_raw = { () tree, {} |nil acc } _collect_values;

-- Extract all values from ?djson[] object or list as raw list
values_raw = ?djson[] <
  /object _obj_values_raw,
  /list _obj_values_raw
>;

_values_to_trie = ?{
  list[(...)] klist,
  bits[] index,
  btrie[(...)] acc
} <
  { .klist /nil if, .acc then } .then,
  {
    .klist /cons .cdr klist,
    .index inc_nat index,
    {
      .index index,
      .klist /cons .car val,
      .acc list
    } put_nth acc
  } _values_to_trie
>;

-- Extract all values from ?djson[] as a ?djson[] list: ?djson[] -> ?djson[]
values =  
<
  /object _obj_values_raw
    { () klist, 0 index, {} |nil acc } _values_to_trie |list,
  ?djson[]
>;

---------------------------------------------------------------
-- §8. Type Predicates
---------------------------------------------------------------

is_null? = ?djson[] {/null if, () then} .then;
is_bool? = ?djson[] {/bool if, () then} .then;
is_number? = ?djson[] {/number if, () then} .then;
is_string? = ?djson[] {/string if, () then} .then;
is_list? = ?djson[] {/list if, () then} .then;
is_object? = ?djson[] {/object if, () then} .then;

json_type[] = <
  {} null, {} bool, {} number, {} string, {} list, {} object
>;
type_of = ?djson[] <
  /null {} |null,
  /bool {} |bool,
  /number {} |number,
  /string {} |string,
  /list {} |list,
  /object {} |object
> ? json_type[];
