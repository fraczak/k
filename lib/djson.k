# --lib lib/bits.k --use inc lt? plus minus times1024
# --lib lib/list.k --use reverse
# --lib lib/btrie.k --use btrie[V] nth_trie put_nth remove_nth list_size obj_size obj_values_raw values_to_trie
# --lib lib/string.k --use unicode[] string[] eq_char? _quote_ _backslash_ _slash_ _bs_ _ff_ _lf_ _cr_ _tab_ n_char u_char l_char t_char r_char e_char f_char a_char s_char quote_char backslash_char slash_char b_char comma_char colon_char open_array close_array open_object close_object ws minus_char digit hex4 c1024 c55296 c56320 c57344 c65536 dot put remove str_len obj_keys_raw to_unicode
# --lib lib/ieee.k --use float64[] finite_float64? natToFloat64 scanFloat64

-- lib/djson.k — Universal dynamic JSON schema (djson[]), methods, and RFC 8259 parser

---------------------------------------------------------------
-- §1. Base Patterns & Primitives
---------------------------------------------------------------

bit[]   = < {} 0, {} 1 >;
bool[]  = < {} true, {} false >;
bits[]  = < {} _, B 0, B 1 > = B;
list[X]  = < {} nil, { X car, L cdr } cons > = L;
number[] = float64[];

is0        = ?bit[] /0;
true_bool  = {} |true ?bool[];
false_bool = {} |false ?bool[];

_   = {} |_ ?bits[];
0b  = |0 ?bits[];
1b  = |1 ?bits[];
un_ = ?bits[] /_;
un0 = ?bits[] /0;
un1 = ?bits[] /1;
_?  = un_ _;
0   = _ 0b;
1   = _ 1b;
c0  = 0;

nil      = {} |nil ?list[X];
cons     = |cons ?list[X];
un_nil   = ?list[X] /nil;
car      = ?list[X] /cons .car;
cdr      = ?list[X] /cons .cdr;

nil_trie = {} |nil ?btrie[V];
un_ascii = ?unicode[] /ascii;

---------------------------------------------------------------
-- §2. Patterns & Primitive Constructors/Destructors
---------------------------------------------------------------

djson[] = <
  number[] number,
  string[] string,
  bool[] bool,
  {} null,
  btrie[J] list,
  btrie[J] object
> = J;

json_type[] = <
  {} null, {} bool, {} number, {} string, {} list, {} object
>;

string_kind[] = <
  {} quote, {} escape, {} control, {} plain
>;

result[]      = { string[] rest, djson[] value };
text_result[] = { string[] rest, string[] value };

-- Only the atomic primitives mention ?djson[], ?json_type[], ?string_kind[]
null      = {} |null ?djson[];
number    = |number ?djson[];
string    = |string ?djson[];
bool      = |bool ?djson[];
list      = |list ?djson[];
object    = |object ?djson[];

un_null   = ?djson[] /null;
un_number = ?djson[] /number;
un_string = ?djson[] /string;
un_bool   = ?djson[] /bool;
un_list   = ?djson[] /list;
un_object = ?djson[] /object;

true         = true_bool bool;
false        = false_bool bool;
empty_list   = nil_trie list;
empty_object = nil_trie object;

null_type   = {} |null ?json_type[];
bool_type   = {} |bool ?json_type[];
number_type = {} |number ?json_type[];
string_type = {} |string ?json_type[];
list_type   = {} |list ?json_type[];
object_type = {} |object ?json_type[];

quote_kind   = {} |quote ?string_kind[];
escape_kind  = {} |escape ?string_kind[];
control_kind = {} |control ?string_kind[];
plain_kind   = {} |plain ?string_kind[];

un_quote_kind  = ?string_kind[] /quote;
un_escape_kind = ?string_kind[] /escape;
un_plain_kind  = ?string_kind[] /plain;

---------------------------------------------------------------
-- §3. Object & List Lookup, Update & Removal
---------------------------------------------------------------

get = {
  .key key,
  .json un_object object
} dot;

nth = {
  .index index,
  .json un_list list
} nth_trie;

has_key?   = { get if, () then } .then;
has?       = has_key?;
has_index? = { nth if, () then } .then;
has_nth?   = has_index?;

set = {
  .key key,
  .val val,
  .json un_object object
} put object;

