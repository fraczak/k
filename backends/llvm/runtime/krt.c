#include "krt.h"

#include <stddef.h>
#include <stdlib.h>
#include <string.h>

enum {
  K_ARENA_BLOCK_SIZE = 262144
};

typedef enum {
  K_VALUE_UNIT,
  K_VALUE_PRODUCT,
  K_VALUE_VARIANT
} k_value_kind;

typedef struct {
  char *label;
  size_t label_length;
  k_value *value;
} k_field;

typedef struct k_arena_block {
  struct k_arena_block *next;
  size_t used;
  size_t capacity;
  unsigned char data[];
} k_arena_block;

struct k_value {
  k_value_kind kind;
  k_rt *rt;
  union {
    struct {
      size_t count;
      size_t capacity;
      k_field *fields;
    } product;
    struct {
      char *tag;
      size_t tag_length;
      k_value *payload;
    } variant;
  } as;
};

struct k_rt {
  k_arena_block *blocks;
  k_value *unit_cache;
  k_value *bit0_cache;
  k_value *bit1_cache;
  int has_reusable_blocks;
};

static size_t align_size(size_t size) {
  size_t alignment = sizeof(max_align_t);
  return (size + alignment - 1) & ~(alignment - 1);
}

static k_arena_block *reuse_arena_block(k_rt *rt, size_t size) {
  if (rt == NULL || !rt->has_reusable_blocks) return NULL;
  k_arena_block **link = rt == NULL || rt->blocks == NULL ? NULL : &rt->blocks->next;
  int saw_reusable = 0;
  while (link != NULL && *link != NULL) {
    k_arena_block *block = *link;
    if (block->used == 0) {
      saw_reusable = 1;
      if (block->capacity >= size) {
        *link = block->next;
        block->next = rt->blocks;
        rt->blocks = block;
        return block;
      }
    }
    link = &block->next;
  }
  rt->has_reusable_blocks = saw_reusable;
  return NULL;
}

static void *rt_alloc(k_rt *rt, size_t size) {
  if (rt == NULL) return NULL;
  size = align_size(size == 0 ? 1 : size);
  k_arena_block *block = rt->blocks;
  if (block == NULL || block->capacity - block->used < size) {
    block = reuse_arena_block(rt, size);
    if (block == NULL) {
      size_t capacity = size > K_ARENA_BLOCK_SIZE ? size : K_ARENA_BLOCK_SIZE;
      block = malloc(sizeof(k_arena_block) + capacity);
      if (block == NULL) abort();
      block->next = rt->blocks;
      block->used = 0;
      block->capacity = capacity;
      rt->blocks = block;
    }
  }
  void *ptr = block->data + block->used;
  block->used += size;
  return ptr;
}

void *k_rt_alloc(k_rt *rt, size_t size) {
  return rt_alloc(rt, size);
}

static void *rt_zalloc(k_rt *rt, size_t count, size_t size) {
  if (count != 0 && size > ((size_t)-1) / count) abort();
  size_t bytes = count * size;
  void *ptr = rt_alloc(rt, bytes);
  if (ptr == NULL) return NULL;
  memset(ptr, 0, bytes);
  return ptr;
}

static char *rt_memdup_text(k_rt *rt, const char *text, size_t length) {
  char *copy = rt_alloc(rt, length + 1);
  if (copy == NULL) abort();
  if (length > 0) memcpy(copy, text, length);
  copy[length] = 0;
  return copy;
}

static char *heap_memdup_text(const char *text, size_t length) {
  char *copy = malloc(length + 1);
  if (copy == NULL) abort();
  if (length > 0) memcpy(copy, text, length);
  copy[length] = 0;
  return copy;
}

static int bytes_equal(const char *a, size_t a_length, const char *b, size_t b_length) {
  if (a_length != b_length) return 0;
  if (a == b) return 1;
  return a_length == 0 || memcmp(a, b, a_length) == 0;
}

static int is_empty_product(k_value *value);

static int numeric_label_index(const char *label, size_t label_length, size_t *out) {
  if (label == NULL || label_length == 0) return 0;
  size_t value = 0;
  for (size_t i = 0; i < label_length; i++) {
    unsigned char ch = (unsigned char)label[i];
    if (ch < '0' || ch > '9') return 0;
    size_t digit = (size_t)(ch - '0');
    if (value > (((size_t)-1) - digit) / 10) return 0;
    value = value * 10 + digit;
  }
  *out = value;
  return 1;
}

static k_value *alloc_value(k_rt *rt, k_value_kind kind) {
  if (rt == NULL) return NULL;
  k_value *value = rt_alloc(rt, sizeof(k_value));
  if (value == NULL) abort();
  value->kind = kind;
  value->rt = rt;
  return value;
}

static k_value *alloc_product_value(k_rt *rt, size_t count) {
  if (rt == NULL) return NULL;
  size_t header_size = align_size(sizeof(k_value));
  if (count != 0 && sizeof(k_field) > (((size_t)-1) - header_size) / count) abort();
  size_t fields_size = count * sizeof(k_field);
  unsigned char *memory = rt_alloc(rt, header_size + fields_size);
  if (memory == NULL) abort();
  k_value *product = (k_value *)memory;
  product->kind = K_VALUE_PRODUCT;
  product->rt = rt;
  product->as.product.count = 0;
  product->as.product.capacity = count;
  product->as.product.fields = count == 0 ? NULL : (k_field *)(memory + header_size);
  if (fields_size > 0) memset(product->as.product.fields, 0, fields_size);
  return product;
}

k_rt *k_rt_new(void) {
  return calloc(1, sizeof(k_rt));
}

void k_rt_reset(k_rt *rt) {
  if (rt == NULL) return;
  int has_next = rt->blocks != NULL && rt->blocks->next != NULL;
  for (k_arena_block *block = rt->blocks; block != NULL; block = block->next) {
    block->used = 0;
  }
  rt->unit_cache = NULL;
  rt->bit0_cache = NULL;
  rt->bit1_cache = NULL;
  rt->has_reusable_blocks = has_next;
}

k_rt_checkpoint k_rt_mark(k_rt *rt) {
  k_rt_checkpoint mark = {0, 0};
  if (rt == NULL || rt->blocks == NULL) return mark;
  mark.block = rt->blocks;
  mark.used = rt->blocks->used;
  return mark;
}

void k_rt_rewind(k_rt *rt, k_rt_checkpoint mark) {
  if (rt == NULL) return;
  if (mark.block == NULL) {
    k_rt_reset(rt);
    return;
  }
  int has_reusable = 0;
  for (k_arena_block *block = rt->blocks; block != NULL; block = block->next) {
    if (block == (k_arena_block *)mark.block) {
      block->used = mark.used;
      break;
    }
    block->used = 0;
    has_reusable = 1;
  }
  rt->unit_cache = NULL;
  rt->bit0_cache = NULL;
  rt->bit1_cache = NULL;
  rt->has_reusable_blocks = has_reusable;
}

void k_rt_free(k_rt *rt) {
  if (rt == NULL) return;
  k_arena_block *block = rt->blocks;
  while (block != NULL) {
    k_arena_block *next = block->next;
    free(block);
    block = next;
  }
  free(rt);
}

k_value *k_unit(k_rt *rt) {
  if (rt == NULL) return NULL;
  if (rt->unit_cache != NULL) return rt->unit_cache;
  k_value *unit = alloc_product_value(rt, 0);
  if (unit == NULL) return NULL;
  rt->unit_cache = unit;
  return unit;
}

static k_value *k_bit(k_rt *rt, int bit) {
  if (rt == NULL) return NULL;
  k_value **cache = bit ? &rt->bit1_cache : &rt->bit0_cache;
  if (*cache != NULL) return *cache;
  k_value *variant = alloc_value(rt, K_VALUE_VARIANT);
  if (variant == NULL) return NULL;
  variant->as.variant.tag = bit ? "1" : "0";
  variant->as.variant.tag_length = 1;
  variant->as.variant.payload = k_unit(rt);
  *cache = variant;
  return variant;
}

