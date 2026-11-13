-- =============================================================================
-- lib/integer.k -- Signed Arbitrary-Precision Integer Arithmetic
--
-- Self-contained module (zero dependencies) representing arbitrary-precision
-- signed integers using canonical sign-magnitude representation:
--   int[] = < bits[] "+", bits[] "-" >
--
-- Canonical invariants & style conventions:
--   * Public bits[] values store MSB at the root and '_' at the leaf.
--   * No redundant leading zero bits except canonical zero: + (_ |0).
--   * Zero is always normalized to '+'; there is no negative zero.
--   * Relations ending in '?' are pure identity filters (?X -> ?X).
--   * All recursive relations are tail-recursive.
--   * Internal helpers are prefixed with '_' and follow their primary relation;
--     discarded product fields are prefixed with '_' (e.g. _x, _ord).
--
-- Internal unsigned addition, subtraction, multiplication (Karatsuba), and
-- binary long division operate on trimmed LSB-first bit sequences ('_' = 0),
-- converting at the boundary so multi-limb arithmetic avoids reversal inside
-- recursion.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Core Types, Constants, Normalization, and Predicates
-- -----------------------------------------------------------------------------

bit[] = < {} 0, {} 1 >;
bits[] = < {} _, B 0, B 1 > = B;

order[] = < {} lt, {} eq, {} gt >;

int[] = < bits[] "+", bits[] "-" >;

0 = {} |_ |0 |+;
1 = {} |_ |1 |+;

-- Strips redundant leading '0' tags while keeping at least one bit for zero (_ |0).
trim_bits = ?bits[] <
  /_ |_ |0,
  /1 |1,
  /0 /_ |_ |0,
  /0 trim_bits
> ?bits[];

-- Drops all leading '0' tags (canonical zero becomes empty '_').
msb_drop_zeros = ?bits[] <
  /_ |_,
  /1 |1,
  /0 msb_drop_zeros
> ?bits[];

-- Lifts unsigned bits[] magnitude (MSB at root, '_' at leaf) to canonical non-negative int[].
nat = ?bits[] trim_bits |+ ?int[];

-- Canonicalizes a signed int[] (strips leading zeros and normalizes -0 to +0).
int = ?int[] <
  /+ trim_bits |+,
  /- trim_bits <
    /0 /_ |_ |0 |+,
    /1 |1 |-
  >
> ?int[];

-- Identity filters (succeed unchanged on matching values, fail otherwise).
zero? = int { /+ /0 /_ _x, () x } .x ?int[];
pos?  = int /+ /1 |1 |+ ?int[];
neg?  = int /- |- ?int[];

-- Unsigned normalization to/from internal trimmed LSB-first bits[] ('_' = 0).
rev_bits = ?bits[] { () in, {} |_ acc } _rev_bits ?bits[];
_rev_bits = ?{ bits[] in, bits[] acc } <
  { .in /_ _in, .acc acc } .acc,
  <
    { .in /0 in, .acc |0 acc },
    { .in /1 in, .acc |1 acc }
  > _rev_bits
> ?bits[];

lsb_trim   = ?bits[] rev_bits msb_drop_zeros rev_bits ?bits[];
msb_to_lsb = ?bits[] msb_drop_zeros rev_bits ?bits[];
lsb_to_msb = ?bits[] rev_bits trim_bits ?bits[];


-- -----------------------------------------------------------------------------
-- 2. Magnitude Comparison & Bit-Shift Helpers
-- -----------------------------------------------------------------------------

-- Single-pass MSB-first comparison of two canonical trimmed bits[] values.
-- Accumulates first differing bit as `ord`; longer length strictly wins.
cmp_msb = ?{ bits[] x, bits[] y } { .x x, .y y, {} |eq ord } _cmp_msb ?order[];
_cmp_msb = ?{ bits[] x, bits[] y, order[] ord } <
  { .x /_ _x, .y /_ _y, .ord ord } .ord,
  .x /_ |lt,
  .y /_ |gt,
  <
    { .x /0 x, .y /0 y, .ord ord },
    { .x /1 x, .y /1 y, .ord ord },
    { .x /0 x, .y /1 y, .ord </eq |lt, ()> ord },
    { .x /1 x, .y /0 y, .ord </eq |gt, ()> ord }
  > _cmp_msb
> ?order[];

