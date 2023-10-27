ala = @ .0;

toSet = < SNOC <<.0, .1 toSet |>>, << .0 >> >;

union = 
  _log!
  <<  | ^ ala , [ | , | ] >>
;

<< 1,2,3,4 >> | [(),2] GT ^ @ toSet union @