inc = [(),1] PLUS;
max = <GT .0, .1>;  -- max = < SNOC [.0, .1 max] <GT .0, .1>, .0 >;
$tree = < string leaf, {tree left, tree right} tree>;
height =  $tree <
  .leaf 0,
  .tree [.left height, .right height] max inc
> $int;

<$tree, 
  {tree:
    { left: { leaf: "a"},
      right: { tree:
              {   left: {leaf: "b"},
                  right: {leaf: "c"}
              }
          }
    }
  }
> _log! height
