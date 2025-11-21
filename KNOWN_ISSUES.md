# Known Issues

## Type Errors in Union Branches Not Always Caught

**Issue:** Type errors inside union branches may not be detected if the union has another valid branch.

**Example:**
```k
$ bnat = < {} _, bnat 0, bnat 1 >;
bug = $bnat < /_ .c, /1 >;  // Should fail but doesn't
```

**Why:**
- `/_` on `bnat` gives unit type `{}`
- `.c` on `{}` should fail (no field `c`)
- But when inside a union `< /_ .c, /1 >`, the error isn't caught
- The union unifies inputs/outputs of both branches
- Individual branch composition errors aren't checked eagerly

**Workaround:**
Test branches independently:
```k
test1 = $bnat /_ .c;  // This correctly fails
test2 = $bnat /1;     // This works
```

**Root Cause:**
Type errors are only caught during pattern unification, not during initial AST annotation. When a problematic composition is inside a union branch, its internal unification may not happen if the patterns remain open.

**Fix Required:**
Add eager type checking during composition annotation, before unification. This would catch errors like "field doesn't exist" immediately when building the AST, not just when patterns are unified.

**Status:** Known limitation in current implementation
