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

exponent_0? = $exponent {{.0.0 0, .1.0 1, .2.0 2, .3.0 3, .4.0 4, .5.0 5, .6.0 6, .7.0 7, .8.0 8, .9.0 9, .10.0 10} if, () then } .then;

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

$ mantissa = {
  bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9,
  bit 10, bit 11, bit 12, bit 13, bit 14, bit 15, bit 16, bit 17, bit 18, bit 19,
  bit 20, bit 21, bit 22, bit 23, bit 24, bit 25, bit 26, bit 27, bit 28, bit 29,
  bit 30, bit 31, bit 32, bit 33, bit 34, bit 35, bit 36, bit 37, bit 38, bit 39,
  bit 40, bit 41, bit 42, bit 43, bit 44, bit 45, bit 46, bit 47, bit 48, bit 49,
  bit 50, bit 51
};

mantissa_0? = $ mantissa {
  { .0.0 0, .1.0 1, .2.0 2, .3.0 3, .4.0 4, .5.0 5, .6.0 6, .7.0 7, .8.0 8, .9.0 9, .10.0 10,
    .11.0 11, .12.0 12, .13.0 13, .14.0 14, .15.0 15, .16.0 16, .17.0 17, .18.0 18, .19.0 19, .20.0 20,
    .21.0 21, .22.0 22, .23.0 23, .24.0 24, .25.0 25, .26.0 26, .27.0 27, .28.0 28, .29.0 29, .30.0 30,
    .31.0 31, .32.0 32, .33.0 33, .34.0 34, .35.0 35, .36.0 36, .37.0 37, .38.0 38, .39.0 39, .40.0 40,
    .41.0 41, .42.0 42, .43.0 43, .44.0 44, .45.0 45, .46.0 46, .47.0 47, .48.0 48, .49.0 49, .50.0 50, .51.0 51 } if,
  () then
} .then;

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

decr_exponent = <
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

is2047 = $exponent {.0.1 0, .1.1 1, .2.1 2, .3.1 3, .4.1 4, .5.1 5, .6.1 6, .7.1 7, .8.1 8, .9.1 9, .10.1 10} {};

exponent_2047 = {1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} $exponent;

$ ieee_kind = < {} "+infty", {} "-infty", {} NaN, {} number >;
plus_infty = {{}  "+infty"};
minus_infty = {{} "-infty"};
NaN = {{} NaN};
number = {{} number};

ieee_kind = <
  { .exponent is2047 if, () then } .then
    < {.mantissa mantissa_0? if, .sign sign} .sign
      < ."+" plus_infty, minus_infty >,
      NaN
    >,
  number
>;

-- IEEE 754 representations
ieee_0 = {
  sign: sign_plus,
  exponent: {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10},
  mantissa: {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51}
};

ieee_0? = $ IEEE_754 {  
  .sign."+" sign_plus,
  .exponent exponent_0? exponent_zero,
  .mantissa mantissa_0? mantissa_zero,
  () then
} .then;

ieee_1 = {
  sign: sign_plus,
  exponent: {0 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10},
  mantissa: {0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19, 0 20, 
             0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40,
             0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51}
};

ieee_121 = {
  sign: sign_plus,
  exponent: {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 1 9, 0 10},
  mantissa: {1 0, 1 1, 1 2, 1 3, 0 4, 0 5, 1 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15,
    0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31,
    0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 
    0 48, 0 49, 0 50, 0 51 }
};
ieee_3 = {
  sign_plus sign,
  {0 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 0 9, 0 10} exponent,
  {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19,
   0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37,
   0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51} mantissa
};

ieee_one_third = {
  sign_plus sign,
  {0 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 0 8, 1 9, 1 10} exponent,
  {0 0, 1 1, 0 2, 1 3, 0 4, 1 5, 0 6, 1 7, 0 8, 1 9, 0 10, 1 11, 0 12, 1 13, 0 14, 1 15, 0 16, 1 17, 0 18, 1 19, 0 20, 1 21, 
   0 22, 1 23, 0 24, 1 25, 0 26, 1 27, 0 28, 1 29, 0 30, 1 31, 0 32, 1 33, 0 34, 1 35, 0 36, 1 37, 0 38, 1 39, 0 40, 1 41, 
   0 42, 1 43, 0 44, 1 45, 0 46, 1 47, 0 48, 1 49, 0 50, 1 51} mantissa
};

ieee_10 = {
  sign_plus sign,
  {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 1 8, 0 9, 0 10} exponent,
  {0 0, 1 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51} mantissa
};

ieee_100 = {
  sign_plus sign,
  {1 0, 0 1, 0 2, 0 3, 0 4, 0 5, 1 6, 0 7, 1 8, 0 9, 0 10} exponent,
  {1 0, 0 1, 0 2, 1 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10, 0 11, 0 12, 0 13, 0 14, 0 15, 0 16, 0 17, 0 18, 0 19, 0 20, 0 21, 0 22, 0 23, 0 24, 0 25, 0 26, 0 27, 0 28, 0 29, 0 30, 0 31, 0 32, 0 33, 0 34, 0 35, 0 36, 0 37, 0 38, 0 39, 0 40, 0 41, 0 42, 0 43, 0 44, 0 45, 0 46, 0 47, 0 48, 0 49, 0 50, 0 51} mantissa
};
-- Hardware floating-point operations

