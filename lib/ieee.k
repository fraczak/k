# --lib core.k --use bit[] bits[]

-- =============================================================================
-- lib/ieee.k -- IEEE-754 binary64 (Double Precision) Structural Model
--
-- Self-contained module depending only on core.k. Models double-precision
-- floating-point numbers as an algebraic record with LSB-first exponent and
-- significand fields matching codecs/ieee.mjs:
--   sign[]    = < {} "+", {} "-" >
--   exp11[]   = { bit[] "0", ..., bit[] "10" }   -- bit "0" is LSB (2^0)
--   frac52[]  = { bit[] "0", ..., bit[] "51" }   -- bit "0" is LSB (2^-52)
--   float64[] = { sign[] sign, exp11[] exponent, frac52[] fraction }
--
-- Internal helper names use the `f64_` prefix so lib/ieee.k can be chained
-- alongside lib/generic.k without name collisions.
-- Predicates ending in '?' are pure identity filters (?X -> ?X).
-- All recursive relations are tail-recursive.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. IEEE-754 binary64 Types & Constants
-- -----------------------------------------------------------------------------

sign[] = < {} "+", {} "-" >;

exp11[] = {
  bit[] "0", bit[] "1", bit[] "2", bit[] "3",
  bit[] "4", bit[] "5", bit[] "6", bit[] "7",
  bit[] "8", bit[] "9", bit[] "10"
};

frac52[] = {
  bit[] "0",  bit[] "1",  bit[] "2",  bit[] "3",
  bit[] "4",  bit[] "5",  bit[] "6",  bit[] "7",
  bit[] "8",  bit[] "9",  bit[] "10", bit[] "11",
  bit[] "12", bit[] "13", bit[] "14", bit[] "15",
  bit[] "16", bit[] "17", bit[] "18", bit[] "19",
  bit[] "20", bit[] "21", bit[] "22", bit[] "23",
  bit[] "24", bit[] "25", bit[] "26", bit[] "27",
  bit[] "28", bit[] "29", bit[] "30", bit[] "31",
  bit[] "32", bit[] "33", bit[] "34", bit[] "35",
  bit[] "36", bit[] "37", bit[] "38", bit[] "39",
  bit[] "40", bit[] "41", bit[] "42", bit[] "43",
  bit[] "44", bit[] "45", bit[] "46", bit[] "47",
  bit[] "48", bit[] "49", bit[] "50", bit[] "51"
};

float64[] = {
  sign[] sign,
  exp11[] exponent,
  frac52[] fraction
};

exp0 = {
  {} |0 "0", {} |0 "1", {} |0 "2", {} |0 "3",
  {} |0 "4", {} |0 "5", {} |0 "6", {} |0 "7",
  {} |0 "8", {} |0 "9", {} |0 "10"
};

f64_exp_ones = {
  {} |1 "0", {} |1 "1", {} |1 "2", {} |1 "3",
  {} |1 "4", {} |1 "5", {} |1 "6", {} |1 "7",
  {} |1 "8", {} |1 "9", {} |1 "10"
};

frac0 = {
  {} |0 "0",  {} |0 "1",  {} |0 "2",  {} |0 "3",
  {} |0 "4",  {} |0 "5",  {} |0 "6",  {} |0 "7",
  {} |0 "8",  {} |0 "9",  {} |0 "10", {} |0 "11",
  {} |0 "12", {} |0 "13", {} |0 "14", {} |0 "15",
  {} |0 "16", {} |0 "17", {} |0 "18", {} |0 "19",
  {} |0 "20", {} |0 "21", {} |0 "22", {} |0 "23",
  {} |0 "24", {} |0 "25", {} |0 "26", {} |0 "27",
  {} |0 "28", {} |0 "29", {} |0 "30", {} |0 "31",
  {} |0 "32", {} |0 "33", {} |0 "34", {} |0 "35",
  {} |0 "36", {} |0 "37", {} |0 "38", {} |0 "39",
  {} |0 "40", {} |0 "41", {} |0 "42", {} |0 "43",
  {} |0 "44", {} |0 "45", {} |0 "46", {} |0 "47",
  {} |0 "48", {} |0 "49", {} |0 "50", {} |0 "51"
};

