# --lib lib/bits.k --use inc

-- lib/btrie.k — Parametric optional values (opt[V]) and binary bit-tries (btrie[V])

---------------------------------------------------------------
-- §1. Base Patterns & Primitives
---------------------------------------------------------------

bit[]   = < {} 0, {} 1 >;
bits[]  = < {} _, B 0, B 1 > = B;
list[X] = < {} nil, { X car, L cdr } cons > = L;

is0    = ?bit[] /0;
is1    = ?bit[] /1;

_      = {} |_ ?bits[];
0b     = |0 ?bits[];
un_    = ?bits[] /_;
un0    = ?bits[] /0;
un1    = ?bits[] /1;
_?     = un_ _;
c0     = _ 0b;

nil    = {} |nil ?list[X];
cons   = |cons ?list[X];
un_nil = ?list[X] /nil;
car    = ?list[X] /cons .car;
cdr    = ?list[X] /cons .cdr;

---------------------------------------------------------------
-- §2. Patterns & Primitive Constructors/Destructors
---------------------------------------------------------------

opt[V] = < {} nil, V val >;

btrie[V] = <
  {} nil,
  {
    opt[V] val,
    T 0,
    T 1
  } trie
> = T;

-- Only the atomic primitives mention ?opt[V] and ?btrie[V]
nil_opt    = {} |nil ?opt[V];
val        = |val ?opt[V];
un_nil_opt = ?opt[V] /nil;
un_val     = ?opt[V] /val;

nil_trie    = {} |nil ?btrie[V];
trie        = |trie ?btrie[V];
un_nil_trie = ?btrie[V] /nil;
trie_val    = ?btrie[V] /trie .val;
step_0      = ?btrie[V] /trie .0;
step_1      = ?btrie[V] /trie .1;

---------------------------------------------------------------
-- §3. Bit-Trie Traversal
---------------------------------------------------------------

step_bit = <
  { .b is0 if, .t step_0 then } .then,
  { .b is1 if, .t step_1 then } .then
>;

step_bits1  = { .x .0 b, .t t } step_bit;
step_bits2  = { .x x, { .x .1 b, .t t } step_bit t } step_bits1;
step_bits3  = { .x x, { .x .2 b, .t t } step_bit t } step_bits2;
step_bits4  = { .x x, { .x .3 b, .t t } step_bit t } step_bits3;
step_bits5  = { .x x, { .x .4 b, .t t } step_bit t } step_bits4;
step_bits6  = { .x x, { .x .5 b, .t t } step_bit t } step_bits5;
step_bits7  = { .x x, { .x .6 b, .t t } step_bit t } step_bits6;
step_bits8  = { .x x, { .x .7 b, .t t } step_bit t } step_bits7;
step_bits9  = { .x x, { .x .8 b, .t t } step_bit t } step_bits8;
step_bits10 = { .x x, { .x .9 b, .t t } step_bit t } step_bits9;
step_bits11 = { .x x, { .x .10 b, .t t } step_bit t } step_bits10;

nth_trie = <
  { .index un_ if, .list trie_val un_val then } .then,
  <
    { .index un0 index, .list step_0 list },
    { .index un1 index, .list step_1 list }
  > nth_trie
>;

---------------------------------------------------------------
-- §4. Bit-Trie Update, Removal, Cardinality & Values
---------------------------------------------------------------

ensure_trie = <
  un_nil_trie { nil_opt val, nil_trie 0, nil_trie 1 },
  { trie_val val, step_0 0, step_1 1 }
>;

put_nth = {
  .index index,
  .val val,
  .list ensure_trie t
} <
  {
    .index un_ if,
    { .val val val, .t .0 0, .t .1 1 } trie then
  } .then,
  {
    .index un0 index,
    .val val,
    .t t
  } {
    .t .val val,
    { .index index, .val val, .t .0 list } put_nth 0,
    .t .1 1
  } trie,
  {
    .index un1 index,
    .val val,
    .t t
  } {
    .t .val val,
    .t .0 0,
    { .index index, .val val, .t .1 list } put_nth 1
  } trie
>;

remove_nth = <
  { .list un_nil_trie a, .index <_?, un0, un1> b } nil_trie,
  {
    .index un_ if,
    { nil_opt val, .list step_0 0, .list step_1 1 } trie then
  } .then,
  {
    .list trie_val val,
    { .index un0 index, .list step_0 list } remove_nth 0,
    .list step_1 1
  } trie,
  {
    .list trie_val val,
    .list step_0 0,
    { .index un1 index, .list step_1 list } remove_nth 1
  } trie
>;

trie_size = <
  { .t un_nil_trie if, .acc then } .then,
  {
    .t step_1 t,
    {
      .t step_0 t,
      <
        { .t trie_val un_nil_opt if, .acc then } .then,
        { .t trie_val un_val if, .acc inc then } .then
      > acc
    } trie_size acc
  } trie_size
>;

list_size = { () t, c0 acc } trie_size;
obj_size  = list_size;

collect_values = <
  { .tree un_nil_trie if, .acc then } .then,
  {
    .tree step_0 tree,
    {
      .tree step_1 tree,
      <
        { .tree trie_val un_nil_opt if, .acc then } .then,
        { .tree trie_val un_val car, .acc cdr } cons
      > acc
    } collect_values acc
  } collect_values
>;

obj_values_raw = { () tree, nil acc } collect_values;

values_to_trie = <
  { .klist un_nil a, .index <_?, un0, un1> b, .acc then } .then,
  {
    .klist cdr klist,
    .index inc index,
    {
      .index index,
      .klist car val,
      .acc list
    } put_nth acc
  } values_to_trie
>;
