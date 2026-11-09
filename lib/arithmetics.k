# --lib lib/bits.k --use trim inv_loop inv cmp inc_bits dec_bits plus_bits minus_bits mul_bits

-- lib/arithmetics.k — Signed arbitrary-precision integers (int[])

---------------------------------------------------------------
-- §1. Base Patterns & Primitives
---------------------------------------------------------------

bool[]  = < {} true, {} false >;
order[] = < {} lt, {} eq, {} gt >;
bits[]  = < {} _, B 0, B 1 > = B;

true     = {} |true ?bool[];
false    = {} |false ?bool[];
un_true  = ?bool[] /true;
un_false = ?bool[] /false;
un_lt    = ?order[] /lt;
un_eq    = ?order[] /eq;
un_gt    = ?order[] /gt;

_   = {} |_ ?bits[];
0b  = |0 ?bits[];
1b  = |1 ?bits[];
un_ = ?bits[] /_;
un0 = ?bits[] /0;
un1 = ?bits[] /1;
_?  = un_ _;
0   = _ 0b;
1   = _ 1b;

---------------------------------------------------------------
-- §2. Natural Constants & Helpers (bits[])
---------------------------------------------------------------

succ = inc_bits;
2  = 1 succ;
3  = 2 succ;
4  = 3 succ;
5  = 4 succ;
6  = 5 succ;
7  = 6 succ;
8  = 7 succ;
9  = 8 succ;
10 = 9 succ;
11 = 10 succ;
12 = 11 succ;

empty? = _?;
remove_leading_zeros = trim;
nat = trim < _? 0, () >;
concat = { .x inv x, .y r } inv_loop;

cmp_nat = { .x trim x, .y trim y } cmp;
GT = { cmp_nat un_gt if, () then } .then;
EQ = { cmp_nat un_eq if, () then } .then;
LE = { cmp_nat <un_lt, un_eq> if, () then } .then;

---------------------------------------------------------------
-- §3. Signed Integer Pattern & Primitives (int[])
---------------------------------------------------------------

int[] = < bits[] "+", bits[] "-" >;
int? = ?int[];
int_pair[] = { int[] x, int[] y };

-- Only the 4 atomic primitives mention ?int[]
pos_int = |"+" ?int[];
neg_int = |"-" ?int[];
un_pos  = ?int[] /"+";
un_neg  = ?int[] /"-";

int = nat pos_int;
abs = < un_pos, un_neg >;

pos?       = { un_pos trim un1 if, () then } .then;
neg?       = { un_neg if, () then } .then;
zero_int?  = { un_pos trim un_ if, () then } .then;
minus_one? = { un_neg trim un1 un_ if, () then } .then;

swap_sign = <
  zero_int?,
  un_pos neg_int,
  un_neg pos_int
>;

---------------------------------------------------------------
-- §4. Integer Increment, Decrement, Addition, Subtraction, Multiplication
---------------------------------------------------------------

inc = <
  un_pos inc_bits nat pos_int,
  minus_one? 0 int,
  un_neg dec_bits nat neg_int
>;

dec = <
  zero_int? 1 neg_int,
  un_pos dec_bits nat pos_int,
  un_neg inc_bits nat neg_int
>;

plus = <
  { .x un_pos x, .y un_pos y } plus_bits nat pos_int,
  { .x un_neg x, .y un_neg y } plus_bits nat neg_int,
  { .y un_neg x, .x un_pos y } GT minus_bits nat neg_int,
  { .x un_pos x, .y un_neg y } minus_bits nat pos_int,
  { .x un_neg x, .y un_pos y } GT minus_bits nat neg_int,
  { .y un_pos x, .x un_neg y } minus_bits nat pos_int
>;

minus = { .x x, .y swap_sign y } plus;

times = <
  { .x un_pos x, .y un_pos y } mul_bits int,
  { .x un_neg x, .y un_neg y } mul_bits int,
  { .x un_pos x, .y un_neg y } mul_bits int swap_sign,
  { .x un_neg x, .y un_pos y } mul_bits int swap_sign
>;

---------------------------------------------------------------
-- §5. Karatsuba Multiplication (O(n^1.585))
---------------------------------------------------------------

peel2 = < <un0, un1> <un0, un1>, <un0, un1>, _? >;

half_loop = <
  { .x un_ a, .y un_ b, .m then } .then,
  { .x peel2 x, .y peel2 y, .m 0b m } half_loop
>;
half_bits = { .x trim x, .y trim y, _ m } half_loop;

drop8   = un0 un0 un0 un0 un0 un0 un0 un0;
drop64  = drop8 drop8 drop8 drop8 drop8 drop8 drop8 drop8;
drop256 = drop64 drop64 drop64 drop64;
at_least_256? = < drop256 true, false >;

split_rev_loop = <
  { .m un_ if, { .low nat low, .x_rev inv nat high } then } .then,
  { .x_rev un_ if, { .low nat low, 0 high } then } .then,
  <
    { .x_rev un0 x_rev, .m un0 m, .low 0b low },
    { .x_rev un1 x_rev, .m un0 m, .low 1b low }
  > split_rev_loop
>;
split_at = { .x inv x_rev, .m m, _ low } split_rev_loop;

shift_bits = <
  { .val trim un_ if, 0 then } .then,
  { .val inv x, .m r } inv_loop
