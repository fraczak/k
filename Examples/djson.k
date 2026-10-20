-- Examples/djson.k: Universal dynamic JSON schema and helper relations
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

list[X] = < {} nil, { X car, L cdr } cons > = L;

pair[K, V] = { K key, V val };

object[V] = list[pair[string[], V]];

djson[] = <
  number[] number,
  string[] string,
  bool[] bool,
  {} null,
  list[J] list,
  object[J] object
> = J;

json? = ? djson[];

bit? = ? bit[];
string? = ? string[];
float64? = ? number[];
bool? = ? bool[];
null? = ? {};
list? = ? list[X];
object? = ? list[pair[K, V]];

---------------------------------------------------------------
-- §2. Constructors and Projections
---------------------------------------------------------------

nil = {} | nil list?;
cons = {.car car, .cdr cdr} | cons list?;
car = list? /cons .car;
cdr = list? /cons .cdr;

null = {} | null json?;
true = {} | true | bool json?;
false = {} | false | bool json?;
number = float64? | number json?;
string = string? | string json?;
bool = bool? | bool json?;
list = list? | list json?;
object = object? | object json?;

---------------------------------------------------------------
-- §3. String Equality (eq_string?)
---------------------------------------------------------------

eq_bit? = ?{ <{} 0, {} 1>=B x, B y }
  < {.x /0 x, .y /0 y}, {.x /1 x, .y /1 y} > {};

eq_bits1? = { {.x .0 x, .y .0 y} eq_bit? 0 } {};
eq_bits2? = { {.x x, .y y} eq_bits1? a, {.x .1 x, .y .1 y} eq_bit? 1 } {};
eq_bits3? = { {.x x, .y y} eq_bits2? a, {.x .2 x, .y .2 y} eq_bit? 2 } {};
eq_bits4? = { {.x x, .y y} eq_bits3? a, {.x .3 x, .y .3 y} eq_bit? 3 } {};
eq_bits7? = {
  {.x x, .y y} eq_bits4? a,
  {.x .4 x, .y .4 y} eq_bit? 4,
  {.x .5 x, .y .5 y} eq_bit? 5,
  {.x .6 x, .y .6 y} eq_bit? 6
} {};
eq_bits8? = { {.x x, .y y} eq_bits7? a, {.x .7 x, .y .7 y} eq_bit? 7 } {};
eq_bits11? = {
  {.x x, .y y} eq_bits8? a,
  {.x .8 x, .y .8 y} eq_bit? 8,
  {.x .9 x, .y .9 y} eq_bit? 9,
  {.x .10 x, .y .10 y} eq_bit? 10
} {};

eq_bmp_common_hi? = <
  {.x /h08_0F x, .y /h08_0F y} eq_bits3?,
  {.x /h10_7F x, .y /h10_7F y} eq_bits7?,
  {.x /h80_CF x, .y /h80_CF y} eq_bits7?,
  {.x /hD0_D7 x, .y /hD0_D7 y} eq_bits3?,
  {.x /hF9 x, .y /hF9 y} {},
  {.x /hFA_FB x, .y /hFA_FB y} eq_bits1?,
  {.x /hFC_FD x, .y /hFC_FD y} eq_bits1?,
  {.x /hFE_FF x, .y /hFE_FF y} eq_bits1?
>;

eq_bmp_private_use_hi? = <
  {.x /hE0_EF x, .y /hE0_EF y} eq_bits4?,
  {.x /hF0_F7 x, .y /hF0_F7 y} eq_bits3?,
  {.x /hF8 x, .y /hF8 y} {}
>;

eq_plane2_16? = <
  {.x /p02_03 x, .y /p02_03 y} eq_bits1?,
  {.x /p04_07 x, .y /p04_07 y} eq_bits2?,
  {.x /p08_0F x, .y /p08_0F y} eq_bits3?,
  {.x /p10 x, .y /p10 y} {}
>;

eq_char? = <
  {.x /ascii x, .y /ascii y} eq_bits7?,
  {
    {.x /bmp_common .hi x, .y /bmp_common .hi y} eq_bmp_common_hi? hi,
    {.x /bmp_common .lo x, .y /bmp_common .lo y} eq_bits8? lo
  } {},
  {
    {
      .x /bmp_private_use .hi x,
      .y /bmp_private_use .hi y
    } eq_bmp_private_use_hi? hi,
    {.x /bmp_private_use .lo x, .y /bmp_private_use .lo y} eq_bits8? lo
  } {},
  {.x /plane0 x, .y /plane0 y} eq_bits11?,
  {
    {
      .x /supplementary_plane1 .mid x,
      .y /supplementary_plane1 .mid y
    } eq_bits8? mid,
    {
      .x /supplementary_plane1 .lo x,
      .y /supplementary_plane1 .lo y
    } eq_bits8? lo
  } {},
  {
    {
      .x /supplementary_planes2_16 .plane x,
      .y /supplementary_planes2_16 .plane y
    } eq_plane2_16? plane,
    {
      .x /supplementary_planes2_16 .mid x,
      .y /supplementary_planes2_16 .mid y
    } eq_bits8? mid,
    {
      .x /supplementary_planes2_16 .lo x,
      .y /supplementary_planes2_16 .lo y
    } eq_bits8? lo
  } {}
