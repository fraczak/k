-- Enhanced Binary Natural Numbers with Literal Notation DSL
-- This file demonstrates how bnat.k could be extended with human-friendly literals

$ bnat = < {} _, bnat 0, bnat 1 >;

-- Core bnat definitions (from original bnat.k)
_ = {{} _};
_1 = {() 1};
_0 = {() 0};

bnat_0  = _ $bnat;
bnat_1  = _ _1 $bnat;
bnat_2  = _ _0 _1 $bnat;
bnat_3  = _ _1 _1 $bnat;
bnat_4  = _ _0 _0 _1 $bnat;
bnat_5  = _ _1 _0 _1 $bnat;
bnat_6  = _ _0 _1 _1 $bnat;
bnat_7  = _ _1 _1 _1 $bnat;
bnat_8  = _ _0 _0 _0 _1 $bnat;
bnat_9  = _ _1 _0 _0 _1 $bnat;
bnat_10 = _ _0 _1 _0 _1 $bnat;

-- Helper functions for string manipulation
$ string_list = [ @string ];
empty_string = "";
head = .0;
tail = .1_to_end;
empty? = .length bnat_0 eq?;

-- Character to bnat conversion
char_to_digit = $@string
<
  -"0" bnat_0,
  -"1" bnat_1,
  -"2" bnat_2,
  -"3" bnat_3,
  -"4" bnat_4,
  -"5" bnat_5,
  -"6" bnat_6,
  -"7" bnat_7,
  -"8" bnat_8,
  -"9" bnat_9
>;

digit_to_char = $bnat
<
  ._ "0",
  .1._ "1", 
  .0.1._ "2",
  .1.1._ "3",
  .0.0.1._ "4",
  .1.0.1._ "5",
  .0.1.1._ "6",
  .1.1.1._ "7",
  .0.0.0.1._ "8",
  .1.0.0.1._ "9"
>;

-- Literal notation definitions using @literal syntax
@literal bnat {
  patterns: [
    "\\d+",           -- Decimal: 123, 0, 999
    "0b[01]+",        -- Binary: 0b1010, 0b0, 0b11111
    "0x[0-9a-fA-F]+", -- Hex: 0xFF, 0x0, 0x1A2B  
    "0o[0-7]+"        -- Octal: 0o777, 0o0, 0o123
  ],
  parsers: [
    parse_decimal,
    parse_binary, 
    parse_hex,
    parse_octal
  ],
  formatter: format_decimal
};

-- Decimal parser: converts "123" -> bnat
parse_decimal = $@string 
  {() digits, bnat_0 result} 
  _parse_decimal_loop;

_parse_decimal_loop = 
  ${@string digits, bnat result}
  <
    {.digits empty? if, .result then} .then,
    {
      .digits head char_to_digit digit,
      .digits tail digits,
      {.result x, bnat_10 y} times result
    }
    {.result x, .digit y} plus
    {() digits, () result} _parse_decimal_loop
  >;

-- Binary parser: converts "0b1010" -> bnat  
parse_binary = $@string
  -"0b"             -- remove "0b" prefix
  {() digits, bnat_0 result}
  _parse_binary_loop;

_parse_binary_loop =
  ${@string digits, bnat result} 
  <
    {.digits empty? if, .result then} .then,
    {
      .digits head digit,
      .digits tail digits, 
      .result append_0 result      -- shift left
    }
    {
      .digit -"0" bnat_0,
      .digit -"1" bnat_1
    }
    {.result x, () y} plus
    {() digits, () result} _parse_binary_loop
  >;

-- Hex parser: converts "0xFF" -> bnat
parse_hex = $@string
  -"0x"             -- remove "0x" prefix
  {() digits, bnat_0 result}
  _parse_hex_loop;

_parse_hex_loop =
  ${@string digits, bnat result}
  <
    {.digits empty? if, .result then} .then,
    {
      .digits head hex_char_to_digit digit,
      .digits tail digits,
      .result {() x, bnat_16 y} times result
    }
    {.result x, .digit y} plus 
    {() digits, () result} _parse_hex_loop
  >;

hex_char_to_digit = $@string
<
  -"0" bnat_0, -"1" bnat_1, -"2" bnat_2, -"3" bnat_3, -"4" bnat_4,
  -"5" bnat_5, -"6" bnat_6, -"7" bnat_7, -"8" bnat_8, -"9" bnat_9,
  -"a" bnat_10, -"b" bnat_11, -"c" bnat_12, -"d" bnat_13, -"e" bnat_14, -"f" bnat_15,
  -"A" bnat_10, -"B" bnat_11, -"C" bnat_12, -"D" bnat_13, -"E" bnat_14, -"F" bnat_15
>;

-- Octal parser: converts "0o777" -> bnat
parse_octal = $@string
  -"0o"             -- remove "0o" prefix  
  {() digits, bnat_0 result}
  _parse_octal_loop;

_parse_octal_loop = 
  ${@string digits, bnat result}
  <
    {.digits empty? if, .result then} .then,
    {
      .digits head char_to_digit digit,
      .digits tail digits,
      .result {() x, bnat_8 y} times result
    }
    {.result x, .digit y} plus
    {() digits, () result} _parse_octal_loop  
  >;

-- Formatter: converts bnat -> "123"
format_decimal = $bnat
  <
    ._ "0",                    -- special case for zero
    {() n, "" acc} _format_decimal_loop
  >;

_format_decimal_loop =
  ${bnat n, @string acc}
  <
    {.n zero? if, .acc then} .then,
    {
      .n {() x, bnat_10 y} div div_result,
      .div_result.rem digit_to_char digit
    }
    {.digit x, .acc y} concat
    {.div_result.div n, () acc} _format_decimal_loop
  >;

-- Additional required constants  
bnat_16 = _ _0 _0 _0 _0 _1 $bnat;  -- 16 in binary
bnat_8  = _ _0 _0 _0 _1 $bnat;     -- 8 in binary
bnat_11 = _ _1 _1 _0 _1 $bnat;     -- 11 in binary  
bnat_12 = _ _0 _0 _1 _1 $bnat;     -- 12 in binary
bnat_13 = _ _1 _0 _1 _1 $bnat;     -- 13 in binary
bnat_14 = _ _0 _1 _1 _1 $bnat;     -- 14 in binary
bnat_15 = _ _1 _1 _1 _1 $bnat;     -- 15 in binary

-- Examples of usage (after DSL integration):
-- 
-- ten = 10;                    -- Instead of: bnat_10
-- binary_ten = 0b1010;         -- Same as: bnat_10  
-- hex_ten = 0xA;               -- Same as: bnat_10
-- octal_ten = 0o12;            -- Same as: bnat_10
--
-- -- All of these would be equivalent:
-- result = {10 x, 0b1010 y} plus;     -- 10 + 10 = 20
-- result = {0xA x, 0o12 y} plus;      -- 10 + 10 = 20
--
-- -- The formatter would convert back:  
-- format_decimal result;       -- Returns: "20"

()