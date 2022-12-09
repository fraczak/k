inc = [(),1] PLUS;
$tree = <leaf: string, tree: {left: tree, right: tree}>;
height =  $tree <
    .leaf 0,
    .tree [.left height, .right height] <GT .0, .1> inc
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
> _log_ height