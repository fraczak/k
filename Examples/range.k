pos? = [$int,0] GT .0;
dec = [$int,"-1" fromJSON] PLUS;

rangeTill = ${int i, [ int ] range }
< {.i pos? dec i, {.i car,.range cdr} CONS range} rangeTill,
  .range
>
$[int];

range = $int
 {() i, [] range} rangeTill
 $[int]
 ;

range {() range, .0 first}
