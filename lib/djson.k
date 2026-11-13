# --lib core.k --use bit[] bits[] list[] byte[] ascii[] bmp_hi_common[] bmp_hi_private_use[] plane0[] plane_02_10[] unicode[] string[]
# --lib lib/generic.k --use bool[] false? true? order[] lt? eq? gt? opt[] reverse trim_bits inc_bits btrie[] btrie_empty btrie_get btrie_set btrie_del btrie_entries_raw btrie_max_key btrie_bfs_values string_to_bits bits_to_string
# --lib lib/ieee.k --use sign[] float64[] pos_zero neg_zero finite_float64? ratio_to_float64

-- =============================================================================
-- lib/djson.k — Dynamic JSON Schema, Queries/Mutations, and RFC 8259 Parser
-- =============================================================================
--
-- Represents arbitrary JSON documents as the recursive pattern `djson[]`.
-- Objects store keys at prefix-free Unicode bit-paths (`string_to_bits`);
-- arrays store elements at canonical MSB-first binary index paths (`0 = |_ |0`,
-- `1 = |_ |1`, `2 = |_ |0 |1`, ...).
--
-- Conventions:
--   * Predicates ending in '?' are pure identity filters (?X -> ?X).
--   * All recursive relations are tail-recursive.
--
-- Sections:
--   1. Schema, Constructors & Runtime Type Filters
--   2. Object & Array Accessors, Mutators, Keys & Values
--   3. JSON String Characters, Escapes & \uXXXX / Surrogate Decoding
--   4. Exact Decimal Arithmetic (LSB bits[]) for JSON Numbers
--   5. RFC 8259 JSON Text Decoder (`parse_json`)


-- -----------------------------------------------------------------------------
-- 1. Schema, Constructors & Runtime Type Filters
-- -----------------------------------------------------------------------------

djson[] = <
  float64[] number,
  string[]  string,
  bool[]    bool,
  {}        null,
  btrie[J]  list,
  btrie[J]  object
> = J;

-- Variant identity filters (fail on mismatch, preserve input unchanged on match).
null?   = ?djson[] { /null _n, () then } .then ?djson[];
bool?   = ?djson[] { /bool < false?, true? > _b, () then } .then ?djson[];
number? = ?djson[] { /number _n, () then } .then ?djson[];
string? = ?djson[] { /string _s, () then } .then ?djson[];
list?   = ?djson[] { /list < /nil |nil, /trie |trie > _l, () then } .then ?djson[];
object? = ?djson[] { /object < /nil |nil, /trie |trie > _o, () then } .then ?djson[];

json? = ?djson[] < null?, bool?, number?, string?, list?, object? > ?djson[];

empty_list   = btrie_empty |list;
empty_object = btrie_empty |object;


-- -----------------------------------------------------------------------------
-- 2. Object & Array Accessors, Mutators, Keys & Values
-- -----------------------------------------------------------------------------

-- Object operations: { string[] key, ..., djson[] json }
get = ?{ string[] key, djson[] json }
  { .key string_to_bits key, .json /object trie } btrie_get
  ?djson[];

has_key? = ?{ string[] key, djson[] json }
  { get _hit, () then } .then
  ?{ string[] key, djson[] json };

set = ?{ string[] key, djson[] val, djson[] json }
  { .key string_to_bits key, .val val, .json /object trie } btrie_set |object
  ?djson[];

del = ?{ string[] key, djson[] json }
  { .key string_to_bits key, .json /object trie } btrie_del |object
  ?djson[];

-- Array operations: { bits[] index, ..., djson[] json }
nth = ?{ bits[] index, djson[] json }
  { .index trim_bits key, .json /list trie } btrie_get
  ?djson[];

has_nth? = ?{ bits[] index, djson[] json }
  { nth _hit, () then } .then
  ?{ bits[] index, djson[] json };

set_nth = ?{ bits[] index, djson[] val, djson[] json }
  { .index trim_bits key, .val val, .json /list trie } btrie_set |list
  ?djson[];

del_nth = ?{ bits[] index, djson[] json }
  { .index trim_bits key, .json /list trie } btrie_del |list
  ?djson[];

-- Appends to an array at `max_index + 1` (or `0` when empty), safe after holes.
dj_next_index = ?btrie[V] btrie_max_key <
  /nil {} |_ |0,
  /val inc_bits
> ?bits[];

push = ?{ djson[] val, djson[] json }
  { .json /list trie, .val val }
  { .trie dj_next_index key, .val val, .trie trie }
  btrie_set |list
  ?djson[];

-- List-mapping helpers shared by `keys_raw`, `keys`, `values_raw`, and `values`.
dj_entries_keys_step = ?{ list[{ bits[] key, djson[] val }] xs, list[string[]] acc } <
  { .xs /nil _, .acc acc } .acc reverse,
  { .xs /cons c, .acc acc } {
    .c .cdr xs,
    { .c .car .key bits_to_string car, .acc cdr } |cons acc
  } dj_entries_keys_step
> ?list[string[]];

dj_entries_keys = ?list[{ bits[] key, djson[] val }]
  { () xs, {} |nil acc } dj_entries_keys_step ?list[string[]];

dj_entries_vals_step = ?{ list[{ bits[] key, djson[] val }] xs, list[djson[]] acc } <
  { .xs /nil _, .acc acc } .acc reverse,
  { .xs /cons c, .acc acc } {
    .c .cdr xs,
    { .c .car .val car, .acc cdr } |cons acc
  } dj_entries_vals_step
> ?list[djson[]];

dj_entries_vals = ?list[{ bits[] key, djson[] val }]
  { () xs, {} |nil acc } dj_entries_vals_step ?list[djson[]];

dj_strings_to_djsons_step = ?{ list[string[]] xs, list[djson[]] acc } <
  { .xs /nil _, .acc acc } .acc reverse,
  { .xs /cons c, .acc acc } {
    .c .cdr xs,
    { .c .car |string car, .acc cdr } |cons acc
  } dj_strings_to_djsons_step
> ?list[djson[]];

dj_strings_to_djsons = ?list[string[]]
  { () xs, {} |nil acc } dj_strings_to_djsons_step ?list[djson[]];

dj_pack_step = ?{ list[djson[]] xs, bits[] idx, btrie[djson[]] acc } <
  { .xs /nil _x, .idx _i, .acc acc } .acc,
  { .xs /cons head, .idx idx, .acc acc } {
    .head .cdr xs,
    .idx inc_bits idx,
    { .idx key, .head .car val, .acc trie } btrie_set acc
  } dj_pack_step
> ?btrie[djson[]];

dj_pack_list = ?list[djson[]]
  { () xs, {} |_ |0 idx, btrie_empty acc } dj_pack_step
  ?btrie[djson[]];

keys_raw = ?djson[] /object btrie_entries_raw dj_entries_keys ?list[string[]];

