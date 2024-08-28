car = ?[X] .0;
cdr = ?[X] <SNOC .cdr, car []>;

filter_f = {<.a, .c> if , () then} .then;
filter = <
    {car filter_f car, cdr filter cdr} CONS,
    cdr filter,
    []
> ;

["a","b","c", "c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","a","s","t","u","v","w","c","y","z"]
filter


