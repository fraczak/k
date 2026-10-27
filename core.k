-- core.k — the k standard core library
--
-- Defines:
--   1. bits[] — canonical binary number / bit-path relation
--   2. string[] — unicode strings relation (used for labels)
--   3. pattern[] — pattern graph relation

---------------------------------------------------------------
-- §1. Bits
---------------------------------------------------------------

bit[] = < {} 0, {} 1 >;
bits[] = < {} _, B 0, B 1 > = B;

---------------------------------------------------------------
-- §2. Unicode and String
---------------------------------------------------------------

-- 8-bit octet used as a building block for UTF-8 payload pieces.
byte[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6, bit[] 7
};

-- 7-bit ASCII code point payload (U+0000..U+007F).
ascii[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6
};

-- High-byte classes for common BMP ranges, excluding surrogate
-- and private-use partitions.
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

-- High-byte classes for BMP private-use/high-reserved slices.
bmp_hi_private_use[] = <
  { bit[] 0, bit[] 1, bit[] 2, bit[] 3 } hE0_EF,
  { bit[] 0, bit[] 1, bit[] 2 } hF0_F7,
  {} hF8
>;

-- 11-bit payload used for Plane 0 code points U+0080..U+07FF.
plane0[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3, bit[] 4,
  bit[] 5, bit[] 6, bit[] 7, bit[] 8, bit[] 9, bit[] 10
};

-- Plane selector for supplementary code points in Planes 2..16.
plane_02_10[] = <
  { bit[] 0 } p02_03,
  { bit[] 0, bit[] 1 } p04_07,
  { bit[] 0, bit[] 1, bit[] 2 } p08_0F,
  {} p10
>;

-- Canonical Unicode scalar-value partition used by string encoding.
unicode[] = <
  ascii[] ascii,
  { bmp_hi_common[] hi, byte[] lo } bmp_common,
  { bmp_hi_private_use[] hi, byte[] lo } bmp_private_use,
  plane0[] plane0,
  { byte[] mid, byte[] lo } supplementary_plane1,
  { plane_02_10[] plane, byte[] mid, byte[] lo } supplementary_planes2_16
>;

-- Linked-list string: nil or (unicode car, string cdr).
string[] = < {} nil, { unicode[] car, S cdr } cons > = S;

---------------------------------------------------------------
-- §3. Pattern
---------------------------------------------------------------

-- Pattern: a cons-list of pattern nodes.
-- Node 0 (first element) is the root.
-- Edges reference nodes by their index in this list, encoded as bits.
--
-- The singleton pattern of pattern itself is a fixed constant.
-- That constant is the implicit framing for all k wire formats:
-- to decode any value, first decode a pattern under that constant,
-- then decode the value under the pattern just obtained.

edge[] = { string[] label, bits[] target };

edges[] = < {} nil, { edge[] car, E cdr } cons > = E;

node[] = <
  {} any,
  edges[] open-product,
  edges[] open-union,
  edges[] closed-product,
  edges[] closed-union
>;

pattern[] = < {} nil, { node[] car, P cdr } cons > = P;

---

? pattern[]