keys = ?djson[] keys_raw dj_strings_to_djsons dj_pack_list |list ?djson[];

values_raw = ?djson[] <
  /list btrie_bfs_values,
  /object btrie_entries_raw dj_entries_vals
> ?list[djson[]];

values = ?djson[] values_raw dj_pack_list |list ?djson[];


-- -----------------------------------------------------------------------------
-- 3. JSON String Characters, Escapes & \uXXXX / Surrogate Decoding
-- -----------------------------------------------------------------------------

dj_nibble[] = { bit[] "0", bit[] "1", bit[] "2", bit[] "3" };
dj_hex4[]   = { dj_nibble[] h3, dj_nibble[] h2, dj_nibble[] h1, dj_nibble[] h0 };

-- Skips RFC 8259 whitespace (SP 0x20, TAB 0x09, LF 0x0A, CR 0x0D).
dj_ws_char = /ascii <
  { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } {}, -- ' '
  { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } {}, -- '\t'
  { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } {}, -- '\n'
  { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } {}  -- '\r'
>;

dj_not_ws? = ?string[] {
  <
    /nil {},
    /cons .car <
      /plane0 {},
      /bmp_common {},
      /bmp_private_use {},
      /supplementary_plane1 {},
      /supplementary_planes2_16 {},
      /ascii <
        { .6 /1 _6 } {},
        { .6 /0 _6, .4 /1 _4 } {},
        { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3 } {},
        { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /1 _2 } {},
        { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /1 _1 } {},
        { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } {},
        { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /0 _3 } {},
        { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } {},
        { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } {},
        { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /1 _1 } {},
        { .6 /0 _6, .5 /0 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } {}
      >
    >
  > _ok,
  () then
} .then ?string[];

dj_ws = ?string[] <
  dj_not_ws?,
  /cons { .car dj_ws_char _, .cdr cdr } .cdr dj_ws
> ?string[];

