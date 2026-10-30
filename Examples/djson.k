-- Examples/djson.k: Universal dynamic JSON schema and standard methods
-- Works with codecs/djson.mjs (k-djson) and codecs/utf8.mjs (k-utf8).
-- Load core.k and Examples/ieee.k first; shared types use canonical hashes.

---------------------------------------------------------------
-- §1. Named Pattern Definitions & Component Schemas
---------------------------------------------------------------

bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[];
bits[] = @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb[];
unicode[] = @AhRir67FipnHnJfDU7fSQ3Xhcg6BTJYwtq6HGsWwZtbi[];
string[] = @Pt3MwQwzUPxQKu58zXR3qUBHWTzfycx5bSZGzcK6EZQK[];

-- IEEE sign[], exp11[], frac52[], and float64[], respectively.
sign[] = @F7RNp9YbYnUXpfZBQViADi6LZyXYYuiJHc9KckfZtDvm[];
exponent[] = @F2KGfE24DhFGChv6pVAb4pkC9YWvt5izpnnwFDTLfG2h[];
fraction[] = @ziwtSeiWqhQZjbpnB2TpWhSJCDTWfX2QzGvPd3DdVJCZ[];
number[] = @AR4sFGMwXgjj5p7dhi8sJKDWNbrXxLefQUCBRNm5fP6t[];

-- Shared numeric and bit operations from ieee.k.
0b = @9sQsLXUsbMiGLXkQgJ6yaTLUBQGLgViQjKE3hXAYyRyv;
_json_add = @7Ti3bPstMgbE646YTPFA5hhRjUYMMqw2Js2v9P2DYcj7;
_json_c1023 = @6QziDQ3acyiQV7XQsX77uhPbTDvpdVGALzKAcxhwj5zQ;
_json_code = @tCRYGsCvqqxP8RuPMArp9RCmNcPx8Db8kByPsELybCEs;
_json_digit = @6z6ZqEvuwhZUXy8MNWJTMjkiKuQyPx6yBg3Dt8fq28nN;
_json_e = @u4iFEcWSuTUp8FTaJzGdzDxbL3yeHDPHDUf6FUyN9tXB;
_json_field7 = @SFuC8GpSvwemLh82Kz4t6h9Bar5ieF4v28ibNZjQb48a;
_json_finite_float64 = @pAX8ruNaFXEAPtKeYvVA6kLmqYhNE7QCAKy2TEFehnwn;
_json_lt = @7QSUgraQEgC36r98QNGtWniC4gmMH2d3EhFCQtsf5f9z;
_json_minus = @3dfy8mG53Ma2bm2JfsJkLyWB3ZZLrEeySSjYqwxgMeuB;
_json_reverse_bits = @L8Qs2DUkpsfceEf6JTPqQq5isKixewAkH59LQNFcjSXT;
_json_scan_float64 = @g5LXvDiuKsRN2PpcGkV9yyqKVvKR7hAZcidYZxshJTqz;
_json_small1 = @97jK2UDSQYuQAMcUFtHmdcD8ps35BFcS9JtDYUBDDv3n;
_json_small2 = @WhYQVxriUH2hMkkEvnqqakR6KzN98s5j7Grcx3FfKGhM;
_json_small3 = @6RdPhiu8dmAUde9dLnQxry2kDWp467iGakS2Nme48Av9;
_json_small4 = @weJhuSPJmJVMuxsZRtR9Bx2qvMb5VT2ScxVEpQbpqx3y;
_json_small7 = @2TWZiDJ49k6mUU3asYgw4t9wVhgS9QBM5sQLe5XrW7Sg;
_json_sub = @7WsmrsjvuEnSm4GgTLYbSrkbAjneZVwQhjLHmQunHawV;
_json_trim = @A63sgVq6WwqxwiRPkvYc7T3ciLh5KSvgFMBEhs9P7E4u;
_json_unpack16 = @FXa3B3fvZvwLsh8aApBh4peYmQvG5H8VWr89Vb6yvjXx;
inc_nat = @FgRFGHftiMfrwxja43xTRMYqhUmKS3KVhWTWEecvACnT;
inv_bits = @L8Qs2DUkpsfceEf6JTPqQq5isKixewAkH59LQNFcjSXT;
nat_to_float64 = @sru5LbMj5K3EsA7Y5i5vcXGBGwPjMx8hzBUii6jvsUHK;
push_bit = @kjzD5wy3vVihSyEmpqUTiiQaTc2vikejKC66D7s5DfE2;
push_bits1 = @5xxBWEQkTGDnHkuyA4hPaqswq6DDymPR53Z6vX6DANyn;
push_bits2 = @agFtk8Zs8KrTR6zu9Nx5KDJCHTU8biAR6LyhGdd9gGqR;
push_bits3 = @B9yHHLyYAyUfQfvXzghbPutyN852tXraqbhbPpCBHRmW;
push_bits4 = @iz9bg6NQF7RXzM6ibW3MfBrUAYYXyUKhFWTHJjHn9Fvy;
push_bits7 = @ey5ZakdvsDjpijiwa4pmsv9Nvi7uhyvZU2HpCfT2PJqk;

