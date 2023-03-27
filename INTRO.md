# k - the way of building and manipulating JSON-like data

Technically, `k` is a notation for defining __first-order partial functions__.

An example of a _partial function_ is the _projection_, e.g., "`.toto`", 
which maps an object to its property named `toto`, or it is not defined if 
the property doesn't exist. E.g.,

    .toto :
        {"toto": 5, "titi": 10}  --> 5
        {"titi": 10}             ... undefined // it is not a value!

---

## Combining "partial functions"

There are three ways of combining functions:

1. __composition__: `(f1 f2 ...)`, e.g. `(.toto .titi)` extracts
   nested field.

        (.toto .titi) :
            {"toto": {"titi": 10}}   --> 10
            {"toto": 10 }            ... undefined
            {}                       ... undefined

2. __merge__: `< f1, f2,... >`, e.g., `<.toto, .titi>` extracts field
   `toto` if present; otherwise extracts `titi`.

        <.toto, .titi> :
            {"toto": 5, "titi": 10}  --> 5
            {"titi": 10 }            --> 10
            {}                       ... undefined

3. __product__: `{ f1 label1, f2 label2, ...}`, e.g., `{.toto TOTO,
   .titi TITI}` extracts two fields and builds a record out of them.

        {.toto TOTO, .titi TITI} :
            {"toto": 5, "titi": 10}  --> {"TOTO": 5, "TITI": 10}
            {"titi": 10 }            ... undefined

---

__QUIZ__: What is:

 - empty composition: `()` ?
 - empty merge: `<>` ?
 - empty product: `{}` ?
 - `{{{{} s} s} s}` ?
 - `({{{() a} b} c} .c .b .a)` ?

---

#### Syntactic sugar: 

 - parenthesis can be omitted, except for the empty composition `()`,
 - dot (`.`) in "projection" acts as a separator so the space around it can be omitted.

For example, `[(.toto .titi (.0 .1))]` can be written as `[.toto.titi.0.1]`.


## Basic extensions

### Constants, i.e., literals for `strings`, `integers`, `booleans`, and `null`

A constant defines a function which ignores its argument and produces
the constant value. E.g.:

    {123 int, "kScript" str, true bool, null null} :
        <any>  --> {"int":123,"str":"kScript","bool":true,"null":null}

### Vector product

Vector product can be used as an abbreviation for product whose field
names are integers starting from zero. E.g., `{.toto "0", .titi "1",
123 "2"}` can be written as `[.toto, .titi, 123]`.

    [.toto, .titi, 12] :
        {"toto": 5, "titi": 10 }  --> [5, 10, 12]  // {"0":5,"1":10,"2":12}

    .1 :
        ["A","B","C"]  --> "B"
        ["a"]          ... undefined
---

## Pragmatic extensions, aka "standard library"

- `GT` : -- identity for lists of decreasing elements; undefined otherwise  

        [4,3]     --> [4,3]
        [3,4]     ... undefined
        []        --> []
        [4,3,0]   --> [4,3,0]

- `EQ` : -- identity for lists of equal elements; undefined otherwise

        [4,4]     --> [4,4]
        [4,5]     ... undefined
        [4,4,4]   --> [4,4,4]
        []        --> []

- `{PLUS plus, TIMES times}` : 

        [1,2]     --> {"plus":3,"times":2}
        [2,2,2]   --> {"plus":6,"times":8}
        []        --> {"plus":0,"times":1}

- `CONCAT` :

        ["a","bc","d"] --> "abcd"

- `toJSON` :

        {"a": 12} --> "{\"a\":12}"

- `fromJSON` : 
 
        "{\"a\":12}" --> {"a":12}

- other predefined parial functions are: `DIV`, `FDIV`, `CONS`, `SNOC`, `toDateMsec`,
  `toDateStr`, and `_log!`.

---

## Recursive definitions

      -- factorial.k
      dec = [(),-1] PLUS;
      zero? = [(),0] EQ 0;
      factorial = <
        zero? 1, 
        [(dec factorial), ()] TIMES
      >;
      { () x, factorial "x!" }

## Codes (_types_)

_Codes_ (prefixed by `$`) can be defined by taged union and product. E.g.:

      $nat = <nat 1, {} 0>;     -- e.g., {{{{} 0} 1} 1}
      $pair = {nat x, nat y};   -- e.g., {{{} 0} x, {{{{} 0} 1} 1} y}
      
      suc = $nat {() 1} $nat;
      add = $pair <{.x.1 x, .y suc y} add, .y> $nat;


