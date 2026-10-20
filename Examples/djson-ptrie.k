-- Examples/djson-ptrie.k: Patricia/Radix Trie JSON schema & helpers
-- Works with codecs/djson-ptrie.mjs (trie-array style).

---------------------------------------------------------------
-- §1. Universal Patricia/Radix Trie JSON Filter (json?)
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
      >=CHAR car,
      Str cdr
    } cons
  >=Str string,

  < {} true, {} false > bool,
  {} null,

  <
    {} nil,
    {
      < {} _, BITS 0, BITS 1 >=BITS prefix,
      BITS size,
      < {} nil, JSON val > val,
      LIST 0,
      LIST 1
    } trie
  >=LIST list,

  <
    {} nil,
    {
      Str prefix,
      BITS size,
      < {} nil, JSON val > val,
      <
        {} nil,
        {
          { CHAR char, OBJ trie } car,
          DICT cdr
        } cons
      >=DICT dict
    } trie
  >=OBJ object
>=JSON;

-----------------------------------------------------------------
-- §2. Unicode Character Equality (eq_char?)
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

---------------------------------------------------------------
-- §3. Patricia/Radix Trie Lookup Relations (dot, nth, has_key?)
---------------------------------------------------------------

bits? = ?< {} _, bits? 0, bits? 1 > = bits?;
0b = {} | _;
0 = 0b | 0;
1 = 0b | 1;
str_list? = ?< {} nil, { C car, S cdr } cons > = S;
ptrie_list? = ?<
  {} nil,
  { B1 prefix, B2 size, < {} nil, V val > val, T 0, T 1 } trie
> = T;
ptrie_obj? = ?<
  {} nil,
  {
    S prefix,
    B size,
    < {} nil, V val > val,
    < {} nil, { { C char, T trie } car, D cdr } cons >=D dict
  } trie
> = T;
ptrie_dict? = ?<
  {} nil,
  { { C char, T trie } car, D cdr } cons
> = D;

nil = {} | nil;
null = {} | null json?;
true = {} | true | bool json?;
false = {} | false | bool json?;
number = | number json?;
string = | string json?;
bool = | bool json?;
list = | list json?;
object = | object json?;

-- O(1) subtree size queries (number of elements in list or object)
list_size = ptrie_list? < /nil 0, /trie .size >;
obj_size = ptrie_obj? < /nil 0, /trie .size >;

match_str_prefix = ?{ P prefix, K key } {
  .prefix str_list? prefix,
  .key str_list? key
} <
  { .prefix /nil if, .key then } .then,
  {
    { .prefix /cons .car x, .key /cons .car y } eq_char? if,
    { .prefix /cons .cdr prefix, .key /cons .cdr key }
      match_str_prefix then
  } .then
>;

find_in_dict = ?{ C char, D dict } {
  .char char,
  .dict ptrie_dict? dict
} <
  {
    { .char x, .dict /cons .car .char y } eq_char? if,
    .dict /cons .car .trie then
  } .then,
  { .char char, .dict /cons .cdr dict } find_in_dict
>;

-- Lookup string key in radix object trie: { key, object } -> val
dot = ?{ K key, T object } {
  { .object ptrie_obj? /trie .prefix prefix, .key str_list? key }
    match_str_prefix rem,
  .object ptrie_obj? /trie t
} <
  { .rem /nil if, .t .val /val then } .then,
  {
    .rem /cons .cdr key,
    { .rem /cons .car char, .t .dict dict } find_in_dict object
  } dot
>;

has_key? = ?{ K key, O object } { dot if, () then } .then;

-- Lookup bits? index in Patricia bit-trie list: { index, list } -> val
match_bit_prefix = ?{ P prefix, K key } {
  .prefix bits? prefix,
  .key bits? key
} <
  { .prefix /_ if, .key then } .then,
  { .prefix /0 prefix, .key /0 key } match_bit_prefix,
  { .prefix /1 prefix, .key /1 key } match_bit_prefix
>;