k_value *k_bit0(k_rt *rt) {
  return k_bit(rt, 0);
}

k_value *k_bit1(k_rt *rt) {
  return k_bit(rt, 1);
}

k_value *k_product(k_rt *rt, size_t count) {
  return alloc_product_value(rt, count);
}

k_value *k_product_get_n(k_value *product, const char *label, size_t label_length) {
  if (product == NULL || product->kind != K_VALUE_PRODUCT || label == NULL) return NULL;
  size_t index = 0;
  if (numeric_label_index(label, label_length, &index) && index < product->as.product.count) {
    k_field *field = &product->as.product.fields[index];
    if (bytes_equal(field->label, field->label_length, label, label_length)) return field->value;
  }
  for (size_t i = 0; i < product->as.product.count; i++) {
    if (bytes_equal(product->as.product.fields[i].label, product->as.product.fields[i].label_length, label, label_length)) {
      return product->as.product.fields[i].value;
    }
  }
  return NULL;
}

void k_product_set_at(k_value *product, size_t index, const char *label, size_t label_length, k_value *value) {
  if (product == NULL || product->kind != K_VALUE_PRODUCT || label == NULL || index >= product->as.product.capacity) return;
  k_field *field = &product->as.product.fields[index];
  field->label = (char *)label;
  field->label_length = label_length;
  field->value = value;
  if (index >= product->as.product.count) product->as.product.count = index + 1;
}

k_value *k_product_get_at(k_value *product, size_t index) {
  if (product == NULL || product->kind != K_VALUE_PRODUCT || index >= product->as.product.count) return NULL;
  return product->as.product.fields[index].value;
}

static void k_product_set_internal(k_value *product, const char *label, size_t label_length, k_value *value, int borrow_label) {
  if (product == NULL || product->kind != K_VALUE_PRODUCT || label == NULL) return;
  size_t numeric_index = 0;
  if (numeric_label_index(label, label_length, &numeric_index) &&
      numeric_index < product->as.product.capacity &&
      numeric_index <= product->as.product.count) {
    k_field *field = &product->as.product.fields[numeric_index];
    if (numeric_index == product->as.product.count) {
      field->label = borrow_label ? (char *)label : rt_memdup_text(product->rt, label, label_length);
      field->label_length = label_length;
      field->value = value;
      product->as.product.count++;
      return;
    }
    if (bytes_equal(field->label, field->label_length, label, label_length)) {
      field->value = value;
      return;
    }
  }

  for (size_t i = 0; i < product->as.product.count; i++) {
    if (bytes_equal(product->as.product.fields[i].label, product->as.product.fields[i].label_length, label, label_length)) {
      product->as.product.fields[i].value = value;
      return;
    }
  }

  if (product->as.product.count == product->as.product.capacity) {
    size_t capacity = product->as.product.capacity == 0 ? 1 : product->as.product.capacity * 2;
    k_field *fields = rt_zalloc(product->rt, capacity, sizeof(k_field));
    if (fields == NULL) abort();
    if (product->as.product.count > 0) {
      memcpy(fields, product->as.product.fields, product->as.product.count * sizeof(k_field));
    }
    product->as.product.fields = fields;
    product->as.product.capacity = capacity;
  }

  size_t index = product->as.product.count++;
  product->as.product.fields[index].label = borrow_label ? (char *)label : rt_memdup_text(product->rt, label, label_length);
  product->as.product.fields[index].label_length = label_length;
  product->as.product.fields[index].value = value;
}

void k_product_set_n(k_value *product, const char *label, size_t label_length, k_value *value) {
  k_product_set_internal(product, label, label_length, value, 0);
}

void k_product_set_borrowed_n(k_value *product, const char *label, size_t label_length, k_value *value) {
  k_product_set_internal(product, label, label_length, value, 1);
}

void k_product_set(k_value *product, const char *label, k_value *value) {
  if (label == NULL) return;
  k_product_set_n(product, label, strlen(label), value);
}

k_value *k_product_get(k_value *product, const char *label) {
  if (label == NULL) return NULL;
  return k_product_get_n(product, label, strlen(label));
}

static k_value *k_variant_internal(k_rt *rt, const char *tag, size_t tag_length, k_value *payload, int borrow_tag) {
  if (tag == NULL) return NULL;
  if (rt != NULL && tag_length == 1 && is_empty_product(payload) && (tag[0] == '0' || tag[0] == '1')) {
    return tag[0] == '0' ? k_bit0(rt) : k_bit1(rt);
  }
  k_value *variant = alloc_value(rt, K_VALUE_VARIANT);
  if (variant == NULL) return NULL;
  variant->as.variant.tag = borrow_tag ? (char *)tag : rt_memdup_text(rt, tag, tag_length);
  variant->as.variant.tag_length = tag_length;
  variant->as.variant.payload = payload;
  return variant;
}

k_value *k_variant_n(k_rt *rt, const char *tag, size_t tag_length, k_value *payload) {
  return k_variant_internal(rt, tag, tag_length, payload, 0);
}

k_value *k_variant_borrowed_n(k_rt *rt, const char *tag, size_t tag_length, k_value *payload) {
  return k_variant_internal(rt, tag, tag_length, payload, 1);
}

k_value *k_variant_borrowed_direct_n(k_rt *rt, const char *tag, size_t tag_length, k_value *payload) {
  if (tag == NULL) return NULL;
  k_value *variant = alloc_value(rt, K_VALUE_VARIANT);
  if (variant == NULL) return NULL;
  variant->as.variant.tag = (char *)tag;
  variant->as.variant.tag_length = tag_length;
  variant->as.variant.payload = payload;
  return variant;
}

k_value *k_variant_unit_borrowed_n(k_rt *rt, const char *tag, size_t tag_length) {
  if (tag == NULL) return NULL;
  if (rt != NULL && tag_length == 1 && (tag[0] == '0' || tag[0] == '1')) {
    return tag[0] == '0' ? k_bit0(rt) : k_bit1(rt);
  }
  k_value *variant = alloc_value(rt, K_VALUE_VARIANT);
  if (variant == NULL) return NULL;
  variant->as.variant.tag = (char *)tag;
  variant->as.variant.tag_length = tag_length;
  variant->as.variant.payload = k_unit(rt);
  return variant;
}

k_value *k_variant(k_rt *rt, const char *tag, k_value *payload) {
  if (tag == NULL) return NULL;
  return k_variant_n(rt, tag, strlen(tag), payload);
}

const char *k_variant_tag(k_value *value) {
  if (value == NULL || value->kind != K_VALUE_VARIANT) return NULL;
  return value->as.variant.tag;
}

size_t k_variant_tag_length(k_value *value) {
  if (value == NULL || value->kind != K_VALUE_VARIANT) return 0;
  return value->as.variant.tag_length;
}

int k_variant_tag_matches(k_value *value, const char *tag, size_t tag_length) {
  if (value == NULL || value->kind != K_VALUE_VARIANT || tag == NULL) return 0;
  return bytes_equal(value->as.variant.tag, value->as.variant.tag_length, tag, tag_length);
}

k_value *k_variant_payload(k_value *value) {
  if (value == NULL || value->kind != K_VALUE_VARIANT) return NULL;
  return value->as.variant.payload;
}

int k_equal(k_value *a, k_value *b) {
  if (a == b) return 1;
  if (a == NULL || b == NULL) return 0;
  if (a->kind != b->kind) return 0;

  if (a->kind == K_VALUE_UNIT) return 1;

  if (a->kind == K_VALUE_VARIANT) {
    return bytes_equal(a->as.variant.tag, a->as.variant.tag_length, b->as.variant.tag, b->as.variant.tag_length) &&
      k_equal(a->as.variant.payload, b->as.variant.payload);
  }

  if (a->kind == K_VALUE_PRODUCT) {
    if (a->as.product.count != b->as.product.count) return 0;
    for (size_t i = 0; i < a->as.product.count; i++) {
      k_value *b_field = k_product_get_n(b, a->as.product.fields[i].label, a->as.product.fields[i].label_length);
      if (!k_equal(a->as.product.fields[i].value, b_field)) return 0;
    }
    return 1;
  }

  return 0;
}

