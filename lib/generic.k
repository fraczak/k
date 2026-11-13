# --lib core.k --use bit[] bits[] list[X] byte[] ascii[] bmp_hi_common[] bmp_hi_private_use[] plane0[] plane_02_10[] unicode[] string[]

-- =============================================================================
-- lib/generic.k -- Reusable Algebraic Types and Generic Utilities
--
-- Depends only on core.k. Provides core ADTs (bool[], order[], opt[V], btrie[V]),
-- linked-list utilities, non-negative bit-path helpers, binary tries, and
-- Unicode string-to-bit-path codecs needed across K standard modules.
--
-- Style conventions used across lib/:
--   * Names ending in '?' are pure identity filters (?X -> ?X: succeed
--     unchanged or fail).
--   * All recursive relations are tail-recursive.
--   * Conditional branches use mutually exclusive patterns so every relation is
--     deterministic and single-valued.
--   * Algebraic bit-strings (bits[]) have MSB at the root and '_' at the leaf.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Booleans, Ordering, and Options
-- -----------------------------------------------------------------------------

bool[] = < {} false, {} true >;

false? = ?X /false |false ?X;
true?  = ?X /true  |true ?X;

order[] = < {} lt, {} eq, {} gt >;

lt? = ?X /lt |lt ?X;
eq? = ?X /eq |eq ?X;
gt? = ?X /gt |gt ?X;

-- Optional values matching the binary-trie wire encoding in codecs/djson.mjs.
opt[V] = < {} nil, V val >;

nil? = ?X /nil |nil ?X;


-- -----------------------------------------------------------------------------
-- 2. Polymorphic Linked Lists (list[X] from core.k)
-- -----------------------------------------------------------------------------

-- Tail-recursively prepends elements of `xs` in reverse order onto `acc`.
rev_append = ?{ list[X] xs, list[X] acc } <
  { .xs /nil _, .acc acc } .acc,
  {
    .xs /cons .cdr xs,
    { .xs /cons .car car, .acc cdr } |cons acc
  } rev_append
> ?list[X];

-- Reverses any list[X] in O(n) time.
reverse = ?list[X] { () xs, {} |nil acc } rev_append ?list[X];


-- -----------------------------------------------------------------------------
-- 3. Bit & Bit-Path Helpers (bit[], bits[] from core.k)
-- -----------------------------------------------------------------------------

eq_bit? = ?{bit[] x, bit[] y} <
  { .x /0 if, .y /0 and, () then } .then,
  { .x /1 if, .y /1 and, () then } .then
>;

-- Matches canonical zero bits[] (_ |0).
zero_bits? = ?bits[] { /0 /_ if, () then} .then;

-- Strips redundant leading '0' tags while keeping at least one bit for zero (_ |0).
trim_bits = ?bits[] <
  /_ |_,
  /1 |1,
  /0 /_ |_ |0,
  /0 trim_bits
> ?bits[];

-- Tail-recursively reverses `in` onto `acc` (moving leaf-ward bits toward root).
bits_rev_step = ?{ bits[] in, bits[] acc } <
  { .in /_ _, .acc acc } .acc,
  <
    { .in /0 in, .acc acc } { .in in, .acc |0 acc },
    { .in /1 in, .acc acc } { .in in, .acc |1 acc }
  > bits_rev_step
> ?bits[];

-- Reverses a bit-path in O(n) time.
rev_bits = ?bits[] { () in, {} |_ acc } bits_rev_step ?bits[];

-- Tail-recursively increments a reversed (LSB-at-root) bit-path into MSB-first.
bits_inc_rev_step = ?{ bits[] in, bit[] c, bits[] acc } <
  { .in /_ _in, .c /0 _c, .acc acc } .acc,
  { .in /_ _in, .c /1 _c, .acc acc } .acc |1,
  <
    { .in /0 in, .c /0 _c, .acc acc } { .in in, {} |0 c, .acc |0 acc },
    { .in /1 in, .c /0 _c, .acc acc } { .in in, {} |0 c, .acc |1 acc },
    { .in /0 in, .c /1 _c, .acc acc } { .in in, {} |0 c, .acc |1 acc },
    { .in /1 in, .c /1 _c, .acc acc } { .in in, {} |1 c, .acc |0 acc }
  > bits_inc_rev_step