f64_frac_qnan = {
  {} |0 "0",  {} |0 "1",  {} |0 "2",  {} |0 "3",
  {} |0 "4",  {} |0 "5",  {} |0 "6",  {} |0 "7",
  {} |0 "8",  {} |0 "9",  {} |0 "10", {} |0 "11",
  {} |0 "12", {} |0 "13", {} |0 "14", {} |0 "15",
  {} |0 "16", {} |0 "17", {} |0 "18", {} |0 "19",
  {} |0 "20", {} |0 "21", {} |0 "22", {} |0 "23",
  {} |0 "24", {} |0 "25", {} |0 "26", {} |0 "27",
  {} |0 "28", {} |0 "29", {} |0 "30", {} |0 "31",
  {} |0 "32", {} |0 "33", {} |0 "34", {} |0 "35",
  {} |0 "36", {} |0 "37", {} |0 "38", {} |0 "39",
  {} |0 "40", {} |0 "41", {} |0 "42", {} |0 "43",
  {} |0 "44", {} |0 "45", {} |0 "46", {} |0 "47",
  {} |0 "48", {} |0 "49", {} |0 "50", {} |1 "51"
};

pos_zero = { {} |+ sign, exp0 exponent, frac0 fraction };
neg_zero = { {} |- sign, exp0 exponent, frac0 fraction };
pos_inf  = { {} |+ sign, f64_exp_ones exponent, frac0 fraction };
neg_inf  = { {} |- sign, f64_exp_ones exponent, frac0 fraction };
qnan     = { {} |+ sign, f64_exp_ones exponent, f64_frac_qnan fraction };


-- -----------------------------------------------------------------------------
-- 2. Classification Filters & Sign Negation
-- -----------------------------------------------------------------------------

f64_bit_or = <
  { .a /0 _a, .b /0 _b } {} |0,
  { .a /0 _a, .b /1 _b } {} |1,
  { .a /1 _a, .b /0 _b } {} |1,
  { .a /1 _a, .b /1 _b } {} |1
>;

f64_bit_and = <
  { .a /1 _a, .b /1 _b } {} |1,
  { .a /0 _a, .b /0 _b } {} |0,
  { .a /0 _a, .b /1 _b } {} |0,
  { .a /1 _a, .b /0 _b } {} |0
>;

f64_or4 = {
  { .0 a, .1 b } f64_bit_or lo,
  { .2 a, .3 b } f64_bit_or hi
} { .lo a, .hi b } f64_bit_or;

f64_and4 = {
  { .0 a, .1 b } f64_bit_and lo,
  { .2 a, .3 b } f64_bit_and hi
} { .lo a, .hi b } f64_bit_and;

f64_exp_any_one = {
  { ."0" "0", ."1" "1", ."2" "2", ."3" "3" } f64_or4 g0,
  { ."4" "0", ."5" "1", ."6" "2", ."7" "3" } f64_or4 g1,
  { ."8" "0", ."9" "1", ."10" "2", {} |0 "3" } f64_or4 g2
} { .g0 a, { .g1 a, .g2 b } f64_bit_or b } f64_bit_or;

f64_exp_all_ones = {
  { ."0" "0", ."1" "1", ."2" "2", ."3" "3" } f64_and4 g0,
  { ."4" "0", ."5" "1", ."6" "2", ."7" "3" } f64_and4 g1,
  { ."8" "0", ."9" "1", ."10" "2", {} |1 "3" } f64_and4 g2
} { .g0 a, { .g1 a, .g2 b } f64_bit_and b } f64_bit_and;

f64_frac_any_one = {
  { ."0"  "0", ."1"  "1", ."2"  "2", ."3"  "3" } f64_or4 g0,
  { ."4"  "0", ."5"  "1", ."6"  "2", ."7"  "3" } f64_or4 g1,
  { ."8"  "0", ."9"  "1", ."10" "2", ."11" "3" } f64_or4 g2,
  { ."12" "0", ."13" "1", ."14" "2", ."15" "3" } f64_or4 g3,
  { ."16" "0", ."17" "1", ."18" "2", ."19" "3" } f64_or4 g4,
  { ."20" "0", ."21" "1", ."22" "2", ."23" "3" } f64_or4 g5,
  { ."24" "0", ."25" "1", ."26" "2", ."27" "3" } f64_or4 g6,
  { ."28" "0", ."29" "1", ."30" "2", ."31" "3" } f64_or4 g7,
  { ."32" "0", ."33" "1", ."34" "2", ."35" "3" } f64_or4 g8,
  { ."36" "0", ."37" "1", ."38" "2", ."39" "3" } f64_or4 g9,
  { ."40" "0", ."41" "1", ."42" "2", ."43" "3" } f64_or4 g10,
  { ."44" "0", ."45" "1", ."46" "2", ."47" "3" } f64_or4 g11,
  { ."48" "0", ."49" "1", ."50" "2", ."51" "3" } f64_or4 g12
} {
  { .g0 "0", .g1 "1", .g2 "2", .g3  "3" } f64_or4 a,
  { .g4 "0", .g5 "1", .g6 "2", .g7  "3" } f64_or4 b,
  { .g8 "0", .g9 "1", .g10 "2", .g11 "3" } f64_or4 c,
  .g12 d
} {
  { .a a, .b b } f64_bit_or a,
  { .c a, .d b } f64_bit_or b
} f64_bit_or;