static int is_empty_product(k_value *value) {
  return value != NULL &&
    value->kind == K_VALUE_PRODUCT &&
    value->as.product.count == 0;
}

static void print_json_string_n(FILE *out, const char *text, size_t length) {
  fputc('"', out);
  for (size_t i = 0; i < length; i++) {
    unsigned char ch = (unsigned char)text[i];
    switch (ch) {
      case '"':
        fputs("\\\"", out);
        break;
      case '\\':
        fputs("\\\\", out);
        break;
      case '\b':
        fputs("\\b", out);
        break;
      case '\f':
        fputs("\\f", out);
        break;
      case '\n':
        fputs("\\n", out);
        break;
      case '\r':
        fputs("\\r", out);
        break;
      case '\t':
        fputs("\\t", out);
        break;
      default:
        if (ch < 0x20) {
          fprintf(out, "\\u%04x", ch);
        } else {
          fputc(ch, out);
        }
        break;
    }
  }
  fputc('"', out);
}

static void print_json_string(FILE *out, const char *text) {
  print_json_string_n(out, text, strlen(text));
}

void k_print_json(FILE *out, k_value *value) {
  if (value == NULL) {
    fputs("null", out);
    return;
  }

  if (value->kind == K_VALUE_UNIT) {
    fputs("{}", out);
    return;
  }

  if (value->kind == K_VALUE_PRODUCT) {
    fputc('{', out);
    for (size_t i = 0; i < value->as.product.count; i++) {
      if (i > 0) fputc(',', out);
      print_json_string_n(out, value->as.product.fields[i].label, value->as.product.fields[i].label_length);
      fputc(':', out);
      k_print_json(out, value->as.product.fields[i].value);
    }
    fputc('}', out);
    return;
  }

  if (value->kind == K_VALUE_VARIANT) {
    if (is_empty_product(value->as.variant.payload)) {
      print_json_string_n(out, value->as.variant.tag, value->as.variant.tag_length);
      return;
    }
    fputc('{', out);
    print_json_string_n(out, value->as.variant.tag, value->as.variant.tag_length);
    fputc(':', out);
    k_print_json(out, value->as.variant.payload);
    fputc('}', out);
  }
}

typedef struct {
  const unsigned char *bytes;
  size_t length;
  size_t byte_offset;
  int bit_offset;
  int ok;
} bit_reader;

typedef struct {
  unsigned char *bytes;
  size_t length;
  size_t capacity;
  unsigned char current;
  int bit_count;
  int ok;
} bit_writer;

#define K_PATTERN_EDGE(label, target) {label, sizeof(label) - 1, target}

static k_pattern_edge core_edges_0[] = {K_PATTERN_EDGE("cons", 1), K_PATTERN_EDGE("nil", 3)};
static k_pattern_edge core_edges_1[] = {K_PATTERN_EDGE("car", 2), K_PATTERN_EDGE("cdr", 0)};
static k_pattern_edge core_edges_2[] = {K_PATTERN_EDGE("any", 3), K_PATTERN_EDGE("closed-product", 4), K_PATTERN_EDGE("closed-union", 4), K_PATTERN_EDGE("open-product", 4), K_PATTERN_EDGE("open-union", 4)};
static k_pattern_edge core_edges_4[] = {K_PATTERN_EDGE("cons", 5), K_PATTERN_EDGE("nil", 3)};
static k_pattern_edge core_edges_5[] = {K_PATTERN_EDGE("car", 6), K_PATTERN_EDGE("cdr", 4)};
static k_pattern_edge core_edges_6[] = {K_PATTERN_EDGE("label", 7), K_PATTERN_EDGE("target", 25)};
static k_pattern_edge core_edges_7[] = {K_PATTERN_EDGE("cons", 8), K_PATTERN_EDGE("nil", 3)};
static k_pattern_edge core_edges_8[] = {K_PATTERN_EDGE("car", 9), K_PATTERN_EDGE("cdr", 7)};
static k_pattern_edge core_edges_9[] = {K_PATTERN_EDGE("ascii", 10), K_PATTERN_EDGE("bmp_common", 12), K_PATTERN_EDGE("bmp_private_use", 17), K_PATTERN_EDGE("plane0", 20), K_PATTERN_EDGE("supplementary_plane1", 21), K_PATTERN_EDGE("supplementary_planes2_16", 22)};
static k_pattern_edge core_edges_10[] = {K_PATTERN_EDGE("0", 11), K_PATTERN_EDGE("1", 11), K_PATTERN_EDGE("2", 11), K_PATTERN_EDGE("3", 11), K_PATTERN_EDGE("4", 11), K_PATTERN_EDGE("5", 11), K_PATTERN_EDGE("6", 11)};
static k_pattern_edge core_edges_11[] = {K_PATTERN_EDGE("0", 3), K_PATTERN_EDGE("1", 3)};
static k_pattern_edge core_edges_12[] = {K_PATTERN_EDGE("hi", 13), K_PATTERN_EDGE("lo", 16)};
static k_pattern_edge core_edges_13[] = {K_PATTERN_EDGE("h08_0F", 14), K_PATTERN_EDGE("h10_7F", 10), K_PATTERN_EDGE("h80_CF", 10), K_PATTERN_EDGE("hD0_D7", 14), K_PATTERN_EDGE("hF9", 3), K_PATTERN_EDGE("hFA_FB", 15), K_PATTERN_EDGE("hFC_FD", 15), K_PATTERN_EDGE("hFE_FF", 15)};
static k_pattern_edge core_edges_14[] = {K_PATTERN_EDGE("0", 11), K_PATTERN_EDGE("1", 11), K_PATTERN_EDGE("2", 11)};
static k_pattern_edge core_edges_15[] = {K_PATTERN_EDGE("0", 11)};
static k_pattern_edge core_edges_16[] = {K_PATTERN_EDGE("0", 11), K_PATTERN_EDGE("1", 11), K_PATTERN_EDGE("2", 11), K_PATTERN_EDGE("3", 11), K_PATTERN_EDGE("4", 11), K_PATTERN_EDGE("5", 11), K_PATTERN_EDGE("6", 11), K_PATTERN_EDGE("7", 11)};
static k_pattern_edge core_edges_17[] = {K_PATTERN_EDGE("hi", 18), K_PATTERN_EDGE("lo", 16)};
static k_pattern_edge core_edges_18[] = {K_PATTERN_EDGE("hE0_EF", 19), K_PATTERN_EDGE("hF0_F7", 14), K_PATTERN_EDGE("hF8", 3)};
static k_pattern_edge core_edges_19[] = {K_PATTERN_EDGE("0", 11), K_PATTERN_EDGE("1", 11), K_PATTERN_EDGE("2", 11), K_PATTERN_EDGE("3", 11)};
static k_pattern_edge core_edges_20[] = {K_PATTERN_EDGE("0", 11), K_PATTERN_EDGE("1", 11), K_PATTERN_EDGE("10", 11), K_PATTERN_EDGE("2", 11), K_PATTERN_EDGE("3", 11), K_PATTERN_EDGE("4", 11), K_PATTERN_EDGE("5", 11), K_PATTERN_EDGE("6", 11), K_PATTERN_EDGE("7", 11), K_PATTERN_EDGE("8", 11), K_PATTERN_EDGE("9", 11)};
static k_pattern_edge core_edges_21[] = {K_PATTERN_EDGE("lo", 16), K_PATTERN_EDGE("mid", 16)};
static k_pattern_edge core_edges_22[] = {K_PATTERN_EDGE("lo", 16), K_PATTERN_EDGE("mid", 16), K_PATTERN_EDGE("plane", 23)};
static k_pattern_edge core_edges_23[] = {K_PATTERN_EDGE("p02_03", 15), K_PATTERN_EDGE("p04_07", 24), K_PATTERN_EDGE("p08_0F", 14), K_PATTERN_EDGE("p10", 3)};
static k_pattern_edge core_edges_24[] = {K_PATTERN_EDGE("0", 11), K_PATTERN_EDGE("1", 11)};
static k_pattern_edge core_edges_25[] = {K_PATTERN_EDGE("0", 25), K_PATTERN_EDGE("1", 25), K_PATTERN_EDGE("_", 3)};

