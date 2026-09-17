#include "krt.h"
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

#define ARENA_CAPACITY (64 * 1024 * 1024)

typedef enum {
  K_VALUE_UNIT,
  K_VALUE_PRODUCT,
  K_VALUE_VARIANT
} k_val_kind_t;

typedef struct {
  char *label;
  size_t label_length;
  k_value *value;
} k_val_field_t;

struct k_value {
  k_val_kind_t kind;
  k_rt *rt;
  union {
    struct {
      size_t count;
      size_t capacity;
      k_val_field_t *fields;
    } product;
    struct {
      char *tag;
      size_t tag_length;
      k_value *payload;
    } variant;
  } as;
};

typedef struct {
  const char *name;
  size_t length;
  uint32_t id;
} k_arm64_tag_t;

typedef struct {
  int32_t status;
  void *val;
} k_arm64_res_t;

// Defined in generated metadata:
extern const k_arm64_tag_t k_arm64_tags[];
extern const size_t k_arm64_tag_count;
extern k_pattern compiled_input_pattern;
extern k_pattern compiled_output_pattern;

typedef struct {
  const char *name;
  uint64_t *counter;
} k_profile_entry_t;

extern const k_profile_entry_t k_profile_entries[];
extern const size_t k_profile_entry_count;

static void dump_profile_counts(void) {
  if (k_profile_entry_count == 0) return;
  fprintf(stderr, "K_PROFILE_BEGIN\n");
  for (size_t i = 0; i < k_profile_entry_count; i++) {
    if (k_profile_entries[i].counter && *k_profile_entries[i].counter > 0) {
      fprintf(stderr, "K_FUNC_CALL name=%s count=%llu\n",
        k_profile_entries[i].name,
        (unsigned long long)(*k_profile_entries[i].counter));
      *k_profile_entries[i].counter = 0;
    }
  }
  fprintf(stderr, "K_PROFILE_END\n");
  fflush(stderr);
}

#ifndef ENTRY_NAME
#define ENTRY_NAME rel___main__
#endif

extern k_arm64_res_t ENTRY_NAME(void *input);

#define MAX_DYNAMIC_TAGS 4096
static k_arm64_tag_t dynamic_tags[MAX_DYNAMIC_TAGS];
static size_t dynamic_tag_count = 0;
static uint32_t next_dynamic_id = 0;

static void init_tag_registry(void) {
  uint32_t max_id = 0;
  for (size_t i = 0; i < k_arm64_tag_count; i++) {
    if (k_arm64_tags[i].id > max_id) max_id = k_arm64_tags[i].id;
  }
  next_dynamic_id = max_id + 1;
}

static uint32_t lookup_tag_id(const char *name, size_t len) {
  for (size_t i = 0; i < k_arm64_tag_count; i++) {
    if (k_arm64_tags[i].length == len && memcmp(k_arm64_tags[i].name, name, len) == 0) {
      return k_arm64_tags[i].id;
    }
  }
  for (size_t i = 0; i < dynamic_tag_count; i++) {
    if (dynamic_tags[i].length == len && memcmp(dynamic_tags[i].name, name, len) == 0) {
      return dynamic_tags[i].id;
    }
  }
  if (dynamic_tag_count < MAX_DYNAMIC_TAGS) {
    char *copy = malloc(len + 1);
    if (!copy) return 0;
    memcpy(copy, name, len);
    copy[len] = '\0';
    uint32_t id = next_dynamic_id++;
    dynamic_tags[dynamic_tag_count].name = copy;
    dynamic_tags[dynamic_tag_count].length = len;
    dynamic_tags[dynamic_tag_count].id = id;
    dynamic_tag_count++;
    return id;
  }
  return 0;
}

static const char *lookup_tag_name(uint32_t id, size_t *out_len) {
  for (size_t i = 0; i < k_arm64_tag_count; i++) {
    if (k_arm64_tags[i].id == id) {
      if (out_len) *out_len = k_arm64_tags[i].length;
      return k_arm64_tags[i].name;
    }
  }
  for (size_t i = 0; i < dynamic_tag_count; i++) {
    if (dynamic_tags[i].id == id) {
      if (out_len) *out_len = dynamic_tags[i].length;
      return dynamic_tags[i].name;
    }
  }
  if (out_len) *out_len = 0;
  return "";
}

typedef struct {
  void *flat_ptr;
  k_value *val;
} k_flat_map_entry;

