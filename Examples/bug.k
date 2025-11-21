-- Standard binary encoding of natural numbers

$ bnat = < {} _, bnat 0, bnat 1 >;

bug =
  -- least significant bit first addition with carry
  $bnat
  <
    /_  .c {}|_  bug
  , /1 
  >
;

--------------------

()