> ?bits[];

-- Adds 1 to an unsigned bits[] value (MSB at root, '_' at leaf).
inc_bits = ?bits[] { rev_bits in, {} |1 c, {} |_ acc } bits_inc_rev_step ?bits[];

-- Compares the lengths of two bits[] paths (used by btrie_max_key).
cmp_bits_len = ?{ bits[] x, bits[] y } <
  { .x /_ _x, .y /_ _y } {} |eq,
  { .x /_ _x, .y < /0, /1 > _y } {} |lt,
  { .x < /0, /1 > _x, .y /_ _y } {} |gt,
  { .x < /0, /1 > x, .y < /0, /1 > y } cmp_bits_len
> ?order[];


-- -----------------------------------------------------------------------------
-- 4. Binary Radix Trie (btrie[V])
-- -----------------------------------------------------------------------------

btrie[V] = <
  {} nil,
  { opt[V] val, B 0, B 1 } trie
> = B;

-- Explicit zipper frame and DFS work-stack item for tail-recursive btrie traversals.
btrie_frame[V] = { bit[] dir, opt[V] val, btrie[V] sib };
btrie_task[V] = { bits[] key_rev, btrie[V] node };

-- Empty trie constructor.
btrie_empty = {} |nil;

-- Canonical node packer: collapses empty { nil, nil, nil } nodes back to |nil.
btrie_pack = <
  { .val /nil _, .0 /nil 0, .1 /nil 1 } {} |nil,
  { .val /val val, .0 0, .1 1 } { .val |val val, .0 0, .1 1 } |trie,
  { .val /nil _, .0 /trie 0, .1 1 } { {} |nil val, .0 |trie 0, .1 1 } |trie,
  { .val /nil _, .0 /nil 0, .1 /trie 1 } { {} |nil val, {} |nil 0, .1 |trie 1 } |trie
>;

-- Lookup: { bits[] key, btrie[V] trie } -> V (fails if key is absent).
btrie_get = ?{ bits[] key, btrie[V] trie } { .key key, .trie /trie trie } <
  { .key /_ _, .trie .val /val val } .val,
  <
    { .key /0 key, .trie .0 trie },
    { .key /1 key, .trie .1 trie }
  > btrie_get
>;

-- Wraps a subtrie bottom-up along a reversed bit path inside an otherwise empty trie.
btrie_wrap_rev_step = ?{ bits[] key_rev, btrie[V] acc } <
  { .key_rev /_ _, .acc acc } .acc,
  <
    { .key_rev /0 key_rev, .acc acc } {
      .key_rev key_rev,
      { {} |nil val, .acc 0, {} |nil 1 } |trie acc
    },
    { .key_rev /1 key_rev, .acc acc } {
      .key_rev key_rev,
      { {} |nil val, {} |nil 0, .acc 1 } |trie acc
    }
  > btrie_wrap_rev_step
> ?btrie[V];

-- Insert into an empty trie along `key`.
btrie_set_empty = ?{ bits[] key, V val } {
  .key rev_bits key_rev,
  { .val |val val, {} |nil 0, {} |nil 1 } |trie acc
} btrie_wrap_rev_step ?btrie[V];

-- Rebuilds a btrie[V] bottom-up along a saved zipper stack, pruning empty nodes.
btrie_zip_step = ?{ btrie[V] child, list[btrie_frame[V]] stack } <
  { .stack /nil _, .child child } .child,
  { .stack /cons c, .child child } {
    { .c .car frame, .child child } <
      { .frame .dir /0 _, .frame .val val, .frame .sib s1, .child c0 }
        { .val val, .c0 0, .s1 1 },
      { .frame .dir /1 _, .frame .val val, .frame .sib s0, .child c1 }
        { .val val, .s0 0, .c1 1 }
    > btrie_pack child,
    .c .cdr stack
  } btrie_zip_step
