-- Examples/djson.k: Universal dynamic JSON schema and standard methods
-- Works with codecs/djson.mjs (k-djson) and codecs/utf8.mjs (k-utf8).

---------------------------------------------------------------
-- §1. Named Pattern Definitions & Component Schemas
---------------------------------------------------------------

-- Defined in 'core.k':
bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[];
bits[] = @VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb[];
unicode[] = @AhRir67FipnHnJfDU7fSQ3Xhcg6BTJYwtq6HGsWwZtbi[];
string[] = @Pt3MwQwzUPxQKu58zXR3qUBHWTzfycx5bSZGzcK6EZQK[];
list[X] = @JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe[X];

-- Defined in 'ieee.k':
number[] = @AR4sFGMwXgjj5p7dhi8sJKDWNbrXxLefQUCBRNm5fP6t[];

-- Aliases to definitions imported from 'ieee.k':
_a_ = @SWz2Su6jrKMLBJUdstChXXqBxhmYXPQmgZzjiMY2C3WU;
_cr_ = @mmfxkDakZKxTnSem6TaBMwFxhHCNLNeQ5NGB6FXJEuBc;
_e_ = @6dEMmL8cnMq3PnvKS9XKkLbXagZjkBGBSteuCnsMTyeJ;
_E_ = @PSZiUBnRAzerMrp44TZUfjaFAen6JcQHGGuVzLFBXxVX;
_f_ = @EztMxif4CSk5yCwKNV4HNybtGFrT5jcE3YdbLgzN5thJ;
_lf_ = @wkUwcydRgSb7SEEwv3i9Aspp6DL4eVidUwq9e6Fk2mqL;
_tab_ = @AsNRztmSnK3duXxW9GJygQtYRjeUCN3PqPPwXA9Qa475;
a_char = @y4rrNXbrZhy9RiesNn8eBHWtMuzUbzmC4sirARkEgPzm;
c1023 = @LpKiXpTEeZHk5m7UTPvJY2VNzAy9fN27Vk6mFmGarLMx;
digit = @NYMMKZiubEnXsxvRLm2YqyW29r4Z9nzp4f4bDzxzUDh6;
e_char = @MPxm9SLfNCWws3haR7D7rEKsQMAQBtv35wM6ZB6vKs5V;
eq_char? = @KdvwBdZucwy9HNhunGUiJu23AJCV3msXNURv7FKT4NSe;
f_char = @Ad4G3Y348pFB6DWunnJ6gpc8ShmDLaLm6ZZRSz7dAgS6;
field7 = @SFuC8GpSvwemLh82Kz4t6h9Bar5ieF4v28ibNZjQb48a;
finite_float64? = @Un56DNRzisnRedgtm6hev8FUXeQdwVvYanhrQ7hCVKmz;
inc = @2QXTvLGKmk3RsaefL4XgXyzvawx3LUUhDuXKRnuWDWss;
inv = @KDfkF87mFdEDQMXxCy6beDNMMjMtzipBH2RJ2ZGRs7EL;
inv_loop = @DWXKJJnBu3bXPpNdp2i8S9yyd6RMaafpg4UNk7KiY8mJ;
lt? = @K99ZE5z4hFm8uECZt7bWS8nfHL66amv5rkFnEf36uhwA;
minus = @QVa9EQpHxibQCyNaHteD5av6Cqmv3sa8yLTBVjBMWaSn;
minus_char = @yNxNaynLphA2KpvC7Tj5dgTPCqie894zt2CsRrdgewAB;
n_char = @3mzFMcRzt8Dr79Txp94JrkeGzneHPq2dfFbhamPyvqsM;
natToFloat64 = @EqXtFuMvgJtizS4ZvcHnJ3WYwRSC7yxDrr6cBAz5ZLm2;
plus = @zRNanC6g5KT46AcWdpxvKx7jwZVyQtdFffiGq23yDGqG;
push_bit = @kjzD5wy3vVihSyEmpqUTiiQaTc2vikejKC66D7s5DfE2;
push_bits1 = @LFsEP3rFznpUYkr7dAfvmjb2DfsvvszDgbu7ACqb6rfK;
push_bits2 = @NawPPURs8ncgTSfDiSKZRCY9xsCpEcNBRy6KBqzCAyXW;
push_bits3 = @L6GeHQUwB6F9cCuJvThxXPZs5LMyBQ8sjpgRe2QPXKeD;
push_bits4 = @ijaDf66RY5jGTGHzURqGZqdijjEFecFcSbw7yyt6ejxu;
reverse = @Q9ZynEvvhk7n4J4MNnx2fS5bXGHiuRkgU3wcaccJAi6u;
scanFloat64 = @Lb5WBVHJQ5qRKE9YcDNQBLqY8SiCqJtjqwjVFbra2g8c;
small1 = @FSDDBdqc4vVVjadzJQfmYFLrq2wyGrpikUdbPgB4Wbh9;
small2 = @zCZKN3KcpBGcAkqHUUt3e5BciS72tXmkzjY4YTVXe9HT;
small3 = @KcrTH9DxHaZfahyv2wanwLg3nNLjFTeHBey9Vmmw5b9H;
small4 = @Xx9utSfZgL6D9FuwRMLm2L2BgeyqXK5D89nFiuGuN87a;
small7 = @65eQ4SEU3ndiKxU9Pyg9syPbKwWWiuNidR86Ci9TVTBy;
t_char = @HvsJepUNMRiHiGUr72LCW8WAhY99iciSyVqR4AKwZHYn;
trim = @KpFXwb3ZnbDWfADPih98fEdriz4xZwBNabFpsNw7PdLu;
unpack16 = @xTMhhuLL7hfKTyF3mBGfYPatqmeVGqpQJQQmXnGEUaFJ;
ws = @S8kaqgJdGkCNBdGEAdkvGnedVSMFKnPBpjRpKAdfYP5q;

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

