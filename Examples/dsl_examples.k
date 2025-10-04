-- Example DSL Definitions for Common Data Types in K Language

-- =============================================================================
-- IEEE 754 Floating Point Numbers
-- =============================================================================

$ ieee754 = { bool sign, bnat exponent, bnat mantissa };
$ bool = < {} false, {} true >;

@literal ieee754 {
  patterns: [
    "-?\\d+\\.\\d+([eE][+-]?\\d+)?",  -- 3.14, -2.5, 1.23e-4
    "-?\\d+[eE][+-]?\\d+",            -- 1e10, -5E-3
    "NaN",                            -- Not a Number
    "Infinity",                       -- Positive infinity
    "-Infinity"                       -- Negative infinity  
  ],
  parsers: [
    parse_decimal_float,
    parse_scientific_float,
    parse_nan,
    parse_pos_infinity,
    parse_neg_infinity
  ],
  formatter: format_ieee754
};

parse_decimal_float = $@string
  {
    .sign? "-" bool_true bool_false sign,
    .integer_part parse_decimal int_part,
    .fractional_part parse_decimal frac_part,
    .exponent_part? parse_scientific_exponent exp
  }
  construct_ieee754;

-- =============================================================================
-- UTF-8 Strings  
-- =============================================================================

$ utf8_char = < bnat ascii, {bnat b1, bnat b2} utf8_2, 
                {bnat b1, bnat b2, bnat b3} utf8_3,
                {bnat b1, bnat b2, bnat b3, bnat b4} utf8_4 >;
$ utf8_string = [ utf8_char ];

@literal utf8_string {
  patterns: [
    "\"([^\"\\\\]|\\\\.)*\"",         -- "hello world", "line 1\nline 2"
    "'([^'\\\\]|\\\\.)*'",            -- 'hello world', 'don\'t'
    "r\"[^\"]*\"",                    -- r"raw string" (no escapes)
    "u\"[^\"]*\""                     -- u"unicode string" 
  ],
  parsers: [
    parse_escaped_string,
    parse_escaped_string_single,
    parse_raw_string,
    parse_unicode_string
  ],
  formatter: format_utf8_string
};

parse_escaped_string = $@string
  -"\"" remove_quotes -"\""          -- Remove surrounding quotes
  parse_escape_sequences
  string_to_utf8_chars;

parse_escape_sequences = $@string
  {() input, [] result} _parse_escapes;

_parse_escapes = 
  ${@string input, [utf8_char] result}
  <
    {.input empty? if, .result then} .then,
    {.input head -"\\" if, .input parse_escape_char char} parse_single_char,
    {.input head char, .input tail input} parse_single_char
  >
  {.result x, .char y} append
  {() input, () result} _parse_escapes;

-- =============================================================================
-- Rational Numbers
-- =============================================================================

$ rational = { bnat numerator, bnat denominator };

@literal rational {
  patterns: [
    "\\d+/\\d+",                      -- 3/4, 22/7, 1/3
    "\\d+",                           -- 5 (= 5/1)
    "-\\d+/\\d+",                     -- -3/4
    "-\\d+"                           -- -5 (= -5/1)
  ],
  parsers: [
    parse_fraction,
    parse_integer_as_rational,
    parse_negative_fraction,
    parse_negative_integer_as_rational
  ],
  formatter: format_rational
};

parse_fraction = $@string
  {
    .numerator_part parse_decimal num,
    .denominator_part parse_decimal den
  }
  {.num numerator, .den denominator}
  $rational;

-- =============================================================================
-- Date and Time
-- =============================================================================

$ date = { bnat year, bnat month, bnat day };
$ time = { bnat hour, bnat minute, bnat second };
$ datetime = { date date, time time };

