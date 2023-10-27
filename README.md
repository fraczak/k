# k-language

    npm install '@fraczak/k'

From javascript:

    import k from "@fraczak/k";
    
    const fn = k.compile("<.name,.nom,'?'>");
    console.log([{name:"x"},{nom:"y"},{}].map(fn));
    // returns: [ "x", "y", "?" ]

---

## k - the way of building and manipulating JSON-like data

Technically, `k` is a notation for defining **monadic second-order** and
**first-order partial** functions.

An example of a _partial function_ is the _projection_, e.g., "`.toto`",
which maps an object to its property named `toto`, or it is not defined if
the property doesn't exist. E.g.,

    1   .toto :
    2        {"toto": 5, "titi": 10}  --> 5
    3        {"titi": 10}             ... undefined // it is not a value!

> Note: The above 3 lines should be read as follows. A `k`-expression
> is printed in the first line (before "`:`").  The following lines
> are examples of the function defined by the `k`-expression applayed
> to JSON values (first part of each line).  If the function for the
> value is defined, then the result is printed after "`-->`" (line 2 in
> the above example).  If the function is not defined for the value,
> then "`... undefined`" is printed (line 3).

---

### Combining "partial functions"

There are three ways of combining functions:

1. **composition**: `(f1 f2 ...)`, e.g. `(.toto .titi)` extracts
    nested field.

         (.toto .titi) :
             {"toto": {"titi": 10}}   --> 10
             {"toto": 10 }            ... undefined
             {}                       ... undefined

2. **merge**: `< f1, f2,... >`, e.g., `<.toto, .titi>` extracts field
    `toto` if present; otherwise extracts `titi`.

         <.toto, .titi> :
             {"toto": 5, "titi": 10}  --> 5
             {"titi": 10 }            --> 10
             {}                       ... undefined

3. **product**: `{ f1 label1, f2 label2, ...}`, e.g., `{.toto TOTO,
.titi TITI}` extracts two fields and builds a record out of them.

         {.toto TOTO, .titi TITI} :
             {"toto": 5, "titi": 10, "x": 3}  --> {"TOTO": 5, "TITI": 10}
             {"titi": 10 }                    ... undefined

---

**QUIZ**: What is:

- empty composition: `()` ?
- empty merge: `<>` ?
- empty product: `{}` ?
- `{{{{} s} s} s}` ?
- `({{{() a} b} c} .c .b .a)` ?

---

### Syntactic sugar

- parenthesis can be omitted, except for the empty composition `()`,
- dot (`.`) in "projection" acts as a separator so the space around it can be omitted.

For example, `[(.toto .titi (.0 .1))]` can be written as `[.toto.titi.0.1]`.

Comments can be introduced by `//`, `--`, `%`, or `#` and extends to
the end of line.  Multiline `C`-like comments, `/* ... */`, are also
supported.

### Basic extensions

#### Constants, i.e., literals for `strings`, `integers`, `booleans`, and `null`

A constant defines a function which ignores its argument and produces
the constant value. E.g.:

    {123 int, "kScript" str, true bool, null null} :
        "any"  --> {"int":123,"str":"kScript","bool":true,"null":null}

Those values, i.e., `strings`, `integers`, `booleans`, and `null`, admit the
projection to the canonicat string representation of the value, e.g.:

    .2 :
        2      --> {}
        "2"    --> {}
        4      ... undefined
        true   ... undefined
    
    .true :
        true   --> {}
        "true" --> {}
        4      ... undefined
        "toto" ... undefined

    .null :
        null   --> {}
        "null" --> {}
        4      ... undefined
        false  ... undefined

#### Vector product

Vector product can be seen as an abbreviation for product whose field
names are integers starting from zero. E.g., `{.toto 0, .titi 1, 123 2}`
can be written as `[.toto, .titi, 123]`.

    [.toto, .titi, 12] :
        {"toto": 5, "titi": 10 }  --> [5, 10, 12] 

    .1 :
        ["A","B","C"]  --> "B"
        ["a"]          ... undefined

---

### Pragmatic extensions, aka "standard library"

- `GT` -- identity for lists of decreasing elements; undefined otherwise

      GT:
        [4,3]     --> [4,3]
        [3,4]     ... undefined
        []        --> []
        [4,3,0]   --> [4,3,0]

- `EQ` -- identity for lists of equal elements; undefined otherwise

      EQ:     
        [4,4]     --> [4,4]
        [4,5]     ... undefined
        [4,4,4]   --> [4,4,4]
        []        --> []