bool[] = < {} true, {} false >;

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

---------------------------------------------------------------
-- §9. JSON Text Decoder
---------------------------------------------------------------

-- Parse exactly one JSON document. Invalid text, non-finite numbers,
-- and unpaired surrogate escapes are undefined, as in k-djson.
parseJson = ?string[] _json_value {
  .rest _json_ws /nil end,
  .value value
} .value ?djson[];

_json_result[] = { string[] rest, djson[] value };
_json_text[] = { string[] rest, string[] value };

_json_reverse = { () x, nil acc } _json_reverse_loop;
_json_reverse_loop = ?{ string[] x, string[] acc } <
  { .x /nil if, .acc then } .then,
  { .x /cons .cdr x, { .x /cons .car car, .acc cdr } |cons acc } _json_reverse_loop
> ?string[];

_json_ws = ?string[] <
  < _json_space, _json_tab, _json_lf, _json_cr > _json_ws,
  ()
> ?string[];

_json_value = ?string[] _json_ws <
  _json_n _json_u _json_l _json_l { () rest, null value },
  _json_t _json_r _json_u _json_e { () rest, true value },
  _json_f _json_a _json_l _json_s _json_e { () rest, false value },
  _json_string { .rest rest, .value |string value },
  _json_array,
  _json_object,
  _json_number
> ?_json_result[];

_json_string = ?string[] _json_quote { () rest, nil acc } _json_string_loop;
_json_string_kind = ?unicode[] <
  { _json_code /1 /0 /0 /0 /1 /0 /_ if, {} |quote then } .then,
  { _json_code /1 /0 /1 /1 /1 /0 /0 /_ if, {} |escape then } .then,
  { /ascii { .6 /0 a, .5 /0 b } if, {} |control then } .then,
  {} |plain
>;
_json_string_loop = ?{ string[] rest, string[] acc } {
  .rest /cons head, .acc acc, .rest /cons .car _json_string_kind kind
} <
  {
    .kind /quote if,
    { .head.cdr rest, .acc _json_reverse value } then
  } .then,
  {
    .kind /plain if,
    { .head.cdr rest, { .head.car car, .acc cdr } |cons acc } _json_string_loop then
  } .then,
  {
    .kind /escape if,
    { .head.cdr _json_escape escaped, .acc acc }
    { .escaped.rest rest, { .escaped.value car, .acc cdr } |cons acc }
      _json_string_loop then
  } .then
> ?_json_text[];

_json_array = _json_open_array _json_ws <
  _json_close_array { () rest, empty_list value },
  { () rest, nil tree, 0 index } _json_array_item
