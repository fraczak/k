-- =============================================================================
-- ktvm/fixtures/integer-streaming.k
-- Streaming (Tail-Modulo-Constructor) & Direct-Recursion Integer Arithmetic
--
-- Semantically identical drop-in alternative to `lib/integer.k` written for a
-- pull-driven streaming transducer network rather than a call-stack VM:
--
--   Tail-Modulo-Constructor (TMC / guarded streaming) upgrades:
--     1. `lsb_shl` / `_lsb_shl_nz` : guards x != _ once, then streams |0 online
--     2. `lsb_add` / `_lsb_add`    : streams sum bits online in O(1) FIFO memory,
--                                    O(1) tail-splices .x/.y on carry=0, drops
--                                    `acc` and `msb_drop_zeros rev_bits`
--     3. `half_max_tally`          : streams |0 online directly (no `acc` helper)
--     4. `lsb_trim` / `_lsb_trim`  : single-pass online trailing-zero trimmer
--                                    (buffers only active '0' runs; zero reversals)
--     5. `lsb_split` / `_lsb_split_raw` : multi-output TMC streaming `lo` + online
--                                    `lsb_trim`, passing `hi` through in O(1)
--     6. `nat_divmod` / `_nat_divmod`   : streams quotient `q` MSB-first via TMC
--                                    (no `q_rev` accumulator, no `rev_bits` on `q`)
--
--   Direct Tree Recursion (no manual continuation stack):
--     7. `lsb_mul`                 : textbook 3-way Karatsuba without `_k_stack[]`,
--                                    `_k_frame[]`, `_k_state[]`, `|eval`/`|apply`
--
--   Kept tail-recursive (inherently stateful / reversing / MSB-dependent):
--     * `trim_bits`, `_rev_bits`, `_cmp_msb`, `_lsb_sub`, `_lsb_mul_small`, `_gcd`
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Core Types, Constants, Normalization, and Predicates
-- -----------------------------------------------------------------------------

bit[] = < {} 0, {} 1 >;
bits[] = < {} _, B 0, B 1 > = B;

order[] = < {} lt, {} eq, {} gt >;

int[] = < bits[] +, bits[] - >;

0 = {}|_|+ ?int[];
1 = {}|_|1|+ ?int[];
-1 = {}|_|1|- ?int[];

-- Strips redundant leading '0' tags (already O(1) tail-recursive).
trim_bits = ?bits[] <
  /_ |_,
  /1 |1,
  /0 trim_bits
> ?bits[];
msb_drop_zeros = trim_bits;

-- Lifts unsigned bits[] magnitude (MSB at root, '_' at leaf) to canonical non-negative int[].
nat = ?bits[] trim_bits |+ ?int[];

-- Canonicalizes a signed int[] (strips leading zeros and normalizes -0 to +0).
int = ?int[] <
  /+ trim_bits |+,
  /- trim_bits <
    /_ |_|+,
    /1 |1|-
  >
> ?int[];

-- Identity filters (succeed unchanged on matching values, fail otherwise).
zero? = int { /+/_ _x, () x } .x ?int[];
pos?  = int /+/1 |1|+ ?int[];
neg?  = int /- |- ?int[];

-- Unsigned reversal (inherently O(n) buffering).
rev_bits = ?bits[] { () in, {} |_ acc } _rev_bits ?bits[];
_rev_bits = ?{ bits[] in, bits[] acc } <
  { .in /_ _in, .acc acc } .acc,
  <
    { .in /0 in, .acc |0 acc },
    { .in /1 in, .acc |1 acc }
  > _rev_bits
> ?bits[];

-- [TMC] Single-pass online LSB trailing-zero trimmer (replaces `rev_bits msb_drop_zeros rev_bits`).
-- mode=0 (scan): defers consecutive '0's into tally `z`; drops `z` on '_'; emits immediately on '1'.
-- mode=1 (flush): streams deferred '0's from `z`, then emits '1' and returns to scan.
lsb_trim = ?bits[] { () in, {} |_ z, {} |0 mode } _lsb_trim ?bits[];
_lsb_trim = ?{ bits[] in, bits[] z, bit[] mode } <
  { .in in, .z < /0, /1 > z, .mode /1 _m }
    { .in in, .z z, {} |1 mode } _lsb_trim |0,
  { .in in, .z /_ _z, .mode /1 _m }
    { .in in, {} |_ z, {} |0 mode } _lsb_trim |1,
  { .in /_ _in, .z _z, .mode /0 _m } {} |_,
  { .in /0 in, .z z, .mode /0 _m }
    { .in in, .z |0 z, {} |0 mode } _lsb_trim,
  { .in /1 in, .z /_ _z, .mode /0 _m }
    { .in in, {} |_ z, {} |0 mode } _lsb_trim |1,
  { .in /1 in, .z < /0, /1 > z, .mode /0 _m }
    { .in in, .z z, {} |1 mode } _lsb_trim |0
