count_occurrences =
 ?{[X] list, X elem}
 [.list |, .elem] EQ 1 ^ PLUS
 -- $int
 ;

products =
    -- $ [int]
    [ |, | ] TIMES ^
    -- $ [int]
    ;
-- eg: [1,2] products 
--  =  [[1,1] TIMES, [1,2] TIMES, [2,1] TIMES, [2,2] TIMES]
--  =  [1,2,2,4] 


{
    [1,2,3,4,5] products list, 
    <$int, "Not an integer, using 2 instead!!!" _log! 2> elem
} _log! count_occurrences 