#define MAX_FLAT_MAP 65536
#define FLAT_MAP_MASK (MAX_FLAT_MAP - 1)
static k_flat_map_entry flat_map[MAX_FLAT_MAP];

static void flat_map_reset(void) {
  memset(flat_map, 0, sizeof(flat_map));
}

static void flat_map_put(void *flat_ptr, k_value *val) {
  if (flat_ptr == NULL) return;
  size_t idx = (((uintptr_t)flat_ptr) >> 4) & FLAT_MAP_MASK;
  for (size_t probe = 0; probe < MAX_FLAT_MAP; probe++) {
    if (flat_map[idx].flat_ptr == NULL || flat_map[idx].flat_ptr == flat_ptr) {
      flat_map[idx].flat_ptr = flat_ptr;
      flat_map[idx].val = val;
      return;
    }
    idx = (idx + 1) & FLAT_MAP_MASK;
  }
}

static k_value *flat_map_get(void *flat_ptr) {
  if (flat_ptr == NULL) return NULL;
  size_t idx = (((uintptr_t)flat_ptr) >> 4) & FLAT_MAP_MASK;
  for (size_t probe = 0; probe < MAX_FLAT_MAP; probe++) {
    if (flat_map[idx].flat_ptr == NULL) {
      return NULL;
    }
    if (flat_map[idx].flat_ptr == flat_ptr) {
      return flat_map[idx].val;
    }
    idx = (idx + 1) & FLAT_MAP_MASK;
  }
  return NULL;
}

static void *alloc_arena(void **bump, size_t size) {
  size_t aligned = (size + 15) & ~15;
  void *ptr = *bump;
  *bump = (char *)*bump + aligned;
  return ptr;
}

static void *k_value_to_flat(k_value *val, void **arena_bump, size_t pattern_node_id, const k_pattern *in_pattern) {
  if (val == NULL) return NULL;

  if (val->kind == K_VALUE_UNIT) {
    void *flat_prod = alloc_arena(arena_bump, 16);
    *(uint16_t *)((char *)flat_prod + 0) = 16;
    *(uint16_t *)((char *)flat_prod + 2) = 1; // Kind = 1 (Product)
    *(uint32_t *)((char *)flat_prod + 4) = 0; // Count = 0
    *(uint64_t *)((char *)flat_prod + 8) = 0;
    flat_map_put(flat_prod, val);
    return flat_prod;
  }

  if (val->kind == K_VALUE_PRODUCT) {
    const k_pattern_node *pnode = (in_pattern && pattern_node_id < in_pattern->node_count)
      ? &in_pattern->nodes[pattern_node_id]
      : NULL;

    if (pnode && (pnode->kind == KP_OPEN_PRODUCT || pnode->kind == KP_CLOSED_PRODUCT) && pnode->edge_count > 0) {
      size_t count = pnode->edge_count;
      size_t total_size = (8 + 8 * count + 15) & ~15;
      void *flat_prod = alloc_arena(arena_bump, total_size);
      *(uint16_t *)((char *)flat_prod + 0) = (uint16_t)total_size;
      *(uint16_t *)((char *)flat_prod + 2) = 1; // Kind = 1 (Product)
      *(uint32_t *)((char *)flat_prod + 4) = (uint32_t)count;

      for (size_t i = 0; i < count; i++) {
        k_value *child_val = k_product_get_n(val, pnode->edges[i].label, pnode->edges[i].label_length);
        void *child = k_value_to_flat(child_val, arena_bump, pnode->edges[i].target, in_pattern);
        *(uint64_t *)((char *)flat_prod + 8 + 8 * i) = (uint64_t)child;
      }
      flat_map_put(flat_prod, val);
      return flat_prod;
    }

    size_t count = val->as.product.count;
    size_t total_size = (8 + 8 * count + 15) & ~15;
    void *flat_prod = alloc_arena(arena_bump, total_size);
    *(uint16_t *)((char *)flat_prod + 0) = (uint16_t)total_size;
    *(uint16_t *)((char *)flat_prod + 2) = 1; // Kind = 1 (Product)
    *(uint32_t *)((char *)flat_prod + 4) = (uint32_t)count;

    for (size_t i = 0; i < count; i++) {
      void *child = k_value_to_flat(val->as.product.fields[i].value, arena_bump, 0, NULL);
      *(uint64_t *)((char *)flat_prod + 8 + 8 * i) = (uint64_t)child;
    }
    flat_map_put(flat_prod, val);
    return flat_prod;
  }

  if (val->kind == K_VALUE_VARIANT) {
    uint32_t tag_id = lookup_tag_id(val->as.variant.tag, val->as.variant.tag_length);

    const k_pattern_node *pnode = (in_pattern && pattern_node_id < in_pattern->node_count)
      ? &in_pattern->nodes[pattern_node_id]
      : NULL;

    size_t target_node = 0;
    const k_pattern *next_pat = NULL;
    if (pnode && (pnode->kind == KP_OPEN_UNION || pnode->kind == KP_CLOSED_UNION)) {
      for (size_t j = 0; j < pnode->edge_count; j++) {
        if (pnode->edges[j].label_length == val->as.variant.tag_length &&
            memcmp(pnode->edges[j].label, val->as.variant.tag, val->as.variant.tag_length) == 0) {
          target_node = pnode->edges[j].target;
          next_pat = in_pattern;
          break;
        }
      }
    }

    void *payload = k_value_to_flat(val->as.variant.payload, arena_bump, target_node, next_pat);

    void *flat_var = alloc_arena(arena_bump, 16);
    *(uint16_t *)((char *)flat_var + 0) = 16;
    *(uint16_t *)((char *)flat_var + 2) = 2; // Kind = 2 (Variant)
    *(uint32_t *)((char *)flat_var + 4) = tag_id;
    *(uint64_t *)((char *)flat_var + 8) = (uint64_t)payload;
    flat_map_put(flat_var, val);
    return flat_var;
  }

  return NULL;
}

