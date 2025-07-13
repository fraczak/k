car = ?[X] .0;
cdr = ?[X] <SNOC .cdr, car []>;

filter_f = {<-"a", -"c"> if , () then} .then;
filter = <
    {car filter_f car, cdr filter cdr} CONS,
    cdr filter,
    []
> ;

["aal","b","c", "c","daa","e","f","g","haa","i","j","k","l","m","n","o","p","q","a","s","t","u","v","w","c","y","z"]
filter


