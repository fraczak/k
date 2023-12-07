count_occurrences =
 $ {[int] list, int elem}
 [.list |, .elem] EQ 1 ^ PLUS
 $int;

products =
    $ [int]
    [ |, | ] TIMES ^
    $ [int];


{[1,2,3,4,5] products list, <$int, "Not an integer, using 2 instead!!!" _log! 2> elem} count_occurrences
$int