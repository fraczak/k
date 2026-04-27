-- pattern.k — the canonical self-hosted k pattern type
--
-- This file defines $pattern, the type of pattern graphs.
-- A pattern graph is the structural authority for encoding and decoding
-- k values. The canonical wire format for any k value is:
--
--     PatternBits · ValueBits
--
-- where PatternBits is a value of type $pattern encoded under $pattern's
-- own singleton pattern (a fixed constant), and ValueBits is the payload
-- encoded relative to the pattern just decoded.
--
-- There is no separate envelope type. The pattern *is* the framing protocol.

-- Bits: the universal finite sequence of binary choices.
-- Used for value payloads and for bit-path addresses into binary trees.

$ bit = < {} 0, {} 1 >;

$ bits = < {} nil, { bit car, bits cdr } cons >;

-- Byte: an 8-tuple of bits. Used as a building block for unicode.

$ byte = {
  bit 0, bit 1, bit 2, bit 3,
  bit 4, bit 5, bit 6, bit 7
};

-- Unicode scalar values.
-- Every code point range is encoded with exactly the bits needed,
-- no padding, no length prefixes, no arithmetic.

$ ascii = { bit 6, bit 5, bit 4, bit 3, bit 2, bit 1, bit 0 };

$ u0080_07FF = { bit 10, bit 9, bit 8, bit 7, bit 6, bit 5, bit 4, bit 3, bit 2, bit 1, bit 0 };

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

$ bmp_hi_private_use = <
  { bit 3, bit 2, bit 1, bit 0 } hE0_EF,
  { bit 2, bit 1, bit 0 } hF0_F7,
  {} hF8
>;

$ plane_02_10 = <
  { bit 0 } p02_03,
  { bit 1, bit 0 } p04_07,
  { bit 2, bit 1, bit 0 } p08_0F,
  {} p10
>;

$ unicode = <
  ascii ascii,
  u0080_07FF plane0,
  { bmp_hi_common hi, byte lo } bmp_common,
  { bmp_hi_private_use hi, byte lo } bmp_private_use,
  { byte mid, byte lo } supplementary_plane1,
  { plane_02_10 plane, byte mid, byte lo } supplementary_planes2_16
>;

-- String: a cons-list of unicode scalar values.
-- Used for labels in pattern edge maps.

$ string = < {} nil, { unicode car, string cdr } cons >;

-- Binary tree: the canonical finite map in k.
-- No arrays, no natural number arithmetic, just structural 0/1 routing.
-- Both label-target-tree and pattern use this shape.

binary-tree? = ?< X leaf, { Y 0, Y 1 } tree > = Y;

-- Label-target-tree: the edge map for a pattern node.
-- Each leaf carries a label (string) and a target (bits = bit-path
-- into the enclosing pattern tree). Two edges sharing the same
-- bit-path land on the same pattern node — this is how semantic
-- node identity (the "same type" constraint) is expressed.

$ label-target-tree = <
  {} empty,
  { string label, bits target } leaf,
  { label-target-tree 0, label-target-tree 1 } tree
>;

-- Pattern node: one of five kinds.
-- "any" is the unconstrained position (...), carrying no edges.
-- The four others carry their edge map directly as the payload.

$ pattern-node = <
  {} any,
  label-target-tree open-product,
  label-target-tree open-union,
  label-target-tree closed-product,
  label-target-tree closed-union
>;

-- Pattern: a binary tree of pattern nodes.
-- This is the type of pattern graphs. A bit-path through this tree
-- addresses a specific node; edge targets in label-target-tree
-- reference nodes by their bit-path.
--
-- The singleton pattern of $pattern itself is a fixed constant.
-- That constant is the implicit framing for all k wire formats:
-- to decode any value, first decode a $pattern under that constant,
-- then decode the value under the pattern just obtained.

$ pattern = <
  pattern-node leaf,
  { pattern 0, pattern 1 } tree
>;

$pattern
