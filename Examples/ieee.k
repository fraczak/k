-- IEEE 754 Double Precision Floating-Point Format

$ bit = <{} 0, {} 1>;

bit_eq = ${bit 0, bit 1} {
  <{.0.0 0, .1.0 1}, {.0.1 0, .1.1 1}> bit_eq,
  .0 then
} .then;

0 = {{} 0};
1 = {{} 1};

$ sign = < {} "+", {} "-" >;
sign_plus = {{} "+"};
sign_minus = {{} "-"};

sign_eq = ${sign 0, sign 1} {
  < {.0."+" 0, .1."+" 1}, {.0."-" 0, .1."-" 1} > sign_eq,
  .0 then
} .then;

$ exponent = {
  bit 0, bit 1, bit 2, bit 3, bit 4, bit 5,
  bit 6, bit 7, bit 8, bit 9, bit 10
};

exponent_0 = {
  0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10
} $exponent;


exponent_eq = ${exponent 0, exponent 1} {
  {.0.0 0, .1.0 1} bit_eq 0,
  {.0.1 0, .1.1 1} bit_eq 1,
  {.0.2 0, .1.2 1} bit_eq 2,
  {.0.3 0, .1.3 1} bit_eq 3,
  {.0.4 0, .1.4 1} bit_eq 4,
  {.0.5 0, .1.5 1} bit_eq 5,
  {.0.6 0, .1.6 1} bit_eq 6,
  {.0.7 0, .1.7 1} bit_eq 7,
  {.0.8 0, .1.8 1} bit_eq 8,
  {.0.9 0, .1.9 1} bit_eq 9,
  {.0.10 0, .1.10 1} bit_eq 10,
  .0 then
} .then;

exponent_0? = {exponent_0 0, () 1} exponent_eq;

$ mantissa = {
  bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9,
  bit 10, bit 11, bit 12, bit 13, bit 14, bit 15, bit 16, bit 17, bit 18, bit 19,
  bit 20, bit 21, bit 22, bit 23, bit 24, bit 25, bit 26, bit 27, bit 28, bit 29,
  bit 30, bit 31, bit 32, bit 33, bit 34, bit 35, bit 36, bit 37, bit 38, bit 39,
  bit 40, bit 41, bit 42, bit 43, bit 44, bit 45, bit 46, bit 47, bit 48, bit 49,
  bit 50, bit 51
};

mantissa_0 = {
  0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19, 0 20, 
  0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 
  0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51
} $mantissa;

mantissa_max = {
  1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10, 1 11, 1 12, 1 13, 1 14, 1 15, 1 16, 1 17, 1 18, 1 19, 1 20, 
  1 21, 1 22, 1 23, 1 24, 1 25, 1 26, 1 27, 1 28, 1 29, 1 30, 1 31, 1 32, 1 33, 1 34, 1 35, 1 36, 1 37, 1 38, 1 39, 
  1 40, 1 41, 1 42, 1 43, 1 44, 1 45, 1 46, 1 47, 1 48, 1 49, 1 50, 1 51
} $mantissa;

mantissa_eq = ${mantissa 0, mantissa 1} {
  {.0.0 0, .1.0 1} bit_eq 0,
  {.0.1 0, .1.1 1} bit_eq 1,
  {.0.2 0, .1.2 1} bit_eq 2,
  {.0.3 0, .1.3 1} bit_eq 3,
  {.0.4 0, .1.4 1} bit_eq 4,
  {.0.5 0, .1.5 1} bit_eq 5,
  {.0.6 0, .1.6 1} bit_eq 6,
  {.0.7 0, .1.7 1} bit_eq 7,
  {.0.8 0, .1.8 1} bit_eq 8,
  {.0.9 0, .1.9 1} bit_eq 9,
  {.0.10 0, .1.10 1} bit_eq 10,
  {.0.11 0, .1.11 1} bit_eq 11,
  {.0.12 0, .1.12 1} bit_eq 12,
  {.0.13 0, .1.13 1} bit_eq 13,
  {.0.14 0, .1.14 1} bit_eq 14,
  {.0.15 0, .1.15 1} bit_eq 15,
  {.0.16 0, .1.16 1} bit_eq 16,
  {.0.17 0, .1.17 1} bit_eq 17,
  {.0.18 0, .1.18 1} bit_eq 18,
  {.0.19 0, .1.19 1} bit_eq 19,
  {.0.20 0, .1.20 1} bit_eq 20,
  {.0.21 0, .1.21 1} bit_eq 21,
  {.0.22 0, .1.22 1} bit_eq 22,
  {.0.23 0, .1.23 1} bit_eq 23,
  {.0.24 0, .1.24 1} bit_eq 24,
  {.0.25 0, .1.25 1} bit_eq 25,
  {.0.26 0, .1.26 1} bit_eq 26,
  {.0.27 0, .1.27 1} bit_eq 27,
  {.0.28 0, .1.28 1} bit_eq 28,
  {.0.29 0, .1.29 1} bit_eq 29,
  {.0.30 0, .1.30 1} bit_eq 30,
  {.0.31 0, .1.31 1} bit_eq 31,
  {.0.32 0, .1.32 1} bit_eq 32,
  {.0.33 0, .1.33 1} bit_eq 33,
  {.0.34 0, .1.34 1} bit_eq 34,
  {.0.35 0, .1.35 1} bit_eq 35,
  {.0.36 0, .1.36 1} bit_eq 36,
  {.0.37 0, .1.37 1} bit_eq 37,
  {.0.38 0, .1.38 1} bit_eq 38,
  {.0.39 0, .1.39 1} bit_eq 39,
  {.0.40 0, .1.40 1} bit_eq 40,
  {.0.41 0, .1.41 1} bit_eq 41,
  {.0.42 0, .1.42 1} bit_eq 42,
  {.0.43 0, .1.43 1} bit_eq 43,
  {.0.44 0, .1.44 1} bit_eq 44,
  {.0.45 0, .1.45 1} bit_eq 45,
  {.0.46 0, .1.46 1} bit_eq 46,
  {.0.47 0, .1.47 1} bit_eq 47,
  {.0.48 0, .1.48 1} bit_eq 48,
  {.0.49 0, .1.49 1} bit_eq 49,
  {.0.50 0, .1.50 1} bit_eq 50,
  {.0.51 0, .1.51 1} bit_eq 51,
  .0 that
} .that;