> ?bits[];

msb_to_lsb = ?bits[] msb_drop_zeros rev_bits ?bits[];
lsb_to_msb = ?bits[] rev_bits trim_bits ?bits[];


-- -----------------------------------------------------------------------------
-- 2. Magnitude Comparison & Bit-Shift Helpers
-- -----------------------------------------------------------------------------

-- Single-pass MSB-first comparison of two canonical trimmed bits[] values.
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
lsb_shl1 = ?bits[] < /_ |_, |0 > ?bits[];

-- [TMC] Guard `x` non-empty ONCE, then stream `|0` directly forward for each token of `k`
-- and zero-copy splice `x` at `k == _`.
lsb_shl = ?{ bits[] x, bits[] k } <
  .x /_ |_,
  { .x < /0 |0, /1 |1 > x, .k k } _lsb_shl_nz
> ?bits[];

_lsb_shl_nz = ?{ bits[] x, bits[] k } <
  { .x x, .k /_ _k } .x,
  { .x x, .k < /0, /1 > k } _lsb_shl_nz |0
> ?bits[];


-- -----------------------------------------------------------------------------
-- 3. Unsigned LSB Addition & Subtraction
-- -----------------------------------------------------------------------------

-- [TMC] Online ripple-carry addition on trimmed LSB-first bits[] (O(1) FIFO memory,
-- zero `acc`, zero `rev_bits`, and O(1) zero-copy tail splicing when carry == 0).
lsb_add = ?{ bits[] x, bits[] y } { .x x, .y y, {} |0 c } _lsb_add ?bits[];

_lsb_add = ?{ bits[] x, bits[] y, bit[] c } <
  { .x /_ _x, .y /_ _y, .c /0 _c } {} |_,
  { .x /_ _x, .y /_ _y, .c /1 _c } {} |_ |1,
  { .x /_ _x, .y < /0 |0, /1 |1 > y, .c /0 _c } .y,
  { .x < /0 |0, /1 |1 > x, .y /_ _y, .c /0 _c } .x,
  { .x _pop_lsb_bit px, .y _pop_lsb_bit py, .c c } {
    .px .rest x,
    .py .rest y,
    { .px .b a, .py .b b, .c c } _full_add_bit s
  } <
    { .x x, .y y, .s .carry c, .s .sum /0 _sum } { .x x, .y y, .c c } _lsb_add |0,
    { .x x, .y y, .s .carry c, .s .sum /1 _sum } { .x x, .y y, .c c } _lsb_add |1
  >
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

-- Tail-recursive ripple-borrow subtraction (must buffer because underflow & trimming depend on MSB).
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
-- 4. Fast Multiplication (Direct Natural Karatsuba + Schoolbook Base Case)
-- -----------------------------------------------------------------------------
-- No `_k_frame[]`, `_k_stack[]`, `_k_state[]`, `|eval`, `|apply`, or `|cons`!
-- Three direct sibling recursive calls to `lsb_mul` feed `_karatsuba_combine`.

lsb_mul = ?{ bits[] x, bits[] y } {
  .x x,
  .y y,
  .x _classify_bits cx,
  .y _classify_bits cy
} <
  { .x _x, .y _y, .cx /zero _cx, .cy _cy } {} |_,
  { .x _x, .y _y, .cx < /short, /long > _cx, .cy /zero _cy } {} |_,
  { .x x, .y y, .cx /short _cx, .cy < /short, /long > _cy }
    { .x iter, .y src, {} |_ acc } _lsb_mul_small,
  { .x x, .y y, .cx /long _cx, .cy /short _cy }
    { .y iter, .x src, {} |_ acc } _lsb_mul_small,
  { .x x, .y y, .cx /long _cx, .cy /long _cy } {
    .x x,
    .y y,
    { .x x, .y y } half_max_tally k
  } {
    .k k,
    { .x x, .k k } lsb_split sx,
    { .y x, .k k } lsb_split sy
  } {
    .k k,
    { .sx .lo x, .sy .lo y } lsb_mul z0,
    { .sx .hi x, .sy .hi y } lsb_mul z2,
    {
      { .sx .lo x, .sx .hi y } lsb_add x,
      { .sy .lo x, .sy .hi y } lsb_add y
    } lsb_mul z3
  } _karatsuba_combine
> ?bits[];

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

-- [TMC] Streams floor(max(|x|, |y|) / 2) as a zero-tally bits[] online in O(1) memory.
half_max_tally = ?{ bits[] x, bits[] y } <
  { .x _le1_bit? _x, .y _le1_bit? _y } {} |_,
  { .x _drop2 x, .y _drop2 y } half_max_tally |0