static k_value *flat_to_k_value(k_rt *rt, void *flat_ptr, size_t pattern_node_id, const k_pattern *out_pattern) {
  if (flat_ptr == NULL) return NULL;

  k_value *mapped = flat_map_get(flat_ptr);
  if (mapped != NULL) return mapped;

  uint16_t kind = *(uint16_t *)((char *)flat_ptr + 2);

  if (kind == 1) {
    // Product
    uint32_t count = *(uint32_t *)((char *)flat_ptr + 4);
    k_value *prod = k_product(rt, count);

    const k_pattern_node *pnode = (out_pattern && pattern_node_id < out_pattern->node_count)
      ? &out_pattern->nodes[pattern_node_id]
      : NULL;

    for (size_t i = 0; i < count; i++) {
      const char *label = "";
      size_t label_len = 0;
      size_t target_node = 0;

      if (pnode && i < pnode->edge_count) {
        label = pnode->edges[i].label;
        label_len = pnode->edges[i].label_length;
        target_node = pnode->edges[i].target;
      } else {
        char buf[32];
        snprintf(buf, sizeof(buf), "%zu", i);
        label = buf;
        label_len = strlen(buf);
      }

      void *child_flat = (void *)(*(uint64_t *)((char *)flat_ptr + 8 + 8 * i));
      k_value *child_val = flat_to_k_value(rt, child_flat, target_node, out_pattern);
      k_product_set_n(prod, label, label_len, child_val);
    }
    return prod;
  }

  if (kind == 2) {
    // Variant
    uint32_t tag_id = *(uint32_t *)((char *)flat_ptr + 4);
    size_t tag_len = 0;
    const char *tag_name = lookup_tag_name(tag_id, &tag_len);

    const k_pattern_node *pnode = (out_pattern && pattern_node_id < out_pattern->node_count)
      ? &out_pattern->nodes[pattern_node_id]
      : NULL;

    size_t target_node = 0;
    if (pnode) {
      for (size_t j = 0; j < pnode->edge_count; j++) {
        if (pnode->edges[j].label_length == tag_len &&
            memcmp(pnode->edges[j].label, tag_name, tag_len) == 0) {
          target_node = pnode->edges[j].target;
          break;
        }
      }
    }

    void *payload_flat = (void *)(*(uint64_t *)((char *)flat_ptr + 8));
    k_value *payload_val = flat_to_k_value(rt, payload_flat, target_node, out_pattern);
    return k_variant_n(rt, tag_name, tag_len, payload_val);
  }

  return NULL;
}

#define STR(s) #s
#define XSTR(s) STR(s)