djson[] = <
  number[] number,
  string[] string,
  bool[] bool,
  {} null,
  btrie[J] list,
  btrie[J] object
> = J;

ascii = | ascii ?unicode[];
---------------------------------------------------------------
-- §2. Constructors and Projections
---------------------------------------------------------------
0b = {}|_;
b0 = {}|0;
b1 = {}|1;
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
step_0 = ?btrie[X] /trie .0;
step_1 = ?btrie[X] /trie .1;

step_bit = ?{bit[] b, btrie[X] t} <
  { .b /0 if, .t step_0 then } .then,
  { .b /1 if, .t step_1 then } .then
> ?btrie[X];

-- Step N bits from MSB (.N-1) down to LSB (.0)
step_bits1 = ?{(...) x, btrie[X] t} { .x .0 b, .t t } step_bit;
step_bits2 = ?{(...) x, btrie[X] t} { .x x, { .x .1 b, .t t } step_bit t } step_bits1;
step_bits3 = ?{(...) x, btrie[X] t} { .x x, { .x .2 b, .t t } step_bit t } step_bits2;
step_bits4 = ?{(...) x, btrie[X] t} { .x x, { .x .3 b, .t t } step_bit t } step_bits3;
step_bits5 = ?{(...) x, btrie[X] t} { .x x, { .x .4 b, .t t } step_bit t } step_bits4;
step_bits6 = ?{(...) x, btrie[X] t} { .x x, { .x .5 b, .t t } step_bit t } step_bits5;
step_bits7 = ?{(...) x, btrie[X] t} { .x x, { .x .6 b, .t t } step_bit t } step_bits6;
step_bits8 = ?{(...) x, btrie[X] t} { .x x, { .x .7 b, .t t } step_bit t } step_bits7;
step_bits9 = ?{(...) x, btrie[X] t} { .x x, { .x .8 b, .t t } step_bit t } step_bits8;
step_bits10 = ?{(...) x, btrie[X] t} { .x x, { .x .9 b, .t t } step_bit t } step_bits9;
step_bits11 = ?{(...) x, btrie[X] t} { .x x, { .x .10 b, .t t } step_bit t } step_bits10;