del = {
  .key key,
  .json un_object object
} remove object;

set_nth = {
  .index index,
  .val val,
  .json un_list list
} put_nth list;

del_nth = {
  .index index,
  .json un_list list
} remove_nth list;

---------------------------------------------------------------
-- §4. Cardinality, Keys & Values Extraction
---------------------------------------------------------------

length_nat = <
  un_object obj_size,
  un_list list_size,
  un_string str_len
>;

length = length_nat natToFloat64 number;

push = {
  .json un_list list_size index,
  .val val,
  .json json
} set_nth;

keys_raw = un_object obj_keys_raw;

keys_to_trie = <
  { .klist un_nil a, .index <_?, un0, un1> b, .acc then } .then,
  {
    .klist cdr klist,
    .index inc index,
    {
      .index index,
      .klist car string val,
      .acc list
    } put_nth acc
  } keys_to_trie
>;

keys = un_object obj_keys_raw
  { () klist, c0 index, nil_trie acc } keys_to_trie
  list;

values_raw = <
  un_object obj_values_raw,
  un_list obj_values_raw
>;

values = <
  un_object obj_values_raw
    { () klist, c0 index, nil_trie acc } values_to_trie list,
  ?djson[]
>;

---------------------------------------------------------------
-- §5. Type Predicates
---------------------------------------------------------------

is_null?   = { un_null if, () then } .then;
is_bool?   = { un_bool if, () then } .then;
is_number? = { un_number if, () then } .then;
is_string? = { un_string if, () then } .then;
is_list?   = { un_list if, () then } .then;
is_object? = { un_object if, () then } .then;

type_of = <
  un_null null_type,
  un_bool bool_type,
  un_number number_type,
  un_string string_type,
  un_list list_type,
  un_object object_type
>;

---------------------------------------------------------------
-- §6. JSON Text Decoder (RFC 8259)
---------------------------------------------------------------

string_kind = ?unicode[] <
  { { () x, _quote_ y } eq_char? if, quote_kind then } .then,
  { { () x, _backslash_ y } eq_char? if, escape_kind then } .then,
  { un_ascii { .6 is0 a, .5 is0 b } if, control_kind then } .then,
  plain_kind
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

string_loop = {
  .rest cdr rest,
  .rest car car,
  .acc acc,
  .rest car string_kind kind
} <
  {
    .kind un_quote_kind if,
    { .rest rest, .acc reverse value } then
  } .then,
  <
    {
      .rest rest,
      { { .kind un_plain_kind a, .car b } .b car, .acc cdr } cons acc
    },
    { { .kind un_escape_kind a, .rest escape b } .b escaped, .acc acc }
    { .escaped.rest rest, { .escaped.value car, .acc cdr } cons acc }
  > string_loop
>;

json_string = quote_char { () rest, nil acc } string_loop;

json_number = {
  < minus_char {}, digit {} > if, () then
} .then scanFloat64 {
  .rest rest, .value finite_float64? number value
};

json_value = ws <
  n_char u_char l_char l_char { () rest, null value },
  t_char r_char u_char e_char { () rest, true value },
  f_char a_char l_char s_char e_char { () rest, false value },
  json_string { .rest rest, .value string value },
  json_array,
  json_object,
  json_number
>;

array_item = {
  .rest json_value item, .tree tree, .index index
} {
  .item.rest ws rest,
  { .index index, .item.value val, .tree list } put_nth tree,
  .index inc index
} <
  { .rest close_array rest, .tree list value },
  { .rest comma_char rest, .tree tree, .index index } array_item
>;

json_array = open_array ws <
  close_array { () rest, empty_list value },
  { () rest, nil_trie tree, c0 index } array_item
>;

object_item = {
  .rest ws json_string key, .tree tree
} {
  .key.rest ws colon_char json_value item,
  .key.value key, .tree tree
} {
  .item.rest ws rest,
  { .key key, .item.value val, .tree object } put tree
} <
  { .rest close_object rest, .tree object value },
  { .rest comma_char rest, .tree tree } object_item
>;

json_object = open_object ws <
  close_object { () rest, empty_object value },
  { () rest, nil_trie tree } object_item
>;

parseJson = json_value {
  .rest ws un_nil end,
  .value value
} .value;