zero_exponent? = ?exp11[] {
  f64_exp_any_one /0 _z,
  () then
} .then ?exp11[];

all_ones_exponent? = ?exp11[] {
  f64_exp_all_ones /1 _o,
  () then
} .then ?exp11[];

-- Classifies float64[] exponent into < zero, normal, ones >.
f64_classify_exp = {
  .exponent f64_exp_any_one any1,
  .exponent f64_exp_all_ones all1
} <
  { .any1 /0 _a, .all1 _b } {} |zero,
  { .any1 /1 _a, .all1 /0 _b } {} |normal,
  { .any1 /1 _a, .all1 /1 _b } {} |ones
>;

zero_float64? = ?float64[] {
  f64_classify_exp /zero _e,
  .fraction f64_frac_any_one /0 _f,
  () then
} .then ?float64[];

finite_float64? = ?float64[] {
  f64_classify_exp < /zero, /normal > _e,
  () then
} .then ?float64[];

inf_float64? = ?float64[] {
  f64_classify_exp /ones _e,
  .fraction f64_frac_any_one /0 _f,
  () then
} .then ?float64[];

nan_float64? = ?float64[] {
  f64_classify_exp /ones _e,
  .fraction f64_frac_any_one /1 _f,
  () then
} .then ?float64[];

negate_float64 = ?float64[] {
  .sign < /+ {} |-, /- {} |+ > sign,
  .exponent exponent,
  .fraction fraction
} ?float64[];


-- -----------------------------------------------------------------------------
-- 3. Internal Small-Integer & Bit-Vector Arithmetic (f64_*)
-- -----------------------------------------------------------------------------

f64_order[] = < {} lt, {} eq, {} gt >;
f64_int[] = < bits[] "+", bits[] "-" >;

f64_trim_msb = ?bits[] <
  /_ |_ |0,
  /1 |1,
  /0 /_ |_ |0,
  /0 f64_trim_msb
> ?bits[];

f64_msb_drop_zeros = ?bits[] <
  /_ |_,
  /1 |1,
  /0 f64_msb_drop_zeros
> ?bits[];

f64_rev_step = ?{ bits[] in, bits[] acc } <
  { .in /_ _i, .acc acc } .acc,
  <
    { .in /0 in, .acc |0 acc },
    { .in /1 in, .acc |1 acc }
  > f64_rev_step
> ?bits[];

f64_rev_bits = ?bits[] { () in, {} |_ acc } f64_rev_step ?bits[];

f64_lsb_trim   = ?bits[] f64_rev_bits f64_msb_drop_zeros f64_rev_bits ?bits[];
f64_msb_to_lsb = ?bits[] f64_msb_drop_zeros f64_rev_bits ?bits[];
f64_lsb_to_msb = ?bits[] f64_rev_bits f64_trim_msb ?bits[];

f64_lsb_shl1 = < /_ |_, /0 |0 |0, /1 |1 |0 >;

f64_pop1 = <
  /_ { {} |0 b, {} |_ r },
  /0 { {} |0 b, () r },
  /1 { {} |1 b, () r }
>;

f64_push_bit_acc = ?{ bit[] b, bits[] acc } <
  { .b /0 _, .acc acc } .acc |0,
  { .b /1 _, .acc acc } .acc |1
> ?bits[];

f64_prepend_zeros = ?{ bits[] zeros, bits[] tail } <
  { .zeros /_ _, .tail tail } .tail,
  { .zeros < /0, /1 > zeros, .tail tail } {
    .zeros zeros, .tail |0 tail
  } f64_prepend_zeros
> ?bits[];

f64_lsb_inc_step = ?{ bits[] in, bits[] zeros } <
  { .in /_ _, .zeros zeros } { .zeros zeros, {} |_ |1 tail },
  { .in /0 in, .zeros zeros } { .zeros zeros, .in |1 tail },
  { .in /1 in, .zeros zeros } { .in in, .zeros |0 zeros } f64_lsb_inc_step
> ?{ bits[] zeros, bits[] tail };

f64_lsb_inc = ?bits[] {
  () in, {} |_ zeros
} f64_lsb_inc_step f64_prepend_zeros ?bits[];

f64_full_add_bit = ?{ bit[] a, bit[] b, bit[] c } <
  { .a /0 _a, .b /0 _b, .c /0 _c } { {} |0 sum, {} |0 carry },
  { .a /0 _a, .b /0 _b, .c /1 _c } { {} |1 sum, {} |0 carry },
  { .a /0 _a, .b /1 _b, .c /0 _c } { {} |1 sum, {} |0 carry },
  { .a /0 _a, .b /1 _b, .c /1 _c } { {} |0 sum, {} |1 carry },
  { .a /1 _a, .b /0 _b, .c /0 _c } { {} |1 sum, {} |0 carry },
  { .a /1 _a, .b /0 _b, .c /1 _c } { {} |0 sum, {} |1 carry },
  { .a /1 _a, .b /1 _b, .c /0 _c } { {} |0 sum, {} |1 carry },
  { .a /1 _a, .b /1 _b, .c /1 _c } { {} |1 sum, {} |1 carry }