-- Exact ASCII literal consumers (LSB bit 0 .. MSB bit 6).
dj_take_quote  = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- '"'
dj_take_plus   = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _c, .cdr r } .r; -- '+'
dj_take_comma  = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _c, .cdr r } .r; -- ','
dj_take_minus  = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- '-'
dj_take_dot    = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- '.'
dj_take_slash  = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _c, .cdr r } .r; -- '/'
dj_take_zero   = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /1 _4, .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _c, .cdr r } .r; -- '0'
dj_take_colon  = /cons { .car /ascii { .6 /0 _6, .5 /1 _5, .4 /1 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- ':'
dj_take_E      = /cons { .car /ascii { .6 /1 _6, .5 /0 _5, .4 /0 _4, .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- 'E'
dj_take_lbr    = /cons { .car /ascii { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _c, .cdr r } .r; -- '['
dj_take_bsl    = /cons { .car /ascii { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _c, .cdr r } .r; -- '\'
dj_take_rbr    = /cons { .car /ascii { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- ']'
dj_take_a      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- 'a'
dj_take_b      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- 'b'
dj_take_e      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- 'e'
dj_take_f      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- 'f'
dj_take_l      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _c, .cdr r } .r; -- 'l'
dj_take_n      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- 'n'
dj_take_r      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /1 _4, .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _c, .cdr r } .r; -- 'r'
dj_take_s      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /1 _4, .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _c, .cdr r } .r; -- 's'
dj_take_t      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /1 _4, .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _c, .cdr r } .r; -- 't'
dj_take_u      = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /1 _4, .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- 'u'
dj_take_lbrace = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /1 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _c, .cdr r } .r; -- '{'
dj_take_rbrace = /cons { .car /ascii { .6 /1 _6, .5 /1 _5, .4 /1 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _c, .cdr r } .r; -- '}'

-- Escape character values emitted as core.k `unicode[]`.
dj_ch_quote = { {} |0 "0", {} |1 "1", {} |0 "2", {} |0 "3", {} |0 "4", {} |1 "5", {} |0 "6" } |ascii; -- '"'
dj_ch_bsl   = { {} |0 "0", {} |0 "1", {} |1 "2", {} |1 "3", {} |1 "4", {} |0 "5", {} |1 "6" } |ascii; -- '\'
dj_ch_slash = { {} |1 "0", {} |1 "1", {} |1 "2", {} |1 "3", {} |0 "4", {} |1 "5", {} |0 "6" } |ascii; -- '/'
dj_ch_bs    = { {} |0 "0", {} |0 "1", {} |0 "2", {} |1 "3", {} |0 "4", {} |0 "5", {} |0 "6" } |ascii; -- '\b'
dj_ch_tab   = { {} |1 "0", {} |0 "1", {} |0 "2", {} |1 "3", {} |0 "4", {} |0 "5", {} |0 "6" } |ascii; -- '\t'
dj_ch_lf    = { {} |0 "0", {} |1 "1", {} |0 "2", {} |1 "3", {} |0 "4", {} |0 "5", {} |0 "6" } |ascii; -- '\n'
dj_ch_ff    = { {} |0 "0", {} |0 "1", {} |1 "2", {} |1 "3", {} |0 "4", {} |0 "5", {} |0 "6" } |ascii; -- '\f'
dj_ch_cr    = { {} |1 "0", {} |0 "1", {} |1 "2", {} |1 "3", {} |0 "4", {} |0 "5", {} |0 "6" } |ascii; -- '\r'

-- Parses one decimal digit '0'..'9' into its 4-bit nibble.
dj_digit_nibble = ?ascii[] {
  .6 /0 _6, .5 /1 _5, .4 /1 _4, .3 3, .2 2, .1 1, .0 0
} {
  .3 3, .2 2, .1 1, .0 0
} <
  { .3 /0 _3, .2 2, .1 1, .0 0 } { .0 "0", .1 "1", .2 "2", {} |0 "3" },
  { .3 /1 _3, .2 /0 _2, .1 /0 _1, .0 0 } { .0 "0", {} |0 "1", {} |0 "2", {} |1 "3" }
> ?dj_nibble[];

dj_take_digit = /cons { .car /ascii dj_digit_nibble val, .cdr rest };

-- Rejects leading-zero continuation digits like "01" / "-01".
dj_not_digit? = ?string[] {
  <
    /nil {},
    /cons .car <
      /plane0 {},
      /bmp_common {},
      /bmp_private_use {},
      /supplementary_plane1 {},
      /supplementary_planes2_16 {},
      /ascii <
        { .6 /1 _6 } {},
        { .6 /0 _6, .5 /0 _5 } {},
        { .6 /0 _6, .5 /1 _5, .4 /0 _4 } {},
        { .6 /0 _6, .5 /1 _5, .4 /1 _4, .3 /1 _3, .2 /1 _2 } {},
        { .6 /0 _6, .5 /1 _5, .4 /1 _4, .3 /1 _3, .2 /0 _2, .1 /1 _1 } {}
      >
    >
  > _ok,
  () then
} .then ?string[];

-- Parses one hex digit '0'..'9', 'A'..'F', or 'a'..'f' into its 4-bit nibble.
dj_alpha_hex_low3 = <
  { .2 /0 _2, .1 /0 _1, .0 /1 _0 } { {} |0 "0", {} |1 "1", {} |0 "2", {} |1 "3" }, -- 0xA (10)
  { .2 /0 _2, .1 /1 _1, .0 /0 _0 } { {} |1 "0", {} |1 "1", {} |0 "2", {} |1 "3" }, -- 0xB (11)
  { .2 /0 _2, .1 /1 _1, .0 /1 _0 } { {} |0 "0", {} |0 "1", {} |1 "2", {} |1 "3" }, -- 0xC (12)
  { .2 /1 _2, .1 /0 _1, .0 /0 _0 } { {} |1 "0", {} |0 "1", {} |1 "2", {} |1 "3" }, -- 0xD (13)
  { .2 /1 _2, .1 /0 _1, .0 /1 _0 } { {} |0 "0", {} |1 "1", {} |1 "2", {} |1 "3" }, -- 0xE (14)
  { .2 /1 _2, .1 /1 _1, .0 /0 _0 } { {} |1 "0", {} |1 "1", {} |1 "2", {} |1 "3" }  -- 0xF (15)
>;

dj_hex_nibble = ?ascii[] <
  dj_digit_nibble,
  { .6 /1 _6, .5 _5, .4 /0 _4, .3 /0 _3, .2 2, .1 1, .0 0 } dj_alpha_hex_low3
> ?dj_nibble[];

dj_take_hex1 = ?string[] /cons { .car /ascii dj_hex_nibble val, .cdr rest } ?{ dj_nibble[] val, string[] rest };

dj_take_hex4 = ?string[]
  dj_take_hex1
  { .val h3, .rest dj_take_hex1 n2 }
  { .h3 h3, .n2 .val h2, .n2 .rest dj_take_hex1 n1 }
  { .h3 h3, .h2 h2, .n1 .val h1, .n1 .rest dj_take_hex1 n0 }
  { { .h3 h3, .h2 h2, .h1 h1, .n0 .val h0 } hex, .n0 .rest rest }
  ?{ dj_hex4[] hex, string[] rest };

dj_nibbles_to_byte = {
  .lo .0 "0", .lo .1 "1", .lo .2 "2", .lo .3 "3",
  .hi .0 "4", .hi .1 "5", .hi .2 "6", .hi .3 "7"
};

-- Maps supplementary plane offset `H[9..6]` (0..15 -> Plane 1..16) + { mid, lo } to unicode[].
dj_plane_to_unicode = ?{ dj_nibble[] off, byte[] mid, byte[] lo } <
  { .off { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { .mid mid, .lo lo } |supplementary_plane1,
  { .off { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0" } |p02_03 plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0" } |p02_03 plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0", {} |0 "1" } |p04_07 plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0", {} |0 "1" } |p04_07 plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0", {} |1 "1" } |p04_07 plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /0 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0", {} |1 "1" } |p04_07 plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /0 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0", {} |0 "1", {} |0 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0", {} |0 "1", {} |0 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0", {} |1 "1", {} |0 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0", {} |1 "1", {} |0 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0", {} |0 "1", {} |1 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0", {} |0 "1", {} |1 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { { {} |0 "0", {} |1 "1", {} |1 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _o, .mid mid, .lo lo }
    { { {} |1 "0", {} |1 "1", {} |1 "2" } |p08_0F plane, .mid mid, .lo lo } |supplementary_planes2_16,
  { .off { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _o, .mid mid, .lo lo }
    { {} |p10 plane, .mid mid, .lo lo } |supplementary_planes2_16
> ?unicode[];

-- Decodes surrogate pair (high 0xD800..0xDBFF + \u + low 0xDC00..0xDFFF).
dj_decode_surrogate = ?{ dj_hex4[] hex, string[] rest }
  {
    .hex .h3 .3 /1 _h33, .hex .h3 .2 /1 _h32, .hex .h3 .1 /0 _h31, .hex .h3 .0 /1 _h30,
    .hex .h2 .3 /1 _h23, .hex .h2 .2 /0 _h22, .hex .h2 .1 h21, .hex .h2 .0 h20,
    .hex .h1 h1,
    .hex .h0 h0,
    .rest dj_take_bsl dj_take_u dj_take_hex4 low
  } {
    .h21 h21, .h20 h20, .h1 h1, .h0 h0,
    .low .hex .h3 .3 /1 _l33, .low .hex .h3 .2 /1 _l32, .low .hex .h3 .1 /0 _l31, .low .hex .h3 .0 /1 _l30,
    .low .hex .h2 .3 /1 _l23, .low .hex .h2 .2 /1 _l22, .low .hex .h2 .1 l21, .low .hex .h2 .0 l20,
    .low .hex .h1 l1,
    .low .hex .h0 l0,
    .low .rest rest
  } {
    {
      { .h1 .2 "0", .h1 .3 "1", .h20 "2", .h21 "3" } off,
      {
        .l20 "0", .l21 "1",
        .h0 .0 "2", .h0 .1 "3", .h0 .2 "4", .h0 .3 "5",
        .h1 .0 "6", .h1 .1 "7"
      } mid,
      { .l1 hi, .l0 lo } dj_nibbles_to_byte lo
    } dj_plane_to_unicode value,
    .rest rest
  } ?{ unicode[] value, string[] rest };

-- Decodes non-surrogate BMP escape \uXXXX directly by bit wiring (rejects 0xD800..0xDFFF).
dj_bmp_to_unicode = ?dj_hex4[] {
  .h3 h3, .h2 h2, .h1 h1, .h0 h0,
  { .h1 hi, .h0 lo } dj_nibbles_to_byte lo_byte
} <
  -- 0x0000..0x07FF: ASCII or plane0
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 { .3 /0 _23, .2 /0 _22, .1 /0 _21, .0 /0 _20 } _h2, .h1 .3 /0 _13, .h1 .2 b6, .h1 .1 b5, .h1 .0 b4, .h0 h0, .lo_byte _lb }
    { .h0 .0 "0", .h0 .1 "1", .h0 .2 "2", .h0 .3 "3", .b4 "4", .b5 "5", .b6 "6" } |ascii,
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 { .3 /0 _23, .2 /0 _22, .1 /0 _21, .0 /0 _20 } _h2, .h1 .3 /1 _b7, .h1 .2 b6, .h1 .1 b5, .h1 .0 b4, .h0 h0, .lo_byte _lb }
    { .h0 .0 "0", .h0 .1 "1", .h0 .2 "2", .h0 .3 "3", .b4 "4", .b5 "5", .b6 "6", {} |1 "7", {} |0 "8", {} |0 "9", {} |0 "10" } |plane0,
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 { .3 /0 _23, .2 /0 _22, .1 /0 _21, .0 /1 _20 } _h2, .h1 _h1, .h0 _h0, .lo_byte lo_byte }
    { .lo_byte .0 "0", .lo_byte .1 "1", .lo_byte .2 "2", .lo_byte .3 "3", .lo_byte .4 "4", .lo_byte .5 "5", .lo_byte .6 "6", .lo_byte .7 "7", {} |1 "8", {} |0 "9", {} |0 "10" } |plane0,
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 .3 /0 _23, .h2 .2 /0 _22, .h2 .1 /1 _21, .h2 .0 b8, .h1 _h1, .h0 _h0, .lo_byte lo_byte }
    { .lo_byte .0 "0", .lo_byte .1 "1", .lo_byte .2 "2", .lo_byte .3 "3", .lo_byte .4 "4", .lo_byte .5 "5", .lo_byte .6 "6", .lo_byte .7 "7", .b8 "8", {} |1 "9", {} |0 "10" } |plane0,
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 .3 /0 _23, .h2 .2 /1 _22, .h2 .1 b9, .h2 .0 b8, .h1 _h1, .h0 _h0, .lo_byte lo_byte }
    { .lo_byte .0 "0", .lo_byte .1 "1", .lo_byte .2 "2", .lo_byte .3 "3", .lo_byte .4 "4", .lo_byte .5 "5", .lo_byte .6 "6", .lo_byte .7 "7", .b8 "8", .b9 "9", {} |1 "10" } |plane0,

  -- 0x0800..0x0FFF: h08_0F
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 .3 /1 _23, .h2 .2 b2, .h2 .1 b1, .h2 .0 b0, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .b0 "0", .b1 "1", .b2 "2" } |h08_0F hi, .lo lo } |bmp_common,

  -- 0x1000..0x7FFF: h10_7F (hi_byte - 0x10)
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |0 "4", {} |0 "5", {} |0 "6" } |h10_7F hi, .lo lo } |bmp_common,
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /0 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |1 "4", {} |0 "5", {} |0 "6" } |h10_7F hi, .lo lo } |bmp_common,
  { .h3 { .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |0 "4", {} |1 "5", {} |0 "6" } |h10_7F hi, .lo lo } |bmp_common,
  { .h3 { .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |1 "4", {} |1 "5", {} |0 "6" } |h10_7F hi, .lo lo } |bmp_common,
  { .h3 { .3 /0 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |0 "4", {} |0 "5", {} |1 "6" } |h10_7F hi, .lo lo } |bmp_common,
  { .h3 { .3 /0 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |1 "4", {} |0 "5", {} |1 "6" } |h10_7F hi, .lo lo } |bmp_common,
  { .h3 { .3 /0 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |0 "4", {} |1 "5", {} |1 "6" } |h10_7F hi, .lo lo } |bmp_common,

  -- 0x8000..0xCFFF: h80_CF (drop bit 15 of h3, keep bits 14..8)
  { .h3 .3 /1 _3, .h3 .2 /0 _6, .h3 .1 b5, .h3 .0 b4, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", .b4 "4", .b5 "5", {} |0 "6" } |h80_CF hi, .lo lo } |bmp_common,
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /0 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .h2 .0 "0", .h2 .1 "1", .h2 .2 "2", .h2 .3 "3", {} |0 "4", {} |0 "5", {} |1 "6" } |h80_CF hi, .lo lo } |bmp_common,

  -- 0xD000..0xD7FF: hD0_D7 (0xD800..0xDFFF intentionally excluded!)
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 } _h3, .h2 .3 /0 _23, .h2 .2 b2, .h2 .1 b1, .h2 .0 b0, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .b0 "0", .b1 "1", .b2 "2" } |hD0_D7 hi, .lo lo } |bmp_common,

  -- 0xE000..0xEFFF: hE0_EF
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /0 _0 } _h3, .h2 h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { .h2 |hE0_EF hi, .lo lo } |bmp_private_use,

  -- 0xF000..0xFFFF: hF0_F7 / hF8 / hF9 / hFA_FB / hFC_FD / hFE_FF
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 .3 /0 _23, .h2 .2 b2, .h2 .1 b1, .h2 .0 b0, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .b0 "0", .b1 "1", .b2 "2" } |hF0_F7 hi, .lo lo } |bmp_private_use,
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 { .3 /1 _23, .2 /0 _22, .1 /0 _21, .0 /0 _20 } _h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { {} |hF8 hi, .lo lo } |bmp_private_use,
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 { .3 /1 _23, .2 /0 _22, .1 /0 _21, .0 /1 _20 } _h2, .h1 _h1, .h0 _h0, .lo_byte lo }
    { {} |hF9 hi, .lo lo } |bmp_common,
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 .3 /1 _23, .h2 .2 /0 _22, .h2 .1 /1 _21, .h2 .0 b0, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .b0 "0" } |hFA_FB hi, .lo lo } |bmp_common,
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 .3 /1 _23, .h2 .2 /1 _22, .h2 .1 /0 _21, .h2 .0 b0, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .b0 "0" } |hFC_FD hi, .lo lo } |bmp_common,
  { .h3 { .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 /1 _0 } _h3, .h2 .3 /1 _23, .h2 .2 /1 _22, .h2 .1 /1 _21, .h2 .0 b0, .h1 _h1, .h0 _h0, .lo_byte lo }
    { { .b0 "0" } |hFE_FF hi, .lo lo } |bmp_common