> ?bits[];

-- Matches any bit-string of length <= 1 (base condition for half_max_tally).
_le1_bit? = ?bits[] { < /_, /0 /_, /1 /_ > _b, () x } .x ?bits[];

-- [TMC] Multi-output streaming split: streams raw `lo` bits forward online and splices `hi` at k==_.
_lsb_split_raw = ?{ bits[] x, bits[] k } <
  { .k /_ _k, .x x } { {} |_ lo, .x hi },
  { .k < /0, /1 > _k, .x /_ _x } { {} |_ lo, {} |_ hi },
  { .x /0 x, .k < /0, /1 > k } _lsb_split_raw { .lo |0 lo, .hi hi },
  { .x /1 x, .k < /0, /1 > k } _lsb_split_raw { .lo |1 lo, .hi hi }
> ?{ bits[] lo, bits[] hi };

-- Splits a trimmed LSB-first bits[] at tally `k` into trimmed { lo, hi } with zero reversals.
lsb_split = ?{ bits[] x, bits[] k }
  _lsb_split_raw { .lo lsb_trim lo, .hi hi } ?{ bits[] lo, bits[] hi };


-- -----------------------------------------------------------------------------
-- 5. Fast Binary Long Division (MSB-First Shift-and-Subtract with TMC Quotient)
-- -----------------------------------------------------------------------------

-- Unsigned quotient and remainder on canonical MSB bits[] (fails when y == 0).
-- [TMC] `_nat_divmod` streams quotient bits `q` directly MSB-first (no `q_rev`, no `rev_bits` on `q`).
nat_divmod = ?{ bits[] x, bits[] y } {
  .x trim_bits x,
  .y trim_bits msb_to_lsb < /0 |0, /1 |1 > y_lsb
} {
  .x x,
  .y_lsb y_lsb,
  {} |_ r_lsb
} _nat_divmod {
  .q trim_bits q,
  .r r
} ?{ bits[] q, bits[] r };

_nat_divmod = ?{ bits[] x, bits[] y_lsb, bits[] r_lsb } <
  { .x /_ _x, .y_lsb _y, .r_lsb r } {
    {} |_ q,
    .r lsb_to_msb r
  },
  <
    { .x /0 x_tail, .y_lsb y_lsb, .r_lsb r } {
      .x_tail x_tail,
      .y_lsb y_lsb,
      .r _lsb_push_0 r1
    },
    { .x /1 x_tail, .y_lsb y_lsb, .r_lsb r } {
      .x_tail x_tail,
      .y_lsb y_lsb,
      .r _lsb_push_1 r1
    }
  > {
    .x_tail x_tail,
    .y_lsb y_lsb,
    .r1 r1,
    { .r1 x, .y_lsb y } lsb_try_sub sub
  } <
    {
      .x_tail x,
      .y_lsb y_lsb,
      .r1 _r1,
      .sub .b /0 _b,
      .sub .r rem_next
    } {
      .x x,
      .y_lsb y_lsb,
      .rem_next r_lsb
    } _nat_divmod { .q |1 q, .r r },
    {
      .x_tail x,
      .y_lsb y_lsb,
      .r1 r1,
      .sub .b /1 _b,
      .sub .r _r
    } {
      .x x,
      .y_lsb y_lsb,
      .r1 r_lsb
    } _nat_divmod { .q |0 q, .r r }
  >
> ?{ bits[] q, bits[] r };

-- Pushes MSB bit '0' or '1' as the new LSB onto a trimmed LSB-first remainder.
_lsb_push_0 = ?bits[] < /_ |_, /0 |0 |0, /1 |1 |0 > ?bits[];
_lsb_push_1 = ?bits[] < /_ |_ |1, /0 |0 |1, /1 |1 |1 > ?bits[];


-- -----------------------------------------------------------------------------
-- 6. Signed Integer Operations
-- -----------------------------------------------------------------------------

abs = ?int[] int < /+ |+, /- |+ > ?int[];

negate = ?int[] int <
  /+ < /_ |_|+, |- >,
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
  { .a a, .b /_ |_ _b } .a |+,
  { .a a, .b /1 b } {
    .b |1 a,
    { .a x, .b |1 y } nat_divmod .r b
  } _gcd
> ?int[];

lcm = ?{ int[] x, int[] y } { .x abs x, .y abs y } <
  { .x /+ /_ |_ _x, .y _y } 0,
  { .x /+ /1 _x, .y /+ /_ |_ _y } 0,
  { .x /+ /1 x, .y /+ /1 y } {
    {
      .x |1 |+ x,
      { .x |1 |+ x, .y |1 |+ y } gcd y
    } div x,
    .y |1 |+ y
  } times
> ?int[];