> ?{ bit[] sum, bit[] carry };

f64_full_sub_bit = ?{ bit[] a, bit[] b, bit[] c } <
  { .a /0 _a, .b /0 _b, .c /0 _c } { {} |0 diff, {} |0 borrow },
  { .a /0 _a, .b /0 _b, .c /1 _c } { {} |1 diff, {} |1 borrow },
  { .a /0 _a, .b /1 _b, .c /0 _c } { {} |1 diff, {} |1 borrow },
  { .a /0 _a, .b /1 _b, .c /1 _c } { {} |0 diff, {} |1 borrow },
  { .a /1 _a, .b /0 _b, .c /0 _c } { {} |1 diff, {} |0 borrow },
  { .a /1 _a, .b /0 _b, .c /1 _c } { {} |0 diff, {} |0 borrow },
  { .a /1 _a, .b /1 _b, .c /0 _c } { {} |0 diff, {} |0 borrow },
  { .a /1 _a, .b /1 _b, .c /1 _c } { {} |1 diff, {} |1 borrow }
> ?{ bit[] diff, bit[] borrow };

f64_lsb_add_step = ?{ bits[] x, bits[] y, bit[] c, bits[] acc } <
  { .x /_ _x, .y /_ _y, .c /0 _c, .acc acc } .acc,
  { .x /_ _x, .y /_ _y, .c /1 _c, .acc acc } .acc |1,
  { .x /_ _x, .y < /0 |0, /1 |1 > y, .c /0 _c, .acc acc }
    { .y in, .acc acc } f64_rev_step,
  { .x < /0 |0, /1 |1 > x, .y /_ _y, .c /0 _c, .acc acc }
    { .x in, .acc acc } f64_rev_step,
  { .x f64_pop1 px, .y f64_pop1 py, .c c, .acc acc } {
    .px .r x,
    .py .r y,
    { .px .b a, .py .b b, .c c } f64_full_add_bit s,
    .acc acc
  } {
    .x x,
    .y y,
    .s .carry c,
    { .s .sum b, .acc acc } f64_push_bit_acc acc
  } f64_lsb_add_step
> ?bits[];

f64_lsb_add = ?{ bits[] x, bits[] y } {
  .x x, .y y, {} |0 c, {} |_ acc
} f64_lsb_add_step f64_msb_drop_zeros f64_rev_bits ?bits[];

f64_lsb_sub_step = ?{ bits[] x, bits[] y, bit[] b, bits[] acc } <
  { .x /_ _x, .y /_ _y, .b /0 _b, .acc acc }
    { {} |0 b, .acc f64_msb_drop_zeros f64_rev_bits r },
  { .x /_ _x, .y /_ _y, .b /1 _b, .acc _a }
    { {} |1 b, {} |_ r },
  { .x /_ _x, .y < /0, /1 > _y, .b _b, .acc _a }
    { {} |1 b, {} |_ r },
  { .x < /0 |0, /1 |1 > x, .y /_ _y, .b /0 _b, .acc acc } {
    {} |0 b,
    { .x in, .acc acc } f64_rev_step f64_msb_drop_zeros f64_rev_bits r
  },
  { .x < /0 |0, /1 |1 > f64_pop1 px, .y f64_pop1 py, .b b, .acc acc } {
    .px .r x,
    .py .r y,
    { .px .b a, .py .b b, .b c } f64_full_sub_bit s,
    .acc acc
  } {
    .x x,
    .y y,
    .s .borrow b,
    { .s .diff b, .acc acc } f64_push_bit_acc acc
  } f64_lsb_sub_step
> ?{ bit[] b, bits[] r };

f64_lsb_sub = ?{ bits[] x, bits[] y }
  { .x x, .y y, {} |0 b, {} |_ acc } f64_lsb_sub_step { .b /0 _b, .r r } .r ?bits[];

f64_lsb_try_sub = ?{ bits[] x, bits[] y }
  { .x x, .y y, {} |0 b, {} |_ acc } f64_lsb_sub_step ?{ bit[] b, bits[] r };

f64_ord_if_eq = <
  { .ord /eq _o, .next next } .next,
  { .ord /lt _o, .next _n } {} |lt,
  { .ord /gt _o, .next _n } {} |gt
>;