-- Shifts a trimmed LSB-first bits[] left by 1 bit or by a tally `k`.
lsb_shl1 = ?bits[] < /_ |_, /0 |0 |0, /1 |1 |0 > ?bits[];

lsb_shl = ?{ bits[] x, bits[] k } <
  { .x /_ _x, .k _k } {} |_,
  { .x < /0 |0, /1 |1 > x, .k /_ _k } .x,
  { .x < /0 |0, /1 |1 > x, .k < /0, /1 > k } { .x |0 x, .k k } lsb_shl
> ?bits[];


-- -----------------------------------------------------------------------------
-- 3. Unsigned LSB Addition & Subtraction
-- -----------------------------------------------------------------------------

lsb_add = ?{ bits[] x, bits[] y } {
  .x x, .y y, {} |0 c, {} |_ acc
} _lsb_add msb_drop_zeros rev_bits ?bits[];

-- Tail-recursive ripple-carry addition accumulating MSB-first in `acc`.
_lsb_add = ?{ bits[] x, bits[] y, bit[] c, bits[] acc } <
  { .x /_ _x, .y /_ _y, .c /0 _c, .acc acc } .acc,
  { .x /_ _x, .y /_ _y, .c /1 _c, .acc acc } .acc |1,
  { .x /_ _x, .y < /0 |0, /1 |1 > y, .c /0 _c, .acc acc }
    { .y in, .acc acc } _rev_bits,
  { .x < /0 |0, /1 |1 > x, .y /_ _y, .c /0 _c, .acc acc }
    { .x in, .acc acc } _rev_bits,
  { .x _pop_lsb_bit px, .y _pop_lsb_bit py, .c c, .acc acc } {
    .px .rest x,
    .py .rest y,
    { .px .b a, .py .b b, .c c } _full_add_bit s,
    .acc acc
  } {
    .x x,
    .y y,
    .s .carry c,
    { .s .sum b, .acc acc } _push_bit_acc acc
  } _lsb_add
> ?bits[];

_full_add_bit = ?{ bit[] a, bit[] b, bit[] c } <
  { .a /0 _a, .b /0 _b, .c /0 _c } { {} |0 sum, {} |0 carry },
  { .a /0 _a, .b /0 _b, .c /1 _c } { {} |1 sum, {} |0 carry },
  { .a /0 _a, .b /1 _b, .c /0 _c } { {} |1 sum, {} |0 carry },
  { .a /0 _a, .b /1 _b, .c /1 _c } { {} |0 sum, {} |1 carry },
  { .a /1 _a, .b /0 _b, .c /0 _c } { {} |1 sum, {} |0 carry },
  { .a /1 _a, .b /0 _b, .c /1 _c } { {} |0 sum, {} |1 carry },
  { .a /1 _a, .b /1 _b, .c /0 _c } { {} |0 sum, {} |1 carry },
  { .a /1 _a, .b /1 _b, .c /1 _c } { {} |1 sum, {} |1 carry }
> ?{ bit[] sum, bit[] carry };

-- Subtracts y from x assuming x >= y (fails if underflow occurs).
lsb_sub = ?{ bits[] x, bits[] y }
  { .x x, .y y, {} |0 b, {} |_ acc } _lsb_sub { .b /0 _b, .r r } .r ?bits[];

-- Tries x - y: returns { b: 0, r: x - y } if x >= y, or { b: 1, r: _ } if x < y.
lsb_try_sub = ?{ bits[] x, bits[] y }
  { .x x, .y y, {} |0 b, {} |_ acc } _lsb_sub ?{ bit[] b, bits[] r };

-- Tail-recursive ripple-borrow subtraction on trimmed LSB-first bits[].
-- Short-circuits immediately with borrow=1 when x reaches '_' before non-empty y or borrow=1.
_lsb_sub = ?{ bits[] x, bits[] y, bit[] b, bits[] acc } <
  { .x /_ _x, .y /_ _y, .b /0 _b, .acc acc }
    { {} |0 b, .acc msb_drop_zeros rev_bits r },
  .x /_ { {} |1 b, {} |_ r },
  { .x < /0 |0, /1 |1 > x, .y /_ _y, .b /0 _b, .acc acc } {
    {} |0 b,
    { .x in, .acc acc } _rev_bits msb_drop_zeros rev_bits r
  },
  { .x < /0 |0, /1 |1 > _pop_lsb_bit px, .y _pop_lsb_bit py, .b b, .acc acc } {
    .px .rest x,
    .py .rest y,
    { .px .b a, .py .b b, .b c } _full_sub_bit s,
    .acc acc
  } {
    .x x,
    .y y,
    .s .borrow b,
    { .s .diff b, .acc acc } _push_bit_acc acc
  } _lsb_sub