> ?unicode[];


-- -----------------------------------------------------------------------------
-- 4. Exact Decimal Arithmetic (LSB bits[]) for JSON Numbers
-- -----------------------------------------------------------------------------
-- Internally uses trimmed LSB-first `bits[]` (`0 = {} |_`, `1 = |_ |1`,
-- `2 = |_ |1 |0`), converting cleanly to canonical MSB-first `bits[]` before
-- calling `ratio_to_float64`.

dj_msb_drop_zeros = ?bits[] <
  /_ {} |_,
  /1 |1,
  /0 dj_msb_drop_zeros
> ?bits[];

dj_rev_bits_step = ?{ bits[] src, bits[] acc } <
  { .src /_ _s, .acc acc } .acc,
  <
    { .src /0 src, .acc |0 acc },
    { .src /1 src, .acc |1 acc }
  > dj_rev_bits_step
> ?bits[];

dj_rev_bits = ?bits[] { () src, {} |_ acc } dj_rev_bits_step ?bits[];

dj_trim_lsb = ?bits[] dj_rev_bits dj_msb_drop_zeros dj_rev_bits ?bits[];

dj_lsb_to_msb = ?bits[] dj_rev_bits dj_msb_drop_zeros <
  /_ {} |_ |0,
  /1 |1
> ?bits[];

dj_lsb_shl1 = ?bits[] < /_ {} |_, /0 |0 |0, /1 |1 |0 > ?bits[];
dj_lsb_shl3 = dj_lsb_shl1 dj_lsb_shl1 dj_lsb_shl1;