> ?btrie[V];

-- Walks down `trie` along `key`, preparing the updated leaf subtrie and zipper stack.
btrie_set_down = ?{ bits[] key, V val, btrie[V] trie, list[btrie_frame[V]] stack } <
  { .trie /nil _, .key key, .val val, .stack stack } {
    { .key key, .val val } btrie_set_empty child,
    .stack stack
  },
  { .trie /trie trie, .key /_ _, .val val, .stack stack } {
    { .val |val val, .trie .0 0, .trie .1 1 } |trie child,
    .stack stack
  },
  <
    { .trie /trie trie, .key /0 key, .val val, .stack stack } {
      .key key, .val val, .trie .0 trie,
      { { {} |0 dir, .trie .val val, .trie .1 sib } car, .stack cdr } |cons stack
    },
    { .trie /trie trie, .key /1 key, .val val, .stack stack } {
      .key key, .val val, .trie .1 trie,
      { { {} |1 dir, .trie .val val, .trie .0 sib } car, .stack cdr } |cons stack
    }
  > btrie_set_down
> ?{ btrie[V] child, list[btrie_frame[V]] stack };

-- Insert or overwrite: { bits[] key, V val, btrie[V] trie } -> btrie[V].
btrie_set = ?{ bits[] key, V val, btrie[V] trie } {
  .key key, .val val, .trie trie, {} |nil stack
} btrie_set_down btrie_zip_step ?btrie[V];

-- Walks down `trie` along `key`, pruning any target value and recording the zipper.
btrie_del_down = ?{ bits[] key, btrie[V] trie, list[btrie_frame[V]] stack } <
  { .trie /nil _, .stack stack } { {} |nil child, .stack stack },
  { .trie /trie trie, .key /_ _, .stack stack } {
    { {} |nil val, .trie .0 0, .trie .1 1 } btrie_pack child,
    .stack stack
  },
  <
    { .trie /trie trie, .key /0 key, .stack stack } {
      .key key, .trie .0 trie,
      { { {} |0 dir, .trie .val val, .trie .1 sib } car, .stack cdr } |cons stack
    },
    { .trie /trie trie, .key /1 key, .stack stack } {
      .key key, .trie .1 trie,
      { { {} |1 dir, .trie .val val, .trie .0 sib } car, .stack cdr } |cons stack
    }
  > btrie_del_down
> ?{ btrie[V] child, list[btrie_frame[V]] stack };

-- Delete: { bits[] key, btrie[V] trie } -> btrie[V] (pruning empty subtries).
btrie_del = ?{ bits[] key, btrie[V] trie } {
  .key key, .trie trie, {} |nil stack
} btrie_del_down btrie_zip_step ?btrie[V];

-- Pushes non-empty DFS traversal tasks onto the explicit work stack.
btrie_push_task = ?{ btrie_task[V] task, list[btrie_task[V]] stack } <
  { .task .node /nil _, .stack stack } .stack,
  { .task .key_rev key_rev, .task .node /trie t, .stack stack } {
    { .key_rev key_rev, .t |trie node } car,
    .stack cdr
  } |cons
> ?list[btrie_task[V]];

btrie_entries_step = ?{
  list[btrie_task[V]] stack,
  list[{ bits[] key, V val }] acc
} <
  { .stack /nil _, .acc acc } .acc reverse,
  { .stack /cons c, .acc acc } {
    .c .car .key_rev key_rev,
    .c .car .node /trie t,
    .c .cdr stack,
    .acc acc
  } {
    {
      { .key_rev |0 key_rev, .t .0 node } task,
      {
        { .key_rev |1 key_rev, .t .1 node } task,
        .stack stack
      } btrie_push_task stack
    } btrie_push_task stack,
    { .t .val opt_val, .key_rev key_rev, .acc acc } <
      { .opt_val /nil _, .acc acc } .acc,
      { .opt_val /val val, .key_rev key_rev, .acc acc } {
        { .key_rev rev_bits key, .val val } car,
        .acc cdr
      } |cons
    > acc
  } btrie_entries_step
> ?list[{ bits[] key, V val }];