@literal date {
  patterns: [
    "\\d{4}-\\d{2}-\\d{2}",          -- 2023-12-25 (ISO format)
    "\\d{2}/\\d{2}/\\d{4}",          -- 12/25/2023 (US format)
    "\\d{2}\\.\\d{2}\\.\\d{4}"       -- 25.12.2023 (European format)
  ],
  parsers: [
    parse_iso_date,
    parse_us_date,  
    parse_european_date
  ],
  formatter: format_iso_date
};

@literal time {
  patterns: [
    "\\d{2}:\\d{2}:\\d{2}",          -- 14:30:45
    "\\d{2}:\\d{2}",                 -- 14:30 (seconds = 0)
    "\\d{1,2}(:\\d{2})?(:\\d{2})? ?(AM|PM)" -- 2:30 PM, 14:30:45
  ],
  parsers: [
    parse_24h_time,
    parse_24h_time_no_seconds,
    parse_12h_time
  ],
  formatter: format_24h_time
};

-- =============================================================================
-- Colors
-- =============================================================================

$ color = { bnat red, bnat green, bnat blue, bnat alpha };

@literal color {
  patterns: [
    "#[0-9a-fA-F]{6}",               -- #FF0000 (hex RGB)
    "#[0-9a-fA-F]{8}",               -- #FF0000FF (hex RGBA) 
    "rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)", -- rgb(255, 0, 0)
    "rgba\\(\\d+,\\s*\\d+,\\s*\\d+,\\s*[0-9.]+\\)", -- rgba(255,0,0,0.5)
    "hsl\\(\\d+,\\s*\\d+%,\\s*\\d+%\\)" -- hsl(0, 100%, 50%)
  ],
  parsers: [
    parse_hex_rgb,
    parse_hex_rgba,
    parse_css_rgb,
    parse_css_rgba,
    parse_css_hsl
  ],
  formatter: format_hex_rgba
};

-- =============================================================================
-- Regular Expressions
-- =============================================================================

$ regex_flag = < {} global, {} case_insensitive, {} multiline >;
$ regex = { @string pattern, [regex_flag] flags };

@literal regex {
  patterns: [
    "/([^/\\\\]|\\\\.)+/[gimuy]*",   -- /pattern/flags
    "r\"([^\"\\\\]|\\\\.)*\""        -- r"raw pattern"
  ],
  parsers: [
    parse_js_regex,
    parse_raw_regex
  ],  
  formatter: format_js_regex
};

-- =============================================================================
-- JSON-like Structures
-- =============================================================================

$ json_value = < 
  @string str,
  bnat num, 
  bool boolean,
  {} null,
  [json_value] array,
  {[@string] keys, [json_value] values} object
>;

@literal json_value {
  patterns: [
    "\\{[^}]*\\}",                   -- {"key": "value"}
    "\\[[^\\]]*\\]",                 -- [1, 2, 3]
    "\"[^\"]*\"",                    -- "string"  
    "\\d+(\\.\\d+)?",                -- 123, 3.14
    "true|false",                    -- true, false
    "null"                           -- null
  ],
  parsers: [
    parse_json_object,
    parse_json_array,
    parse_json_string,
    parse_json_number,
    parse_json_boolean,
    parse_json_null
  ],
  formatter: format_json
};

-- =============================================================================
-- Usage Examples
-- =============================================================================

-- With the DSL, you could write:
-- pi = 3.14159;                    -- Instead of complex ieee754 construction
-- half = 1/2;                      -- Instead of: {bnat_1 numerator, bnat_2 denominator}
-- christmas = 2023-12-25;          -- Instead of: {bnat_2023 year, bnat_12 month, bnat_25 day}
-- noon = 12:00:00;                 -- Instead of: {bnat_12 hour, bnat_0 minute, bnat_0 second}
-- red = #FF0000;                   -- Instead of: {bnat_255 red, bnat_0 green, bnat_0 blue, bnat_255 alpha}
-- pattern = /[a-z]+/gi;            -- Instead of complex regex construction
-- data = {"name": "John", "age": 30}; -- Instead of verbose json_value construction

()