>;

_eq_string? = {.x string? x, .y string? y} <
  {.x /nil x, .y /nil y} {},
  {
    {.x /cons .car x, .y /cons .car y} eq_char? if,
    {.x /cons .cdr x, .y /cons .cdr y} then
  } .then _eq_string?
>;

-- Identity filter on {x, y} when strings x and y are equal
eq_string? = ?{ S x, S y } {_eq_string? if, () then} .then;

---------------------------------------------------------------
-- §4. JSON Object Helpers (dot, has_key?, keys, values, remove, put)
---------------------------------------------------------------

-- Lookup key in object entry list: {key, object} -> val
dot = ?{ K key, O object } {.key string? key, .object object? object} <
  {
    {.key x, .object /cons .car .key y} eq_string? if,
    .object /cons .car .val then
  } .then,
  {.key key, .object /cons .cdr object} dot
>;

-- Identity filter on {key, object} when key exists in object
has_key? = ?{ K key, O object } {dot if, () then} .then;

-- Extract list of keys from an object entry list: object -> list
keys = object? <
  /nil nil,
  /cons {.car .key car, .cdr keys cdr} cons
>;

-- Extract list of values from an object entry list: object -> list
values = object? <
  /nil nil,
  /cons {.car .val car, .cdr values cdr} cons
>;

-- Remove all entries matching key from object: {key, object} -> object
remove = ?{ K key, O object } {.key string? key, .object object? object} <
  {.object /nil if, nil then} .then,
  {
    {.key x, .object /cons .car .key y} eq_string? if,
    {.key key, .object /cons .cdr object} remove then
  } .then,
  {
    .object /cons .car car,
    {.key key, .object /cons .cdr object} remove cdr
  } cons
>;

-- Insert or replace {key, val} in object: {key, val, object} -> object
put = ?{ K key, V val, O object } {
  {.key string? key, .val val} car,
  {.key key, .object object} remove cdr
} cons;

-- Lookup bits? index in cons-list: {index, list} -> value
bits? = ?< {} _, bits? 0, bits? 1 > = bits?;
0b = {} | _;
0 = 0b | 0;
1 = 0b | 1;

_inv = ?{ < {} _, B 0, B 1 >=B x, B r } <
  { .x /_ if, .r then } .then,
  { .x /0 x, .r |0 r } _inv,
  { .x /1 x, .r |1 r } _inv
> bits?;
_dec = ?{ < {} _, B 0, B 1 >=B x, B y } <
  { .x /1 x, .y |0 r } _inv,
  { .x /0 x, .y |1 y } _dec
> bits?;
_inc = ?{ < {} _, B 0, B 1 >=B x, B y } <
  { .x /_ if, .y |1 then } .then,
  { .x /0 x, .y |1 r } _inv,
  { .x /1 x, .y |0 y } _inc
> bits?;
_trim0 = bits? < /0 _trim0, /_ 0, () >;
dec_nat = { { () x, 0b r } _inv x, 0b y } _dec _trim0;
inc_nat = { { () x, 0b r } _inv x, 0b y } _inc;

nth = ?{ I index, L list } { .index bits? index, .list list? list } <
  { .index /0 /_ if, .list /cons .car then } .then,
  { .index dec_nat index, .list /cons .cdr list } nth
>;

-- Count elements in list or object: list -> bits?, object -> bits?
_list_size = ?{
  < {} nil, { X car, L cdr } cons >=L list,
  < {} _, B 0, B 1 >=B acc
} <
  { .list /nil if, .acc then } .then,
  { .list /cons .cdr list, .acc inc_nat acc } _list_size
> bits?;
list_size = { list? list, 0 acc } _list_size;

_obj_size = ?{
  < {} nil, { { K key, V val } car, O cdr } cons >=O object,
  < {} _, B 0, B 1 >=B acc
} <
  { .object /nil if, .acc then } .then,
  { .object /cons .cdr object, .acc inc_nat acc } _obj_size
> bits?;
obj_size = { object? object, 0 acc } _obj_size;