-- Pre-order traversal returning list[{ bits[] key, V val }].
btrie_entries_raw = ?btrie[V] {
  { { {} |_ key_rev, () node } task, {} |nil stack } btrie_push_task stack,
  {} |nil acc
} btrie_entries_step ?list[{ bits[] key, V val }];

-- Keeps whichever reversed key is strictly longer; ties favor the first (1-biased) key.
btrie_pick_longer_rev = ?{ bits[] cand, opt[bits[]] best } <
  { .best /nil _, .cand cand } .cand |val,
  { .best /val b, .cand cand } {
    { .cand x, .b y } cmp_bits_len ord,
    .cand cand,
    .b b
  } <
    { .ord /gt _, .cand c } .c |val,
    { .ord < /lt, /eq > _, .b b } .b |val
  >
> ?opt[bits[]];

btrie_max_key_step = ?{ list[btrie_task[V]] stack, opt[bits[]] best } <
  { .stack /nil _s, .best /nil _b } {} |nil,
  { .stack /nil _s, .best /val b } .b rev_bits |val,
  { .stack /cons c, .best best } {
    .c .car .key_rev key_rev,
    .c .car .node /trie t,
    .c .cdr stack,
    .best best
  } {
    {
      { .key_rev |1 key_rev, .t .1 node } task,
      {
        { .key_rev |0 key_rev, .t .0 node } task,
        .stack stack
      } btrie_push_task stack
    } btrie_push_task stack,
    { .t .val opt_val, .key_rev key_rev, .best best } <
      { .opt_val /nil _, .best best } .best,
      { .opt_val /val _v, .key_rev cand, .best best } {
        .cand cand, .best best
      } btrie_pick_longer_rev
    > best
  } btrie_max_key_step
> ?opt[bits[]];

-- Finds the largest numeric bits[] key stored in a btrie (longest path, 1-bias).
btrie_max_key = ?btrie[V] {
  { { {} |_ key_rev, () node } task, {} |nil stack } btrie_push_task stack,
  {} |nil best
} btrie_max_key_step ?opt[bits[]];

-- Functional two-stack BFS collecting btrie values in numeric index order
-- (0, 1, 2, 3, 4, ... for canonical MSB-first bits[] keys).
btrie_push_opt_trie = ?{ btrie[V] node, list[btrie[V]] q } <
  { .node /nil _n, .q q } .q,
  { .node /trie t, .q q } { .t |trie car, .q cdr } |cons
> ?list[btrie[V]];

btrie_bfs_push_val = ?{ opt[V] val, list[V] acc } <
  { .val /nil _v, .acc acc } .acc,
  { .val /val car, .acc cdr } |cons
> ?list[V];

btrie_bfs_next = ?{ list[btrie[V]] front, list[btrie[V]] back, list[V] acc } <
  { .front /nil _f, .back /cons b, .acc acc } {
    .b |cons reverse front,
    {} |nil back,
    .acc acc
  },
  { .front /cons h, .back back, .acc acc } {
    .h .cdr front,
    .h .car node,
    .back back,
    .acc acc
  } <
    { .front front, .node /nil _n, .back back, .acc acc } {
      .front front,
      .back back,
      .acc acc
    },
    { .front front, .node /trie t, .back back, .acc acc } {
      .front front,
      { .t .1 node, { .t .0 node, .back q } btrie_push_opt_trie q } btrie_push_opt_trie back,
      { .t .val val, .acc acc } btrie_bfs_push_val acc
    }
  >
> ?{ list[btrie[V]] front, list[btrie[V]] back, list[V] acc };

btrie_bfs_step = ?{ list[btrie[V]] front, list[btrie[V]] back, list[V] acc } <
  { .front /nil _f, .back /nil _b, .acc acc } .acc reverse,
  btrie_bfs_next btrie_bfs_step
> ?list[V];

btrie_bfs_values = ?btrie[V]
  { { () car, {} |nil cdr } |cons front, {} |nil back, {} |nil acc } btrie_bfs_step
  ?list[V];


