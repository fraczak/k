/*
 * kTVM Standalone Native C99 / LLVM Runtime (`k/ktvm/llvm/runtime.h`)
 *
 * Zero-dependency, strictly iterative operational semantics for concrete `mono`
 * kTVM modules compiled via `clang -O3`:
 *   - Bump arena with 1ns reset + power-of-2 BitDeque buffer free list
 *   - Inline 128-bit + growable BitDeque (with O(1) adopt) & LIFO BitStack
 *   - Shared Moore-minimized schema DFA + resumable DPDA (skip / copy / coerce)
 *   - Native `k-wire` envelope header parser + coinductive equivalence checker
 *     with 16-entry prefix cache (O(headerBytes) memcmp fast path)
 *   - All 15 kTVM node steppers (incl. O(1) splice, mux/demux fusion, single-
 *     survivor tee, spec rollback/upstream-abort, after %tok settlement)
 *   - Hot-burst chunk_table (with SWAR bit compression), stack_table, fsm_table
 *   - Built-in `--server` persistent pipe (with K_TRACE=1), `--bench N`, and CLI
 */

#ifndef KTVM_RUNTIME_H
#define KTVM_RUNTIME_H

#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif

#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>

/* =========================================================================
 * Error & Status Codes
 * ========================================================================= */

enum {
  KTVM_OK             =  0,
  KTVM_ERR_FAILED     = -1,
  KTVM_ERR_QUOTA_STEP = -2,
  KTVM_ERR_QUOTA_NODE = -3,
  KTVM_ERR_QUOTA_MEM  = -4,
  KTVM_ERR_OUT_CAP    = -5,
  KTVM_ERR_MALFORMED  = -6,
  KTVM_ERR_DEADLOCK   = -7,
  KTVM_ERR_SCHEMA     = -8
};

enum {
  CHAN_OPEN     = 0,
  CHAN_CLOSED   = 1,
  CHAN_FAILED   = 2,
  CHAN_RELEASED = 3,
  CHAN_QUEUED   = 4
};

enum {
  NK_CONST_UNIT = 1,
  NK_SPLICE     = 2,
  NK_COERCE     = 3,
  NK_WRAP       = 4,
  NK_MATCH      = 5,
  NK_DEMUX      = 6,
  NK_MUX        = 7,
  NK_TEE        = 8,
  NK_DRAIN      = 9,
  NK_GATE       = 10,
  NK_SWITCH     = 11,
  NK_SPEC       = 12,
  NK_TAP        = 13,
  NK_SPAWN      = 14,
  NK_KERNEL     = 15
};

enum {
  STEP_OK        = 0,
  STEP_NEED_PULL = 1,
  STEP_YIELDED   = 2,
  STEP_NEED_NODE = 3
};

/* =========================================================================
 * Static Schema / Table / Descriptor Types (emitted by lower-c.mjs)
 * ========================================================================= */

typedef struct {
  int32_t tag_id;
  int32_t target_id;
} KtvmSchemaEdge;

typedef struct {
  int32_t kind;       /* 0 = closed-product, 1 = closed-union */
  int32_t width;      /* choiceWidth(num_edges) for union, 0 for product */
  int32_t num_edges;
  int32_t edges_off;  /* index into KTVM_SCHEMA_EDGES */
} KtvmSchemaNode;

typedef struct {
  const uint8_t *bytes;
  int32_t bit_len;
} KtvmTagWire;

typedef struct {
  const uint8_t *bytes;
  int32_t bit_len;
} KtvmHeaderPreset;

typedef struct KtvmRuntime KtvmRuntime;
typedef struct KtvmScope KtvmScope;
typedef struct KtvmChan KtvmChan;
typedef struct KtvmNode KtvmNode;

typedef void (*KtvmBlockFn)(KtvmRuntime *rt, KtvmScope *sc, void **env);
typedef int  (*KtvmKernelFn)(KtvmRuntime *rt, KtvmNode *n);

typedef struct {
  KtvmBlockFn fn;
  const int32_t *patterns; /* len = num_inspect, -1 = wild, >=0 = tag_id */
} KtvmSwitchArm;

typedef struct {
  int32_t num_inspect;
  int32_t num_arms;
  uint32_t tested_mask;
  const KtvmSwitchArm *arms;
  KtvmBlockFn default_fn;
  const uint8_t *cap_kinds; /* 0=chan, 1=barrier, 2=token */
} KtvmSwitchDesc;

typedef struct {
  int32_t num_in;
  int32_t num_out;
  int32_t num_branches;
  const KtvmBlockFn *branch_fns;
} KtvmSpecDesc;

typedef struct {
  int32_t kind; /* 0=chunk_table, 1=stack_table, 2=fsm_table */
  int32_t num_states;
  int32_t num_in;
  int32_t num_out;
  int32_t raw_bits0;
  int32_t eff_bits0;
  int32_t mask0;
  int32_t raw_bits1;
  int32_t eff_bits1;
  int32_t mask1;
  int32_t out_mode0; /* 0=push, 1=unshift */
  int32_t out_mode1;
  int32_t w_stack;
  int32_t stack_stride;
  int32_t num_entries;
  const uint8_t *entries; /* 16 bytes per entry */
} KtvmTableMeta;

/* Provided by the generated module `.c` file */
extern const KtvmSchemaNode KTVM_SCHEMA_NODES[];
extern const int32_t KTVM_NUM_SCHEMA_NODES;
extern const KtvmSchemaEdge KTVM_SCHEMA_EDGES[];
extern const KtvmTagWire KTVM_TAG_WIRES[];
extern const int32_t KTVM_NUM_TAGS;
extern const int32_t KTVM_IN_SCHEMA_ID;
extern const int32_t KTVM_OUT_SCHEMA_ID;
extern const KtvmHeaderPreset KTVM_ACCEPTED_IN_HEADERS[];
extern const int32_t KTVM_NUM_ACCEPTED_IN_HEADERS;
extern const uint8_t KTVM_OUT_HDR_BYTES[];
extern const int32_t KTVM_OUT_HDR_BITS;
extern void ktvm_start_entry(KtvmRuntime *rt, KtvmScope *root_sc, KtvmChan *root_in, KtvmChan *root_out);

/* =========================================================================
 * Runtime Arena & Data Structures
 * ========================================================================= */

typedef struct {
  uint32_t *buf;
  int32_t cap_words;
  int32_t len_bits;
  int32_t released;
  uint32_t inline_buf[4];
} KtvmBitStack;

struct KtvmChan {
  int32_t status;      /* CHAN_OPEN..CHAN_QUEUED */
  int32_t prod_schema;
  int32_t cons_schema;
  int32_t aligned;
  KtvmNode *producer;
  KtvmNode *consumer;
  KtvmScope *scope;
  KtvmChan *scope_next;
  KtvmChan *scope_prev;
  int32_t pin_count;
  uint32_t *buf;
  int32_t cap_words;
  int32_t head;
  int32_t len;
  uint32_t inline_buf[4];
};

typedef struct {
  int32_t kind; /* 0=skip, 1=copy, 2=coerce */
  int32_t cap;
  int32_t len;
  int32_t done;
  int32_t *stk; /* 1 int/frame for skip/copy, 2 ints/frame for coerce */
  int32_t inline_stk[24];
} KtvmDpda;

typedef struct {
  int32_t pending;
  int32_t failed;
  int32_t settled;
  int32_t refs;
  KtvmNode *first_drain;
} KtvmBarrier;

typedef struct {
  int32_t settled;
  int32_t out_count;
  int32_t refs;
  KtvmChan **outs;
} KtvmToken;

typedef struct {
  KtvmChan *orig;
  KtvmChan *replay;
  KtvmNode *tap;
  int32_t done;
} KtvmTapRec;

typedef struct {
  KtvmChan *staged;
  KtvmChan *outer;
} KtvmStagedRec;

typedef struct {
  KtvmScope *scope;
  int32_t branch_idx;
  int32_t num_in;
  int32_t num_out;
  KtvmTapRec *taps;
  KtvmStagedRec *staged;
} KtvmSpecActive;

typedef struct {
  int32_t pc;
  int32_t num_regs;
  int32_t num_stacks;
  int32_t num_outs;
  uint32_t live_in_mask;
  uint32_t live_out_mask;
  int32_t *regs;
  KtvmBitStack **stacks;
  KtvmChan **unshift_bufs;
  uint32_t *temps;
  KtvmDpda *dpda;
  int32_t last_exit;
} KtvmKernelState;

struct KtvmScope {
  KtvmScope *parent;
  KtvmScope *first_child;
  KtvmScope *next_sibling;
  KtvmScope *prev_sibling;
  KtvmNode *first_node;
  KtvmChan *first_chan;
  int32_t destroyed;
};

struct KtvmNode {
  int32_t kind;
  int32_t retired; /* 0=live, 1=retired, 2=queued */
  int32_t pin_count;
  KtvmScope *scope;
  KtvmNode *scope_next;
  KtvmNode *scope_prev;
  KtvmNode *bar_next;
  KtvmNode *bar_prev;
  KtvmChan **ins;
  int32_t in_count;
  KtvmChan **outs;
  int32_t out_count;
  int32_t a0, a1, a2, a3;
  void *p0;
  void *p1;
  void *p2;
  KtvmChan *inline_chans[4];
};

typedef struct {
  int32_t kind; /* 0=chan, 1=node */
  void *ptr;
} KtvmDFrame;

typedef struct {
  uint8_t *bytes;
  int32_t bit_len;
} KtvmCachedHdr;

#define KTVM_ARENA_INIT_BYTES (256u * 1024u)
#define KTVM_HDR_CACHE_CAP 16
#define KTVM_SLAB_BUCKETS 17

typedef struct {
  int32_t bucket;
  int32_t live;
  uint64_t _pad;
} KtvmSlabHdr;

typedef struct KtvmArenaBlock {
  struct KtvmArenaBlock *next;
  size_t cap;
  size_t used;
  uint8_t data[];
} KtvmArenaBlock;

typedef struct {
  int16_t fixed_bits; /* >=0 if unconditionally valid fixed-width <=64b, else -1 */
  uint8_t is_loop;    /* 1 if closed-union with <=4 edges, each self-loop+fixed or leaf+fixed */
  uint8_t loop_w;
  uint8_t num_edges;
  uint8_t edge_kind[4]; /* 0 = self-loop, 1 = terminate */
  int16_t edge_skip[4]; /* extra fixed bits after tag */
} KtvmSchemaFast;

struct KtvmRuntime {
  KtvmArenaBlock *arena_head;
  KtvmArenaBlock *arena_cur;
  void *slab_fl[KTVM_SLAB_BUCKETS]; /* unified O(1) power-of-2 free list: 16B..1MiB */

  KtvmNode *dead_nodes;
  KtvmChan *dead_chans;
  KtvmScope *dead_scopes;
  int32_t dead_pending;
  KtvmSchemaFast *schema_fast;

  int32_t error_code;
  KtvmChan *need_pull;
  KtvmNode *need_step_node;

  int32_t max_steps;
  int32_t max_nodes;
  int32_t max_bytes;

  int32_t steps;
  int32_t live_nodes;
  int32_t peak_nodes;
  int32_t buf_bytes;
  int32_t peak_bytes;
  int32_t table_lookups;
  int32_t splices;
  int32_t mux_demux_fusions;
  int32_t spec_rollbacks;
  int32_t spec_upstream_aborts;
  int32_t spec_tail_splices;
  int32_t after_settlements;

  KtvmDFrame *dstack;
  int32_t dstack_cap;
  int32_t dstack_len;

  KtvmScope **sc_stk;
  KtvmScope **sc_ord;
  int32_t sc_cap;

  KtvmCachedHdr hdr_cache[KTVM_HDR_CACHE_CAP];
  int32_t hdr_cache_len;
};

/* =========================================================================
 * 1. Arena, Quotas & Bit Helpers
 * ========================================================================= */

static inline uint32_t ktvm_mask32(int32_t w) {
  if (w <= 0) return 0u;
  if (w >= 32) return 0xffffffffu;
  return (1u << (uint32_t)w) - 1u;
}

static KtvmArenaBlock *ktvm_arena_new_block(size_t cap) {
  KtvmArenaBlock *b = (KtvmArenaBlock *)malloc(sizeof(KtvmArenaBlock) + cap);
  if (!b) return NULL;
  b->next = NULL;
  b->cap = cap;
  b->used = 0;
  return b;
}

static void ktvm_compute_schema_fast(KtvmRuntime *rt) {
  int32_t n = KTVM_NUM_SCHEMA_NODES;
  if (n <= 0) { rt->schema_fast = NULL; return; }
  KtvmSchemaFast *sf = (KtvmSchemaFast *)calloc((size_t)n, sizeof(KtvmSchemaFast));
  if (!sf) { rt->schema_fast = NULL; return; }
  for (int32_t i = 0; i < n; i++) sf[i].fixed_bits = -1;
  int changed = 1;
  while (changed) {
    changed = 0;
    for (int32_t i = 0; i < n; i++) {
      if (sf[i].fixed_bits >= 0) continue;
      const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[i];
      const KtvmSchemaEdge *ep = &KTVM_SCHEMA_EDGES[sn->edges_off];
      if (sn->kind == 0) {
        int32_t sum = 0;
        int ok = 1;
        for (int32_t j = 0; j < sn->num_edges; j++) {
          int32_t cf = sf[ep[j].target_id].fixed_bits;
          if (cf < 0 || sum + cf > 64) { ok = 0; break; }
          sum += cf;
        }
        if (ok) { sf[i].fixed_bits = (int16_t)sum; changed = 1; }
      } else if (sn->num_edges > 0 && sn->width <= 16 && sn->num_edges == (1 << sn->width)) {
        int32_t c0 = sf[ep[0].target_id].fixed_bits;
        if (c0 >= 0 && sn->width + c0 <= 64) {
          int ok = 1;
          for (int32_t j = 1; j < sn->num_edges; j++) {
            if (sf[ep[j].target_id].fixed_bits != c0) { ok = 0; break; }
          }
          if (ok) { sf[i].fixed_bits = (int16_t)(sn->width + c0); changed = 1; }
        }
      }
    }
  }
  /* Detect tail-recursive self-looping union schemas (e.g. bits[], list[ascii], list[float64]) */
  for (int32_t i = 0; i < n; i++) {
    if (sf[i].fixed_bits >= 0) continue;
    const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[i];
    if (sn->kind != 1 || sn->width <= 0 || sn->width > 16 || sn->num_edges <= 0 || sn->num_edges > 4) continue;
    const KtvmSchemaEdge *ep = &KTVM_SCHEMA_EDGES[sn->edges_off];
    int ok = 1, has_self = 0;
    uint8_t ek[4] = {0, 0, 0, 0};
    int16_t es[4] = {0, 0, 0, 0};
    for (int32_t j = 0; j < sn->num_edges; j++) {
      int32_t tid = ep[j].target_id;
      if (sf[tid].fixed_bits >= 0 && sn->width + sf[tid].fixed_bits <= 64) {
        ek[j] = 1;
        es[j] = sf[tid].fixed_bits;
      } else if (tid == i) {
        ek[j] = 0;
        es[j] = 0;
        has_self = 1;
      } else {
        const KtvmSchemaNode *tn = &KTVM_SCHEMA_NODES[tid];
        if (tn->kind == 0 && tn->num_edges >= 1) {
          const KtvmSchemaEdge *tep = &KTVM_SCHEMA_EDGES[tn->edges_off];
          if (tep[tn->num_edges - 1].target_id == i) {
            int32_t sum = 0;
            for (int32_t k = 0; k < tn->num_edges - 1; k++) {
              int32_t cf = sf[tep[k].target_id].fixed_bits;
              if (cf < 0 || sn->width + sum + cf > 64) { ok = 0; break; }
              sum += cf;
            }
            if (ok) {
              ek[j] = 0;
              es[j] = (int16_t)sum;
              has_self = 1;
            }
          } else {
            ok = 0;
          }
        } else {
          ok = 0;
        }
      }
      if (!ok) break;
    }
    if (ok && has_self) {
      sf[i].is_loop = 1;
      sf[i].loop_w = (uint8_t)sn->width;
      sf[i].num_edges = (uint8_t)sn->num_edges;
      for (int32_t j = 0; j < sn->num_edges; j++) {
        sf[i].edge_kind[j] = ek[j];
        sf[i].edge_skip[j] = es[j];
      }
    }
  }
  rt->schema_fast = sf;
}

static void ktvm_init(KtvmRuntime *rt) {
  memset(rt, 0, sizeof(*rt));
  rt->max_steps = 50000000;
  rt->max_nodes = 200000;
  rt->max_bytes = 67108864;
  rt->arena_head = ktvm_arena_new_block(KTVM_ARENA_INIT_BYTES);
  rt->arena_cur = rt->arena_head;
  rt->dstack_cap = 256;
  rt->dstack = (KtvmDFrame *)malloc((size_t)rt->dstack_cap * sizeof(KtvmDFrame));
  rt->sc_cap = 256;
  rt->sc_stk = (KtvmScope **)malloc((size_t)rt->sc_cap * sizeof(KtvmScope *));
  rt->sc_ord = (KtvmScope **)malloc((size_t)rt->sc_cap * sizeof(KtvmScope *));
  ktvm_compute_schema_fast(rt);
}

static void ktvm_destroy(KtvmRuntime *rt) {
  KtvmArenaBlock *b = rt->arena_head;
  while (b) {
    KtvmArenaBlock *n = b->next;
    free(b);
    b = n;
  }
  free(rt->dstack);
  free(rt->sc_stk);
  free(rt->sc_ord);
  free(rt->schema_fast);
  for (int i = 0; i < rt->hdr_cache_len; i++) free(rt->hdr_cache[i].bytes);
}

