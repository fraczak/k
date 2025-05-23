empty? = $@bits < {/0 nope}, {/1 nope}, {() yes} > .yes; 
concat = {.x inv x, .y y} concat_; 
concat_ = < {.x /0 x, .y *0 y} concat_, {.x /1 x, .y *1 y} concat_, .y >;
inv = {()x, '' r} _inv; 
_inv = < {.x /0 x, .r *0 r} _inv, {.x /1 x, .r *1 r} _inv, .r >;