static k_pattern_node core_nodes[] = {
  {KP_CLOSED_UNION, 2, core_edges_0},
  {KP_CLOSED_PRODUCT, 2, core_edges_1},
  {KP_CLOSED_UNION, 5, core_edges_2},
  {KP_CLOSED_PRODUCT, 0, NULL},
  {KP_CLOSED_UNION, 2, core_edges_4},
  {KP_CLOSED_PRODUCT, 2, core_edges_5},
  {KP_CLOSED_PRODUCT, 2, core_edges_6},
  {KP_CLOSED_UNION, 2, core_edges_7},
  {KP_CLOSED_PRODUCT, 2, core_edges_8},
  {KP_CLOSED_UNION, 6, core_edges_9},
  {KP_CLOSED_PRODUCT, 7, core_edges_10},
  {KP_CLOSED_UNION, 2, core_edges_11},
  {KP_CLOSED_PRODUCT, 2, core_edges_12},
  {KP_CLOSED_UNION, 8, core_edges_13},
  {KP_CLOSED_PRODUCT, 3, core_edges_14},
  {KP_CLOSED_PRODUCT, 1, core_edges_15},
  {KP_CLOSED_PRODUCT, 8, core_edges_16},
  {KP_CLOSED_PRODUCT, 2, core_edges_17},
  {KP_CLOSED_UNION, 3, core_edges_18},
  {KP_CLOSED_PRODUCT, 4, core_edges_19},
  {KP_CLOSED_PRODUCT, 11, core_edges_20},
  {KP_CLOSED_PRODUCT, 2, core_edges_21},
  {KP_CLOSED_PRODUCT, 3, core_edges_22},
  {KP_CLOSED_UNION, 4, core_edges_23},
  {KP_CLOSED_PRODUCT, 2, core_edges_24},
  {KP_CLOSED_UNION, 3, core_edges_25}
};

static k_pattern core_pattern = {26, core_nodes};

static int choice_width(size_t cardinality) {
  if (cardinality <= 1) return 0;
  size_t choices = cardinality - 1;
  int width = 0;
  while (choices > 0) {
    width++;
    choices >>= 1;
  }
  return width;
}

static int br_read_bit(bit_reader *reader) {
  if (!reader->ok || reader->byte_offset >= reader->length) {
    reader->ok = 0;
    return 0;
  }
  int bit = (reader->bytes[reader->byte_offset] >> (7 - reader->bit_offset)) & 1;
  reader->bit_offset++;
  if (reader->bit_offset == 8) {
    reader->byte_offset++;
    reader->bit_offset = 0;
  }
  return bit;
}

static unsigned br_read_bits(bit_reader *reader, int width) {
  unsigned value = 0;
  for (int i = 0; i < width; i++) {
    value = (value << 1) | (unsigned)br_read_bit(reader);
  }
  return value;
}

static int br_zero_padding(bit_reader *reader) {
  while (reader->byte_offset < reader->length) {
    if (br_read_bit(reader) != 0) return 0;
  }
  return reader->ok;
}

static void bw_write_bit(bit_writer *writer, int bit) {
  if (!writer->ok) return;
  writer->current = (unsigned char)((writer->current << 1) | (bit ? 1 : 0));
  writer->bit_count++;
  if (writer->bit_count != 8) return;
  if (writer->length == writer->capacity) {
    size_t capacity = writer->capacity == 0 ? 64 : writer->capacity * 2;
    unsigned char *bytes = realloc(writer->bytes, capacity);
    if (bytes == NULL) {
      writer->ok = 0;
      return;
    }
    writer->bytes = bytes;
    writer->capacity = capacity;
  }
  writer->bytes[writer->length++] = writer->current;
  writer->current = 0;
  writer->bit_count = 0;
}

static void bw_write_bits(bit_writer *writer, unsigned value, int width) {
  for (int i = width - 1; i >= 0; i--) {
    bw_write_bit(writer, (value >> i) & 1);
  }
}

static void bw_flush(bit_writer *writer) {
  if (writer->bit_count > 0) {
    while (writer->bit_count != 0) bw_write_bit(writer, 0);
  }
}

static k_value *decode_node(bit_reader *reader, k_pattern *pattern, size_t node_id, k_rt *rt) {
  if (!reader->ok || node_id >= pattern->node_count) {
    reader->ok = 0;
    return NULL;
  }
  k_pattern_node *node = &pattern->nodes[node_id];
  if (node->kind == KP_ANY) {
    reader->ok = 0;
    return NULL;
  }
  if (node->kind == KP_OPEN_PRODUCT || node->kind == KP_CLOSED_PRODUCT) {
    k_value *product = k_product(rt, node->edge_count);
    if (product == NULL) {
      reader->ok = 0;
      return NULL;
    }
    for (size_t i = 0; i < node->edge_count; i++) {
      k_value *child = decode_node(reader, pattern, node->edges[i].target, rt);
      if (!reader->ok) return NULL;
      k_product_set_at(product, i, node->edges[i].label, node->edges[i].label_length, child);
    }
    return product;
  }
  if (node->kind == KP_OPEN_UNION || node->kind == KP_CLOSED_UNION) {
    if (node->edge_count == 0) {
      reader->ok = 0;
      return NULL;
    }
    unsigned ordinal = br_read_bits(reader, choice_width(node->edge_count));
    if (!reader->ok || ordinal >= node->edge_count) {
      reader->ok = 0;
      return NULL;
    }
    k_pattern_edge *edge = &node->edges[ordinal];
    k_value *payload = decode_node(reader, pattern, edge->target, rt);
    if (!reader->ok) return NULL;
    return k_variant_borrowed_n(rt, edge->label, edge->label_length, payload);
  }
  reader->ok = 0;
  return NULL;
}

static int tag_is(k_value *value, const char *tag) {
  const char *actual = k_variant_tag(value);
  return actual != NULL && strcmp(actual, tag) == 0;
}

static unsigned bits_to_integer(k_value *value) {
  unsigned place = 1;
  unsigned result = 0;
  k_value *cursor = value;
  for (;;) {
    const char *tag = k_variant_tag(cursor);
    if (tag == NULL) return 0;
    if (strcmp(tag, "_") == 0) return result;
    if (strcmp(tag, "1") == 0) result += place;
    if (strcmp(tag, "0") != 0 && strcmp(tag, "1") != 0) return 0;
    place <<= 1;
    cursor = k_variant_payload(cursor);
  }
}

static unsigned bits_product_to_integer(k_value *value, int max_bit) {
  unsigned result = 0;
  char label[16];
  for (int i = max_bit; i >= 0; i--) {
    snprintf(label, sizeof(label), "%d", i);
    k_value *bit = k_product_get(value, label);
    result = (result << 1) | (tag_is(bit, "1") ? 1U : 0U);
  }
  return result;
}

static k_value *unit_value(k_rt *rt);

static k_value *bits_product(k_rt *rt, int max_bit, unsigned value) {
  k_value *bits = k_product(rt, (size_t)max_bit + 1);
  char label[16];
  for (int bit = 0; bit <= max_bit; bit++) {
    snprintf(label, sizeof(label), "%d", bit);
    k_product_set(bits, label, k_variant(rt, ((value >> bit) & 1U) ? "1" : "0", unit_value(rt)));
  }
  return bits;
}