static void ktvm_reset(KtvmRuntime *rt) {
  if (rt->arena_head) {
    KtvmArenaBlock *extra = rt->arena_head->next;
    while (extra) {
      KtvmArenaBlock *nxt = extra->next;
      free(extra);
      extra = nxt;
    }
    rt->arena_head->next = NULL;
    rt->arena_head->used = 0;
  }
  rt->arena_cur = rt->arena_head;
  memset(rt->slab_fl, 0, sizeof(rt->slab_fl));
  rt->dead_nodes = NULL;
  rt->dead_chans = NULL;
  rt->dead_scopes = NULL;
  rt->dead_pending = 0;
  rt->error_code = 0;
  rt->need_pull = NULL;
  rt->need_step_node = NULL;
  rt->steps = 0;
  rt->live_nodes = 0;
  rt->peak_nodes = 0;
  rt->buf_bytes = 0;
  rt->peak_bytes = 0;
  rt->table_lookups = 0;
  rt->splices = 0;
  rt->mux_demux_fusions = 0;
  rt->spec_rollbacks = 0;
  rt->spec_upstream_aborts = 0;
  rt->spec_tail_splices = 0;
  rt->after_settlements = 0;
  rt->dstack_len = 0;
}

static inline void *ktvm_alloc_raw(KtvmRuntime *rt, size_t bytes) {
  int32_t b;
  size_t payload_sz;
  if (bytes <= 16u) {
    b = 0;
    payload_sz = 16u;
  } else if (bytes <= (16u << (KTVM_SLAB_BUCKETS - 1))) {
    b = 28 - __builtin_clz((uint32_t)(bytes - 1u));
    payload_sz = (size_t)16u << b;
  } else {
    b = -1;
    payload_sz = (bytes + 15u) & ~(size_t)15u;
  }

  if (b >= 0) {
    void *ptr = rt->slab_fl[b];
    if (__builtin_expect(ptr != NULL, 1)) {
      rt->slab_fl[b] = *(void **)ptr;
      KtvmSlabHdr *hdr = ((KtvmSlabHdr *)ptr) - 1;
      hdr->live = 1;
      return ptr;
    }
  }

  size_t total = sizeof(KtvmSlabHdr) + payload_sz;
  KtvmArenaBlock *blk = rt->arena_cur;
  while (blk && blk->used + total > blk->cap) {
    if (!blk->next) {
      size_t new_cap = blk->cap * 2u;
      if (new_cap < total + 65536u) new_cap = total + 65536u;
      blk->next = ktvm_arena_new_block(new_cap);
      if (!blk->next) {
        if (!rt->error_code) rt->error_code = KTVM_ERR_QUOTA_MEM;
        return NULL;
      }
    }
    blk = blk->next;
  }
  rt->arena_cur = blk;
  KtvmSlabHdr *hdr = (KtvmSlabHdr *)(blk->data + blk->used);
  blk->used += total;
  hdr->bucket = b;
  hdr->live = 1;
  hdr->_pad = 0;
  return (void *)(hdr + 1);
}

static inline void *ktvm_alloc(KtvmRuntime *rt, size_t bytes) {
  void *ptr = ktvm_alloc_raw(rt, bytes);
  if (ptr && bytes > 0) memset(ptr, 0, bytes);
  return ptr;
}

static inline void ktvm_free(KtvmRuntime *rt, void *ptr) {
  if (!ptr) return;
  KtvmSlabHdr *hdr = ((KtvmSlabHdr *)ptr) - 1;
  if (hdr->live != 1) return;
  hdr->live = 0;
  int32_t b = hdr->bucket;
  if (b >= 0 && b < KTVM_SLAB_BUCKETS) {
    *(void **)ptr = rt->slab_fl[b];
    rt->slab_fl[b] = ptr;
  }
}

static inline void ktvm_quota_add_bytes(KtvmRuntime *rt, int32_t delta) {
  int32_t cur = rt->buf_bytes + delta;
  if (cur < 0) cur = 0;
  rt->buf_bytes = cur;
  if (cur > rt->peak_bytes) rt->peak_bytes = cur;
  if (cur > rt->max_bytes && !rt->error_code) rt->error_code = KTVM_ERR_QUOTA_MEM;
}

static inline void ktvm_quota_add_node(KtvmRuntime *rt) {
  int32_t cur = ++rt->live_nodes;
  if (cur > rt->peak_nodes) rt->peak_nodes = cur;
  if (cur > rt->max_nodes && !rt->error_code) rt->error_code = KTVM_ERR_QUOTA_NODE;
}

static inline void ktvm_quota_remove_node(KtvmRuntime *rt) {
  if (rt->live_nodes > 0) rt->live_nodes--;
}

static inline int ktvm_quota_tick_step(KtvmRuntime *rt) {
  int32_t s = ++rt->steps;
  if (s > rt->max_steps) {
    if (!rt->error_code) rt->error_code = KTVM_ERR_QUOTA_STEP;
    return 1;
  }
  return rt->error_code != 0;
}

/* =========================================================================
 * 2. Schema DFA Helpers
 * ========================================================================= */

static inline int32_t ktvm_schema_find_tag(int32_t sid, int32_t tag_id) {
  const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[sid];
  const KtvmSchemaEdge *ep = &KTVM_SCHEMA_EDGES[sn->edges_off];
  for (int32_t i = 0; i < sn->num_edges; i++) {
    if (ep[i].tag_id == tag_id) return i;
  }
  return -1;
}

/* =========================================================================
 * 3. BitDeque (Channel) ADT & Channel Reclamation
 * ========================================================================= */

static inline void ktvm_try_queue_chan(KtvmRuntime *rt, KtvmChan *ch) {
  if (ch && ch->status == CHAN_RELEASED && ch->pin_count <= 0 && !ch->producer && !ch->consumer) {
    ch->status = CHAN_QUEUED;
    ch->scope_next = rt->dead_chans;
    rt->dead_chans = ch;
    rt->dead_pending++;
  }
}

static inline void ktvm_chan_pin(KtvmChan *ch) {
  if (ch) ch->pin_count++;
}

static inline void ktvm_chan_unpin(KtvmRuntime *rt, KtvmChan *ch) {
  if (!ch) return;
  ch->pin_count--;
  if (__builtin_expect(ch->pin_count <= 0 && ch->status == CHAN_RELEASED, 0)) ktvm_try_queue_chan(rt, ch);
}

static inline void ktvm_scope_unlink_chan(KtvmChan *ch) {
  KtvmScope *sc = ch->scope;
  if (!sc) return;
  if (ch->scope_prev) ch->scope_prev->scope_next = ch->scope_next;
  else if (sc->first_chan == ch) sc->first_chan = ch->scope_next;
  if (ch->scope_next) ch->scope_next->scope_prev = ch->scope_prev;
  ch->scope = NULL;
  ch->scope_next = NULL;
  ch->scope_prev = NULL;
}

static inline KtvmChan *ktvm_chan_alloc(KtvmRuntime *rt, KtvmScope *sc, int32_t schema_id) {
  KtvmChan *ch = (KtvmChan *)ktvm_alloc_raw(rt, sizeof(KtvmChan));
  if (__builtin_expect(!ch, 0)) return NULL;
  ch->status = CHAN_OPEN;
  ch->prod_schema = schema_id;
  ch->cons_schema = schema_id;
  ch->aligned = 1;
  ch->producer = NULL;
  ch->consumer = NULL;
  ch->scope = sc;
  ch->scope_prev = NULL;
  ch->pin_count = 0;
  ch->buf = ch->inline_buf;
  ch->cap_words = 4;
  ch->head = 0;
  ch->len = 0;
  ktvm_quota_add_bytes(rt, 16);
  if (sc) {
    KtvmChan *old_first = sc->first_chan;
    ch->scope_next = old_first;
    if (old_first) old_first->scope_prev = ch;
    sc->first_chan = ch;
  } else {
    ch->scope_next = NULL;
  }
  return ch;
}

static inline void ktvm_bd_close(KtvmChan *ch) {
  if (ch && ch->status == CHAN_OPEN) {
    ch->status = CHAN_CLOSED;
    ch->producer = NULL;
  }
}

static inline void ktvm_bd_fail(KtvmChan *ch) {
  if (ch && ch->status == CHAN_OPEN) {
    ch->status = CHAN_FAILED;
    ch->producer = NULL;
  }
}

static inline void ktvm_bd_release(KtvmRuntime *rt, KtvmChan *ch) {
  if (!ch || ch->status >= CHAN_RELEASED) return;
  if (ch->cap_words > 0) {
    ktvm_quota_add_bytes(rt, -(ch->cap_words << 2));
    if (ch->buf && ch->buf != ch->inline_buf) {
      ktvm_free(rt, ch->buf);
    }
  }
  ch->status = CHAN_RELEASED;
  ch->buf = NULL;
  ch->cap_words = 0;
  ch->len = 0;
  ktvm_scope_unlink_chan(ch);
  ktvm_try_queue_chan(rt, ch);
}

static void ktvm_bd_grow(KtvmRuntime *rt, KtvmChan *ch, int32_t min_bits) {
  if (ch->status >= CHAN_RELEASED) return;
  uint32_t *old_buf = ch->buf;
  int32_t old_words = ch->cap_words;
  int32_t old_head = ch->head;
  int32_t old_len = ch->len;

  int32_t new_words = old_words << 1;
  if (new_words < 8) new_words = 8;
  while ((new_words << 5) < min_bits) new_words <<= 1;

  uint32_t *new_buf = (uint32_t *)ktvm_alloc(rt, (size_t)new_words * 4u);
  if (!new_buf) return;
  ktvm_quota_add_bytes(rt, (new_words - old_words) << 2);

  uint32_t old_wmask = (uint32_t)(old_words - 1);
  uint32_t old_bmask = (uint32_t)((old_words << 5) - 1);
  int32_t rem = old_len;
  uint32_t src_pos = (uint32_t)old_head;
  uint32_t dst_pos = 0;

  while (rem > 0) {
    int32_t chunk = rem > 30 ? 30 : rem;
    uint32_t wi = src_pos >> 5;
    int32_t bo = (int32_t)(src_pos & 31u);
    uint32_t val;
    if (bo + chunk <= 32) {
      val = (old_buf[wi] >> (32 - bo - chunk)) & ktvm_mask32(chunk);
    } else {
      int32_t lo = bo + chunk - 32;
      int32_t hi_bits = 32 - bo;
      uint32_t w1 = (wi + 1u) & old_wmask;
      val = ((old_buf[wi] & ktvm_mask32(hi_bits)) << lo) | (old_buf[w1] >> (32 - lo));
    }
    uint32_t dwi = dst_pos >> 5;
    int32_t dbo = (int32_t)(dst_pos & 31u);
    if (dbo + chunk <= 32) {
      new_buf[dwi] |= val << (32 - dbo - chunk);
    } else {
      int32_t lo = dbo + chunk - 32;
      new_buf[dwi] |= val >> lo;
      new_buf[dwi + 1u] |= val << (32 - lo);
    }
    src_pos = (src_pos + (uint32_t)chunk) & old_bmask;
    dst_pos += (uint32_t)chunk;
    rem -= chunk;
  }

  if (old_buf && old_buf != ch->inline_buf) ktvm_free(rt, old_buf);
  ch->buf = new_buf;
  ch->cap_words = new_words;
  ch->head = 0;
}

static inline void ktvm_bd_push_small(KtvmRuntime *rt, KtvmChan *ch, uint32_t val, int32_t w) {
  if (w <= 0 || ch->status >= CHAN_RELEASED) return;
  if (ch->len + w > (ch->cap_words << 5)) {
    ktvm_bd_grow(rt, ch, ch->len + w);
    if (rt->error_code) return;
  }
  uint32_t cap_w = (uint32_t)ch->cap_words;
  uint32_t bmask = (cap_w << 5) - 1u;
  uint32_t wmask = cap_w - 1u;
  uint32_t pos = ((uint32_t)ch->head + (uint32_t)ch->len) & bmask;
  uint32_t wi = pos >> 5;
  int32_t bo = (int32_t)(pos & 31u);
  uint32_t v = val & ktvm_mask32(w);
  uint32_t *buf = ch->buf;
  if (bo + w <= 32) {
    int32_t sh = 32 - bo - w;
    uint32_t clr = ~(ktvm_mask32(w) << sh);
    buf[wi] = (buf[wi] & clr) | (v << sh);
  } else {
    int32_t hi = 32 - bo;
    int32_t lo = w - hi;
    uint32_t w1 = (wi + 1u) & wmask;
    buf[wi] = (buf[wi] & ~ktvm_mask32(hi)) | (v >> lo);
    buf[w1] = (buf[w1] & ~(ktvm_mask32(lo) << (32 - lo))) | ((v & ktvm_mask32(lo)) << (32 - lo));
  }
  ch->len += w;
}

static inline void ktvm_bd_push_bits(KtvmRuntime *rt, KtvmChan *ch, uint32_t val, int32_t w) {
  if (w <= 30) {
    ktvm_bd_push_small(rt, ch, val, w);
  } else {
    int32_t hi_w = w - 16;
    ktvm_bd_push_small(rt, ch, val >> 16, hi_w);
    ktvm_bd_push_small(rt, ch, val & 0xffffu, 16);
  }
}

static inline void ktvm_bd_unshift_small(KtvmRuntime *rt, KtvmChan *ch, uint32_t val, int32_t w) {
  if (w <= 0 || ch->status >= CHAN_RELEASED) return;
  if (ch->len + w > (ch->cap_words << 5)) {
    ktvm_bd_grow(rt, ch, ch->len + w);
    if (rt->error_code) return;
  }
  uint32_t cap_w = (uint32_t)ch->cap_words;
  uint32_t bmask = (cap_w << 5) - 1u;
  uint32_t wmask = cap_w - 1u;
  uint32_t pos = ((uint32_t)ch->head - (uint32_t)w) & bmask;
  ch->head = (int32_t)pos;
  uint32_t wi = pos >> 5;
  int32_t bo = (int32_t)(pos & 31u);
  uint32_t v = val & ktvm_mask32(w);
  uint32_t *buf = ch->buf;
  if (bo + w <= 32) {
    int32_t sh = 32 - bo - w;
    buf[wi] = (buf[wi] & ~(ktvm_mask32(w) << sh)) | (v << sh);
  } else {
    int32_t hi = 32 - bo;
    int32_t lo = w - hi;
    uint32_t w1 = (wi + 1u) & wmask;
    buf[wi] = (buf[wi] & ~ktvm_mask32(hi)) | (v >> lo);
    buf[w1] = (buf[w1] & ~(ktvm_mask32(lo) << (32 - lo))) | ((v & ktvm_mask32(lo)) << (32 - lo));
  }
  ch->len += w;
}

static inline void ktvm_bd_unshift_bits(KtvmRuntime *rt, KtvmChan *ch, uint32_t val, int32_t w) {
  if (w <= 30) {
    ktvm_bd_unshift_small(rt, ch, val, w);
  } else {
    int32_t hi_w = w - 16;
    ktvm_bd_unshift_small(rt, ch, val & 0xffffu, 16);
    ktvm_bd_unshift_small(rt, ch, val >> 16, hi_w);
  }
}

static inline uint32_t ktvm_bd_peek_small_at(const KtvmChan *ch, int32_t bit_off, int32_t w) {
  if (w <= 0) return 0u;
  uint32_t cap_w = (uint32_t)ch->cap_words;
  uint32_t pos = ((uint32_t)ch->head + (uint32_t)bit_off) & ((cap_w << 5) - 1u);
  uint32_t wi = pos >> 5;
  int32_t bo = (int32_t)(pos & 31u);
  const uint32_t *buf = ch->buf;
  if (bo + w <= 32) {
    return (buf[wi] >> (32 - bo - w)) & ktvm_mask32(w);
  }
  int32_t hi = 32 - bo;
  int32_t lo = w - hi;
  uint32_t w1 = (wi + 1u) & (cap_w - 1u);
  return ((buf[wi] & ktvm_mask32(hi)) << lo) | (buf[w1] >> (32 - lo));
}

static inline uint32_t ktvm_bd_peek_bits_at(const KtvmChan *ch, int32_t bit_off, int32_t w) {
  if (w <= 30) return ktvm_bd_peek_small_at(ch, bit_off, w);
  int32_t hi_w = w - 16;
  return (ktvm_bd_peek_small_at(ch, bit_off, hi_w) << 16) | ktvm_bd_peek_small_at(ch, bit_off + hi_w, 16);
}

static inline uint32_t ktvm_bd_shift_bits(KtvmChan *ch, int32_t w) {
  if (w <= 0) return 0u;
  uint32_t val = ktvm_bd_peek_bits_at(ch, 0, w);
  ch->head = (int32_t)(((uint32_t)ch->head + (uint32_t)w) & (((uint32_t)ch->cap_words << 5) - 1u));
  ch->len -= w;
  return val;
}

static void ktvm_bd_push_from_deque(KtvmRuntime *rt, KtvmChan *dst, KtvmChan *src) {
  if (src->len <= 0) return;
  if (dst->len + src->len > (dst->cap_words << 5)) {
    ktvm_bd_grow(rt, dst, dst->len + src->len);
    if (rt->error_code) return;
  }
  while (src->len > 0) {
    int32_t chunk = src->len > 30 ? 30 : src->len;
    uint32_t bits = ktvm_bd_shift_bits(src, chunk);
    ktvm_bd_push_small(rt, dst, bits, chunk);
  }
}

static void ktvm_bd_unshift_from_deque(KtvmRuntime *rt, KtvmChan *dst, KtvmChan *src) {
  int32_t rem = src->len;
  if (rem <= 0) return;
  if (dst->len + rem > (dst->cap_words << 5)) {
    ktvm_bd_grow(rt, dst, dst->len + rem);
    if (rt->error_code) return;
  }
  while (rem > 0) {
    int32_t chunk = rem > 30 ? 30 : rem;
    uint32_t bits = ktvm_bd_peek_small_at(src, rem - chunk, chunk);
    ktvm_bd_unshift_small(rt, dst, bits, chunk);
    rem -= chunk;
  }
  src->head = 0;
  src->len = 0;
}

static inline void ktvm_bd_adopt_buffer(KtvmRuntime *rt, KtvmChan *dst, KtvmChan *src) {
  if (dst->cap_words > 0) {
    ktvm_quota_add_bytes(rt, -(dst->cap_words << 2));
    if (dst->buf && dst->buf != dst->inline_buf) {
      ktvm_free(rt, dst->buf);
    }
  }
  if (src->buf == src->inline_buf) {
    dst->buf = dst->inline_buf;
    memcpy(dst->inline_buf, src->inline_buf, 16);
  } else {
    dst->buf = src->buf;
  }
  dst->cap_words = src->cap_words;
  dst->head = src->head;
  dst->len = src->len;
  src->buf = NULL;
  src->cap_words = 0;
  src->head = 0;
  src->len = 0;
}