-- -----------------------------------------------------------------------------
-- 5. Unicode Characters & String <-> Bit-Path Codecs
-- -----------------------------------------------------------------------------

bit1[] = { bit[] 0 };
bit2[] = { bit[] 0, bit[] 1 };
bit3[] = { bit[] 0, bit[] 1, bit[] 2 };
bit4[] = { bit[] 0, bit[] 1, bit[] 2, bit[] 3 };

-- Structural equality identity filters for fixed-width bit fields and Unicode pieces.
eq_bit1? = ?{ bit1[] x, bit1[] y } {
  { .x .0 x, .y .0 y } eq_bit? _,
  () then
} .then ?{ bit1[] x, bit1[] y };

eq_bit2? = ?{ bit2[] x, bit2[] y } {
  { .x .0 x, .y .0 y } eq_bit? _0,
  { .x .1 x, .y .1 y } eq_bit? _1,
  () then
} .then ?{ bit2[] x, bit2[] y };

eq_bit3? = ?{ bit3[] x, bit3[] y } {
  { .x .0 x, .y .0 y } eq_bit? _0,
  { .x .1 x, .y .1 y } eq_bit? _1,
  { .x .2 x, .y .2 y } eq_bit? _2,
  () then
} .then ?{ bit3[] x, bit3[] y };

eq_bit4? = ?{ bit4[] x, bit4[] y } {
  { .x .0 x, .y .0 y } eq_bit? _0,
  { .x .1 x, .y .1 y } eq_bit? _1,
  { .x .2 x, .y .2 y } eq_bit? _2,
  { .x .3 x, .y .3 y } eq_bit? _3,
  () then
} .then ?{ bit4[] x, bit4[] y };

eq_ascii? = ?{ ascii[] x, ascii[] y } {
  { .x .0 x, .y .0 y } eq_bit? _0,
  { .x .1 x, .y .1 y } eq_bit? _1,
  { .x .2 x, .y .2 y } eq_bit? _2,
  { .x .3 x, .y .3 y } eq_bit? _3,
  { .x .4 x, .y .4 y } eq_bit? _4,
  { .x .5 x, .y .5 y } eq_bit? _5,
  { .x .6 x, .y .6 y } eq_bit? _6,
  () then
} .then ?{ ascii[] x, ascii[] y };

eq_byte? = ?{ byte[] x, byte[] y } {
  { .x .0 x, .y .0 y } eq_bit? _0,
  { .x .1 x, .y .1 y } eq_bit? _1,
  { .x .2 x, .y .2 y } eq_bit? _2,
  { .x .3 x, .y .3 y } eq_bit? _3,
  { .x .4 x, .y .4 y } eq_bit? _4,
  { .x .5 x, .y .5 y } eq_bit? _5,
  { .x .6 x, .y .6 y } eq_bit? _6,
  { .x .7 x, .y .7 y } eq_bit? _7,
  () then
} .then ?{ byte[] x, byte[] y };

eq_plane0? = ?{ plane0[] x, plane0[] y } {
  { .x .0 x, .y .0 y } eq_bit? _0,
  { .x .1 x, .y .1 y } eq_bit? _1,
  { .x .2 x, .y .2 y } eq_bit? _2,
  { .x .3 x, .y .3 y } eq_bit? _3,
  { .x .4 x, .y .4 y } eq_bit? _4,
  { .x .5 x, .y .5 y } eq_bit? _5,
  { .x .6 x, .y .6 y } eq_bit? _6,
  { .x .7 x, .y .7 y } eq_bit? _7,
  { .x .8 x, .y .8 y } eq_bit? _8,
  { .x .9 x, .y .9 y } eq_bit? _9,
  { .x .10 x, .y .10 y } eq_bit? _10,
  () then
} .then ?{ plane0[] x, plane0[] y };

