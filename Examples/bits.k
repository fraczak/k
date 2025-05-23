empty? = $@bits < {/0 nope}, {/1 nope}, {() yes} > .yes; 
concat = {.x inv x, .y y} concat_; 
concat_ = < {.x /0 x, .y *0 y} concat_, {.x /1 x, .y *1 y} concat_, .y >;
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

inc = {inv x, '' y} _inc;
_inc = <
    {.x /0 x, .y *1 y} concat_, 
    {.x /1 x, .y *0 y} _inc,
    .y *1
>; 

dec = {inv x, '' y} _dec;
_dec = <
    {.x /1 x, .y *0 y} concat_, 
    {.x /0 x, .y *1 y} _dec
>;