static inline k_arm64_res_t invoke_entry(void *flat_in, void **arena_ptr) {
  register void *arg0 __asm__("x0") = flat_in;
  register void *r_arena __asm__("x19") = *arena_ptr;
  register uint64_t ret_status __asm__("x0");
  register void *ret_val __asm__("x1");

  __asm__ __volatile__(
    "bl " XSTR(ENTRY_NAME) "\n\t"
    : "=r"(ret_status), "=r"(ret_val), "+r"(r_arena)
    : "r"(arg0)
    : "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "x10", "x11", "x12",
      "x13", "x14", "x15", "x16", "x17", "x20", "x21", "x22", "x23", "x24",
      "x25", "x26", "x27", "x28", "x30", "memory"
  );

  *arena_ptr = r_arena;
  k_arm64_res_t res;
  res.status = (int32_t)ret_status;
  res.val = ret_val;
  return res;
}

static int pattern_has_any(const k_pattern *pattern) {
  if (!pattern || pattern->node_count == 0) return 1;
  for (size_t i = 0; i < pattern->node_count; i++) {
    if (pattern->nodes[i].kind == KP_ANY) return 1;
  }
  return 0;
}

static int read_exact(FILE *fp, unsigned char *buf, size_t count) {
  size_t offset = 0;
  while (offset < count) {
    size_t n = fread(buf + offset, 1, count - offset, fp);
    if (n == 0) {
      if (feof(fp) && offset == 0) return 0;
      return -1;
    }
    offset += n;
  }
  return 1;
}

static uint64_t monotonic_ns(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
  return ((uint64_t)ts.tv_sec * 1000000000ull) + (uint64_t)ts.tv_nsec;
}

static int is_trace_enabled(void) {
  static int cached = -1;
  if (cached < 0) {
    const char *e1 = getenv("K_TRACE");
    const char *e2 = getenv("TRACE");
    cached = ((e1 && *e1 && strcmp(e1, "0") != 0) || (e2 && *e2 && strcmp(e2, "0") != 0)) ? 1 : 0;
  }
  return cached;
}

static int write_frame(k_wire_prefix *prefix, const k_pattern *pattern, k_value *value) {
  if (!value) return 0;
  size_t length = 0;
  unsigned char *payload = k_encode_wire_as_with_prefix(prefix, (k_pattern *)pattern, value, &length);
  if (!payload || length > UINT32_MAX) {
    free(payload);
    return 0;
  }
  unsigned char header[4] = {
    (unsigned char)((length >> 24) & 0xff),
    (unsigned char)((length >> 16) & 0xff),
    (unsigned char)((length >> 8) & 0xff),
    (unsigned char)(length & 0xff)
  };
  int ok = (fwrite(header, 1, 4, stdout) == 4 && fwrite(payload, 1, length, stdout) == length && fflush(stdout) == 0);
  free(payload);
  return ok;
}

