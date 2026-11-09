-- Examples/arithmetics.k — Higher-level arithmetic examples:
-- factorial, Fibonacci, and exact rational numbers (rat[])

---------------------------------------------------------------
-- §1. Base Patterns, Primitives & Imported Relations
---------------------------------------------------------------

bits[] = < {} _, B 0, B 1 > = B;
int[]  = < bits[] -, bits[] + >;

_         = {} |_ ?bits[];
0b        = |0 ?bits[];
1b        = |1 ?bits[];
0         = _ 0b;
1         = _ 1b;
pos_int   = |+ ?int[];
neg_int   = |- ?int[];
un_pos    = ?int[] /+;
un_neg    = ?int[] /-;

# --lib lib/arithmetics.k --use nat int abs pos? neg? zero_int? swap_sign inc dec plus minus times div mod gcd lcm
nat       = @ktrZRefK3zvnUqYYisWBH3MgzcQJD9hs2P5LeSJ7tFrA;
int       = @BgUayEar88hcmcAYM5giDsucyGbtumbaXpyussK8k7vm;
abs       = @Ddc8MjqrgS5t9dPUFQKkBHTLmrcxazshhCwN9HHGtd35;
pos?      = @DExHRdJ6UPsdQEWM6ZenLCUyXLwwZfTRq6CZHf5iahJp;
neg?      = @Hwv3CjPRgtJDb7ZGn7cReF9iZ25LFpjv2MXRBJyUGBij;
zero_int? = @eYsSuRAeFTejC7W9mLLtxuSeebLuszMGxadnZsg4iuUf;
swap_sign = @PXVmSLQzpkiLL8qAWLp3MKRAxvwN72hNs64Q2k5hQQS7;
inc       = @FpWRmLNa6guwACtpwYUAuX3usE27WqAKPzQxrVRtyKND;
dec       = @3YRXdfNimGSWfSpCcTzBauTU7HRrjLUFMp4dbRZGhJXv;
plus      = @mfq4QANXe43SuEGb5wM256eKrE7E28BteUgWUxNCLJa6;
minus     = @RdyBXVdSsmFBa7gSBprpFEtktzRrkeFZMrQSk6L4JiBz;
times     = @HCBYSVndz9bsMsBPtFA8auXiMLbJTfELsu9PsXKNSuSw;
div       = @SMg7EvWCmmVaEuLKFzasvSqdyYthsTcGPueypecetysk;
mod       = @g3EchGkuPu29bjTRKZMpxePRSzanyffFvCKgwEBz4SuX;
gcd       = @F32iDHCtp5jvgx2TC6jPJPLSPYX2RyS7EjwxdTMXLCAf;
lcm       = @C2GmSRuqEVawpDA6WBGanePw7Gq3rmzsRqXNb6yQHryL;

---------------------------------------------------------------
-- §2. Factorial & Fibonacci
---------------------------------------------------------------

factorial_ = <
  { .n zero_int? if, .acc then } .then,
  { .n pos? dec n, { .n x, .acc y } times acc } factorial_
>;
factorial = { () n, 1 int acc } factorial_;

fib_ = <
  { .n zero_int? if, .pair then } .then,
  {
    .n pos? dec n,
    .pair { plus x, .x y } pair
  } fib_
>;
fib = { () n, { 1 int x, 0 int y } pair } fib_ .x;

---------------------------------------------------------------
-- §3. Rational Numbers (rat[])
---------------------------------------------------------------

rat[] = { int[] n, int[] d };

normalize_rat =
  <
    { .d neg? if, { .n swap_sign n, .d swap_sign d } then } .then,
    { .d pos? if, { .n ?int[] n, .d d } then } .then
  >
  { () x, { .n abs x, .d abs y } gcd int y }
  {
    { .x.n x, .y y } div .div n,
    { .x.d x, .y y } div .div d
  };

rat = { .n int n, .d int d } normalize_rat;

plus_rat =
  { .x x, .y y, { .x.d abs x, .y.d abs y } lcm int lcm }
  {
    {
      { .x.n x, { .lcm x, .x.d y } div .div y } times x,
      { .y.n x, { .lcm x, .y.d y } div .div y } times y
    } plus n,
    .lcm d
  }
  normalize_rat;

times_rat =
  {
    { .x.n x, .y.n y } times n,
    { .x.d x, .y.d y } times d
  }
  normalize_rat;

minus_rat =
  { .x x, .y { .n swap_sign n, .d d } y }
  plus_rat;

inverse_rat =
  { .d n, .n d }
  normalize_rat;

div_rat =
  { .x x, .y inverse_rat y } times_rat;

int_rat =
  { .n n, .d d, { .n x, .d y } div div }
  { .div.div int, { .div.rem int n, .d d } normalize_rat rat };
