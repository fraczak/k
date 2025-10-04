-- K Language Serialization DSL Examples
-- This file demonstrates how to define serialization mappings using k itself

-- Example 1: Variable-length integer encoding for bnat
$ varint_encode = {
  .bnat bnat_to_bits bits,
  .bits length len,
  .len encode_length_header header,
  .header .bits concat_bytes bytes
};

$ varint_decode = {
  .bytes decode_length_header {header, remaining},
  .header expected_length,
  .remaining .expected_length take_bytes bits,
  .bits bits_to_bnat bnat
};

-- Example 2: UTF-8 string encoding
$ utf8_encode = {
  .string string_to_utf8_bytes bytes
};

$ utf8_decode = {
  .bytes utf8_bytes_to_string string
};

-- Example 3: Composite structure encoding
$ person_encode = {
  .person {name, age},
  .name utf8_encode name_bytes,
  .age varint_encode age_bytes,
  .name_bytes length name_len,
  {
    .name_len varint_encode name_len_bytes,
    .name_len_bytes .name_bytes .age_bytes concat_all bytes
  }
};

-- Example 4: Auto-detecting format based on structure analysis
$ auto_detect = {
  .input analyze_structure structure_type,
  .structure_type {
    {"bnat" type, .input varint_encode then},
    {"string" type, .input utf8_encode then},
    {"composite" type, .input person_encode then}
  } select_encoder
};

-- Example 5: Bit-level packing for efficiency
$ bit_packed_encode = {
  .input extract_bit_fields fields,
  .fields pack_bits_efficiently packed,
  .packed add_bit_alignment bytes
};

-- Helper functions that would be implemented in the DSL framework
bnat_to_bits = <builtin_bnat_to_bits>;
bits_to_bnat = <builtin_bits_to_bnat>;
string_to_utf8_bytes = <builtin_string_to_utf8>;
utf8_bytes_to_string = <builtin_utf8_to_string>;
encode_length_header = <builtin_encode_varint_length>;
decode_length_header = <builtin_decode_varint_length>;
concat_bytes = <builtin_concat_byte_arrays>;
concat_all = <builtin_concat_multiple_arrays>;
analyze_structure = <builtin_analyze_k_structure>;
pack_bits_efficiently = <builtin_bit_packing>;
add_bit_alignment = <builtin_byte_alignment>;