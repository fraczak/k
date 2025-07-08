# k-language


## k - A Language for Building and Manipulating JSON-like Data

Technically, `k` is a notation for defining **first-order partial functions**.

Examples of _partial functions_ are _projections_, e.g., "`.toto`",
which map an object to one of its properties, here `toto`, or are undefined if
the property doesn't exist. E.g.,

```text
1   .toto :
2        {"toto": {"5":{}}, "titi": {"10":{}}}  -->  {"5":{}}
3        {"titi": {"10":{}}}                         ... undefined // it is not a value!
```

> Note: The above 3 lines should be read as follows. A `k`-expression
> is printed in the first line (before "`:`").  The following lines
> are examples of the function defined by the `k`-expression applied
> to JSON values (first part of each line).  If the function for the
> value is defined, then the result is printed after "`-->`" (line 2 in
> the above example).  If the function is not defined for the value,
> then "`... undefined`" is printed (line 3).

---

### Combining Partial Functions

There are three ways of combining functions:

1. **Composition**: `(f1 f2 ...)`, e.g., `(.toto .titi)` extracts
    nested fields.

    ```text
        (.toto .titi) :
            {"toto": {"titi": {}}}   --> {}
            {"toto": {"other": {}}}  ... undefined
            {"other": {}}            ... undefined
    ```

2. **Merge**: `< f1, f2, ... >`, e.g., `<.toto, .titi>` extracts field
    `toto` if present; otherwise extracts `titi`.

    ```text
        < .x.y, .z.y > :
            {"x":{"y": {"5":{}}}, "z": {"y":{"10":{}}}}  --> {"5":{}}
            {"x":{"o":{}}, "z": {"y":{"10":{}}}}  --> {"10":{}}
            {"x":{"o":{}}, "z": {"o":{}}}  ... undefined
    ```

3. **Product**: `{ f1 label1, f2 label2, ... }`, e.g., `{.toto TOTO,
    .titi TITI}` extracts two fields and builds a record from them.

    ```text
        {.toto TOTO, .titi TITI} :
            {"toto": {"5":{}}, "titi": {"10":{}}, "x": {}}  --> {"TOTO": {"5":{}}, "TITI": {"10":{}}}
    ```

---

**QUIZ**: What is:

- Empty composition: `()` ?
- Empty merge: `<>` ?
- Empty product: `{}` ?
- `{{{{} s} s} s}` ?
- `({{{() a} b} c} .c .b .a)` ?

---

### Syntactic Sugar

- Parentheses can be omitted, except for the empty composition `()`
- The dot (`.`) in "projection" acts as a separator, so surrounding
  spaces can be omitted

For example, `(.toto .titi (.0 .1))` can be written as `.toto.titi.0.1`.

Comments can be introduced by `//`, `--`, `%`, or `#` and extend to
the end of the line. Multiline C-like comments, `/* ... */`, are also
supported.


### Codes (Schemas, i.e., Types) and Functions

_Codes_ can be defined by tagged union and product. E.g.:

```k-repl
  $ nat = < nat 1, {} 0 >;
  $ pair = { nat x, nat y };

  suc = { $ nat 1 };
  add = $ pair <{.x.1 x, .y suc y} add, .y>;
```

Code definition statements start with `$`.
Also, any code expression occurring within a `k`-expression is prefixed by `$`.

Two codes are considered equal when they are isomorphic (preserving
union/product and field names). E.g., `$pair`, `${nat y, nat x}`, and
`${<nat 1, {} 0> x, nat y}` are all equivalent and correspond to their canonical form
`$C0={C1"x",C1"y"};$C1=<C2"0",C1"1">;$C2={};`.

Try in `k-repl`:

```k-repl
> $ nat = < nat 1, {} 0 >; \
  $ pair = { nat x, nat y };
--> {}
> --C pair
 $ @IxLVRLECv = {@BADJOX x, @BADJOX y}; -- $C0={C1"x",C1"y"};$C1=<C2"0",C1"1">;$C2={};
$ myCode = {<nat 1, {} 0> x, nat y};
--> {}
> --C myCode
 $ @IxLVRLECv = {@BADJOX x, @BADJOX y}; -- $C0={C1"x",C1"y"};$C1=<C2"0",C1"1">;$C2={};
```

### Code Derivation and Patterns

Intuitively, a _pattern_ represents some set of constraints on
codes. For example, expression `.toto` is a projection from a value of
a product or a union code with field `toto`. Therefore, expression `.toto`
introduces two patterns `p_i` and `p_o` (for input and output codes,
respectively); `p_o` imposes no constraint on code, however `p_i` is a
product or union code with field `toto` leading to a code fulfilling
`p_o`, which will be denoted by:

```k-repl
> toto = .toto;
--> {}
> --R toto
  toto : ?(X0 toto, ...)  -->  ?X0
  toto = .toto;
```

In a more complex expression, each (occurrence of) subexpression will
introduce some new patterns.
For example, consider `rel = <.toto, ()>;`.

        <    .toto    ,    ()    >
     p1   p2       p3   p4    p5   p6

where `p1` is the pattern for the input code of the whole expression,
and `p6` is the pattern for the output. We can deduce that patterns
(`p1`, `p2`, `p4`) define the same code, as well as (`p6`, `p5`, `p3`),
because union combines partial functions with the same input and output codes.
Identity, `()`, implies that (`p4`, `p5`) define the
same code. In `k-repl`:

```k-repl
> rel = < .toto, () >;
--> {}
> --R rel
  rel : ?(X0 toto, ...)=X0  -->  ?X0
  rel = <.toto, ()>;
```

For a given `kScript`, code derivation (as any static analysis) can
fail, indicating that the script is invalid. In some other cases, the
code derivation can succeed even to the point of reducing every pattern
to a single code, making the program fully annotated by codes.

The language `k` supports _type patterns_, which are used for code
derivation; however, the patterns are not considered in the
evaluation of the program.

```k-repl
    treePattern = ?<(...) leaf, {T left, T right} tree> = T;
```
