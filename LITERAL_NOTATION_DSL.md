# Literal Notation DSL for K Language

## Design Philosophy

This DSL allows defining human-friendly syntax for literals of k language types (codes). The approach involves:

1. **Pattern-based syntax definitions** - Define how literals look
2. **Bidirectional mappings** - Auto-generate parsers and formatters  
3. **Composable definitions** - Support recursive and dependent literals
4. **Type safety** - Ensure generated literals match the target code

## DSL Syntax

### Literal Definition Statement

```k
@literal <code_name> <pattern> <parse_function> <format_function>;
```

### Pattern Syntax

Patterns use a regex-like syntax with semantic placeholders:

- `\d+` - One or more digits
- `\d*` - Zero or more digits  
- `[01]+` - One or more binary digits
- `[a-fA-F0-9]+` - Hexadecimal digits
- `"..."` - Literal string
- `{...}` - Grouping
- `|` - Alternatives
- `?` - Optional
- `*` - Zero or more
- `+` - One or more

### Parse/Format Functions

These are k expressions that transform between string representations and code values:

- **Parse function**: `@string -> code_name`
- **Format function**: `code_name -> @string`

## Examples

### Binary Natural Numbers

```k
$ bnat = < {} _, bnat 0, bnat 1 >;

@literal bnat "0b[01]+" parse_binary format_binary;

parse_binary = @string 
  < 
    -"0b" binary_digits,
    binary_digits
  >
  {() digits, _ base} 
  _parse_binary_digits
  $bnat;

_parse_binary_digits = 
  ${@string digits, bnat base}
  <
    {.digits empty? if, .base then} .then,
    {.digits head digit, .digits tail digits, {.base x, bnat_2 y} times base}
    {
      .digit -"0" bnat_0,
      .digit -"1" bnat_1  
    }
    {.base x, () y} plus
    {() digits, () base} _parse_binary_digits
  >;

format_binary = $bnat "0b" swap _format_binary_digits;

_format_binary_digits = $bnat
  <
    ._ "0",
    {() n, "1" acc} _format_loop
  >;

_format_loop = 
  ${bnat n, @string acc}
  <
    {.n zero? if, .acc then} .then,
    {.n half half, .half.rem zero? "0" "1" digit}
    {.acc x, .digit y} concat
    {.half.div n, () acc} _format_loop
  >;
```

### Decimal Natural Numbers

```k
@literal bnat "\d+" parse_decimal format_decimal;

parse_decimal = @string _parse_decimal_digits bnat_0;

_parse_decimal_digits = 
  ${@string input, bnat acc}
  <
    {.input empty? if, .acc then} .then,
    {.input head digit, .input tail input, {.acc x, bnat_10 y} times acc}
    {
      .digit -"0" bnat_0,
      .digit -"1" bnat_1,
      .digit -"2" bnat_2,
      .digit -"3" bnat_3,
      .digit -"4" bnat_4,
      .digit -"5" bnat_5,
      .digit -"6" bnat_6,
      .digit -"7" bnat_7,
      .digit -"8" bnat_8,
      .digit -"9" bnat_9
    }
    {.acc x, () y} plus
    {() input, () acc} _parse_decimal_digits
  >;
```

### IEEE Float (Simple)

```k
$ ieee_float = { bnat mantissa, bnat exponent, bool sign };
$ bool = < {} true, {} false >;

@literal ieee_float "-?\d+(\.\d+)?([eE][+-]?\d+)?" parse_float format_float;

parse_float = @string 
  {
    .sign? "-" bool_true bool_false sign,
    .integer_part parse_decimal mantissa,
    .fractional_part? parse_fractional frac,
    .exponent_part? parse_exponent exp
  }
  {.mantissa x, .frac y} combine_parts
  {() mantissa, .exp exponent, .sign sign}
  $ieee_float;
```

### UTF-8 Strings

```k
$ utf8_string = [ utf8_char ];
$ utf8_char = < bnat ascii, {bnat byte1, bnat byte2} utf8_2, ... >;

@literal utf8_string "\"([^\"\\\\]|\\\\.)*\"" parse_utf8_string format_utf8_string;
```

## Integration with K Language

### Extended Grammar

The k language parser would be extended to recognize literal definitions:

```jison
literal_def: AT NAME code PATTERN parse_func format_func SC
```

### Usage in Expressions

Once a literal is defined, it can be used directly:

```k
$ bnat = < {} _, bnat 0, bnat 1 >;
@literal bnat "\d+" parse_decimal format_decimal;

-- Now we can write:
ten = 10;           -- Instead of: _ _0 _1 _0 _1 $bnat
binary_five = 0b101; -- Instead of: _ _1 _0 _1 $bnat
```

### Automatic Code Generation

The compiler would generate:

1. **Lexer patterns** for recognizing literals
2. **Parser rules** for constructing AST nodes
3. **Type checking** to ensure literal matches target code
4. **Runtime conversion** using parse/format functions

## Implementation Strategy

1. **Extend lexer** to recognize `@literal` statements
2. **Parse literal definitions** during compilation
3. **Generate dynamic lexer rules** for defined literals
4. **Insert parse calls** in AST for literal nodes
5. **Provide runtime support** for format functions

This approach maintains the mathematical rigor of k while providing practical usability for common data types.