static int run_server(void *arena_mem) {
  k_rt *rt = k_rt_new();
  if (!rt) return 1;
  k_wire_prefix input_prefix = k_wire_prefix_for_pattern(&compiled_input_pattern);
  k_wire_prefix output_prefix = k_wire_prefix_for_pattern(&compiled_output_pattern);
  if (!input_prefix.ok || !output_prefix.ok) {
    k_wire_prefix_free(input_prefix);
    k_wire_prefix_free(output_prefix);
    k_rt_free(rt);
    return 8;
  }
  for (;;) {
    uint64_t t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0, t6 = 0, t7 = 0;
    int tracing = is_trace_enabled();
    if (tracing) t0 = monotonic_ns();

    unsigned char header[4];
    int header_status = read_exact(stdin, header, 4);
    if (header_status == 0) {
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 0;
    }
    if (header_status < 0) {
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 6;
    }
    uint32_t length = ((uint32_t)header[0] << 24) | ((uint32_t)header[1] << 16) | ((uint32_t)header[2] << 8) | (uint32_t)header[3];
    unsigned char *payload = malloc(length == 0 ? 1 : length);
    if (!payload) {
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 7;
    }
    int payload_status = read_exact(stdin, payload, length);
    if (payload_status != 1) {
      free(payload);
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 6;
    }
    if (tracing) t1 = monotonic_ns();

    flat_map_reset();
    void *arena_bump = arena_mem;
    k_value *in_val = k_decode_wire_value_with_prefix(payload, length, &input_prefix, &compiled_input_pattern, rt);
    if (!in_val) {
      k_wire_input envelope = k_decode_wire_envelope(payload, length, rt);
      if (envelope.value) {
        in_val = envelope.value;
      }
    }
    free(payload);
    if (!in_val) {
      k_rt_reset(rt);
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 2;
    }
    if (tracing) t2 = monotonic_ns();

    void *flat_in = k_value_to_flat(in_val, &arena_bump, 0, &compiled_input_pattern);
    if (tracing) t3 = monotonic_ns();

    k_arm64_res_t res = invoke_entry(flat_in, &arena_bump);
    if (tracing) t4 = monotonic_ns();
    if (res.status != 0) {
      k_rt_reset(rt);
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 3;
    }

    k_value *out_val = flat_to_k_value(rt, res.val, 0, &compiled_output_pattern);
    if (tracing) t5 = monotonic_ns();

    size_t out_len = 0;
    unsigned char *out_payload = k_encode_wire_as_with_prefix(&output_prefix, (k_pattern *)&compiled_output_pattern, out_val, &out_len);
    if (tracing) t6 = monotonic_ns();

    int ok = 0;
    uint64_t write_start = t6;
    if (out_payload && out_len <= UINT32_MAX) {
      unsigned char out_header[4] = {
        (unsigned char)((out_len >> 24) & 0xff),
        (unsigned char)((out_len >> 16) & 0xff),
        (unsigned char)((out_len >> 8) & 0xff),
        (unsigned char)(out_len & 0xff)
      };
      ok = (fwrite(out_header, 1, 4, stdout) == 4 && fwrite(out_payload, 1, out_len, stdout) == out_len && fflush(stdout) == 0);
    }
    free(out_payload);
    if (tracing) {
      t7 = monotonic_ns();
      dump_profile_counts();
      fprintf(stderr, "K_TRACE_PHASES backend=arm64 ipc_read_ns=%llu decode_ns=%llu flat_in_ns=%llu eval_ns=%llu flat_out_ns=%llu encode_ns=%llu ipc_write_ns=%llu total_ns=%llu\n",
        (unsigned long long)(t1 >= t0 ? t1 - t0 : 0),
        (unsigned long long)(t2 >= t1 ? t2 - t1 : 0),
        (unsigned long long)(t3 >= t2 ? t3 - t2 : 0),
        (unsigned long long)(t4 >= t3 ? t4 - t3 : 0),
        (unsigned long long)(t5 >= t4 ? t5 - t4 : 0),
        (unsigned long long)(t6 >= t5 ? t6 - t5 : 0),
        (unsigned long long)(t7 >= write_start ? t7 - write_start : 0),
        (unsigned long long)(t7 >= t0 ? t7 - t0 : 0));
      fflush(stderr);
    } else {
      dump_profile_counts();
    }
    k_rt_reset(rt);
    if (!ok) {
      k_wire_prefix_free(input_prefix);
      k_wire_prefix_free(output_prefix);
      k_rt_free(rt);
      return 4;
    }
  }
}

static int parse_size_arg(const char *text, size_t *out) {
  if (text == NULL || *text == 0) return 0;
  size_t value = 0;
  for (const char *p = text; *p != 0; p++) {
    if (*p < '0' || *p > '9') return 0;
    size_t digit = (size_t)(*p - '0');
    if (value > (((size_t)-1) - digit) / 10) return 0;
    value = value * 10 + digit;
  }
  if (value == 0) return 0;
  *out = value;
  return 1;
}

static int run_bench_main(void *arena_mem, const char *count_text) {
  size_t count = 0;
  if (!parse_size_arg(count_text, &count)) return 9;
  k_rt *rt = k_rt_new();
  if (!rt) return 1;
  k_wire_input input = k_read_wire_envelope(stdin, rt);
  if (!input.value || !input.pattern) {
    k_wire_input_free(input);
    k_rt_free(rt);
    return 2;
  }
  if (!k_pattern_equal(input.pattern, &compiled_input_pattern)) {
    k_wire_input_free(input);
    k_rt_free(rt);
    return 5;
  }
  void *arena_bump = arena_mem;
  void *flat_in = k_value_to_flat(input.value, &arena_bump, 0, &compiled_input_pattern);
  void *arena_mark = arena_bump;

  uint64_t started_at = monotonic_ns();
  for (size_t i = 0; i < count; i++) {
    arena_bump = arena_mark;
    k_arm64_res_t result = invoke_entry(flat_in, &arena_bump);
    if (result.status != 0) {
      k_wire_input_free(input);
      k_rt_free(rt);
      return 3;
    }
  }
  uint64_t ended_at = monotonic_ns();
  uint64_t elapsed = ended_at >= started_at ? ended_at - started_at : 0;
  fprintf(stderr, "K_ARM64_BENCH_MAIN calls=%zu total_ns=%llu per_call_ns=%.2f\n",
    count, (unsigned long long)elapsed, count == 0 ? 0.0 : (double)elapsed / (double)count);
  k_wire_input_free(input);
  k_rt_free(rt);
  return 0;
}