dj_prepend_zeros = ?{ bits[] zs, bits[] rest } <
  { .zs /_ _z, .rest rest } .rest,
  { .zs /0 zs, .rest |0 rest } dj_prepend_zeros
> ?bits[];

dj_prepend_ones = ?{ bits[] os, bits[] rest } <
  { .os /_ _o, .rest rest } .rest,
  { .os /1 os, .rest |1 rest } dj_prepend_ones
> ?bits[];

dj_lsb_inc_step = ?{ bits[] src, bits[] zs } <
  { .src /_ _s, .zs zs } { .zs zs, {} |_ |1 rest } dj_prepend_zeros,
  { .src /0 tail, .zs zs } { .zs zs, .tail |1 rest } dj_prepend_zeros,
  { .src /1 src, .zs |0 zs } dj_lsb_inc_step
> ?bits[];

dj_lsb_inc = ?bits[] { () src, {} |_ zs } dj_lsb_inc_step ?bits[];

dj_lsb_dec_step = ?{ bits[] src, bits[] os } <
  { .src /1 dj_lsb_shl1 rest, .os os } { .os os, .rest rest } dj_prepend_ones,
  { .src /0 src, .os |1 os } dj_lsb_dec_step
> ?bits[];

dj_lsb_dec = ?bits[] { () src, {} |_ os } dj_lsb_dec_step ?bits[];

dj_pop_lsb = ?bits[] <
  /_ { {} |0 bit, {} |_ tail },
  /0 { {} |0 bit, () tail },
  /1 { {} |1 bit, () tail }
> ?{ bit[] bit, bits[] tail };

dj_pop_lsb_strict = ?bits[] <
  /0 { {} |0 bit, () tail },
  /1 { {} |1 bit, () tail }
> ?{ bit[] bit, bits[] tail };

dj_push_bit_acc = ?{ bit[] bit, bits[] acc } <
  { .bit /0 _, .acc |0 acc },
  { .bit /1 _, .acc |1 acc }
> .acc ?bits[];

dj_full_add_bit = ?{ bit[] a, bit[] b, bit[] c } <
  { .a /0 _a, .b /0 _b, .c /0 _c } { {} |0 s, {} |0 c },
  <
    { .a /1 _a, .b /0 _b, .c /0 _c },
    { .a /0 _a, .b /1 _b, .c /0 _c },
    { .a /0 _a, .b /0 _b, .c /1 _c }
  > { {} |1 s, {} |0 c },
  <
    { .a /1 _a, .b /1 _b, .c /0 _c },
    { .a /1 _a, .b /0 _b, .c /1 _c },
    { .a /0 _a, .b /1 _b, .c /1 _c }
  > { {} |0 s, {} |1 c },
  { .a /1 _a, .b /1 _b, .c /1 _c } { {} |1 s, {} |1 c }
> ?{ bit[] s, bit[] c };

dj_full_sub_bit = ?{ bit[] a, bit[] b, bit[] c } <
  { .a /0 _a, .b /0 _b, .c /0 _c } { {} |0 s, {} |0 c },
  { .a /1 _a, .b /0 _b, .c /0 _c } { {} |1 s, {} |0 c },
  <
    { .a /1 _a, .b /1 _b, .c /0 _c },
    { .a /1 _a, .b /0 _b, .c /1 _c }
  > { {} |0 s, {} |0 c },
  <
    { .a /0 _a, .b /1 _b, .c /0 _c },
    { .a /0 _a, .b /0 _b, .c /1 _c },
    { .a /1 _a, .b /1 _b, .c /1 _c }
  > { {} |1 s, {} |1 c },
  { .a /0 _a, .b /1 _b, .c /1 _c } { {} |0 s, {} |1 c }
> ?{ bit[] s, bit[] c };

dj_lsb_add_step = ?{ bits[] x, bits[] y, bit[] c, bits[] acc } <
  { .x /_ _x, .y acc, .c /0 _c, .acc src } { .src src, .acc acc } dj_rev_bits_step,
  { .x acc, .y /_ _y, .c /0 _c, .acc src } { .src src, .acc acc } dj_rev_bits_step,
  { .x /_ _x, .y dj_lsb_inc acc, .c /1 _c, .acc src } { .src src, .acc acc } dj_rev_bits_step,
  { .x dj_lsb_inc acc, .y /_ _y, .c /1 _c, .acc src } { .src src, .acc acc } dj_rev_bits_step,
  {
    .x dj_pop_lsb px,
    .y dj_pop_lsb py,
    .c c,
    .acc acc
  }
  {
    .px .tail x,
    .py .tail y,
    .acc acc,
    { .px .bit a, .py .bit b, .c c } dj_full_add_bit step
  }
  {
    .x x,
    .y y,
    .step .c c,
    { .step .s bit, .acc acc } dj_push_bit_acc acc
  } dj_lsb_add_step
> ?bits[];

dj_lsb_add = ?{ bits[] x, bits[] y } { .x x, .y y, {} |0 c, {} |_ acc } dj_lsb_add_step dj_trim_lsb ?bits[];

dj_lsb_sub_step = ?{ bits[] x, bits[] y, bit[] c, bits[] acc } <
  { .x acc, .y /_ _y, .c /0 _c, .acc src } { .src src, .acc acc } dj_rev_bits_step,
  { .x dj_lsb_dec acc, .y /_ _y, .c /1 _c, .acc src } { .src src, .acc acc } dj_rev_bits_step,
  {
    .x dj_pop_lsb_strict px,
    .y dj_pop_lsb_strict py,
    .c c,
    .acc acc
  }
  {
    .px .tail x,
    .py .tail y,
    .acc acc,
    { .px .bit a, .py .bit b, .c c } dj_full_sub_bit step
  }
  {
    .x x,
    .y y,
    .step .c c,
    { .step .s bit, .acc acc } dj_push_bit_acc acc
  } dj_lsb_sub_step
> ?bits[];

dj_lsb_sub = ?{ bits[] x, bits[] y } { .x x, .y y, {} |0 c, {} |_ acc } dj_lsb_sub_step dj_trim_lsb ?bits[];

dj_lsb_cmp_step = ?{ bits[] x, bits[] y, order[] ord } <
  { .x /_ _x, .y /_ _y, .ord ord } .ord,
  { .x /_ _x, .y /0 _y, .ord _o } {} |lt,
  { .x /_ _x, .y /1 _y, .ord _o } {} |lt,
  { .x /0 _x, .y /_ _y, .ord _o } {} |gt,
  { .x /1 _x, .y /_ _y, .ord _o } {} |gt,
  <
    { .x /0 x, .y /0 y, .ord ord },
    { .x /1 x, .y /1 y, .ord ord },
    { .x /0 x, .y /1 y, .ord _o } { .x x, .y y, {} |lt ord },
    { .x /1 x, .y /0 y, .ord _o } { .x x, .y y, {} |gt ord }
  > dj_lsb_cmp_step