step_bmp_common_hi = ?{ (...) hi, btrie[X] t } <
  { .hi /h08_0F x, .t step_0 step_0 step_0 t } step_bits3,
  { .hi /h10_7F x, .t step_0 step_0 step_1 t } step_bits7,
  { .hi /h80_CF x, .t step_0 step_1 step_0 t } step_bits7,
  { .hi /hD0_D7 x, .t step_0 step_1 step_1 t } step_bits3,
  { .hi /hF9 if, .t step_1 step_0 step_0 then } .then,
  { .hi /hFA_FB x, .t step_1 step_0 step_1 t } step_bits1,
  { .hi /hFC_FD x, .t step_1 step_1 step_0 t } step_bits1,
  { .hi /hFE_FF x, .t step_1 step_1 step_1 t } step_bits1
>;

step_bmp_priv_hi = ?{ (...) hi, btrie[X] t } <
  { .hi /hE0_EF x, .t step_0 t } step_bits4,
  { .hi /hF0_F7 x, .t step_1 step_0 t } step_bits3,
  { .hi /hF8 if, .t step_1 step_1 then } .then
>;

step_plane2_16 = ?{ (...) p, btrie[X] t } <
  { .p /p02_03 x, .t step_0 step_0 t } step_bits1,
  { .p /p04_07 x, .t step_0 step_1 t } step_bits2,
  { .p /p08_0F x, .t step_1 step_0 t } step_bits3,
  { .p /p10 if, .t step_1 step_1 then } .then
>;

-- Advance trie by one Unicode character: { char, t } -> t
step_char = ?{unicode[] char, btrie[X] t} <
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
dot = ?{ string[] key, btrie[V] object } <
  { .key /nil if, .object /trie .val /val then } .then,
  {
    .key /cons .cdr key,
    { .key /cons .car char, .object t } step_char object
  } dot
>;

-- Low-level lookup ?bits[] index in list trie: { index, list } -> val
nth_trie = ?{ bits[] index, btrie[V] list } <
  { .index /_ if, .list /trie .val /val then } .then,
  <
    { .index /0 index, .list /trie .0 list },
    { .index /1 index, .list /trie .1 list }
  > nth_trie
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
} nth_trie;

-- Filter: succeeds as identity if ?djson[] object contains string key
has_key? = { get if, () then } .then;
has? = has_key?;

-- Filter: succeeds as identity if ?djson[] list contains index
has_index? = { nth if, () then } .then;
has_nth? = has_index?;

---------------------------------------------------------------
-- §5. Trie Update & Removal (put, remove, put_nth, remove_nth)
---------------------------------------------------------------

push_bits5 = ?{(...) x, (...) acc} { .x .4 b, { .x x, .acc acc } push_bits4 acc } push_bit;
push_bits6 = ?{(...) x, (...) acc} { .x .5 b, { .x x, .acc acc } push_bits5 acc } push_bit;
push_bits7 = ?{(...) x, (...) acc} { .x .6 b, { .x x, .acc acc } push_bits6 acc } push_bit;
push_bits8 = ?{(...) x, (...) acc} { .x .7 b, { .x x, .acc acc } push_bits7 acc } push_bit;
push_bits9 = ?{(...) x, (...) acc} { .x .8 b, { .x x, .acc acc } push_bits8 acc } push_bit;
push_bits10 = ?{(...) x, (...) acc} { .x .9 b, { .x x, .acc acc } push_bits9 acc } push_bit;
push_bits11 = ?{(...) x, (...) acc} { .x .10 b, { .x x, .acc acc } push_bits10 acc } push_bit;

push_bmp_common_hi = ?{(...) hi, (...) acc} <
  { .hi /h08_0F x, .acc acc } push_bits3 |0 |0 |0,
  { .hi /h10_7F x, .acc acc } push_bits7 |1 |0 |0,
  { .hi /h80_CF x, .acc acc } push_bits7 |0 |1 |0,
  { .hi /hD0_D7 x, .acc acc } push_bits3 |1 |1 |0,
  { .hi /hF9 if, .acc |0 |0 |1 then } .then,
  { .hi /hFA_FB x, .acc acc } push_bits1 |1 |0 |1,
  { .hi /hFC_FD x, .acc acc } push_bits1 |0 |1 |1,
  { .hi /hFE_FF x, .acc acc } push_bits1 |1 |1 |1
> ?bits[];

