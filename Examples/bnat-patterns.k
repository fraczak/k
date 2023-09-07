-- Standard binary encoding of natural
-- numbers with addition (+).

$bnat = < {} _, bnat 0, bnat 1 >;

_ = {${} _} $bnat;
_1 =  {$bnat 1} $bnat;
_0 =  {$bnat 0} $bnat;

remove_leading_zeros = $bnat
  < .0 remove_leading_zeros, () >
;

_append_zero = $bnat
     < ._ _ _0,             
       .1 _append_zero _1,  
       .0 _append_zero _0
     >
;

_append_one = $bnat
     <
        ._ _ _1,
        .1 _append_one _1,
        .0 _append_one _0
     >
;

reverse_bnat = $bnat {() x, {} _ y} _reverse_bnat $bnat;


_reverse_bnat = ${ bnat x, bnat y }
<
  {.x._ x, .y y} .y,
  {.x.0 x, .y _0 y} _reverse_bnat,
  {.x.1 x, .y _1 y} _reverse_bnat
>;

_add2wc =
-- least significant bit first addition with carry
    ${ bnat x, bnat y, < {} 0, {} 1> c}
    <
      {.x.0 x, .y.0 y, .c.0 c} {.x x, .y y, {{} 0} c} _add2wc _0,
      {.x.0 x, .y.0 y, .c.1 c} {.x x, .y y, {{} 0} c} _add2wc _1,

      {.x.0 x, .y.1 y, .c.0 c} {.x x, .y y, {{} 0} c} _add2wc _1,
      {.x.0 x, .y.1 y, .c.1 c} {.x x, .y y, {{} 1} c} _add2wc _0,
      
      {.x.1 x, .y.0 y, .c.0 c} {.x x, .y y, {{} 0} c} _add2wc _1,
      {.x.1 x, .y.0 y, .c.1 c} {.x x, .y y, {{} 1} c} _add2wc _0,
      
      {.x.1 x, .y.1 y, .c.0 c} {.x x, .y y, {{} 1} c} _add2wc _0,
      {.x.1 x, .y.1 y, .c.1 c} {.x x, .y y, {{} 1} c} _add2wc _1,
      {.x._ x, .c.0 c, .y y} .y,
      {.y._ y, .c.0 c, .x x} .x,
      {.x._ x, .c.1 c, .y._ y} {} _ _1,
      {.x._ x, .y.0 y, .c.1 c} .y _1,
      {.x.0 x, .y._ y, .c.1 c} .x _1,
      {.x._ x, .y.1 y, .c.1 c} {{} _ x, .y y, {{} 1} c} _add2wc _0,
      {.x.1 x, .y._ y, .c.1 c} {.x x, {} _ y, {{} 1} c} _add2wc _0      
>;

plus = { 
  .x remove_leading_zeros reverse_bnat x, 
  .y remove_leading_zeros reverse_bnat y, 
  {{} 0} c } 
  _add2wc reverse_bnat;

_sub2wc = 
-- least significat bit first substraction with carry
<
  {.x   x, .y._ y, .c.0 c} .x,
  {.x.1 x, .y._ y, .c.1 c} .x _0,
  {.x.0 x, .y._ _ y, {.c.1 1} c} _sub2wc _1,
  {.x.0 x, .y.0 y, {.c.0 0} c} _sub2wc _0,
  {.x.0 x, .y.0 y, {.c.1 1} c} _sub2wc _1,  
  {.x.0 x, .y.1 y, {.c.0 1} c} _sub2wc _1,
  {.x.0 x, .y.1 y, {.c.1 1} c} _sub2wc _0,
  {.x.1 x, .y.0 y, {.c.0 0} c} _sub2wc _1,
  {.x.1 x, .y.0 y, {.c.1 0} c} _sub2wc _0,
  {.x.1 x, .y.1 y, {.c.0 0} c} _sub2wc _0,
  {.x.1 x, .y.1 y, {.c.1 1} c} _sub2wc _1
>;

x_minus_y =
  { .x remove_leading_zeros reverse_bnat x,
    .y remove_leading_zeros reverse_bnat y,
    {{} 0} c}
  _sub2wc
  reverse_bnat remove_leading_zeros;


mod   = < { shift mod x, .y y } mod, .x >;
shift = { x_minus_y x, { .y x, .y y } plus y } ; 

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

mod

-- echo '{"x":{"1":{"1":{"_":{}}}},"y":{"1":{"1":{"1":{"_":{}}}}}}' | k -k Examples/bnat-patterns.k 
