-- core.k — the k standard core library
--
-- Defines:
--   1. bits — canonical binary number / bit-path relation
--   2. string — unicode strings relation (used for labels)
--   3. pattern — pattern graph relation

---------------------------------------------------------------
-- §1. Bits
---------------------------------------------------------------

bit = ?< {} 0, {} 1 >;

bits = ?< {} _, bits 0, bits 1 > = bits;

_ = {}|_;

0 = _ |0;
1 = _ |1;

---------------------------------------------------------------
-- §2. Unicode and String
---------------------------------------------------------------

string = ? <
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
    String cdr
  } cons
> = String;

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

pattern = ? <
  {} nil,
  {
    <
      {} any,
      <
        {} nil,
        {
          {
            <
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
                String cdr
              } cons
            > = String label,
            < Bits 0, Bits 1, {} _ > = Bits target
          } car,
          Edges cdr
        } cons
      > = Edges open-product,
      Edges open-union,
      Edges closed-product,
      Edges closed-union
    > car,
    Pattern cdr
  } cons
> = Pattern;

pattern
