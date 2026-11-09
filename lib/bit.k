-- lib/bit.k — Finite enumeration patterns: bit[], bool[], order[]

---------------------------------------------------------------
-- §1. Bit
---------------------------------------------------------------

bit[] = < {} 0, {} 1 >;

-- Primitive constructors and destructors
0   = {} |0 ?bit[];
1   = {} |1 ?bit[];
is0 = ?bit[] /0;
is1 = ?bit[] /1;

-- Polymorphic tag guards
0? = ?X /0 |0 ?X;
1? = ?X /1 |1 ?X;

-- Bit operations and equality guard
not_bit = < is0 1, is1 0 >;
and_bit = < .x is0 0, .y is0 0, { .x is1 a, .y is1 b } 1 >;
or_bit  = < .x is1 1, .y is1 1, { .x is0 a, .y is0 b } 0 >;
xor_bit = <
  { .x is0 a, .y is0 b } 0,
  { .x is1 a, .y is1 b } 0,
  { .x is0 a, .y is1 b } 1,
  { .x is1 a, .y is0 b } 1
>;
eq_bit? = <
  { .x is0 0 x, .y is0 0 y },
  { .x is1 1 x, .y is1 1 y }
>;

---------------------------------------------------------------
-- §2. Bool
---------------------------------------------------------------

bool[] = < {} true, {} false >;

-- Primitive constructors and destructors
true     = {} |true ?bool[];
false    = {} |false ?bool[];
un_true  = ?bool[] /true;
un_false = ?bool[] /false;

-- Bool guards and negation
true?  = un_true true;
false? = un_false false;
not    = < un_true false, un_false true >;

---------------------------------------------------------------
-- §3. Order
---------------------------------------------------------------

order[] = < {} lt, {} eq, {} gt >;

-- Primitive constructors and destructors
lt    = {} |lt ?order[];
eq    = {} |eq ?order[];
gt    = {} |gt ?order[];
un_lt = ?order[] /lt;
un_eq = ?order[] /eq;
un_gt = ?order[] /gt;

-- Order guards
lt_order? = un_lt lt;
eq_order? = un_eq eq;
gt_order? = un_gt gt;