int main(int argc, char **argv) {
  init_tag_registry();

  if (argc == 2 && strcmp(argv[1], "--server") == 0) {
    void *arena_mem = malloc(ARENA_CAPACITY);
    if (!arena_mem) return 1;
    int rc = run_server(arena_mem);
    free(arena_mem);
    return rc;
  }

  if (argc == 3 && strcmp(argv[1], "--bench-main") == 0) {
    void *arena_mem = malloc(ARENA_CAPACITY);
    if (!arena_mem) return 1;
    int rc = run_bench_main(arena_mem, argv[2]);
    free(arena_mem);
    return rc;
  }

  int json_mode = 0;
  const char *input_file = NULL;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--json") == 0) {
      json_mode = 1;
    } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
      fprintf(stderr, "Usage: %s [--json] [input-file]\n", argv[0]);
      fprintf(stderr, "Execute compiled k relation on ARM64 Linux.\n\n");
      fprintf(stderr, "Options:\n");
      fprintf(stderr, "  --json      Output result as JSON instead of binary wire format\n");
      fprintf(stderr, "  -h, --help  Show this help\n");
      return 0;
    } else if (argv[i][0] != '-') {
      input_file = argv[i];
    } else {
      fprintf(stderr, "Unknown option: %s\n", argv[i]);
      return 1;
    }
  }

  FILE *in_fp = stdin;
  if (input_file) {
    in_fp = fopen(input_file, "rb");
    if (!in_fp) {
      perror("Failed to open input file");
      return 1;
    }
  }

  void *arena_mem = malloc(ARENA_CAPACITY);
  if (!arena_mem) {
    if (in_fp != stdin) fclose(in_fp);
    return 1;
  }
  void *arena_bump = arena_mem;

  k_rt *rt = k_rt_new();
  if (!rt) {
    if (in_fp != stdin) fclose(in_fp);
    free(arena_mem);
    return 1;
  }

  uint64_t t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0;
  int tracing = is_trace_enabled();
  if (tracing) t0 = monotonic_ns();

  k_wire_input input = k_read_wire_envelope(in_fp, rt);
  if (in_fp != stdin) fclose(in_fp);
  if (!input.value) {
    k_rt_free(rt);
    free(arena_mem);
    return 2;
  }
  if (tracing) t1 = monotonic_ns();

  void *flat_in = k_value_to_flat(input.value, &arena_bump, 0, &compiled_input_pattern);
  if (tracing) t2 = monotonic_ns();

  k_arm64_res_t res = invoke_entry(flat_in, &arena_bump);
  if (tracing) t3 = monotonic_ns();
  if (res.status != 0) {
    // Partial failure
    k_wire_input_free(input);
    k_rt_free(rt);
    free(arena_mem);
    return 1;
  }

  k_value *out_val = flat_to_k_value(rt, res.val, 0, &compiled_output_pattern);
  if (tracing) t4 = monotonic_ns();
  if (!out_val) {
    k_wire_input_free(input);
    k_rt_free(rt);
    free(arena_mem);
    return 3;
  }

  if (json_mode) {
    k_print_json(stdout, out_val);
    printf("\n");
  } else if (!pattern_has_any(&compiled_output_pattern)) {
    k_write_wire_as(stdout, &compiled_output_pattern, out_val);
  } else {
    k_write_wire(stdout, out_val);
  }
  fflush(stdout);

  if (tracing) {
    t5 = monotonic_ns();
    dump_profile_counts();
    fprintf(stderr, "K_TRACE_PHASES backend=arm64 ipc_read_ns=%llu decode_ns=0 flat_in_ns=%llu eval_ns=%llu flat_out_ns=%llu encode_ns=%llu ipc_write_ns=0 total_ns=%llu\n",
      (unsigned long long)(t1 >= t0 ? t1 - t0 : 0),
      (unsigned long long)(t2 >= t1 ? t2 - t1 : 0),
      (unsigned long long)(t3 >= t2 ? t3 - t2 : 0),
      (unsigned long long)(t4 >= t3 ? t4 - t3 : 0),
      (unsigned long long)(t5 >= t4 ? t5 - t4 : 0),
      (unsigned long long)(t5 >= t0 ? t5 - t0 : 0));
    fflush(stderr);
  } else {
    dump_profile_counts();
  }

  k_wire_input_free(input);
  k_rt_free(rt);
  free(arena_mem);
  return 0;
}
