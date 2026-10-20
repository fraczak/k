-- VHDL to K Translation Patterns

-- VHDL: signal a : std_logic;
-- K:    bit[] = < {} 0, {} 1 >;
bit[] = < {} 0, {} 1 >;

-- VHDL: signal bus : std_logic_vector(7 downto 0);
-- K:    byte[] = {
--         bit[] 0, bit[] 1, bit[] 2, bit[] 3,
--         bit[] 4, bit[] 5, bit[] 6, bit[] 7
--       };
byte[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6, bit[] 7
};

nibble[] = { bit[] 0, bit[] 1, bit[] 2, bit[] 3 };

0 = {} | 0;
1 = {} | 1;

-- VHDL: y <= not a;
not_bit = < /0 1, /1 0 >;

-- VHDL: y <= a and b;
and_bit = < .x/0 0, .y/0 0, 1 >;

-- VHDL: y <= a or b;
or_bit = < .x/1 1, .y/1 1, 0 >;

-- VHDL: y <= a xor b;
xor_bit = < {.x/0 if, .y then} .then, .y not_bit >;
xor_abc = {{.a x, .b y} xor_bit x, .c y} xor_bit;

-- VHDL: Full adder component
full_adder = ?{ bit[] a, bit[] b, bit[] c_in } {
  {.a a, .b b, .c_in c} xor_abc sum,
  {
    {.a x, .b y} and_bit x,
    {{.a x, .b y} xor_bit x, .c_in y} and_bit y
  } or_bit carry
};

-- VHDL: architecture of 4-bit adder
four_bit_adder = ?{ nibble[] a, nibble[] b } {
  .a a, .b b,
  {.a.0 a, .b.0 b, 0 c_in} full_adder fa0
} {
  .a a, .b b, .fa0 fa0,
  {.a.1 a, .b.1 b, .fa0.carry c_in} full_adder fa1
} {
  .a a, .b b, .fa0 fa0, .fa1 fa1,
  {.a.2 a, .b.2 b, .fa1.carry c_in} full_adder fa2
} {
  .fa0 fa0, .fa1 fa1, .fa2 fa2,
  {.a.3 a, .b.3 b, .fa2.carry c_in} full_adder fa3
} {
  {.fa0.sum 0, .fa1.sum 1, .fa2.sum 2, .fa3.sum 3} sum,
  .fa3.carry overflow
};

()