f64_cmp_msb_step = ?{ bits[] x, bits[] y, f64_order[] ord } <
  { .x /_ _x, .y /_ _y, .ord ord } .ord,
  { .x /_ _x, .y /0 _y, .ord _o } {} |lt,
  { .x /_ _x, .y /1 _y, .ord _o } {} |lt,
  { .x /0 _x, .y /_ _y, .ord _o } {} |gt,
  { .x /1 _x, .y /_ _y, .ord _o } {} |gt,
  <
    { .x /0 x, .y /0 y, .ord ord },
    { .x /1 x, .y /1 y, .ord ord },
    { .x /0 x, .y /1 y, .ord ord }
      { .x x, .y y, { .ord ord, {} |lt next } f64_ord_if_eq ord },
    { .x /1 x, .y /0 y, .ord ord }
      { .x x, .y y, { .ord ord, {} |gt next } f64_ord_if_eq ord }
  > f64_cmp_msb_step
> ?f64_order[];

f64_cmp_msb = { .x x, .y y, {} |eq ord } f64_cmp_msb_step;
f64_lsb_cmp = { .x f64_lsb_to_msb x, .y f64_lsb_to_msb y } f64_cmp_msb;

-- Shifts trimmed LSB-first bits[] left by an unsigned LSB bit-count `n`.
f64_lsb_shl_n = ?{ bits[] x, bits[] n } <
  { .x /_ _x, .n _n } {} |_,
  { .x /0 x, .n /_ _n } .x |0,
  { .x /1 x, .n /_ _n } .x |1,
  <
    { .x /0 x, .n n } { .x |0 |0 x, { .n x, {} |_ |1 y } f64_lsb_sub n },
    { .x /1 x, .n n } { .x |1 |0 x, { .n x, {} |_ |1 y } f64_lsb_sub n }
  > f64_lsb_shl_n
> ?bits[];

-- Signed small-integer helpers (canonical MSB f64_int[]) for IEEE exponent math.
f64_izero = {} |_ |0 |+;
f64_norm_int = ?f64_int[] <
  /+ f64_trim_msb |+,
  /- f64_trim_msb < /0 /_ |_ |0 |+, /1 |1 |- >
> ?f64_int[];

f64_i_sub_msb = {
  .x x,
  .y y,
  { .x x, .y y } f64_cmp_msb ord
} <
  { .ord /eq _o, .x _x, .y _y } f64_izero,
  { .ord /gt _o, .x x, .y y }
    { .x f64_msb_to_lsb x, .y f64_msb_to_lsb y } f64_lsb_sub f64_lsb_to_msb |+,
  { .ord /lt _o, .x x, .y y }
    { .y f64_msb_to_lsb x, .x f64_msb_to_lsb y } f64_lsb_sub f64_lsb_to_msb |-
>;

f64_i_plus = { .x f64_norm_int x, .y f64_norm_int y } <
  { .x /+ x, .y /+ y } { .x f64_msb_to_lsb x, .y f64_msb_to_lsb y } f64_lsb_add f64_lsb_to_msb |+ f64_norm_int,
  { .x /- x, .y /- y } { .x f64_msb_to_lsb x, .y f64_msb_to_lsb y } f64_lsb_add f64_lsb_to_msb |- f64_norm_int,
  { .x /+ x, .y /- y } { .x x, .y y } f64_i_sub_msb,
  { .x /- x, .y /+ y } { .x y, .y x } f64_i_sub_msb
>;

f64_i_neg = f64_norm_int < /+ < /0 /_ |_ |0 |+, /1 |1 |- >, /- |+ >;
f64_i_minus = { .x x, .y f64_i_neg y } f64_i_plus;

f64_i_cmp = { .x f64_norm_int x, .y f64_norm_int y } <
  { .x /+ x, .y /+ y } { .x x, .y y } f64_cmp_msb,
  { .x /+ _x, .y /- _y } {} |gt,
  { .x /- _x, .y /+ _y } {} |lt,
  { .x /- x, .y /- y } { .x y, .y x } f64_cmp_msb
>;

-- Small constant exponents in MSB bits[] (MSB at root, '_' at leaf).
f64_bits_52    = {} |_ |0 |0 |1 |0 |1 |1;             -- 0b110100 (LSB) -> 52 (LSB)
f64_bits_1022  = {} |_ |0 |1 |1 |1 |1 |1 |1 |1 |1 |1; -- 1022
f64_bits_1023  = {} |_ |1 |1 |1 |1 |1 |1 |1 |1 |1 |1; -- 1023
f64_bits_1024  = {} |_ |0 |0 |0 |0 |0 |0 |0 |0 |0 |0 |1;
f64_bits_1074  = {} |_ |0 |1 |0 |0 |1 |1 |0 |0 |0 |0 |1; -- 1074
f64_bits_1075  = {} |_ |1 |1 |0 |0 |1 |1 |0 |0 |0 |0 |1; -- 1075

