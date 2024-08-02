$ bit = < {} o, {} i >;
bit0 = {{} o} $bit;
bit1 = {{} i} $bit;

$ byte = { bit b0, bit b1, bit b2, bit b3 };
zero = bit0 { () b0, () b1, () b2, () b3 } $byte;

inc = $byte
   <
      { .b0.o bit0  overflown,  {bit1 b0, .b1  b1,  .b2 b2,  .b3 b3 } byte }, 
      { .b1.o bit0  overflown,  {bit0 b0, bit1 b1,  .b2 b2,  .b3 b3 } byte },
      { .b2.o bit0  overflown,  {bit0 b0, bit0 b1, bit1 b2,  .b3 b3 } byte },
      { .b3.o bit0  overflown,  {bit0 b0, bit0 b1, bit0 b2, bit1 b3 } byte },
      { bit1        overflown,  zero                                  byte }
   >  
;

-- inc with overflown flag (polymorphism)
inc_o = 
  { .byte inc inc, .overflown overflown }  
  {
    .inc.byte                             byte, 
     <.overflown.i bit1, .inc.overflown > overflown
  }
;

inc3 = inc inc_o inc_o;

inc3