eq_bmp_hi_common? = ?{ bmp_hi_common[] x, bmp_hi_common[] y } {
  <
    { .x /h08_0F x, .y /h08_0F y } eq_bit3? {},
    { .x /h10_7F x, .y /h10_7F y } eq_ascii? {},
    { .x /h80_CF x, .y /h80_CF y } eq_ascii? {},
    { .x /hD0_D7 x, .y /hD0_D7 y } eq_bit3? {},
    { .x /hF9 _x, .y /hF9 _y } {},
    { .x /hFA_FB x, .y /hFA_FB y } eq_bit1? {},
    { .x /hFC_FD x, .y /hFC_FD y } eq_bit1? {},
    { .x /hFE_FF x, .y /hFE_FF y } eq_bit1? {}
  > _,
  () then
} .then ?{ bmp_hi_common[] x, bmp_hi_common[] y };

eq_bmp_hi_pua? = ?{ bmp_hi_private_use[] x, bmp_hi_private_use[] y } {
  <
    { .x /hE0_EF x, .y /hE0_EF y } eq_bit4? {},
    { .x /hF0_F7 x, .y /hF0_F7 y } eq_bit3? {},
    { .x /hF8 _x, .y /hF8 _y } {}
  > _,
  () then
} .then ?{ bmp_hi_private_use[] x, bmp_hi_private_use[] y };

eq_plane_02_10? = ?{ plane_02_10[] x, plane_02_10[] y } {
  <
    { .x /p02_03 x, .y /p02_03 y } eq_bit1? {},
    { .x /p04_07 x, .y /p04_07 y } eq_bit2? {},
    { .x /p08_0F x, .y /p08_0F y } eq_bit3? {},
    { .x /p10 _x, .y /p10 _y } {}
  > _,
  () then
} .then ?{ plane_02_10[] x, plane_02_10[] y };

-- Full Unicode scalar equality filter: { unicode[] x, unicode[] y }.
eq_char? = ?{ unicode[] x, unicode[] y } {
  <
    { .x /ascii x, .y /ascii y } eq_ascii? {},
    { .x /plane0 x, .y /plane0 y } eq_plane0? {},
    { .x /bmp_common a, .y /bmp_common b } {
      { .a .hi x, .b .hi y } eq_bmp_hi_common? _hi,
      { .a .lo x, .b .lo y } eq_byte? _lo
    } {},
    { .x /bmp_private_use a, .y /bmp_private_use b } {
      { .a .hi x, .b .hi y } eq_bmp_hi_pua? _hi,
      { .a .lo x, .b .lo y } eq_byte? _lo
    } {},
    { .x /supplementary_plane1 a, .y /supplementary_plane1 b } {
      { .a .mid x, .b .mid y } eq_byte? _mid,
      { .a .lo x, .b .lo y } eq_byte? _lo
    } {},
    { .x /supplementary_planes2_16 a, .y /supplementary_planes2_16 b } {
      { .a .plane x, .b .plane y } eq_plane_02_10? _plane,
      { .a .mid x, .b .mid y } eq_byte? _mid,
      { .a .lo x, .b .lo y } eq_byte? _lo
    } {}
  > _,
  () then
} .then ?{ unicode[] x, unicode[] y };

-- Bit-level push/take helpers matching codecs/djson.mjs's prefix bit-path encoding.
-- Each push_* wraps `rest` from LSB (.0) up to MSB (so root-to-leaf order is MSB first).
wrap_bit = <
  { .bit /0 _, .rest rest } .rest |0,
  { .bit /1 _, .rest rest } .rest |1
>;

push_bit1 = { .v .0 bit, .rest rest } wrap_bit;
push_bit2 =
  { .v v, { .v .0 bit, .rest rest } wrap_bit rest }
  { .v .1 bit, .rest rest } wrap_bit;
push_bit3 =
  { .v v, { .v .0 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .1 bit, .rest rest } wrap_bit rest }
  { .v .2 bit, .rest rest } wrap_bit;
push_bit4 =
  { .v v, { .v .0 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .1 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .2 bit, .rest rest } wrap_bit rest }
  { .v .3 bit, .rest rest } wrap_bit;

push_ascii =
  { .v v, { .v .0 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .1 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .2 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .3 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .4 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .5 bit, .rest rest } wrap_bit rest }
  { .v .6 bit, .rest rest } wrap_bit;