f64_lsb_52     = f64_bits_52 f64_msb_to_lsb;
f64_i_1023     = f64_bits_1023 |+;
f64_i_1024     = f64_bits_1024 |+;
f64_i_neg1022  = f64_bits_1022 |-;
f64_i_neg1075  = f64_bits_1075 |-;


-- -----------------------------------------------------------------------------
-- 4. Packing Helpers (LSB bits[] -> exp11[], frac52[])
-- -----------------------------------------------------------------------------

f64_pop4 =
  f64_pop1 { .b 0, .r f64_pop1 r1 }
  { .0 0, .r1 .b 1, .r1 .r f64_pop1 r2 }
  { .0 0, .1 1, .r2 .b 2, .r2 .r f64_pop1 r3 } {
    { .0 0, .1 1, .2 2, .r3 .b 3 } v,
    .r3 .r rest
  };

f64_pop11 =
  f64_pop4 { .v g0, .rest f64_pop4 r1 }
  { .g0 g0, .r1 .v g1, .r1 .rest f64_pop4 r2 } {
    {
      .g0 .0 "0",  .g0 .1 "1",  .g0 .2 "2",  .g0 .3 "3",
      .g1 .0 "4",  .g1 .1 "5",  .g1 .2 "6",  .g1 .3 "7",
      .r2 .v .0 "8", .r2 .v .1 "9", .r2 .v .2 "10"
    } exp,
    .r2 .rest rest
  };

f64_bits_to_exp11 = f64_msb_to_lsb f64_pop11 .exp;

f64_pop16 =
  f64_pop4 { .v p0, .rest f64_pop4 r1 }
  { .p0 p0, .r1 .v p1, .r1 .rest f64_pop4 r2 }
  { .p0 p0, .p1 p1, .r2 .v p2, .r2 .rest f64_pop4 r3 } {
    { .p0 p0, .p1 p1, .p2 p2, .r3 .v p3 } blk,
    .r3 .rest rest
  };

f64_bits_to_frac52 =
  f64_pop16 { .blk b0, .rest f64_pop16 r1 }
  { .b0 b0, .r1 .blk b1, .r1 .rest f64_pop16 r2 }
  { .b0 b0, .b1 b1, .r2 .blk b2, .r2 .rest f64_pop4 r3 } {
    {
      .b0 .p0 .0 "0",  .b0 .p0 .1 "1",  .b0 .p0 .2 "2",  .b0 .p0 .3 "3",
      .b0 .p1 .0 "4",  .b0 .p1 .1 "5",  .b0 .p1 .2 "6",  .b0 .p1 .3 "7",
      .b0 .p2 .0 "8",  .b0 .p2 .1 "9",  .b0 .p2 .2 "10", .b0 .p2 .3 "11",
      .b0 .p3 .0 "12", .b0 .p3 .1 "13", .b0 .p3 .2 "14", .b0 .p3 .3 "15",

      .b1 .p0 .0 "16", .b1 .p0 .1 "17", .b1 .p0 .2 "18", .b1 .p0 .3 "19",
      .b1 .p1 .0 "20", .b1 .p1 .1 "21", .b1 .p1 .2 "22", .b1 .p1 .3 "23",
      .b1 .p2 .0 "24", .b1 .p2 .1 "25", .b1 .p2 .2 "26", .b1 .p2 .3 "27",
      .b1 .p3 .0 "28", .b1 .p3 .1 "29", .b1 .p3 .2 "30", .b1 .p3 .3 "31",

      .b2 .p0 .0 "32", .b2 .p0 .1 "33", .b2 .p0 .2 "34", .b2 .p0 .3 "35",
      .b2 .p1 .0 "36", .b2 .p1 .1 "37", .b2 .p1 .2 "38", .b2 .p1 .3 "39",
      .b2 .p2 .0 "40", .b2 .p2 .1 "41", .b2 .p2 .2 "42", .b2 .p2 .3 "43",
      .b2 .p3 .0 "44", .b2 .p3 .1 "45", .b2 .p3 .2 "46", .b2 .p3 .3 "47",

      .r3 .v .0 "48", .r3 .v .1 "49", .r3 .v .2 "50", .r3 .v .3 "51"
    } frac,
    .r3 .rest tail
  };


-- -----------------------------------------------------------------------------
-- 5. Arbitrary-Precision Conversion: ratio_to_float64 & bits_to_float64
-- -----------------------------------------------------------------------------

f64_strip_tz_step = ?{ bits[] x } <
  { .x /1 x } .x |1,
  { .x /0 x } { .x x } f64_strip_tz_step
> ?bits[];