> ?{ bit[] b, bits[] r };

_full_sub_bit = ?{ bit[] a, bit[] b, bit[] c } <
  { .a /0 _a, .b /0 _b, .c /0 _c } { {} |0 diff, {} |0 borrow },
  { .a /0 _a, .b /0 _b, .c /1 _c } { {} |1 diff, {} |1 borrow },
  { .a /0 _a, .b /1 _b, .c /0 _c } { {} |1 diff, {} |1 borrow },
  { .a /0 _a, .b /1 _b, .c /1 _c } { {} |0 diff, {} |1 borrow },
  { .a /1 _a, .b /0 _b, .c /0 _c } { {} |1 diff, {} |0 borrow },
  { .a /1 _a, .b /0 _b, .c /1 _c } { {} |0 diff, {} |0 borrow },
  { .a /1 _a, .b /1 _b, .c /0 _c } { {} |0 diff, {} |0 borrow },
  { .a /1 _a, .b /1 _b, .c /1 _c } { {} |1 diff, {} |1 borrow }
> ?{ bit[] diff, bit[] borrow };

_pop_lsb_bit = ?bits[] <
  /_ { {} |0 b, {} |_ rest },
  /0 { {} |0 b, () rest },
  /1 { {} |1 b, () rest }
> ?{ bit[] b, bits[] rest };

_push_bit_acc = ?{ bit[] b, bits[] acc } <
  { .b /0 _b, .acc acc } .acc |0,
  { .b /1 _b, .acc acc } .acc |1
> ?bits[];


-- -----------------------------------------------------------------------------
-- 4. Fast Multiplication (Karatsuba + Schoolbook Base Case)
-- -----------------------------------------------------------------------------
-- Algorithm: Karatsuba multiplication (Anatolii Karatsuba, 1960).
-- For operands above the 16-bit cutoff, each operand is split at half the
-- maximum bit-width `k`:
--   x = x1 * 2^k + x0,   y = y1 * 2^k + y0
-- Three recursive half-size products suffice:
--   z0 = x0 * y0
--   z2 = x1 * y1
--   z1 = (x0 + x1) * (y0 + y1) - z2 - z0
--   x * y = z0 + z1 * 2^k + z2 * 2^(2k)
-- Asymptotic complexity improves from O(n^2) to O(n^(log2 3)) ~= O(n^1.585),
-- while small or unbalanced operands with <= 16 bits use O(n) shift-and-add.

-- Unsigned Karatsuba multiplier on trimmed LSB-first bits[].
lsb_mul = ?{ bits[] x, bits[] y }
  { .x x, .y y, {} |nil stack } |eval _lsb_mul ?bits[];

-- Explicit continuation frames and state machine for tail-recursive Karatsuba.
_k_split[] = { bits[] lo, bits[] hi };

_k_frame[] = <
  { bits[] k, _k_split[] sx, _k_split[] sy } need_z2,
  { bits[] k, _k_split[] sx, _k_split[] sy, bits[] z0 } need_z3,
  { bits[] k, bits[] z0, bits[] z2 } combine
>;

_k_stack[] = < {} nil, { _k_frame[] car, S cdr } cons > = S;

_k_state[] = <
  { bits[] x, bits[] y, _k_stack[] stack } eval,
  { bits[] val, _k_stack[] stack } apply
>;

-- Tail-recursive explicit-stack Karatsuba step loop.
_lsb_mul = ?_k_state[] <
  /apply { .stack /nil _s, .val val } .val,
  <
    /eval _lsb_mul_eval,
    /apply { .val val, .stack /cons c } {
      .val val, .c .car frame, .c .cdr rest
    } _lsb_mul_apply
  > _lsb_mul
> ?bits[];

