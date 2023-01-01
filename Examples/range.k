pos? = [(),0] GT .0;
dec = [(),-1] PLUS;

rangeTill = ${int i, [ int ] range }
< {.i pos? dec i, [.i,.range] CONS range} rangeTill,
  .range
>;
range = $int
 {() i, [] range} rangeTill;

range {() range, .0 first}