>;
_json_array_item = ?{ string[] rest, btrie[djson[]] tree, bits[] index } {
  .rest _json_value item, .tree tree, .index index
} {
  .item.rest _json_ws rest,
  { .index index, .item.value val, .tree list } put_nth tree,
  .index inc_nat index
} <
  { .rest _json_close_array rest, .tree |list value },
  { .rest _json_comma rest, .tree tree, .index index } _json_array_item
> ?_json_result[];

_json_object = _json_open_object _json_ws <
  _json_close_object { () rest, empty_object value },
  { () rest, nil tree } _json_object_item
>;
_json_object_item = ?{ string[] rest, btrie[djson[]] tree } {
  .rest _json_ws _json_string key, .tree tree
} {
  .key.rest _json_ws _json_colon _json_value item,
  .key.value key, .tree tree
} {
  .item.rest _json_ws rest,
  { .key key, .item.value val, .tree object } put tree
} <
  { .rest _json_close_object rest, .tree |object value },
  { .rest _json_comma rest, .tree tree } _json_object_item
> ?_json_result[];

-- ASCII consumers return the unconsumed input.
_json_space = /cons { .car _json_code /1 /0 /0 /0 /0 /0 /_ if, .cdr then } .then;
_json_tab = /cons { .car _json_code /1 /0 /0 /1 /_ if, .cdr then } .then;
_json_lf = /cons { .car _json_code /1 /0 /1 /0 /_ if, .cdr then } .then;
_json_cr = /cons { .car _json_code /1 /1 /0 /1 /_ if, .cdr then } .then;
_json_quote = /cons { .car _json_code /1 /0 /0 /0 /1 /0 /_ if, .cdr then } .then;
_json_backslash = /cons { .car _json_code /1 /0 /1 /1 /1 /0 /0 /_ if, .cdr then } .then;
_json_slash = /cons { .car _json_code /1 /0 /1 /1 /1 /1 /_ if, .cdr then } .then;
_json_b = /cons { .car _json_code /1 /1 /0 /0 /0 /1 /0 /_ if, .cdr then } .then;
_json_f = /cons { .car _json_code /1 /1 /0 /0 /1 /1 /0 /_ if, .cdr then } .then;
_json_n = /cons { .car _json_code /1 /1 /0 /1 /1 /1 /0 /_ if, .cdr then } .then;
_json_r = /cons { .car _json_code /1 /1 /1 /0 /0 /1 /0 /_ if, .cdr then } .then;
_json_t = /cons { .car _json_code /1 /1 /1 /0 /1 /0 /0 /_ if, .cdr then } .then;
_json_u = /cons { .car _json_code /1 /1 /1 /0 /1 /0 /1 /_ if, .cdr then } .then;

_json_a = /cons { .car _json_code /1 /1 /0 /0 /0 /0 /1 /_ if, .cdr then } .then;
_json_l = /cons { .car _json_code /1 /1 /0 /1 /1 /0 /0 /_ if, .cdr then } .then;
_json_s = /cons { .car _json_code /1 /1 /1 /0 /0 /1 /1 /_ if, .cdr then } .then;
_json_comma = /cons { .car _json_code /1 /0 /1 /1 /0 /0 /_ if, .cdr then } .then;
_json_colon = /cons { .car _json_code /1 /1 /1 /0 /1 /0 /_ if, .cdr then } .then;
_json_open_array = /cons { .car _json_code /1 /0 /1 /1 /0 /1 /1 /_ if, .cdr then } .then;
_json_close_array = /cons { .car _json_code /1 /0 /1 /1 /1 /0 /1 /_ if, .cdr then } .then;
_json_open_object = /cons { .car _json_code /1 /1 /1 /1 /0 /1 /1 /_ if, .cdr then } .then;
_json_close_object = /cons { .car _json_code /1 /1 /1 /1 /1 /0 /1 /_ if, .cdr then } .then;

