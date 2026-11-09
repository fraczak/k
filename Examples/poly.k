-- Examples/poly.k — Polymorphic list operations indexed by int[]

---------------------------------------------------------------
-- §1. Base Patterns, Primitives & Imported Relations
---------------------------------------------------------------

bits[]  = < {} _, B 0, B 1 > = B;
int[]   = < bits[] -, bits[] + >;
list[X] = < {} nil, { X car, L cdr } cons > = L;

_         = {} |_ ?bits[];
0b        = |0 ?bits[];
0         = _ 0b;
pos_int   = |+ ?int[];
neg_int   = |- ?int[];
un_pos    = ?int[] /+;
un_neg    = ?int[] /-;

nil       = {} |nil ?list[X];
cons      = |cons ?list[X];
un_nil    = ?list[X] /nil;
car       = ?list[X] /cons .car;
cdr       = ?list[X] /cons .cdr;
nil?      = un_nil nil;
singleton = { () car, nil cdr } cons;

# --lib lib/arithmetics.k --use nat int neg? zero_int? GT inc dec
nat       = @ktrZRefK3zvnUqYYisWBH3MgzcQJD9hs2P5LeSJ7tFrA;
int       = @BgUayEar88hcmcAYM5giDsucyGbtumbaXpyussK8k7vm;
neg?      = @Hwv3CjPRgtJDb7ZGn7cReF9iZ25LFpjv2MXRBJyUGBij;
zero_int? = @eYsSuRAeFTejC7W9mLLtxuSeebLuszMGxadnZsg4iuUf;
GT        = @qWipdJHEEG3KccU4RVFLrWciLCvP2Cbz7myNxjNtvUCP;
inc       = @FpWRmLNa6guwACtpwYUAuX3usE27WqAKPzQxrVRtyKND;
dec       = @3YRXdfNimGSWfSpCcTzBauTU7HRrjLUFMp4dbRZGhJXv;

# --lib lib/list.k --use rev_append reverse
rev_append = @7xb2uLU5cS7XgmFbKMrvg4UwpcTQ3whSMzBMeaSnGwkm;
reverse    = @peiZq2evd5u4Qk42AT3W4YmWZZ3JAeXNKTnmDtpb9EZh;

---------------------------------------------------------------
-- §2. Polymorphic List Operations
---------------------------------------------------------------

-- Decrement a positive integer and normalize
pred_int = dec un_pos nat pos_int;

-- Concatenate two lists: {xs, ys} -> list
concat = { .xs reverse x, .ys y } rev_append;

-- Length of a list: xs -> int
length_loop = <
  { .xs un_nil if, .acc then } .then,
  { .xs cdr xs, .acc inc acc } length_loop
>;
length = { () xs, 0 int acc } length_loop;

-- Get N-th element of a list (0-indexed): {n, xs} -> element
get_nth = <
  { .n zero_int? if, .xs car then } .then,
  { .n pred_int n, .xs cdr xs } get_nth
>;

-- Split list at index N: {n, xs} -> {first, second}
split_by_loop = <
  { .n zero_int? if, { .acc reverse first, .xs second } then } .then,
  { .xs un_nil if, { .acc reverse first, nil second } then } .then,
  { .n pred_int n, .xs cdr xs, { .xs car car, .acc cdr } cons acc } split_by_loop
>;
split_by = { .n n, .xs xs, nil acc } split_by_loop;

-- Take the first N elements of a list: {n, xs} -> list
take = split_by .first;

-- Drop the first N elements of a list: {n, xs} -> list
drop = <
  { .n zero_int? if, .xs then } .then,
  { .xs un_nil if, nil then } .then,
  { .n pred_int n, .xs cdr xs } drop
>;

-- Repeat element X, N times: {n, x} -> list
repeat_loop = <
  { .n zero_int? if, .acc then } .then,
  { .n pred_int n, .x x, { .x car, .acc cdr } cons acc } repeat_loop
>;
repeat = { .n n, .x x, nil acc } repeat_loop;

-- Append an element to the end of a list: {x, xs} -> list
append = { .xs xs, .x singleton ys } concat;

-- Zip two lists into a list of {x, y} pairs: {xs, ys} -> list
zip_loop = <
  { < .xs un_nil, .ys un_nil > if, .acc reverse then } .then,
  {
    .xs cdr xs,
    .ys cdr ys,
    { { .xs car x, .ys car y } car, .acc cdr } cons acc
  } zip_loop
>;
zip = { .xs xs, .ys ys, nil acc } zip_loop;

-- Generate list of integers: n -> [0, 1, ..., n]
gen_list_loop = <
  { .n neg? if, .list then } .then,
  { .n dec n, { .n car, .list cdr } cons list } gen_list_loop
>;
gen_list = { () n, nil list } gen_list_loop;

-- Identity filter on {x, y} when x > y
gt? = <
  { .x un_neg if1, .y un_pos if2, () then } .then,
  { { .x un_neg y, .y un_neg x } GT if, () then } .then,
  { { .x un_pos x, .y un_pos y } GT if, () then } .then
>;

-- Split list into two halves by alternating elements: xs -> {first, second}
split_loop = <
  { .xs un_nil if, { .first first, .second second } then } .then,
  {
    .xs cdr un_nil if,
    { { .xs car car, .first cdr } cons first, .second second } then
  } .then,
  {
    .xs cdr cdr xs,
    { .xs car car, .first cdr } cons first,
    { .xs cdr car car, .second cdr } cons second
  } split_loop
>;
split = { () xs, nil first, nil second } split_loop;

-- Merge two sorted lists: {xs, ys} -> list
merge = <
  { .xs un_nil if, .ys then } .then,
  { .ys un_nil if, .xs then } .then,
  {
    { .xs car x, .ys car y } gt? if,
    { .ys car car, { .xs xs, .ys cdr ys } merge cdr } cons then
  } .then,
  { .xs car car, { .xs cdr xs, .ys ys } merge cdr } cons
>;

-- Sort a list in ascending order (merge sort): xs -> list
sort = <
  un_nil nil,
  { cdr un_nil if, car singleton then } .then,
  split { .first sort xs, .second sort ys } merge
>;
