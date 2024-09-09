$ nat = < {} zero, nat succ >;
zero = { {} zero };
zero? = {.zero if, () then} .then;
succ = { () succ };
add = <
    {.x.succ x, .y succ y} add,
    .y
>;
mult = <
    <.x zero?, .y zero?> zero,
    {{.x.succ x, .y y} mult x, .y y} add
>;

$nat zero?

