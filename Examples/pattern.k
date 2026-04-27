$ bit = < {} 0, {} 1 >;

$ byte = {
  bit 0, bit 1, bit 2, bit 3,
  bit 4, bit 5, bit 6, bit 7
};

$ bits = < {} nil, { bit car, bits cdr } cons >;

$ bytes = < {} nil, { byte car, bytes cdr } cons >;

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

$ string = < {} nil, { unicode car, string cdr } cons >;

binary-tree? = ?< X leaf, { Y 0, Y 1 } tree > = Y;

$ label-target-tree = <
  {} empty,
  { string label, bits target } leaf,
  { label-target-tree 0, label-target-tree 1 } tree
>;

$ pattern-node = <
  {} any,
  label-target-tree open-product,
  label-target-tree open-union,
  label-target-tree closed-product,
  label-target-tree closed-union
>;

$ pattern = <
  pattern-node leaf,
  { pattern 0, pattern 1 } tree
>;

$ envelope = {
  pattern pattern,
  bits value-bits
};

$ object-file = {
  pattern input-pattern,
  pattern output-pattern,
  envelope input
};

$pattern