static int decode_bmp_common_hi(k_value *value, unsigned *out) {
  const char *tag = k_variant_tag(value);
  if (tag == NULL) return 0;
  if (strcmp(tag, "h08_0F") == 0) {
    *out = 0x08U + bits_product_to_integer(k_variant_payload(value), 2);
    return 1;
  }
  if (strcmp(tag, "h10_7F") == 0) {
    *out = 0x10U + bits_product_to_integer(k_variant_payload(value), 6);
    return 1;
  }
  if (strcmp(tag, "h80_CF") == 0) {
    *out = 0x80U + bits_product_to_integer(k_variant_payload(value), 6);
    return 1;
  }
  if (strcmp(tag, "hD0_D7") == 0) {
    *out = 0xd0U + bits_product_to_integer(k_variant_payload(value), 2);
    return 1;
  }
  if (strcmp(tag, "hF9") == 0) {
    *out = 0xf9U;
    return 1;
  }
  if (strcmp(tag, "hFA_FB") == 0) {
    *out = 0xfaU + bits_product_to_integer(k_variant_payload(value), 0);
    return 1;
  }
  if (strcmp(tag, "hFC_FD") == 0) {
    *out = 0xfcU + bits_product_to_integer(k_variant_payload(value), 0);
    return 1;
  }
  if (strcmp(tag, "hFE_FF") == 0) {
    *out = 0xfeU + bits_product_to_integer(k_variant_payload(value), 0);
    return 1;
  }
  return 0;
}

static int decode_bmp_private_hi(k_value *value, unsigned *out) {
  const char *tag = k_variant_tag(value);
  if (tag == NULL) return 0;
  if (strcmp(tag, "hE0_EF") == 0) {
    *out = 0xe0U + bits_product_to_integer(k_variant_payload(value), 3);
    return 1;
  }
  if (strcmp(tag, "hF0_F7") == 0) {
    *out = 0xf0U + bits_product_to_integer(k_variant_payload(value), 2);
    return 1;
  }
  if (strcmp(tag, "hF8") == 0) {
    *out = 0xf8U;
    return 1;
  }
  return 0;
}

static int decode_plane_2_to_16(k_value *value, unsigned *out) {
  const char *tag = k_variant_tag(value);
  if (tag == NULL) return 0;
  if (strcmp(tag, "p02_03") == 0) {
    *out = 2U + bits_product_to_integer(k_variant_payload(value), 0);
    return 1;
  }
  if (strcmp(tag, "p04_07") == 0) {
    *out = 4U + bits_product_to_integer(k_variant_payload(value), 1);
    return 1;
  }
  if (strcmp(tag, "p08_0F") == 0) {
    *out = 8U + bits_product_to_integer(k_variant_payload(value), 2);
    return 1;
  }
  if (strcmp(tag, "p10") == 0) {
    *out = 16U;
    return 1;
  }
  return 0;
}

static int unicode_value_to_codepoint(k_value *value, unsigned *out) {
  const char *tag = k_variant_tag(value);
  if (tag == NULL) return 0;
  k_value *payload = k_variant_payload(value);
  if (strcmp(tag, "ascii") == 0) {
    *out = bits_product_to_integer(payload, 6);
    return 1;
  }
  if (strcmp(tag, "plane0") == 0) {
    *out = bits_product_to_integer(payload, 10);
    return 1;
  }
  if (strcmp(tag, "bmp_common") == 0) {
    unsigned hi = 0;
    k_value *product = payload;
    if (!decode_bmp_common_hi(k_product_get(product, "hi"), &hi)) return 0;
    *out = (hi << 8) | bits_product_to_integer(k_product_get(product, "lo"), 7);
    return 1;
  }
  if (strcmp(tag, "bmp_private_use") == 0) {
    unsigned hi = 0;
    k_value *product = payload;
    if (!decode_bmp_private_hi(k_product_get(product, "hi"), &hi)) return 0;
    *out = (hi << 8) | bits_product_to_integer(k_product_get(product, "lo"), 7);
    return 1;
  }
  if (strcmp(tag, "supplementary_plane1") == 0) {
    k_value *product = payload;
    *out = 0x10000U |
      (bits_product_to_integer(k_product_get(product, "mid"), 7) << 8) |
      bits_product_to_integer(k_product_get(product, "lo"), 7);
    return 1;
  }
  if (strcmp(tag, "supplementary_planes2_16") == 0) {
    unsigned plane = 0;
    k_value *product = payload;
    if (!decode_plane_2_to_16(k_product_get(product, "plane"), &plane)) return 0;
    *out = (plane << 16) |
      (bits_product_to_integer(k_product_get(product, "mid"), 7) << 8) |
      bits_product_to_integer(k_product_get(product, "lo"), 7);
    return 1;
  }
  return 0;
}

static int utf8_append(char **text, size_t *length, size_t *capacity, unsigned cp) {
  if (cp > 0x10ffffU || (cp >= 0xd800U && cp <= 0xdfffU)) return 0;
  size_t needed = cp <= 0x7fU ? 1 : cp <= 0x7ffU ? 2 : cp <= 0xffffU ? 3 : 4;
  if (*length + needed + 1 > *capacity) {
    while (*length + needed + 1 > *capacity) *capacity *= 2;
    char *grown = realloc(*text, *capacity);
    if (grown == NULL) abort();
    *text = grown;
  }
  unsigned char *out = (unsigned char *)(*text + *length);
  if (cp <= 0x7fU) {
    out[0] = (unsigned char)cp;
  } else if (cp <= 0x7ffU) {
    out[0] = (unsigned char)(0xc0U | (cp >> 6));
    out[1] = (unsigned char)(0x80U | (cp & 0x3fU));
  } else if (cp <= 0xffffU) {
    out[0] = (unsigned char)(0xe0U | (cp >> 12));
    out[1] = (unsigned char)(0x80U | ((cp >> 6) & 0x3fU));
    out[2] = (unsigned char)(0x80U | (cp & 0x3fU));
  } else {
    out[0] = (unsigned char)(0xf0U | (cp >> 18));
    out[1] = (unsigned char)(0x80U | ((cp >> 12) & 0x3fU));
    out[2] = (unsigned char)(0x80U | ((cp >> 6) & 0x3fU));
    out[3] = (unsigned char)(0x80U | (cp & 0x3fU));
  }
  *length += needed;
  (*text)[*length] = 0;
  return 1;
}

static char *string_value_to_utf8(k_value *value, size_t *out_length) {
  size_t capacity = 16;
  size_t length = 0;
  char *text = malloc(capacity);
  if (text == NULL) abort();
  text[0] = 0;
  k_value *cursor = value;
  for (;;) {
    const char *tag = k_variant_tag(cursor);
    if (tag == NULL) {
      free(text);
      return NULL;
    }
    if (strcmp(tag, "nil") == 0) {
      text[length] = 0;
      *out_length = length;
      return text;
    }
    if (strcmp(tag, "cons") != 0) {
      free(text);
      return NULL;
    }
    k_value *pair = k_variant_payload(cursor);
    k_value *car = k_product_get(pair, "car");
    unsigned cp = 0;
    if (!unicode_value_to_codepoint(car, &cp) || !utf8_append(&text, &length, &capacity, cp)) {
      free(text);
      return NULL;
    }
    cursor = k_product_get(pair, "cdr");
  }
}

static k_value *list_tail(k_value *list) {
  k_value *payload = k_variant_payload(list);
  return payload == NULL ? NULL : k_product_get(payload, "cdr");
}

static k_value *list_head(k_value *list) {
  k_value *payload = k_variant_payload(list);
  return payload == NULL ? NULL : k_product_get(payload, "car");
}

static size_t list_length(k_value *list) {
  size_t count = 0;
  k_value *cursor = list;
  while (tag_is(cursor, "cons")) {
    count++;
    cursor = list_tail(cursor);
  }
  return tag_is(cursor, "nil") ? count : 0;
}

static int node_kind_from_tag(const char *tag) {
  if (strcmp(tag, "any") == 0) return KP_ANY;
  if (strcmp(tag, "open-product") == 0) return KP_OPEN_PRODUCT;
  if (strcmp(tag, "open-union") == 0) return KP_OPEN_UNION;
  if (strcmp(tag, "closed-product") == 0) return KP_CLOSED_PRODUCT;
  if (strcmp(tag, "closed-union") == 0) return KP_CLOSED_UNION;
  return -1;
}

