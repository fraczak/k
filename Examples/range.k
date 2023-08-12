pos? = [$int,0] GT .0;
dec = [$int,"-1" fromJSON] PLUS;

rangeTill = ${int i, [ int ] range }
< {.i pos? dec i, [.i,.range] CONS range} rangeTill,
  .range
>;
range = $int
 {() i, [] range} rangeTill;

range {$int range, .0 first}