push_bmp_priv_hi = ?{(...) hi, (...) acc}  <
  { .hi /hE0_EF x, .acc acc } push_bits4 |0,
  { .hi /hF0_F7 x, .acc acc } push_bits3 |0 |1,
  { .hi /hF8 if, .acc |1 |1 then } .then
> ?bits[];

push_plane2_16 = ?{(...) p, (...) acc}  <
  { .p /p02_03 x, .acc acc } push_bits1 |0 |0,
  { .p /p04_07 x, .acc acc } push_bits2 |1 |0,
  { .p /p08_0F x, .acc acc } push_bits3 |0 |1,
  { .p /p10 if, .acc |1 |1 then } .then
> ?bits[];

prepend_char_bits = ?{unicode[] char, (...) acc}  <
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

str_to_bits_loop = ?{ string[] str, bits[] acc } <
  { .str /nil if, .acc then } .then,
  {
    .str /cons .cdr str,
    { .str /cons .car char, .acc acc } prepend_char_bits acc
  } str_to_bits_loop
> ?bits[];

str_to_bits = ?string[] { reverse str, 0b acc } str_to_bits_loop;

ensure_trie = ?btrie[V] < /nil { nil val, nil 0, nil 1 }, /trie >;

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
set = { .key key, .val val, .json /object object }
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

trie_size = ?{ btrie[V] t, bits[] acc } <
  { .t /nil if, .acc then } .then,
  {
    .t /trie .1 t,
    {
      .t /trie .0 t,
      <
        { .t /trie .val /nil if, .acc then } .then,
        { .t /trie .val /val if, .acc inc then } .then
      > acc
    } trie_size acc
  } trie_size
> ?bits[];

list_size = { ?btrie[V] t, 0 acc } trie_size;
obj_size = { ?btrie[V] t, 0 acc } trie_size;

str_len_loop = ?{ string[] str, bits[] acc } <
  { .str /nil if, .acc then } .then,
  { .str /cons .cdr str, .acc inc acc } str_len_loop
> ?bits[];
str_len = { ?string[] str, 0 acc } str_len_loop;

-- Count items in ?djson[] (object entries, list elements, or string chars)
length_nat = ?djson[] <
  /object obj_size,
  /list list_size,
  /string str_len
>;

-- Count items in ?djson[] -> ?djson[] number
length = length_nat natToFloat64 |number ?djson[];

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
  /0 { b0 bit, () rest },
  /1 { b1 bit, () rest }
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
    { .r0 .bit 0, .b1 1, .b2 2, .b3 3, .b4 4, .b5 5, .b6 6 } ascii val,
    .r0 .rest rest
  };

read_char = ?bits[] <
  /0 read_bits7
>;

bits_to_str_loop = ?{ bits[] bits, string[] acc } <
  { .bits /_ if, .acc reverse then } .then,
  { .bits read_char next, .acc acc }
  { .next.rest bits, { .next.val car, .acc cdr } |cons acc }
    bits_to_str_loop
> ?string[];

bits_to_str = ?bits[] { () bits, nil acc } bits_to_str_loop;

collect_keys = ?{
  btrie[V] tree,
  bits[] rev_path,
  list[string[]] acc
} <
  { .tree /nil if, .acc then } .then,
  {
    .tree /trie .0 tree,
    .rev_path |0 rev_path,
    {
      .tree /trie .1 tree,
      .rev_path |1 rev_path,
      <
        { .tree /trie .val /nil if, .acc then } .then,
        {
          .tree /trie .val /val if,
          { .rev_path inv bits_to_str car, .acc cdr } |cons then
        } .then
      > acc
    } collect_keys acc
  } collect_keys
> ?list[string[]];

obj_keys_raw = { () tree, 0b rev_path, nil acc } collect_keys;

-- Extract all keys from ?djson[] object as raw list: ?djson[] -> list[string[]]
keys_raw = ?djson[] /object obj_keys_raw;

keys_to_trie = ?{
  list[string[]] klist,
  bits[] index,
  btrie[V] acc
} <
  { .klist /nil if, .acc then } .then,
  {
    .klist /cons .cdr klist,
    .index inc index,
    {
      .index index,
      .klist /cons .car |string val,
      .acc list
    } put_nth acc
  } keys_to_trie
>;