_json_hex_letter = _json_code < /1 /0 /0, /1 /1 /0 > <
  /0 /0 /0 /1 /_ 0b |0 |1 |0 |1,
  /0 /0 /1 /0 /_ 0b |1 |1 |0 |1,
  /0 /0 /1 /1 /_ 0b |0 |0 |1 |1,
  /0 /1 /0 /0 /_ 0b |1 |0 |1 |1,
  /0 /1 /0 /1 /_ 0b |0 |1 |1 |1,
  /0 /1 /1 /0 /_ 0b |1 |1 |1 |1
>;
_json_hex = < _json_digit, /cons { .cdr rest, .car _json_hex_letter value } >;

-- Unicode escape decoding.

_json_c8 = 0b |0 |0 |0 |1;
_json_c9 = 0b |1 |0 |0 |1;
_json_c16 = 0b |0 |0 |0 |0 |1;

_json_c128 = 0b |0 |0 |0 |0 |0 |0 |0 |1;
_json_c65536 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1;
_json_c55296 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 |1 |0 |1 |1;
_json_c56320 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 |1 |1 |0 |1 |1;
_json_c57344 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 |1 |1;
_json_c224 = 0b |0 |0 |0 |0 |0 |1 |1 |1;
_json_c240 = 0b |0 |0 |0 |0 |1 |1 |1 |1;
_json_c248 = 0b |0 |0 |0 |1 |1 |1 |1 |1;
_json_c249 = 0b |1 |0 |0 |1 |1 |1 |1 |1;
_json_c250 = 0b |0 |1 |0 |1 |1 |1 |1 |1;
_json_c252 = 0b |0 |0 |1 |1 |1 |1 |1 |1;
_json_c254 = 0b |0 |1 |1 |1 |1 |1 |1 |1;
_json_c208 = 0b |0 |0 |0 |0 |1 |0 |1 |1;
_json_c216 = 0b |0 |0 |0 |1 |1 |0 |1 |1;

_json_c2 = 0b |0 |1;
_json_c4 = 0b |0 |0 |1;
_json_c1024 = _json_c1023 inc_nat;

-- Reconstruct the same Unicode partitions used by core.k and k-utf8.
_json_unicode = ?bits[] _json_unpack16 <
  { .plane /_ if, () _json_bmp then } .then,
  {
    .plane /1 /_ if,
    { .hi mid, .lo lo } |supplementary_plane1 then
  } .then,
  { .plane _json_plane plane, .hi mid, .lo lo } |supplementary_planes2_16
> ?unicode[];
_json_bmp = {
  () parts, .hi { () x, 0b acc } push_bits8 _json_trim high
} <
  { .high /_ a, .parts.lo.7 /0 b, .parts.lo _json_field7 |ascii then } .then,
  {
    { .high x, _json_c8 y } _json_lt if,
    {
      .parts.lo.0 0, .parts.lo.1 1, .parts.lo.2 2, .parts.lo.3 3,
      .parts.lo.4 4, .parts.lo.5 5, .parts.lo.6 6, .parts.lo.7 7,
      .parts.hi.0 8, .parts.hi.1 9, .parts.hi.2 10
    } |plane0 then
  } .then,
  { .high _json_bmp_hi high, .parts.lo lo } <
    { .high /common hi, .lo lo } |bmp_common,
    { .high /private hi, .lo lo } |bmp_private_use
  >
