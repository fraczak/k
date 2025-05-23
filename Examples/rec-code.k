$ t = < { t l, @bits v, t r } t, {} _ >;

t = 
$ {t l, @bits v, t r} 
  {() t} 
$ t
;

empty = {{} _} $t;

leave = 
$ @bits 
  { empty l, 
    () v, 
    empty r 
  } t 
$ t
; 

sort = 
$ [ @bits ]
  <
    SNOC { .car x, .cdr sort t } insert,
    { empty l, .0 v, empty r } t,
    empty
  >
$ t
;

inv = {()x, '' r} _inv; 
_inv = < {.x /0 x, .r *0 r} _inv, {.x /1 x, .r *1 r} _inv, .r >;

$ flag = < {} yes, {} no >;
swap = < {.yes no}, {.no yes} >;
inOrder = ${@bits x, @bits y} {.x inv x, .y inv y, {{} yes} $flag inOrder} inOrder_ $flag;
inOrder_ = < 
    {.x /0 x, .y /0 y, .inOrder inOrder} inOrder_, 
    {.x /1 x, .y /1 y, .inOrder inOrder} inOrder_,
    {.x /0 x, .y /1 y, .inOrder inOrder} inOrder_, 
    {.x /1 y, .y /0 x, .inOrder swap inOrder} inOrder_, 
    {.x </0,/1> if, .inOrder swap then} .then, 
    .inOrder
>;

GT = {{.0 x, .1 y} inOrder .no if, () then} . then;

insert = 
$ { @bits x, t t } 
  <
    {.t._ if, .x leave then} .then,
    {[.x, .t.t.v] GT .0 0, .t.t 1}
        { 
            .1.l l,
            .1.v v,
            {.0 x, .1.r t} insert r  
        } t,
    { 
        {.x x, .t.t.l t} insert l,  
        .t.t.v v,
        .t.t.r r  
    } t
  >
$ t
;

inc = $@bits *1 $@bits;

len = 
 < SNOC .cdr len inc,
   .0 1,
   0
 >
;

concat = 
  < 
    SNOC 
    ${[@bits] car, [ [ @bits ] ] cdr}
      < {.car SNOC 0, .cdr 1}
        {.0.car car, {.0.cdr car, .1 cdr} CONS concat cdr} CONS,
        {.car.0 car, .cdr concat cdr} CONS,
        .cdr concat
      >,
    .0,
    []
  >
; 

toVector = 
$ t 
  < ._ [],
    .t [.l toVector, [.v], .r toVector] $[[@bits]] concat
  >
$ [ @bits ] 
;

{len len, sort toVector sorted}

