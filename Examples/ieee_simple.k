-- IEEE 754 Double Precision Floating-Point Format (Simplified Version)

$ bit = <{} 0, {} 1>;

0 = {{} 0};
1 = {{} 1};

$ sign = < {} "+", {} "-" >;
sign_plus = {{} "+"};
sign_minus = {{} "-"};

$ exponent = {
  bit 0, bit 1, bit 2, bit 3, bit 4, bit 5,
  bit 6, bit 7, bit 8, bit 9, bit 10
};

exponent_0 = {
  0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7, 0 8, 0 9, 0 10
} $exponent;

exponent_bias = {0 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7, 1 8, 1 9, 1 10} $exponent; 
exponent_1023 = exponent_bias;

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

$ IEEE_754 = {
  sign sign,
  exponent exponent,
  mantissa mantissa
};

-- IEEE 754 representations for basic values
ieee_0 = {
  sign: sign_plus,
  exponent: exponent_0,
  mantissa: mantissa_0
};

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

-- Simple sign operations
ieee_abs = $IEEE_754 {sign_plus sign, .exponent exponent, .mantissa mantissa};
ieee_neg = $IEEE_754 <
  {sign_minus sign, .exponent exponent, .mantissa mantissa},
  {sign_plus sign, .exponent exponent, .mantissa mantissa}
>;

-- Simple addition (placeholder - just returns first operand for now)
ieee_add_simple = ${IEEE_754 x, IEEE_754 y} .x;

-- Simple multiplication (placeholder - just returns first operand for now)  
ieee_mult_simple = ${IEEE_754 x, IEEE_754 y} .x;

-- Test expressions
simple_test = {
  ieee_0 _log! zero_value,
  ieee_1 _log! one_value,
  ieee_2 _log! two_value,
  ieee_4 _log! four_value
};

-- Basic arithmetic tests
arithmetic_test = {
  {ieee_1 x, ieee_1 y} ieee_add_simple _log! add_1_1,
  {ieee_2 x, ieee_1 y} ieee_add_simple _log! add_2_1,
  {ieee_1 x, ieee_2 y} ieee_mult_simple _log! mult_1_2
};