_lsb_mul_eval = ?{ bits[] x, bits[] y, _k_stack[] stack } {
  .x x,
  .y y,
  .stack stack,
  .x _classify_bits cx,
  .y _classify_bits cy
} <
  { .x _x, .y _y, .cx /zero _cx, .cy _cy, .stack stack }
    { {} |_ val, .stack stack } |apply,
  { .x _x, .y _y, .cx < /short, /long > _cx, .cy /zero _cy, .stack stack }
    { {} |_ val, .stack stack } |apply,
  { .x x, .y y, .cx /short _cx, .cy < /short, /long > _cy, .stack stack }
    { { .x iter, .y src, {} |_ acc } _lsb_mul_small val, .stack stack } |apply,
  { .x x, .y y, .cx /long _cx, .cy /short _cy, .stack stack }
    { { .y iter, .x src, {} |_ acc } _lsb_mul_small val, .stack stack } |apply,
  { .x x, .y y, .cx /long _cx, .cy /long _cy, .stack stack } {
    .x x,
    .y y,
    .stack stack,
    { .x x, .y y } half_max_tally k
  } {
    .k k,
    { .x x, .k k } lsb_split sx,
    { .y x, .k k } lsb_split sy,
    .stack stack
  } {
    .sx .lo x,
    .sy .lo y,
    { { .k k, .sx sx, .sy sy } |need_z2 car, .stack cdr } |cons stack
  } |eval
> ?_k_state[];

_lsb_mul_apply = ?{ bits[] val, _k_frame[] frame, _k_stack[] rest } <
  { .frame /need_z2 f, .val z0, .rest rest } {
    .f .sx .hi x,
    .f .sy .hi y,
    {
      { .f .k k, .f .sx sx, .f .sy sy, .z0 z0 } |need_z3 car,
      .rest cdr
    } |cons stack
  } |eval,
  { .frame /need_z3 f, .val z2, .rest rest } {
    { .f .sx .lo x, .f .sx .hi y } lsb_add x,
    { .f .sy .lo x, .f .sy .hi y } lsb_add y,
    {
      { .f .k k, .f .z0 z0, .z2 z2 } |combine car,
      .rest cdr
    } |cons stack
  } |eval,
  { .frame /combine f, .val z3, .rest rest } {
    { .f .k k, .f .z0 z0, .f .z2 z2, .z3 z3 } _karatsuba_combine val,
    .rest stack
  } |apply
> ?_k_state[];

_karatsuba_combine = ?{ bits[] k, bits[] z0, bits[] z2, bits[] z3 } {
  .z0 x,
  {
    { { { .z3 x, .z2 y } lsb_sub x, .z0 y } lsb_sub x, .k k } lsb_shl x,
    { { .z2 x, .k k } lsb_shl x, .k k } lsb_shl y
  } lsb_add y
} lsb_add ?bits[];

-- Base-case schoolbook shift-and-add over an operand of <= 16 bits.
_lsb_mul_small = ?{ bits[] iter, bits[] src, bits[] acc } <
  { .iter /_ _i, .src _s, .acc acc } .acc,
  { .iter < /0, /1 > _i, .src /_ _s, .acc acc } .acc,
  <
    { .iter /0 iter, .src < /0 |0, /1 |1 > src, .acc acc } {
      .iter iter,
      .src lsb_shl1 src,
      .acc acc
    },
    { .iter /1 iter, .src < /0 |0, /1 |1 > src, .acc acc } {
      .iter iter,
      .src lsb_shl1 src,
      { .acc x, .src y } lsb_add acc
    }
  > _lsb_mul_small
> ?bits[];

-- O(1) prefix classifier separating zero, <= 16 bits, and > 16 bits.
_classify_bits = <
  /_ {} |zero,
  /0 _drop16 < /_ {} |short, /0 {} |long, /1 {} |long >,
  /1 _drop16 < /_ {} |short, /0 {} |long, /1 {} |long >
>;
_drop16 = _drop4 _drop4 _drop4 _drop4;
_drop4  = _drop2 _drop2;
_drop2  = _drop1 _drop1;
_drop1  = < /_ |_, /0, /1 >;

-- Computes floor(max(|x|, |y|) / 2) as a zero-tally bits[] in one pass.
half_max_tally = ?{ bits[] x, bits[] y } {
  .x x, .y y, {} |_ acc
} _half_max_tally ?bits[];

_half_max_tally = ?{ bits[] x, bits[] y, bits[] acc } <
  { .x _le1_bit? _x, .y _le1_bit? _y, .acc acc } .acc,
  { .x x, .y y, .acc acc } { .x _drop2 x, .y _drop2 y, .acc |0 acc } _half_max_tally
> ?bits[];

-- Matches any bit-string of length <= 1 (base condition for _half_max_tally).
_le1_bit? = ?bits[] { < /_, /0 /_, /1 /_ > _b, () x } .x ?bits[];