-- Extract all keys from ?djson[] object as a ?djson[] list: ?djson[] -> ?djson[]
keys = ?djson[] /object obj_keys_raw
  { () klist, 0 index, nil acc } keys_to_trie
  |list ?djson[];

collect_values = ?{
  btrie[V] tree,
  list[V] acc
} <
  { .tree /nil if, .acc then } .then,
  {
    .tree /trie .0 tree,
    {
      .tree /trie .1 tree,
      <
        { .tree /trie .val /nil if, .acc then } .then,
        { .tree /trie .val /val car, .acc cdr } |cons
      > acc
    } collect_values acc
  } collect_values
> ?list[V];

obj_values_raw = { () tree, nil acc } collect_values;

-- Extract all values from ?djson[] object or list as raw list
values_raw = ?djson[] <
  /object obj_values_raw,
  /list obj_values_raw
>;

values_to_trie = ?{
  list[(...)] klist,
  bits[] index,
  btrie[(...)] acc
} <
  { .klist /nil if, .acc then } .then,
  {
    .klist /cons .cdr klist,
    .index inc index,
    {
      .index index,
      .klist /cons .car val,
      .acc list
    } put_nth acc
  } values_to_trie
>;

-- Extract all values from ?djson[] as a ?djson[] list: ?djson[] -> ?djson[]
values = <
  /object obj_values_raw
    { () klist, 0 index, nil acc } values_to_trie |list,
  ?djson[]
>;

---------------------------------------------------------------
-- §8. Type Predicates
---------------------------------------------------------------

is_null? = ?djson[] { /null if, () then } .then;
is_bool? = ?djson[] { /bool if, () then } .then;
is_number? = ?djson[] { /number if, () then } .then;
is_string? = ?djson[] { /string if, () then } .then;
is_list? = ?djson[] { /list if, () then } .then;
is_object? = ?djson[] { /object if, () then } .then;

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
> ?json_type[];

---------------------------------------------------------------
-- §9. JSON Text Decoder
---------------------------------------------------------------

-- Parse exactly one JSON document. Invalid text, non-finite numbers,
-- and unpaired surrogate escapes are undefined, as in k-djson.
parseJson = ?string[] json_value {
  .rest ws /nil end,
  .value value
} .value ?djson[];

result[] = { string[] rest, djson[] value };
text_result[] = { string[] rest, string[] value };

json_value = ?string[] ws <
  n_char u_char l_char l_char { () rest, null value },
  t_char r_char u_char e_char { () rest, true value },
  f_char a_char l_char s_char e_char { () rest, false value },
  json_string { .rest rest, .value |string value },
  json_array,
  json_object,
  json_number
> ?result[];

_quote_        = { b0 0, b1 1, b0 2, b0 3, b0 4, b1 5, b0 6 } ascii;
_backslash_    = { b0 0, b0 1, b1 2, b1 3, b1 4, b0 5, b1 6 } ascii;
_slash_        = { b1 0, b1 1, b1 2, b1 3, b0 4, b1 5, b0 6 } ascii;
_b_            = { b0 0, b1 1, b0 2, b0 3, b0 4, b1 5, b1 6 } ascii;
_bs_           = { b0 0, b0 1, b0 2, b1 3, b0 4, b0 5, b0 6 } ascii;
_ff_           = { b0 0, b0 1, b1 2, b1 3, b0 4, b0 5, b0 6 } ascii;
_l_            = { b0 0, b0 1, b1 2, b1 3, b0 4, b1 5, b1 6 } ascii;
_r_            = { b0 0, b1 1, b0 2, b0 3, b1 4, b1 5, b1 6 } ascii;
_s_            = { b1 0, b1 1, b0 2, b0 3, b1 4, b1 5, b1 6 } ascii;
_u_            = { b1 0, b0 1, b1 2, b0 3, b1 4, b1 5, b1 6 } ascii;
_comma_        = { b0 0, b0 1, b1 2, b1 3, b0 4, b1 5, b0 6 } ascii;
_colon_        = { b0 0, b1 1, b0 2, b1 3, b1 4, b1 5, b0 6 } ascii;
_open_array_   = { b1 0, b1 1, b0 2, b1 3, b1 4, b0 5, b1 6 } ascii;
_close_array_  = { b1 0, b0 1, b1 2, b1 3, b1 4, b0 5, b1 6 } ascii;
_open_object_  = { b1 0, b1 1, b0 2, b1 3, b1 4, b1 5, b1 6 } ascii;
_close_object_ = { b1 0, b0 1, b1 2, b1 3, b1 4, b1 5, b1 6 } ascii;

