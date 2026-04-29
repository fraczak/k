-- core.k — the k standard core library
--
-- Defines:
--   1. $bits — the canonical binary number / bit-path type
--   2. $string — unicode strings (used for labels)
--   3. $pattern — the type of pattern graphs
--   4. Basic $bits arithmetic: succ, plus, times

---------------------------------------------------------------
-- §1. Bits
---------------------------------------------------------------

$ bit = < {} 0, {} 1 >;
b0 = {}|0 $bit;
b1 = {}|1 $bit;

$ bits = < {} _, bits 0, bits 1 >;

_ = {}|_;

0 = _ |0;
1 = _ |1;

inv = {() x, _ r} _inv;
_inv = ${bits x, bits r} < {.x /0 x, .r |0 r} _inv, {.x /1 x, .r |1 r} _inv, .r >;

concat = ${bits x, bits y} {.x inv x, .y y} concat_;
concat_ = ${bits x, bits y}
  <
    {.x /0 x, .y |0 y} concat_,
    {.x /1 x, .y |1 y} concat_,
    .y
  >;

---------------------------------------------------------------
-- §2. Bits arithmetic
---------------------------------------------------------------

-- successor (increment by 1)
succ = {inv x, _ y} _inc;

_inc = ${bits x, bits y} <
    {.x /0 x, .y |1 y} concat_,
    {.x /1 x, .y |0 y} _inc,
    .y |1
>;

-- constants
2 = 1 succ;
3 = 2 succ;
4 = 3 succ;
5 = 4 succ;
6 = 5 succ;
7 = 6 succ;
8 = 7 succ;
9 = 8 succ;
10 = 9 succ;

-- addition on $bits (unsigned, LSB-first with carry)
plus = ${bits x, bits y} {.x inv x, .y inv y, b0 c} _plus;
_plus = ${bits x, bits y, bit c}
  <
    {.x /_ if, .y /_ and, <.c/0 0, 1> then} .then,
    {.x /_ if, .c/0 and, .y then} .then,
    {.x y, .y /_|_ x, .c c} _plus,
    {<.c/0 0, 1> x, .y y, .x /_ b0 c} _plus,
    {.x /0 x, .y /0 y, .c/0 b0 c} _plus |0,
    {.x /0 x, .y /0 y, .c/1 b0 c} _plus |1,
    {.x /0 x, .y /1 y, .c/0 b0 c} _plus |1,
    {.x /0 x, .y /1 y, .c/1 b1 c} _plus |0,
    {.x /1 x, .y /0 y, .c/0 b0 c} _plus |1,
    {.x /1 x, .y /0 y, .c/1 b1 c} _plus |0,
    {.x /1 x, .y /1 y, .c/0 b1 c} _plus |0,
    {.x /1 x, .y /1 y, .c/1 b1 c} _plus |1
  >;

-- multiplication on $bits (unsigned, shift-and-add)
times = ${bits x, bits y} {0 result, .x inv _x, .y y} _times;
_times = ${bits result, bits _x, bits y}
  <
    { .y /_ if, .result then } .then,
    {
      .result |0 result,
      ._x _x,
      .y /0 y
    } _times,
    {
      {._x x, .result |0 y, b0 c} _plus result,
      ._x _x,
      .y /1 y
    } _times
  >;

---------------------------------------------------------------
-- §3. Unicode and String
---------------------------------------------------------------

-- 8-bit octet used as a building block for UTF-8 payload pieces.
$ byte = {
  bit 0, bit 1, bit 2, bit 3,
  bit 4, bit 5, bit 6, bit 7
};

-- 7-bit ASCII code point payload (U+0000..U+007F).
$ ascii = { bit 6, bit 5, bit 4, bit 3, bit 2, bit 1, bit 0 };

-- 11-bit payload used for Plane 0 code points U+0080..U+07FF.
-- Plane 0 is the Basic Multilingual Plane (BMP): U+0000..U+FFFF.
$ u0080_07FF = { bit 10, bit 9, bit 8, bit 7, bit 6, bit 5, bit 4, bit 3, bit 2, bit 1, bit 0 };

-- High-byte classes for common BMP ranges, excluding surrogate/private-use partitions.
-- BMP (Basic Multilingual Plane) is Plane 0: the first 65,536 code points.
$ bmp_hi_common = <
  { bit 2, bit 1, bit 0 } h08_0F,
  { bit 6, bit 5, bit 4, bit 3, bit 2, bit 1, bit 0 } h10_7F,
  { bit 6, bit 5, bit 4, bit 3, bit 2, bit 1, bit 0 } h80_CF,
  { bit 2, bit 1, bit 0 } hD0_D7,
  {} hF9,
  { bit 0 } hFA_FB,
  { bit 0 } hFC_FD,
  { bit 0 } hFE_FF
>;

-- High-byte classes for BMP private-use/high-reserved slices.
-- These partitions keep Plane 0 subsets explicit in the type encoding.
$ bmp_hi_private_use = <
  { bit 3, bit 2, bit 1, bit 0 } hE0_EF,
  { bit 2, bit 1, bit 0 } hF0_F7,
  {} hF8
>;

-- Plane selector for supplementary code points in Planes 2..16.
-- Supplementary planes are all planes above BMP (Plane 0).
$ plane_02_10 = <
  { bit 0 } p02_03,
  { bit 1, bit 0 } p04_07,
  { bit 2, bit 1, bit 0 } p08_0F,
  {} p10
>;

-- Canonical Unicode scalar-value partition used by string encoding.
-- Branch meaning:
-- - ascii: U+0000..U+007F (subset of BMP / Plane 0)
-- - plane0: U+0080..U+07FF (still Plane 0)
-- - bmp_common, bmp_private_use: U+0800..U+FFFF partitions (Plane 0)
-- - supplementary_plane1: U+10000..U+1FFFF (Plane 1)
-- - supplementary_planes2_16: U+20000..U+10FFFF (Planes 2..16)
$ unicode = <
  ascii ascii,
  u0080_07FF plane0,
  { bmp_hi_common hi, byte lo } bmp_common,
  { bmp_hi_private_use hi, byte lo } bmp_private_use,
  { byte mid, byte lo } supplementary_plane1,
  { plane_02_10 plane, byte mid, byte lo } supplementary_planes2_16
>;

-- Linked-list string: nil or (unicode car, string cdr).
$ string = < {} nil, { unicode car, string cdr } cons >;

---------------------------------------------------------------
-- §4. Pattern
---------------------------------------------------------------

-- Edge: a labeled edge in a pattern graph.
-- 'label' is the field name or tag name.
-- 'target' is the index (as $bits) of the target node in the pattern list.

$ edge = { string label, bits target };

-- Edge list: the edges of a pattern node, sorted by label.

$ edges = < {} nil, { edge car, edges cdr } cons >;

-- Pattern node: one of five kinds.
-- "any" is the unconstrained position (...), carrying no edges.
-- The four others carry their edge list directly.

$ pattern-node = <
  {} any,
  edges open-product,
  edges open-union,
  edges closed-product,
  edges closed-union
>;

-- Pattern: a cons-list of pattern nodes.
-- Node 0 (first element) is the root.
-- Edges reference nodes by their index in this list, encoded as $bits.
--
-- The singleton pattern of $pattern itself is a fixed constant.
-- That constant is the implicit framing for all k wire formats:
-- to decode any value, first decode a $pattern under that constant,
-- then decode the value under the pattern just obtained.

$ pattern = < {} nil, { pattern-node car, pattern cdr } cons >;

$pattern