-- Splits a trimmed LSB-first bits[] at tally `k` into { lo, hi }, preserving lsb_trim.
lsb_split = ?{ bits[] x, bits[] k } {
  .x x, .k k, {} |_ lo_rev
} _lsb_split ?{ bits[] lo, bits[] hi };

_lsb_split = ?{ bits[] x, bits[] k, bits[] lo_rev } <
  { .k /_ _k, .x x, .lo_rev lo_rev } {
    .lo_rev msb_drop_zeros rev_bits lo,
    .x hi
  },
  { .k < /0, /1 > _k, .x /_ _x, .lo_rev lo_rev } {
    .lo_rev msb_drop_zeros rev_bits lo,
    {} |_ hi
  },
  <
    { .x /0 x, .k < /0, /1 > k, .lo_rev lo_rev } { .x x, .k k, .lo_rev |0 lo_rev },
    { .x /1 x, .k < /0, /1 > k, .lo_rev lo_rev } { .x x, .k k, .lo_rev |1 lo_rev }
  > _lsb_split
> ?{ bits[] lo, bits[] hi };


-- -----------------------------------------------------------------------------
-- 5. Fast Binary Long Division (MSB-First Shift-and-Subtract)
-- -----------------------------------------------------------------------------

-- Unsigned quotient and remainder on canonical MSB bits[] (fails when y == 0).
nat_divmod = ?{ bits[] x, bits[] y } {
  .x trim_bits x,
  .y trim_bits msb_to_lsb < /0 |0, /1 |1 > y_lsb
} {
  .x x,
  .y_lsb y_lsb,
  {} |_ r_lsb,
  {} |_ q_rev
} _nat_divmod ?{ bits[] q, bits[] r };

_nat_divmod = ?{ bits[] x, bits[] y_lsb, bits[] r_lsb, bits[] q_rev } <
  { .x /_ _x, .y_lsb _y, .r_lsb r, .q_rev q } {
    .q lsb_to_msb q,
    .r lsb_to_msb r
  },
  <
    { .x /0 x_tail, .y_lsb y_lsb, .r_lsb r, .q_rev q_rev } {
      .x_tail x_tail,
      .y_lsb y_lsb,
      .r _lsb_push_0 r1,
      .q_rev q_rev
    },
    { .x /1 x_tail, .y_lsb y_lsb, .r_lsb r, .q_rev q_rev } {
      .x_tail x_tail,
      .y_lsb y_lsb,
      .r _lsb_push_1 r1,
      .q_rev q_rev
    }
  > {
    .x_tail x_tail,
    .y_lsb y_lsb,
    .r1 r1,
    .q_rev q_rev,
    { .r1 x, .y_lsb y } lsb_try_sub sub
  } <
    {
      .x_tail x,
      .y_lsb y_lsb,
      .r1 _r1,
      .q_rev q_rev,
      .sub .b /0 _b,
      .sub .r rem_next
    } {
      .x x,
      .y_lsb y_lsb,
      .rem_next r_lsb,
      .q_rev |1 q_rev
    },
    {
      .x_tail x,
      .y_lsb y_lsb,
      .r1 r1,
      .q_rev q_rev,
      .sub .b /1 _b,
      .sub .r _r
    } {
      .x x,
      .y_lsb y_lsb,
      .r1 r_lsb,
      .q_rev |0 q_rev
    }
  > _nat_divmod
> ?{ bits[] q, bits[] r };

-- Pushes MSB bit '0' or '1' as the new LSB onto a trimmed LSB-first remainder.
_lsb_push_0 = ?bits[] < /_ |_, /0 |0 |0, /1 |1 |0 > ?bits[];
_lsb_push_1 = ?bits[] < /_ |_ |1, /0 |0 |1, /1 |1 |1 > ?bits[];


-- -----------------------------------------------------------------------------
-- 6. Signed Integer Operations
-- -----------------------------------------------------------------------------

abs = ?int[] int < /+ |+, /- |+ > ?int[];

negate = ?int[] int <
  /+ < /0 /_ |_ |0 |+, /1 |1 |- >,
  /- |+
> ?int[];

-- Signed comparison returning order[] (lt | eq | gt).
cmp = ?{ int[] x, int[] y } { .x int x, .y int y } <
  { .x /+ x, .y /+ y } { .x x, .y y } cmp_msb,
  { .x /+ _x, .y /- _y } {} |gt,
  { .x /- _x, .y /+ _y } {} |lt,
  { .x /- x, .y /- y } { .x y, .y x } cmp_msb
