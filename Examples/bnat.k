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

/****
typing:    <    .0     remove_leading_zeros    ,   ()    >
        :0   :1    :2                       :3  :4    :5    :6

?X0 = ?X1 = ?X4  -- comp+product+union-left -- 0,1,4 --> 0 
?X6 = ?X5 = ?X3  -- comp-union-right        -- 3,5,6 --> 3 -->0
?X0 = ?X2  -- input type of 'remove_leading_zeros' -- 0,2 --> 0
?X4 = ?X5  - identity type                         -- 4,5 --> 4 --> 0

?X1 = /?X2 0, .../ -- projection 
  ?X0 = /?X0 0, .../ -- only union type is possible here!!!
  ?X0 = <?X0 0, ...>
remove_leading_zeros: <?X0 0, ...> --> <?X0 0, ...> where ?X0 = <?X0 0, ...>


*/

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
<
  {.x._ x, .y y} .y,
  {.x.0 x, .y _0 y} _reverse_bnat,
  {.x.1 x, .y _1 y} _reverse_bnat
>;

_add2wc =
-- least significant bit first addition with carry
    ${bnat x, bnat y, bnat c}
    <
      {.x.0 x, .y.0 y, .c.0 c} {.x x, .y y, _ _0 c} _add2wc _0,
      {.x.0 x, .y.0 y, .c.1 c} {.x x, .y y, _ _0 c} _add2wc _1,

      {.x.0 x, .y.1 y, .c.0 c} {.x x, .y y, _ _0 c} _add2wc _1,
      {.x.0 x, .y.1 y, .c.1 c} {.x x, .y y, _ _1 c} _add2wc _0,
      
      {.x.1 x, .y.0 y, .c.0 c} {.x x, .y y, _ _0 c} _add2wc _1,
      {.x.1 x, .y.0 y, .c.1 c} {.x x, .y y, _ _1 c} _add2wc _0,
      
      {.x.1 x, .y.1 y, .c.0 c} {.x x, .y y, _ _1 c} _add2wc _0,
      {.x.1 x, .y.1 y, .c.1 c} {.x x, .y y, _ _1 c} _add2wc _1,
      {.x._ x, .c.0 c, .y y} .y,
      {.y._ y, .c.0 c, .x x} .x,
      {.x._ x, .c.1 c, .y._ y} n1,
      {.x._ x, .y.0 y, .c.1 c} .y _1,
      {.x.0 x, .y._ y, .c.1 c} .x _1,
      {.x._ x, .y.1 y, .c.1 c} {_ x, .y y, _ _1 c} _add2wc _0,
      {.x.1 x, .y._ y, .c.1 c} {.x x, _ y, _ _1 c} _add2wc _0      
>;

plus = { 
  .x remove_leading_zeros reverse_bnat x, 
  .y remove_leading_zeros reverse_bnat y, 
  _ _0 c } 
  _add2wc reverse_bnat;

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
    _ _0 c}
  _sub2wc
  reverse_bnat remove_leading_zeros;


mod   = < { shift mod x, .y y } mod, .x >;
shift = { x_minus_y x, { .y x, .y y } plus y } ; -- (x,y)->(x-y,2y);

----------------------------------------------------------------
[9,4] {
  () input,
  {.0 from_digit x, .1 from_digit y} 
  {x_minus_y to_digit minus, mod to_digit mod} result
} 
----------------------------------------------------------------
/****
typing mod =   <    {    shift    mod    x,    .y    y }    mod   ,    .x     >
positions:  :0 < :1 { :2 shift :3 mod :4 x, :5 .y :6 y } :7 mod :8, :9 .x :10 > :11

variables:
?X0 = ?X1 = ?X2 = ?X5 = ?X9 -- comp + product + union (input) 0,1,2,5,9 --> 0
?X11 = ?X10 = ?X8 -- comp + union  (output)                   8,10,11   --> 8
?X3 = ?X0 = ?X7 -- input type of 'mod'                        0,3,7     --> 0
?X4 = ?X11 =* ?X8-- output type of 'mod'                      4,8,11    --> 8
                                                              6         --> 6
?X7 = {?X4 x, ?X6 y} -- output for product
  ?X0 = {?X8 x, ?X6 y}

mod: {$X x, $Y y} -> $X
*******/
