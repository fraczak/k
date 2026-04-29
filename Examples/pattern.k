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

-- Bits: the canonical binary number / bit-path type.
-- Empty (_), extend with 0, extend with 1.
-- Used both as node indices and as the building block for strings.

$ bits = < {} _, bits 0, bits 1 >;

-- Byte: 8 bits as a product, used as a building block for unicode.

$ bit = < {} 0, {} 1 >;

$ byte = {
  bit 0, bit 1, bit 2, bit 3,
  bit 4, bit 5, bit 6, bit 7
};

-- Unicode scalar values.

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
-- Used for labels in pattern edges.

$ string = < {} nil, { unicode car, string cdr } cons >;

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