> ?order[];

dj_lsb_cmp = ?{ bits[] x, bits[] y } { .x x, .y y, {} |eq ord } dj_lsb_cmp_step ?order[];

dj_lsb_len_step = ?{ bits[] x, bits[] acc } <
  { .x /_ _x, .acc acc } .acc,
  <
    { .x /0 x, .acc acc } { .x x, .acc dj_lsb_inc acc },
    { .x /1 x, .acc acc } { .x x, .acc dj_lsb_inc acc }
  > dj_lsb_len_step
> ?bits[];

dj_lsb_len = ?bits[] { () x, {} |_ acc } dj_lsb_len_step ?bits[];

dj_push_lsb_bit = ?{ bit[] bit, bits[] acc } <
  { .bit /0 _b, .acc /_ _a } {} |_,
  { .bit /0 _b, .acc /0 x } .x |0 |0,
  { .bit /0 _b, .acc /1 x } .x |1 |0,
  { .bit /1 _b, .acc x } .x |1
> ?bits[];

dj_nibble_to_lsb = ?dj_nibble[] {
  .3 < /0 {} |_, /1 {} |_ |1 > b3,
  .2 b2, .1 b1, .0 b0
} {
  { .b2 bit, .b3 acc } dj_push_lsb_bit b23,
  .b1 b1, .b0 b0
} {
  { .b1 bit, .b23 acc } dj_push_lsb_bit b123,
  .b0 b0
} {
  .b0 bit, .b123 acc
} dj_push_lsb_bit ?bits[];

dj_lsb_mul10_plus_nib = ?{ bits[] x, dj_nibble[] d } {
  { .x dj_lsb_shl3 x, .x dj_lsb_shl1 y } dj_lsb_add x,
  .d dj_nibble_to_lsb y
} dj_lsb_add ?bits[];

dj_lsb_shl_n = ?{ bits[] x, bits[] n } <
  { .x /_ _x, .n _n } {} |_,
  { .x x, .n /_ _n } .x,
  { .x x, .n n } { .x dj_lsb_shl1 x, .n dj_lsb_dec n } dj_lsb_shl_n
> ?bits[];

dj_lsb_mul_step = ?{ bits[] x, bits[] y, bits[] acc } <
  { .x /_ _x, .y _y, .acc acc } .acc,
  { .x x, .y /_ _y, .acc acc } .acc,
  <
    { .x /0 x, .y y, .acc acc } { .x x, .y dj_lsb_shl1 y, .acc acc },
    { .x /1 x, .y y, .acc acc } {
      .x x,
      .y dj_lsb_shl1 y,
      { .acc x, .y y } dj_lsb_add acc
    }
  > dj_lsb_mul_step
> ?bits[];

dj_lsb_mul = ?{ bits[] x, bits[] y } { .x x, .y y, {} |_ acc } dj_lsb_mul_step ?bits[];

-- 5 in LSB bits[] is |1 |0 |1 |_
dj_lsb_5 = {} |_ |1 |0 |1;

dj_pow5_step = ?{ bits[] n, bits[] base, bits[] acc } <
  { .n /_ _n, .base _b, .acc acc } .acc,
  -- Avoid a redundant final squaring when n == 1.
  { .n /1 /_ _n, .base base, .acc acc } { .acc x, .base y } dj_lsb_mul,
  <
    { .n /0 n, .base base, .acc acc } {
      .n n,
      { .base x, .base y } dj_lsb_mul base,
      .acc acc
    },
    { .n /1 n, .base base, .acc acc } {
      .n n,
      { .base x, .base y } dj_lsb_mul base,
      { .acc x, .base y } dj_lsb_mul acc
    }
  > dj_pow5_step
> ?bits[];

dj_pow5_lsb = ?bits[] { () n, dj_lsb_5 base, {} |_ |1 acc } dj_pow5_step ?bits[];


-- -----------------------------------------------------------------------------
-- 5. RFC 8259 JSON Text Decoder (`parse_json`)
-- -----------------------------------------------------------------------------

-- Scans JSON string contents after the opening `"`, rejecting unescaped U+0000..U+001F.
dj_json_escape = <
  dj_take_quote { () rest, dj_ch_quote value },
  dj_take_bsl   { () rest, dj_ch_bsl   value },
  dj_take_slash { () rest, dj_ch_slash value },
  dj_take_b     { () rest, dj_ch_bs    value },
  dj_take_f     { () rest, dj_ch_ff    value },
  dj_take_n     { () rest, dj_ch_lf    value },
  dj_take_r     { () rest, dj_ch_cr    value },
  dj_take_t     { () rest, dj_ch_tab   value },
  dj_take_u dj_take_hex4 <
    dj_decode_surrogate,
    { .rest rest, .hex dj_bmp_to_unicode value }
  >
>;

