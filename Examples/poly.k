-- Examples/poly.k: Polymorphic list functions in k
-- Uses list constructors/destructors from Examples/list.k
-- and arbitrary-precision integer representations from Examples/arithmetics.k.

-- Decrement an integer and normalize its representation (stripping leading zeros)
pred_int = dec /'+' nat | '+';

-- Concatenate two lists: {xs, ys} -> list
concat = <
  {.xs /nil if, .ys then} .then,
  {.xs car car, {.xs cdr xs, .ys ys} concat cdr} cons
>;

-- Reverse a list: xs -> list
reverse = {() xs, nil acc} _reverse;
_reverse = <
  {.xs /nil if, .acc then} .then,
  {.xs cdr xs, {.xs car car, .acc cdr} cons acc} _reverse
>;

-- Length of a list: xs -> int
length = {() xs, 0 int acc} _length;
_length = <
  {.xs /nil if, .acc then} .then,
  {.xs cdr xs, .acc inc acc} _length
>;

-- Get N-th element of a list (0-indexed): {n, xs} -> element
get_nth = <
  {.n zero_int? if, .xs car then} .then,
  {.n pred_int n, .xs cdr xs} get_nth
>;

-- Split list at index N: {n, xs} -> {first, second}
split_by = {.n n, .xs xs, nil acc} _split_by;
_split_by = <
  {.n zero_int? if, {.acc reverse first, .xs second} then} .then,
  {.xs /nil if, {.acc reverse first, nil second} then} .then,
  {.n pred_int n, .xs cdr xs, {.xs car car, .acc cdr} cons acc} _split_by
>;

-- Take the first N elements of a list: {n, xs} -> list
take = split_by .first;

-- Drop the first N elements of a list: {n, xs} -> list
drop = <
  {.n zero_int? if, .xs then} .then,
  {.xs /nil if, nil then} .then,
  {.n pred_int n, .xs cdr xs} drop
>;

-- Repeat element X, N times: {n, x} -> list
repeat = {.n n, .x x, nil acc} _repeat;
_repeat = <
  {.n zero_int? if, .acc then} .then,
  {.n pred_int n, .x x, {.x car, .acc cdr} cons acc} _repeat
>;

-- Append an element to the end of a list: {x, xs} -> list
append = {.xs xs, {.x car, nil cdr} cons ys} concat;

-- Zip two lists into a list of {x, y} pairs: {xs, ys} -> list
zip = <
  {.xs /nil if, nil then} .then,
  {.ys /nil if, nil then} .then,
  {
    {.xs car x, .ys car y} car,
    {.xs cdr xs, .ys cdr ys} zip cdr
  } cons
>;