/* =========================================================================
 * 4. BitStack ADT
 * ========================================================================= */

static inline KtvmBitStack *ktvm_bs_alloc(KtvmRuntime *rt) {
  KtvmBitStack *st = (KtvmBitStack *)ktvm_alloc(rt, sizeof(KtvmBitStack));
  if (!st) return NULL;
  st->buf = st->inline_buf;
  st->cap_words = 4;
  ktvm_quota_add_bytes(rt, 16);
  return st;
}

static inline void ktvm_bs_release(KtvmRuntime *rt, KtvmBitStack *st) {
  if (!st || st->released) return;
  st->released = 1;
  if (st->cap_words > 0) {
    ktvm_quota_add_bytes(rt, -(st->cap_words << 2));
    if (st->buf && st->buf != st->inline_buf) ktvm_free(rt, st->buf);
  }
  st->buf = NULL;
  st->cap_words = 0;
  st->len_bits = 0;
}

static inline void ktvm_bs_clear(KtvmBitStack *st) {
  st->len_bits = 0;
}

static void ktvm_bs_grow(KtvmRuntime *rt, KtvmBitStack *st, int32_t min_bits) {
  int32_t old_w = st->cap_words;
  int32_t new_w = old_w << 1;
  if (new_w < 8) new_w = 8;
  while ((new_w << 5) < min_bits) new_w <<= 1;
  uint32_t *nb = (uint32_t *)ktvm_alloc(rt, (size_t)new_w * 4u);
  if (!nb) return;
  ktvm_quota_add_bytes(rt, (new_w - old_w) << 2);
  uint32_t *ob = st->buf;
  memcpy(nb, ob, (size_t)old_w * 4u);
  if (ob && ob != st->inline_buf) ktvm_free(rt, ob);
  st->buf = nb;
  st->cap_words = new_w;
}

static inline void ktvm_bs_push(KtvmRuntime *rt, KtvmBitStack *st, uint32_t val, int32_t w) {
  if (w <= 0) return;
  if (st->len_bits + w > (st->cap_words << 5)) {
    ktvm_bs_grow(rt, st, st->len_bits + w);
    if (rt->error_code) return;
  }
  uint32_t pos = (uint32_t)st->len_bits;
  uint32_t wi = pos >> 5;
  int32_t bo = (int32_t)(pos & 31u);
  uint32_t v = val & ktvm_mask32(w);
  if (bo + w <= 32) {
    st->buf[wi] = (st->buf[wi] & ~(ktvm_mask32(w) << bo)) | (v << bo);
  } else {
    int32_t lo = 32 - bo;
    int32_t hi = w - lo;
    st->buf[wi] = (st->buf[wi] & ~(ktvm_mask32(lo) << bo)) | ((v & ktvm_mask32(lo)) << bo);
    st->buf[wi + 1u] = (st->buf[wi + 1u] & ~ktvm_mask32(hi)) | (v >> lo);
  }
  st->len_bits += w;
}

static inline uint32_t ktvm_bs_peek_top(const KtvmBitStack *st, int32_t w) {
  if (w <= 0 || st->len_bits < w) return 0u;
  uint32_t start = (uint32_t)(st->len_bits - w);
  uint32_t wi = start >> 5;
  int32_t bo = (int32_t)(start & 31u);
  if (bo + w <= 32) return (st->buf[wi] >> bo) & ktvm_mask32(w);
  int32_t lo = 32 - bo;
  int32_t hi = w - lo;
  return ((st->buf[wi] >> bo) & ktvm_mask32(lo)) | ((st->buf[wi + 1u] & ktvm_mask32(hi)) << lo);
}

static inline uint32_t ktvm_bs_pop(KtvmBitStack *st, int32_t w) {
  if (w <= 0) return 0u;
  uint32_t v = ktvm_bs_peek_top(st, w);
  st->len_bits -= w;
  return v;
}

/* =========================================================================
 * 5. Resumable 1-State DPDA (Skip / Copy / Coerce)
 * ========================================================================= */

static KtvmDpda *ktvm_dpda_alloc(KtvmRuntime *rt, int32_t kind, int32_t s0, int32_t s1) {
  KtvmDpda *d = (KtvmDpda *)ktvm_alloc_raw(rt, sizeof(KtvmDpda));
  if (!d) return NULL;
  d->kind = kind;
  d->cap = (kind == 2) ? 12 : 24;
  d->len = 1;
  d->done = 0;
  d->stk = d->inline_stk;
  if (kind == 2) {
    d->stk[0] = s0;
    d->stk[1] = s1;
  } else {
    d->stk[0] = s0;
  }
  return d;
}

static inline void ktvm_dpda_free(KtvmRuntime *rt, KtvmDpda *d) {
  if (!d) return;
  if (d->stk && d->stk != d->inline_stk) ktvm_free(rt, d->stk);
  ktvm_free(rt, d);
}

static int ktvm_dpda_grow1(KtvmRuntime *rt, KtvmDpda *d, int32_t min_cap) {
  int32_t nc = d->cap << 1;
  if (nc < 64) nc = 64;
  while (nc < min_cap) nc <<= 1;
  int32_t *ns = (int32_t *)ktvm_alloc_raw(rt, (size_t)nc * 4u);
  if (!ns) return 0;
  memcpy(ns, d->stk, (size_t)d->len * 4u);
  if (d->stk != d->inline_stk) ktvm_free(rt, d->stk);
  d->stk = ns;
  d->cap = nc;
  return 1;
}

static int ktvm_dpda_grow2(KtvmRuntime *rt, KtvmDpda *d, int32_t min_cap) {
  int32_t nc = d->cap << 1;
  if (nc < 32) nc = 32;
  while (nc < min_cap) nc <<= 1;
  int32_t *ns = (int32_t *)ktvm_alloc_raw(rt, (size_t)nc * 8u);
  if (!ns) return 0;
  memcpy(ns, d->stk, (size_t)d->len * 8u);
  if (d->stk != d->inline_stk) ktvm_free(rt, d->stk);
  d->stk = ns;
  d->cap = nc;
  return 1;
}

static inline int ktvm_dpda_push2(KtvmRuntime *rt, KtvmDpda *d, int32_t s0, int32_t s1) {
  if (__builtin_expect(d->len >= d->cap, 0)) {
    if (!ktvm_dpda_grow2(rt, d, d->len + 1)) return 0;
  }
  int32_t i = d->len++;
  d->stk[i * 2] = s0;
  d->stk[i * 2 + 1] = s1;
  return 1;
}

/* Returns: 0 = DONE, 1 = NEED_BITS, 2 = FAILED */
static int ktvm_dpda_step_skip_copy(KtvmRuntime *rt, KtvmChan *src, KtvmChan *dst, KtvmDpda *d) {
  const uint32_t *buf = src->buf;
  uint32_t cap_w = (uint32_t)src->cap_words;
  uint32_t bmask = cap_w ? ((cap_w << 5) - 1u) : 0u;
  uint32_t wmask = cap_w ? (cap_w - 1u) : 0u;
  uint32_t pos = (uint32_t)src->head;
  int32_t total_avail = src->len;
  int32_t consumed = 0;

  int32_t *stk = d->stk;
  int32_t dlen = d->len;
  int32_t dcap = d->cap;
  const KtvmSchemaFast *sfast = rt->schema_fast;
  int res = 0;

  while (dlen > 0) {
    int32_t sid = stk[dlen - 1];
    if (sfast) {
      const KtvmSchemaFast *sf = &sfast[sid];
      int32_t fb = sf->fixed_bits;
      if (fb >= 0) {
        if (fb == 0) { dlen--; continue; }
        if (fb > total_avail) { res = 1; break; }
        pos = (pos + (uint32_t)fb) & bmask;
        total_avail -= fb;
        consumed += fb;
        dlen--;
        continue;
      }
      if (sf->is_loop) {
        int32_t lw = sf->loop_w;
        uint32_t lmask = ktvm_mask32(lw);
        uint32_t ned = sf->num_edges;
        while (1) {
          if (lw > total_avail) { res = 1; goto done; }
          uint32_t wi = pos >> 5;
          int32_t bo = (int32_t)(pos & 31u);
          uint32_t ord;
          if (__builtin_expect(bo + lw <= 32, 1)) {
            ord = (buf[wi] >> (32 - bo - lw)) & lmask;
          } else {
            int32_t hi = 32 - bo;
            int32_t lo = lw - hi;
            uint32_t w1 = (wi + 1u) & wmask;
            ord = ((buf[wi] & ktvm_mask32(hi)) << lo) | (buf[w1] >> (32 - lo));
          }
          if (__builtin_expect(ord >= ned, 0)) { res = 2; goto done; }
          int32_t step_bits = lw + sf->edge_skip[ord];
          if (step_bits > total_avail) { res = 1; goto done; }
          pos = (pos + (uint32_t)step_bits) & bmask;
          total_avail -= step_bits;
          consumed += step_bits;
          if (sf->edge_kind[ord]) {
            dlen--;
            break;
          }
        }
        continue;
      }
    }
    const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[sid];
    if (sn->kind == 0) {
      dlen--;
      int32_t ne = sn->num_edges;
      if (ne > 0) {
        if (__builtin_expect(dlen + ne > dcap, 0)) {
          d->len = dlen;
          if (!ktvm_dpda_grow1(rt, d, dlen + ne)) { res = 2; goto done; }
          stk = d->stk;
          dcap = d->cap;
        }
        const KtvmSchemaEdge *ep = &KTVM_SCHEMA_EDGES[sn->edges_off];
        if (sfast) {
          for (int32_t i = ne - 1; i >= 0; i--) {
            int32_t tid = ep[i].target_id;
            if (sfast[tid].fixed_bits != 0) stk[dlen++] = tid;
          }
        } else {
          for (int32_t i = ne - 1; i >= 0; i--) {
            stk[dlen++] = ep[i].target_id;
          }
        }
      }
    } else {
      int32_t w = sn->width;
      uint32_t ord = 0u;
      if (w > 0) {
        if (w > total_avail) { res = 1; break; }
        uint32_t wi = pos >> 5;
        int32_t bo = (int32_t)(pos & 31u);
        if (bo + w <= 32) {
          ord = (buf[wi] >> (32 - bo - w)) & ktvm_mask32(w);
        } else {
          int32_t hi = 32 - bo;
          int32_t lo = w - hi;
          uint32_t w1 = (wi + 1u) & wmask;
          ord = ((buf[wi] & ktvm_mask32(hi)) << lo) | (buf[w1] >> (32 - lo));
        }
        if ((int32_t)ord >= sn->num_edges) { res = 2; break; }
        pos = (pos + (uint32_t)w) & bmask;
        total_avail -= w;
        consumed += w;
      } else if (sn->num_edges <= 0) {
        res = 2; break;
      }
      int32_t tid = KTVM_SCHEMA_EDGES[sn->edges_off + (int32_t)ord].target_id;
      if (sfast && sfast[tid].fixed_bits == 0) {
        dlen--;
      } else {
        stk[dlen - 1] = tid;
      }
    }
  }

done:
  d->len = dlen;
  if (res != 2 && consumed > 0) {
    if (dst) {
      if (dst->len + consumed > (dst->cap_words << 5)) {
        ktvm_bd_grow(rt, dst, dst->len + consumed);
        if (rt->error_code) return 2;
      }
      int32_t rem = consumed;
      while (rem > 0) {
        int32_t c = rem > 30 ? 30 : rem;
        uint32_t bits = ktvm_bd_shift_bits(src, c);
        ktvm_bd_push_small(rt, dst, bits, c);
        if (rt->error_code) return 2;
        rem -= c;
      }
    } else {
      src->head = (int32_t)pos;
      src->len = total_avail;
    }
  }
  return res;
}

static int ktvm_dpda_step_coerce(KtvmRuntime *rt, KtvmChan *src, KtvmChan *dst, KtvmDpda *d) {
  while (d->len > 0) {
    int32_t top = d->len - 1;
    int32_t s_id = d->stk[top * 2];
    int32_t d_id = d->stk[top * 2 + 1];
    const KtvmSchemaNode *ss = &KTVM_SCHEMA_NODES[s_id];
    const KtvmSchemaNode *ds = &KTVM_SCHEMA_NODES[d_id];
    if (ss->kind != ds->kind) return 2;
    if (ss->kind == 0) {
      if (ss->num_edges != ds->num_edges) return 2;
      d->len--;
      const KtvmSchemaEdge *se = &KTVM_SCHEMA_EDGES[ss->edges_off];
      const KtvmSchemaEdge *de = &KTVM_SCHEMA_EDGES[ds->edges_off];
      for (int32_t i = ss->num_edges - 1; i >= 0; i--) {
        if (se[i].tag_id != de[i].tag_id) return 2;
        if (!ktvm_dpda_push2(rt, d, se[i].target_id, de[i].target_id)) return 2;
      }
    } else {
      int32_t sw = ss->width;
      if (sw > 0 && src->len < sw) return 1;
      uint32_t sord = sw > 0 ? ktvm_bd_peek_bits_at(src, 0, sw) : 0u;
      if ((int32_t)sord >= ss->num_edges) return 2;
      const KtvmSchemaEdge *se = &KTVM_SCHEMA_EDGES[ss->edges_off + (int32_t)sord];
      int32_t dord = ktvm_schema_find_tag(d_id, se->tag_id);
      if (dord < 0) return 2;
      if (sw > 0) ktvm_bd_shift_bits(src, sw);
      int32_t dw = ds->width;
      if (dw > 0) {
        ktvm_bd_push_bits(rt, dst, (uint32_t)dord, dw);
        if (rt->error_code) return 2;
      }
      d->stk[top * 2] = se->target_id;
      d->stk[top * 2 + 1] = KTVM_SCHEMA_EDGES[ds->edges_off + dord].target_id;
    }
  }
  return 0;
}

/* =========================================================================
 * 6. Scopes, Nodes, Barriers, Tokens, Reclamation & O(1) Channel Splice
 * ========================================================================= */

static inline void ktvm_try_queue_node(KtvmRuntime *rt, KtvmNode *n) {
  if (n && n->retired == 1 && n->pin_count <= 0) {
    n->retired = 2;
    n->scope_next = rt->dead_nodes;
    rt->dead_nodes = n;
    rt->dead_pending++;
  }
}

static inline void ktvm_node_pin(KtvmNode *n) {
  if (n) n->pin_count++;
}

static inline void ktvm_node_unpin(KtvmRuntime *rt, KtvmNode *n) {
  if (!n) return;
  n->pin_count--;
  if (n->pin_count <= 0 && n->retired == 1) ktvm_try_queue_node(rt, n);
}

static inline void ktvm_scope_unlink_child(KtvmScope *sc) {
  KtvmScope *p = sc->parent;
  if (!p) return;
  if (sc->prev_sibling) sc->prev_sibling->next_sibling = sc->next_sibling;
  else if (p->first_child == sc) p->first_child = sc->next_sibling;
  if (sc->next_sibling) sc->next_sibling->prev_sibling = sc->prev_sibling;
  sc->parent = NULL;
  sc->next_sibling = NULL;
  sc->prev_sibling = NULL;
}

static inline void ktvm_scope_unlink_node(KtvmNode *n) {
  KtvmScope *sc = n->scope;
  if (!sc) return;
  if (n->scope_prev) n->scope_prev->scope_next = n->scope_next;
  else if (sc->first_node == n) sc->first_node = n->scope_next;
  if (n->scope_next) n->scope_next->scope_prev = n->scope_prev;
  n->scope = NULL;
  n->scope_next = NULL;
  n->scope_prev = NULL;
}

static inline void ktvm_bar_unlink_drain(KtvmNode *n) {
  KtvmBarrier *bar = (KtvmBarrier *)n->p1;
  if (!bar) return;
  if (n->bar_prev) n->bar_prev->bar_next = n->bar_next;
  else if (bar->first_drain == n) bar->first_drain = n->bar_next;
  if (n->bar_next) n->bar_next->bar_prev = n->bar_prev;
  n->bar_prev = NULL;
  n->bar_next = NULL;
}

static inline KtvmScope *ktvm_scope_create(KtvmRuntime *rt, KtvmScope *parent) {
  KtvmScope *sc = (KtvmScope *)ktvm_alloc_raw(rt, sizeof(KtvmScope));
  if (!sc) return NULL;
  sc->parent = parent;
  sc->first_child = NULL;
  sc->prev_sibling = NULL;
  sc->first_node = NULL;
  sc->first_chan = NULL;
  sc->destroyed = 0;
  if (parent) {
    KtvmScope *old_first = parent->first_child;
    sc->next_sibling = old_first;
    if (old_first) old_first->prev_sibling = sc;
    parent->first_child = sc;
  } else {
    sc->next_sibling = NULL;
  }
  return sc;
}

static inline KtvmBarrier *ktvm_barrier_alloc(KtvmRuntime *rt) {
  KtvmBarrier *b = (KtvmBarrier *)ktvm_alloc_raw(rt, sizeof(KtvmBarrier));
  if (!b) return NULL;
  b->pending = 0;
  b->failed = 0;
  b->settled = 0;
  b->refs = 0;
  b->first_drain = NULL;
  return b;
}

static inline void ktvm_barrier_add_drain(KtvmBarrier *bar, KtvmNode *n) {
  n->p1 = bar;
  if (!bar) return;
  bar->pending++;
  bar->refs++;
  KtvmNode *old_first = bar->first_drain;
  n->bar_next = old_first;
  if (old_first) old_first->bar_prev = n;
  bar->first_drain = n;
}

static inline void ktvm_barrier_add_gate(KtvmBarrier *bar, KtvmNode *n) {
  n->p0 = bar;
  if (bar) bar->refs++;
}

static inline void ktvm_barrier_unref(KtvmRuntime *rt, KtvmBarrier *bar) {
  if (!bar) return;
  bar->refs--;
  if (bar->refs <= 0) ktvm_free(rt, bar);
}

static inline KtvmToken *ktvm_token_alloc(KtvmRuntime *rt, KtvmChan **outs, int32_t out_count) {
  KtvmToken *tok = (KtvmToken *)ktvm_alloc(rt, sizeof(KtvmToken));
  if (!tok) return NULL;
  tok->refs = 1;
  if (out_count > 0) {
    tok->outs = (KtvmChan **)ktvm_alloc(rt, (size_t)out_count * sizeof(KtvmChan *));
    if (!tok->outs) return NULL;
    for (int32_t i = 0; i < out_count; i++) {
      tok->outs[i] = outs[i];
      ktvm_chan_pin(outs[i]);
    }
  }
  tok->out_count = out_count;
  return tok;
}