- `PLUS` and `TIMES` -- sum and product of lists of numbers

      {PLUS plus, TIMES times} :
        [1,2]     --> {"plus":3,"times":2}
        [2,2,2]   --> {"plus":6,"times":8}
        []        --> {"plus":0,"times":1}

- `CONCAT` -- concatenation of lists of strings

      CONCAT:
        ["a","bc","d"] --> "abcd"
        ["a","bc","d"] --> "abcd"

- `toJSON` and `fromJSON` -- conversion to and from JSON strings

      toJSON:
        {"a": 12} --> "{\"a\":12}"

      fromJSON:   
        "{\"a\":12}"       --> {"a":12}
        "2.12"             --> 2.12
        "[1,2.11,0.3e-32]" --> [1,2.11,3e-33]

- other predefined parial functions are: `DIV`, `FDIV`, `CONS`, `SNOC`, `toDateMsec`,
  `toDateStr`, and `_log!`.

---

### Function and code (_types_) definitions

Examples of function definitions:

      dec = [(),-1] PLUS;
      max = <SNOC [.0, .1 max] <GT.0, .1>, .0> ;
      factorial = < [(),0] GT .0 [dec factorial, ()] TIMES, 1 >;

_Codes_ (prefixed by `$`) can be defined by taged union and product. E.g.:

      $nat = <nat 1, {} 0>;
      $pair = {nat x, nat y};

      suc = {$nat 1};
      add = $pair <{.x.1 x, .y suc y} add, .y>;

#### Basic extension codes

Since _basic extension_ introduces integers, booleans, and strings, there are three
predefined types: `int`, `bool`, and `string`. A vector product code can also be defined
by `[ codeExp ]`. All members of the vector are the same code. E.g.,

     $intVector = [ int ];
     $boolVector = [ bool ];
     $tree = [ tree ];

     emptyList? = $intVector $[ string ]; -- as only an empty vector can be a vector
                                          -- of integers and a vector of strings

---

### Set values

We introduce the following notation for constructing set values:

- `<< >>` -- a function which returns the empty set,
- `<< 3 >>` -- a function which returns the singleton set,
- `<< .toto, .titi >>` -- a function which returns a set composed of maximum
   two values, i.e., the value of the field `toto` and the value of the field
   `titi` of its argument, if defined and different.

Such set values can take part of product, e.g.,
`{ << >> empty, << 3 >> singleton, {} x}`, is a constant function
returning a record with three fields: `empty`, `singleton`, and `x`.

1. Set values can be aggregated using `@` operator, e.g.,

    ```k
        << .toto, .titi >> @ :
            {"toto": 5, "titi": 10, "x": 3}  --> [5,10]
            {"toto": 5, "titi": 5, "x": 3}   --> [5]
            {"titi": 10 }                    --> [10]
            {}                               --> []
    ```

2. Set values can be used to construct othet set values using the
   following _list comprehension_, `|`, notation:

    ```k
        << .0, .1 >> << 0, | inc, | dec >> @ :
            []           --> [0]
            [1]          --> [0,2]
            [2]          --> [0,1,3]
            [2,3]        --> [0,1,2,3,4]
    ```

The following function transforms a vector into a set of its elements:

```k
    toSet = < SNOC << .0, .1 toSet | >>, << .0 >> >;
    ---
    toSet @ :
        []           --> []
        [1]          --> [1]
        [2,2]        --> [2]
        [2,3,2]      --> [2,3]
        [2,3,2,3,2]  --> [2,3]
```

---

## Examples

1. projection:

        .x
        ."field name"
        .4

    The function is defined only if its argument is a structure with
the field (or a vector with the index).

2. _constants_, literals for Strings, Booleans, and
   Integers. Examples:

        "a string"
        'another "String"'
        123
        false
        null

3. "built-in" functions:

        [1, 2, 3] PLUS       -- integer constant function 6
        [4, 4] TIMES toJSON  -- string constant function "16"
        [3, 2] GT            -- vector constant function [3, 2]
        [3, 4] GT            -- ... undefined

    A more interesting example could be:

        < GT .0, .1>

    which selects the maximum element in two element vector, i.e.,

        [3,8] < GT .0, .1 >    --> 8

### User defined functions