mantissa_0? = {mantissa_0 0, () 1} mantissa_eq; 

$ IEEE_754 = {
  sign sign,
  exponent exponent,
  mantissa mantissa
};

shift_left_mantissa = $mantissa {
  .1 0, .2 1, .3 2, .4 3, .5 4, .6 5, .7 6, .8 7, .9 8,
  .10 9, .11 10, .12 11, .13 12, .14 13, .15 14, .16 15, .17 16, .18 17, .19 18,
  .20 19, .21 20, .22 21, .23 22, .24 23, .25 24, .26 25, .27 26, .28 27, .29 28,
  .30 29, .31 30, .32 31, .33 32, .34 33, .35 34, .36 35, .37 36, .38 37, .39 38,
  .40 39, .41 40, .42 41, .43 42, .44 43, .45 44, .46 45, .47 46, .48 47, .49 48,
  .50 49, .51 50, 0 51
} $mantissa;

-- Shift mantissa right by one position (used for alignment)
shift_right_mantissa = $mantissa {
  0 0, .0 1, .1 2, .2 3, .3 4, .4 5, .5 6, .6 7, .7 8, .8 9,
  .9 10, .10 11, .11 12, .12 13, .13 14, .14 15, .15 16, .16 17, .17 18, .18 19,
  .19 20, .20 21, .21 22, .22 23, .23 24, .24 25, .25 26, .26 27, .27 28, .28 29,
  .29 30, .30 31, .31 32, .32 33, .33 34, .34 35, .35 36, .36 37, .37 38, .38 39,
  .39 40, .40 41, .41 42, .42 43, .43 44, .44 45, .45 46, .46 47, .47 48, .48 49,
  .49 50, .50 51
} $mantissa;

-- Check if mantissa has leading 1 in implicit bit position (normalized)
mantissa_normalized? = $mantissa 
  -- For IEEE 754, we assume implicit leading 1, so any non-zero mantissa is normalized
  -- This is a simplified check
  mantissa_0?;

-- Find the difference between two exponents (for alignment)
exponent_diff = ${exponent larger, exponent smaller}
  {.larger a, .smaller b} exponent_sub;

