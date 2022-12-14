-- Standard binary encoding of natural
-- numbers with addition (+).

_ = {{} _};
_1 = {() "1"};
_0 = {() "0"};

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
              ."1"._  1,
          ."1"."0"._  2,
          ."1"."1"._  3,
      ."1"."0"."0"._  4,
      ."1"."0"."1"._  5,
      ."1"."1"."0"._  6,
      ."1"."1"."1"._  7,
  ."1"."0"."0"."0"._  8,
  ."1"."0"."0"."1"._  9,
  ."1"."0"."1"."0"._ 10,
  ."1"."0"."1"."1"._ 11,
  ."1"."1"."0"."0"._ 12,
  ."1"."1"."0"."1"._ 13,
  ."1"."1"."1"."0"._ 14,
  ."1"."1"."1"."1"._ 15
> ;

remove_leading_zeros =
      < ."0" remove_leading_zeros, () >;

_append_zero =
     < ._ _ _0,          -- ( _ ->  0 _)
       ."1" _append_zero _1,  -- ('1 ... -> '1 [$.1 | _append_zero]),
       ."0" _append_zero _0   -- ('0 ... -> '0 [$.0 | _append_zero]),
     >
;

_append_one =
     <
        ._ _ _1,
        ."1" _append_one _1,
        ."0" _append_one _0
     >
;

reverse_bnat = {() x, _ y} _reverse_bnat;

_reverse_bnat =
<
  {.x._ x, .y y} .y,
  {.x."0" x, .y _0 y} _reverse_bnat,
  {.x."1" x, .y _1 y} _reverse_bnat
>;

_add2wc =
-- least significant bit first addition with carry
--- :{ :bnat x, :bnat y, :[0,1] c}
    -- _log!
    <
      {.x."0" x, .y."0" y, .c."0" c} {.x x, .y y, _ _0 c} _add2wc _0,
      {.x."0" x, .y."0" y, .c."1" c} {.x x, .y y, _ _0 c} _add2wc _1,

      {.x."0" x, .y."1" y, .c."0" c} {.x x, .y y, _ _0 c} _add2wc _1,
      {.x."0" x, .y."1" y, .c."1" c} {.x x, .y y, _ _1 c} _add2wc _0,
      
      {.x."1" x, .y."0" y, .c."0" c} {.x x, .y y, _ _0 c} _add2wc _1,
      {.x."1" x, .y."0" y, .c."1" c} {.x x, .y y, _ _1 c} _add2wc _0,
      
      {.x."1" x, .y."1" y, .c."0" c} {.x x, .y y, _ _1 c} _add2wc _0,
      {.x."1" x, .y."1" y, .c."1" c} {.x x, .y y, _ _1 c} _add2wc _1,
      {.x._ x, .c."0" c, .y y} .y,
      {.y._ y, .c."0" c, .x x} .x,
      {.x._ x, .c."1" c, .y._ y} n1,
      {.x._ x, .y."0" y, .c."1" c} .y _1,
      {.x."0" x, .y._ y, .c."1" c} .x _1,
      {.x._ x, .y."1" y, .c."1" c} {_ x, .y y, {} _1 c} _add2wc _0,
      {.x."1" x, .y._ y, .c."1" c} {.x x, _ y, {} _1 c} _add2wc _0      
>;

plus = <
  SNOC { 
    x: .0 from_digit remove_leading_zeros reverse_bnat,
    y: .1 plus remove_leading_zeros reverse_bnat,
    c: {} _0 } _add2wc reverse_bnat,
  .0 from_digit
>;

to_string = <
  ._ "0",
  toString
>;

toString = <
  ._ "",
  ["0", ."0" toString] CONCAT,
  ["1", ."1" toString] CONCAT
>;

[(), plus] 
{
  input: .0,
  sum: {raw: .1, digits: .1 <to_digit,"...too big...">, binary: .1 to_string}
} 

-- example: > echo '[9,9,9,8]' | ./k.sh -k ./bnat.k  
