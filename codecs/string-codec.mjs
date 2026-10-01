import { patternFromFilter } from "./runtime/codec-sdk.mjs";
import { textToStringValue, stringValueToText } from "./runtime/unicode-string.mjs";

const STRING_PATTERN_PROPERTY_LIST = patternFromFilter(`
$bit = < {} 0, {} 1 >;
$bits1 = { bit 0 };
$bits2 = { bit 0, bit 1 };
$bits3 = { bit 0, bit 1, bit 2 };
$bits4 = { bit 0, bit 1, bit 2, bit 3 };
$bits7 = { bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6 };
$bits8 = { bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7 };
$bits11 = { bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9, bit 10 };

$bmp_common_hi = <
  bits3 h08_0F,
  bits7 h10_7F,
  bits7 h80_CF,
  bits3 hD0_D7,
  {} hF9,
  bits1 hFA_FB,
  bits1 hFC_FD,
  bits1 hFE_FF
>;
$bmp_common = { bmp_common_hi hi, bits8 lo };

$bmp_private_hi = <
  bits4 hE0_EF,
  bits3 hF0_F7,
  {} hF8
>;
$bmp_private_use = { bmp_private_hi hi, bits8 lo };

$plane2_16 = <
  bits1 p02_03,
  bits2 p04_07,
  bits3 p08_0F,
  {} p10
>;
$supplementary_planes2_16 = { plane2_16 plane, bits8 mid, bits8 lo };
$supplementary_plane1 = { bits8 mid, bits8 lo };

$unicode_scalar = <
  bits7 ascii,
  bits11 plane0,
  bmp_common bmp_common,
  bmp_private_use bmp_private_use,
  supplementary_plane1 supplementary_plane1,
  supplementary_planes2_16 supplementary_planes2_16
>;

?< {} nil, { $unicode_scalar car, str cdr } cons > = str
`);

export { STRING_PATTERN_PROPERTY_LIST, textToStringValue, stringValueToText };
