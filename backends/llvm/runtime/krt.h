#ifndef KRT_H
#define KRT_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct k_rt k_rt;
typedef struct k_value k_value;

typedef struct {
  void *block;
  size_t used;
} k_rt_checkpoint;

typedef struct {
  const char *label;
  size_t label_length;
  size_t target;
} k_pattern_edge;

typedef struct {
  int kind;
  size_t edge_count;
  k_pattern_edge *edges;
} k_pattern_node;

typedef struct {
  size_t node_count;
  k_pattern_node *nodes;
} k_pattern;

typedef struct {
  k_value *value;
  k_pattern *pattern;
} k_wire_input;

typedef struct {
  unsigned char *bytes;
  size_t length;
  unsigned char current;
  int bit_count;
  int ok;
} k_wire_prefix;

enum {
  KP_ANY,
  KP_OPEN_PRODUCT,
  KP_OPEN_UNION,
  KP_CLOSED_PRODUCT,
  KP_CLOSED_UNION
};

typedef struct {
  int32_t status;
  k_value *value;
} k_result;

enum {
  K_STATUS_OK = 0,
  K_STATUS_UNSUPPORTED = 1,
  K_STATUS_TAIL_CALL = 2
};

k_rt *k_rt_new(void);
void k_rt_reset(k_rt *rt);
k_rt_checkpoint k_rt_mark(k_rt *rt);
void k_rt_rewind(k_rt *rt, k_rt_checkpoint mark);
void *k_rt_alloc(k_rt *rt, size_t size);
void k_rt_free(k_rt *rt);

k_value *k_unit(k_rt *rt);
k_value *k_bit0(k_rt *rt);
k_value *k_bit1(k_rt *rt);
k_value *k_product(k_rt *rt, size_t count);
void k_product_set_n(k_value *product, const char *label, size_t label_length, k_value *value);
void k_product_set_borrowed_n(k_value *product, const char *label, size_t label_length, k_value *value);
void k_product_set_at(k_value *product, size_t index, const char *label, size_t label_length, k_value *value);
k_value *k_product_get_n(k_value *product, const char *label, size_t label_length);
k_value *k_product_get_at(k_value *product, size_t index);
void k_product_set(k_value *product, const char *label, k_value *value);
k_value *k_product_get(k_value *product, const char *label);

k_value *k_variant_n(k_rt *rt, const char *tag, size_t tag_length, k_value *payload);
k_value *k_variant_borrowed_n(k_rt *rt, const char *tag, size_t tag_length, k_value *payload);
k_value *k_variant_borrowed_direct_n(k_rt *rt, const char *tag, size_t tag_length, k_value *payload);
k_value *k_variant_unit_borrowed_n(k_rt *rt, const char *tag, size_t tag_length);
k_value *k_variant(k_rt *rt, const char *tag, k_value *payload);
const char *k_variant_tag(k_value *value);
size_t k_variant_tag_length(k_value *value);
int k_variant_tag_matches(k_value *value, const char *tag, size_t tag_length);
k_value *k_variant_payload(k_value *value);

int k_equal(k_value *a, k_value *b);
void k_print_json(FILE *out, k_value *value);
k_value *k_read_wire(FILE *in, k_rt *rt);
k_wire_input k_read_wire_envelope(FILE *in, k_rt *rt);
k_wire_input k_decode_wire_envelope(const unsigned char *bytes, size_t length, k_rt *rt);
void k_wire_input_free(k_wire_input input);
int k_pattern_equal(k_pattern *a, k_pattern *b);
k_wire_prefix k_wire_prefix_for_pattern(k_pattern *pattern);
void k_wire_prefix_free(k_wire_prefix prefix);
k_value *k_decode_wire_value_with_prefix(const unsigned char *bytes, size_t length, k_wire_prefix *prefix, k_pattern *pattern, k_rt *rt);
unsigned char *k_encode_wire_as_with_prefix(k_wire_prefix *prefix, k_pattern *pattern, k_value *value, size_t *out_length);
unsigned char *k_encode_wire_as(k_pattern *pattern, k_value *value, size_t *out_length);
int k_write_wire(FILE *out, k_value *value);
int k_write_wire_as(FILE *out, k_pattern *pattern, k_value *value);

#endif
