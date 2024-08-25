$ t = < { t l, int v, t r } t, {} _ >;

t = 
$ {t l, int v, t r} 
  {() t} 
$ t
;

empty = {{} _} $t;

leave = 
$ int 
  { empty l, 
    () v, 
    empty r 
  } t 
$ t
; 

sort = 
$ [ int ]
  <
    SNOC { .car x, .cdr sort t } insert,
    { empty l, .0 v, empty r } t,
    empty
  >
$ t
;

insert = 
$ { int x, t t } 
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

inc = $int [(),1] PLUS $int;
len = 
 < SNOC .cdr len inc,
   .0 1,
   0
 >
;

concat = 
  < 
    SNOC 
    ${[int] car, [ [ int ] ] cdr}
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
    .t [.l toVector, [.v], .r toVector] $[[int]] concat
  >
$ [ int ] 
;

{len len, sort toVector sorted}