static k_pattern *pattern_from_k_value(k_value *value) {
  size_t node_count = list_length(value);
  if (node_count == 0 && !tag_is(value, "nil")) return NULL;
  k_pattern *pattern = calloc(1, sizeof(k_pattern));
  if (pattern == NULL) abort();
  pattern->node_count = node_count;
  pattern->nodes = calloc(node_count, sizeof(k_pattern_node));
  if (node_count > 0 && pattern->nodes == NULL) abort();
  k_value *cursor = value;
  for (size_t node_index = 0; node_index < node_count; node_index++) {
    k_value *node_value = list_head(cursor);
    const char *node_tag = k_variant_tag(node_value);
    int kind = node_tag == NULL ? -1 : node_kind_from_tag(node_tag);
    if (kind < 0) return NULL;
    pattern->nodes[node_index].kind = kind;
    k_value *edges_list = k_variant_payload(node_value);
    if (kind == KP_ANY) {
      pattern->nodes[node_index].edge_count = 0;
      pattern->nodes[node_index].edges = NULL;
    } else {
      size_t edge_count = list_length(edges_list);
      pattern->nodes[node_index].edge_count = edge_count;
      pattern->nodes[node_index].edges = calloc(edge_count, sizeof(k_pattern_edge));
      if (edge_count > 0 && pattern->nodes[node_index].edges == NULL) abort();
      k_value *edge_cursor = edges_list;
      for (size_t edge_index = 0; edge_index < edge_count; edge_index++) {
        k_value *edge = list_head(edge_cursor);
        size_t label_length = 0;
        char *label = string_value_to_utf8(k_product_get(edge, "label"), &label_length);
        if (label == NULL) return NULL;
        pattern->nodes[node_index].edges[edge_index].label = label;
        pattern->nodes[node_index].edges[edge_index].label_length = label_length;
        pattern->nodes[node_index].edges[edge_index].target = bits_to_integer(k_product_get(edge, "target"));
        edge_cursor = list_tail(edge_cursor);
      }
    }
    cursor = list_tail(cursor);
  }
  return pattern;
}

static void free_pattern(k_pattern *pattern) {
  if (pattern == NULL || pattern == &core_pattern) return;
  for (size_t i = 0; i < pattern->node_count; i++) {
    for (size_t j = 0; j < pattern->nodes[i].edge_count; j++) {
      free((void *)pattern->nodes[i].edges[j].label);
    }
    free(pattern->nodes[i].edges);
  }
  free(pattern->nodes);
  free(pattern);
}

static unsigned char *read_all(FILE *in, size_t *out_length) {
  size_t capacity = 4096;
  size_t length = 0;
  unsigned char *bytes = malloc(capacity);
  if (bytes == NULL) abort();
  for (;;) {
    if (length == capacity) {
      capacity *= 2;
      unsigned char *grown = realloc(bytes, capacity);
      if (grown == NULL) abort();
      bytes = grown;
    }
    size_t n = fread(bytes + length, 1, capacity - length, in);
    length += n;
    if (n == 0) break;
  }
  if (ferror(in)) {
    free(bytes);
    return NULL;
  }
  *out_length = length;
  return bytes;
}

k_wire_input k_decode_wire_envelope(const unsigned char *bytes, size_t length, k_rt *rt) {
  k_wire_input result = {NULL, NULL};
  if (bytes == NULL) return result;

  bit_reader reader = {bytes, length, 0, 0, 1};
  k_rt *pattern_rt = k_rt_new();
  k_value *pattern_value = decode_node(&reader, &core_pattern, 0, pattern_rt);
  k_pattern *pattern = reader.ok ? pattern_from_k_value(pattern_value) : NULL;
  k_value *value = pattern == NULL ? NULL : decode_node(&reader, pattern, 0, rt);
  int ok = reader.ok && br_zero_padding(&reader);
  k_rt_free(pattern_rt);
  if (!ok) {
    free_pattern(pattern);
    return result;
  }
  result.value = value;
  result.pattern = pattern;
  return result;
}

k_wire_input k_read_wire_envelope(FILE *in, k_rt *rt) {
  k_wire_input result = {NULL, NULL};
  size_t length = 0;
  unsigned char *bytes = read_all(in, &length);
  if (bytes == NULL) return result;
  result = k_decode_wire_envelope(bytes, length, rt);
  free(bytes);
  return result;
}

void k_wire_input_free(k_wire_input input) {
  free_pattern(input.pattern);
}

k_value *k_read_wire(FILE *in, k_rt *rt) {
  k_wire_input input = k_read_wire_envelope(in, rt);
  k_value *value = input.value;
  k_wire_input_free(input);
  return value;
}

int k_pattern_equal(k_pattern *a, k_pattern *b) {
  if (a == b) return 1;
  if (a == NULL || b == NULL) return 0;
  if (a->node_count != b->node_count) return 0;
  for (size_t i = 0; i < a->node_count; i++) {
    k_pattern_node *left = &a->nodes[i];
    k_pattern_node *right = &b->nodes[i];
    if (left->kind != right->kind || left->edge_count != right->edge_count) return 0;
    for (size_t j = 0; j < left->edge_count; j++) {
      if (left->edges[j].target != right->edges[j].target) return 0;
      if (!bytes_equal(left->edges[j].label, left->edges[j].label_length, right->edges[j].label, right->edges[j].label_length)) return 0;
    }
  }
  return 1;
}

static int wire_prefix_matches(const unsigned char *bytes, size_t length, const k_wire_prefix *prefix) {
  if (bytes == NULL || prefix == NULL || !prefix->ok || length < prefix->length) return 0;
  if (prefix->length > 0 && memcmp(bytes, prefix->bytes, prefix->length) != 0) return 0;
  if (prefix->bit_count == 0) return 1;
  if (length == prefix->length) return 0;
  unsigned char mask = (unsigned char)(0xffU << (8 - prefix->bit_count));
  unsigned char expected = (unsigned char)(prefix->current << (8 - prefix->bit_count));
  return (bytes[prefix->length] & mask) == expected;
}

k_value *k_decode_wire_value_with_prefix(const unsigned char *bytes, size_t length, k_wire_prefix *prefix, k_pattern *pattern, k_rt *rt) {
  if (!wire_prefix_matches(bytes, length, prefix)) return NULL;
  bit_reader reader = {bytes, length, prefix->length, prefix->bit_count, 1};
  k_value *value = decode_node(&reader, pattern, 0, rt);
  if (!reader.ok || !br_zero_padding(&reader)) return NULL;
  return value;
}

static void encode_node(bit_writer *writer, k_pattern *pattern, size_t node_id, k_value *value) {
  if (!writer->ok || node_id >= pattern->node_count) {
    writer->ok = 0;
    return;
  }
  k_pattern_node *node = &pattern->nodes[node_id];
  if (node->kind == KP_ANY) {
    writer->ok = 0;
    return;
  }
  if (node->kind == KP_OPEN_PRODUCT || node->kind == KP_CLOSED_PRODUCT) {
    if (value == NULL || value->kind != K_VALUE_PRODUCT) {
      writer->ok = 0;
      return;
    }
    for (size_t i = 0; i < node->edge_count; i++) {
      k_value *child = NULL;
      if (i < value->as.product.count &&
          bytes_equal(value->as.product.fields[i].label, value->as.product.fields[i].label_length, node->edges[i].label, node->edges[i].label_length)) {
        child = value->as.product.fields[i].value;
      } else {
        child = k_product_get_n(value, node->edges[i].label, node->edges[i].label_length);
      }
      encode_node(writer, pattern, node->edges[i].target, child);
    }
    return;
  }
  if (node->kind == KP_OPEN_UNION || node->kind == KP_CLOSED_UNION) {
    const char *tag = k_variant_tag(value);
    size_t tag_length = k_variant_tag_length(value);
    if (tag == NULL) {
      writer->ok = 0;
      return;
    }
    size_t ordinal = node->edge_count;
    for (size_t i = 0; i < node->edge_count; i++) {
      if (bytes_equal(node->edges[i].label, node->edges[i].label_length, tag, tag_length)) {
        ordinal = i;
        break;
      }
    }
    if (ordinal == node->edge_count) {
      writer->ok = 0;
      return;
    }
    bw_write_bits(writer, (unsigned)ordinal, choice_width(node->edge_count));
    encode_node(writer, pattern, node->edges[ordinal].target, k_variant_payload(value));
  }
}