-- Matches ASCII >= 0x20, explicitly excluding '"' (0x22) and '\' (0x5C).
dj_plain_ascii = ?ascii[] <
  -- 0x40..0x7F excluding 0x5C ('\' = 1011100)
  { .6 /1 _6, .5 /1 _5, .4 "4", .3 "3", .2 "2", .1 "1", .0 "0" }
    { {} |1 "6", {} |1 "5", .4 "4", .3 "3", .2 "2", .1 "1", .0 "0" },
  { .6 /1 _6, .5 /0 _5, .4 /0 _4, .3 "3", .2 "2", .1 "1", .0 "0" }
    { {} |1 "6", {} |0 "5", {} |0 "4", .3 "3", .2 "2", .1 "1", .0 "0" },
  { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /0 _3, .2 "2", .1 "1", .0 "0" }
    { {} |1 "6", {} |0 "5", {} |1 "4", {} |0 "3", .2 "2", .1 "1", .0 "0" },
  { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /1 _3, .2 /0 _2, .1 "1", .0 "0" }
    { {} |1 "6", {} |0 "5", {} |1 "4", {} |1 "3", {} |0 "2", .1 "1", .0 "0" },
  { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /1 _3, .2 /1 _2, .1 /1 _1, .0 "0" }
    { {} |1 "6", {} |0 "5", {} |1 "4", {} |1 "3", {} |1 "2", {} |1 "1", .0 "0" },
  { .6 /1 _6, .5 /0 _5, .4 /1 _4, .3 /1 _3, .2 /1 _2, .1 /0 _1, .0 /1 _0 }
    { {} |1 "6", {} |0 "5", {} |1 "4", {} |1 "3", {} |1 "2", {} |0 "1", {} |1 "0" },
  -- 0x20..0x3F excluding 0x22 ('"' = 0100010)
  { .6 /0 _6, .5 /1 _5, .4 /1 _4, .3 "3", .2 "2", .1 "1", .0 "0" }
    { {} |0 "6", {} |1 "5", {} |1 "4", .3 "3", .2 "2", .1 "1", .0 "0" },
  { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /1 _3, .2 "2", .1 "1", .0 "0" }
    { {} |0 "6", {} |1 "5", {} |0 "4", {} |1 "3", .2 "2", .1 "1", .0 "0" },
  { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /1 _2, .1 "1", .0 "0" }
    { {} |0 "6", {} |1 "5", {} |0 "4", {} |0 "3", {} |1 "2", .1 "1", .0 "0" },
  { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 "0" }
    { {} |0 "6", {} |1 "5", {} |0 "4", {} |0 "3", {} |0 "2", {} |0 "1", .0 "0" },
  { .6 /0 _6, .5 /1 _5, .4 /0 _4, .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 /1 _0 }
    { {} |0 "6", {} |1 "5", {} |0 "4", {} |0 "3", {} |0 "2", {} |1 "1", {} |1 "0" }
> ?ascii[];

dj_plain_char = ?unicode[] <
  /ascii dj_plain_ascii |ascii,
  /plane0 |plane0,
  /bmp_common |bmp_common,
  /bmp_private_use |bmp_private_use,
  /supplementary_plane1 |supplementary_plane1,
  /supplementary_planes2_16 |supplementary_planes2_16
> ?unicode[];

dj_string_loop = ?{ string[] rest, list[unicode[]] acc } <
  { .rest dj_take_quote rest, .acc acc } { .rest rest, .acc reverse value },
  <
    { .rest dj_take_bsl rest, .acc acc } {
      .rest dj_json_escape esc,
      .acc acc
    } {
      .esc .rest rest,
      { .esc .value car, .acc cdr } |cons acc
    },
    { .rest /cons head, .acc acc } {
      .head .cdr rest,
      { .head .car dj_plain_char car, .acc cdr } |cons acc
    }
  > dj_string_loop
> ?{ string[] rest, string[] value };

dj_json_string = ?string[] dj_take_quote { () rest, {} |nil acc } dj_string_loop ?{ string[] rest, string[] value };

-- Parses digits accumulating `acc * 10 + d` and counting digits into `cnt`.
dj_scan_digits = ?{ string[] rest, bits[] acc, bits[] cnt } <
  { .rest dj_not_digit? rest, .acc acc, .cnt cnt } { .rest rest, .acc acc, .cnt cnt },
  { .rest dj_take_digit d, .acc acc, .cnt cnt } {
    .d .rest rest,
    { .acc x, .d .val d } dj_lsb_mul10_plus_nib acc,
    .cnt dj_lsb_inc cnt
  } dj_scan_digits
> ?{ string[] rest, bits[] acc, bits[] cnt };

-- Parses integer part (RFC 8259: '0' OR '1'..'9' followed by digits).
dj_scan_int_part = ?string[] <
  dj_take_zero dj_not_digit? { () rest, {} |_ mant },
  dj_take_digit {
    .val <
      { .3 /0 _3, .2 /0 _2, .1 /0 _1, .0 /1 _0 } { {} |0 "3", {} |0 "2", {} |0 "1", {} |1 "0" },
      { .3 /0 _3, .2 /0 _2, .1 /1 _1, .0 0 }     { {} |0 "3", {} |0 "2", {} |1 "1", .0 "0" },
      { .3 /0 _3, .2 /1 _2, .1 1,     .0 0 }     { {} |0 "3", {} |1 "2", .1 "1",     .0 "0" },
      { .3 /1 _3, .2 2,     .1 1,     .0 0 }     { {} |1 "3", .2 "2",     .1 "1",     .0 "0" }
    > dj_nibble_to_lsb acc,
    .rest rest,
    {} |_ cnt
  } dj_scan_digits { .rest rest, .acc mant }
> ?{ string[] rest, bits[] mant };

-- Parses optional fraction `.DIGIT+`.
dj_scan_frac_part = ?{ string[] rest, bits[] mant } <
  { .rest dj_take_dot r, .mant mant } {
    .r dj_take_digit d,
    .mant mant
  } {
    .d .rest rest,
    { .mant x, .d .val d } dj_lsb_mul10_plus_nib acc,
    {} |_ |1 cnt
  } dj_scan_digits { .rest rest, .acc mant, .cnt frac },
  { .rest rest, .mant mant } { .rest rest, .mant mant, {} |_ frac }
> ?{ string[] rest, bits[] mant, bits[] frac };

-- Parses optional exponent `(e|E) [+|-] DIGIT+`.
dj_scan_exp_part = ?string[] <
  < dj_take_e, dj_take_E > <
    dj_take_minus { () r, {} |- esign },
    dj_take_plus  { () r, {} |+ esign },
    { () r, {} |+ esign }
  > {
    .esign esign,
    .r dj_take_digit d
  } {
    .esign esign,
    .d .rest rest,
    .d .val dj_nibble_to_lsb acc,
    {} |_ cnt
  } {
    .esign esign,
    { .rest rest, .acc acc, .cnt cnt } dj_scan_digits res
  } {
    .res .rest rest,
    .esign sign,
    .res .acc exp
  },
  { () rest, {} |+ sign, {} |_ exp }
> ?{ string[] rest, sign[] sign, bits[] exp };

-- Converts parsed decimal components to finite IEEE-754 float64[].
-- Uses early exponent bounds to avoid huge multiplications on overflow/underflow:
--   * positive exponent >= 309 (`e10 >= 309`) with non-zero mantissa overflows DBL_MAX.
--   * negative exponent `k` with `3*k > bitlen(mant) + 1076` underflows below 0.5*2^-1074.
dj_decimal_to_float64 = ?{ sign[] sign, bits[] mant, bits[] frac, sign[] esign, bits[] exp } <
  { .sign /+ _s, .mant /_ _m, .frac _f, .esign _es, .exp _e } pos_zero,
  { .sign /- _s, .mant /_ _m, .frac _f, .esign _es, .exp _e } neg_zero,
  { .sign sign, .mant mant, .frac frac, .esign esign, .exp exp } {
    .sign sign,
    .mant mant,
    { .frac frac, .esign esign, .exp exp } <
      { .frac f, .esign /- _es, .exp e } { {} |- sign, { .f x, .e y } dj_lsb_add mag },
      { .frac f, .esign /+ _es, .exp e } {
        .f f, .e e,
        { .e x, .f y } dj_lsb_cmp cmp
      } <
        { .cmp /eq _c, .e _e, .f _f } { {} |+ sign, {} |_ mag },
        { .cmp /gt _c, .e e, .f f } { {} |+ sign, { .e x, .f y } dj_lsb_sub mag },
        { .cmp /lt _c, .e e, .f f } { {} |- sign, { .f x, .e y } dj_lsb_sub mag }
      >
    > e10
  } <
    { .sign sign, .mant mant, .e10 .sign _es, .e10 .mag /_ _em } {
      .sign sign,
      .mant dj_lsb_to_msb num,
      {} |_ |1 den
    } ratio_to_float64 finite_float64?,
    { .sign sign, .mant mant, .e10 .sign /+ _es, .e10 .mag k } {
      .sign sign,
      .mant mant,
      .k k,
      { .k x, {} |_ |1 |0 |0 |1 |1 |0 |1 |0 |1 y } dj_lsb_cmp ovf
    } { .ovf /lt _lt, .sign sign, .mant mant, .k k } {
      .sign sign,
      { { .mant x, .k dj_pow5_lsb y } dj_lsb_mul x, .k n } dj_lsb_shl_n dj_lsb_to_msb num,
      {} |_ |1 den
    } ratio_to_float64 finite_float64?,
    { .sign sign, .mant mant, .e10 .sign /- _es, .e10 .mag k } {
      .sign sign,
      .mant mant,
      .k k,
      {
        { .k x, .k dj_lsb_shl1 y } dj_lsb_add x,
        { .mant dj_lsb_len x, {} |_ |1 |0 |0 |0 |0 |1 |1 |0 |1 |0 |0 y } dj_lsb_add y
      } dj_lsb_cmp udf
    } <
      { .udf /gt _gt, .sign /+ _s, .mant _m, .k _k } pos_zero,
      { .udf /gt _gt, .sign /- _s, .mant _m, .k _k } neg_zero,
      { .udf < lt?, eq? > _lt_eq, .sign sign, .mant mant, .k k } {
        .sign sign,
        .mant dj_lsb_to_msb num,
        { .k dj_pow5_lsb x, .k n } dj_lsb_shl_n dj_lsb_to_msb den
      } ratio_to_float64 finite_float64?
    >
  >
> ?float64[];

dj_json_number = ?string[] <
  dj_take_minus { () rest, {} |- sign },
  { () rest, {} |+ sign }
> {
  .sign sign,
  .rest dj_scan_int_part int
} {
  .sign sign,
  { .int .rest rest, .int .mant mant } dj_scan_frac_part frac
} {
  .sign sign,
  .frac .mant mant,
  .frac .frac frac,
  .frac .rest dj_scan_exp_part exp
} {
  .exp .rest rest,
  {
    .sign sign,
    .mant mant,
    .frac frac,
    .exp .sign esign,
    .exp .exp exp
  } dj_decimal_to_float64 |number value
} ?{ string[] rest, djson[] value };

-- Explicit-stack tail-recursive RFC 8259 JSON parser state machine.
dj_parse_frame[] = <
  { btrie[djson[]] tree, bits[] index } arr,
  { btrie[djson[]] tree, bits[] key_bits } obj
>;

dj_parse_state[] = <
  { string[] rest, list[dj_parse_frame[]] stack } expect_val,
  { string[] rest, djson[] val, list[dj_parse_frame[]] stack } got_val
>;

dj_parse_atom = ?string[] <
  dj_take_n dj_take_u dj_take_l dj_take_l { () rest, {} |null value },
  dj_take_t dj_take_r dj_take_u dj_take_e { () rest, {} |true |bool value },
  dj_take_f dj_take_a dj_take_l dj_take_s dj_take_e { () rest, {} |false |bool value },
  dj_json_string { .rest rest, .value |string value },
  dj_json_number
> ?{ string[] rest, djson[] value };

dj_parse_obj_key = ?string[]
  dj_ws dj_json_string { .rest dj_ws dj_take_colon rest, .value string_to_bits key_bits }
  ?{ string[] rest, bits[] key_bits };

dj_parse_expect_val = ?{ string[] rest, list[dj_parse_frame[]] stack } {
  .rest dj_ws rest,
  .stack stack
} <
  { .rest dj_parse_atom a, .stack stack } {
    .a .rest rest, .a .value val, .stack stack
  } |got_val,
  { .rest dj_take_lbr dj_ws rest, .stack stack } <
    { .rest dj_take_rbr rest, .stack stack } {
      .rest rest, empty_list val, .stack stack
    } |got_val,
    { .rest rest, .stack stack } {
      .rest rest,
      { { btrie_empty tree, {} |_ |0 index } |arr car, .stack cdr } |cons stack
    } |expect_val
  >,
  { .rest dj_take_lbrace dj_ws rest, .stack stack } <
    { .rest dj_take_rbrace rest, .stack stack } {
      .rest rest, empty_object val, .stack stack
    } |got_val,
    { .rest dj_parse_obj_key k, .stack stack } {
      .k .rest rest,
      { { btrie_empty tree, .k .key_bits key_bits } |obj car, .stack cdr } |cons stack
    } |expect_val
  >
> ?dj_parse_state[];

dj_parse_got_val = ?{ string[] rest, djson[] val, dj_parse_frame[] frame, list[dj_parse_frame[]] parent } {
  .rest dj_ws rest,
  .val val,
  .frame frame,
  .parent parent
} <
  { .rest rest, .val val, .frame /arr a, .parent parent } {
    .rest rest,
    { .a .index key, .val val, .a .tree trie } btrie_set next_tree,
    .a .index inc_bits next_index,
    .parent parent
  } <
    { .rest dj_take_rbr rest, .next_tree tree, .next_index _i, .parent stack } {
      .rest rest, .tree |list val, .stack stack
    } |got_val,
    { .rest dj_take_comma rest, .next_tree tree, .next_index index, .parent parent } {
      .rest rest,
      { { .tree tree, .index index } |arr car, .parent cdr } |cons stack
    } |expect_val
  >,
  { .rest rest, .val val, .frame /obj o, .parent parent } {
    .rest rest,
    { .o .key_bits key, .val val, .o .tree trie } btrie_set next_tree,
    .parent parent
  } <
    { .rest dj_take_rbrace rest, .next_tree tree, .parent stack } {
      .rest rest, .tree |object val, .stack stack
    } |got_val,
    { .rest dj_take_comma dj_parse_obj_key k, .next_tree tree, .parent parent } {
      .k .rest rest,
      { { .tree tree, .k .key_bits key_bits } |obj car, .parent cdr } |cons stack
    } |expect_val
  >
> ?dj_parse_state[];

dj_parse_step = ?dj_parse_state[] <
  /got_val { .stack /nil _s, .rest rest, .val val } { .rest rest, .val value },
  <
    /expect_val dj_parse_expect_val,
    /got_val { .rest rest, .val val, .stack /cons c } {
      .rest rest, .val val, .c .car frame, .c .cdr parent
    } dj_parse_got_val
  > dj_parse_step
> ?{ string[] rest, djson[] value };

dj_json_value = ?string[]
  { () rest, {} |nil stack } |expect_val dj_parse_step
  ?{ string[] rest, djson[] value };

-- Parses an RFC 8259 JSON string into `djson[]` (rejecting trailing non-whitespace tokens).
parse_json = ?string[] dj_json_value { .rest dj_ws /nil _, .value value } .value ?djson[];
