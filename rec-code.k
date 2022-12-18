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
    SNOC { .0 x, .1 sort t } insert,
    { empty l, .0 v, empty r } t,
    empty
  >
$ t
;

insert = 
$ { int x, t t } 
  <
    [.t._ , .x leave ] .1,
    [[.x, .t.t.v] GT .0, .t.t]
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
 < SNOC .1 len inc,
   .0 1,
   0
 >
;

concat = 
$ [ [ int ] ] 
  < 
    SNOC 
      < [.0 SNOC, .1] [.0.0, [.0.1, .1] CONS concat ] CONS,
        [.0.0, .1 concat] CONS,
        .1 concat
      >,
    .0,
    []
  >
$ [ int ]
; 

toVector = 
$ t 
  < ._ [],
    .t [.l toVector, [.v], .r toVector] concat
  >
$ [ int ] 
;

[len, sort toVector]

