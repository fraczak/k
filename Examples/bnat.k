-- Standard binary encoding of natural
-- numbers with addition (+).

$ bnat = < {} _, bnat 0, bnat 1 >;

_ = {{} _};
_1 = {() 1};
_0 = {() 0};

n0 = _ ;
n1 = _ _1;

from_digit = <
    [0, ()] EQ _,               -- {_: {}}
    [1, ()] EQ n1,              -- {"1": {_: {}}}
    [2, ()] EQ _ _0 _1,         -- {"1": {"0": {_: {}}}}
    [3, ()] EQ _ _1 _1,         -- {"1": {"1": {_: {}}}}
    [4, ()] EQ _ _0 _0 _1,      -- {"1": {"0": {"0": {_: {}}}}}
    [5, ()] EQ _ _1 _0 _1,
    [6, ()] EQ _ _0 _1 _1,
    [7, ()] EQ _ _1 _1 _1,
    [8, ()] EQ _ _0 _0 _0 _1,
    [9, ()] EQ _ _1 _0 _0 _1,
    [10, ()] EQ _ _0 _1 _0 _1
>;

to_digit = <
          ._  0,
        .1._  1,
      .1.0._  2,
      .1.1._  3,
    .1.0.0._  4,
    .1.0.1._  5,
    .1.1.0._  6,
    .1.1.1._  7,
  .1.0.0.0._  8,
  .1.0.0.1._  9,
  .1.0.1.0._ 10,
  .1.0.1.1._ 11,
  .1.1.0.0._ 12,
  .1.1.0.1._ 13,
  .1.1.1.0._ 14,
  .1.1.1.1._ 15
> ;

remove_leading_zeros =
      < .0 remove_leading_zeros, () >;


_append_zero =
     < ._ _ _0,             -- ( _ ->  0 _)
       .1 _append_zero _1,  -- ('1 ... -> '1 [$.1 | _append_zero]),
       .0 _append_zero _0   -- ('0 ... -> '0 [$.0 | _append_zero]),
     >
;

_append_one =
     <
        ._ _ _1,
        .1 _append_one _1,
        .0 _append_one _0
     >
;

reverse_bnat = {() x, _ y} _reverse_bnat;

_reverse_bnat =
${bnat x, bnat y}
<
  {.x._ x, .y y} .y,
  {.x.0 x, .y _0 y} _reverse_bnat,
  {.x.1 x, .y _1 y} _reverse_bnat
>;

_add2wc =
-- least significant bit first addition with carry
    ${bnat x, bnat y, <{} 0, {} 1> c}
    <
      {.x.0 x, .y.0 y, .c.0 c} {.x x, .y y, {} _0  c} _add2wc _0,
      {.x.0 x, .y.0 y, .c.1 c} {.x x, .y y, {} _0 c} _add2wc _1,

      {.x.0 x, .y.1 y, .c.0 c} {.x x, .y y, {} _0 c} _add2wc _1,
      {.x.0 x, .y.1 y, .c.1 c} {.x x, .y y, {} _1 c} _add2wc _0,
      
      {.x.1 x, .y.0 y, .c.0 c} {.x x, .y y, {} _0 c} _add2wc _1,
      {.x.1 x, .y.0 y, .c.1 c} {.x x, .y y, {} _1 c} _add2wc _0,
      
      {.x.1 x, .y.1 y, .c.0 c} {.x x, .y y, {} _1 c} _add2wc _0,
      {.x.1 x, .y.1 y, .c.1 c} {.x x, .y y, {} _1 c} _add2wc _1,
      {.x._ x, .c.0 c, .y y} .y,
      {.y._ y, .c.0 c, .x x} .x,
      {.x._ x, .c.1 c, .y._ y} n1,
      {.x._ x, .y.0 y, .c.1 c} .y _1,
      {.x.0 x, .y._ y, .c.1 c} .x _1,
      {.x._ x, .y.1 y, .c.1 c} {_ x, .y y, {} _1 c} _add2wc _0,
      {.x.1 x, .y._ y, .c.1 c} {.x x, _ y, {} _1 c} _add2wc _0      
>;

plus = ${bnat x, bnat y} { 
  .x remove_leading_zeros reverse_bnat x, 
  .y remove_leading_zeros reverse_bnat y, 
  {} _0 c } 
  _add2wc reverse_bnat;

sum = <
  SNOC {.car x, .cdr sum y} plus,
  _
  >; 

to_string = <
  ._ "0",
  toStr
  >;

toStr = <
  ._ "",
  ["0", .0 toStr] CONCAT,
  ["1", .1 toStr] CONCAT
  >;

--[(), plus] 
--{
--  input: .0,
--  sum: {raw: .1, digits: .1 <to_digit,"...too big...">, binary: .1 to_string}
-- } 

_sub2wc = 
-- least significat bit first substraction with carry
-- _log!
  ${bnat x, bnat y, <{} 0, {} 1> c}