static inline void ktvm_spawn_set_after(KtvmNode *n, KtvmToken *tok) {
  n->p1 = tok;
  if (tok) tok->refs++;
}

static inline void ktvm_token_settle(KtvmRuntime *rt, KtvmToken *tok) {
  if (!tok || tok->settled) return;
  tok->settled = 1;
  if (tok->outs) {
    for (int32_t i = 0; i < tok->out_count; i++) ktvm_chan_unpin(rt, tok->outs[i]);
    ktvm_free(rt, tok->outs);
    tok->outs = NULL;
    tok->out_count = 0;
  }
}

static inline void ktvm_token_unref(KtvmRuntime *rt, KtvmToken *tok) {
  if (!tok) return;
  tok->refs--;
  if (tok->refs <= 0) {
    if (tok->outs) {
      for (int32_t i = 0; i < tok->out_count; i++) ktvm_chan_unpin(rt, tok->outs[i]);
      ktvm_free(rt, tok->outs);
      tok->outs = NULL;
      tok->out_count = 0;
    }
    ktvm_free(rt, tok);
  }
}

static inline void ktvm_switch_pin_caps(KtvmNode *n) {
  const KtvmSwitchDesc *desc = (const KtvmSwitchDesc *)n->p0;
  void **cap = (void **)n->p2;
  if (!desc || !desc->cap_kinds || !cap) return;
  for (int32_t i = 0; i < n->a0; i++) {
    uint8_t k = desc->cap_kinds[i];
    if (k == 0) ktvm_chan_pin((KtvmChan *)cap[i]);
    else if (k == 1 && cap[i]) ((KtvmBarrier *)cap[i])->refs++;
    else if (k == 2 && cap[i]) ((KtvmToken *)cap[i])->refs++;
  }
}

static inline void ktvm_spec_init_reps(KtvmRuntime *rt, KtvmNode *n, int32_t in_cnt) {
  KtvmChan **reps = (KtvmChan **)ktvm_alloc(rt, (size_t)(in_cnt > 0 ? in_cnt : 1) * sizeof(KtvmChan *));
  if (!reps) return;
  for (int32_t i = 0; i < in_cnt; i++) {
    reps[i] = ktvm_chan_alloc(rt, NULL, 0);
    ktvm_chan_pin(reps[i]);
  }
  n->p1 = reps;
}

static inline void ktvm_spec_release_rep(KtvmRuntime *rt, KtvmChan **reps, int32_t idx) {
  if (!reps || !reps[idx]) return;
  KtvmChan *rep = reps[idx];
  reps[idx] = NULL;
  ktvm_chan_unpin(rt, rep);
  ktvm_bd_release(rt, rep);
}

static inline void ktvm_spec_free_active(KtvmRuntime *rt, KtvmSpecActive *ac) {
  if (!ac) return;
  if (ac->taps) {
    for (int32_t i = 0; i < ac->num_in; i++) {
      ktvm_chan_unpin(rt, ac->taps[i].orig);
      ktvm_chan_unpin(rt, ac->taps[i].replay);
      ktvm_node_unpin(rt, ac->taps[i].tap);
    }
    ktvm_free(rt, ac->taps);
  }
  if (ac->staged) {
    for (int32_t i = 0; i < ac->num_out; i++) {
      ktvm_chan_unpin(rt, ac->staged[i].staged);
      ktvm_chan_unpin(rt, ac->staged[i].outer);
    }
    ktvm_free(rt, ac->staged);
  }
  ktvm_free(rt, ac);
}

static inline KtvmNode *ktvm_node_alloc(KtvmRuntime *rt, KtvmScope *sc, int32_t kind, int32_t in_cnt, int32_t out_cnt) {
  ktvm_quota_add_node(rt);
  if (__builtin_expect(rt->error_code != 0, 0)) return NULL;
  KtvmNode *n = (KtvmNode *)ktvm_alloc_raw(rt, sizeof(KtvmNode));
  if (__builtin_expect(!n, 0)) return NULL;
  n->kind = kind;
  n->retired = 0;
  n->pin_count = 0;
  n->scope = sc;
  n->scope_prev = NULL;
  n->bar_next = NULL;
  n->bar_prev = NULL;
  n->in_count = in_cnt;
  n->out_count = out_cnt;
  n->a0 = 0; n->a1 = 0; n->a2 = 0; n->a3 = 0;
  n->p0 = NULL; n->p1 = NULL; n->p2 = NULL;
  if (__builtin_expect(in_cnt + out_cnt <= 4, 1)) {
    n->ins = in_cnt > 0 ? n->inline_chans : NULL;
    n->outs = out_cnt > 0 ? (n->inline_chans + in_cnt) : NULL;
  } else {
    n->ins = in_cnt > 0 ? (KtvmChan **)ktvm_alloc_raw(rt, (size_t)in_cnt * sizeof(KtvmChan *)) : NULL;
    n->outs = out_cnt > 0 ? (KtvmChan **)ktvm_alloc_raw(rt, (size_t)out_cnt * sizeof(KtvmChan *)) : NULL;
  }
  if (sc) {
    KtvmNode *old_first = sc->first_node;
    n->scope_next = old_first;
    if (old_first) old_first->scope_prev = n;
    sc->first_node = n;
  } else {
    n->scope_next = NULL;
  }
  return n;
}

static inline void ktvm_node_set_in(KtvmNode *n, int32_t idx, KtvmChan *ch) {
  n->ins[idx] = ch;
  if (ch) {
    ch->consumer = n;
    ktvm_chan_pin(ch);
  }
}

static inline void ktvm_node_set_out(KtvmNode *n, int32_t idx, KtvmChan *ch) {
  n->outs[idx] = ch;
  if (ch) {
    ch->producer = n;
    ktvm_chan_pin(ch);
  }
}

static inline void ktvm_retire_node(KtvmRuntime *rt, KtvmNode *n) {
  if (__builtin_expect(!n || n->retired, 0)) return;
  n->retired = 1;
  ktvm_quota_remove_node(rt);
  if (__builtin_expect(n->kind == NK_KERNEL && n->p1 != NULL, 0)) {
    KtvmKernelState *ks = (KtvmKernelState *)n->p1;
    for (int32_t i = 0; i < ks->num_stacks; i++) ktvm_bs_release(rt, ks->stacks[i]);
    for (int32_t i = 0; i < ks->num_outs; i++) {
      if (ks->unshift_bufs[i]) {
        ktvm_bd_release(rt, ks->unshift_bufs[i]);
        ks->unshift_bufs[i] = NULL;
      }
    }
  }
  for (int32_t i = 0; i < n->in_count; i++) {
    KtvmChan *ch = n->ins[i];
    if (ch && ch->consumer == n) {
      ch->consumer = NULL;
      if (__builtin_expect(ch->status == CHAN_RELEASED, 0)) ktvm_try_queue_chan(rt, ch);
    }
  }
  for (int32_t i = 0; i < n->out_count; i++) {
    KtvmChan *ch = n->outs[i];
    if (ch && ch->producer == n) {
      ch->producer = NULL;
      if (__builtin_expect(ch->status == CHAN_RELEASED, 0)) ktvm_try_queue_chan(rt, ch);
    }
  }
  ktvm_scope_unlink_node(n);
  if (__builtin_expect(n->kind == NK_DRAIN, 0)) ktvm_bar_unlink_drain(n);
  ktvm_try_queue_node(rt, n);
}

static inline void ktvm_chan_unpin_direct(KtvmRuntime *rt, KtvmChan *ch) {
  if (!ch) return;
  ch->pin_count--;
  if (__builtin_expect(ch->pin_count <= 0 && ch->status == CHAN_RELEASED && !ch->producer && !ch->consumer, 0)) {
    ch->status = CHAN_QUEUED;
    ktvm_free(rt, ch);
  }
}

static inline void ktvm_free_node(KtvmRuntime *rt, KtvmNode *n) {
  int heap_chans = (n->in_count + n->out_count > 4);
  if (n->ins) {
    for (int32_t i = 0; i < n->in_count; i++) ktvm_chan_unpin_direct(rt, n->ins[i]);
    if (heap_chans) ktvm_free(rt, n->ins);
  }
  if (n->outs) {
    for (int32_t i = 0; i < n->out_count; i++) ktvm_chan_unpin_direct(rt, n->outs[i]);
    if (heap_chans) ktvm_free(rt, n->outs);
  }
  switch (n->kind) {
    case NK_COERCE:
    case NK_DEMUX:
      ktvm_dpda_free(rt, (KtvmDpda *)n->p0);
      break;
    case NK_DRAIN:
      ktvm_dpda_free(rt, (KtvmDpda *)n->p0);
      ktvm_barrier_unref(rt, (KtvmBarrier *)n->p1);
      break;
    case NK_GATE:
      ktvm_barrier_unref(rt, (KtvmBarrier *)n->p0);
      break;
    case NK_SWITCH: {
      const KtvmSwitchDesc *desc = (const KtvmSwitchDesc *)n->p0;
      void **cap = (void **)n->p2;
      if (desc && desc->cap_kinds && cap) {
        for (int32_t i = 0; i < n->a0; i++) {
          uint8_t k = desc->cap_kinds[i];
          if (k == 0) ktvm_chan_unpin(rt, (KtvmChan *)cap[i]);
          else if (k == 1) ktvm_barrier_unref(rt, (KtvmBarrier *)cap[i]);
          else if (k == 2) ktvm_token_unref(rt, (KtvmToken *)cap[i]);
        }
      }
      if (n->p1) ktvm_free(rt, n->p1);
      if (n->p2) ktvm_free(rt, n->p2);
      break;
    }
    case NK_SPEC: {
      if (n->p2) ktvm_spec_free_active(rt, (KtvmSpecActive *)n->p2);
      KtvmChan **reps = (KtvmChan **)n->p1;
      if (reps) {
        for (int32_t i = 0; i < n->in_count; i++) ktvm_spec_release_rep(rt, reps, i);
        ktvm_free(rt, reps);
      }
      break;
    }
    case NK_SPAWN:
      ktvm_token_unref(rt, (KtvmToken *)n->p1);
      ktvm_token_unref(rt, (KtvmToken *)n->p2);
      break;
    case NK_KERNEL: {
      KtvmKernelState *ks = (KtvmKernelState *)n->p1;
      if (ks) {
        if (ks->regs) ktvm_free(rt, ks->regs);
        if (ks->stacks) {
          for (int32_t i = 0; i < ks->num_stacks; i++) {
            if (ks->stacks[i]) {
              ktvm_bs_release(rt, ks->stacks[i]);
              ktvm_free(rt, ks->stacks[i]);
            }
          }
          ktvm_free(rt, ks->stacks);
        }
        if (ks->unshift_bufs) ktvm_free(rt, ks->unshift_bufs);
        if (ks->temps) ktvm_free(rt, ks->temps);
        if (ks->dpda) ktvm_dpda_free(rt, ks->dpda);
        ktvm_free(rt, ks);
      }
      break;
    }
    default:
      break;
  }
  ktvm_free(rt, n);
}

static void ktvm_flush_dead(KtvmRuntime *rt) {
  rt->dead_pending = 0;
  while (rt->dead_nodes || rt->dead_chans || rt->dead_scopes) {
    while (rt->dead_nodes) {
      KtvmNode *n = rt->dead_nodes;
      rt->dead_nodes = n->scope_next;
      n->scope_next = NULL;
      ktvm_free_node(rt, n);
    }
    while (rt->dead_chans) {
      KtvmChan *ch = rt->dead_chans;
      rt->dead_chans = ch->scope_next;
      ch->scope_next = NULL;
      ktvm_free(rt, ch);
    }
    while (rt->dead_scopes) {
      KtvmScope *sc = rt->dead_scopes;
      rt->dead_scopes = sc->next_sibling;
      sc->next_sibling = NULL;
      ktvm_free(rt, sc);
    }
  }
  rt->dead_pending = 0;
}

static void ktvm_rebind_output(KtvmRuntime *rt, KtvmNode *prod, KtvmChan *old_ch, KtvmChan *new_ch) {
  if (!prod) return;
  for (int32_t i = 0; i < prod->out_count; i++) {
    if (prod->outs[i] == old_ch) {
      ktvm_chan_unpin(rt, old_ch);
      ktvm_chan_pin(new_ch);
      prod->outs[i] = new_ch;
    }
  }
  if (prod->kind == NK_SWITCH && prod->p2) {
    const KtvmSwitchDesc *desc = (const KtvmSwitchDesc *)prod->p0;
    void **cap = (void **)prod->p2;
    for (int32_t i = 0; i < prod->a0; i++) {
      if ((!desc || !desc->cap_kinds || desc->cap_kinds[i] == 0) && cap[i] == (void *)old_ch) {
        ktvm_chan_unpin(rt, old_ch);
        ktvm_chan_pin(new_ch);
        cap[i] = (void *)new_ch;
      }
    }
  }
  if (prod->kind == NK_SPEC && prod->p2) {
    KtvmSpecActive *ac = (KtvmSpecActive *)prod->p2;
    for (int32_t i = 0; i < ac->num_out; i++) {
      if (ac->staged[i].outer == old_ch) {
        ktvm_chan_unpin(rt, old_ch);
        ktvm_chan_pin(new_ch);
        ac->staged[i].outer = new_ch;
      }
    }
  }
  if (prod->kind == NK_SPAWN && prod->p2) {
    KtvmToken *tok = (KtvmToken *)prod->p2;
    for (int32_t i = 0; i < tok->out_count; i++) {
      if (tok->outs[i] == old_ch) {
        ktvm_chan_unpin(rt, old_ch);
        ktvm_chan_pin(new_ch);
        tok->outs[i] = new_ch;
      }
    }
  }
}

static void ktvm_splice(KtvmRuntime *rt, KtvmChan *src, KtvmChan *dst) {
  if (src == dst) return;
  rt->splices++;
  if (src->status == CHAN_FAILED) {
    ktvm_bd_fail(dst);
    src->producer = NULL;
    src->consumer = NULL;
    ktvm_bd_release(rt, src);
    return;
  }
  if (dst->len == 0) {
    ktvm_bd_adopt_buffer(rt, dst, src);
  } else if (src->len > 0) {
    if (dst->len <= src->len) {
      ktvm_bd_unshift_from_deque(rt, src, dst);
      ktvm_bd_adopt_buffer(rt, dst, src);
    } else {
      ktvm_bd_push_from_deque(rt, dst, src);
    }
  }
  dst->prod_schema = src->prod_schema;
  dst->status = src->status;
  KtvmNode *src_prod = src->producer;
  dst->producer = src_prod;
  if (src_prod) ktvm_rebind_output(rt, src_prod, src, dst);
  src->producer = NULL;
  src->consumer = NULL;
  ktvm_bd_release(rt, src);
}

static inline void ktvm_eager_const_wrap(KtvmRuntime *rt, KtvmChan *dst, int32_t tag_id) {
  if (__builtin_expect(rt->error_code != 0, 0)) return;
  int32_t sid = dst->prod_schema;
  const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[sid];
  int32_t ord = ktvm_schema_find_tag(sid, tag_id);
  if (__builtin_expect(ord < 0, 0)) {
    ktvm_bd_fail(dst);
    return;
  }
  if (sn->width > 0) ktvm_bd_push_bits(rt, dst, (uint32_t)ord, sn->width);
  dst->prod_schema = KTVM_SCHEMA_EDGES[sn->edges_off + ord].target_id;
  ktvm_bd_close(dst);
}

static inline void ktvm_eager_wrap(KtvmRuntime *rt, KtvmChan *src, KtvmChan *dst, int32_t tag_id) {
  if (__builtin_expect(rt->error_code != 0, 0)) return;
  int32_t sid = dst->prod_schema;
  const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[sid];
  int32_t ord = ktvm_schema_find_tag(sid, tag_id);
  if (__builtin_expect(ord < 0, 0)) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    return;
  }
  if (sn->width > 0) ktvm_bd_push_bits(rt, dst, (uint32_t)ord, sn->width);
  ktvm_splice(rt, src, dst);
}

static void ktvm_scope_destroy(KtvmRuntime *rt, KtvmScope *root_sc) {
  if (!root_sc || root_sc->destroyed) return;
  int32_t stk_len = 0, ord_len = 0;
  rt->sc_stk[stk_len++] = root_sc;
  while (stk_len > 0) {
    KtvmScope *sc = rt->sc_stk[--stk_len];
    if (sc->destroyed) continue;
    if (ord_len >= rt->sc_cap) {
      rt->sc_cap <<= 1;
      rt->sc_stk = (KtvmScope **)realloc(rt->sc_stk, (size_t)rt->sc_cap * sizeof(KtvmScope *));
      rt->sc_ord = (KtvmScope **)realloc(rt->sc_ord, (size_t)rt->sc_cap * sizeof(KtvmScope *));
    }
    rt->sc_ord[ord_len++] = sc;
    for (KtvmScope *c = sc->first_child; c; c = c->next_sibling) {
      if (stk_len >= rt->sc_cap) {
        rt->sc_cap <<= 1;
        rt->sc_stk = (KtvmScope **)realloc(rt->sc_stk, (size_t)rt->sc_cap * sizeof(KtvmScope *));
        rt->sc_ord = (KtvmScope **)realloc(rt->sc_ord, (size_t)rt->sc_cap * sizeof(KtvmScope *));
      }
      rt->sc_stk[stk_len++] = c;
    }
  }
  for (int32_t i = ord_len - 1; i >= 0; i--) {
    KtvmScope *sc = rt->sc_ord[i];
    if (sc->destroyed) continue;
    sc->destroyed = 1;
    for (KtvmNode *n = sc->first_node; n; ) {
      KtvmNode *next_n = n->scope_next;
      if (n->kind == NK_SPEC && n->p2) {
        KtvmSpecActive *ac = (KtvmSpecActive *)n->p2;
        for (int32_t t = 0; t < ac->num_in; t++) ktvm_retire_node(rt, ac->taps[t].tap);
        n->p2 = NULL;
        ktvm_spec_free_active(rt, ac);
      }
      ktvm_retire_node(rt, n);
      n = next_n;
    }
    for (KtvmChan *ch = sc->first_chan; ch; ) {
      KtvmChan *next_ch = ch->scope_next;
      ch->producer = NULL;
      ch->consumer = NULL;
      ktvm_bd_release(rt, ch);
      ch = next_ch;
    }
    sc->first_node = NULL;
    sc->first_chan = NULL;
    sc->first_child = NULL;
    if (sc->parent) {
      ktvm_scope_unlink_child(sc);
      sc->next_sibling = rt->dead_scopes;
      rt->dead_scopes = sc;
      rt->dead_pending++;
    }
  }
}