`k`-expression can be prefixed by function definitions. E.g.:

        dec = [(),-1] PLUS;
        zero? = [(),0] EQ 0;
        factorial = <
          zero? 1, 
          [dec factorial, ()] TIMES
        >;
        { () x, factorial "x!" }

Another example could be finding the biggest (max) value in a vector:

    max = < 
      SNOC         #   [x0, x1, x2, ...] --> [x0, [x1, x2, ...]]
      [.0, .1 max] #   [x0, [x1, x2, ...]] --> [x0, max(x1,x2,...)], i.e., recursive call 
      <GT .0, .1>  #   if x0 > max(x1,x2,...) then x0 else max(x1,x2,...)
    ,              # when SNOC is not defined, i.e., if the input vector has one element:
      .0           #   [x0] --> x0
    >; 
    max

### Value encodings (_codes_)

There are three predefined value encodings: `int`, `string`, and
`bool`. The language supports `code`-expressions:

- product, e.g., `{int x, int y, bool flag}`
- disjoint union, e.g., `<{} true, {} false>`
- vector, e.g., `[ int ]` (all elements of the vector use the same
  encoding)

One can define recursive codes. E.g.:

    $tree = <string leaf, {tree left, tree right} tree>;

Each _code_ definition starts with a `$`.
The above example defines new code called _tree_.

The code can be then used in a `k`-expression as a filter. A `code`-expression
within `k`-expression is again prefixed by `$`.

    $ tree = <string leaf, {tree left, tree right} tree>;
    inc = [(),1] PLUS;
    max = <GT .0, .1>;
    height = $ tree <
        .leaf 0,
        .tree [.left height, .right height] max inc
    > $ int;
    height

---

## `k` (a command-line JSON processor using `k` syntax)

There is a wrapper, `k` (`./node_modules/.bin/k`), which makes it easy to
run the language from command line.

    > k
       ... errors ...
    Usage: ./node_modules/.bin/k ( k-expr | -k k-file) [ -1 ] [ json-file ]
    E.g., cat '{"a": 10}' | ./node_modules/.bin/k '[(),()]'

For example:

1. One `k`-expression with one `json`-object:

        > echo '{"x": 12, "y": 13}' | k '{ <.x, "no x"> x, () input}' 
         {"x":12,"input":{"x":12,"y":13}}

2. By providing only `k`-expression, the script will compile the
   `k`-expression and apply the generated function to the `stdin`,
   line by line:

        > k '<["x=",.x," & y=",.y],["only x=",.x],["only y=",.y],["no x nor y"]>{CONCAT "x&y"}' 
        
         {"y": 123, "x": 432,"others": "..."}  --> {"x&y":"x=432 & y=123"} 
         {"x": 987}                            --> {"x&y":"only x=987"} 
         {"z": 123}                            --> {"x&y":"no x nor y"}
         ^D - to interrupt

   If the input is a multiline json object, we need to add `-1` to the command-line options.

3. If the `k`-expression is long, it can be put in a file, e.g.:

        > cat test.k
         ---------  comments start by #, --, or // ----------------------------------
         <                          -- merge of 4 partial functions...
           ["x=", .x, " & y=", .y], -- produces a vector of 4 values, if fields 'x' and 'y' are present
           ["only x=", .x],         -- produces a pair '["only x=", "value-of-x"]', for input like {"x":"value-of-x"}
                                    -- it is defined only if field 'x' is present
           ["only y=", .y],
           ["no x nor y"]           -- defined for all input, returns always the same one element vector
         > 
         -- one of the string vectors is passed to the following partial function, 
         -- which produces a record (map) with one field "x&y", whose value is the
         -- result of concatenating elements of the passed in vector
         { CONCAT "x&y" } 
         ------------------------------------------------------------------------------

    We can use it by:

        > k -k test.k

    If we want to read `json` objects from a file, e.g., `my-objects.json`, we do

        > k -k test.k my-objects.json
         {"x&y":"x=432 & y=123"} 
         {"x&y":"only x=987"} 
         {"x&y":"no x nor y"}

    where:

        > cat my-objects.json 
         ####################################################
         # empty lines and lines starting with # are ignored
         {"y": 123, "x": 432,"others": "..."}
         {"x": 987}
         {"z": 123}
         ####################################################

---

### Short comparaison with `jq` tutorial examples: <https://stedolan.github.io/jq/tutorial/>

1.
        curl 'https://api.github.com/repositories/5101141/commits?per_page=5' | jq '.'
        curl 'https://api.github.com/repositories/5101141/commits?per_page=5' | k  '()' -1 