> ?order[];

lt? = ?{ int[] x, int[] y } { cmp /lt _ord, () xy } .xy ?{ int[] x, int[] y };
le? = ?{ int[] x, int[] y } { cmp < /lt, /eq > _ord, () xy } .xy ?{ int[] x, int[] y };
eq? = ?{ int[] x, int[] y } { cmp /eq _ord, () xy } .xy ?{ int[] x, int[] y };
gt? = ?{ int[] x, int[] y } { cmp /gt _ord, () xy } .xy ?{ int[] x, int[] y };
ge? = ?{ int[] x, int[] y } { cmp < /gt, /eq > _ord, () xy } .xy ?{ int[] x, int[] y };

plus = ?{ int[] x, int[] y } { .x int x, .y int y } <
  { .x /+ x, .y /+ y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_add lsb_to_msb |+ int,
  { .x /- x, .y /- y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_add lsb_to_msb |- int,
  { .x /+ x, .y /- y } { .x x, .y y } _sub_signed_msb,
  { .x /- x, .y /+ y } { .x y, .y x } _sub_signed_msb
> ?int[];

-- Subtracts two unsigned MSB bits[], tagging '+' if x >= y else '-' on |y - x|.
_sub_signed_msb = ?{ bits[] x, bits[] y } {
  .x x,
  .y y,
  { .x x, .y y } cmp_msb ord
} <
  { .ord /eq _ord, .x _x, .y _y } 0,
  { .ord /gt _ord, .x x, .y y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_sub lsb_to_msb |+,
  { .ord /lt _ord, .x x, .y y } { .y msb_to_lsb x, .x msb_to_lsb y } lsb_sub lsb_to_msb |-
> ?int[];

minus = ?{ int[] x, int[] y } { .x x, .y negate y } plus ?int[];

inc = ?int[] { () x, 1 y } plus ?int[];
dec = ?int[] { () x, 1 y } minus ?int[];

times = ?{ int[] x, int[] y } { .x int x, .y int y } <
  { .x /+ x, .y /+ y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_mul lsb_to_msb |+,
  { .x /- x, .y /- y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_mul lsb_to_msb |+,
  { .x /+ x, .y /- y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_mul lsb_to_msb |- int,
  { .x /- x, .y /+ y } { .x msb_to_lsb x, .y msb_to_lsb y } lsb_mul lsb_to_msb |- int
> ?int[];

-- Truncating signed division & remainder matching JS BigInt (/ and %):
--   x = q * y + r,  sign(q) = sign(x) * sign(y),  sign(r) = sign(x),  y != 0.
divmod = ?{ int[] x, int[] y } { .x int x, .y int y } <
  { .x /+ x, .y /+ y } { .x x, .y y } nat_divmod { .q |+ q, .r |+ r },
  { .x /+ x, .y /- y } { .x x, .y y } nat_divmod { .q |- int q, .r |+ r },
  { .x /- x, .y /+ y } { .x x, .y y } nat_divmod { .q |- int q, .r |- int r },
  { .x /- x, .y /- y } { .x x, .y y } nat_divmod { .q |+ q, .r |- int r }
> ?{ int[] q, int[] r };

div = ?{ int[] x, int[] y } divmod .q ?int[];
mod = ?{ int[] x, int[] y } divmod .r ?int[];

gcd = ?{ int[] x, int[] y } { .x abs /+ a, .y abs /+ b } _gcd ?int[];

-- Non-negative greatest common divisor via Euclidean algorithm.
_gcd = ?{ bits[] a, bits[] b } <
  { .a a, .b /0 /_ |_ |0 _b } .a |+,
  { .a a, .b /1 b } {
    .b |1 a,
    { .a x, .b |1 y } nat_divmod .r b
  } _gcd
> ?int[];

lcm = ?{ int[] x, int[] y } { .x abs x, .y abs y } <
  { .x /+ /0 /_ |_ |0 _x, .y _y } 0,
  { .x /+ /1 _x, .y /+ /0 /_ |_ |0 _y } 0,
  { .x /+ /1 x, .y /+ /1 y } {
    {
      .x |1 |+ x,
      { .x |1 |+ x, .y |1 |+ y } gcd y
    } div x,
    .y |1 |+ y
  } times
> ?int[];
