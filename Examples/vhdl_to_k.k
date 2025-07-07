-- VHDL to K Translation Patterns

-- VHDL: signal a : std_logic;
-- K:    $ bit = <{} 0, {} 1>;

-- VHDL: signal bus : std_logic_vector(7 downto 0);
-- K:    $ byte = {bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7};

-- VHDL: entity adder is port(a,b: in std_logic; sum: out std_logic); end;
-- K:    adder = ${bit a, bit b} {.a a_out, .b b_out, xor_gate sum_out};

-- VHDL: process(clk) begin if rising_edge(clk) then q <= d; end if; end;
-- K:    dff = $bit .;  -- Identity (register holds value)

-- VHDL: y <= a and b;
-- K:    and_gate = ${bit a, bit b} <{.a.1 1, .b.1 1, 1}, 0>;

-- VHDL: y <= a or b;  
-- K:    or_gate = ${bit a, bit b} <{.a.0 0, .b.0 0, 0}, 1>;

-- VHDL: y <= not a;
-- K:    not_gate = $bit <{.0 0, 1}, {.1 1, 0}>;

-- VHDL: with sel select y <= a when "00", b when "01", c when others;
-- K:    mux = ${bit sel0, bit sel1, bit a, bit b, bit c} <
--             {.sel0.0 0, .sel1.0 0, .a},
--             {.sel0.1 1, .sel1.0 0, .b}, 
--             .c>;

-- VHDL: architecture of 4-bit adder
four_bit_adder = ${
  {bit 0, bit 1, bit 2, bit 3} a,
  {bit 0, bit 1, bit 2, bit 3} b
} {
  {.a.0 a0, .b.0 b0} full_adder fa0,
  {.a.1 a1, .b.1 b1, .fa0.carry c_in} full_adder fa1,
  {.a.2 a2, .b.2 b2, .fa1.carry c_in} full_adder fa2,
  {.a.3 a3, .b.3 b3, .fa2.carry c_in} full_adder fa3,
  {.fa0.sum 0, .fa1.sum 1, .fa2.sum 2, .fa3.sum 3} sum,
  .fa3.carry overflow
};

-- VHDL: Full adder component
full_adder = ${bit a, bit b, bit c_in} {
  {.a a_val, .b b_val} xor_gate ab_xor,
  {.ab_xor xor_val, .c_in c_val} xor_gate sum,
  {.a a_val, .b b_val} and_gate ab_and,
  {.ab_xor xor_val, .c_in c_val} and_gate xor_cin_and,
  {.ab_and and1, .xor_cin_and and2} or_gate carry
};