f64_lsb_bit_len_step = ?{ bits[] x, bits[] acc } <
  { .x /_ _x, .acc acc } .acc,
  <
    { .x /0 x, .acc acc } { .x x, .acc f64_lsb_inc acc },
    { .x /1 x, .acc acc } { .x x, .acc f64_lsb_inc acc }
  > f64_lsb_bit_len_step
> ?bits[];

-- Measures total bit length (MSB) and strips trailing zero factors of positive MSB bits[].
f64_factor_msb = ?bits[] f64_msb_to_lsb {
  { () x, {} |_ acc } f64_lsb_bit_len_step f64_lsb_to_msb total_len,
  { () x } f64_strip_tz_step odd_lsb
} {
  .total_len total_len,
  .odd_lsb odd_lsb,
  { .odd_lsb x, {} |_ acc } f64_lsb_bit_len_step f64_lsb_to_msb odd_len
};

-- Generates `n` fractional quotient bits (`n` in trimmed LSB bits[]) into `q_lsb`.
-- On entry: 0 <= rem < den_lsb and q_lsb holds the leading bit(s) so far.
f64_div_steps = ?{ bits[] rem, bits[] den_lsb, bits[] q_lsb, bits[] n } <
  { .rem rem, .den_lsb _d, .q_lsb q, .n /_ _n } { .q q_lsb, .rem rem },
  { .rem rem, .den_lsb den_lsb, .q_lsb q, .n n } {
    { .n x, {} |_ |1 y } f64_lsb_sub n_next,
    .den_lsb den_lsb,
    .q q,
    .rem f64_lsb_shl1 rem2
  } {
    .n_next n_next,
    .den_lsb den_lsb,
    .q q,
    .rem2 rem2,
    { .rem2 x, .den_lsb y } f64_lsb_try_sub sub
  } <
    { .n_next n, .den_lsb den, .q q, .rem2 _r2, .sub .b /0 _b, .sub .r rem } {
      .rem rem,
      .den den_lsb,
      .q |1 q_lsb,
      .n n
    },
    { .n_next n, .den_lsb den, .q q, .rem2 rem2, .sub .b /1 _b, .sub .r _r } {
      .rem2 rem,
      .den den_lsb,
      .q |0 q_lsb,
      .n n
    }
  > f64_div_steps
> ?{ bits[] q_lsb, bits[] rem };

f64_round_ties_even = {
  .q_lsb q,
  .rem f64_lsb_shl1 rem2,
  .den_lsb den
} {
  .q q,
  { .rem2 x, .den y } f64_lsb_cmp ord
} <
  { .q q, .ord /lt _o } .q,
  { .q q, .ord /gt _o } .q f64_lsb_inc,
  { .q /0 q, .ord /eq _o } .q |0,
  { .q /1 q, .ord /eq _o } .q |1 f64_lsb_inc
>;

f64_pack_rounded = {
  .sign sign,
  .eb eb,
  .q_lsb f64_bits_to_frac52 packed
} {
  .sign sign,
  .eb eb,
  .packed .frac frac,
  .packed .tail tail
} <
  { .sign sign, .eb /0 /_ _eb, .frac frac, .tail /_ _t } {
    .sign sign, exp0 exponent, .frac fraction
  },
  { .sign sign, .eb /0 /_ _eb, .frac frac, .tail /1 /_ _t } {
    .sign sign, {} |_ |1 f64_bits_to_exp11 exponent, .frac fraction
  },
  { .sign sign, .eb eb, .frac frac, .tail /1 /_ _t } {
    .sign sign, .eb f64_bits_to_exp11 exponent, .frac fraction
  },
  { .sign sign, .eb eb, .frac frac, .tail /0 /1 /_ _t } {
    .sign sign,
    .eb f64_msb_to_lsb f64_lsb_inc f64_lsb_to_msb eb1,
    .frac frac
  } <
    { .eb1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /1 /_ _all1, .sign sign, .frac _f } {
      .sign sign, f64_exp_ones exponent, frac0 fraction
    },
    { .eb1 eb1, .sign sign, .frac frac } {
      .sign sign, .eb1 f64_bits_to_exp11 exponent, .frac fraction
    }
  >
>;

