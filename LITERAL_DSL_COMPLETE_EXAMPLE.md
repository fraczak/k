# Literal Notation DSL for K Language - Complete Example

This document demonstrates a complete working example of the literal notation DSL for the k language, showing how it transforms the verbose syntax into human-friendly notation.

## Before: Verbose K Language Syntax

```k
-- Original bnat.k style - very verbose for simple values
$ bnat = < {} _, bnat 0, bnat 1 >;

-- Defining number 10 requires this complex expression:
ten = _ _0 _1 _0 _1 $bnat;

-- Defining number 255 is even worse:
two_fifty_five = _ _1 _1 _1 _1 _1 _1 _1 _1 $bnat;

-- A simple calculation like 10 + 20 = 30:
result = {
  (_ _0 _1 _0 _1 $bnat) x,     -- 10
  (_ _0 _0 _1 _0 _1 $bnat) y   -- 20  
} plus;
```

## After: Human-Friendly Literal Notation

```k
-- Same functionality with literal notation DSL
$ bnat = < {} _, bnat 0, bnat 1 >;

-- Define literal notation for bnat
@literal bnat {
  patterns: ["\\d+", "0b[01]+", "0x[0-9a-fA-F]+"],
  parsers: [parse_decimal, parse_binary, parse_hex],
  formatter: format_decimal
};

-- Now we can write numbers naturally:
ten = 10;
two_fifty_five = 255;
binary_ten = 0b1010;
hex_ten = 0xA;

-- Simple calculation becomes readable:
result = {10 x, 20 y} plus;

-- All equivalent ways to write the same value:
same_value = 10;        -- decimal
same_value = 0b1010;    -- binary  
same_value = 0xA;       -- hexadecimal
```

## More Complex Examples

### Working with Dates and Times

```k
$ date = { bnat year, bnat month, bnat day };
$ time = { bnat hour, bnat minute, bnat second };

@literal date {
  patterns: ["\\d{4}-\\d{2}-\\d{2}"],
  parsers: [parse_iso_date],
  formatter: format_iso_date
};

@literal time {
  patterns: ["\\d{2}:\\d{2}:\\d{2}"],
  parsers: [parse_time],
  formatter: format_time
};

-- Instead of:
christmas = {2023 year, 12 month, 25 day} $date;
noon = {12 hour, 0 minute, 0 second} $time;

-- We can write:
christmas = 2023-12-25;
noon = 12:00:00;
```

### Working with Colors

```k
$ color = { bnat red, bnat green, bnat blue };

@literal color {
  patterns: ["#[0-9a-fA-F]{6}", "rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)"],
  parsers: [parse_hex_color, parse_rgb_color],
  formatter: format_hex_color
};

-- Instead of:
red_color = {255 red, 0 green, 0 blue} $color;

-- We can write:
red_color = #FF0000;
red_color = rgb(255, 0, 0);  -- equivalent
```

### Working with Strings

```k
$ utf8_string = [ utf8_char ];

@literal utf8_string {
  patterns: ["\"([^\"\\\\]|\\\\.)*\""],
  parsers: [parse_escaped_string],
  formatter: format_escaped_string
};

-- Instead of building character arrays manually:
greeting = [
  {72 ascii} utf8_char,   -- 'H'
  {101 ascii} utf8_char,  -- 'e'  
  {108 ascii} utf8_char,  -- 'l'
  {108 ascii} utf8_char,  -- 'l'
  {111 ascii} utf8_char   -- 'o'
] $utf8_string;

-- We can write:
greeting = "Hello";
```

## DSL Implementation Strategy

### 1. Lexer Extension

The k language lexer is extended with a `DynamicLexer` that:
- Registers literal patterns at parse time
- Matches input against patterns with priority ordering
- Generates `LITERAL` tokens with type information

### 2. Parser Extension  

The grammar is extended with:
```jison
literal_def: AT NAME code pattern_list parser_list formatter SC;
exp: LITERAL { /* create literal expression node */ };
```

### 3. Compiler Extension

The compiler handles literal expressions by:
- Looking up the appropriate parser for the matched pattern
- Generating code that applies the parser to the literal value
- Type-checking the result against the target code

### 4. Runtime Support

A `LiteralRuntime` provides:
- Caching of parsed literal values
- String-to-value conversion using k language parsers
- Value-to-string formatting using k language formatters

## Benefits

### 1. Dramatic Readability Improvement

**Before:**
```k
calculate_area = {
  (_ _1 _1 _0 _0 _1 $bnat) width,    -- width = 25  
  (_ _0 _1 _0 _1 $bnat) height       -- height = 10
} times;
```

**After:**
```k
calculate_area = {25 width, 10 height} times;
```

### 2. Type Safety Maintained

The DSL maintains k's strong typing:
- Literal patterns are checked at compile time
- Parser functions ensure type correctness
- Invalid literals are rejected with clear error messages

### 3. Multiple Representations

The same value can be expressed in multiple notations:
```k
same_number = 255;      -- decimal
same_number = 0xFF;     -- hexadecimal  
same_number = 0b11111111; -- binary
same_number = 0o377;    -- octal
```

### 4. Bidirectional Conversion

Values can be converted back to human-readable form:
```k
-- Format a computed result back to string
result = {10 x, 20 y} plus;
result_string = format_decimal result;  -- "30"
```

## Integration with Existing Code

The DSL is designed to be fully backward compatible:

```k
-- Original verbose syntax still works
old_style = _ _0 _1 _0 _1 $bnat;

-- New literal syntax 
new_style = 10;

-- They produce equivalent values
equivalent = {old_style x, new_style y} eq?;  -- true
```

## Future Extensions

The DSL framework can be extended to support:

### 1. User-Defined Literals
```k
$ complex = { rational real, rational imaginary };
@literal complex "\\d+(\\.\\d+)?[+-]\\d+(\\.\\d+)?i" parse_complex format_complex;

z = 3.5+2.1i;  -- complex number
```

### 2. Context-Sensitive Parsing
```k
@literal url {
  patterns: ["https?://[^\\s]+"],
  parsers: [parse_http_url],
  formatter: format_url,
  context: "web"
};
```

### 3. Validation Rules
```k
@literal email {
  patterns: ["[^@]+@[^@]+\\.[^@]+"],
  parsers: [parse_email],
  formatter: format_email,
  validate: is_valid_email
};
```

This DSL transforms k from a mathematically rigorous but verbose language into one that maintains its theoretical foundations while being practical for everyday programming tasks.