_A_            = { b1 0, b0 1, b0 2, b0 3, b0 4, b0 5, b1 6 } ascii;
_B_            = { b0 0, b1 1, b0 2, b0 3, b0 4, b0 5, b1 6 } ascii;
_C_            = { b1 0, b1 1, b0 2, b0 3, b0 4, b0 5, b1 6 } ascii;
_D_            = { b0 0, b0 1, b1 2, b0 3, b0 4, b0 5, b1 6 } ascii;
_F_            = { b0 0, b1 1, b1 2, b0 3, b0 4, b0 5, b1 6 } ascii;
_c_            = { b1 0, b1 1, b0 2, b0 3, b0 4, b1 5, b1 6 } ascii;
_d_            = { b0 0, b0 1, b1 2, b0 3, b0 4, b1 5, b1 6 } ascii;

json_string = ?string[] quote_char { () rest, nil acc } string_loop;
string_kind = ?unicode[] <
  { { () x, _quote_ y } eq_char? if, {} |quote then } .then,
  { { () x, _backslash_ y } eq_char? if, {} |escape then } .then,
  { /ascii { .6 /0 a, .5 /0 b } if, {} |control then } .then,
  {} |plain
>;
string_loop = ?{ string[] rest, string[] acc } {
  .rest /cons head, .acc acc, .rest /cons .car string_kind kind
} <
  {
    .kind /quote if,
    { .head.cdr rest, .acc reverse value } then
  } .then,
  <
    {
      .head.cdr rest,
      { { .kind /plain a, .head.car b } .b car, .acc cdr } |cons acc
    },
    { { .kind /escape a, .head.cdr escape b } .b escaped, .acc acc }
    { .escaped.rest rest, { .escaped.value car, .acc cdr } |cons acc }
  > string_loop
> ?text_result[];

json_array = open_array ws <
  close_array { () rest, empty_list value },
  { () rest, nil tree, 0 index } array_item
>;
array_item = ?{ string[] rest, btrie[djson[]] tree, bits[] index } {
  .rest json_value item, .tree tree, .index index
} {
  .item.rest ws rest,
  { .index index, .item.value val, .tree list } put_nth tree,
  .index inc index
} <
  { .rest close_array rest, .tree |list value },
  { .rest comma_char rest, .tree tree, .index index } array_item
> ?result[];

json_object = open_object ws <
  close_object { () rest, empty_object value },
  { () rest, nil tree } object_item
>;
object_item = ?{ string[] rest, btrie[djson[]] tree } {
  .rest ws json_string key, .tree tree
} {
  .key.rest ws colon_char json_value item,
  .key.value key, .tree tree
} {
  .item.rest ws rest,
  { .key key, .item.value val, .tree object } put tree
} <
  { .rest close_object rest, .tree |object value },
  { .rest comma_char rest, .tree tree } object_item
> ?result[];

-- ASCII consumers return the unconsumed input (a_char, e_char, f_char, n_char, t_char are imported from ieee.k).
quote_char     = /cons { { .car x, _quote_ y } eq_char? if, .cdr then } .then;
backslash_char = /cons { { .car x, _backslash_ y } eq_char? if, .cdr then } .then;
slash_char     = /cons { { .car x, _slash_ y } eq_char? if, .cdr then } .then;
b_char         = /cons { { .car x, _b_ y } eq_char? if, .cdr then } .then;
l_char         = /cons { { .car x, _l_ y } eq_char? if, .cdr then } .then;
r_char         = /cons { { .car x, _r_ y } eq_char? if, .cdr then } .then;
s_char         = /cons { { .car x, _s_ y } eq_char? if, .cdr then } .then;
u_char         = /cons { { .car x, _u_ y } eq_char? if, .cdr then } .then;
comma_char     = /cons { { .car x, _comma_ y } eq_char? if, .cdr then } .then;
colon_char     = /cons { { .car x, _colon_ y } eq_char? if, .cdr then } .then;
open_array     = /cons { { .car x, _open_array_ y } eq_char? if, .cdr then } .then;
close_array    = /cons { { .car x, _close_array_ y } eq_char? if, .cdr then } .then;
open_object    = /cons { { .car x, _open_object_ y } eq_char? if, .cdr then } .then;
close_object   = /cons { { .car x, _close_object_ y } eq_char? if, .cdr then } .then;

