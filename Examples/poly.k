-- Examples/poly.k: Polymorphic list functions in k
-- Uses arbitrary-precision integers from Examples/arithmetics.k.

int[] = @Nws3vysWqC9PznraTP4kWPp44Rd77NAqrx9dgbtHAjGA[];
dec = @5KHpeRC9ttY3Xr3nxUppCmdDiQeb9jALAKydqbQ4cims;
nat = @D39Vu9wCCxSqGif6P4csWhBqW7iEZARGwzNrhXZF2erB;
0 = @4u5HUXEyPjb3ts7Y269aX2ZyReMm3dZUfsURv3CsaQju;
int = @qj5fvkMmQSLRVQPPft93pj7zGFLuMcw8UB6QmJZVZEqW;
inc = @9qsrKfAtXQgC2dxuHcryfsMc6FJKDKjZWqdt9gzULxAj;
zero_int? = @5KP7SBHTAkr7qxxcNqjA5pf3NRLdzMCTGqRyWzZMwAQT;
neg? = @qHsFhcAZcrrUtCtwBRCtRG63hBJKjm25P5DbK4GfdWHe;
GT = @rRhDaVjcGKLCUGsiwGmQc27dncDaAjU54xzARehsLwXA;

-- List constructors and destructors
list[X] = < {} nil, { X car, Y cdr } cons > = Y;
list? = ? list[X];

nil = {} | nil ?list[X];
singleton = {() car, nil cdr} | cons ?list[X];
cons = {.car car, .cdr cdr} | cons ?list[X];
nil? = ?list[X] / nil nil;
car = ?list[X] /cons .car;
cdr = ?list[X] /cons .cdr;

-- Decrement an integer and normalize (stripping leading zeros)
pred_int = dec /'+' nat | '+';

-- Concatenate two lists: {xs, ys} -> list
concat = ?{list[X]=xs xs, xs ys} {.xs reverse xs, .ys acc} _reverse;

-- Reverse a list: xs -> list
reverse = ? list[X] {() xs, nil acc} _reverse;
_reverse = ? { list[X] xs, list[X] acc } <
  {.xs cdr xs, {.xs car car, .acc cdr} cons acc} _reverse,
  .acc
>;

-- Length of a list: xs -> int
length = {?list[(...)] xs, 0 int acc} _length;
_length = <
  {.xs /nil if, .acc then} .then,
  {.xs cdr xs, .acc inc acc} _length
>;

-- Get N-th element of a list (0-indexed): {n, xs} -> element
get_nth = ? { int[] n, list[X] xs } <
  {.n zero_int? if, .xs car then} .then,
  {.n pred_int n, .xs cdr xs} get_nth
>;

-- Split list at index N: {n, xs} -> {first, second}
split_by = ? { int[] n, list[X] xs } {.n n, .xs xs, nil acc} _split_by;
_split_by = ? { int[] n, list[X] xs, list[X] acc } <
  {.n zero_int? if, {.acc reverse first, .xs second} then} .then,
  {.xs /nil if, {.acc reverse first, nil second} then} .then,
  {.n pred_int n, .xs cdr xs, {.xs car car, .acc cdr} cons acc} _split_by
>;

-- Take the first N elements of a list: {n, xs} -> list
take = ? { int[] n, list[X] xs } split_by .first;

-- Drop the first N elements of a list: {n, xs} -> list
drop = ? { int[] n, list[X] xs } <
  {.n zero_int? if, .xs then} .then,
  {.xs /nil if, nil then} .then,
  {.n pred_int n, .xs cdr xs} drop
>;

-- Repeat element X, N times: {n, x} -> list
repeat = ? { int[] n, X x } {.n n, .x x, nil acc} _repeat;
_repeat = ? { int[] n, X x, list[X] acc } <
  {.n zero_int? if, .acc then} .then,
  {.n pred_int n, .x x, {.x car, .acc cdr} cons acc} _repeat
>;

-- Append an element to the end of a list: {x, xs} -> list
append = ? { X x, list[X] xs }
  {.xs xs, {.x car, nil cdr} cons ys} concat;

-- Zip two lists into a list of {x, y} pairs: {xs, ys} -> list
zip = {.xs xs, .ys ys, nil acc} zip_;
zip_ = <
  {<.xs nil?, .ys nil?> if, .acc reverse then} .then,
  { .xs cdr xs,
    .ys cdr ys,
    {
      {.xs car x, .ys car y} car,
      .acc cdr
    } cons acc
  } zip_ 
>;

-- Gen list of intgers: n -> [0, 1, ..., n]
gen_list = {() n, nil list} gen_list_; 
gen_list_ = <
  {.n neg? if, .list then} .then, 
  {.n dec n, {.n car, .list cdr} cons list} gen_list_
>;

-- Identity filter on {x, y} when x is greater than y: ?{X x, X y}=Y -> ?Y
gt? = ?  { int[] x, int[] y }
  <
    {.x/- if1, .y/+ if2, () then} .then,
    {{.x/- y, .y/- x} GT if, () then} .then,
    {{.x/+ x, .y/+ y} GT if, () then} .then
  >
;

-- Split list into two halves by alternating elements:
-- xs -> {first, second}
split = ? list[X] {() xs, nil first, nil second} _split;
_split = ? { list[X] xs, list[X] first, list[X] second } <
  {.xs /nil if, {.first first, .second second} then} .then,
  {
    .xs cdr /nil if,
    {{.xs car car, .first cdr} cons first, .second second} then
  } .then,
  {
    .xs cdr cdr xs,
    {.xs car car, .first cdr} cons first,
    {.xs cdr car car, .second cdr} cons second
  } _split
>;

-- Merge two sorted lists: {xs, ys} -> list
merge = ? {list[X] xs, list[X] ys} <
  {.xs /nil if, .ys then} .then,
  {.ys /nil if, .xs then} .then,
  {
    {.xs car x, .ys car y} gt? if,
    {.ys car car, {.xs xs, .ys cdr ys} merge cdr} cons then
  } .then,
  {.xs car car, {.xs cdr xs, .ys ys} merge cdr} cons
>;

-- Sort a list in ascending order (merge sort): xs -> list
sort = ?list[X] <
  /nil nil,
  /cons <
    {.cdr /nil if, .car singleton then} .then,
    |cons split {.first sort xs, .second sort ys} merge
  >
> ?list[X];