static void ktvm_reparent_scope(KtvmScope *child, KtvmScope *new_parent) {
  if (!child || child->destroyed || !new_parent || child->parent == new_parent) return;
  ktvm_scope_unlink_child(child);
  child->parent = new_parent;
  KtvmScope *old_first = new_parent->first_child;
  child->next_sibling = old_first;
  if (old_first) old_first->prev_sibling = child;
  new_parent->first_child = child;
}

static inline KtvmKernelState *ktvm_kernel_state_alloc(
  KtvmRuntime *rt, int32_t in_cnt, int32_t out_cnt,
  int32_t num_regs, int32_t num_stacks, int32_t num_temps, const int32_t *reg_inits
) {
  KtvmKernelState *ks = (KtvmKernelState *)ktvm_alloc(rt, sizeof(KtvmKernelState));
  if (!ks) return NULL;
  ks->num_regs = num_regs;
  ks->num_stacks = num_stacks;
  ks->num_outs = out_cnt;
  ks->live_in_mask = in_cnt >= 32 ? 0xffffffffu : ((1u << (uint32_t)in_cnt) - 1u);
  ks->live_out_mask = out_cnt >= 32 ? 0xffffffffu : ((1u << (uint32_t)out_cnt) - 1u);
  if (num_regs > 0) {
    ks->regs = (int32_t *)ktvm_alloc(rt, (size_t)num_regs * sizeof(int32_t));
    if (reg_inits && ks->regs) memcpy(ks->regs, reg_inits, (size_t)num_regs * sizeof(int32_t));
  }
  if (num_stacks > 0) {
    ks->stacks = (KtvmBitStack **)ktvm_alloc(rt, (size_t)num_stacks * sizeof(KtvmBitStack *));
    for (int32_t i = 0; i < num_stacks; i++) ks->stacks[i] = ktvm_bs_alloc(rt);
  }
  if (out_cnt > 0) ks->unshift_bufs = (KtvmChan **)ktvm_alloc(rt, (size_t)out_cnt * sizeof(KtvmChan *));
  if (num_temps > 0) ks->temps = (uint32_t *)ktvm_alloc(rt, (size_t)num_temps * sizeof(uint32_t));
  return ks;
}

static inline KtvmNode *ktvm_emit_kernel(
  KtvmRuntime *rt, KtvmScope *sc, KtvmKernelFn fn,
  int32_t in_cnt, int32_t out_cnt,
  int32_t num_regs, int32_t num_stacks, int32_t num_temps, const int32_t *reg_inits
) {
  KtvmNode *n = ktvm_node_alloc(rt, sc, NK_KERNEL, in_cnt, out_cnt);
  if (!n) return NULL;
  n->p0 = (void *)fn;
  n->p1 = ktvm_kernel_state_alloc(rt, in_cnt, out_cnt, num_regs, num_stacks, num_temps, reg_inits);
  return n;
}

static inline void ktvm_kernel_unshift_bits(KtvmRuntime *rt, KtvmNode *n, int32_t out_idx, uint32_t bits, int32_t w) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *ub = ks->unshift_bufs[out_idx];
  if (!ub) {
    ub = ktvm_chan_alloc(rt, NULL, 0);
    ks->unshift_bufs[out_idx] = ub;
  }
  ktvm_bd_unshift_bits(rt, ub, bits, w);
}

static inline void ktvm_kernel_flush_unshift(KtvmRuntime *rt, KtvmNode *n, int32_t out_idx) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *ub = ks->unshift_bufs[out_idx];
  if (!ub) return;
  ks->unshift_bufs[out_idx] = NULL;
  if (ub->len > 0) {
    KtvmChan *dst = n->outs[out_idx];
    if (dst->len == 0) ktvm_bd_adopt_buffer(rt, dst, ub);
    else ktvm_bd_push_from_deque(rt, dst, ub);
  }
  ktvm_bd_release(rt, ub);
}

static int ktvm_k_fail(KtvmRuntime *rt, KtvmNode *n) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  for (int32_t i = 0; i < n->out_count; i++) {
    if (ks->live_out_mask & (1u << (uint32_t)i)) ktvm_bd_fail(n->outs[i]);
  }
  for (int32_t i = 0; i < n->in_count; i++) {
    if (ks->live_in_mask & (1u << (uint32_t)i)) {
      if (n->ins[i] && n->ins[i]->consumer == n) n->ins[i]->consumer = NULL;
      ktvm_bd_release(rt, n->ins[i]);
    }
  }
  ks->live_in_mask = 0;
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static inline int ktvm_k_retire(KtvmRuntime *rt, KtvmNode *n) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  if (ks) {
    uint32_t in_mask = ks->live_in_mask;
    ks->live_in_mask = 0;
    for (int32_t i = 0; i < n->in_count; i++) {
      if (in_mask & (1u << (uint32_t)i)) {
        if (n->ins[i] && n->ins[i]->consumer == n) n->ins[i]->consumer = NULL;
        ktvm_bd_release(rt, n->ins[i]);
      }
    }
  }
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_k_drain_guard(KtvmRuntime *rt, KtvmNode *n, int32_t in_idx, int32_t sid) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *ch = n->ins[in_idx];
  if (ch->status == CHAN_FAILED) return 2;
  if (!ks->dpda) {
    ks->dpda = ktvm_dpda_alloc(rt, 0, sid, 0);
    if (!ks->dpda) return 2;
  }
  if (!ks->dpda->done) {
    int res = ktvm_dpda_step_skip_copy(rt, ch, NULL, ks->dpda);
    if (res == 1) {
      if (ch->status == CHAN_OPEN) { rt->need_pull = ch; return 1; }
      return 2;
    }
    if (res == 2) return 2;
    ks->dpda->done = 1;
  }
  if (ch->status == CHAN_OPEN) { rt->need_pull = ch; return 1; }
  if (ch->status == CHAN_FAILED || ch->len > 0) return 2;
  ktvm_dpda_free(rt, ks->dpda);
  ks->dpda = NULL;
  ks->live_in_mask &= ~(1u << (uint32_t)in_idx);
  ch->consumer = NULL;
  ktvm_bd_release(rt, ch);
  return 0;
}

static int ktvm_k_dpda_copy(KtvmRuntime *rt, KtvmNode *n, int32_t in_idx, int32_t out_idx, int32_t sid) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *src = n->ins[in_idx];
  KtvmChan *dst = n->outs[out_idx];
  if (src->status == CHAN_FAILED) return 2;
  if (!ks->dpda) {
    ks->dpda = ktvm_dpda_alloc(rt, 1, sid, 0);
    if (!ks->dpda) return 2;
  }
  int res = ktvm_dpda_step_skip_copy(rt, src, dst, ks->dpda);
  if (res == 1) {
    if (src->status == CHAN_OPEN) { rt->need_pull = src; return 1; }
    return 2;
  }
  if (res == 2) return 2;
  ktvm_dpda_free(rt, ks->dpda);
  ks->dpda = NULL;
  return 0;
}

static int ktvm_k_dpda_coerce(KtvmRuntime *rt, KtvmNode *n, int32_t in_idx, int32_t out_idx, int32_t s_sid, int32_t d_sid) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *src = n->ins[in_idx];
  KtvmChan *dst = n->outs[out_idx];
  if (src->status == CHAN_FAILED) return 2;
  if (!ks->dpda) {
    ks->dpda = ktvm_dpda_alloc(rt, 2, s_sid, d_sid);
    if (!ks->dpda) return 2;
  }
  int res = ktvm_dpda_step_coerce(rt, src, dst, ks->dpda);
  if (res == 1) {
    if (src->status == CHAN_OPEN) { rt->need_pull = src; return 1; }
    return 2;
  }
  if (res == 2) return 2;
  ktvm_dpda_free(rt, ks->dpda);
  ks->dpda = NULL;
  return 0;
}

static inline void ktvm_k_splice(KtvmRuntime *rt, KtvmNode *n, int32_t in_idx, int32_t out_idx) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *src = n->ins[in_idx];
  KtvmChan *dst = n->outs[out_idx];
  ktvm_kernel_flush_unshift(rt, n, out_idx);
  ks->live_in_mask &= ~(1u << (uint32_t)in_idx);
  ks->live_out_mask &= ~(1u << (uint32_t)out_idx);
  if (src->consumer == n) src->consumer = NULL;
  if (dst->producer == n) dst->producer = NULL;
  ktvm_splice(rt, src, dst);
}

static inline void ktvm_k_close(KtvmRuntime *rt, KtvmNode *n, int32_t out_idx) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *dst = n->outs[out_idx];
  ktvm_kernel_flush_unshift(rt, n, out_idx);
  ks->live_out_mask &= ~(1u << (uint32_t)out_idx);
  if (dst->producer == n) dst->producer = NULL;
  ktvm_bd_close(dst);
}

/* =========================================================================
 * 7. Hot-Burst Table Steppers (chunk_table, stack_table, fsm_table)
 * ========================================================================= */

static inline uint32_t ktvm_compress_bits(uint32_t val, int32_t width, uint32_t mask) {
  uint32_t out = 0;
  int32_t bit_pos = 0;
  for (int32_t i = 0; i < width; i++) {
    if ((mask >> i) & 1u) {
      if ((val >> i) & 1u) out |= (1u << bit_pos);
      bit_pos++;
    }
  }
  return out;
}

static inline uint32_t ktvm_load_u32_le(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Returns: 0=stay/yield, 1=need_pull, 2=goto_short, 3=goto_exit(ks->last_exit), 4=fail */
static int ktvm_exec_chunk_table_step(
  KtvmRuntime *rt, KtvmNode *n, const KtvmTableMeta *tm,
  int32_t reg_idx, int32_t in0, int32_t in1, int32_t out0, int32_t out1
) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *ch0 = n->ins[in0];
  KtvmChan *ch1 = (tm->num_in >= 2) ? n->ins[in1] : NULL;
  KtvmChan *o0 = (tm->num_out >= 1) ? n->outs[out0] : NULL;
  KtvmChan *o1 = (tm->num_out >= 2) ? n->outs[out1] : NULL;

  for (int burst = 0; burst < 64; burst++) {
    if (ch0->status == CHAN_FAILED || (ch1 && ch1->status == CHAN_FAILED)) return 4;
    if (ch0->len < tm->raw_bits0) {
      if (ch0->status == CHAN_OPEN) { rt->need_pull = ch0; return 1; }
      return 2;
    }
    if (ch1 && ch1->len < tm->raw_bits1) {
      if (ch1->status == CHAN_OPEN) { rt->need_pull = ch1; return 1; }
      return 2;
    }
    uint32_t r0 = ktvm_bd_peek_bits_at(ch0, 0, tm->raw_bits0);
    if (tm->mask0 >= 0) r0 = ktvm_compress_bits(r0, tm->raw_bits0, (uint32_t)tm->mask0);
    int32_t q = (reg_idx >= 0) ? ks->regs[reg_idx] : 0;
    uint32_t idx = ((uint32_t)q << tm->eff_bits0) | r0;
    if (ch1) {
      uint32_t r1 = ktvm_bd_peek_bits_at(ch1, 0, tm->raw_bits1);
      if (tm->mask1 >= 0) r1 = ktvm_compress_bits(r1, tm->raw_bits1, (uint32_t)tm->mask1);
      idx = (idx << tm->eff_bits1) | r1;
    }
    rt->table_lookups++;
    const uint8_t *e = tm->entries + ((size_t)idx << 4);
    uint8_t kcode = e[0];
    if (kcode == 2) return 2;
    if (kcode == 3) return 4;

    if (e[2] > 0) ktvm_bd_shift_bits(ch0, e[2]);
    if (ch1 && e[3] > 0) ktvm_bd_shift_bits(ch1, e[3]);

    if (o0 && e[4] > 0) {
      uint32_t ew0 = ktvm_load_u32_le(e + 8);
      if (tm->out_mode0) ktvm_kernel_unshift_bits(rt, n, out0, ew0, e[4]);
      else ktvm_bd_push_bits(rt, o0, ew0, e[4]);
      if (rt->error_code) return 4;
    }
    if (o1 && e[5] > 0) {
      uint32_t ew1 = ktvm_load_u32_le(e + 12);
      if (tm->out_mode1) ktvm_kernel_unshift_bits(rt, n, out1, ew1, e[5]);
      else ktvm_bd_push_bits(rt, o1, ew1, e[5]);
      if (rt->error_code) return 4;
    }

    if (kcode == 1) {
      ks->last_exit = e[1];
      return 3;
    }
    if (reg_idx >= 0) ks->regs[reg_idx] = e[1];
    if (o0 && !tm->out_mode0 && o0->len >= 256) return 0;
  }
  return 0;
}

static int ktvm_exec_stack_table_step(
  KtvmRuntime *rt, KtvmNode *n, const KtvmTableMeta *tm,
  int32_t reg_idx, int32_t in0, int32_t stk_idx, int32_t out0
) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *ch0 = n->ins[in0];
  KtvmBitStack *st = ks->stacks[stk_idx];
  KtvmChan *o0 = n->outs[out0];

  for (int burst = 0; burst < 64; burst++) {
    if (ch0->status == CHAN_FAILED) return 4;
    if (ch0->len < tm->raw_bits0) {
      if (ch0->status == CHAN_OPEN) { rt->need_pull = ch0; return 1; }
      return 2;
    }
    uint32_t sb = ktvm_bd_peek_bits_at(ch0, 0, tm->raw_bits0);
    int32_t d = st->len_bits < tm->w_stack ? st->len_bits : tm->w_stack;
    uint32_t st_code = 0;
    if (tm->mask0 == 1) {
      st_code = (uint32_t)d;
    } else if (d > 0) {
      uint32_t top = ktvm_bs_peek_top(st, d);
      st_code = ((1u << d) - 1u) + top;
    }
    int32_t q = (reg_idx >= 0) ? ks->regs[reg_idx] : 0;
    uint32_t idx = ((((uint32_t)q << tm->raw_bits0) | sb) * (uint32_t)tm->stack_stride) + st_code;
    rt->table_lookups++;
    const uint8_t *e = tm->entries + ((size_t)idx << 4);
    uint8_t kcode = e[0];
    if (kcode == 2) return 2;
    if (kcode == 3) return 4;

    if (e[2] > 0) ktvm_bd_shift_bits(ch0, e[2]);
    if (e[3] > 0) ktvm_bs_pop(st, e[3]);
    if (e[4] > 0) {
      ktvm_bs_push(rt, st, ktvm_load_u32_le(e + 8), e[4]);
      if (rt->error_code) return 4;
    }
    if (e[5] > 0) {
      uint32_t ew = ktvm_load_u32_le(e + 12);
      if (tm->out_mode0) ktvm_kernel_unshift_bits(rt, n, out0, ew, e[5]);
      else ktvm_bd_push_bits(rt, o0, ew, e[5]);
      if (rt->error_code) return 4;
    }
    if (kcode == 1) {
      ks->last_exit = e[1];
      return 3;
    }
    if (reg_idx >= 0) ks->regs[reg_idx] = e[1];
    if (!tm->out_mode0 && o0->len >= 256) return 0;
  }
  return 0;
}

static int ktvm_exec_fsm_table_step(
  KtvmRuntime *rt, KtvmNode *n, const KtvmTableMeta *tm,
  int32_t in0, int32_t out0, int32_t out1
) {
  KtvmKernelState *ks = (KtvmKernelState *)n->p1;
  KtvmChan *ch0 = n->ins[in0];
  if (ch0->status == CHAN_FAILED) return 4;
  if (ch0->len < tm->raw_bits0) {
    if (ch0->status == CHAN_OPEN) { rt->need_pull = ch0; return 1; }
    return 2;
  }
  uint32_t idx = ktvm_bd_peek_bits_at(ch0, 0, tm->raw_bits0);
  rt->table_lookups++;
  const uint8_t *e = tm->entries + ((size_t)idx << 4);
  uint8_t kcode = e[0];
  if (kcode == 2) return 2;
  if (kcode == 3) return 4;
  if (e[2] > 0) ktvm_bd_shift_bits(ch0, e[2]);
  if (tm->num_out >= 1 && e[4] > 0) {
    ktvm_bd_push_bits(rt, n->outs[out0], ktvm_load_u32_le(e + 8), e[4]);
    if (rt->error_code) return 4;
  }
  if (tm->num_out >= 2 && e[5] > 0) {
    ktvm_bd_push_bits(rt, n->outs[out1], ktvm_load_u32_le(e + 12), e[5]);
    if (rt->error_code) return 4;
  }
  ks->last_exit = e[1];
  return 3;
}

/* =========================================================================
 * 8. All 15 kTVM Node Steppers
 * ========================================================================= */

