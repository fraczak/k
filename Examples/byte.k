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

inc2 = inc inc_o;
inc3 = inc2 inc_o;
inc4 = inc3 inc_o;
inc5 = inc4 inc_o;
inc6 = inc5 inc_o;
inc7 = inc6 inc_o;
inc8 = inc7 inc_o;



digitToByte = $@int < 
  .0 zero,
  .1 zero inc .byte,
  .2 zero inc2 .byte,
  .3 zero inc3 .byte,
  .4 zero inc4 .byte,
  .5 zero inc5 .byte,
  .6 zero inc6 .byte,
  .7 zero inc7 .byte,
  .8 zero inc8 .byte,
  .9 zero inc8 .byte inc .byte,
  .10 zero inc8 .byte inc2 .byte,
  .11 zero inc8 .byte inc3 .byte,
  .12 zero inc8 .byte inc4 .byte,
  .13 zero inc8 .byte inc5 .byte,
  .14 zero inc8 .byte inc6 .byte,
  .15 zero inc8 .byte inc7 .byte
> ;

strToByte = $@string toVEC
  { .0 <.0 bit0, bit1> b3,
    .1 <.0 bit0, bit1> b2,
    .2 <.0 bit0, bit1> b1,
    .3 <.0 bit0, bit1> b0
  } $byte;


bitToString = $bit <.o "0", "1">;

toStr = $byte
  [.b3 bitToString, .b2 bitToString, .b1 bitToString, .b0 bitToString] CONCAT;

_log!  digitToByte toStr _log! strToByte {() val, "+1" _log! log} .val inc .byte toStr _log!