static int compare_fields(const void *a, const void *b) {
  const k_field *fa = (const k_field *)a;
  const k_field *fb = (const k_field *)b;
  size_t min_length = fa->label_length < fb->label_length ? fa->label_length : fb->label_length;
  int cmp = min_length == 0 ? 0 : memcmp(fa->label, fb->label, min_length);
  if (cmp != 0) return cmp;
  if (fa->label_length < fb->label_length) return -1;
  if (fa->label_length > fb->label_length) return 1;
  return 0;
}

static size_t derive_pattern_node(k_pattern *pattern, k_value *value) {
  size_t node_id = pattern->node_count++;
  pattern->nodes = realloc(pattern->nodes, pattern->node_count * sizeof(k_pattern_node));
  if (pattern->nodes == NULL) abort();
  pattern->nodes[node_id].edge_count = 0;
  pattern->nodes[node_id].edges = NULL;
  if (value->kind == K_VALUE_PRODUCT || value->kind == K_VALUE_UNIT) {
    pattern->nodes[node_id].kind = KP_CLOSED_PRODUCT;
    if (value->kind == K_VALUE_UNIT) return node_id;
    size_t count = value->as.product.count;
    k_field *fields = malloc(count * sizeof(k_field));
    if (count > 0 && fields == NULL) abort();
    memcpy(fields, value->as.product.fields, count * sizeof(k_field));
    qsort(fields, count, sizeof(k_field), compare_fields);
    pattern->nodes[node_id].edge_count = count;
    pattern->nodes[node_id].edges = calloc(count, sizeof(k_pattern_edge));
    if (count > 0 && pattern->nodes[node_id].edges == NULL) abort();
    for (size_t i = 0; i < count; i++) {
      pattern->nodes[node_id].edges[i].label = heap_memdup_text(fields[i].label, fields[i].label_length);
      pattern->nodes[node_id].edges[i].label_length = fields[i].label_length;
      pattern->nodes[node_id].edges[i].target = derive_pattern_node(pattern, fields[i].value);
    }
    free(fields);
    return node_id;
  }
  pattern->nodes[node_id].kind = KP_OPEN_UNION;
  pattern->nodes[node_id].edge_count = 1;
  pattern->nodes[node_id].edges = calloc(1, sizeof(k_pattern_edge));
  if (pattern->nodes[node_id].edges == NULL) abort();
  pattern->nodes[node_id].edges[0].label = heap_memdup_text(value->as.variant.tag, value->as.variant.tag_length);
  pattern->nodes[node_id].edges[0].label_length = value->as.variant.tag_length;
  pattern->nodes[node_id].edges[0].target = derive_pattern_node(pattern, value->as.variant.payload);
  return node_id;
}

static k_pattern *derive_pattern(k_value *value) {
  k_pattern *pattern = calloc(1, sizeof(k_pattern));
  if (pattern == NULL) abort();
  derive_pattern_node(pattern, value);
  return pattern;
}

static k_value *unit_value(k_rt *rt) {
  return k_product(rt, 0);
}

static k_value *integer_to_bits(k_rt *rt, unsigned value) {
  k_value *result = k_variant(rt, "_", unit_value(rt));
  if (value == 0) return result;

  unsigned bits[sizeof(unsigned) * 8];
  size_t count = 0;
  while (value > 0) {
    bits[count++] = value & 1U;
    value >>= 1;
  }
  while (count > 0) {
    unsigned bit = bits[--count];
    result = k_variant(rt, bit ? "1" : "0", result);
  }
  return result;
}

static k_value *encode_bmp_common_hi(k_rt *rt, unsigned hi) {
  if (hi >= 0x08U && hi <= 0x0fU) return k_variant(rt, "h08_0F", bits_product(rt, 2, hi - 0x08U));
  if (hi >= 0x10U && hi <= 0x7fU) return k_variant(rt, "h10_7F", bits_product(rt, 6, hi - 0x10U));
  if (hi >= 0x80U && hi <= 0xcfU) return k_variant(rt, "h80_CF", bits_product(rt, 6, hi - 0x80U));
  if (hi >= 0xd0U && hi <= 0xd7U) return k_variant(rt, "hD0_D7", bits_product(rt, 2, hi - 0xd0U));
  if (hi == 0xf9U) return k_variant(rt, "hF9", unit_value(rt));
  if (hi >= 0xfaU && hi <= 0xfbU) return k_variant(rt, "hFA_FB", bits_product(rt, 0, hi - 0xfaU));
  if (hi >= 0xfcU && hi <= 0xfdU) return k_variant(rt, "hFC_FD", bits_product(rt, 0, hi - 0xfcU));
  if (hi >= 0xfeU && hi <= 0xffU) return k_variant(rt, "hFE_FF", bits_product(rt, 0, hi - 0xfeU));
  return NULL;
}

static k_value *encode_bmp_private_hi(k_rt *rt, unsigned hi) {
  if (hi >= 0xe0U && hi <= 0xefU) return k_variant(rt, "hE0_EF", bits_product(rt, 3, hi - 0xe0U));
  if (hi >= 0xf0U && hi <= 0xf7U) return k_variant(rt, "hF0_F7", bits_product(rt, 2, hi - 0xf0U));
  if (hi == 0xf8U) return k_variant(rt, "hF8", unit_value(rt));
  return NULL;
}

static k_value *encode_plane_2_to_16(k_rt *rt, unsigned plane) {
  if (plane >= 2U && plane <= 3U) return k_variant(rt, "p02_03", bits_product(rt, 0, plane - 2U));
  if (plane >= 4U && plane <= 7U) return k_variant(rt, "p04_07", bits_product(rt, 1, plane - 4U));
  if (plane >= 8U && plane <= 15U) return k_variant(rt, "p08_0F", bits_product(rt, 2, plane - 8U));
  if (plane == 16U) return k_variant(rt, "p10", unit_value(rt));
  return NULL;
}

static k_value *codepoint_to_unicode_value(k_rt *rt, unsigned cp) {
  if (cp > 0x10ffffU || (cp >= 0xd800U && cp <= 0xdfffU)) return NULL;
  if (cp <= 0x7fU) return k_variant(rt, "ascii", bits_product(rt, 6, cp));
  if (cp <= 0x7ffU) return k_variant(rt, "plane0", bits_product(rt, 10, cp));
  if (cp <= 0xffffU) {
    unsigned hi = (cp >> 8) & 0xffU;
    unsigned lo = cp & 0xffU;
    k_value *product = k_product(rt, 2);
    if (hi >= 0xe0U && hi <= 0xf8U) {
      k_product_set(product, "hi", encode_bmp_private_hi(rt, hi));
      k_product_set(product, "lo", bits_product(rt, 7, lo));
      return k_variant(rt, "bmp_private_use", product);
    }
    k_product_set(product, "hi", encode_bmp_common_hi(rt, hi));
    k_product_set(product, "lo", bits_product(rt, 7, lo));
    return k_variant(rt, "bmp_common", product);
  }

  unsigned mid = (cp >> 8) & 0xffU;
  unsigned lo = cp & 0xffU;
  k_value *product = k_product(rt, cp <= 0x1ffffU ? 2 : 3);
  if (cp <= 0x1ffffU) {
    k_product_set(product, "mid", bits_product(rt, 7, mid));
    k_product_set(product, "lo", bits_product(rt, 7, lo));
    return k_variant(rt, "supplementary_plane1", product);
  }
  k_product_set(product, "plane", encode_plane_2_to_16(rt, cp >> 16));
  k_product_set(product, "mid", bits_product(rt, 7, mid));
  k_product_set(product, "lo", bits_product(rt, 7, lo));
  return k_variant(rt, "supplementary_planes2_16", product);
}