static int ktvm_step_const_unit(KtvmRuntime *rt, KtvmNode *n) {
  ktvm_bd_close(n->outs[0]);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_step_splice(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  KtvmChan *dst = n->outs[0];
  ktvm_retire_node(rt, n);
  ktvm_splice(rt, src, dst);
  return STEP_OK;
}

static int ktvm_step_coerce(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  KtvmChan *dst = n->outs[0];
  if (src->status == CHAN_FAILED) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (!n->p0) {
    if (n->a0 == n->a1) {
      ktvm_retire_node(rt, n);
      ktvm_splice(rt, src, dst);
      return STEP_OK;
    }
    n->p0 = ktvm_dpda_alloc(rt, 2, n->a0, n->a1);
    if (!n->p0) return STEP_OK;
  }
  int res = ktvm_dpda_step_coerce(rt, src, dst, (KtvmDpda *)n->p0);
  if (res == 0) {
    ktvm_bd_close(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (res == 2) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (src->status == CHAN_OPEN) { rt->need_pull = src; return STEP_NEED_PULL; }
  ktvm_bd_fail(dst);
  ktvm_bd_release(rt, src);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_step_wrap(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  KtvmChan *dst = n->outs[0];
  int32_t sid = dst->prod_schema;
  const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[sid];
  int32_t ord = ktvm_schema_find_tag(sid, n->a0);
  if (ord < 0) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (sn->width > 0) ktvm_bd_push_bits(rt, dst, (uint32_t)ord, sn->width);
  ktvm_retire_node(rt, n);
  ktvm_splice(rt, src, dst);
  return STEP_OK;
}

static int ktvm_step_match(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  KtvmChan *dst = n->outs[0];
  if (src->status == CHAN_FAILED) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  int32_t sid = src->cons_schema;
  const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[sid];
  if (sn->kind != 1 || sn->num_edges == 0) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  int32_t w = sn->width;
  if (w > 0 && src->len < w) {
    if (src->status == CHAN_OPEN) { rt->need_pull = src; return STEP_NEED_PULL; }
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  uint32_t ord = w > 0 ? ktvm_bd_peek_bits_at(src, 0, w) : 0u;
  if ((int32_t)ord >= sn->num_edges) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  const KtvmSchemaEdge *edge = &KTVM_SCHEMA_EDGES[sn->edges_off + (int32_t)ord];
  if (edge->tag_id != n->a0) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (w > 0) ktvm_bd_shift_bits(src, w);
  src->cons_schema = edge->target_id;
  ktvm_retire_node(rt, n);
  ktvm_splice(rt, src, dst);
  return STEP_OK;
}

static int ktvm_step_demux(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  if (src->status == CHAN_FAILED) {
    for (int32_t i = n->a1; i < n->out_count; i++) ktvm_bd_fail(n->outs[i]);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  /* O(1) same-scope MUX -> DEMUX bundle fusion! */
  if (n->a1 == 0 && !n->p0 && src->len == 0 && src->aligned && src->producer &&
      src->producer->kind == NK_MUX && src->producer->a1 == 0 &&
      src->producer->scope == n->scope && src->producer->in_count == n->out_count &&
      src->cons_schema == src->producer->a0 && n->a0 == src->producer->a0) {
    KtvmNode *mux = src->producer;
    rt->mux_demux_fusions++;
    int32_t cnt = n->out_count;
    KtvmChan **m_ins = mux->ins;
    KtvmChan **d_outs = n->outs;
    ktvm_retire_node(rt, mux);
    ktvm_retire_node(rt, n);
    ktvm_bd_release(rt, src);
    for (int32_t i = 0; i < cnt; i++) ktvm_splice(rt, m_ins[i], d_outs[i]);
    return STEP_OK;
  }
  const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[n->a0];
  const KtvmSchemaEdge *ep = &KTVM_SCHEMA_EDGES[sn->edges_off];
  while (n->a1 < n->out_count) {
    int32_t fi = n->a1;
    KtvmChan *out_ch = n->outs[fi];
    if (fi == n->out_count - 1 && !n->p0) {
      src->cons_schema = ep[fi].target_id;
      ktvm_retire_node(rt, n);
      ktvm_splice(rt, src, out_ch);
      return STEP_OK;
    }
    if (!n->p0) {
      n->p0 = ktvm_dpda_alloc(rt, 1, ep[fi].target_id, 0);
      if (!n->p0) return STEP_OK;
    }
    int res = ktvm_dpda_step_skip_copy(rt, src, out_ch, (KtvmDpda *)n->p0);
    if (res == 0) {
      ktvm_bd_close(out_ch);
      ktvm_dpda_free(rt, (KtvmDpda *)n->p0);
      n->p0 = NULL;
      n->a1 = fi + 1;
      continue;
    }
    if (res == 2) {
      for (int32_t j = fi; j < n->out_count; j++) ktvm_bd_fail(n->outs[j]);
      ktvm_bd_release(rt, src);
      ktvm_retire_node(rt, n);
      return STEP_OK;
    }
    if (src->status == CHAN_OPEN) { rt->need_pull = src; return STEP_NEED_PULL; }
    for (int32_t j = fi; j < n->out_count; j++) ktvm_bd_fail(n->outs[j]);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  ktvm_bd_release(rt, src);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_step_mux(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *dst = n->outs[0];
  /* Zero-copy strict symmetric MUX -> DEMUX fusion:
   * Settle non-tail inputs 0..in_count-2 in-place (preventing O(N^1.585) lazy thunk
   * buildup), then splice all fields in O(1) without DPDA bit-copying! */
  if (n->a1 == 0 && dst->len == 0 && dst->aligned && dst->consumer &&
      dst->consumer->kind == NK_DEMUX && dst->consumer->a1 == 0 &&
      dst->consumer->scope == n->scope &&
      dst->consumer->out_count == n->in_count &&
      dst->cons_schema == n->a0 && dst->consumer->a0 == n->a0 &&
      (n->in_count == 0 || dst->consumer->outs[0]->len == 0)) {
    KtvmNode *demux = dst->consumer;
    for (int32_t i = 0; i < n->in_count - 1; i++) {
      KtvmChan *in_ch = n->ins[i];
      if (in_ch->status == CHAN_OPEN) { rt->need_pull = in_ch; return STEP_NEED_PULL; }
      if (in_ch->status == CHAN_FAILED) {
        ktvm_bd_fail(dst);
        for (int32_t j = 0; j < n->in_count; j++) ktvm_bd_release(rt, n->ins[j]);
        ktvm_retire_node(rt, n);
        return STEP_OK;
      }
    }
    rt->mux_demux_fusions++;
    int32_t cnt = n->in_count;
    KtvmChan **m_ins = n->ins;
    KtvmChan **d_outs = demux->outs;
    ktvm_retire_node(rt, n);
    ktvm_retire_node(rt, demux);
    ktvm_bd_release(rt, dst);
    for (int32_t i = 0; i < cnt; i++) ktvm_splice(rt, m_ins[i], d_outs[i]);
    return STEP_OK;
  }
  while (n->a1 < n->in_count) {
    int32_t fi = n->a1;
    KtvmChan *in_ch = n->ins[fi];
    if (in_ch->status == CHAN_FAILED) {
      ktvm_bd_fail(dst);
      for (int32_t j = fi; j < n->in_count; j++) ktvm_bd_release(rt, n->ins[j]);
      ktvm_retire_node(rt, n);
      return STEP_OK;
    }
    if (fi == n->in_count - 1) {
      ktvm_retire_node(rt, n);
      ktvm_splice(rt, in_ch, dst);
      return STEP_OK;
    }
    if (in_ch->len > 0) ktvm_bd_push_from_deque(rt, dst, in_ch);
    if (in_ch->status == CHAN_OPEN) { rt->need_pull = in_ch; return STEP_NEED_PULL; }
    if (in_ch->status == CHAN_FAILED) {
      ktvm_bd_fail(dst);
      for (int32_t j = fi; j < n->in_count; j++) ktvm_bd_release(rt, n->ins[j]);
      ktvm_retire_node(rt, n);
      return STEP_OK;
    }
    ktvm_bd_release(rt, in_ch);
    n->a1 = fi + 1;
  }
  ktvm_bd_close(dst);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_step_tee(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  int32_t alive_cnt = 0;
  KtvmChan *last_alive = NULL;
  for (int32_t i = 0; i < n->out_count; i++) {
    if (n->outs[i]->status == CHAN_OPEN) {
      alive_cnt++;
      last_alive = n->outs[i];
    }
  }
  if (alive_cnt == 0) {
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (alive_cnt == 1) {
    ktvm_retire_node(rt, n);
    ktvm_splice(rt, src, last_alive);
    return STEP_OK;
  }
  if (src->status == CHAN_FAILED) {
    for (int32_t i = 0; i < n->out_count; i++) {
      if (n->outs[i]->status == CHAN_OPEN) ktvm_bd_fail(n->outs[i]);
    }
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (src->len > 0) {
    while (src->len > 0) {
      int32_t chunk = src->len > 30 ? 30 : src->len;
      uint32_t bits = ktvm_bd_shift_bits(src, chunk);
      for (int32_t i = 0; i < n->out_count; i++) {
        if (n->outs[i]->status == CHAN_OPEN) {
          ktvm_bd_push_small(rt, n->outs[i], bits, chunk);
          if (rt->error_code) return STEP_OK;
        }
      }
    }
  }
  if (src->status == CHAN_OPEN) { rt->need_pull = src; return STEP_NEED_PULL; }
  for (int32_t i = 0; i < n->out_count; i++) {
    if (n->outs[i]->status == CHAN_OPEN) ktvm_bd_close(n->outs[i]);
  }
  ktvm_bd_release(rt, src);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_step_drain(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *src = n->ins[0];
  KtvmBarrier *bar = (KtvmBarrier *)n->p1;
  if (src->status == CHAN_FAILED) {
    if (bar) {
      bar->failed = 1;
      bar->pending--;
      if (bar->pending == 0) bar->settled = 1;
    }
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (!n->p0) {
    n->p0 = ktvm_dpda_alloc(rt, 0, n->a0, 0);
    if (!n->p0) return STEP_OK;
  }
  KtvmDpda *dpda = (KtvmDpda *)n->p0;
  if (!dpda->done) {
    int res = ktvm_dpda_step_skip_copy(rt, src, NULL, dpda);
    if (res == 1) {
      if (src->status == CHAN_OPEN) { rt->need_pull = src; return STEP_NEED_PULL; }
      if (bar) {
        bar->failed = 1;
        bar->pending--;
        if (bar->pending == 0) bar->settled = 1;
      }
      ktvm_bd_release(rt, src);
      ktvm_retire_node(rt, n);
      return STEP_OK;
    }
    if (res == 2) {
      if (bar) {
        bar->failed = 1;
        bar->pending--;
        if (bar->pending == 0) bar->settled = 1;
      }
      ktvm_bd_release(rt, src);
      ktvm_retire_node(rt, n);
      return STEP_OK;
    }
    dpda->done = 1;
  }
  /* Strictly wait until upstream channel reaches CLOSED/FAILED (critical for 0-bit unit channels!) */
  if (src->status == CHAN_OPEN) {
    rt->need_pull = src;
    return STEP_NEED_PULL;
  }
  if (src->status == CHAN_FAILED || src->len > 0) {
    if (bar) {
      bar->failed = 1;
      bar->pending--;
      if (bar->pending == 0) bar->settled = 1;
    }
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (bar) {
    bar->pending--;
    if (bar->pending == 0) bar->settled = 1;
  }
  ktvm_bd_release(rt, src);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static int ktvm_step_gate(KtvmRuntime *rt, KtvmNode *n) {
  KtvmBarrier *bar = (KtvmBarrier *)n->p0;
  KtvmChan *src = n->ins[0];
  KtvmChan *dst = n->outs[0];
  if (bar->failed) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (!bar->settled) {
    for (KtvmNode *dn = bar->first_drain; dn; dn = dn->bar_next) {
      if (!dn->retired) {
        rt->need_step_node = dn;
        return STEP_NEED_NODE;
      }
    }
    bar->settled = 1;
  }
  if (bar->failed) {
    ktvm_bd_fail(dst);
    ktvm_bd_release(rt, src);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  ktvm_retire_node(rt, n);
  ktvm_splice(rt, src, dst);
  return STEP_OK;
}

static void ktvm_fail_switch(KtvmRuntime *rt, KtvmNode *n) {
  int32_t out_cnt = n->out_count, in_cnt = n->in_count;
  KtvmChan **outs = n->outs, **ins = n->ins;
  ktvm_retire_node(rt, n);
  for (int32_t i = 0; i < out_cnt; i++) ktvm_bd_fail(outs[i]);
  for (int32_t i = 0; i < in_cnt; i++) ktvm_bd_release(rt, ins[i]);
}

static int ktvm_step_switch(KtvmRuntime *rt, KtvmNode *n) {
  const KtvmSwitchDesc *desc = (const KtvmSwitchDesc *)n->p0;
  KtvmChan **insp = (KtvmChan **)n->p1;
  void **env = (void **)n->p2;
  int32_t tags[32];

  for (int32_t j = 0; j < desc->num_inspect; j++) {
    if (!(desc->tested_mask & (1u << (uint32_t)j))) { tags[j] = -1; continue; }
    KtvmChan *ch = insp[j];
    if (ch->status == CHAN_FAILED) { ktvm_fail_switch(rt, n); return STEP_OK; }
    const KtvmSchemaNode *sn = &KTVM_SCHEMA_NODES[ch->cons_schema];
    if (sn->kind != 1 || sn->num_edges == 0) { ktvm_fail_switch(rt, n); return STEP_OK; }
    int32_t w = sn->width;
    if (w > 0 && ch->len < w) {
      if (ch->status == CHAN_OPEN) { rt->need_pull = ch; return STEP_NEED_PULL; }
      ktvm_fail_switch(rt, n);
      return STEP_OK;
    }
    uint32_t ord = w > 0 ? ktvm_bd_peek_bits_at(ch, 0, w) : 0u;
    if ((int32_t)ord >= sn->num_edges) { ktvm_fail_switch(rt, n); return STEP_OK; }
    tags[j] = KTVM_SCHEMA_EDGES[sn->edges_off + (int32_t)ord].tag_id;
  }

  KtvmBlockFn chosen = NULL;
  for (int32_t a = 0; a < desc->num_arms; a++) {
    int ok = 1;
    for (int32_t j = 0; j < desc->num_inspect; j++) {
      int32_t pt = desc->arms[a].patterns[j];
      if (pt >= 0 && tags[j] != pt) { ok = 0; break; }
    }
    if (ok) { chosen = desc->arms[a].fn; break; }
  }
  if (!chosen) chosen = desc->default_fn;
  if (!chosen) { ktvm_fail_switch(rt, n); return STEP_OK; }

  KtvmScope *sc = n->scope;
  ktvm_retire_node(rt, n);
  chosen(rt, sc, env);
  return STEP_OK;
}

static int ktvm_step_tap(KtvmRuntime *rt, KtvmNode *n) {
  KtvmChan *orig = (KtvmChan *)n->p0;
  KtvmChan *rep = (KtvmChan *)n->p1;
  KtvmChan *dst = n->outs[0];
  int32_t cursor = n->a0;

  if (cursor < rep->len) {
    int32_t rem = rep->len - cursor;
    while (rem > 0) {
      int32_t chunk = rem > 30 ? 30 : rem;
      uint32_t bits = ktvm_bd_peek_bits_at(rep, cursor, chunk);
      ktvm_bd_push_small(rt, dst, bits, chunk);
      if (rt->error_code) return STEP_OK;
      cursor += chunk;
      rem -= chunk;
    }
    n->a0 = cursor;
    return STEP_OK;
  }
  if (orig->status == CHAN_FAILED) {
    ktvm_bd_fail(dst);
    ktvm_retire_node(rt, n);
    return STEP_OK;
  }
  if (orig->len > 0) {
    while (orig->len > 0) {
      int32_t chunk = orig->len > 30 ? 30 : orig->len;
      uint32_t bits = ktvm_bd_shift_bits(orig, chunk);
      ktvm_bd_push_small(rt, rep, bits, chunk);
      ktvm_bd_push_small(rt, dst, bits, chunk);
      if (rt->error_code) return STEP_OK;
    }
    n->a0 = rep->len;
    return STEP_OK;
  }
  if (orig->status == CHAN_OPEN) { rt->need_pull = orig; return STEP_NEED_PULL; }
  ktvm_bd_close(dst);
  ktvm_retire_node(rt, n);
  return STEP_OK;
}

static void ktvm_fail_spec(KtvmRuntime *rt, KtvmNode *n) {
  int32_t out_cnt = n->out_count, in_cnt = n->in_count;
  KtvmChan **outs = n->outs, **ins = n->ins;
  KtvmChan **reps = (KtvmChan **)n->p1;
  ktvm_retire_node(rt, n);
  for (int32_t i = 0; i < out_cnt; i++) ktvm_bd_fail(outs[i]);
  for (int32_t i = 0; i < in_cnt; i++) {
    ktvm_bd_release(rt, ins[i]);
    ktvm_spec_release_rep(rt, reps, i);
  }
}

static void ktvm_start_spec_branch(KtvmRuntime *rt, KtvmNode *n, int32_t b_idx) {
  const KtvmSpecDesc *desc = (const KtvmSpecDesc *)n->p0;
  KtvmChan **reps = (KtvmChan **)n->p1;
  int32_t in_cnt = desc->num_in, out_cnt = desc->num_out;
  KtvmBlockFn bfn = desc->branch_fns[b_idx];

  /* Last-branch O(1) tail splice! */
  if (b_idx == desc->num_branches - 1) {
    rt->spec_tail_splices++;
    void *stack_env[32];
    int32_t total = in_cnt + out_cnt;
    void **env = total <= 32 ? stack_env : (void **)ktvm_alloc(rt, (size_t)total * sizeof(void *));
    if (!env) return;
    for (int32_t i = 0; i < in_cnt; i++) {
      KtvmChan *orig = n->ins[i];
      KtvmChan *rep = reps[i];
      if (rep && rep->len > 0) ktvm_bd_unshift_from_deque(rt, orig, rep);
      ktvm_spec_release_rep(rt, reps, i);
      env[i] = orig;
    }
    for (int32_t i = 0; i < out_cnt; i++) env[in_cnt + i] = n->outs[i];
    KtvmScope *sc = n->scope;
    ktvm_retire_node(rt, n);
    bfn(rt, sc, env);
    if (env != stack_env) ktvm_free(rt, env);
    return;
  }

  KtvmScope *br_sc = ktvm_scope_create(rt, n->scope);
  KtvmSpecActive *ac = (KtvmSpecActive *)ktvm_alloc(rt, sizeof(KtvmSpecActive));
  ac->scope = br_sc;
  ac->branch_idx = b_idx;
  ac->num_in = in_cnt;
  ac->num_out = out_cnt;
  ac->taps = (KtvmTapRec *)ktvm_alloc(rt, (size_t)(in_cnt > 0 ? in_cnt : 1) * sizeof(KtvmTapRec));
  ac->staged = (KtvmStagedRec *)ktvm_alloc(rt, (size_t)(out_cnt > 0 ? out_cnt : 1) * sizeof(KtvmStagedRec));
  void *stack_env[32];
  int32_t total = in_cnt + out_cnt;
  void **env = total <= 32 ? stack_env : (void **)ktvm_alloc(rt, (size_t)total * sizeof(void *));

  for (int32_t i = 0; i < in_cnt; i++) {
    KtvmChan *orig = n->ins[i];
    KtvmChan *rep = reps[i];
    KtvmChan *tap_out = ktvm_chan_alloc(rt, br_sc, orig->cons_schema);
    KtvmNode *tap = ktvm_node_alloc(rt, br_sc, NK_TAP, 0, 1);
    tap->p0 = orig;
    tap->p1 = rep;
    ktvm_node_set_out(tap, 0, tap_out);
    ktvm_chan_pin(orig);
    ktvm_chan_pin(rep);
    ktvm_node_pin(tap);
    ac->taps[i].orig = orig;
    ac->taps[i].replay = rep;
    ac->taps[i].tap = tap;
    env[i] = tap_out;
  }
  for (int32_t i = 0; i < out_cnt; i++) {
    KtvmChan *outer = n->outs[i];
    KtvmChan *st = ktvm_chan_alloc(rt, br_sc, outer->prod_schema);
    ktvm_chan_pin(st);
    ktvm_chan_pin(outer);
    ac->staged[i].staged = st;
    ac->staged[i].outer = outer;
    env[in_cnt + i] = st;
  }
  n->p2 = ac;
  bfn(rt, br_sc, env);
  if (env != stack_env) ktvm_free(rt, env);
}

static int ktvm_step_spec(KtvmRuntime *rt, KtvmNode *n) {
  const KtvmSpecDesc *desc = (const KtvmSpecDesc *)n->p0;
  KtvmChan **reps = (KtvmChan **)n->p1;
  if (!n->p2) {
    if (desc->num_branches == 0) { ktvm_fail_spec(rt, n); return STEP_OK; }
    ktvm_start_spec_branch(rt, n, 0);
    return STEP_OK;
  }
  KtvmSpecActive *ac = (KtvmSpecActive *)n->p2;

  /* Rule 1: Upstream input failure aborts immediately without trying next branch */
  for (int32_t i = 0; i < ac->num_in; i++) {
    if (ac->taps[i].orig->status == CHAN_FAILED) {
      rt->spec_upstream_aborts++;
      n->p2 = NULL;
      ktvm_scope_destroy(rt, ac->scope);
      ktvm_spec_free_active(rt, ac);
      ktvm_fail_spec(rt, n);
      return STEP_OK;
    }
  }

  /* Rule 2: Local branch failure -> rollback & advance to next branch */
  int any_failed = 0, all_closed = 1;
  for (int32_t i = 0; i < ac->num_out; i++) {
    int32_t st = ac->staged[i].staged->status;
    if (st == CHAN_FAILED) { any_failed = 1; break; }
    if (st == CHAN_OPEN) all_closed = 0;
  }
  if (any_failed) {
    int32_t next_b = ac->branch_idx + 1;
    n->p2 = NULL;
    ktvm_scope_destroy(rt, ac->scope);
    ktvm_spec_free_active(rt, ac);
    rt->spec_rollbacks++;
    if (next_b >= desc->num_branches) {
      ktvm_fail_spec(rt, n);
    } else {
      ktvm_start_spec_branch(rt, n, next_b);
    }
    return STEP_OK;
  }

  /* Rule 3: All staged outputs CLOSED -> commit & splice! */
  if (all_closed) {
    n->p2 = NULL;
    KtvmScope *br_sc = ac->scope;
    KtvmScope *parent_sc = n->scope;
    ktvm_retire_node(rt, n);
    for (int32_t i = 0; i < ac->num_in; i++) {
      KtvmNode *tap = ac->taps[i].tap;
      KtvmChan *orig = ac->taps[i].orig;
      KtvmChan *rep = ac->taps[i].replay;
      if (!tap->retired) {
        KtvmChan *tap_out = tap->outs[0];
        int32_t cursor = tap->a0;
        if (cursor < rep->len) {
          int32_t rem = rep->len - cursor;
          while (rem > 0) {
            int32_t chunk = rem > 30 ? 30 : rem;
            uint32_t bits = ktvm_bd_peek_bits_at(rep, cursor, chunk);
            ktvm_bd_push_small(rt, tap_out, bits, chunk);
            cursor += chunk;
            rem -= chunk;
          }
        }
        ktvm_retire_node(rt, tap);
        ktvm_splice(rt, orig, tap_out);
      } else {
        ktvm_bd_release(rt, orig);
      }
      ktvm_spec_release_rep(rt, reps, i);
    }
    for (int32_t i = 0; i < ac->num_out; i++) {
      ktvm_scope_unlink_chan(ac->staged[i].staged);
      ktvm_splice(rt, ac->staged[i].staged, ac->staged[i].outer);
    }
    for (KtvmScope *c = br_sc->first_child; c; ) {
      KtvmScope *nxt = c->next_sibling;
      ktvm_reparent_scope(c, parent_sc);
      c = nxt;
    }
    ktvm_scope_destroy(rt, br_sc);
    ktvm_spec_free_active(rt, ac);
    return STEP_OK;
  }

  /* Pull first open staged output */
  for (int32_t i = 0; i < ac->num_out; i++) {
    if (ac->staged[i].staged->status == CHAN_OPEN) {
      rt->need_pull = ac->staged[i].staged;
      return STEP_NEED_PULL;
    }
  }
  return STEP_OK;
}

static int ktvm_step_spawn(KtvmRuntime *rt, KtvmNode *n) {
  KtvmToken *after_tok = (KtvmToken *)n->p1;
  if (after_tok && !after_tok->settled) {
    int all_done = 1;
    for (int32_t i = 0; i < after_tok->out_count; i++) {
      KtvmChan *ch = after_tok->outs[i];
      if (ch->status == CHAN_OPEN) {
        all_done = 0;
        rt->need_pull = ch;
        return STEP_NEED_PULL;
      }
    }
    if (all_done) {
      ktvm_token_settle(rt, after_tok);
      rt->after_settlements++;
    }
  }
  KtvmBlockFn fn = (KtvmBlockFn)n->p0;
  int32_t in_cnt = n->in_count, out_cnt = n->out_count;
  void *stack_env[32];
  int32_t total = in_cnt + out_cnt;
  void **env = total <= 32 ? stack_env : (void **)ktvm_alloc(rt, (size_t)total * sizeof(void *));
  if (!env) return STEP_OK;
  for (int32_t i = 0; i < in_cnt; i++) env[i] = n->ins[i];
  for (int32_t i = 0; i < out_cnt; i++) env[in_cnt + i] = n->outs[i];
  KtvmScope *sc = n->scope;
  ktvm_retire_node(rt, n);
  fn(rt, sc, env);
  if (env != stack_env) ktvm_free(rt, env);
  return STEP_OK;
}

static inline int ktvm_step_node(KtvmRuntime *rt, KtvmNode *n) {
  if (!n || n->retired) return STEP_OK;
  if (ktvm_quota_tick_step(rt)) return STEP_OK;
  switch (n->kind) {
    case NK_CONST_UNIT: return ktvm_step_const_unit(rt, n);
    case NK_SPLICE:     return ktvm_step_splice(rt, n);
    case NK_COERCE:     return ktvm_step_coerce(rt, n);
    case NK_WRAP:       return ktvm_step_wrap(rt, n);
    case NK_MATCH:      return ktvm_step_match(rt, n);
    case NK_DEMUX:      return ktvm_step_demux(rt, n);
    case NK_MUX:        return ktvm_step_mux(rt, n);
    case NK_TEE:        return ktvm_step_tee(rt, n);
    case NK_DRAIN:      return ktvm_step_drain(rt, n);
    case NK_GATE:       return ktvm_step_gate(rt, n);
    case NK_SWITCH:     return ktvm_step_switch(rt, n);
    case NK_SPEC:       return ktvm_step_spec(rt, n);
    case NK_TAP:        return ktvm_step_tap(rt, n);
    case NK_SPAWN:      return ktvm_step_spawn(rt, n);
    case NK_KERNEL:     return ((KtvmKernelFn)n->p0)(rt, n);
    default: return STEP_OK;
  }
}

/* =========================================================================
 * 9. Strictly Iterative Demand-Driven Pull Scheduler
 * ========================================================================= */

static inline void ktvm_dstack_push(KtvmRuntime *rt, int32_t kind, void *ptr) {
  if (rt->dstack_len >= rt->dstack_cap) {
    rt->dstack_cap <<= 1;
    rt->dstack = (KtvmDFrame *)realloc(rt->dstack, (size_t)rt->dstack_cap * sizeof(KtvmDFrame));
  }
  if (kind == 0) ktvm_chan_pin((KtvmChan *)ptr);
  else ktvm_node_pin((KtvmNode *)ptr);
  rt->dstack[rt->dstack_len].kind = kind;
  rt->dstack[rt->dstack_len].ptr = ptr;
  rt->dstack_len++;
}

static inline void ktvm_dstack_pop(KtvmRuntime *rt) {
  if (rt->dstack_len <= 0) return;
  rt->dstack_len--;
  KtvmDFrame f = rt->dstack[rt->dstack_len];
  if (f.kind == 0) ktvm_chan_unpin(rt, (KtvmChan *)f.ptr);
  else ktvm_node_unpin(rt, (KtvmNode *)f.ptr);
}

static inline void ktvm_dstack_clear(KtvmRuntime *rt) {
  while (rt->dstack_len > 0) ktvm_dstack_pop(rt);
}

static void ktvm_drive_to_completion(KtvmRuntime *rt, KtvmChan *root_out) {
  while (!rt->error_code && root_out->status == CHAN_OPEN) {
    if (!root_out->producer) {
      rt->error_code = KTVM_ERR_DEADLOCK;
      ktvm_dstack_clear(rt);
      return;
    }
    ktvm_dstack_clear(rt);
    ktvm_dstack_push(rt, 0, root_out);

    while (!rt->error_code && rt->dstack_len > 0) {
      if (__builtin_expect(rt->dead_pending >= 32, 0)) {
        ktvm_flush_dead(rt);
      }

      KtvmDFrame *top = &rt->dstack[rt->dstack_len - 1];
      KtvmNode *target = NULL;
      int32_t top_kind = top->kind;
      void *top_ptr = top->ptr;

      if (top_kind == 0) {
        KtvmChan *ch = (KtvmChan *)top_ptr;
        if (ch->status != CHAN_OPEN || !ch->producer) {
          ktvm_dstack_pop(rt);
          continue;
        }
        target = ch->producer;
      } else {
        KtvmNode *nd = (KtvmNode *)top_ptr;
        if (nd->retired) {
          ktvm_dstack_pop(rt);
          continue;
        }
        target = nd;
      }

      int outcome = ktvm_step_node(rt, target);
      if (rt->error_code) break;

      if (outcome == STEP_NEED_PULL) {
        KtvmChan *pch = rt->need_pull;
        if (pch->status == CHAN_OPEN && !pch->producer) {
          rt->error_code = KTVM_ERR_DEADLOCK;
          ktvm_dstack_clear(rt);
          return;
        }
        ktvm_dstack_push(rt, 0, pch);
        continue;
      }
      if (outcome == STEP_NEED_NODE) {
        ktvm_dstack_push(rt, 1, rt->need_step_node);
        continue;
      }
      if (outcome == STEP_YIELDED) {
        ktvm_dstack_pop(rt);
        continue;
      }

      /* Normal progress */
      if (top_kind == 0) {
        KtvmChan *ch = (KtvmChan *)top_ptr;
        if (ch->status != CHAN_OPEN || (rt->dstack_len > 1 && ch->len > 0)) {
          ktvm_dstack_pop(rt);
        }
      } else {
        KtvmNode *nd = (KtvmNode *)top_ptr;
        if (nd->retired) ktvm_dstack_pop(rt);
      }
    }
  }
  ktvm_dstack_clear(rt);
  if (rt->dead_nodes || rt->dead_chans || rt->dead_scopes) ktvm_flush_dead(rt);
}

/* =========================================================================
 * 10. Wire Framing, Bulk Byte I/O & General Native k-wire Header Verifier
 * ========================================================================= */

static void ktvm_bd_load_bytes_at(KtvmRuntime *rt, KtvmChan *ch, const uint8_t *bytes, int32_t bit_off, int32_t total_bits) {
  if (total_bits > (ch->cap_words << 5)) {
    ktvm_bd_grow(rt, ch, total_bits);
    if (rt->error_code) return;
  }
  int32_t rem = total_bits;
  int32_t pos = bit_off;
  uint32_t acc = 0;
  int32_t acc_w = 0;
  while (rem > 0) {
    int32_t b_idx = pos >> 3;
    int32_t b_off = pos & 7;
    int32_t avail = 8 - b_off;
    int32_t take = rem < avail ? rem : avail;
    uint32_t bits = ((uint32_t)bytes[b_idx] >> (avail - take)) & ktvm_mask32(take);
    acc = (acc << take) | bits;
    acc_w += take;
    pos += take;
    rem -= take;
    if (acc_w >= 24) {
      ktvm_bd_push_small(rt, ch, acc, acc_w);
      acc = 0;
      acc_w = 0;
    }
  }
  if (acc_w > 0) ktvm_bd_push_small(rt, ch, acc, acc_w);
}

static int32_t ktvm_bd_store_padded_bytes(KtvmChan *ch, uint8_t **out_buf_p, size_t *out_cap_p) {
  int32_t n_bytes = (ch->len + 7) >> 3;
  if ((size_t)n_bytes > *out_cap_p) {
    size_t nc = *out_cap_p ? *out_cap_p : 4096u;
    while (nc < (size_t)n_bytes) nc <<= 1;
    uint8_t *nb = (uint8_t *)realloc(*out_buf_p, nc);
    if (!nb) return KTVM_ERR_OUT_CAP;
    *out_buf_p = nb;
    *out_cap_p = nc;
  }
  uint8_t *out = *out_buf_p;
  int32_t i = 0;
  while (ch->len >= 8) {
    out[i++] = (uint8_t)ktvm_bd_shift_bits(ch, 8);
  }
  if (ch->len > 0) {
    int32_t rem = ch->len;
    out[i++] = (uint8_t)(ktvm_bd_shift_bits(ch, rem) << (8 - rem));
  }
  return n_bytes;
}

static inline int ktvm_matches_prefix(const uint8_t *wire, size_t wire_len, const uint8_t *hdr, int32_t hdr_bits) {
  if ((int64_t)wire_len * 8 < (int64_t)hdr_bits) return 0;
  int32_t full = hdr_bits >> 3;
  if (full > 0 && memcmp(wire, hdr, (size_t)full) != 0) return 0;
  int32_t rem = hdr_bits & 7;
  if (rem > 0) {
    uint8_t mask = (uint8_t)(0xffu << (8 - rem));
    if ((wire[full] & mask) != (hdr[full] & mask)) return 0;
  }
  return 1;
}

/* Raw bit-reader for general native k-wire pattern header verification */
typedef struct {
  const uint8_t *bytes;
  int32_t total_bits;
  int32_t pos;
} KtvmBitReader;

static inline int ktvm_br_read(KtvmBitReader *br, int32_t w, uint32_t *out) {
  if (br->pos + w > br->total_bits) return 0;
  uint32_t acc = 0;
  int32_t rem = w;
  while (rem > 0) {
    int32_t bi = br->pos >> 3;
    int32_t bo = br->pos & 7;
    int32_t av = 8 - bo;
    int32_t tk = rem < av ? rem : av;
    acc = (acc << tk) | (((uint32_t)br->bytes[bi] >> (av - tk)) & ktvm_mask32(tk));
    br->pos += tk;
    rem -= tk;
  }
  *out = acc;
  return 1;
}

/* Skip one Unicode string (`CORE_PATTERN_PROPERTY_LIST` state 7) and return bit range */
static int ktvm_br_skip_kstring(KtvmBitReader *br) {
  uint32_t v;
  for (;;) {
    if (!ktvm_br_read(br, 1, &v)) return 0;
    if (v == 1) return 1; /* nil */
    /* char union (6 tags -> 3 bits) */
    if (!ktvm_br_read(br, 3, &v) || v >= 6) return 0;
    switch (v) {
      case 0: /* ascii: 7 bits */
        if (!ktvm_br_read(br, 7, &v)) return 0;
        break;
      case 1: { /* bmp_common: hi(3-bit tag) + payload + lo(8 bits) */
        uint32_t hi;
        if (!ktvm_br_read(br, 3, &hi)) return 0;
        static const int8_t hi_w[8] = { 3, 7, 7, 3, 0, 1, 1, 1 };
        if (hi_w[hi] > 0 && !ktvm_br_read(br, hi_w[hi], &v)) return 0;
        if (!ktvm_br_read(br, 8, &v)) return 0;
        break;
      }
      case 2: { /* bmp_private_use: hi(2-bit tag, 3 tags) + payload + lo(8 bits) */
        uint32_t hi;
        if (!ktvm_br_read(br, 2, &hi) || hi >= 3) return 0;
        static const int8_t p_w[3] = { 4, 3, 0 };
        if (p_w[hi] > 0 && !ktvm_br_read(br, p_w[hi], &v)) return 0;
        if (!ktvm_br_read(br, 8, &v)) return 0;
        break;
      }
      case 3: /* plane0: 11 bits */
        if (!ktvm_br_read(br, 11, &v)) return 0;
        break;
      case 4: /* supplementary_plane1: 16 bits */
        if (!ktvm_br_read(br, 16, &v)) return 0;
        break;
      case 5: { /* supplementary_planes2_16: lo(8) + mid(8) + plane(2-bit tag) */
        uint32_t pl;
        if (!ktvm_br_read(br, 16, &v)) return 0;
        if (!ktvm_br_read(br, 2, &pl)) return 0;
        static const int8_t pl_w[4] = { 1, 2, 3, 0 };
        if (pl_w[pl] > 0 && !ktvm_br_read(br, pl_w[pl], &v)) return 0;
        break;
      }
    }
  }
}

static int ktvm_bit_slice_eq(const uint8_t *a, int32_t a_off, const uint8_t *b, int32_t b_off, int32_t bit_len) {
  int32_t rem = bit_len;
  int32_t pa = a_off, pb = b_off;
  while (rem > 0) {
    int32_t chunk = rem > 24 ? 24 : rem;
    KtvmBitReader ra = { a, pa + chunk, pa };
    KtvmBitReader rb = { b, pb + chunk, pb };
    uint32_t va = 0, vb = 0;
    ktvm_br_read(&ra, chunk, &va);
    ktvm_br_read(&rb, chunk, &vb);
    if (va != vb) return 0;
    pa += chunk;
    pb += chunk;
    rem -= chunk;
  }
  return 1;
}

typedef struct {
  int32_t label_off;
  int32_t label_bits;
  int32_t target;
} KtvmParsedEdge;

typedef struct {
  int32_t kind; /* 0=prod, 1=union, -1=any */
  int32_t edge_off;
  int32_t num_edges;
} KtvmParsedNode;

/*
 * Parse arbitrary k-wire header prefix and prove coinductive equivalence +
 * identical edge ordering against `KTVM_IN_SCHEMA_ID`.
 * Returns `headerBitLen > 0` on match, `KTVM_ERR_SCHEMA` on incompatible schema,
 * or `KTVM_ERR_MALFORMED` on corrupt header.
 */
static int32_t ktvm_parse_and_verify_header(KtvmRuntime *rt, const uint8_t *wire, size_t wire_len) {
  /* 1. Fast path: compile-time accepted headers (canonical + original inputPattern) */
  for (int32_t i = 0; i < KTVM_NUM_ACCEPTED_IN_HEADERS; i++) {
    if (ktvm_matches_prefix(wire, wire_len, KTVM_ACCEPTED_IN_HEADERS[i].bytes, KTVM_ACCEPTED_IN_HEADERS[i].bit_len)) {
      return KTVM_ACCEPTED_IN_HEADERS[i].bit_len;
    }
  }
  /* 2. Runtime verified-header cache */
  for (int32_t i = 0; i < rt->hdr_cache_len; i++) {
    if (ktvm_matches_prefix(wire, wire_len, rt->hdr_cache[i].bytes, rt->hdr_cache[i].bit_len)) {
      return rt->hdr_cache[i].bit_len;
    }
  }

  /* 3. General iterative k-wire pattern header parser */
  KtvmBitReader br = { wire, (int32_t)(wire_len * 8u), 0 };
  int32_t n_cap = 64, n_len = 0;
  int32_t e_cap = 128, e_len = 0;
  KtvmParsedNode *nodes = (KtvmParsedNode *)malloc((size_t)n_cap * sizeof(KtvmParsedNode));
  KtvmParsedEdge *edges = (KtvmParsedEdge *)malloc((size_t)e_cap * sizeof(KtvmParsedEdge));
  int32_t status = KTVM_ERR_MALFORMED;

  uint32_t v;
  for (;;) {
    if (!ktvm_br_read(&br, 1, &v)) goto cleanup;
    if (v == 1) break; /* nil -> end of node list */
    if (!ktvm_br_read(&br, 3, &v) || v >= 5) goto cleanup;
    int32_t nk = (v == 0) ? -1 : ((v == 1 || v == 3) ? 0 : 1);
    int32_t e_start = e_len;
    if (nk >= 0) {
      for (;;) {
        if (!ktvm_br_read(&br, 1, &v)) goto cleanup;
        if (v == 1) break;
        int32_t l_off = br.pos;
        if (!ktvm_br_skip_kstring(&br)) goto cleanup;
        int32_t l_bits = br.pos - l_off;
        /* target: bits[] LSB-first natural index (0=00, 1=01, _=10) */
        int32_t tgt = 0, shift = 0;
        for (;;) {
          if (!ktvm_br_read(&br, 2, &v) || v >= 3) goto cleanup;
          if (v == 2) break;
          if (shift < 30) tgt |= ((int32_t)v << shift);
          shift++;
        }
        if (e_len >= e_cap) {
          e_cap <<= 1;
          edges = (KtvmParsedEdge *)realloc(edges, (size_t)e_cap * sizeof(KtvmParsedEdge));
        }
        edges[e_len].label_off = l_off;
        edges[e_len].label_bits = l_bits;
        edges[e_len].target = tgt;
        e_len++;
      }
    }
    if (n_len >= n_cap) {
      n_cap <<= 1;
      nodes = (KtvmParsedNode *)realloc(nodes, (size_t)n_cap * sizeof(KtvmParsedNode));
    }
    nodes[n_len].kind = nk;
    nodes[n_len].edge_off = e_start;
    nodes[n_len].num_edges = e_len - e_start;
    n_len++;
  }

  int32_t hdr_bits = br.pos;
  if (n_len == 0) goto cleanup;

  /* 4. Coinductive bisimulation equivalence check against KTVM_IN_SCHEMA_ID */
  int32_t S = KTVM_NUM_SCHEMA_NODES;
  uint8_t *vis = (uint8_t *)calloc((size_t)n_len * (size_t)S, 1);
  int32_t q_cap = 256, q_len = 0;
  int32_t *q_p = (int32_t *)malloc((size_t)q_cap * sizeof(int32_t));
  int32_t *q_s = (int32_t *)malloc((size_t)q_cap * sizeof(int32_t));
  q_p[0] = 0;
  q_s[0] = KTVM_IN_SCHEMA_ID;
  q_len = 1;
  vis[0 * S + KTVM_IN_SCHEMA_ID] = 1;

  int equiv = 1;
  while (q_len > 0 && equiv) {
    int32_t pn = q_p[--q_len];
    int32_t sn = q_s[q_len];
    if (pn < 0 || pn >= n_len) { equiv = 0; break; }
    const KtvmParsedNode *pnode = &nodes[pn];
    const KtvmSchemaNode *snode = &KTVM_SCHEMA_NODES[sn];
    if (pnode->kind != snode->kind || pnode->num_edges != snode->num_edges) {
      equiv = 0;
      break;
    }
    for (int32_t i = 0; i < pnode->num_edges; i++) {
      const KtvmParsedEdge *pe = &edges[pnode->edge_off + i];
      const KtvmSchemaEdge *se = &KTVM_SCHEMA_EDGES[snode->edges_off + i];
      const KtvmTagWire *tw = &KTVM_TAG_WIRES[se->tag_id];
      if (pe->label_bits != tw->bit_len ||
          !ktvm_bit_slice_eq(wire, pe->label_off, tw->bytes, 0, tw->bit_len)) {
        equiv = 0;
        break;
      }
      if (pe->target < 0 || pe->target >= n_len) { equiv = 0; break; }
      size_t vidx = (size_t)pe->target * (size_t)S + (size_t)se->target_id;
      if (!vis[vidx]) {
        vis[vidx] = 1;
        if (q_len >= q_cap) {
          q_cap <<= 1;
          q_p = (int32_t *)realloc(q_p, (size_t)q_cap * sizeof(int32_t));
          q_s = (int32_t *)realloc(q_s, (size_t)q_cap * sizeof(int32_t));
        }
        q_p[q_len] = pe->target;
        q_s[q_len] = se->target_id;
        q_len++;
      }
    }
  }
  free(vis);
  free(q_p);
  free(q_s);

  if (!equiv) {
    status = KTVM_ERR_SCHEMA;
    goto cleanup;
  }

  /* Cache verified header prefix */
  if (rt->hdr_cache_len < KTVM_HDR_CACHE_CAP) {
    int32_t h_bytes = (hdr_bits + 7) >> 3;
    uint8_t *copy = (uint8_t *)malloc((size_t)h_bytes);
    if (copy) {
      memcpy(copy, wire, (size_t)h_bytes);
      rt->hdr_cache[rt->hdr_cache_len].bytes = copy;
      rt->hdr_cache[rt->hdr_cache_len].bit_len = hdr_bits;
      rt->hdr_cache_len++;
    }
  }
  status = hdr_bits;

cleanup:
  free(nodes);
  free(edges);
  return status;
}

typedef struct {
  int64_t decode_ns;
  int64_t eval_ns;
  int64_t encode_ns;
} KtvmRunTiming;

static inline int64_t ktvm_now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000000000LL + (int64_t)ts.tv_nsec;
}

static int32_t ktvm_run_wire(
  KtvmRuntime *rt,
  const uint8_t *in_wire, size_t in_len,
  uint8_t **out_buf_p, size_t *out_cap_p,
  KtvmRunTiming *timing
) {
  int64_t t0 = timing ? ktvm_now_ns() : 0;
  ktvm_reset(rt);

  int32_t hdr_bits = ktvm_parse_and_verify_header(rt, in_wire, in_len);
  if (hdr_bits < 0) return hdr_bits;

  KtvmScope *root_sc = ktvm_scope_create(rt, NULL);
  KtvmChan *root_in = ktvm_chan_alloc(rt, root_sc, KTVM_IN_SCHEMA_ID);
  if (rt->error_code) return rt->error_code;

  int32_t payload_bits = (int32_t)(in_len * 8u) - hdr_bits;
  KtvmChan *raw_ch = ktvm_chan_alloc(rt, NULL, KTVM_IN_SCHEMA_ID);
  ktvm_bd_load_bytes_at(rt, raw_ch, in_wire, hdr_bits, payload_bits);
  if (rt->error_code) return rt->error_code;

  KtvmDpda *dpda = ktvm_dpda_alloc(rt, 1, KTVM_IN_SCHEMA_ID, 0);
  int dres = ktvm_dpda_step_skip_copy(rt, raw_ch, root_in, dpda);
  ktvm_dpda_free(rt, dpda);
  if (dres != 0) return KTVM_ERR_MALFORMED;
  if (raw_ch->len >= 8) return KTVM_ERR_MALFORMED;
  if (raw_ch->len > 0 && ktvm_bd_shift_bits(raw_ch, raw_ch->len) != 0) return KTVM_ERR_MALFORMED;
  ktvm_bd_release(rt, raw_ch);
  ktvm_bd_close(root_in);

  KtvmChan *root_out = ktvm_chan_alloc(rt, NULL, KTVM_OUT_SCHEMA_ID);
  if (rt->error_code) return rt->error_code;

  int64_t t1 = timing ? ktvm_now_ns() : 0;
  ktvm_start_entry(rt, root_sc, root_in, root_out);
  if (rt->error_code) return rt->error_code;

  ktvm_drive_to_completion(rt, root_out);
  if (rt->error_code) return rt->error_code;
  int64_t t2 = timing ? ktvm_now_ns() : 0;

  if (root_out->status == CHAN_FAILED) {
    ktvm_scope_destroy(rt, root_sc);
    if (timing) { timing->decode_ns = t1 - t0; timing->eval_ns = t2 - t1; timing->encode_ns = 0; }
    return KTVM_ERR_FAILED;
  }

  KtvmChan *framed = ktvm_chan_alloc(rt, NULL, 0);
  ktvm_bd_load_bytes_at(rt, framed, KTVM_OUT_HDR_BYTES, 0, KTVM_OUT_HDR_BITS);
  ktvm_bd_push_from_deque(rt, framed, root_out);
  int32_t out_len = ktvm_bd_store_padded_bytes(framed, out_buf_p, out_cap_p);
  ktvm_bd_release(rt, framed);
  ktvm_bd_release(rt, root_out);
  ktvm_scope_destroy(rt, root_sc);

  int64_t t3 = timing ? ktvm_now_ns() : 0;
  if (timing) {
    timing->decode_ns = t1 - t0;
    timing->eval_ns = t2 - t1;
    timing->encode_ns = t3 - t2;
  }
  return out_len;
}

/* =========================================================================
 * 11. CLI / Persistent `--server` / `--bench` Driver
 * ========================================================================= */

static int ktvm_read_exact(FILE *f, uint8_t *buf, size_t n) {
  size_t off = 0;
  while (off < n) {
    size_t r = fread(buf + off, 1, n - off, f);
    if (r == 0) return 0;
    off += r;
  }
  return 1;
}

static uint8_t *ktvm_read_all_stdin(size_t *len_out) {
  size_t cap = 4096, len = 0;
  uint8_t *buf = (uint8_t *)malloc(cap);
  if (!buf) return NULL;
  for (;;) {
    if (len == cap) {
      cap <<= 1;
      buf = (uint8_t *)realloc(buf, cap);
      if (!buf) return NULL;
    }
    size_t r = fread(buf + len, 1, cap - len, stdin);
    len += r;
    if (r == 0) break;
  }
  *len_out = len;
  return buf;
}

int main(int argc, char **argv) {
  KtvmRuntime rt;
  ktvm_init(&rt);

  int server_mode = 0;
  int bench_calls = 0;
  int print_telemetry = 0;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--server") == 0) server_mode = 1;
    else if (strcmp(argv[i], "--telemetry") == 0) print_telemetry = 1;
    else if (strcmp(argv[i], "--bench") == 0 && i + 1 < argc) bench_calls = atoi(argv[++i]);
    else if (strcmp(argv[i], "--max-steps") == 0 && i + 1 < argc) rt.max_steps = atoi(argv[++i]);
    else if (strcmp(argv[i], "--max-nodes") == 0 && i + 1 < argc) rt.max_nodes = atoi(argv[++i]);
    else if (strcmp(argv[i], "--max-bytes") == 0 && i + 1 < argc) rt.max_bytes = atoi(argv[++i]);
  }

  uint8_t *out_buf = (uint8_t *)malloc(65536);
  size_t out_cap = 65536;

  if (server_mode) {
    const char *trace_env = getenv("K_TRACE");
    int trace = (trace_env && trace_env[0] == '1');
    uint8_t *in_buf = NULL;
    size_t in_cap = 0;

    for (;;) {
      uint8_t hdr4[4];
      int64_t t_req0 = trace ? ktvm_now_ns() : 0;
      if (!ktvm_read_exact(stdin, hdr4, 4)) break;
      uint32_t in_len = ((uint32_t)hdr4[0] << 24) | ((uint32_t)hdr4[1] << 16) |
                        ((uint32_t)hdr4[2] << 8) | (uint32_t)hdr4[3];
      if ((size_t)in_len > in_cap) {
        in_cap = (size_t)in_len + 4096u;
        in_buf = (uint8_t *)realloc(in_buf, in_cap);
      }
      if (in_len > 0 && !ktvm_read_exact(stdin, in_buf, in_len)) break;
      int64_t t_ipc_in = trace ? ktvm_now_ns() : 0;

      KtvmRunTiming tm = {0, 0, 0};
      int32_t out_len = ktvm_run_wire(&rt, in_buf, in_len, &out_buf, &out_cap, trace ? &tm : NULL);
      if (out_len < 0) {
        fprintf(stderr, "KTVM_ERROR code=%d\n", out_len);
        fflush(stderr);
        free(in_buf);
        free(out_buf);
        ktvm_destroy(&rt);
        return (out_len == KTVM_ERR_FAILED) ? 1 : 2;
      }

      int64_t t_w0 = trace ? ktvm_now_ns() : 0;
      uint8_t ohdr4[4] = {
        (uint8_t)((uint32_t)out_len >> 24),
        (uint8_t)(((uint32_t)out_len >> 16) & 0xffu),
        (uint8_t)(((uint32_t)out_len >> 8) & 0xffu),
        (uint8_t)((uint32_t)out_len & 0xffu)
      };
      fwrite(ohdr4, 1, 4, stdout);
      if (out_len > 0) fwrite(out_buf, 1, (size_t)out_len, stdout);
      fflush(stdout);
      int64_t t_w1 = trace ? ktvm_now_ns() : 0;

      if (trace) {
        int64_t ipc_r = t_ipc_in - t_req0;
        int64_t ipc_w = t_w1 - t_w0;
        int64_t total = t_w1 - t_req0;
        fprintf(stderr,
          "K_TRACE_PHASES backend=ktvm-llvm ipc_read_ns=%lld decode_ns=%lld flat_in_ns=0 eval_ns=%lld flat_out_ns=0 encode_ns=%lld ipc_write_ns=%lld total_ns=%lld\n",
          (long long)ipc_r, (long long)tm.decode_ns, (long long)tm.eval_ns,
          (long long)tm.encode_ns, (long long)ipc_w, (long long)total);
        fflush(stderr);
      }
    }
    free(in_buf);
    free(out_buf);
    ktvm_destroy(&rt);
    return 0;
  }

  size_t in_len = 0;
  uint8_t *in_buf = ktvm_read_all_stdin(&in_len);
  if (!in_buf) return 2;

  if (bench_calls > 0) {
    /* Warmup */
    int32_t chk = ktvm_run_wire(&rt, in_buf, in_len, &out_buf, &out_cap, NULL);
    if (chk < 0) {
      fprintf(stderr, "KTVM_ERROR code=%d\n", chk);
      free(in_buf); free(out_buf); ktvm_destroy(&rt);
      return 2;
    }
    int64_t t0 = ktvm_now_ns();
    for (int c = 0; c < bench_calls; c++) {
      ktvm_run_wire(&rt, in_buf, in_len, &out_buf, &out_cap, NULL);
    }
    int64_t dt = ktvm_now_ns() - t0;
    fprintf(stderr, "K_KTVM_BENCH calls=%d total_ns=%lld per_call_ns=%.2f\n",
            bench_calls, (long long)dt, (double)dt / (double)bench_calls);
    free(in_buf); free(out_buf); ktvm_destroy(&rt);
    return 0;
  }

  int32_t out_len = ktvm_run_wire(&rt, in_buf, in_len, &out_buf, &out_cap, NULL);
  if (print_telemetry) {
    fprintf(stderr,
      "KTVM_TELEMETRY steps=%d peak_nodes=%d peak_bytes=%d table_lookups=%d splices=%d mux_demux_fusions=%d spec_rollbacks=%d spec_upstream_aborts=%d spec_tail_splices=%d after_settlements=%d\n",
      rt.steps, rt.peak_nodes, rt.peak_bytes, rt.table_lookups, rt.splices,
      rt.mux_demux_fusions, rt.spec_rollbacks, rt.spec_upstream_aborts,
      rt.spec_tail_splices, rt.after_settlements);
  }
  if (out_len < 0) {
    fprintf(stderr, "KTVM_ERROR code=%d\n", out_len);
    free(in_buf); free(out_buf); ktvm_destroy(&rt);
    return (out_len == KTVM_ERR_FAILED) ? 1 : 2;
  }
  if (out_len > 0) fwrite(out_buf, 1, (size_t)out_len, stdout);
  fflush(stdout);
  free(in_buf);
  free(out_buf);
  ktvm_destroy(&rt);
  return 0;
}

#endif /* KTVM_RUNTIME_H */
