$ bit = < {} 0, {} 1 >;

$ byte = { 
  bit 0, bit 1, bit 2, bit 3,
  bit 4, bit 5, bit 6, bit 7 
};

$ bytes = < {} nil, {byte car, bytes cdr} cons >;

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

0 = {}|0;
1 = {}|1;

_ = {1 6, 0 5, 1 4, 1 3, 1 2, 1 1, 1 0};
map = $ unicode <
  /ascii <
    {.6/1 6, .5/1 5, .4/1 4, .3/1 3, .2/1 2, .1/1 1, .0/1 0 } _,
    {{.6/0 6, .5/1 5} if, () then} .then,
    {.6/1 if, () then} .then
  >,
  _
> | ascii;

filter = $string <
  /cons {.car map car, .cdr filter cdr} | cons,
  () 
>;

filter