nth = ?{ K index, T list } {
  { .list ptrie_list? /trie .prefix prefix, .index bits? key }
    match_bit_prefix rem,
  .list ptrie_list? /trie t
} <
  { .rem /_ if, .t .val /val then } .then,
  { .rem /0 index, .t .0 list } nth,
  { .rem /1 index, .t .1 list } nth
>;

-- Binary natural number helpers for size maintenance
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

-- Remove key from radix object trie: { key, object } -> object
_remove_step = ?<
  {
    < {} nil, { C car, S cdr } cons >=S key,
    <
      {} nil,
      {
        S prefix,
        < {} _, B 0, B 1 >=B size,
        < {} nil, V val > val,
        < {} nil, { { C char, T trie } car, D cdr } cons >=D dict
      } trie
    >=T object
  } node,
  { C char, S key, D dict } dict
> <
  /node {
    { .object /trie .prefix prefix, .key key } match_str_prefix rem,
    .object /trie t
  } <
    {
      .rem /nil if,
      {
        .t .prefix prefix,
        .t .size dec_nat size,
        nil val,
        .t .dict dict
      } |trie then
    } .then,
    {
      .t .prefix prefix,
      .t .size dec_nat size,
      .t .val val,
      {
        .rem /cons .car char,
        .rem /cons .cdr key,
        .t .dict dict
      } |dict _remove_step /dict dict
    } |trie
  > |node,
  /dict <
    {
      { .char x, .dict /cons .car .char y } eq_char? if,
      {
        {
          .char char,
          {
            .key key,
            .dict /cons .car .trie object
          } |node _remove_step /node trie
        } car,
        .dict /cons .cdr cdr
      } |cons then
    } .then,
    {
      .dict /cons .car car,
      {
        .char char,
        .key key,
        .dict /cons .cdr dict
      } |dict _remove_step /dict cdr
    } |cons
  > |dict
>;

remove = ?{ K key, O object } {
  .key str_list? key,
  .object ptrie_obj? object
} <
  {
    { .key key, .object object } has_key? if,
    { .key key, .object object } |node _remove_step /node then
  } .then,
  .object
> ptrie_obj?;

-- Split two strings into { common, rem_prefix, rem_key }
split_str_prefix = ?{
  < {} nil, { C car, S cdr } cons >=S prefix,
  S key
} <
  {
    .prefix /nil if,
    { nil common, nil rem_prefix, .key rem_key } then
  } .then,
  {
    .key /nil if,
    { nil common, .prefix rem_prefix, nil rem_key } then
  } .then,
  {
    { .prefix /cons .car x, .key /cons .car y } eq_char? if,
    {
      .prefix /cons .car c,
      {
        .prefix /cons .cdr prefix,
        .key /cons .cdr key
      } split_str_prefix sub
    } {
      { .c car, .sub .common cdr } |cons common,
      .sub .rem_prefix rem_prefix,
      .sub .rem_key rem_key
    } then
  } .then,
  { nil common, .prefix rem_prefix, .key rem_key }
> ?{ S1 common, S2 rem_prefix, S3 rem_key } {
  .common str_list? common,
  .rem_prefix str_list? rem_prefix,
  .rem_key str_list? rem_key
};

-- Replace value of an existing key in radix object trie
_put_replace = ?<
  {
    < {} nil, { C car, S cdr } cons >=S key,
    V val,
    <
      {} nil,
      {
        S prefix,
        < {} _, B 0, B 1 >=B size,
        < {} nil, V val > val,
        < {} nil, { { C char, T trie } car, D cdr } cons >=D dict
      } trie
    >=T object
  } node,
  { C char, S key, V val, D dict } dict
> <
  /node {
    { .object /trie .prefix prefix, .key key } match_str_prefix rem,
    .val val,
    .object /trie t
  } <
    {
      .rem /nil if,
      {
        .t .prefix prefix,
        .t .size size,
        .val |val val,
        .t .dict dict
      } |trie then
    } .then,
    {
      .t .prefix prefix,
      .t .size size,
      .t .val val,
      {
        .rem /cons .car char,
        .rem /cons .cdr key,
        .val val,
        .t .dict dict
      } |dict _put_replace /dict dict
    } |trie
  > |node,
  /dict <
    {
      { .char x, .dict /cons .car .char y } eq_char? if,
      {
        {
          .char char,
          {
            .key key,
            .val val,
            .dict /cons .car .trie object
          } |node _put_replace /node trie
        } car,
        .dict /cons .cdr cdr
      } |cons then
    } .then,
    {
      .dict /cons .car car,
      {
        .char char,
        .key key,
        .val val,
        .dict /cons .cdr dict
      } |dict _put_replace /dict cdr
    } |cons
  > |dict