-- Finishes float64 assembly given normalized k, initial rem = A - B, and den = B
-- where 1 <= (A / B) < 2 and num/den = (A / B) * 2^k.
f64_finish_normalized = {
  .sign sign,
  .k_int k_int,
  .rem rem,
  .den den,
  { .k_int x, f64_i_1024 y } f64_i_cmp cmp_ovf,
  { .k_int x, f64_i_neg1075 y } f64_i_cmp cmp_min
} <
  { .sign sign, .k_int _k, .rem _r, .den _d, .cmp_ovf < /eq, /gt > _o, .cmp_min _m } {
    .sign sign, f64_exp_ones exponent, frac0 fraction
  },
  { .sign sign, .k_int _k, .rem _r, .den _d, .cmp_ovf /lt _o, .cmp_min /lt _m } {
    .sign sign, exp0 exponent, frac0 fraction
  },
  { .sign sign, .k_int _k, .rem /_ _r, .den _d, .cmp_ovf /lt _o, .cmp_min /eq _m } {
    .sign sign, exp0 exponent, frac0 fraction
  },
  { .sign sign, .k_int _k, .rem < /0, /1 > _r, .den _d, .cmp_ovf /lt _o, .cmp_min /eq _m } {
    .sign sign, exp0 exponent, {} |_ |1 f64_bits_to_frac52 .frac fraction
  },
  { .sign sign, .k_int k_int, .rem rem, .den den, .cmp_ovf /lt _o, .cmp_min /gt _m } {
    .sign sign,
    .rem rem,
    .den den,
    .k_int k_int,
    { .k_int x, f64_i_neg1022 y } f64_i_cmp cmp_norm
  } <
    { .sign sign, .rem rem, .den den, .k_int k_int, .cmp_norm /lt _c } {
      .sign sign,
      .den den,
      {} |_ |0 eb,
      {
        .rem rem,
        .den den_lsb,
        {} |_ |1 q_lsb,
        { .k_int x, f64_bits_1074 |+ y } f64_i_plus /+ f64_msb_to_lsb n
      } f64_div_steps res
    } {
      .sign sign,
      .eb eb,
      { .res .q_lsb q_lsb, .res .rem rem, .den den_lsb } f64_round_ties_even q_lsb
    } f64_pack_rounded,
    { .sign sign, .rem rem, .den den, .k_int k_int, .cmp_norm < /eq, /gt > _c } {
      .sign sign,
      .den den,
      { .k_int x, f64_i_1023 y } f64_i_plus /+ eb,
      { .rem rem, .den den_lsb, {} |_ |1 q_lsb, f64_lsb_52 n } f64_div_steps res
    } {
      .sign sign,
      .eb eb,
      { .res .q_lsb q_lsb, .res .rem rem, .den den_lsb } f64_round_ties_even q_lsb
    } f64_pack_rounded
  >
>;

-- Converts { sign[] sign, bits[] num, bits[] den } to IEEE float64[].
-- Fails when den == 0. Uses odd-core alignment to avoid huge bit shifts.
f64_ratio_nonzero = {
  .sign sign,
  .num f64_factor_msb fn,
  .den f64_factor_msb fd
} {
  .sign sign,
  { .fn .total_len |+ x, .fd .total_len |+ y } f64_i_minus k0,
  { .fn .odd_len |+ x, .fd .odd_len |+ y } f64_i_minus d_odd,
  .fn .odd_lsb na,
  .fd .odd_lsb da
} {
  .sign sign,
  .k0 k0,
  { .na na, .da da, .d_odd d_odd } <
    { .na na, .da da, .d_odd /+ s } {
      .na a,
      { .da x, .s f64_msb_to_lsb n } f64_lsb_shl_n b
    },
    { .na na, .da da, .d_odd /- s } {
      { .na x, .s f64_msb_to_lsb n } f64_lsb_shl_n a,
      .da b
    }
  > ab
} {
  .sign sign,
  .k0 k0,
  .ab .a a,
  .ab .b b,
  { .ab .a x, .ab .b y } f64_lsb_cmp cmp_ab
} <
  { .sign sign, .k0 k0, .a a, .b b, .cmp_ab /eq _c } {
    .sign sign,
    .k0 k_int,
    {} |_ rem,
    .b den
  } f64_finish_normalized,
  { .sign sign, .k0 k0, .a a, .b b, .cmp_ab /gt _c } {
    .sign sign,
    .k0 k_int,
    { .a x, .b y } f64_lsb_sub rem,
    .b den
  } f64_finish_normalized,
  { .sign sign, .k0 k0, .a a, .b b, .cmp_ab /lt _c } {
    .sign sign,
    { .k0 x, {} |_ |1 |+ y } f64_i_minus k_int,
    { .a f64_lsb_shl1 x, .b y } f64_lsb_sub rem,
    .b den
  } f64_finish_normalized
>;

ratio_to_float64 = {
  .sign sign,
  .num f64_trim_msb num,
  .den f64_trim_msb < /1 |1 > den
} <
  { .sign sign, .num /0 /_ _n, .den _d } { .sign sign, exp0 exponent, frac0 fraction },
  { .sign sign, .num /1 num, .den den } { .sign sign, .num |1 num, .den den } f64_ratio_nonzero
>;

bits_to_float64 = {
  {} |+ sign,
  () num,
  {} |_ |1 den
} ratio_to_float64;