>;

shift2_bits = <
  { .val trim un_ if, 0 then } .then,
  { .val inv x, { .m x, .m r } inv_loop r } inv_loop
>;

karatsuba_bits = { { .x x, .y y } half_bits m, .x x, .y y } <
  { .m at_least_256? un_false if, { .x x, .y y } mul_bits nat then } .then,
  {
    .m at_least_256? un_true if,
    {
      { .x x, .m m } split_at sx,
      { .y x, .m m } split_at sy,
      .m m
    }
    {
      { .sx.high x, .sy.high y } karatsuba_bits z2,
      { .sx.low  x, .sy.low  y } karatsuba_bits z0,
      {
        { .sx.high x, .sx.low y } plus_bits x,
        { .sy.high x, .sy.low y } plus_bits y
      } karatsuba_bits z_sum,
      .m m
    }
    {
      .z2 z2,
      .z0 z0,
      { { .z_sum x, .z2 y } minus_bits x, .z0 y } minus_bits z1,
      .m m
    }
    {
      { .z2 val, .m m } shift2_bits z2_s,
      { .z1 val, .m m } shift_bits  z1_s,
      .z0 z0
    }
    { { .z2_s x, .z1_s y } plus_bits x, .z0 y } plus_bits nat then
  } .then
>;

karatsuba = <
  { .x un_pos x, .y un_pos y } karatsuba_bits int,
  { .x un_neg x, .y un_neg y } karatsuba_bits int,
  { .x un_pos x, .y un_neg y } karatsuba_bits int swap_sign,
  { .x un_neg x, .y un_pos y } karatsuba_bits int swap_sign
>;

---------------------------------------------------------------
-- §6. Integer Division (Adaptive Hybrid), Modulo, GCD, LCM
---------------------------------------------------------------

shift_in_0 = trim < _? 0, { inv 0b x, _ r } inv_loop >;
shift_in_1 = trim < _? 1, { inv 1b x, _ r } inv_loop >;
sub_bits   = minus_bits nat;

div_restoring = <
  { .x un_ if, { .q inv int div, .r rem } then } .then,
  <
    { .x un0 x, .r shift_in_0 r, .y y, .q q },
    { .x un1 x, .r shift_in_1 r, .y y, .q q }
  >
  <
    { { .y x, .r y } LE if, { .x x, .y y, .q 1b q, { .r x, .y y } sub_bits r } then } .then,
    { { .y x, .r y } GT if, { .x x, .y y, .q 0b q, .r r } then } .then
  >
  div_restoring
>;

pad_down = <
  { .x un_ if, { ._y _y, .steps steps } then } .then,
  { .x <un0, un1> x, ._y 0b _y, .steps 0b steps } pad_down
>;

align_down = <
  { .x <un0, un1> x, .y <un0, un1> y, ._y _y } align_down,
  { .y un_ if, { .x x, ._y _y, _ steps } pad_down then } .then,
  { .x un_ a, .y un_ b, { ._y _y, _ steps } then } .then
>;

div_down =
  { .x x, ._y _y, .steps steps, .q q, ._y inv nat y_scaled }
  <
    {
      { .y_scaled x, .x y } LE if,
      { { .x x, .y_scaled y } sub_bits x, .q 1b q, ._y _y, .steps steps } then
    } .then,
    {
      { .y_scaled x, .x y } GT if,
      { .x x, .q 0b q, ._y _y, .steps steps } then
    } .then
  >
  <
    { .steps un_ if, { .q inv int div, .x rem } then } .then,
    { .x x, ._y un0 _y, .steps un0 steps, .q q } div_down
  >;

check_2y = <
  { .x un_ a, .y <_?, un0, un1> b } false,
  { .y un_ a, .x <un0, un1> b } true,
  { .x <un0, un1> un_ a, .y <un0, un1> b } false,
  { .x <un0, un1> <un0, un1> x, .y <un0, un1> y } check_2y
>;

div_mag = <
  { .x un_ a, .y <_?, un0, un1> b, { 0 int div, 0 rem } then } .then,
  { { .y x, .x y } GT if, { 0 int div, .x rem } then } .then,
  {
    { .x x, .y y } check_2y un_false if,
    { { .x x, .y y, .y inv _y } align_down aligned, .x x }
    { .x x, .aligned._y _y, .aligned.steps steps, _ q } div_down then
  } .then,
  {
    { .x x, .y y } check_2y un_true if,
    { .x x, .y y, 0 r, _ q } div_restoring then
  } .then
>;

div = <
  { .x un_pos trim x, .y un_pos trim y } div_mag,
  { .x un_neg trim x, .y un_neg trim y } div_mag,
  { .x un_pos trim x, .y un_neg trim y } div_mag { .div swap_sign div, .rem rem },
  { .x un_neg trim x, .y un_pos trim y } div_mag { .div swap_sign div, .rem rem }
>;

mod = { .x int x, .y int y } div .rem;

gcd_loop = <
  { .y trim un_ if, .x nat then } .then,
  { .y x, { .x x, .y y } mod y } gcd_loop
>;

gcd = <
  { .y x, .x y } GT,
  ()
> gcd_loop;

lcm = { { .x int x, gcd int y } div .div x, .y int y } times abs;