-- Sign operations
ieee_abs = $IEEE_754 {sign_plus sign, .exponent exponent, .mantissa mantissa};
ieee_neg = $IEEE_754 <
  {.sign."-" if, {sign_plus sign, .exponent exponent, .mantissa mantissa } then} .then,
  ieee_0?,
  {sign_plus sign, .exponent exponent, .mantissa mantissa}
>;

copysign = ${IEEE_754 0, IEEE_754 1} {.0.sign sign, .1.exponent exponent, .1.mantissa mantissa};

-- Classification

ieee_inf? = {
  ieee_kind <.plus_infty, .minus_infty> if,
  () then
} .then;

ieee_nan? = {
  ieee_kind .NaN if,
  () then
} .then;

ieee_eq = ${IEEE_754 0, IEEE_754 1} {
  {.0.sign 0, .1.sign 1} sign_eq sign_eq,
  {.0.exponent 0, .1.exponent 1} exponent_eq exponent_eq,
  {.0.mantissa 0, .1.mantissa 1} mantissa_eq mantissa_eq,
  .0 then
} .then;
-- IEEE 754 Addition Algorithm (Full Implementation)

-- Extended mantissa with guard, round, sticky bits
$ ext_mantissa = {
  bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7, bit 8, bit 9,
  bit 10, bit 11, bit 12, bit 13, bit 14, bit 15, bit 16, bit 17, bit 18, bit 19,
  bit 20, bit 21, bit 22, bit 23, bit 24, bit 25, bit 26, bit 27, bit 28, bit 29,
  bit 30, bit 31, bit 32, bit 33, bit 34, bit 35, bit 36, bit 37, bit 38, bit 39,
  bit 40, bit 41, bit 42, bit 43, bit 44, bit 45, bit 46, bit 47, bit 48, bit 49,
  bit 50, bit 51, bit 52, bit 53, bit 54  -- guard, round, sticky
};

-- Mantissa addition with carry
mantissa_add = ${ext_mantissa a, ext_mantissa b} <
  -- Full 55-bit adder implementation would go here
  -- For brevity, showing structure only
  .a  -- Placeholder
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
-- Hardware-style parallel FPU operations using K products

-- Parallel field extraction (1 cycle in hardware)
ieee_decode = $IEEE_754 {
  .sign sign_field,
  .exponent exp_field, 
  .mantissa mant_field,
  ieee_kind kind_field,
  ieee_nan? nan_check,
  ieee_inf? inf_check,
  ieee_0? zero_check
};

-- Parallel comparison (1 cycle in hardware)
ieee_compare = ${IEEE_754 a, IEEE_754 b} {
  {.a.sign 0, .b.sign 1} sign_eq sign_same,
  {.a.exponent bigger, .b.exponent smaller} exponent_gt? exp_gt,
  {.a.mantissa bigger, .b.mantissa smaller} mantissa_gt? mant_gt,
  {.a ieee_decode, .b ieee_decode} decode_both
};

-- Parallel mantissa alignment (1 cycle with barrel shifter)
mantissa_align = ${IEEE_754 larger, IEEE_754 smaller, int shift_amount} {
  .larger.mantissa larger_mant,
  .smaller.mantissa smaller_mant,
  {.smaller.mantissa mant, .shift_amount n} shift_right aligned_mant,
  .shift_amount exp_diff
};

-- Parallel addition pipeline stage (1 cycle)
add_stage = ${ext_mantissa a, ext_mantissa b, sign result_sign} {
  {.a mant_a, .b mant_b} mantissa_add sum,
  .sum normalize norm_result,
  .norm_result.shift_count leading_zeros,
  .result_sign final_sign
};

-- Complete parallel FPU add (3-4 cycles total)
ieee_add_parallel = ${IEEE_754 a, IEEE_754 b} <
  -- Cycle 1: Decode and compare in parallel
  {
    .a ieee_decode decode_a,
    .b ieee_decode decode_b,
    {.a a_val, .b b_val} ieee_compare comparison
  } stage1,
  
  -- Handle special cases
  .stage1.decode_a.nan_check,
  .stage1.decode_b.nan_check,
  
  -- Cycle 2: Align mantissas in parallel
  {
    .stage1.comparison.exp_gt exp_diff,
    {.a larger, .b smaller, .exp_diff shift} mantissa_align alignment
  } stage2,
  
  -- Cycle 3: Add and normalize in parallel
  {
    .stage2.alignment.larger_mant mant_a,
    .stage2.alignment.aligned_mant mant_b,
    .stage1.comparison.sign_same result_sign
  } add_stage stage3,
  
  -- Cycle 4: Pack result
  {
    .stage3.final_sign sign,
    .stage3.norm_result.exponent exponent,
    .stage3.norm_result.mantissa mantissa
  }
>;