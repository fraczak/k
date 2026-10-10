import { patternFromFilter } from "./runtime/codec-sdk.mjs";
import { textToStringValue, stringValueToText } from "./runtime/unicode-string.mjs";

const STRING_PATTERN_PROPERTY_LIST = patternFromFilter(`
? <
  {} nil,
  {
    <
      {
        < {} 0, {} 1 >=Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6
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
        { Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6, Bit 7 }=Bits8 lo
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
        Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6, Bit 7, Bit 8, Bit 9, Bit 10
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
    > car,
    Str cdr
  } cons
> = Str
`);

export { STRING_PATTERN_PROPERTY_LIST, textToStringValue, stringValueToText };
