cdr = < SNOC.1, []>;
empty? = <{.0 nope}, {() empty}>.empty;

$ re = <
    {} sink,
    string  char,
    re star,
    {re 0, re 1} concat,
    {re 0, re 1} union
>;

print = 
$ re
<
  .char,
  .sink "",
  .star < 
    .char [(),"*"] CONCAT, 
    ["(", print, ")*"] CONCAT
  >,
  .concat [
    .0 < 
      .union  ["(", .0 print, "|", .1 print, ")"] CONCAT,
      print
    >,
    .1 <
      .union  ["(", .0 print, "|", .1 print, ")"] CONCAT,
      print
    > ] CONCAT,
  .union <
    [.0 print, "|", .1 print] CONCAT
  >
>
$ string
;

-- 're' constructors:
sink = { {} sink} $re;
epsilon = sink star $re;
char = {$ string char} $re;
star = < .star, {() star} > $re;
concat = <
  .0.sink sink,
  .1.sink sink,
  [.0.star.sink, .1] .1,
  [.1.star.sink, .0] .1,
  -- could do (a.b).c -> a.(b.c)
  -- [.0.concat.0, [.0.concat.1, .1] concat] concat,
  {[.0,.1] concat}
>;
union = <
  [.0.sink, .1] .1,
  [.1.sink, .0] .1,
  eq?,
  [.0.star, .1] eq? star,
  [.1.star, .0] eq? star,
  -- could also reduce ((a+b)+a), ((a+b)+b), (a+(a+b)) or (b+(a+b)) -> a+b
  {[.0,.1] union}
>;

eq? = <
  [.0.sink, .1.sink] sink,
  [.0.char, .1.char] EQ .0 char,
  [.0.star, .1.star] eq? star,
  [[.0.concat.0, .1.concat.0] eq?, [.0.concat.1, .1.concat.1] eq?] concat,
  [[.0.union.0, .1.union.0] eq?, [.0.union.1, .1.union.1] eq?] union
>;

accepts? = 
$re
  < 
    .star,
    .concat [.0 accepts?, .1 accepts?],
    .union <.0 accepts?, .1 accepts?>
  > {}
${}
;

derive = 
${string char, re re}
<
  .re.sink sink,
  [.re.char, .char] < EQ epsilon, sink >,
  {.char char, [.re.star, .re] concat re} derive,
  [
    .re.concat.0 accepts?, 
    [
      [{.char char, .re.concat.0 re} derive, .re.concat.1] concat, 
      {.char char, .re.concat.1 re} derive
    ] union
  ] .1,
  [{.char char, .re.concat.0 re} derive, .re.concat.1] concat,

  [ {.char char, .re.union.0 re} derive, 
    {.char char, .re.union.1 re} derive
  ] union
>
$re
;


check? = 
${[string] w, re re}
  <
    [.w empty?, .re accepts?] .1,
    {.w cdr w, {.w.0 char, .re re} derive re} check?
  >
${}
;

ab = ["a" char, "b" char] union;
b2 = ab star [(), "b" char] concat [(), ab] concat [(), ab] concat;

{ "a" char, {"a" char} [(),()] concat re} derive