hex_letter = ?unicode[] <
  { () x, _a_ y } eq_char? 0b |0 |1 |0 |1,
  { () x, _A_ y } eq_char? 0b |0 |1 |0 |1,
  { () x, _b_ y } eq_char? 0b |1 |1 |0 |1,
  { () x, _B_ y } eq_char? 0b |1 |1 |0 |1,
  { () x, _c_ y } eq_char? 0b |0 |0 |1 |1,
  { () x, _C_ y } eq_char? 0b |0 |0 |1 |1,
  { () x, _d_ y } eq_char? 0b |1 |0 |1 |1,
  { () x, _D_ y } eq_char? 0b |1 |0 |1 |1,
  { () x, _e_ y } eq_char? 0b |0 |1 |1 |1,
  { () x, _E_ y } eq_char? 0b |0 |1 |1 |1,
  { () x, _f_ y } eq_char? 0b |1 |1 |1 |1,
  { () x, _F_ y } eq_char? 0b |1 |1 |1 |1
> ?bits[];
-- Parse a single hexadecimal digit ('0'..'9', 'a'..'f', 'A'..'F') from a character string.
-- Input:  string[]
-- Output: { rest: string[], value: bits[] } where value is in 0..15
hex = < digit, /cons { .cdr rest, .car hex_letter value } >;

-- Unicode escape decoding.

c2 = 0b |0 |1 ?bits[];
c4 = 0b |0 |0 |1 ?bits[];
c8 = 0b |0 |0 |0 |1 ?bits[];
c16 = 0b |0 |0 |0 |0 |1 ?bits[];
c128 = 0b |0 |0 |0 |0 |0 |0 |0 |1 ?bits[];
c208 = 0b |0 |0 |0 |0 |1 |0 |1 |1 ?bits[];
c216 = 0b |0 |0 |0 |1 |1 |0 |1 |1 ?bits[];
c224 = 0b |0 |0 |0 |0 |0 |1 |1 |1 ?bits[];
c240 = 0b |0 |0 |0 |0 |1 |1 |1 |1 ?bits[];
c248 = 0b |0 |0 |0 |1 |1 |1 |1 |1 ?bits[];
c249 = 0b |1 |0 |0 |1 |1 |1 |1 |1 ?bits[];
c250 = 0b |0 |1 |0 |1 |1 |1 |1 |1 ?bits[];
c252 = 0b |0 |0 |1 |1 |1 |1 |1 |1 ?bits[];
c254 = 0b |0 |1 |1 |1 |1 |1 |1 |1 ?bits[];
c1024 = c1023 inc;
c55296 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 |1 |0 |1 |1 ?bits[];
c56320 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 |1 |1 |0 |1 |1 ?bits[];
c57344 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 |1 |1 ?bits[];
c65536 = 0b |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1 ?bits[];

-- Reconstruct the same Unicode partitions used by core.k and k-utf8.
to_unicode = ?bits[] unpack16 <
  { .plane /_ if, () bmp then } .then,
  {
    .plane /1 /_ if,
    { .hi mid, .lo lo } |supplementary_plane1 then
  } .then,
  { .plane plane plane, .hi mid, .lo lo } |supplementary_planes2_16
> ?unicode[];
bmp = {
  () parts, .hi { () x, 0b acc } push_bits8 trim high
} <
  { .high /_ a, .parts.lo.7 /0 b, .parts.lo field7 ascii then } .then,
  {
    { .high x, c8 y } lt? if,
    {
      .parts.lo.0 0, .parts.lo.1 1, .parts.lo.2 2, .parts.lo.3 3,
      .parts.lo.4 4, .parts.lo.5 5, .parts.lo.6 6, .parts.lo.7 7,
      .parts.hi.0 8, .parts.hi.1 9, .parts.hi.2 10
    } |plane0 then
  } .then,
  { .high bmp_hi high, .parts.lo lo } <
    { .high /common hi, .lo lo } |bmp_common,
    { .high /private hi, .lo lo } |bmp_private_use
  >
