-- DENO: counting with two two-fingered hands
-- codes:
$ unit = {};
$ two_fingers = < unit none, unit one, unit two >;
-- relations:
none = {{} none};   -- no finger up
one = {{} one};   -- one finger up
two = {{} two}; -- two fingers up
next_finger = <.none one, .one two>;
previous_finger = < . one none, . two one >;
--
$ two_hands = { two_fingers left, two_fingers right };
--
-- counting on two hands
start = {none left, none right};
start? = {.left.none left, .right.none right} start;
next = < --\
  {.left next_finger left, .right right }, --\
  { none left, .right next_finger right }  --\
>;
previous = <    --\
  {.left previous_finger left, .right right }, --\ 
  { two left, .right previous_finger right }  --\
>;
--
plus = ${ two_hands x, two_hands y }  --\
<                                     --\
  { .x start? if, .y then } .then,    --\
  { .x previous x, .y next y } plus   --\
>;
--
--
-- Test
-- "Counting with two two-fingered hands" _log!
-- "doing addition when two pairs of hands have one finger up" _log! 
{ one left , one right } -- _log! _log!
{() x, () y} plus