<
    -- ({...,       'y '_, 'c '0 } -> $.x ),
  {.x x, .y._ y, .c.0 c} .x,
    -- ({'x '1 ..., 'y '_, 'c '1 } -> '0 $.x.1 ),
  {.x.1 x, .y._ y, .c.1 c} .x _0,
    -- ({'x '0 ..., 'y '_, 'c '1 } ->    '1 [{'x $.x.0, 'y '_, 'c '1} | _sub2wc] ),
  {.x.0 x, .y._ _ y, .c.1 _1 c} _sub2wc _1,
    -- ({'x '0 ..., 'y '0 ..., 'c '0} -> '0 [{'x $.x.0, 'y $.y.0, 'c '0} | _sub2wc]),
  {.x.0 x, .y.0 y, .c.0 _0 c} _sub2wc _0,
    -- ({'x '0 ..., 'y '0 ..., 'c '1} -> '1 [{'x $.x.0, 'y $.y.0, 'c '1} | _sub2wc]),
  {.x.0 x, .y.0 y, .c.1 _1 c} _sub2wc _1,  
    -- ({'x '0 ..., 'y '1 ..., 'c '0} -> '1 [{'x $.x.0, 'y $.y.1, 'c '1} | _sub2wc]),
  {.x.0 x, .y.1 y, .c.0 _1 c} _sub2wc _1,
    -- ({'x '0 ..., 'y '1 ..., 'c '1} -> '0 [{'x $.x.0, 'y $.y.1, 'c '1} | _sub2wc]),
  {.x.0 x, .y.1 y, .c.1 _1 c} _sub2wc _0,
    -- ({'x '1 ..., 'y '0 ..., 'c '0} -> '1 [{'x $.x.1, 'y $.y.0, 'c '0} | _sub2wc]),
  {.x.1 x, .y.0 y, .c.0 _0 c} _sub2wc _1,
    -- ({'x '1 ..., 'y '0 ..., 'c '1} -> '0 [{'x $.x.1, 'y $.y.0, 'c '0} | _sub2wc]),
  {.x.1 x, .y.0 y, .c.1 _0 c} _sub2wc _0,
    -- ({'x '1 ..., 'y '1 ..., 'c '0} -> '0 [{'x $.x.1, 'y $.y.1, 'c '0} | _sub2wc]),
  {.x.1 x, .y.1 y, .c.0 _0 c} _sub2wc _0,
    -- ({'x '1 ..., 'y '1 ..., 'c '1} -> '1 [{'x $.x.1, 'y $.y.1, 'c '1} | _sub2wc])
  {.x.1 x, .y.1 y, .c.1 _1 c} _sub2wc _1
>;

x_minus_y =
  { .x remove_leading_zeros reverse_bnat x,
    .y remove_leading_zeros reverse_bnat y,
    {} _0 c}
  _sub2wc
  reverse_bnat remove_leading_zeros;

_sm =
/* This function "smart mult" calculates
   result + (multipl * reverse_nat(times))
*/
  ${bnat result, bnat multipl, bnat times}
  <
    {.times._ if, .result then} .then,
    {.times.0 times, .result result, .multipl _append_zero multipl } _sm,
    {.times.1 times, {.result x, .multipl y} plus result, .multipl _append_zero multipl} _sm
  >;

times = ${bnat x, bnat y} 
  { _ result, .x remove_leading_zeros multipl, .y remove_leading_zeros reverse_bnat times } _sm;

b_inc = {() x, _ _1 y} plus;
b_dec = {() x, _ _1 y} x_minus_y;

mod   = < { shift mod x, .y y } mod, .x >; -- (x,y)->((x-y mod 2y) mod y);
shift = ${bnat x, bnat y} { x_minus_y x, { .y x, .y y } plus y } ; -- (x,y)->(x-y,2y);

---

fromStr = $string toVEC fromVec;
fromVec = < {.0.0 if, SNOC.cdr fromVec _0 then} .then, {.0.1 if, SNOC.cdr fromVec _1 then} .then, _>;
bmod = {.0 fromStr x, .1 fromStr y} mod to_string;
bplus = {.0 fromStr x, .1 fromStr y} plus to_string;

b_pow = 
  ${bnat x, bnat pow}
  <
    .pow remove_leading_zeros ._ _ _1,
    {.x x, {.x x, .pow b_dec pow} b_pow y} times  
  >;

b_10 = 10 from_digit;
positions = {() in, [] out} positions_ ;
positions_ = <
  {.in SNOC.cdr in, {.out <{.0 x, b_10 y} times , _ _1> car, .out cdr} CONS out} positions_,
  .out
>;



/*
-- needs 'nth.k' for Zip
fromDigits = toVEC { () x, positions y} Zip (| {.x fromJSON from_digit x, .y y} times ^) sum;
*/
----------------------------------------------------------------
-- [9,4] 
{
  () input,
  | from_digit to_string ^ bitinput, 
  {.0 from_digit x, .1 from_digit y} 
  {x_minus_y to_digit minus, mod to_digit mod, times to_string times} result
} 