>;

-- Insert a new key into radix object trie (splitting prefixes as needed)
_put_insert = ?<
  {
    < {} nil, { C car, S cdr } cons >=S key,
    V val,
    <
      {} nil,
      {
        S prefix,
        < {} _, B 0, B 1 >=B size,
        < {} nil, V val > val,
        < {} nil, { { C char, T trie } car, D cdr } cons >=D dict
      } trie
    >=T object
  } node,
  { C char, S key, V val, D dict } dict
> <
  /node <
    {
      .object /nil if,
      { .key prefix, 1 size, .val |val val, nil dict } |trie then
    } .then,
    {
      { .object /trie .prefix prefix, .key key } split_str_prefix sp,
      .val val,
      .object /trie t
    } <
      {
        { .sp .rem_prefix /nil p, .sp .rem_key /nil k } if,
        {
          .t .prefix prefix,
          .t .size inc_nat size,
          .val |val val,
          .t .dict dict
        } |trie then
      } .then,
      {
        { .sp .rem_prefix /nil p, .sp .rem_key /cons k } if,
        {
          .t .prefix prefix,
          .t .size inc_nat size,
          .t .val val,
          {
            .sp .rem_key /cons .car char,
            .sp .rem_key /cons .cdr key,
            .val val,
            .t .dict dict
          } |dict _put_insert /dict dict
        } |trie then
      } .then,
      {
        { .sp .rem_prefix /cons p, .sp .rem_key /nil k } if,
        {
          .sp .common prefix,
          .t .size inc_nat size,
          .val |val val,
          {
            {
              .sp .rem_prefix /cons .car char,
              {
                .sp .rem_prefix /cons .cdr prefix,
                .t .size size,
                .t .val val,
                .t .dict dict
              } |trie trie
            } car,
            nil cdr
          } |cons dict
        } |trie then
      } .then,
      {
        .sp .common prefix,
        .t .size inc_nat size,
        nil val,
        {
          {
            .sp .rem_prefix /cons .car char,
            {
              .sp .rem_prefix /cons .cdr prefix,
              .t .size size,
              .t .val val,
              .t .dict dict
            } |trie trie
          } car,
          {
            {
              .sp .rem_key /cons .car char,
              {
                .sp .rem_key /cons .cdr prefix,
                1 size,
                .val |val val,
                nil dict
              } |trie trie
            } car,
            nil cdr
          } |cons cdr
        } |cons dict
      } |trie
    >
  > |node,
  /dict <
    {
      .dict /nil if,
      {
        {
          .char char,
          { .key prefix, 1 size, .val |val val, nil dict } |trie trie
        } car,
        nil cdr
      } |cons then
    } .then,
    {
      { .char x, .dict /cons .car .char y } eq_char? if,
      {
        {
          .char char,
          {
            .key key,
            .val val,
            .dict /cons .car .trie object
          } |node _put_insert /node trie
        } car,
        .dict /cons .cdr cdr
      } |cons then
    } .then,
    {
      .dict /cons .car car,
      {
        .char char,
        .key key,
        .val val,
        .dict /cons .cdr dict
      } |dict _put_insert /dict cdr
    } |cons
  > |dict
>;

-- Insert or replace { key, val, object } -> object
put = ?{ K key, V val, O object } {
  .key str_list? key,
  .val json? val,
  .object ptrie_obj? object
} <
  {
    { .key key, .object object } has_key? if,
    { .key key, .val val, .object object } |node _put_replace /node then
  } .then,
  { .key key, .val val, .object object } |node _put_insert /node
> ptrie_obj?;