2.
        curl 'https://api.github.com/repositories/5101141/commits?per_page=5' | jq '.[0]'
        curl 'https://api.github.com/repositories/5101141/commits?per_page=5' | k  '.0' -1 
3.
        jq '.[0] | {message: .commit.message, name: .commit.committer.name}'
        k '.0 {.commit.message message, .commit.committer.name name}' -1
4. note: `k`-expression defines a partial function yielding a single json object, i.e., as far as `k` is concerned,
   examples 4 and 5 of the `jq` tutorial are equivalent.
5.
        jq '[.[] | {message: .commit.message, name: .commit.committer.name}]'
        k 'f = .commit {.message message, .committer.name name}; %\
           map_f = <SNOC [.0 f,.1 map_f] CONS, [.0 f], []>; %\
           map_f' -1 
6.
        jq '[.[] | {message: .commit.message, name: .commit.committer.name, parents: [.parents[].html_url]}]'
        k 'map_html_url = <SNOC [.0 .html_url, .1 map_html_url] CONS, [.0 .html_url], []>; %\
           f = {.commit.message message, .commit.committer.name name, .parents map_html_url parents}; %\
           map_f = <SNOC [.0 f, .1 map_f] CONS, [.0 f] , []>; %\
           map_f' -1 

---

## k-REPL (Read-Evaluate-Print Loop)

Also there is a REPL, `k-repl` (`./node_modules/.bin/k-repl`), which acts like a toy
shell for the language. E.g.:

    > ./node_modules/.bin/k-repl 
     {'a' a, 'b' b} toJSON
     => "{\"a\":\"a\",\"b\":\"b\"}"
     {"a" a} toJSON fromJSON
     => {"a": "a"}
     inc = [(),1] PLUS; 1 inc inc
     => 3
     inc inc inc inc
     => 7

---

## Using `k` from `javascript`

     import k from "@fraczak/k";

     let k_expression = '()';
     k.run(k_expression,"ANYTHING...");
     // RETURNS: "ANYTHING..."

     k_expression = '{"ala" name, 23 age}';
     k.run(k_expression,"ANYTHING...");
     // RETURNS: {"name":"ala","age":23}

     k_expression = '[.year, .age]';
     k.run(k_expression,{"year":2002,"age":19});
     // RETURNS: [2002,19]

     k_expression = '[(), ()]';
     k.run(k_expression,"duplicate me");
     // RETURNS: ["duplicate me","duplicate me"]

     k_expression = '[[[()]]]';
     k.run(k_expression,"nesting");
     // RETURNS: [[["nesting"]]]

     k_expression = '[[()]] {() nested, .0.0 val}';
     k.run(k_expression,"nesting and accessing");
     // RETURNS: {"nested":[["nesting and accessing"]],"val":"nesting and accessing"}

     k_expression = '0000';
     k.run(k_expression,{"test":"parse integer"});
     // RETURNS: 0

     k_expression = '[.y,.x] PLUS';
     k.run(k_expression,{"x":3,"y":4});
     // RETURNS: 7

     var k_fn = k.compile('{.name nom, <[.age, 18] GT .0, [.age, 12] GT "ado", "enfant"> age}');

     k_fn({"age":23,"name":"Emily"});
     // RETURNS: {"nom":"Emily","age":23}

     k_fn({"age":16,"name":"Katrina"});
     // RETURNS: {"nom":"Katrina","age":"ado"}

     k_fn({"age":2,"name":"Mark"});
     // RETURNS: {"nom":"Mark","age":"enfant"}

     k_fn = k.compile('$t = < i: int, t: [ t ] > ; <$t, $int>');

     k_fn(1);
     // RETURNS: 1

     k_fn({"i":1});
     // RETURNS: {"i":1}

     k_fn([{"i":2},{"i":3},{"t":[]}]);
     // RETURNS: undefined

     k_fn({"t":[{"i":2},{"i":3},{"t":[]}]});
     // RETURNS: {"t":[{"i":2},{"i":3},{"t":[]}]}

     k_fn = k.compile('$ < < [ int ] ints, [ bool ] bools > list, string None>');

     k_fn({"None":"None"});
     // RETURNS: {"None":"None"}

     k_fn({"list":{"ints":[]}});
     // RETURNS: {"list":{"ints":[]}}

     k_fn({"list":{"ints":[1,2,3]}});
     // RETURNS: {"list":{"ints":[1,2,3]}}