>;
_json_bmp_hi = ?bits[] <
  {
    { () x, _json_c16 y } _json_lt if,
    { () x, _json_c8 y } _json_sub _json_small3 |h08_0F |common then
  } .then,
  {
    { () x, _json_c128 y } _json_lt if,
    { () x, _json_c16 y } _json_sub _json_small7 |h10_7F |common then
  } .then,
  {
    { () x, _json_c208 y } _json_lt if,
    { () x, _json_c128 y } _json_sub _json_small7 |h80_CF |common then
  } .then,
  {
    { () x, _json_c216 y } _json_lt if,
    { () x, _json_c208 y } _json_sub _json_small3 |hD0_D7 |common then
  } .then,
  {
    { () x, _json_c240 y } _json_lt if,
    { () x, _json_c224 y } _json_sub _json_small4 |hE0_EF |private then
  } .then,
  {
    { () x, _json_c248 y } _json_lt if,
    { () x, _json_c240 y } _json_sub _json_small3 |hF0_F7 |private then
  } .then,
  { () x, _json_c248 y } _json_sub /_ {} |hF8 |private,
  { () x, _json_c249 y } _json_sub /_ {} |hF9 |common,
  {
    { () x, _json_c252 y } _json_lt if,
    { () x, _json_c250 y } _json_sub _json_small1 |hFA_FB |common then
  } .then,
  {
    { () x, _json_c254 y } _json_lt if,
    { () x, _json_c252 y } _json_sub _json_small1 |hFC_FD |common then
  } .then,
  { () x, _json_c254 y } _json_sub _json_small1 |hFE_FF |common
>;
_json_plane = ?bits[] <
  {
    { () x, _json_c4 y } _json_lt if,
    { () x, _json_c2 y } _json_sub _json_small1 |p02_03 then
  } .then,
  {
    { () x, _json_c8 y } _json_lt if,
    { () x, _json_c4 y } _json_sub _json_small2 |p04_07 then
  } .then,
  {
    { () x, _json_c16 y } _json_lt if,
    { () x, _json_c8 y } _json_sub _json_small3 |p08_0F then
  } .then,
  /1 /0 /0 /0 /0 /_ {} |p10
>;

_json_times16 = _json_reverse_bits |0 |0 |0 |0 _json_reverse_bits _json_trim;
_json_hex4 = _json_hex
  { .rest _json_hex next, .value _json_times16 high }
  { .next.rest rest, { .high x, .next.value y } _json_add value }
  { .rest _json_hex next, .value _json_times16 high }
  { .next.rest rest, { .high x, .next.value y } _json_add value }
  { .rest _json_hex next, .value _json_times16 high }
  { .next.rest rest, { .high x, .next.value y } _json_add value };

_json_escape = <
  _json_quote { () rest, 0b |0 |1 |0 |0 |0 |1 _json_unicode value },
  _json_backslash { () rest, 0b |0 |0 |1 |1 |1 |0 |1 _json_unicode value },
  _json_slash { () rest, 0b |1 |1 |1 |1 |0 |1 _json_unicode value },
  _json_b { () rest, _json_c8 _json_unicode value },
  _json_f { () rest, 0b |0 |0 |1 |1 _json_unicode value },
  _json_n { () rest, 0b |0 |1 |0 |1 _json_unicode value },
  _json_r { () rest, 0b |1 |0 |1 |1 _json_unicode value },
  _json_t { () rest, _json_c9 _json_unicode value },
  _json_u _json_hex4 <
    _json_surrogate_pair,
    { .rest rest, .value _json_unicode value }
  >
>;
_json_surrogate_pair = {
  { .value x, _json_c55296 y } _json_sub high,
  .rest _json_backslash _json_u _json_hex4 low
} {
  { .high x, _json_c1024 y } _json_lt a,
  { .low.value x, _json_c57344 y } _json_lt b,
  .high _json_reverse_bits |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 _json_reverse_bits x,
  { .low.value x, _json_c56320 y } _json_sub y,
  .low.rest rest
} {
  { { .x x, .y y } _json_add x, _json_c65536 y } _json_add _json_unicode value,
  .rest rest
};

-- JSON numbers use IEEE's exact scanner, with JSON's lexical/finite guards.
_json_number = ?string[] {
  < _json_minus {}, _json_digit {} > if, () then
} .then _json_scan_float64 {
  .value _json_finite_float64 if,
  { .rest rest, .value |number value } then
} .then ?_json_result[];
