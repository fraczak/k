-- Examples/poly.k: Polymorphic list functions in k
-- Uses arbitrary-precision integers from Examples/arithmetics.k.

-- List constructors and destructors
list[X] = < {} nil, { X car, Y cdr } cons > = Y;
list? = ? list[X];

pair[A, B] = { A first, B second };
list_pair[X] = { list[X] xs, list[X] ys };
indexed_list[X] = { int[] n, list[X] xs };
split_result[X] = { list[X] first, list[X] second };
reverse_state[X] = { list[X] xs, list[X] acc };
split_by_state[X] = { int[] n, list[X] xs, list[X] acc };
repeat_args[X] = { int[] n, X x };
repeat_state[X] = { int[] n, X x, list[X] acc };
append_args[X] = { X x, list[X] xs };
split_step_state[X] = {
  list[X] xs, list[X] first, list[X] second
};
int_pair[] = { int[] x, int[] y };
nil = {} | nil list?;
singleton = {() car, nil cdr} | cons list?;
cons = {.car car, .cdr cdr} | cons list?;
nil? = list? / nil nil;
car = list? /cons .car;
cdr = list? /cons .cdr;

-- Decrement an integer and normalize (stripping leading zeros)
pred_int = dec /'+' nat | '+';

-- Concatenate two lists: {xs, ys} -> list
concat = ? list_pair[X] {.xs reverse xs, .ys acc} _reverse;

-- Reverse a list: xs -> list
reverse = ? list[X] {() xs, nil acc} _reverse;
_reverse = ? reverse_state[X] <
  {.xs cdr xs, {.xs car car, .acc cdr} cons acc} _reverse,
  .acc
>;

-- Length of a list: xs -> int
length = {() xs, 0 int acc} _length;
_length = <
  {.xs /nil if, .acc then} .then,
  {.xs cdr xs, .acc inc acc} _length
>;

-- Get N-th element of a list (0-indexed): {n, xs} -> element
get_nth = ? indexed_list[X] <
  {.n zero_int? if, .xs car then} .then,
  {.n pred_int n, .xs cdr xs} get_nth
>;

-- Split list at index N: {n, xs} -> {first, second}
split_by = ? indexed_list[X] {.n n, .xs xs, nil acc} _split_by;
_split_by = ? split_by_state[X] <
  {.n zero_int? if, {.acc reverse first, .xs second} then} .then,
  {.xs /nil if, {.acc reverse first, nil second} then} .then,
  {.n pred_int n, .xs cdr xs, {.xs car car, .acc cdr} cons acc} _split_by
>;

-- Take the first N elements of a list: {n, xs} -> list
take = ? indexed_list[X] split_by .first;

-- Drop the first N elements of a list: {n, xs} -> list
drop = ? indexed_list[X] <
  {.n zero_int? if, .xs then} .then,
  {.xs /nil if, nil then} .then,
  {.n pred_int n, .xs cdr xs} drop
>;

-- Repeat element X, N times: {n, x} -> list
repeat = ? repeat_args[X] {.n n, .x x, nil acc} _repeat;
_repeat = ? repeat_state[X] <
  {.n zero_int? if, .acc then} .then,
  {.n pred_int n, .x x, {.x car, .acc cdr} cons acc} _repeat
>;

-- Append an element to the end of a list: {x, xs} -> list
append = ? append_args[X] {.xs xs, {.x car, nil cdr} cons ys} concat;

-- Zip two lists into a list of {x, y} pairs: {xs, ys} -> list
zip = ? list_pair[X] <
  {.xs /nil if, nil then} .then,
  {.ys /nil if, nil then} .then,
  {
    {.xs car x, .ys car y} car,
    {.xs cdr xs, .ys cdr ys} zip cdr
  } cons
>;

-- Gen list of intgers: n -> [0, 1, ..., n]
gen_list = {() n, nil list} gen_list_; 
gen_list_ = <
  {.n neg? if, .list then} .then, 
  {.n dec n, {.n car, .list cdr} cons list} gen_list_
>;

-- Identity filter on {x, y} when x is greater than y: ?{X x, X y}=Y -> ?Y
gt? = ? int_pair[]
  <
    {.x/- if1, .y/+ if2, () then} .then,
    {{.x/- y, .y/- x} GT if, () then} .then,
    {{.x/+ x, .y/+ y} GT if, () then} .then
  >
;

-- Split list into two halves by alternating elements:
-- xs -> {first, second}
split = ? list[X] {() xs, nil first, nil second} _split;
_split = ? split_step_state[X] <
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
merge = ? list_pair[X] <
  {.xs /nil if, .ys then} .then,
  {.ys /nil if, .xs then} .then,
  {
    {.xs car x, .ys car y} gt? if,
    {.ys car car, {.xs xs, .ys cdr ys} merge cdr} cons then
  } .then,
  {.xs car car, {.xs cdr xs, .ys ys} merge cdr} cons
>;

-- Sort a list in ascending order (merge sort): xs -> list
sort = list? <
  /nil nil,
  /cons <
    {.cdr /nil if, .car singleton then} .then,
    |cons split {.first sort xs, .second sort ys} merge
  >
> list?;


