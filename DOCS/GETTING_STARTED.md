# Getting started

Use the [browser REPL](https://fraczak.github.io/k/) or start a local session
from the repository root:

```sh
npm install
node repl.mjs
```

Use Node.js 22+ for development. The examples below are REPL inputs; `>` is
the prompt, not part of the program.

## Unit, variants, and products

The current input starts as the empty product `{}`, called *unit*.
Each expression transforms the current input and makes its result the next input.

```k
{} |hello
```

`{}` produces unit and `|hello` wraps it in a variant tagged `hello`.
The REPL prints the value followed by its pattern envelope and timing.
The value part is `{}|hello`.

A product constructs several fields from the same input:

```k
{ {} |hello x, {} |world y }
```

Project a field with `.x`. Extract a variant payload with `/hello`:

```k
.x /hello
```

The result is unit again.

## Relations and ordered choice

Define a reusable relation with `name = expression;`:

```k
swap = { .x y, .y x };
{ {} |hello x, {} |world y } swap
```

Expressions composed left to right pass each result to the next expression.
Parentheses group a composition; `()` is identity.

Relations may be undefined. Choice tries branches in source order and uses
the first defined result:

```k
choose = < /left, /right >;
{} |hello |right choose
```

The value part is `{}|hello`. The `/left` branch is undefined for a
`right` variant, so `/right` supplies the result. A diverging branch does
not count as an undefined result.

The empty choice `<>` is always undefined. An undefined evaluation leaves the
REPL's current input unchanged. Structural type errors are reported separately.

## Schemas and filters

Named patterns describe reusable structures:

```k
bool[] = < {} false, {} true >;
not = ?bool[] < /false |true, /true |false > ?bool[];
{} |true not
```

The result is the `false` variant. `?bool[]` constrains the schema while
leaving the payload unchanged. The compiler derives input/output constraints;
runtime boundaries validate arriving schemas, and optimized paths can erase
guards already proved by specialization.

Square brackets distinguish pattern applications such as `bool[]` from
relation names such as `not`. The [language reference](PATTERNS.md) explains
variables, recursive knots, and parameterized patterns.

## Recursion: Peano numbers

Load the small arithmetic example:

```text
:load Examples/nat.k
```

Its number schema is:

```k
nat[] = < {} 0, N +1 > = N;
```

A natural number is either zero or another natural wrapped in `+1`.
The binding `= N` closes the recursive cycle.

The library defines `0`, `succ`, `pred`, `add`, and `mult`. Try:

```k
0 succ succ
{ 0 succ succ x, 0 succ y } add
```

The second expression computes 2 + 1. Its value part is
`{}|0|+1|+1|+1`. These are ordinary relation names, not builtin numeric
literals.

Recursive filters give the contract-derivation engine finite structural
constraints. Derivation convergence does not prove that every program terminates.

## Libraries and external numbers

Load the integer library and a codec explicitly:

```text
:load Examples/arithmetics.k
:codec load codecs/int.mjs
:input int.mjs 42
```

Now evaluate `inc` to obtain 43. The codec prints the decimal representation
alongside the structural value.

For list operations, load the arithmetic library first, then:

```text
:load Examples/poly.k
```

For a smaller self-contained list example, use `:load Examples/list.k`.
See the [REPL guide](REPL.md) for loading, pattern inspection, and exports.

## Shell pipelines

The command-line runtime receives binary schema+payload data, so use codecs
at text boundaries. From the repository root:

```sh
printf '42\n' | node codecs/int.mjs --parse |
  node k.mjs --lib Examples/arithmetics.k --export inc 'inc' |
  node codecs/int.mjs --print
```

This prints `43`. `--lib` loads definitions; `--export inc` brings the
friendly name into scope. Library relations are also available by their
content hashes.

To compile a small executable object and run it:

```sh
node objects/compile.mjs '{} |ok' /tmp/k-ok.ko
node codecs/unit.mjs --parse | node k.mjs /tmp/k-ok.ko |
  node codecs/k-print.mjs
```

This prints `"ok"`. Continue with [file formats and tools](FILE_FORMATS.md)
or return to the [documentation index](README.md).