>;
bmp_hi = ?bits[] <
  {
    { () x, c16 y } lt? if,
    { () x, c8 y } minus small3 |h08_0F |common then
  } .then,
  {
    { () x, c128 y } lt? if,
    { () x, c16 y } minus small7 |h10_7F |common then
  } .then,
  {
    { () x, c208 y } lt? if,
    { () x, c128 y } minus small7 |h80_CF |common then
  } .then,
  {
    { () x, c216 y } lt? if,
    { () x, c208 y } minus small3 |hD0_D7 |common then
  } .then,
  {
    { () x, c240 y } lt? if,
    { () x, c224 y } minus small4 |hE0_EF |private then
  } .then,
  {
    { () x, c248 y } lt? if,
    { () x, c240 y } minus small3 |hF0_F7 |private then
  } .then,
  { () x, c248 y } minus /_ {} |hF8 |private,
  { () x, c249 y } minus /_ {} |hF9 |common,
  {
    { () x, c252 y } lt? if,
    { () x, c250 y } minus small1 |hFA_FB |common then
  } .then,
  {
    { () x, c254 y } lt? if,
    { () x, c252 y } minus small1 |hFC_FD |common then
  } .then,
  { () x, c254 y } minus small1 |hFE_FF |common
>;
plane = ?bits[] <
  {
    { () x, c4 y } lt? if,
    { () x, c2 y } minus small1 |p02_03 then
  } .then,
  {
    { () x, c8 y } lt? if,
    { () x, c4 y } minus small2 |p04_07 then
  } .then,
  {
    { () x, c16 y } lt? if,
    { () x, c8 y } minus small3 |p08_0F then
  } .then,
  /1 /0 /0 /0 /0 /_ {} |p10
>;

times16 = ?bits[] <
  /_ 0b,
  { inv |0 |0 |0 |0 x, 0b r } inv_loop
> ?bits[];

times1024 = ?bits[] <
  /_ 0b,
  { inv |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 x, 0b r } inv_loop
> ?bits[];

-- Parse 4 hexadecimal digits from string[], accumulating a 16-bit code point.
-- Input:  string[]
-- Output: { rest: string[], value: bits[] }
hex4 = hex
  { .rest hex next, .value times16 high }
  { .next.rest rest, { .high x, .next.value y } plus value }
  { .rest hex next, .value times16 high }
  { .next.rest rest, { .high x, .next.value y } plus value }
  { .rest hex next, .value times16 high }
  { .next.rest rest, { .high x, .next.value y } plus value };

-- Parse a JSON string escape sequence (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX) after the backslash.
-- Input:  string[]
-- Output: { rest: string[], value: unicode[] }
escape = <
  quote_char { () rest, _quote_ value },
  backslash_char { () rest, _backslash_ value },
  slash_char { () rest, _slash_ value },
  b_char { () rest, _bs_ value },
  f_char { () rest, _ff_ value },
  n_char { () rest, _lf_ value },
  r_char { () rest, _cr_ value },
  t_char { () rest, _tab_ value },
  u_char hex4 <
    surrogate_pair,
    { .rest rest, .value to_unicode value }
  >
>;
surrogate_pair = {
  { .value x, c55296 y } minus high,
  .rest backslash_char u_char hex4 low
} {
  { .high x, c1024 y } lt? a,
  { .low.value x, c57344 y } lt? b,
  .high times1024 x,
  { .low.value x, c56320 y } minus y,
  .low.rest rest
} {
  { { .x x, .y y } plus x, c65536 y } plus to_unicode value,
  .rest rest
};

-- JSON numbers use IEEE's exact scanner, with JSON's lexical/finite guards (RFC 8259).
-- Input:  ?string[]
-- Output: ?result[] = { rest: string[], value: djson[] } (where value is |number)
json_number = ?string[] {
  < minus_char {}, digit {} > if, () then
} .then scanFloat64 {
  .rest rest, .value finite_float64? |number value
} ?result[];