static int utf8_next_codepoint(const unsigned char **cursor, const unsigned char *end, unsigned *out) {
  const unsigned char *p = *cursor;
  if (p >= end) return 0;
  if (*p <= 0x7fU) {
    *out = *p;
    *cursor = p + 1;
    return 1;
  }
  if ((*p & 0xe0U) == 0xc0U) {
    if (p + 2 > end) return 0;
    if ((p[1] & 0xc0U) != 0x80U) return 0;
    unsigned cp = ((unsigned)(p[0] & 0x1fU) << 6) | (unsigned)(p[1] & 0x3fU);
    if (cp < 0x80U) return 0;
    *out = cp;
    *cursor = p + 2;
    return 1;
  }
  if ((*p & 0xf0U) == 0xe0U) {
    if (p + 3 > end) return 0;
    if ((p[1] & 0xc0U) != 0x80U || (p[2] & 0xc0U) != 0x80U) return 0;
    unsigned cp = ((unsigned)(p[0] & 0x0fU) << 12) |
      ((unsigned)(p[1] & 0x3fU) << 6) |
      (unsigned)(p[2] & 0x3fU);
    if (cp < 0x800U || (cp >= 0xd800U && cp <= 0xdfffU)) return 0;
    *out = cp;
    *cursor = p + 3;
    return 1;
  }
  if ((*p & 0xf8U) == 0xf0U) {
    if (p + 4 > end) return 0;
    if ((p[1] & 0xc0U) != 0x80U || (p[2] & 0xc0U) != 0x80U || (p[3] & 0xc0U) != 0x80U) return 0;
    unsigned cp = ((unsigned)(p[0] & 0x07U) << 18) |
      ((unsigned)(p[1] & 0x3fU) << 12) |
      ((unsigned)(p[2] & 0x3fU) << 6) |
      (unsigned)(p[3] & 0x3fU);
    if (cp < 0x10000U || cp > 0x10ffffU) return 0;
    *out = cp;
    *cursor = p + 4;
    return 1;
  }
  return 0;
}

static k_value *utf8_string_value_n(k_rt *rt, const char *text, size_t text_length) {
  k_value *result = k_variant(rt, "nil", unit_value(rt));
  const unsigned char *cursor = (const unsigned char *)text;
  const unsigned char *end = cursor + text_length;
  unsigned *codepoints = NULL;
  size_t count = 0;
  while (cursor < end) {
    unsigned cp = 0;
    if (!utf8_next_codepoint(&cursor, end, &cp)) {
      free(codepoints);
      return NULL;
    }
    unsigned *grown = realloc(codepoints, (count + 1) * sizeof(unsigned));
    if (grown == NULL) abort();
    codepoints = grown;
    codepoints[count++] = cp;
  }
  for (size_t i = count; i > 0; i--) {
    k_value *unicode = codepoint_to_unicode_value(rt, codepoints[i - 1]);
    if (unicode == NULL) {
      free(codepoints);
      return NULL;
    }
    k_value *pair = k_product(rt, 2);
    k_product_set(pair, "car", unicode);
    k_product_set(pair, "cdr", result);
    result = k_variant(rt, "cons", pair);
  }
  free(codepoints);
  return result;
}

static k_value *utf8_string_value(k_rt *rt, const char *text) {
  return utf8_string_value_n(rt, text, strlen(text));
}

static k_value *edge_to_k(k_rt *rt, k_pattern_edge *edge) {
  k_value *product = k_product(rt, 2);
  k_product_set(product, "label", utf8_string_value_n(rt, edge->label, edge->label_length));
  k_product_set(product, "target", integer_to_bits(rt, (unsigned)edge->target));
  return product;
}

static k_value *list_to_k(k_rt *rt, k_value **items, size_t count) {
  k_value *result = k_variant(rt, "nil", unit_value(rt));
  for (size_t i = count; i > 0; i--) {
    k_value *pair = k_product(rt, 2);
    k_product_set(pair, "car", items[i - 1]);
    k_product_set(pair, "cdr", result);
    result = k_variant(rt, "cons", pair);
  }
  return result;
}

static const char *pattern_kind_tag(int kind) {
  switch (kind) {
    case KP_ANY: return "any";
    case KP_OPEN_PRODUCT: return "open-product";
    case KP_OPEN_UNION: return "open-union";
    case KP_CLOSED_PRODUCT: return "closed-product";
    case KP_CLOSED_UNION: return "closed-union";
    default: return NULL;
  }
}

static k_value *pattern_to_k_value(k_rt *rt, k_pattern *pattern) {
  k_value **nodes = calloc(pattern->node_count, sizeof(k_value *));
  if (pattern->node_count > 0 && nodes == NULL) abort();
  for (size_t i = 0; i < pattern->node_count; i++) {
    k_pattern_node *node = &pattern->nodes[i];
    k_value **edges = calloc(node->edge_count, sizeof(k_value *));
    if (node->edge_count > 0 && edges == NULL) abort();
    for (size_t j = 0; j < node->edge_count; j++) edges[j] = edge_to_k(rt, &node->edges[j]);
    k_value *edge_list = list_to_k(rt, edges, node->edge_count);
    free(edges);
    const char *tag = pattern_kind_tag(node->kind);
    nodes[i] = k_variant(rt, tag, node->kind == KP_ANY ? unit_value(rt) : edge_list);
  }
  k_value *result = list_to_k(rt, nodes, pattern->node_count);
  free(nodes);
  return result;
}

k_wire_prefix k_wire_prefix_for_pattern(k_pattern *pattern) {
  k_wire_prefix prefix = {NULL, 0, 0, 0, 0};
  k_rt *pattern_rt = k_rt_new();
  k_value *pattern_value = pattern_to_k_value(pattern_rt, pattern);
  bit_writer writer = {NULL, 0, 0, 0, 0, 1};
  encode_node(&writer, &core_pattern, 0, pattern_value);
  k_rt_free(pattern_rt);
  if (!writer.ok) {
    free(writer.bytes);
    return prefix;
  }
  prefix.bytes = writer.bytes;
  prefix.length = writer.length;
  prefix.current = writer.current;
  prefix.bit_count = writer.bit_count;
  prefix.ok = 1;
  return prefix;
}

void k_wire_prefix_free(k_wire_prefix prefix) {
  free(prefix.bytes);
}

unsigned char *k_encode_wire_as_with_prefix(k_wire_prefix *prefix, k_pattern *pattern, k_value *value, size_t *out_length) {
  if (out_length != NULL) *out_length = 0;
  if (prefix == NULL || !prefix->ok) return NULL;
  size_t capacity = prefix->length + 64;
  if (capacity < prefix->length) return NULL;
  unsigned char *bytes = malloc(capacity == 0 ? 1 : capacity);
  if (bytes == NULL) abort();
  if (prefix->length > 0) memcpy(bytes, prefix->bytes, prefix->length);
  bit_writer writer = {bytes, prefix->length, capacity, prefix->current, prefix->bit_count, 1};
  encode_node(&writer, pattern, 0, value);
  bw_flush(&writer);
  if (!writer.ok) {
    free(writer.bytes);
    return NULL;
  }
  if (out_length != NULL) *out_length = writer.length;
  return writer.bytes;
}

unsigned char *k_encode_wire_as(k_pattern *pattern, k_value *value, size_t *out_length) {
  k_wire_prefix prefix = k_wire_prefix_for_pattern(pattern);
  unsigned char *bytes = k_encode_wire_as_with_prefix(&prefix, pattern, value, out_length);
  k_wire_prefix_free(prefix);
  return bytes;
}

int k_write_wire_as(FILE *out, k_pattern *pattern, k_value *value) {
  size_t length = 0;
  unsigned char *bytes = k_encode_wire_as(pattern, value, &length);
  int ok = bytes != NULL && fwrite(bytes, 1, length, out) == length;
  free(bytes);
  return ok;
}

int k_write_wire(FILE *out, k_value *value) {
  k_pattern *pattern = derive_pattern(value);
  int ok = k_write_wire_as(out, pattern, value);
  free_pattern(pattern);
  return ok;
}