push_byte =
  { .v v, { .v .0 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .1 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .2 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .3 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .4 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .5 bit, .rest rest } wrap_bit rest }
  { .v v, { .v .6 bit, .rest rest } wrap_bit rest }
  { .v .7 bit, .rest rest } wrap_bit;

push_plane0 =
  { .v v, { .v .0  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .1  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .2  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .3  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .4  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .5  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .6  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .7  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .8  bit, .rest rest } wrap_bit rest }
  { .v v, { .v .9  bit, .rest rest } wrap_bit rest }
  { .v .10 bit, .rest rest } wrap_bit;

push_bmp_hi_common = <
  { .hi /h08_0F v, .rest rest } push_bit3 |0 |0 |0,
  { .hi /h10_7F v, .rest rest } push_ascii |1 |0 |0,
  { .hi /h80_CF v, .rest rest } push_ascii |0 |1 |0,
  { .hi /hD0_D7 v, .rest rest } push_bit3 |1 |1 |0,
  { .hi /hF9 _, .rest rest } .rest |0 |0 |1,
  { .hi /hFA_FB v, .rest rest } push_bit1 |1 |0 |1,
  { .hi /hFC_FD v, .rest rest } push_bit1 |0 |1 |1,
  { .hi /hFE_FF v, .rest rest } push_bit1 |1 |1 |1
>;

push_bmp_hi_pua = <
  { .hi /hE0_EF v, .rest rest } push_bit4 |0,
  { .hi /hF0_F7 v, .rest rest } push_bit3 |0 |1,
  { .hi /hF8 _, .rest rest } .rest |1 |1
>;

push_plane_02_10 = <
  { .p /p02_03 v, .rest rest } push_bit1 |0 |0,
  { .p /p04_07 v, .rest rest } push_bit2 |1 |0,
  { .p /p08_0F v, .rest rest } push_bit3 |0 |1,
  { .p /p10 _, .rest rest } .rest |1 |1
>;

push_char_bits = <
  { .ch /ascii v, .rest rest } push_ascii |0,
  { .ch /plane0 v, .rest rest } push_plane0 |0 |1,
  { .ch /bmp_common c, .rest rest }
    { .c .hi hi, { .c .lo v, .rest rest } push_byte rest } push_bmp_hi_common |0 |1 |1,
  { .ch /bmp_private_use c, .rest rest }
    { .c .hi hi, { .c .lo v, .rest rest } push_byte rest } push_bmp_hi_pua |0 |1 |1 |1,
  { .ch /supplementary_plane1 c, .rest rest }
    { .c .mid v, { .c .lo v, .rest rest } push_byte rest } push_byte |0 |1 |1 |1 |1,
  { .ch /supplementary_planes2_16 c, .rest rest }
    {
      .c .plane p,
      { .c .mid v, { .c .lo v, .rest rest } push_byte rest } push_byte rest
    } push_plane_02_10 |1 |1 |1 |1 |1
>;

-- Tail-recursively encodes reversed characters backwards onto `acc` so prefix order matches forward traversal.
string_to_bits_step = ?{ string[] rev, bits[] acc } <
  { .rev /nil _, .acc acc } .acc,
  { .rev /cons c, .acc acc } {
    .c .cdr rev,
    { .c .car ch, .acc rest } push_char_bits acc
  } string_to_bits_step
> ?bits[];

-- Encodes a string[] into its canonical btrie bit-path (matching stringToBitPath).
string_to_bits = ?string[] { reverse rev, {} |_ acc } string_to_bits_step ?bits[];

-- Dual prefix decoder: bits[] -> string[].
take_bit = <
  /0 { {} |0 bit, () rest },
  /1 { {} |1 bit, () rest }
>;

take_bit1 = take_bit { { .bit 0 } v, .rest rest };
take_bit2 = take_bit { .bit 1, .rest take_bit rest } { { .1 1, .rest .bit 0 } v, .rest .rest rest };
take_bit3 = take_bit { .bit 2, .rest take_bit2 rest } {
  { .2 2, .rest .v .1 1, .rest .v .0 0 } v,
  .rest .rest rest
};
take_bit4 = take_bit { .bit 3, .rest take_bit3 rest } {
  { .3 3, .rest .v .2 2, .rest .v .1 1, .rest .v .0 0 } v,
  .rest .rest rest
};