exponent_decr = <
  {.0.1 0 0, .1     1, .2     2, .3     3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {1      0, .1.1 0 1, .2     2, .3     3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {1      0, 1      1, .2.1 0 2, .3     3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {1      0, 1      1, 1      2, .3.1 0 3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {1      0, 1      1, 1      2, 1      3, .4.1 0 4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {1      0, 1      1, 1      2, 1      3, 1      4, .5.1 0 5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {1      0, 1      1, 1      2, 1      3, 1      4, 1      5, .6.1 0 6, .7     7, .8     8, .9     9, .10     10},
  {1      0, 1      1, 1      2, 1      3, 1      4, 1      5, 1      6, .7.1 0 7, .8     8, .9     9, .10     10},
  {1      0, 1      1, 1      2, 1      3, 1      4, 1      5, 1      6, 1      7, .8.1 0 8, .9     9, .10     10},
  {1      0, 1      1, 1      2, 1      3, 1      4, 1      5, 1      6, 1      7, 1      8, .9.1 0 9, .10     10},
  {1      0, 1      1, 1      2, 1      3, 1      4, 1      5, 1      6, 1      7, 1      8, 1      9, .10.1 0 10} 
>;
exponent_incr = <
  {.0.0 1 0, .1     1, .2     2, .3     3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {0      0, .1.0 1 1, .2     2, .3     3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {0      0, 0      1, .2.0 1 2, .3     3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {0      0, 0      1, 0      2, .3.0 1 3, .4     4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {0      0, 0      1, 0      2, 0      3, .4.0 1 4, .5     5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {0      0, 0      1, 0      2, 0      3, 0      4, .5.0 1 5, .6     6, .7     7, .8     8, .9     9, .10     10},
  {0      0, 0      1, 0      2, 0      3, 0      4, 0      5, .6.0 1 6, .7     7, .8     8, .9     9, .10     10},
  {0      0, 0      1, 0      2, 0      3, 0      4, 0      5, 0      6, .7.0 1 7, .8     8, .9     9, .10     10},
  {0      0, 0      1, 0      2, 0      3, 0      4, 0      5, 0      6, 0      7, .8.0 1 8, .9     9, .10     10},
  {0      0, 0      1, 0      2, 0      3, 0      4, 0      5, 0      6, 0      7, 0      8, .9.0 1 9, .10     10},
  {0      0, 0      1, 0      2, 0      3, 0      4, 0      5, 0      6, 0      7, 0      8, 0      9, .10.0 1 10} 
>;



exponent_bias = {0 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} $exponent; 
exponent_1023 = exponent_bias;
exponent_2047 = {1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} $exponent;

$ ieee_kind = < {} "+infty", {} "-infty", {} NaN, {} normal, {} subnormal >;
plus_infty = {{}  "+infty"};
minus_infty = {{} "-infty"};
NaN = {{} NaN};
normal = {{} normal};
subnormal = {{} subnormal};

ieee_kind = $IEEE_754 <
  -- Check for infinity/NaN (exponent = 2047)
  { 
    {.exponent 0, exponent_2047 1} exponent_eq exp_is_2047,
    < {.mantissa mantissa_0? mantissa_is_zero,
        -- Infinity case: depends on sign
        < 
          .sign."+" plus_infty,
          minus_infty
        > then
      } .then,
      -- NaN case: exponent=2047 and mantissa≠0
      NaN
    > then
  } .then,
  
  -- Check for subnormal (exponent = 0)
  .exponent exponent_0? subnormal 
    -- Normal case
  normal
>;

ieee_NaN ={
  sign_plus sign,
  exponent_2047 exponent,
  mantissa_max mantissa
};

-- IEEE 754 representations
ieee_0 = {
  sign: sign_plus,
  exponent: exponent_0,
  mantissa: mantissa_0
};

ieee_0? = $IEEE_754 
  { 
    .sign."+" sign_is_plus, 
    .exponent exponent_0? exp_is_zero,
    .mantissa mantissa_0? mantissa_is_zero,
    () then
  } .then;

---
-- IEEE 754 representations for 1, 2, 4

ieee_1 = {
  sign_plus sign,
  exponent_bias exponent,
  mantissa_0 mantissa
};

ieee_2 = {
  sign_plus sign,
  {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10} exponent,
  mantissa_0 mantissa
};

ieee_4 = {
  sign_plus sign,
  {0 0, 1 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10} exponent,
  mantissa_0 mantissa
};

-- Sign operations
ieee_abs = $IEEE_754 {sign_plus sign, .exponent exponent, .mantissa mantissa};
ieee_neg = $IEEE_754 <
  < {.sign."-" sign_is_minus, 
      {sign_plus sign, .exponent exponent, .mantissa mantissa} then
    } .then,
    {sign_minus sign, .exponent exponent, .mantissa mantissa}
  >
>;

-- Exponent comparison - identity only if bigger > smaller
exponent_gt? = ${exponent bigger, exponent smaller} <
  -- Compare bit by bit from most significant to least significant
  {.bigger.10.1 1, .smaller.10.0 0, () then } .then,
  { {.bigger.10 0, .smaller.10 1} bit_eq bits_eq, () then } .then  <
    {.bigger.9.1 1, .smaller.9.0 0, () then } .then,
    { {.bigger.9 0, .smaller.9 1} bit_eq bits_eq, () then } .then  <
      {.bigger.8.1 1, .smaller.8.0 0, () then } .then,
      { {.bigger.8 0, .smaller.8 1} bit_eq bits_eq, () then } .then  <
        {.bigger.7.1 1, .smaller.7.0 0, () then } .then,
        { {.bigger.7 0, .smaller.7 1} bit_eq bits_eq, () then } .then  <
          {.bigger.6.1 1, .smaller.6.0 0, () then } .then,
          { {.bigger.6 0, .smaller.6 1} bit_eq bits_eq, () then } .then  <
            {.bigger.5.1 1, .smaller.5.0 0, () then } .then,
            { {.bigger.5 0, .smaller.5 1} bit_eq bits_eq, () then } .then  <
              {.bigger.4.1 1, .smaller.4.0 0, () then } .then,
              { {.bigger.4 0, .smaller.4 1} bit_eq bits_eq, () then } .then  <
                {.bigger.3.1 1, .smaller.3.0 0, () then } .then,
                { {.bigger.3 0, .smaller.3 1} bit_eq bits_eq, () then } .then  <
                  {.bigger.2.1 1, .smaller.2.0 0, () then } .then,
                  { {.bigger.2 0, .smaller.2 1} bit_eq bits_eq, () then } .then  <
                    {.bigger.1.1 1, .smaller.1.0 0, () then } .then,
                    { {.bigger.1 0, .smaller.1 1} bit_eq bits_eq,
                      .bigger.0.1 1, 
                      .smaller.0.0 0, 
                      () then 
                    } .then
                  >
                >
              >
            >
          >
        >
      >
    >
  >
>;  

-- Mantissa comparison - identity only if bigger > smaller
mantissa_gt? = ${mantissa bigger, mantissa smaller} <
  {.bigger.0.1 1, .smaller.0.0 0, () then } .then,
  { {.bigger.0 0, .smaller.0 1} bit_eq bits_eq, () then } .then <
    {.bigger.1.1 1, .smaller.1.0 0, () then } .then,
    { {.bigger.1 0, .smaller.1 1} bit_eq bits_eq, () then } .then <
      {.bigger.2.1 1, .smaller.2.0 0, () then } .then,
      { {.bigger.2 0, .smaller.2 1} bit_eq bits_eq, () then } .then <
        {.bigger.3.1 1, .smaller.3.0 0, () then } .then,
        { {.bigger.3 0, .smaller.3 1} bit_eq bits_eq, () then } .then <
          {.bigger.4.1 1, .smaller.4.0 0, () then } .then,
          { {.bigger.4 0, .smaller.4 1} bit_eq bits_eq, () then } .then <
            {.bigger.5.1 1, .smaller.5.0 0, () then } .then,
            { {.bigger.5 0, .smaller.5 1} bit_eq bits_eq, () then } .then <
              {.bigger.6.1 1, .smaller.6.0 0, () then } .then,
              { {.bigger.6 0, .smaller.6 1} bit_eq bits_eq, () then } .then <
                {.bigger.7.1 1, .smaller.7.0 0, () then } .then,
                { {.bigger.7 0, .smaller.7 1} bit_eq bits_eq, () then } .then <
                  {.bigger.8.1 1, .smaller.8.0 0, () then } .then,
                  { {.bigger.8 0, .smaller.8 1} bit_eq bits_eq, () then } .then <
                    {.bigger.9.1 1, .smaller.9.0 0, () then } .then,
                    { {.bigger.9 0, .smaller.9 1} bit_eq bits_eq, () then } .then <
                      {.bigger.10.1 1, .smaller.10.0 0, () then } .then,
                      { {.bigger.10 0, .smaller.10 1} bit_eq bits_eq, () then } .then <
                        {.bigger.11.1 1, .smaller.11.0 0, () then } .then,
                        { {.bigger.11 0, .smaller.11 1} bit_eq bits_eq, () then } .then <
                          {.bigger.12.1 1, .smaller.12.0 0, () then } .then,
                          { {.bigger.12 0, .smaller.12 1} bit_eq bits_eq, () then } .then <
                            {.bigger.13.1 1, .smaller.13.0 0, () then } .then,
                            { {.bigger.13 0, .smaller.13 1} bit_eq bits_eq, () then } .then <
                              {.bigger.14.1 1, .smaller.14.0 0, () then } .then,
                              { {.bigger.14 0, .smaller.14 1} bit_eq bits_eq, () then } .then <
                                {.bigger.15.1 1, .smaller.15.0 0, () then } .then,
                                { {.bigger.15 0, .smaller.15 1} bit_eq bits_eq, () then } .then <
                                  {.bigger.16.1 1, .smaller.16.0 0, () then } .then,
                                  { {.bigger.16 0, .smaller.16 1} bit_eq bits_eq, () then } .then <
                                    {.bigger.17.1 1, .smaller.17.0 0, () then } .then,
                                    { {.bigger.17 0, .smaller.17 1} bit_eq bits_eq, () then } .then <
                                      {.bigger.18.1 1, .smaller.18.0 0, () then } .then,
                                      { {.bigger.18 0, .smaller.18 1} bit_eq bits_eq, () then } .then <
                                        {.bigger.19.1 1, .smaller.19.0 0, () then } .then,
                                        { {.bigger.19 0, .smaller.19 1} bit_eq bits_eq, () then } .then <
                                          {.bigger.20.1 1, .smaller.20.0 0, () then } .then,
                                          { {.bigger.20 0, .smaller.20 1} bit_eq bits_eq, () then } .then <
                                            {.bigger.21.1 1, .smaller.21.0 0, () then } .then,
                                            { {.bigger.21 0, .smaller.21 1} bit_eq bits_eq, () then } .then <
                                              {.bigger.22.1 1, .smaller.22.0 0, () then } .then,
                                              { {.bigger.22 0, .smaller.22 1} bit_eq bits_eq, () then } .then <
                                                {.bigger.23.1 1, .smaller.23.0 0, () then } .then,
                                                { {.bigger.23 0, .smaller.23 1} bit_eq bits_eq, () then } .then <
                                                  {.bigger.24.1 1, .smaller.24.0 0, () then } .then,
                                                  { {.bigger.24 0, .smaller.24 1} bit_eq bits_eq, () then } .then <
                                                    {.bigger.25.1 1, .smaller.25.0 0, () then } .then,
                                                    { {.bigger.25 0, .smaller.25 1} bit_eq bits_eq, () then } .then <
                                                      {.bigger.26.1 1, .smaller.26.0 0, () then } .then,
                                                      { {.bigger.26 0, .smaller.26 1} bit_eq bits_eq, () then } .then <
                                                        {.bigger.27.1 1, .smaller.27.0 0, () then } .then,
                                                        { {.bigger.27 0, .smaller.27 1} bit_eq bits_eq, () then } .then <
                                                          {.bigger.28.1 1, .smaller.28.0 0, () then } .then,
                                                          { {.bigger.28 0, .smaller.28 1} bit_eq bits_eq, () then } .then <
                                                            {.bigger.29.1 1, .smaller.29.0 0, () then } .then,
                                                            { {.bigger.29 0, .smaller.29 1} bit_eq bits_eq, () then } .then <
                                                              {.bigger.30.1 1, .smaller.30.0 0, () then } .then,
                                                              { {.bigger.30 0, .smaller.30 1} bit_eq bits_eq, () then } .then <
                                                                {.bigger.31.1 1, .smaller.31.0 0, () then } .then,
                                                                { {.bigger.31 0, .smaller.31 1} bit_eq bits_eq, () then } .then <
                                                                  {.bigger.32.1 1, .smaller.32.0 0, () then } .then,
                                                                  { {.bigger.32 0, .smaller.32 1} bit_eq bits_eq, () then } .then <
                                                                    {.bigger.33.1 1, .smaller.33.0 0, () then } .then,
                                                                    { {.bigger.33 0, .smaller.33 1} bit_eq bits_eq, () then } .then <
                                                                      {.bigger.34.1 1, .smaller.34.0 0, () then } .then,
                                                                      { {.bigger.34 0, .smaller.34 1} bit_eq bits_eq, () then } .then <
                                                                        {.bigger.35.1 1, .smaller.35.0 0, () then } .then,
                                                                        { {.bigger.35 0, .smaller.35 1} bit_eq bits_eq, () then } .then <
                                                                          {.bigger.36.1 1, .smaller.36.0 0, () then } .then,
                                                                          { {.bigger.36 0, .smaller.36 1} bit_eq bits_eq, () then } .then <
                                                                            {.bigger.37.1 1, .smaller.37.0 0, () then } .then,
                                                                            { {.bigger.37 0, .smaller.37 1} bit_eq bits_eq, () then } .then <
                                                                              {.bigger.38.1 1, .smaller.38.0 0, () then } .then,
                                                                              { {.bigger.38 0, .smaller.38 1} bit_eq bits_eq, () then } .then <
                                                                                {.bigger.39.1 1, .smaller.39.0 0, () then } .then,
                                                                                { {.bigger.39 0, .smaller.39 1} bit_eq bits_eq, () then } .then <
                                                                                  {.bigger.40.1 1, .smaller.40.0 0, () then } .then,
                                                                                  { {.bigger.40 0, .smaller.40 1} bit_eq bits_eq, () then } .then <
                                                                                    {.bigger.41.1 1, .smaller.41.0 0, () then } .then,
                                                                                    { {.bigger.41 0, .smaller.41 1} bit_eq bits_eq, () then } .then <
                                                                                      {.bigger.42.1 1, .smaller.42.0 0, () then } .then,
                                                                                      { {.bigger.42 0, .smaller.42 1} bit_eq bits_eq, () then } .then <
                                                                                        {.bigger.43.1 1, .smaller.43.0 0, () then } .then,
                                                                                        { {.bigger.43 0, .smaller.43 1} bit_eq bits_eq, () then } .then <
                                                                                          {.bigger.44.1 1, .smaller.44.0 0, () then } .then,
                                                                                          { {.bigger.44 0, .smaller.44 1} bit_eq bits_eq, () then } .then <
                                                                                            {.bigger.45.1 1, .smaller.45.0 0, () then } .then,
                                                                                            { {.bigger.45 0, .smaller.45 1} bit_eq bits_eq, () then } .then <
                                                                                              {.bigger.46.1 1, .smaller.46.0 0, () then } .then,
                                                                                              { {.bigger.46 0, .smaller.46 1} bit_eq bits_eq, () then } .then <
                                                                                                {.bigger.47.1 1, .smaller.47.0 0, () then } .then,
                                                                                                { {.bigger.47 0, .smaller.47 1} bit_eq bits_eq, () then } .then <
                                                                                                  {.bigger.48.1 1, .smaller.48.0 0, () then } .then,
                                                                                                  { {.bigger.48 0, .smaller.48 1} bit_eq bits_eq, () then } .then <
                                                                                                    {.bigger.49.1 1, .smaller.49.0 0, () then } .then,
                                                                                                    { {.bigger.49 0, .smaller.49 1} bit_eq bits_eq, () then } .then <
                                                                                                      {.bigger.50.1 1, .smaller.50.0 0, () then } .then,
                                                                                                      { {.bigger.50 0, .smaller.50 1} bit_eq bits_eq,
                                                                                                        .bigger.51.1 1, 
                                                                                                        .smaller.51.0 0, 
                                                                                                        () then 
                                                                                                      } .then
                                                                                                    >
                                                                                                  >
                                                                                                >
                                                                                              >
                                                                                            >
                                                                                          >
                                                                                        >
                                                                                      >
                                                                                    >
                                                                                  >
                                                                                >
                                                                              >
                                                                            >
                                                                          >
                                                                        >
                                                                      >
                                                                    >
                                                                  >
                                                                >
                                                              >
                                                            >
                                                          >
                                                        >
                                                      >
                                                    >
                                                  >
                                                >
                                              >
                                            >
                                          >
                                        >
                                      >
                                    >
                                  >
                                >
                              >
                            >
                          >
                        >
                      >
                    >
                  >
                >
              >
            >
          >
        >
      >
    >
  >
>;


-- IEEE 754 Bias Explanation

-- For double precision (64-bit):
-- - Exponent field: 11 bits
-- - Bias: 2^(11-1) - 1 = 1023
-- - Stored exponent range: 0 to 2047
-- - Actual exponent range: -1023 to +1024

-- Examples:
-- Stored=0    → Actual=-1023 (special: subnormal/zero)
-- Stored=1    → Actual=-1022 (smallest normal)
-- Stored=1023 → Actual=0     (exponent for 1.0)
-- Stored=1024 → Actual=+1    (exponent for 2.0)
-- Stored=2047 → Actual=+1024 (special: infinity/NaN)

-- bias_1023 = 1023;

-- Convert stored exponent to actual exponent
-- actual_exponent = $int (.stored_exp - bias_1023);

-- Examples in our representations:
-- ieee_1: stored=1023 → actual=0  → value = 1.0 × 2^0 = 1
-- ieee_2: stored=1024 → actual=+1 → value = 1.0 × 2^1 = 2  
-- ieee_4: stored=1025 → actual=+2 → value = 1.0 × 2^2 = 4

-- Why use bias?
-- 1. Avoids negative number storage in exponent field
-- 2. Makes exponent comparison easier (larger stored = larger actual)
-- 3. Zero exponent has special meaning (subnormal numbers)


--- ADDITION

// IEEE 754 Double Precision Addition Algorithm
//
// Input: Two IEEE 754 numbers A and B, each with:
// - 1 sign bit (bit 63)
// - 11 exponent bits (bits 62-52) 
// - 52 mantissa bits (bits 51-0), with implicit leading 1
//

-- Helper function for mantissa addition with carry
mantissa_add_with_carry = ${mantissa a, mantissa b, bit carry_in}
  {.a a, .b b, .carry_in carry} _mantissa_add ${mantissa result, bit carry_out};

-- Recursive mantissa addition with carry propagation
_mantissa_add = ${mantissa a, mantissa b, bit carry}
  <
    -- Base case: both mantissas are zero, no carry
    {.a mantissa_0? a_zero, .b mantissa_0? b_zero, .carry.0 carry_zero} 
      {mantissa_0 result, 0 carry_out},
    
    -- Base case: both mantissas are zero, with carry  
    {.a mantissa_0? a_zero, .b mantissa_0? b_zero, .carry.1 carry_one}
      {{1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10,
        0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19, 0 20,
        0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30,
        0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40,
        0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51} $mantissa result, 0 carry_out},
    
    -- General case: add bit by bit with carry propagation (placeholder)
    {.a a, .b b, .carry carry} mantissa_add_simple
  > ${mantissa result, bit carry_out};

-- Helper to combine bit with rest of mantissa
_combine_mantissa_bits = ${bit new_bit, mantissa rest_mantissa}
  {
    .new_bit 0, .rest_mantissa.0 1, .rest_mantissa.1 2, .rest_mantissa.2 3, .rest_mantissa.3 4, .rest_mantissa.4 5,
    .rest_mantissa.5 6, .rest_mantissa.6 7, .rest_mantissa.7 8, .rest_mantissa.8 9, .rest_mantissa.9 10,
    .rest_mantissa.10 11, .rest_mantissa.11 12, .rest_mantissa.12 13, .rest_mantissa.13 14, .rest_mantissa.14 15,
    .rest_mantissa.15 16, .rest_mantissa.16 17, .rest_mantissa.17 18, .rest_mantissa.18 19, .rest_mantissa.19 20,
    .rest_mantissa.20 21, .rest_mantissa.21 22, .rest_mantissa.22 23, .rest_mantissa.23 24, .rest_mantissa.24 25,
    .rest_mantissa.25 26, .rest_mantissa.26 27, .rest_mantissa.27 28, .rest_mantissa.28 29, .rest_mantissa.29 30,
    .rest_mantissa.30 31, .rest_mantissa.31 32, .rest_mantissa.32 33, .rest_mantissa.33 34, .rest_mantissa.34 35,
    .rest_mantissa.35 36, .rest_mantissa.36 37, .rest_mantissa.37 38, .rest_mantissa.38 39, .rest_mantissa.39 40,
    .rest_mantissa.40 41, .rest_mantissa.41 42, .rest_mantissa.42 43, .rest_mantissa.43 44, .rest_mantissa.44 45,
    .rest_mantissa.45 46, .rest_mantissa.46 47, .rest_mantissa.47 48, .rest_mantissa.48 49, .rest_mantissa.49 50, .rest_mantissa.50 51
  } $mantissa;

-- Mantissa subtraction (a - b) with borrow
mantissa_sub_with_borrow = ${mantissa a, mantissa b, bit borrow_in}
  {.a a, .b b, .borrow_in borrow} _mantissa_sub ${mantissa result, bit borrow_out};

-- Recursive mantissa subtraction with borrow propagation  
_mantissa_sub = ${mantissa a, mantissa b, bit borrow}
  {.a result, 0 borrow_out} ${mantissa result, bit borrow_out};

-- Simplified mantissa addition for demonstration  
mantissa_add_simple = ${mantissa a, mantissa b, bit carry} {.a result, 0 carry_out} ${mantissa result, bit carry_out};

-- Helper to determine which IEEE number is larger in magnitude
ieee_magnitude_greater = ${IEEE_754 a, IEEE_754 b}
  {.a a, .b b}
  <
    -- Compare exponents first
    {{.a.exponent bigger, .b.exponent smaller} exponent_gt? if,  .a then} .then,
    {{.b.exponent bigger, .a.exponent smaller} exponent_gt? if,  .b then} .then,
    -- If exponents equal, compare mantissas
    {{.a.mantissa bigger, .b.mantissa smaller} mantissa_gt? if,  .a then} .then,
    .b
  >;

-- Main IEEE addition function
ieee_add = ${IEEE_754 x, IEEE_754 y} 
  {.x x, .y y, .x ieee_kind xkind, .y ieee_kind ykind} 
<
  -- Special cases: NaN propagation
  .xkind.NaN ieee_NaN,
  .ykind.NaN ieee_NaN,
  
  -- Infinity cases
  {.xkind."+infty" pos_inf_x, .ykind."-infty" neg_inf_y} ieee_NaN,
  {.xkind."-infty" neg_inf_x, .ykind."+infty" pos_inf_y} ieee_NaN,

  {.xkind."+infty" pos_inf, .x then} .then,
  {.xkind."-infty" neg_inf, .x then} .then,
  
  {.ykind."+infty" pos_inf, .y then} .then,
  {.ykind."-infty" neg_inf, .y then} .then,
  
  -- Zero cases
  {.x ieee_0? x_is_zero, .y then} .then,
  {.y ieee_0? y_is_zero, .x then} .then,
  
  -- Normal addition case
  {.x x, .y y} ieee_add_normal
>;

-- Normal case addition (both operands are normal numbers)
ieee_add_normal = ${IEEE_754 x, IEEE_754 y}
 -- TODO
 .x;

-- Add two IEEE numbers that are already aligned (larger has >= exponent)
ieee_add_aligned = ${IEEE_754 larger, IEEE_754 smaller}
  -- TODO
  .larger;


-- Normalize IEEE result after arithmetic operations
ieee_normalize_result = ${mantissa mantissa, exponent exp, sign sign}
  -- Check if mantissa overflowed (bit 52 is set, meaning we need to shift right)
  -- For now, simplified: just return as-is
  {.sign sign, .exp exponent, .mantissa mantissa} $IEEE_754;

-- IEEE 754 Multiplication
ieee_mult = ${IEEE_754 x, IEEE_754 y}
  {.x x, .y y, .x ieee_kind xkind, .y ieee_kind ykind}
<
  -- Special cases: NaN propagation
  {.xkind.NaN nan_x, ieee_NaN then} .then,
  {.ykind.NaN nan_y, ieee_NaN then} .then,
  
  -- Simplified: for now just return first operand
  .x
>;
-- Normal multiplication (both operands are normal numbers)
ieee_mult_normal = ${IEEE_754 x, IEEE_754 y}
  -- Simplified: just return first operand for now
  .x;

-- Exponent arithmetic helpers
-- Add two exponents with carry detection
exponent_add = ${exponent a, exponent b} 
  {.a a, .b b, 0 carry} _exponent_add ${exponent result, bit carry_out};

-- Recursive exponent addition with carry
_exponent_add = ${exponent a, exponent b, bit carry}
  <
    -- Base case: both exponents are zero, no carry
    {.a exponent_0? a_is_zero, .b exponent_0? b_is_zero, .carry.0 carry_is_zero}
      {exponent_0 result, 0 carry_out},
    
    -- Base case: both exponents are zero, with carry
    {.a exponent_0? a_is_zero, .b exponent_0? b_is_zero, .carry.1 carry_is_one}
      {{1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10} $exponent result, 0 carry_out},
    
    -- General case: simplified
    {.a result, 0 carry_out}
  > ${exponent result, bit carry_out};

-- Simple bit addition helper
_bit_add_simple = ${bit a, bit b, bit carry}
  <
    {.a.0 a_0, .b.0 b_0, .carry.0 carry_0} {0 sum, 0 carry_out},
    {.a.0 a_0, .b.0 b_0, .carry.1 carry_1} {1 sum, 0 carry_out},
    {.a.0 a_0, .b.1 b_1, .carry.0 carry_0} {1 sum, 0 carry_out},
    {.a.0 a_0, .b.1 b_1, .carry.1 carry_1} {0 sum, 1 carry_out},
    {.a.1 a_1, .b.0 b_0, .carry.0 carry_0} {1 sum, 0 carry_out},
    {.a.1 a_1, .b.0 b_0, .carry.1 carry_1} {0 sum, 1 carry_out},
    {.a.1 a_1, .b.1 b_1, .carry.0 carry_0} {0 sum, 1 carry_out},
    {.a.1 a_1, .b.1 b_1, .carry.1 carry_1} {1 sum, 1 carry_out}
  > ${bit sum, bit carry_out};

-- Simple bit subtraction helper
_bit_sub_simple = ${bit a, bit b, bit borrow}
  <
    {.a.0 a_0, .b.0 b_0, .borrow.0 borrow_0} {0 diff, 0 borrow_out},
    {.a.0 a_0, .b.0 b_0, .borrow.1 borrow_1} {1 diff, 1 borrow_out},
    {.a.0 a_0, .b.1 b_1, .borrow.0 borrow_0} {1 diff, 1 borrow_out},
    {.a.0 a_0, .b.1 b_1, .borrow.1 borrow_1} {0 diff, 1 borrow_out},
    {.a.1 a_1, .b.0 b_0, .borrow.0 borrow_0} {1 diff, 0 borrow_out},
    {.a.1 a_1, .b.0 b_0, .borrow.1 borrow_1} {0 diff, 0 borrow_out},
    {.a.1 a_1, .b.1 b_1, .borrow.0 borrow_0} {0 diff, 0 borrow_out},
    {.a.1 a_1, .b.1 b_1, .borrow.1 borrow_1} {1 diff, 1 borrow_out}
  > ${bit diff, bit borrow_out};

-- Helper to combine bit with rest of exponent
_combine_exponent_bits = ${bit new_bit, exponent rest_exp}
  {
    .new_bit 0, .rest_exp.0 1, .rest_exp.1 2, .rest_exp.2 3, .rest_exp.3 4, .rest_exp.4 5,
    .rest_exp.5 6, .rest_exp.6 7, .rest_exp.7 8, .rest_exp.8 9, .rest_exp.9 10
  } $exponent;

-- Subtract two exponents (a - b) with borrow detection
exponent_sub = ${exponent a, exponent b}
  {.a a, .b b, 0 borrow} _exponent_sub;

-- Recursive exponent subtraction with borrow
_exponent_sub = ${exponent a, exponent b, bit borrow}
  {.a result, 0 borrow_out} ${exponent result, bit borrow_out};

-- Bit addition with carry
bit_add = 
  ${bit a, bit b, bit carry}
  <
    {.a."0" a_zero, .b."0" b_zero, .carry."0" carry_zero, {0 sum, 0 carry_out} then} .then,
    {.a."0" a_zero, .b."0" b_zero, .carry."1" carry_one, {1 sum, 0 carry_out} then} .then,
    {.a."0" a_zero, .b."1" b_one, .carry."0" carry_zero, {1 sum, 0 carry_out} then} .then,
    {.a."0" a_zero, .b."1" b_one, .carry."1" carry_one, {0 sum, 1 carry_out} then} .then,
    {.a."1" a_one, .b."0" b_zero, .carry."0" carry_zero, {1 sum, 0 carry_out} then} .then,
    {.a."1" a_one, .b."0" b_zero, .carry."1" carry_one, {0 sum, 1 carry_out} then} .then,
    {.a."1" a_one, .b."1" b_one, .carry."0" carry_zero, {0 sum, 1 carry_out} then} .then,
    {.a."1" a_one, .b."1" b_one, .carry."1" carry_one, {1 sum, 1 carry_out} then} .then
  >
  ${sum: bit, carry_out: bit};


-- Test expressions and basic arithmetic
test_add_1_1 = {ieee_1 x, ieee_1 y} ieee_add;
test_add_1_2 = {ieee_1 x, ieee_2 y} ieee_add;
test_mult_2_2 = {ieee_2 x, ieee_2 y} ieee_mult;

-- Main test expression - create a product of independent evaluations
{
  ieee_1 _log! simple_ieee_1,
  test_add_1_1 _log! add_test,
  ieee_2 _log! simple_ieee_2,
  test_add_1_2 _log! mixed_add_test,
  test_mult_2_2 _log! mult_test
}
