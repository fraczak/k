-- DENO: counting with two two-fingered hands
--
$ unit = {};
--
$ two_fingers = < unit _, unit i, unit ii >;
_ = {{} _}; -- no finger up
i = {{} i}; -- one finger up
ii = {{} ii}; -- two fingers up
next_finger = <._ i, .i ii>;
previous_finger = <.i _, .ii i>;
--
$ two_hands = { two_fingers left, two_fingers right };
--
-- counting on two hands
start = {_ left, _ right};
start? = {.left._ left, .right._ right} {};
next = < {.left next_finger left, .right right }, { _ left, .right next_finger right }>;
previous = < {.left previous_finger left, .right right }, { ii left, .right previous_finger right }>;
--
plus = ${ two_hands x, two_hands y }  --\
<                                     --\
  { .x start? if, .y then } .then,    --\
  { .x previous x, .y next y } plus   --\
>;
--
-- and, if we want to wrap around
next_wrap_around = < next, start >;
--
plus_wrap_around = --\
<                                     --\
  { .x start? if, .y then } .then,    --\
  { .x previous x, .y next_wrap_around y } plus_wrap_around   --\
>;
--
-- Test
-- "Counting with two two-fingered hands" _log!
-- "doing addition when two pairs of hands have all (two) fingers up" _log! 
{ ii left , ii right } -- _log! _log!
{() x, () y} plus_wrap_around