take_ascii_bits = take_bit3 { .v a, .rest take_bit4 rest } {
  { .a .2 6, .a .1 5, .a .0 4, .rest .v .3 3, .rest .v .2 2, .rest .v .1 1, .rest .v .0 0 } v,
  .rest .rest rest
};

take_byte = take_bit4 { .v hi, .rest take_bit4 rest } {
  {
    .hi .3 7, .hi .2 6, .hi .1 5, .hi .0 4,
    .rest .v .3 3, .rest .v .2 2, .rest .v .1 1, .rest .v .0 0
  } v,
  .rest .rest rest
};

take_plane0 = take_bit3 { .v hi, .rest take_byte rest } {
  {
    .hi .2 10, .hi .1 9, .hi .0 8,
    .rest .v .7 7, .rest .v .6 6, .rest .v .5 5, .rest .v .4 4,
    .rest .v .3 3, .rest .v .2 2, .rest .v .1 1, .rest .v .0 0
  } v,
  .rest .rest rest
};

take_bmp_common = <
  /0 /0 /0 take_bit3 { .v |h08_0F hi, .rest rest },
  /0 /0 /1 take_ascii_bits { .v |h10_7F hi, .rest rest },
  /0 /1 /0 take_ascii_bits { .v |h80_CF hi, .rest rest },
  /0 /1 /1 take_bit3 { .v |hD0_D7 hi, .rest rest },
  /1 /0 /0 { {} |hF9 hi, () rest },
  /1 /0 /1 take_bit1 { .v |hFA_FB hi, .rest rest },
  /1 /1 /0 take_bit1 { .v |hFC_FD hi, .rest rest },
  /1 /1 /1 take_bit1 { .v |hFE_FF hi, .rest rest }
> { .hi hi, .rest take_byte rest } {
  { .hi hi, .rest .v lo } |bmp_common ch,
  .rest .rest rest
};

take_bmp_pua = <
  /0 take_bit4 { .v |hE0_EF hi, .rest rest },
  /1 /0 take_bit3 { .v |hF0_F7 hi, .rest rest },
  /1 /1 { {} |hF8 hi, () rest }
> { .hi hi, .rest take_byte rest } {
  { .hi hi, .rest .v lo } |bmp_private_use ch,
  .rest .rest rest
};

take_plane_02_10 = <
  /0 /0 take_bit1 { .v |p02_03 plane, .rest rest },
  /0 /1 take_bit2 { .v |p04_07 plane, .rest rest },
  /1 /0 take_bit3 { .v |p08_0F plane, .rest rest },
  /1 /1 { {} |p10 plane, () rest }
> { .plane plane, .rest take_byte rest } {
  .plane plane,
  .rest .v mid,
  .rest .rest take_byte rest
} {
  { .plane plane, .mid mid, .rest .v lo } |supplementary_planes2_16 ch,
  .rest .rest rest
};

take_char = <
  /0 take_ascii_bits { .v |ascii ch, .rest rest },
  /1 /0 take_plane0 { .v |plane0 ch, .rest rest },
  /1 /1 /0 take_bmp_common,
  /1 /1 /1 /0 take_bmp_pua,
  /1 /1 /1 /1 /0 take_byte { .v mid, .rest take_byte rest } {
    { .mid mid, .rest .v lo } |supplementary_plane1 ch,
    .rest .rest rest
  },
  /1 /1 /1 /1 /1 take_plane_02_10
>;

bits_to_string_step = ?{ bits[] in, string[] acc } <
  { .in /_ _, .acc acc } .acc reverse,
  { .in < /0 |0, /1 |1 > take_char c, .acc acc } {
    .c .rest in,
    { .c .ch car, .acc cdr } |cons acc
  } bits_to_string_step
> ?string[];

bits_to_string = ?bits[] { () in, {} |nil acc } bits_to_string_step ?string[];
