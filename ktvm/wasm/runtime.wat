  ;; ============================================================================
  ;; kTVM Standalone WebAssembly Runtime (`runtime.wat`)
  ;;
  ;; Implements the complete strictly iterative `kTVM` mono operational semantics
  ;; in linear memory:
  ;;   - Flat bump arena (1ns reset between runs) + global memory/node/step quotas
  ;;   - `BitDeque` (`<= 128b` inline ring buffer + growable power-of-2 ring buffer)
  ;;   - `BitStack` (`<= 128b` inline LIFO bit stack + growable stack)
  ;;   - Shared Moore-minimized schema DFA + resumable DPDA (`skip`, `copy`, `coerce`)
  ;;   - O(1) zero-copy `_splice`, same-scope `mux`/`demux` fusion, single-survivor `tee`
  ;;   - Strict `barrier`/`gate`/`drain`, `spec` rollback & upstream abort, `after %tok`
  ;;   - Hot-burst `chunk_table` (with SWAR mask compression), `stack_table`, `fsm_table`
  ;;   - Strictly iterative demand-driven pull scheduler (`drive_to_completion`)
  ;; ============================================================================

  (memory (export "memory") 256 4096)

  ;; Function table types for indirect dispatch
  (type $block_fn (func (param i32 i32)))          ;; (scopePtr, envPtr)
  (type $kernel_fn (func (param i32) (result i32))) ;; (nodePtr) -> 0=ok, 1=needPull, 2=yielded

  ;; Runtime mutable globals
  (global $g_heap_base (mut i32) (i32.const 0))
  (global $g_heap_ptr (mut i32) (i32.const 0))
  (global $g_heap_limit (mut i32) (i32.const 0))
  (global $g_error_code (mut i32) (i32.const 0))
  (global $g_need_pull (mut i32) (i32.const 0))
  (global $g_need_step_node (mut i32) (i32.const 0))

  ;; Quotas & telemetry
  (global $g_max_steps (mut i32) (i32.const 50000000))
  (global $g_max_nodes (mut i32) (i32.const 200000))
  (global $g_max_bytes (mut i32) (i32.const 67108864))

  (global $g_steps (mut i32) (i32.const 0))
  (global $g_live_nodes (mut i32) (i32.const 0))
  (global $g_peak_nodes (mut i32) (i32.const 0))
  (global $g_buf_bytes (mut i32) (i32.const 0))
  (global $g_peak_bytes (mut i32) (i32.const 0))
  (global $g_table_lookups (mut i32) (i32.const 0))
  (global $g_splices (mut i32) (i32.const 0))
  (global $g_mux_demux_fusions (mut i32) (i32.const 0))
  (global $g_spec_rollbacks (mut i32) (i32.const 0))
  (global $g_spec_upstream_aborts (mut i32) (i32.const 0))
  (global $g_spec_tail_splices (mut i32) (i32.const 0))
  (global $g_after_settlements (mut i32) (i32.const 0))

  ;; Demand stack (8 bytes per frame: [kind (0=chan,1=node), ptr])
  (global $g_dstack_ptr (mut i32) (i32.const 0))
  (global $g_dstack_cap (mut i32) (i32.const 0))
  (global $g_dstack_len (mut i32) (i32.const 0))

  ;; Reusable `$scope_destroy` scratch stacks & BitDeque power-of-2 external buffer free list
  (global $g_sc_stk_ptr (mut i32) (i32.const 0))
  (global $g_sc_ord_ptr (mut i32) (i32.const 0))
  (global $g_sc_cap (mut i32) (i32.const 0))
  (global $g_buf_fl_ptr (mut i32) (i32.const 0))

  ;; Error codes:
  ;;   0 = OK
  ;;  -1 = FAILED (normal K partiality failure)
  ;;  -2 = QUOTA_STEPS
  ;;  -3 = QUOTA_NODES
  ;;  -4 = QUOTA_BYTES
  ;;  -5 = OUT_CAP
  ;;  -6 = MALFORMED_WIRE
  ;;  -7 = DEADLOCK

  ;; Node kind constants:
  ;;  1=const_unit, 2=splice, 3=coerce, 4=wrap, 5=match, 6=demux, 7=mux,
  ;;  8=tee, 9=drain, 10=gate, 11=switch, 12=spec, 13=tap, 14=spawn, 15=kernel

  ;; Channel status constants:
  ;;  0=OPEN, 1=CLOSED, 2=FAILED, 3=RELEASED

  ;; ============================================================================
  ;; 1. Arena Allocator, Quotas & Bit Helpers
  ;; ============================================================================

  (func $mask32 (param $w i32) (result i32)
    (if (i32.le_s (local.get $w) (i32.const 0))
      (then (return (i32.const 0))))
    (if (i32.ge_s (local.get $w) (i32.const 32))
      (then (return (i32.const -1))))
    (i32.sub (i32.shl (i32.const 1) (local.get $w)) (i32.const 1))
  )

  (func $alloc (param $bytes i32) (result i32)
    (local $aligned i32)
    (local $ptr i32)
    (local $next i32)
    (local $needPages i32)
    (local $curPages i32)
    (local.set $aligned (i32.and (i32.add (local.get $bytes) (i32.const 7)) (i32.const -8)))
    (local.set $ptr (global.get $g_heap_ptr))
    (local.set $next (i32.add (local.get $ptr) (local.get $aligned)))
    (if (i32.gt_u (local.get $next) (global.get $g_heap_limit))
      (then
        (local.set $needPages
          (i32.shr_u
            (i32.add (i32.sub (local.get $next) (global.get $g_heap_limit)) (i32.const 65535))
            (i32.const 16)))
        (if (i32.lt_s (local.get $needPages) (i32.const 16))
          (then (local.set $needPages (i32.const 16))))
        (local.set $curPages (memory.grow (local.get $needPages)))
        (if (i32.eq (local.get $curPages) (i32.const -1))
          (then
            (global.set $g_error_code (i32.const -4))
            (return (i32.const 0))))
        (global.set $g_heap_limit (i32.shl (memory.size) (i32.const 16)))
      )
    )
    (global.set $g_heap_ptr (local.get $next))
    (memory.fill (local.get $ptr) (i32.const 0) (local.get $aligned))
    (local.get $ptr)
  )

  (func $quota_add_bytes (param $delta i32)
    (local $cur i32)
    (local.set $cur (i32.add (global.get $g_buf_bytes) (local.get $delta)))
    (if (i32.lt_s (local.get $cur) (i32.const 0))
      (then (local.set $cur (i32.const 0))))
    (global.set $g_buf_bytes (local.get $cur))
    (if (i32.gt_s (local.get $cur) (global.get $g_peak_bytes))
      (then (global.set $g_peak_bytes (local.get $cur))))
    (if (i32.gt_s (local.get $cur) (global.get $g_max_bytes))
      (then
        (if (i32.eq (global.get $g_error_code) (i32.const 0))
          (then (global.set $g_error_code (i32.const -4))))))
  )

  (func $quota_add_node
    (local $cur i32)
    (local.set $cur (i32.add (global.get $g_live_nodes) (i32.const 1)))
    (global.set $g_live_nodes (local.get $cur))
    (if (i32.gt_s (local.get $cur) (global.get $g_peak_nodes))
      (then (global.set $g_peak_nodes (local.get $cur))))
    (if (i32.gt_s (local.get $cur) (global.get $g_max_nodes))
      (then
        (if (i32.eq (global.get $g_error_code) (i32.const 0))
          (then (global.set $g_error_code (i32.const -3))))))
  )

  (func $quota_remove_node
    (if (i32.gt_s (global.get $g_live_nodes) (i32.const 0))
      (then (global.set $g_live_nodes (i32.sub (global.get $g_live_nodes) (i32.const 1)))))
  )

  (func $quota_tick_step (result i32)
    (local $s i32)
    (local.set $s (i32.add (global.get $g_steps) (i32.const 1)))
    (global.set $g_steps (local.get $s))
    (if (i32.gt_s (local.get $s) (global.get $g_max_steps))
      (then
        (if (i32.eq (global.get $g_error_code) (i32.const 0))
          (then (global.set $g_error_code (i32.const -2))))
        (return (i32.const 1))))
    (i32.ne (global.get $g_error_code) (i32.const 0))
  )

  ;; ============================================================================
  ;; 2. Schema DFA Helpers (Global Moore-Minimized Schema Table)
  ;; ============================================================================
  ;; Node layout (16 bytes): +0 kind (0=prod,1=union), +4 width, +8 numEdges, +12 edgesPtr
  ;; Edge layout (8 bytes):  +0 tagId, +4 targetNodeId

  (func $schema_kind (param $sid i32) (result i32)
    (i32.load (i32.add (global.get $DATA_SCHEMA_NODES) (i32.shl (local.get $sid) (i32.const 4))))
  )

  (func $schema_width (param $sid i32) (result i32)
    (i32.load (i32.add (i32.add (global.get $DATA_SCHEMA_NODES) (i32.shl (local.get $sid) (i32.const 4))) (i32.const 4)))
  )

  (func $schema_num_edges (param $sid i32) (result i32)
    (i32.load (i32.add (i32.add (global.get $DATA_SCHEMA_NODES) (i32.shl (local.get $sid) (i32.const 4))) (i32.const 8)))
  )

  (func $schema_edges_ptr (param $sid i32) (result i32)
    (i32.load (i32.add (i32.add (global.get $DATA_SCHEMA_NODES) (i32.shl (local.get $sid) (i32.const 4))) (i32.const 12)))
  )

  (func $schema_edge_tag (param $sid i32) (param $ord i32) (result i32)
    (i32.load (i32.add (call $schema_edges_ptr (local.get $sid)) (i32.shl (local.get $ord) (i32.const 3))))
  )

  (func $schema_edge_target (param $sid i32) (param $ord i32) (result i32)
    (i32.load (i32.add (i32.add (call $schema_edges_ptr (local.get $sid)) (i32.shl (local.get $ord) (i32.const 3))) (i32.const 4)))
  )

  ;; Find ordinal of tagId in union schema `sid`, or -1 if not found.
  (func $schema_find_tag (param $sid i32) (param $tagId i32) (result i32)
    (local $n i32)
    (local $ep i32)
    (local $i i32)
    (local.set $n (call $schema_num_edges (local.get $sid)))
    (local.set $ep (call $schema_edges_ptr (local.get $sid)))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $i) (local.get $n)))
        (if (i32.eq (i32.load (i32.add (local.get $ep) (i32.shl (local.get $i) (i32.const 3)))) (local.get $tagId))
          (then (return (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (i32.const -1)
  )

  ;; ============================================================================
  ;; 3. BitDeque (Channel) ADT (`<= 128b` inline + growable power-of-2 ring)
  ;; ============================================================================

  (func $chan_alloc (param $scopePtr i32) (param $schemaId i32) (result i32)
    (local $ch i32)
    (local.set $ch (call $alloc (i32.const 64)))
    (if (i32.eqz (local.get $ch)) (then (return (i32.const 0))))
    (i32.store (local.get $ch) (i32.const 0)) ;; status = OPEN
    (i32.store (i32.add (local.get $ch) (i32.const 4)) (local.get $schemaId)) ;; prodSchema
    (i32.store (i32.add (local.get $ch) (i32.const 8)) (local.get $schemaId)) ;; consSchema
    (i32.store (i32.add (local.get $ch) (i32.const 12)) (i32.const 1)) ;; aligned = 1
    (i32.store (i32.add (local.get $ch) (i32.const 24)) (local.get $scopePtr))
    (i32.store (i32.add (local.get $ch) (i32.const 32)) (i32.add (local.get $ch) (i32.const 48))) ;; inline bufPtr
    (i32.store (i32.add (local.get $ch) (i32.const 36)) (i32.const 4)) ;; capWords = 4 (128 bits)
    (call $quota_add_bytes (i32.const 16))
    (if (i32.ne (local.get $scopePtr) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $ch) (i32.const 28)) (i32.load (i32.add (local.get $scopePtr) (i32.const 16))))
        (i32.store (i32.add (local.get $scopePtr) (i32.const 16)) (local.get $ch))
      )
    )
    (local.get $ch)
  )

  (func $bd_close (param $ch i32)
    (if (i32.eqz (local.get $ch)) (then (return)))
    (if (i32.eq (i32.load (local.get $ch)) (i32.const 0))
      (then
        (i32.store (local.get $ch) (i32.const 1))
        (i32.store (i32.add (local.get $ch) (i32.const 16)) (i32.const 0))
      )
    )
  )

  (func $bd_fail (param $ch i32)
    (if (i32.eqz (local.get $ch)) (then (return)))
    (if (i32.eq (i32.load (local.get $ch)) (i32.const 0))
      (then
        (i32.store (local.get $ch) (i32.const 2))
        (i32.store (i32.add (local.get $ch) (i32.const 16)) (i32.const 0))
      )
    )
  )

  (func $buf_fl_push (param $ptr i32) (param $words i32)
    (local $b i32)
    (local $slot i32)
    (if (i32.or (i32.eqz (global.get $g_buf_fl_ptr))
          (i32.or (i32.lt_s (local.get $words) (i32.const 8)) (i32.gt_s (local.get $words) (i32.const 65536))))
      (then (return)))
    (local.set $b (i32.sub (i32.ctz (local.get $words)) (i32.const 3)))
    (if (i32.or (i32.lt_s (local.get $b) (i32.const 0)) (i32.ge_s (local.get $b) (i32.const 14)))
      (then (return)))
    (local.set $slot (i32.add (global.get $g_buf_fl_ptr) (i32.shl (local.get $b) (i32.const 2))))
    (i32.store (local.get $ptr) (i32.load (local.get $slot)))
    (i32.store (local.get $slot) (local.get $ptr))
  )

  (func $buf_fl_pop (param $words i32) (result i32)
    (local $b i32)
    (local $slot i32)
    (local $ptr i32)
    (if (i32.or (i32.eqz (global.get $g_buf_fl_ptr))
          (i32.or (i32.lt_s (local.get $words) (i32.const 8)) (i32.gt_s (local.get $words) (i32.const 65536))))
      (then (return (i32.const 0))))
    (local.set $b (i32.sub (i32.ctz (local.get $words)) (i32.const 3)))
    (if (i32.or (i32.lt_s (local.get $b) (i32.const 0)) (i32.ge_s (local.get $b) (i32.const 14)))
      (then (return (i32.const 0))))
    (local.set $slot (i32.add (global.get $g_buf_fl_ptr) (i32.shl (local.get $b) (i32.const 2))))
    (local.set $ptr (i32.load (local.get $slot)))
    (if (i32.ne (local.get $ptr) (i32.const 0))
      (then
        (i32.store (local.get $slot) (i32.load (local.get $ptr)))
        (memory.fill (local.get $ptr) (i32.const 0) (i32.shl (local.get $words) (i32.const 2)))
      )
    )
    (local.get $ptr)
  )

  (func $bd_release (param $ch i32)
    (local $capW i32)
    (local $bufPtr i32)
    (if (i32.eqz (local.get $ch)) (then (return)))
    (if (i32.eq (i32.load (local.get $ch)) (i32.const 3)) (then (return)))
    (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
    (local.set $bufPtr (i32.load (i32.add (local.get $ch) (i32.const 32))))
    (if (i32.gt_s (local.get $capW) (i32.const 0))
      (then
        (call $quota_add_bytes (i32.sub (i32.const 0) (i32.shl (local.get $capW) (i32.const 2))))
        (if (i32.and (i32.ne (local.get $bufPtr) (i32.const 0))
              (i32.ne (local.get $bufPtr) (i32.add (local.get $ch) (i32.const 48))))
          (then (call $buf_fl_push (local.get $bufPtr) (local.get $capW))))
      )
    )
    (i32.store (local.get $ch) (i32.const 3))
    (i32.store (i32.add (local.get $ch) (i32.const 32)) (i32.const 0))
    (i32.store (i32.add (local.get $ch) (i32.const 36)) (i32.const 0))
    (i32.store (i32.add (local.get $ch) (i32.const 44)) (i32.const 0))
  )

  (func $bd_grow (param $ch i32) (param $minBits i32)
    (local $oldWords i32)
    (local $oldBuf i32)
    (local $oldWordMask i32)
    (local $oldBitMask i32)
    (local $oldHead i32)
    (local $oldLen i32)
    (local $newWords i32)
    (local $newBuf i32)
    (local $rem i32)
    (local $srcPos i32)
    (local $dstPos i32)
    (local $chunk i32)
    (local $wi i32)
    (local $bo i32)
    (local $val i32)
    (local $lo i32)
    (local $hiBits i32)
    (local $w1 i32)
    (local $dwi i32)
    (local $dbo i32)

    (local.set $oldBuf (i32.load (i32.add (local.get $ch) (i32.const 32))))
    (local.set $oldWords (i32.load (i32.add (local.get $ch) (i32.const 36))))
    (local.set $oldHead (i32.load (i32.add (local.get $ch) (i32.const 40))))
    (local.set $oldLen (i32.load (i32.add (local.get $ch) (i32.const 44))))

    (local.set $newWords (i32.shl (local.get $oldWords) (i32.const 1)))
    (if (i32.lt_s (local.get $newWords) (i32.const 8))
      (then (local.set $newWords (i32.const 8))))
    (block $brkW
      (loop $lpW
        (br_if $brkW (i32.ge_s (i32.shl (local.get $newWords) (i32.const 5)) (local.get $minBits)))
        (local.set $newWords (i32.shl (local.get $newWords) (i32.const 1)))
        (br $lpW)
      )
    )

    (local.set $newBuf (call $buf_fl_pop (local.get $newWords)))
    (if (i32.eqz (local.get $newBuf))
      (then (local.set $newBuf (call $alloc (i32.shl (local.get $newWords) (i32.const 2))))))
    (if (i32.eqz (local.get $newBuf)) (then (return)))
    (call $quota_add_bytes (i32.shl (i32.sub (local.get $newWords) (local.get $oldWords)) (i32.const 2)))

    (local.set $oldWordMask (i32.sub (local.get $oldWords) (i32.const 1)))
    (local.set $oldBitMask (i32.sub (i32.shl (local.get $oldWords) (i32.const 5)) (i32.const 1)))
    (local.set $rem (local.get $oldLen))
    (local.set $srcPos (local.get $oldHead))
    (local.set $dstPos (i32.const 0))

    (block $brkC
      (loop $lpC
        (br_if $brkC (i32.le_s (local.get $rem) (i32.const 0)))
        (local.set $chunk (select (i32.const 30) (local.get $rem) (i32.gt_s (local.get $rem) (i32.const 30))))
        (local.set $wi (i32.shr_u (local.get $srcPos) (i32.const 5)))
        (local.set $bo (i32.and (local.get $srcPos) (i32.const 31)))
        (if (i32.le_s (i32.add (local.get $bo) (local.get $chunk)) (i32.const 32))
          (then
            (local.set $val
              (i32.and
                (i32.shr_u
                  (i32.load (i32.add (local.get $oldBuf) (i32.shl (local.get $wi) (i32.const 2))))
                  (i32.sub (i32.const 32) (i32.add (local.get $bo) (local.get $chunk))))
                (call $mask32 (local.get $chunk))))
          )
          (else
            (local.set $lo (i32.sub (i32.add (local.get $bo) (local.get $chunk)) (i32.const 32)))
            (local.set $hiBits (i32.sub (i32.const 32) (local.get $bo)))
            (local.set $w1 (i32.and (i32.add (local.get $wi) (i32.const 1)) (local.get $oldWordMask)))
            (local.set $val
              (i32.or
                (i32.shl
                  (i32.and
                    (i32.load (i32.add (local.get $oldBuf) (i32.shl (local.get $wi) (i32.const 2))))
                    (call $mask32 (local.get $hiBits)))
                  (local.get $lo))
                (i32.shr_u
                  (i32.load (i32.add (local.get $oldBuf) (i32.shl (local.get $w1) (i32.const 2))))
                  (i32.sub (i32.const 32) (local.get $lo)))))
          )
        )
        (local.set $dwi (i32.shr_u (local.get $dstPos) (i32.const 5)))
        (local.set $dbo (i32.and (local.get $dstPos) (i32.const 31)))
        (if (i32.le_s (i32.add (local.get $dbo) (local.get $chunk)) (i32.const 32))
          (then
            (i32.store
              (i32.add (local.get $newBuf) (i32.shl (local.get $dwi) (i32.const 2)))
              (i32.or
                (i32.load (i32.add (local.get $newBuf) (i32.shl (local.get $dwi) (i32.const 2))))
                (i32.shl (local.get $val) (i32.sub (i32.const 32) (i32.add (local.get $dbo) (local.get $chunk))))))
          )
          (else
            (local.set $lo (i32.sub (i32.add (local.get $dbo) (local.get $chunk)) (i32.const 32)))
            (i32.store
              (i32.add (local.get $newBuf) (i32.shl (local.get $dwi) (i32.const 2)))
              (i32.or
                (i32.load (i32.add (local.get $newBuf) (i32.shl (local.get $dwi) (i32.const 2))))
                (i32.shr_u (local.get $val) (local.get $lo))))
            (i32.store
              (i32.add (local.get $newBuf) (i32.shl (i32.add (local.get $dwi) (i32.const 1)) (i32.const 2)))
              (i32.or
                (i32.load (i32.add (local.get $newBuf) (i32.shl (i32.add (local.get $dwi) (i32.const 1)) (i32.const 2))))
                (i32.shl (local.get $val) (i32.sub (i32.const 32) (local.get $lo)))))
          )
        )
        (local.set $srcPos (i32.and (i32.add (local.get $srcPos) (local.get $chunk)) (local.get $oldBitMask)))
        (local.set $dstPos (i32.add (local.get $dstPos) (local.get $chunk)))
        (local.set $rem (i32.sub (local.get $rem) (local.get $chunk)))
        (br $lpC)
      )
    )

    (if (i32.and (i32.ne (local.get $oldBuf) (i32.const 0))
          (i32.ne (local.get $oldBuf) (i32.add (local.get $ch) (i32.const 48))))
      (then (call $buf_fl_push (local.get $oldBuf) (local.get $oldWords))))
    (i32.store (i32.add (local.get $ch) (i32.const 32)) (local.get $newBuf))
    (i32.store (i32.add (local.get $ch) (i32.const 36)) (local.get $newWords))
    (i32.store (i32.add (local.get $ch) (i32.const 40)) (i32.const 0))
  )

  (func $bd_push_small (param $ch i32) (param $val i32) (param $w i32)
    (local $len i32)
    (local $capW i32)
    (local $capBits i32)
    (local $buf i32)
    (local $v i32)
    (local $tailPos i32)
    (local $wi i32)
    (local $bo i32)
    (local $sh i32)
    (local $clr i32)
    (local $lo i32)
    (local $hiBits i32)
    (local $w1 i32)
    (local $addr i32)

    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return)))
    (local.set $len (i32.load (i32.add (local.get $ch) (i32.const 44))))
    (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
    (local.set $capBits (i32.shl (local.get $capW) (i32.const 5)))
    (if (i32.gt_s (i32.add (local.get $len) (local.get $w)) (local.get $capBits))
      (then
        (call $bd_grow (local.get $ch) (i32.add (local.get $len) (local.get $w)))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return)))
        (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
        (local.set $capBits (i32.shl (local.get $capW) (i32.const 5)))
      )
    )
    (local.set $buf (i32.load (i32.add (local.get $ch) (i32.const 32))))
    (local.set $v (i32.and (local.get $val) (call $mask32 (local.get $w))))
    (local.set $tailPos
      (i32.and
        (i32.add (i32.load (i32.add (local.get $ch) (i32.const 40))) (local.get $len))
        (i32.sub (local.get $capBits) (i32.const 1))))
    (local.set $wi (i32.shr_u (local.get $tailPos) (i32.const 5)))
    (local.set $bo (i32.and (local.get $tailPos) (i32.const 31)))

    (if (i32.le_s (i32.add (local.get $bo) (local.get $w)) (i32.const 32))
      (then
        (local.set $sh (i32.sub (i32.const 32) (i32.add (local.get $bo) (local.get $w))))
        (local.set $clr (i32.xor (i32.shl (call $mask32 (local.get $w)) (local.get $sh)) (i32.const -1)))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (local.get $wi) (i32.const 2))))
        (i32.store (local.get $addr)
          (i32.or (i32.and (i32.load (local.get $addr)) (local.get $clr)) (i32.shl (local.get $v) (local.get $sh))))
      )
      (else
        (local.set $lo (i32.sub (i32.add (local.get $bo) (local.get $w)) (i32.const 32)))
        (local.set $hiBits (i32.sub (i32.const 32) (local.get $bo)))
        (local.set $w1 (i32.and (i32.add (local.get $wi) (i32.const 1)) (i32.sub (local.get $capW) (i32.const 1))))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (local.get $wi) (i32.const 2))))
        (i32.store (local.get $addr)
          (i32.or
            (i32.and (i32.load (local.get $addr)) (i32.xor (call $mask32 (local.get $hiBits)) (i32.const -1)))
            (i32.shr_u (local.get $v) (local.get $lo))))
        (local.set $sh (i32.sub (i32.const 32) (local.get $lo)))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (local.get $w1) (i32.const 2))))
        (i32.store (local.get $addr)
          (i32.or
            (i32.and (i32.load (local.get $addr)) (i32.xor (i32.shl (call $mask32 (local.get $lo)) (local.get $sh)) (i32.const -1)))
            (i32.shl (local.get $v) (local.get $sh))))
      )
    )
    (i32.store (i32.add (local.get $ch) (i32.const 44)) (i32.add (local.get $len) (local.get $w)))
  )

  (func $bd_push_bits (param $ch i32) (param $val i32) (param $w i32)
    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return)))
    (if (i32.le_s (local.get $w) (i32.const 30))
      (then
        (call $bd_push_small (local.get $ch) (local.get $val) (local.get $w))
        (return)))
    (call $bd_push_small (local.get $ch) (i32.shr_u (local.get $val) (i32.const 16)) (i32.sub (local.get $w) (i32.const 16)))
    (call $bd_push_small (local.get $ch) (i32.and (local.get $val) (i32.const 65535)) (i32.const 16))
  )

  (func $bd_unshift_small (param $ch i32) (param $val i32) (param $w i32)
    (local $len i32)
    (local $capW i32)
    (local $capBits i32)
    (local $buf i32)
    (local $v i32)
    (local $newHead i32)
    (local $wi i32)
    (local $bo i32)
    (local $sh i32)
    (local $clr i32)
    (local $lo i32)
    (local $hiBits i32)
    (local $w1 i32)
    (local $addr i32)

    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return)))
    (local.set $len (i32.load (i32.add (local.get $ch) (i32.const 44))))
    (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
    (local.set $capBits (i32.shl (local.get $capW) (i32.const 5)))
    (if (i32.gt_s (i32.add (local.get $len) (local.get $w)) (local.get $capBits))
      (then
        (call $bd_grow (local.get $ch) (i32.add (local.get $len) (local.get $w)))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return)))
        (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
        (local.set $capBits (i32.shl (local.get $capW) (i32.const 5)))
      )
    )
    (local.set $buf (i32.load (i32.add (local.get $ch) (i32.const 32))))
    (local.set $v (i32.and (local.get $val) (call $mask32 (local.get $w))))
    (local.set $newHead
      (i32.and
        (i32.sub (i32.load (i32.add (local.get $ch) (i32.const 40))) (local.get $w))
        (i32.sub (local.get $capBits) (i32.const 1))))
    (local.set $wi (i32.shr_u (local.get $newHead) (i32.const 5)))
    (local.set $bo (i32.and (local.get $newHead) (i32.const 31)))

    (if (i32.le_s (i32.add (local.get $bo) (local.get $w)) (i32.const 32))
      (then
        (local.set $sh (i32.sub (i32.const 32) (i32.add (local.get $bo) (local.get $w))))
        (local.set $clr (i32.xor (i32.shl (call $mask32 (local.get $w)) (local.get $sh)) (i32.const -1)))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (local.get $wi) (i32.const 2))))
        (i32.store (local.get $addr)
          (i32.or (i32.and (i32.load (local.get $addr)) (local.get $clr)) (i32.shl (local.get $v) (local.get $sh))))
      )
      (else
        (local.set $lo (i32.sub (i32.add (local.get $bo) (local.get $w)) (i32.const 32)))
        (local.set $hiBits (i32.sub (i32.const 32) (local.get $bo)))
        (local.set $w1 (i32.and (i32.add (local.get $wi) (i32.const 1)) (i32.sub (local.get $capW) (i32.const 1))))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (local.get $wi) (i32.const 2))))
        (i32.store (local.get $addr)
          (i32.or
            (i32.and (i32.load (local.get $addr)) (i32.xor (call $mask32 (local.get $hiBits)) (i32.const -1)))
            (i32.shr_u (local.get $v) (local.get $lo))))
        (local.set $sh (i32.sub (i32.const 32) (local.get $lo)))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (local.get $w1) (i32.const 2))))
        (i32.store (local.get $addr)
          (i32.or
            (i32.and (i32.load (local.get $addr)) (i32.xor (i32.shl (call $mask32 (local.get $lo)) (local.get $sh)) (i32.const -1)))
            (i32.shl (local.get $v) (local.get $sh))))
      )
    )
    (i32.store (i32.add (local.get $ch) (i32.const 40)) (local.get $newHead))
    (i32.store (i32.add (local.get $ch) (i32.const 44)) (i32.add (local.get $len) (local.get $w)))
  )

  (func $bd_unshift_bits (param $ch i32) (param $val i32) (param $w i32)
    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return)))
    (if (i32.le_s (local.get $w) (i32.const 30))
      (then
        (call $bd_unshift_small (local.get $ch) (local.get $val) (local.get $w))
        (return)))
    (call $bd_unshift_small (local.get $ch) (i32.and (local.get $val) (i32.const 65535)) (i32.const 16))
    (call $bd_unshift_small (local.get $ch) (i32.shr_u (local.get $val) (i32.const 16)) (i32.sub (local.get $w) (i32.const 16)))
  )

  (func $bd_peek_small_at (param $ch i32) (param $bitOff i32) (param $w i32) (result i32)
    (local $buf i32)
    (local $capW i32)
    (local $pos i32)
    (local $wi i32)
    (local $bo i32)
    (local $lo i32)
    (local $hiBits i32)
    (local $w1 i32)

    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return (i32.const 0))))
    (local.set $buf (i32.load (i32.add (local.get $ch) (i32.const 32))))
    (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
    (local.set $pos
      (i32.and
        (i32.add (i32.load (i32.add (local.get $ch) (i32.const 40))) (local.get $bitOff))
        (i32.sub (i32.shl (local.get $capW) (i32.const 5)) (i32.const 1))))
    (local.set $wi (i32.shr_u (local.get $pos) (i32.const 5)))
    (local.set $bo (i32.and (local.get $pos) (i32.const 31)))

    (if (i32.le_s (i32.add (local.get $bo) (local.get $w)) (i32.const 32))
      (then
        (return
          (i32.and
            (i32.shr_u
              (i32.load (i32.add (local.get $buf) (i32.shl (local.get $wi) (i32.const 2))))
              (i32.sub (i32.const 32) (i32.add (local.get $bo) (local.get $w))))
            (call $mask32 (local.get $w))))
      )
    )
    (local.set $lo (i32.sub (i32.add (local.get $bo) (local.get $w)) (i32.const 32)))
    (local.set $hiBits (i32.sub (i32.const 32) (local.get $bo)))
    (local.set $w1 (i32.and (i32.add (local.get $wi) (i32.const 1)) (i32.sub (local.get $capW) (i32.const 1))))
    (i32.or
      (i32.shl
        (i32.and
          (i32.load (i32.add (local.get $buf) (i32.shl (local.get $wi) (i32.const 2))))
          (call $mask32 (local.get $hiBits)))
        (local.get $lo))
      (i32.shr_u
        (i32.load (i32.add (local.get $buf) (i32.shl (local.get $w1) (i32.const 2))))
        (i32.sub (i32.const 32) (local.get $lo))))
  )

  (func $bd_peek_bits_at (param $ch i32) (param $bitOff i32) (param $w i32) (result i32)
    (local $hiW i32)
    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return (i32.const 0))))
    (if (i32.le_s (local.get $w) (i32.const 30))
      (then (return (call $bd_peek_small_at (local.get $ch) (local.get $bitOff) (local.get $w)))))
    (local.set $hiW (i32.sub (local.get $w) (i32.const 16)))
    (i32.or
      (i32.shl (call $bd_peek_small_at (local.get $ch) (local.get $bitOff) (local.get $hiW)) (i32.const 16))
      (call $bd_peek_small_at (local.get $ch) (i32.add (local.get $bitOff) (local.get $hiW)) (i32.const 16)))
  )

  (func $bd_shift_bits (param $ch i32) (param $w i32) (result i32)
    (local $val i32)
    (local $capW i32)
    (if (i32.le_s (local.get $w) (i32.const 0)) (then (return (i32.const 0))))
    (local.set $val (call $bd_peek_bits_at (local.get $ch) (i32.const 0) (local.get $w)))
    (local.set $capW (i32.load (i32.add (local.get $ch) (i32.const 36))))
    (i32.store (i32.add (local.get $ch) (i32.const 40))
      (i32.and
        (i32.add (i32.load (i32.add (local.get $ch) (i32.const 40))) (local.get $w))
        (i32.sub (i32.shl (local.get $capW) (i32.const 5)) (i32.const 1))))
    (i32.store (i32.add (local.get $ch) (i32.const 44))
      (i32.sub (i32.load (i32.add (local.get $ch) (i32.const 44))) (local.get $w)))
    (local.get $val)
  )

  (func $bd_push_from_deque (param $dst i32) (param $src i32)
    (local $srcLen i32)
    (local $chunk i32)
    (local $bits i32)
    (local.set $srcLen (i32.load (i32.add (local.get $src) (i32.const 44))))
    (if (i32.le_s (local.get $srcLen) (i32.const 0)) (then (return)))
    (if (i32.gt_s
          (i32.add (i32.load (i32.add (local.get $dst) (i32.const 44))) (local.get $srcLen))
          (i32.shl (i32.load (i32.add (local.get $dst) (i32.const 36))) (i32.const 5)))
      (then
        (call $bd_grow (local.get $dst) (i32.add (i32.load (i32.add (local.get $dst) (i32.const 44))) (local.get $srcLen)))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return)))))
    (block $brk
      (loop $lp
        (local.set $srcLen (i32.load (i32.add (local.get $src) (i32.const 44))))
        (br_if $brk (i32.le_s (local.get $srcLen) (i32.const 0)))
        (local.set $chunk (select (i32.const 30) (local.get $srcLen) (i32.gt_s (local.get $srcLen) (i32.const 30))))
        (local.set $bits (call $bd_shift_bits (local.get $src) (local.get $chunk)))
        (call $bd_push_small (local.get $dst) (local.get $bits) (local.get $chunk))
        (br $lp)
      )
    )
  )

  (func $bd_unshift_from_deque (param $dst i32) (param $src i32)
    (local $rem i32)
    (local $chunk i32)
    (local $bits i32)
    (local.set $rem (i32.load (i32.add (local.get $src) (i32.const 44))))
    (if (i32.le_s (local.get $rem) (i32.const 0)) (then (return)))
    (if (i32.gt_s
          (i32.add (i32.load (i32.add (local.get $dst) (i32.const 44))) (local.get $rem))
          (i32.shl (i32.load (i32.add (local.get $dst) (i32.const 36))) (i32.const 5)))
      (then
        (call $bd_grow (local.get $dst) (i32.add (i32.load (i32.add (local.get $dst) (i32.const 44))) (local.get $rem)))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return)))))
    (block $brk
      (loop $lp
        (br_if $brk (i32.le_s (local.get $rem) (i32.const 0)))
        (local.set $chunk (select (i32.const 30) (local.get $rem) (i32.gt_s (local.get $rem) (i32.const 30))))
        (local.set $bits (call $bd_peek_small_at (local.get $src) (i32.sub (local.get $rem) (local.get $chunk)) (local.get $chunk)))
        (call $bd_unshift_small (local.get $dst) (local.get $bits) (local.get $chunk))
        (local.set $rem (i32.sub (local.get $rem) (local.get $chunk)))
        (br $lp)
      )
    )
    (i32.store (i32.add (local.get $src) (i32.const 40)) (i32.const 0))
    (i32.store (i32.add (local.get $src) (i32.const 44)) (i32.const 0))
  )

  ;; O(1) adopt buffer from `src` into empty `dst`
  (func $bd_adopt_buffer (param $dst i32) (param $src i32)
    (local $dstCapW i32)
    (local $srcBuf i32)
    (local $srcCapW i32)
    (local.set $dstCapW (i32.load (i32.add (local.get $dst) (i32.const 36))))
    (local.set $srcBuf (i32.load (i32.add (local.get $src) (i32.const 32))))
    (local.set $srcCapW (i32.load (i32.add (local.get $src) (i32.const 36))))

    ;; Release dst's quota accounting for its old buffer
    (if (i32.gt_s (local.get $dstCapW) (i32.const 0))
      (then (call $quota_add_bytes (i32.sub (i32.const 0) (i32.shl (local.get $dstCapW) (i32.const 2))))))

    (if (i32.eq (local.get $srcBuf) (i32.add (local.get $src) (i32.const 48)))
      (then
        ;; `src` uses inline 128-bit buffer -> copy 4 u32 words (16 bytes) into dst's inline buffer!
        (i32.store (i32.add (local.get $dst) (i32.const 32)) (i32.add (local.get $dst) (i32.const 48)))
        (i32.store (i32.add (local.get $dst) (i32.const 48)) (i32.load (i32.add (local.get $src) (i32.const 48))))
        (i32.store (i32.add (local.get $dst) (i32.const 52)) (i32.load (i32.add (local.get $src) (i32.const 52))))
        (i32.store (i32.add (local.get $dst) (i32.const 56)) (i32.load (i32.add (local.get $src) (i32.const 56))))
        (i32.store (i32.add (local.get $dst) (i32.const 60)) (i32.load (i32.add (local.get $src) (i32.const 60))))
      )
      (else
        ;; External buffer -> zero-copy O(1) pointer transfer!
        (i32.store (i32.add (local.get $dst) (i32.const 32)) (local.get $srcBuf))
      )
    )
    (i32.store (i32.add (local.get $dst) (i32.const 36)) (local.get $srcCapW))
    (i32.store (i32.add (local.get $dst) (i32.const 40)) (i32.load (i32.add (local.get $src) (i32.const 40))))
    (i32.store (i32.add (local.get $dst) (i32.const 44)) (i32.load (i32.add (local.get $src) (i32.const 44))))

    ;; Empty src without double-freeing quota
    (i32.store (i32.add (local.get $src) (i32.const 36)) (i32.const 0))
    (i32.store (i32.add (local.get $src) (i32.const 40)) (i32.const 0))
    (i32.store (i32.add (local.get $src) (i32.const 44)) (i32.const 0))
  )

  ;; ============================================================================
  ;; 4. BitStack ADT (`<= 128b` inline + growable u32 LIFO stack)
  ;; ============================================================================
  ;; Layout (32 bytes): +0 bufPtr, +4 capWords, +8 lenBits, +12 released, +16..31 inline 4*u32

  (func $bs_alloc (result i32)
    (local $st i32)
    (local.set $st (call $alloc (i32.const 32)))
    (if (i32.eqz (local.get $st)) (then (return (i32.const 0))))
    (i32.store (local.get $st) (i32.add (local.get $st) (i32.const 16)))
    (i32.store (i32.add (local.get $st) (i32.const 4)) (i32.const 4))
    (call $quota_add_bytes (i32.const 16))
    (local.get $st)
  )

  (func $bs_release (param $st i32)
    (local $capW i32)
    (if (i32.eqz (local.get $st)) (then (return)))
    (if (i32.ne (i32.load (i32.add (local.get $st) (i32.const 12))) (i32.const 0)) (then (return)))
    (local.set $capW (i32.load (i32.add (local.get $st) (i32.const 4))))
    (if (i32.gt_s (local.get $capW) (i32.const 0))
      (then (call $quota_add_bytes (i32.sub (i32.const 0) (i32.shl (local.get $capW) (i32.const 2))))))
    (i32.store (i32.add (local.get $st) (i32.const 12)) (i32.const 1))
    (i32.store (i32.add (local.get $st) (i32.const 4)) (i32.const 0))
    (i32.store (i32.add (local.get $st) (i32.const 8)) (i32.const 0))
  )

  (func $bs_ensure (param $st i32) (param $neededBits i32)
    (local $oldW i32)
    (local $newW i32)
    (local $oldBuf i32)
    (local $newBuf i32)
    (local.set $oldW (i32.load (i32.add (local.get $st) (i32.const 4))))
    (if (i32.le_s (local.get $neededBits) (i32.shl (local.get $oldW) (i32.const 5)))
      (then (return)))
    (local.set $newW (i32.shl (local.get $oldW) (i32.const 1)))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (i32.shl (local.get $newW) (i32.const 5)) (local.get $neededBits)))
        (local.set $newW (i32.shl (local.get $newW) (i32.const 1)))
        (br $lp)
      )
    )
    (local.set $oldBuf (i32.load (local.get $st)))
    (local.set $newBuf (call $alloc (i32.shl (local.get $newW) (i32.const 2))))
    (if (i32.eqz (local.get $newBuf)) (then (return)))
    (memory.copy (local.get $newBuf) (local.get $oldBuf) (i32.shl (local.get $oldW) (i32.const 2)))
    (call $quota_add_bytes (i32.shl (i32.sub (local.get $newW) (local.get $oldW)) (i32.const 2)))
    (i32.store (local.get $st) (local.get $newBuf))
    (i32.store (i32.add (local.get $st) (i32.const 4)) (local.get $newW))
  )

  (func $bs_push (param $st i32) (param $word i32) (param $k i32)
    (local $len i32)
    (local $buf i32)
    (local $i i32)
    (local $pos i32)
    (local $addr i32)
    (local $mask i32)
    (if (i32.le_s (local.get $k) (i32.const 0)) (then (return)))
    (local.set $len (i32.load (i32.add (local.get $st) (i32.const 8))))
    (call $bs_ensure (local.get $st) (i32.add (local.get $len) (local.get $k)))
    (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return)))
    (local.set $buf (i32.load (local.get $st)))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $i) (local.get $k)))
        (local.set $pos (i32.add (local.get $len) (local.get $i)))
        (local.set $addr (i32.add (local.get $buf) (i32.shl (i32.shr_u (local.get $pos) (i32.const 5)) (i32.const 2))))
        (local.set $mask (i32.shl (i32.const 1) (i32.and (local.get $pos) (i32.const 31))))
        (if (i32.and (i32.shr_u (local.get $word) (local.get $i)) (i32.const 1))
          (then (i32.store (local.get $addr) (i32.or (i32.load (local.get $addr)) (local.get $mask))))
          (else (i32.store (local.get $addr) (i32.and (i32.load (local.get $addr)) (i32.xor (local.get $mask) (i32.const -1)))))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (i32.store (i32.add (local.get $st) (i32.const 8)) (i32.add (local.get $len) (local.get $k)))
  )

  (func $bs_peek_top (param $st i32) (param $k i32) (result i32)
    (local $len i32)
    (local $buf i32)
    (local $val i32)
    (local $i i32)
    (local $pos i32)
    (local $bit i32)
    (if (i32.le_s (local.get $k) (i32.const 0)) (then (return (i32.const 0))))
    (local.set $len (i32.load (i32.add (local.get $st) (i32.const 8))))
    (local.set $buf (i32.load (local.get $st)))
    (local.set $val (i32.const 0))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $i) (local.get $k)))
        (local.set $pos (i32.sub (i32.sub (local.get $len) (i32.const 1)) (local.get $i)))
        (local.set $bit
          (i32.and
            (i32.shr_u
              (i32.load (i32.add (local.get $buf) (i32.shl (i32.shr_u (local.get $pos) (i32.const 5)) (i32.const 2))))
              (i32.and (local.get $pos) (i32.const 31)))
            (i32.const 1)))
        (local.set $val (i32.or (i32.shl (local.get $val) (i32.const 1)) (local.get $bit)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (local.get $val)
  )

  (func $bs_pop (param $st i32) (param $k i32) (result i32)
    (local $val i32)
    (local.set $val (call $bs_peek_top (local.get $st) (local.get $k)))
    (i32.store (i32.add (local.get $st) (i32.const 8))
      (i32.sub (i32.load (i32.add (local.get $st) (i32.const 8))) (local.get $k)))
    (local.get $val)
  )

  (func $bs_clear (param $st i32)
    (i32.store (i32.add (local.get $st) (i32.const 8)) (i32.const 0))
  )

  ;; ============================================================================
  ;; 5. Resumable 1-State DPDA Steppers (`skip`, `copy`, `coerce`)
  ;; ============================================================================
  ;; DPDA result: 0=DONE, 1=NEED_BITS, 2=FAILED

  (func $dpda_alloc (param $kind i32) (param $srcSid i32) (param $dstSid i32) (result i32)
    (local $d i32)
    (local $stk i32)
    (local $cap i32)
    (local.set $cap (i32.const 32))
    (local.set $d (call $alloc (i32.const 24)))
    (if (i32.eqz (local.get $d)) (then (return (i32.const 0))))
    (local.set $stk (call $alloc (select (i32.shl (local.get $cap) (i32.const 3)) (i32.shl (local.get $cap) (i32.const 2)) (i32.eq (local.get $kind) (i32.const 2)))))
    (if (i32.eqz (local.get $stk)) (then (return (i32.const 0))))
    (i32.store (local.get $d) (local.get $kind))
    (i32.store (i32.add (local.get $d) (i32.const 4)) (local.get $stk))
    (i32.store (i32.add (local.get $d) (i32.const 8)) (local.get $cap))
    (i32.store (i32.add (local.get $d) (i32.const 12)) (i32.const 1))
    (i32.store (local.get $stk) (local.get $srcSid))
    (if (i32.eq (local.get $kind) (i32.const 2))
      (then (i32.store (i32.add (local.get $stk) (i32.const 4)) (local.get $dstSid))))
    (local.get $d)
  )

  (func $dpda_push1 (param $d i32) (param $sid i32)
    (local $len i32)
    (local $cap i32)
    (local $stk i32)
    (local $newCap i32)
    (local $newStk i32)
    (local.set $len (i32.load (i32.add (local.get $d) (i32.const 12))))
    (local.set $cap (i32.load (i32.add (local.get $d) (i32.const 8))))
    (local.set $stk (i32.load (i32.add (local.get $d) (i32.const 4))))
    (if (i32.ge_s (local.get $len) (local.get $cap))
      (then
        (local.set $newCap (i32.shl (local.get $cap) (i32.const 1)))
        (local.set $newStk (call $alloc (i32.shl (local.get $newCap) (i32.const 2))))
        (if (i32.eqz (local.get $newStk)) (then (return)))
        (memory.copy (local.get $newStk) (local.get $stk) (i32.shl (local.get $len) (i32.const 2)))
        (local.set $stk (local.get $newStk))
        (i32.store (i32.add (local.get $d) (i32.const 4)) (local.get $stk))
        (i32.store (i32.add (local.get $d) (i32.const 8)) (local.get $newCap))
      )
    )
    (i32.store (i32.add (local.get $stk) (i32.shl (local.get $len) (i32.const 2))) (local.get $sid))
    (i32.store (i32.add (local.get $d) (i32.const 12)) (i32.add (local.get $len) (i32.const 1)))
  )

  (func $dpda_push2 (param $d i32) (param $sSid i32) (param $dSid i32)
    (local $len i32)
    (local $cap i32)
    (local $stk i32)
    (local $newCap i32)
    (local $newStk i32)
    (local.set $len (i32.load (i32.add (local.get $d) (i32.const 12))))
    (local.set $cap (i32.load (i32.add (local.get $d) (i32.const 8))))
    (local.set $stk (i32.load (i32.add (local.get $d) (i32.const 4))))
    (if (i32.ge_s (local.get $len) (local.get $cap))
      (then
        (local.set $newCap (i32.shl (local.get $cap) (i32.const 1)))
        (local.set $newStk (call $alloc (i32.shl (local.get $newCap) (i32.const 3))))
        (if (i32.eqz (local.get $newStk)) (then (return)))
        (memory.copy (local.get $newStk) (local.get $stk) (i32.shl (local.get $len) (i32.const 3)))
        (local.set $stk (local.get $newStk))
        (i32.store (i32.add (local.get $d) (i32.const 4)) (local.get $stk))
        (i32.store (i32.add (local.get $d) (i32.const 8)) (local.get $newCap))
      )
    )
    (i32.store (i32.add (local.get $stk) (i32.shl (local.get $len) (i32.const 3))) (local.get $sSid))
    (i32.store (i32.add (i32.add (local.get $stk) (i32.shl (local.get $len) (i32.const 3))) (i32.const 4)) (local.get $dSid))
    (i32.store (i32.add (local.get $d) (i32.const 12)) (i32.add (local.get $len) (i32.const 1)))
  )

  ;; Step DPDA skip (dst = 0) or copy (dst != 0)
  (func $dpda_step_skip_copy (param $src i32) (param $dst i32) (param $d i32) (result i32)
    (local $len i32)
    (local $stk i32)
    (local $sid i32)
    (local $kind i32)
    (local $n i32)
    (local $w i32)
    (local $ord i32)
    (local $i i32)
    (block $brk
      (loop $lp
        (local.set $len (i32.load (i32.add (local.get $d) (i32.const 12))))
        (br_if $brk (i32.le_s (local.get $len) (i32.const 0)))
        (local.set $stk (i32.load (i32.add (local.get $d) (i32.const 4))))
        (local.set $sid (i32.load (i32.add (local.get $stk) (i32.shl (i32.sub (local.get $len) (i32.const 1)) (i32.const 2)))))
        (local.set $kind (call $schema_kind (local.get $sid)))
        (local.set $n (call $schema_num_edges (local.get $sid)))

        (if (i32.eq (local.get $kind) (i32.const 0))
          (then
            ;; closed-product: pop sid, push children in reverse order
            (i32.store (i32.add (local.get $d) (i32.const 12)) (i32.sub (local.get $len) (i32.const 1)))
            (local.set $i (i32.sub (local.get $n) (i32.const 1)))
            (block $bp
              (loop $lpp
                (br_if $bp (i32.lt_s (local.get $i) (i32.const 0)))
                (call $dpda_push1 (local.get $d) (call $schema_edge_target (local.get $sid) (local.get $i)))
                (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 2))))
                (local.set $i (i32.sub (local.get $i) (i32.const 1)))
                (br $lpp)
              )
            )
            (br $lp)
          )
        )
        ;; closed-union
        (if (i32.le_s (local.get $n) (i32.const 0)) (then (return (i32.const 2))))
        (local.set $w (call $schema_width (local.get $sid)))
        (local.set $ord (i32.const 0))
        (if (i32.gt_s (local.get $w) (i32.const 0))
          (then
            (if (i32.lt_s (i32.load (i32.add (local.get $src) (i32.const 44))) (local.get $w))
              (then (return (i32.const 1)))) ;; NEED_BITS
            (local.set $ord (call $bd_peek_bits_at (local.get $src) (i32.const 0) (local.get $w)))
            (if (i32.ge_u (local.get $ord) (local.get $n)) (then (return (i32.const 2)))) ;; FAILED
            (drop (call $bd_shift_bits (local.get $src) (local.get $w)))
            (if (i32.ne (local.get $dst) (i32.const 0))
              (then
                (call $bd_push_bits (local.get $dst) (local.get $ord) (local.get $w))
                (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 2))))))
          )
        )
        ;; Replace top of stack with target node
        (i32.store
          (i32.add (local.get $stk) (i32.shl (i32.sub (local.get $len) (i32.const 1)) (i32.const 2)))
          (call $schema_edge_target (local.get $sid) (local.get $ord)))
        (br $lp)
      )
    )
    (i32.const 0) ;; DONE
  )

  (func $dpda_step_coerce (param $src i32) (param $dst i32) (param $d i32) (result i32)
    (local $len i32)
    (local $stk i32)
    (local $sSid i32)
    (local $dSid i32)
    (local $sKind i32)
    (local $dKind i32)
    (local $sN i32)
    (local $dN i32)
    (local $sW i32)
    (local $dW i32)
    (local $sOrd i32)
    (local $dOrd i32)
    (local $tagId i32)
    (local $i i32)
    (local $entryAddr i32)

    (block $brk
      (loop $lp
        (local.set $len (i32.load (i32.add (local.get $d) (i32.const 12))))
        (br_if $brk (i32.le_s (local.get $len) (i32.const 0)))
        (local.set $stk (i32.load (i32.add (local.get $d) (i32.const 4))))
        (local.set $entryAddr (i32.add (local.get $stk) (i32.shl (i32.sub (local.get $len) (i32.const 1)) (i32.const 3))))
        (local.set $sSid (i32.load (local.get $entryAddr)))
        (local.set $dSid (i32.load (i32.add (local.get $entryAddr) (i32.const 4))))
        (local.set $sKind (call $schema_kind (local.get $sSid)))
        (local.set $dKind (call $schema_kind (local.get $dSid)))
        (if (i32.ne (local.get $sKind) (local.get $dKind)) (then (return (i32.const 2))))

        (local.set $sN (call $schema_num_edges (local.get $sSid)))
        (local.set $dN (call $schema_num_edges (local.get $dSid)))

        (if (i32.eq (local.get $sKind) (i32.const 0))
          (then
            (if (i32.ne (local.get $sN) (local.get $dN)) (then (return (i32.const 2))))
            (i32.store (i32.add (local.get $d) (i32.const 12)) (i32.sub (local.get $len) (i32.const 1)))
            (local.set $i (i32.sub (local.get $sN) (i32.const 1)))
            (block $bp
              (loop $lpp
                (br_if $bp (i32.lt_s (local.get $i) (i32.const 0)))
                (call $dpda_push2 (local.get $d)
                  (call $schema_edge_target (local.get $sSid) (local.get $i))
                  (call $schema_edge_target (local.get $dSid) (local.get $i)))
                (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 2))))
                (local.set $i (i32.sub (local.get $i) (i32.const 1)))
                (br $lpp)
              )
            )
            (br $lp)
          )
        )

        ;; closed-union coercion by tagId
        (if (i32.or (i32.le_s (local.get $sN) (i32.const 0)) (i32.le_s (local.get $dN) (i32.const 0)))
          (then (return (i32.const 2))))
        (local.set $sW (call $schema_width (local.get $sSid)))
        (local.set $sOrd (i32.const 0))
        (if (i32.gt_s (local.get $sW) (i32.const 0))
          (then
            (if (i32.lt_s (i32.load (i32.add (local.get $src) (i32.const 44))) (local.get $sW))
              (then (return (i32.const 1))))
            (local.set $sOrd (call $bd_peek_bits_at (local.get $src) (i32.const 0) (local.get $sW)))
            (if (i32.ge_u (local.get $sOrd) (local.get $sN)) (then (return (i32.const 2))))
          )
        )
        (local.set $tagId (call $schema_edge_tag (local.get $sSid) (local.get $sOrd)))
        (local.set $dOrd (call $schema_find_tag (local.get $dSid) (local.get $tagId)))
        (if (i32.lt_s (local.get $dOrd) (i32.const 0)) (then (return (i32.const 2))))
        (if (i32.gt_s (local.get $sW) (i32.const 0))
          (then (drop (call $bd_shift_bits (local.get $src) (local.get $sW)))))
        (local.set $dW (call $schema_width (local.get $dSid)))
        (if (i32.gt_s (local.get $dW) (i32.const 0))
          (then
            (call $bd_push_bits (local.get $dst) (local.get $dOrd) (local.get $dW))
            (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 2))))))
        (i32.store (local.get $entryAddr) (call $schema_edge_target (local.get $sSid) (local.get $sOrd)))
        (i32.store (i32.add (local.get $entryAddr) (i32.const 4)) (call $schema_edge_target (local.get $dSid) (local.get $dOrd)))
        (br $lp)
      )
    )
    (i32.const 0)
  )

  ;; ============================================================================
  ;; 6. Scopes, Nodes, Barriers, Tokens & O(1) Channel Splice
  ;; ============================================================================

  (func $scope_create (param $parentPtr i32) (result i32)
    (local $sc i32)
    (local.set $sc (call $alloc (i32.const 24)))
    (if (i32.eqz (local.get $sc)) (then (return (i32.const 0))))
    (i32.store (local.get $sc) (local.get $parentPtr))
    (if (i32.ne (local.get $parentPtr) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $sc) (i32.const 8)) (i32.load (i32.add (local.get $parentPtr) (i32.const 4))))
        (i32.store (i32.add (local.get $parentPtr) (i32.const 4)) (local.get $sc))
      )
    )
    (local.get $sc)
  )

  (func $barrier_alloc (result i32)
    (call $alloc (i32.const 16))
  )

  (func $token_alloc (param $outPtr i32) (param $outCount i32) (result i32)
    (local $tok i32)
    (local $copy i32)
    (local.set $tok (call $alloc (i32.const 16)))
    (if (i32.eqz (local.get $tok)) (then (return (i32.const 0))))
    (local.set $copy (call $alloc (i32.shl (local.get $outCount) (i32.const 2))))
    (if (i32.gt_s (local.get $outCount) (i32.const 0))
      (then (memory.copy (local.get $copy) (local.get $outPtr) (i32.shl (local.get $outCount) (i32.const 2)))))
    (i32.store (i32.add (local.get $tok) (i32.const 4)) (local.get $copy))
    (i32.store (i32.add (local.get $tok) (i32.const 8)) (local.get $outCount))
    (local.get $tok)
  )

  (func $node_alloc (param $scopePtr i32) (param $kind i32) (param $inCount i32) (param $outCount i32) (result i32)
    (local $n i32)
    (local $inPtr i32)
    (local $outPtr i32)
    (call $quota_add_node)
    (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 0))))
    (local.set $n (call $alloc (i32.const 64)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (i32.store (local.get $n) (local.get $kind))
    (i32.store (i32.add (local.get $n) (i32.const 8)) (local.get $scopePtr))
    (if (i32.gt_s (local.get $inCount) (i32.const 0))
      (then
        (local.set $inPtr (call $alloc (i32.shl (local.get $inCount) (i32.const 2))))
        (i32.store (i32.add (local.get $n) (i32.const 16)) (local.get $inPtr))
        (i32.store (i32.add (local.get $n) (i32.const 20)) (local.get $inCount))
      )
    )
    (if (i32.gt_s (local.get $outCount) (i32.const 0))
      (then
        (local.set $outPtr (call $alloc (i32.shl (local.get $outCount) (i32.const 2))))
        (i32.store (i32.add (local.get $n) (i32.const 24)) (local.get $outPtr))
        (i32.store (i32.add (local.get $n) (i32.const 28)) (local.get $outCount))
      )
    )
    (if (i32.ne (local.get $scopePtr) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $n) (i32.const 12)) (i32.load (i32.add (local.get $scopePtr) (i32.const 12))))
        (i32.store (i32.add (local.get $scopePtr) (i32.const 12)) (local.get $n))
      )
    )
    (local.get $n)
  )

  (func $node_set_in (param $n i32) (param $idx i32) (param $ch i32)
    (local $inPtr i32)
    (local.set $inPtr (i32.load (i32.add (local.get $n) (i32.const 16))))
    (i32.store (i32.add (local.get $inPtr) (i32.shl (local.get $idx) (i32.const 2))) (local.get $ch))
    (if (i32.ne (local.get $ch) (i32.const 0))
      (then (i32.store (i32.add (local.get $ch) (i32.const 20)) (local.get $n))))
  )

  (func $node_set_out (param $n i32) (param $idx i32) (param $ch i32)
    (local $outPtr i32)
    (local.set $outPtr (i32.load (i32.add (local.get $n) (i32.const 24))))
    (i32.store (i32.add (local.get $outPtr) (i32.shl (local.get $idx) (i32.const 2))) (local.get $ch))
    (if (i32.ne (local.get $ch) (i32.const 0))
      (then (i32.store (i32.add (local.get $ch) (i32.const 16)) (local.get $n))))
  )

  (func $node_get_in (param $n i32) (param $idx i32) (result i32)
    (i32.load (i32.add (i32.load (i32.add (local.get $n) (i32.const 16))) (i32.shl (local.get $idx) (i32.const 2))))
  )

  (func $node_get_out (param $n i32) (param $idx i32) (result i32)
    (i32.load (i32.add (i32.load (i32.add (local.get $n) (i32.const 24))) (i32.shl (local.get $idx) (i32.const 2))))
  )

  (func $retire_node (param $n i32)
    (local $i i32)
    (local $cnt i32)
    (local $ch i32)
    (local $ks i32)
    (local $arr i32)
    (if (i32.eqz (local.get $n)) (then (return)))
    (if (i32.ne (i32.load (i32.add (local.get $n) (i32.const 4))) (i32.const 0)) (then (return)))
    (i32.store (i32.add (local.get $n) (i32.const 4)) (i32.const 1))
    (call $quota_remove_node)

    ;; Release kernel-local stacks & unshift buffers
    (if (i32.eq (i32.load (local.get $n)) (i32.const 15))
      (then
        (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
        (if (i32.ne (local.get $ks) (i32.const 0))
          (then
            (local.set $cnt (i32.load (i32.add (local.get $ks) (i32.const 8))))
            (local.set $arr (i32.load (i32.add (local.get $ks) (i32.const 4))))
            (local.set $i (i32.const 0))
            (block $bs1
              (loop $ls1
                (br_if $bs1 (i32.ge_s (local.get $i) (local.get $cnt)))
                (call $bs_release (i32.load (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2)))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $ls1)
              )
            )
            (local.set $cnt (i32.load (i32.add (local.get $ks) (i32.const 16))))
            (local.set $arr (i32.load (i32.add (local.get $ks) (i32.const 12))))
            (local.set $i (i32.const 0))
            (block $bs2
              (loop $ls2
                (br_if $bs2 (i32.ge_s (local.get $i) (local.get $cnt)))
                (call $bd_release (i32.load (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2)))))
                (i32.store (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2))) (i32.const 0))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $ls2)
              )
            )
          )
        )
      )
    )

    ;; Detach input consumer pointers
    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 20))))
    (local.set $i (i32.const 0))
    (block $bi
      (loop $li
        (br_if $bi (i32.ge_s (local.get $i) (local.get $cnt)))
        (local.set $ch (call $node_get_in (local.get $n) (local.get $i)))
        (if (i32.ne (local.get $ch) (i32.const 0))
          (then
            (if (i32.eq (i32.load (i32.add (local.get $ch) (i32.const 20))) (local.get $n))
              (then (i32.store (i32.add (local.get $ch) (i32.const 20)) (i32.const 0))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $li)
      )
    )

    ;; Detach output producer pointers
    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 28))))
    (local.set $i (i32.const 0))
    (block $bo
      (loop $lo
        (br_if $bo (i32.ge_s (local.get $i) (local.get $cnt)))
        (local.set $ch (call $node_get_out (local.get $n) (local.get $i)))
        (if (i32.ne (local.get $ch) (i32.const 0))
          (then
            (if (i32.eq (i32.load (i32.add (local.get $ch) (i32.const 16))) (local.get $n))
              (then (i32.store (i32.add (local.get $ch) (i32.const 16)) (i32.const 0))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lo)
      )
    )
  )

  (func $cancel_input (param $ch i32)
    (if (i32.eqz (local.get $ch)) (then (return)))
    (i32.store (i32.add (local.get $ch) (i32.const 20)) (i32.const 0))
    (if (i32.ne (i32.load (local.get $ch)) (i32.const 0))
      (then (call $bd_release (local.get $ch))))
  )

  (func $rebind_output (param $prodNode i32) (param $oldCh i32) (param $newCh i32)
    (local $cnt i32)
    (local $arr i32)
    (local $i i32)
    (local $kind i32)
    (local $ac i32)
    (if (i32.eqz (local.get $prodNode)) (then (return)))
    ;; Update outputs array
    (local.set $cnt (i32.load (i32.add (local.get $prodNode) (i32.const 28))))
    (local.set $arr (i32.load (i32.add (local.get $prodNode) (i32.const 24))))
    (local.set $i (i32.const 0))
    (block $b1
      (loop $l1
        (br_if $b1 (i32.ge_s (local.get $i) (local.get $cnt)))
        (if (i32.eq (i32.load (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2)))) (local.get $oldCh))
          (then (i32.store (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2))) (local.get $newCh))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l1)
      )
    )
    (local.set $kind (i32.load (local.get $prodNode)))
    ;; If SWITCH, update captured envPtr slots!
    (if (i32.eq (local.get $kind) (i32.const 11))
      (then
        (local.set $arr (i32.load (i32.add (local.get $prodNode) (i32.const 36))))
        (local.set $cnt (i32.load (i32.add (local.get $prodNode) (i32.const 40))))
        (local.set $i (i32.const 0))
        (block $b2
          (loop $l2
            (br_if $b2 (i32.ge_s (local.get $i) (local.get $cnt)))
            (if (i32.eq (i32.load (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2)))) (local.get $oldCh))
              (then (i32.store (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2))) (local.get $newCh))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l2)
          )
        )
      )
    )
    ;; If SPEC with activeChild, update staged parentOut pointers!
    (if (i32.eq (local.get $kind) (i32.const 12))
      (then
        (local.set $ac (i32.load (i32.add (local.get $prodNode) (i32.const 40))))
        (if (i32.ne (local.get $ac) (i32.const 0))
          (then
            ;; ActiveChild: +12 stagedPtr (pairs [childOut, parentOut]), +16 stagedCount
            (local.set $arr (i32.load (i32.add (local.get $ac) (i32.const 12))))
            (local.set $cnt (i32.load (i32.add (local.get $ac) (i32.const 16))))
            (local.set $i (i32.const 0))
            (block $b3
              (loop $l3
                (br_if $b3 (i32.ge_s (local.get $i) (local.get $cnt)))
                (if (i32.eq (i32.load (i32.add (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 3))) (i32.const 4))) (local.get $oldCh))
                  (then (i32.store (i32.add (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 3))) (i32.const 4)) (local.get $newCh))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $l3)
              )
            )
          )
        )
      )
    )
  )

  ;; Section 3.3 O(1) Zero-Copy Channel Splice
  (func $splice (param $src i32) (param $dst i32)
    (local $srcLen i32)
    (local $dstLen i32)
    (local $srcProd i32)
    (if (i32.eq (local.get $src) (local.get $dst)) (then (return)))
    (global.set $g_splices (i32.add (global.get $g_splices) (i32.const 1)))

    (if (i32.eq (i32.load (local.get $src)) (i32.const 2))
      (then
        (call $bd_fail (local.get $dst))
        (i32.store (i32.add (local.get $src) (i32.const 16)) (i32.const 0))
        (i32.store (i32.add (local.get $src) (i32.const 20)) (i32.const 0))
        (call $bd_release (local.get $src))
        (return)
      )
    )

    (local.set $srcLen (i32.load (i32.add (local.get $src) (i32.const 44))))
    (local.set $dstLen (i32.load (i32.add (local.get $dst) (i32.const 44))))
    (if (i32.eqz (local.get $dstLen))
      (then (call $bd_adopt_buffer (local.get $dst) (local.get $src)))
      (else
        (if (i32.gt_s (local.get $srcLen) (i32.const 0))
          (then
            (if (i32.le_s (local.get $dstLen) (local.get $srcLen))
              (then
                (call $bd_unshift_from_deque (local.get $src) (local.get $dst))
                (call $bd_adopt_buffer (local.get $dst) (local.get $src))
              )
              (else
                (call $bd_push_from_deque (local.get $dst) (local.get $src))
              )
            )
          )
        )
      )
    )

    ;; Transfer producer obligation, status, and upstream node pointer
    (i32.store (i32.add (local.get $dst) (i32.const 4)) (i32.load (i32.add (local.get $src) (i32.const 4))))
    (i32.store (local.get $dst) (i32.load (local.get $src)))
    (local.set $srcProd (i32.load (i32.add (local.get $src) (i32.const 16))))
    (i32.store (i32.add (local.get $dst) (i32.const 16)) (local.get $srcProd))
    (if (i32.ne (local.get $srcProd) (i32.const 0))
      (then (call $rebind_output (local.get $srcProd) (local.get $src) (local.get $dst))))

    (i32.store (i32.add (local.get $src) (i32.const 16)) (i32.const 0))
    (i32.store (i32.add (local.get $src) (i32.const 20)) (i32.const 0))
    (call $bd_release (local.get $src))
  )

  ;; Strictly iterative scope destruction (destroys nested child scopes safely)
  (func $scope_destroy (param $rootSc i32)
    (local $stk i32)
    (local $stkCap i32)
    (local $stkLen i32)
    (local $ord i32)
    (local $ordLen i32)
    (local $sc i32)
    (local $child i32)
    (local $i i32)
    (local $n i32)
    (local $ch i32)
    (local $ac i32)
    (local $taps i32)
    (local $tapCnt i32)
    (local $t i32)

    (if (i32.eqz (local.get $rootSc)) (then (return)))
    (if (i32.ne (i32.load (i32.add (local.get $rootSc) (i32.const 20))) (i32.const 0)) (then (return)))

    (if (i32.eqz (global.get $g_sc_cap))
      (then
        (global.set $g_sc_cap (i32.const 256))
        (global.set $g_sc_stk_ptr (call $alloc (i32.const 1024)))
        (global.set $g_sc_ord_ptr (call $alloc (i32.const 1024)))
      )
    )
    (local.set $stkCap (global.get $g_sc_cap))
    (local.set $stk (global.get $g_sc_stk_ptr))
    (local.set $ord (global.get $g_sc_ord_ptr))
    (if (i32.or (i32.eqz (local.get $stk)) (i32.eqz (local.get $ord))) (then (return)))

    (i32.store (local.get $stk) (local.get $rootSc))
    (local.set $stkLen (i32.const 1))
    (local.set $ordLen (i32.const 0))

    (block $bw
      (loop $lw
        (br_if $bw (i32.le_s (local.get $stkLen) (i32.const 0)))
        (local.set $stkLen (i32.sub (local.get $stkLen) (i32.const 1)))
        (local.set $sc (i32.load (i32.add (local.get $stk) (i32.shl (local.get $stkLen) (i32.const 2)))))
        (if (i32.ne (i32.load (i32.add (local.get $sc) (i32.const 20))) (i32.const 0)) (then (br $lw)))
        (if (i32.ge_s (local.get $ordLen) (local.get $stkCap))
          (then
            (local.set $t (call $alloc (i32.shl (local.get $stkCap) (i32.const 3))))
            (if (i32.eqz (local.get $t)) (then (return)))
            (memory.copy (local.get $t) (local.get $ord) (i32.shl (local.get $ordLen) (i32.const 2)))
            (local.set $ord (local.get $t))
            (local.set $t (call $alloc (i32.shl (local.get $stkCap) (i32.const 3))))
            (if (i32.eqz (local.get $t)) (then (return)))
            (memory.copy (local.get $t) (local.get $stk) (i32.shl (local.get $stkLen) (i32.const 2)))
            (local.set $stk (local.get $t))
            (local.set $stkCap (i32.shl (local.get $stkCap) (i32.const 1)))
            (global.set $g_sc_stk_ptr (local.get $stk))
            (global.set $g_sc_ord_ptr (local.get $ord))
            (global.set $g_sc_cap (local.get $stkCap))
          )
        )
        (i32.store (i32.add (local.get $ord) (i32.shl (local.get $ordLen) (i32.const 2))) (local.get $sc))
        (local.set $ordLen (i32.add (local.get $ordLen) (i32.const 1)))
        (local.set $child (i32.load (i32.add (local.get $sc) (i32.const 4))))
        (block $bc
          (loop $lc
            (br_if $bc (i32.eqz (local.get $child)))
            (if (i32.ge_s (local.get $stkLen) (local.get $stkCap))
              (then
                (local.set $t (call $alloc (i32.shl (local.get $stkCap) (i32.const 3))))
                (if (i32.eqz (local.get $t)) (then (return)))
                (memory.copy (local.get $t) (local.get $stk) (i32.shl (local.get $stkLen) (i32.const 2)))
                (local.set $stk (local.get $t))
                (local.set $t (call $alloc (i32.shl (local.get $stkCap) (i32.const 3))))
                (if (i32.eqz (local.get $t)) (then (return)))
                (memory.copy (local.get $t) (local.get $ord) (i32.shl (local.get $ordLen) (i32.const 2)))
                (local.set $ord (local.get $t))
                (local.set $stkCap (i32.shl (local.get $stkCap) (i32.const 1)))
                (global.set $g_sc_stk_ptr (local.get $stk))
                (global.set $g_sc_ord_ptr (local.get $ord))
                (global.set $g_sc_cap (local.get $stkCap))
              )
            )
            (i32.store (i32.add (local.get $stk) (i32.shl (local.get $stkLen) (i32.const 2))) (local.get $child))
            (local.set $stkLen (i32.add (local.get $stkLen) (i32.const 1)))
            (local.set $child (i32.load (i32.add (local.get $child) (i32.const 8))))
            (br $lc)
          )
        )
        (br $lw)
      )
    )

    ;; Tear down in reverse order (children before parents)
    (local.set $i (i32.sub (local.get $ordLen) (i32.const 1)))
    (block $bd
      (loop $ld
        (br_if $bd (i32.lt_s (local.get $i) (i32.const 0)))
        (local.set $sc (i32.load (i32.add (local.get $ord) (i32.shl (local.get $i) (i32.const 2)))))
        (i32.store (i32.add (local.get $sc) (i32.const 20)) (i32.const 1))

        ;; Retire all nodes in scope
        (local.set $n (i32.load (i32.add (local.get $sc) (i32.const 12))))
        (block $bn
          (loop $ln
            (br_if $bn (i32.eqz (local.get $n)))
            ;; If SPEC with activeChild, release replay deques!
            (if (i32.eq (i32.load (local.get $n)) (i32.const 12))
              (then
                (local.set $ac (i32.load (i32.add (local.get $n) (i32.const 40))))
                (if (i32.ne (local.get $ac) (i32.const 0))
                  (then
                    (local.set $taps (i32.load (i32.add (local.get $ac) (i32.const 4))))
                    (local.set $tapCnt (i32.load (i32.add (local.get $ac) (i32.const 8))))
                    (local.set $t (i32.const 0))
                    (block $bt
                      (loop $lt
                        (br_if $bt (i32.ge_s (local.get $t) (local.get $tapCnt)))
                        ;; TapEntry (16 bytes): +0 parentCh, +4 childCh, +8 replayCh, +12 tapNode
                        (call $bd_release (i32.load (i32.add (i32.add (local.get $taps) (i32.shl (local.get $t) (i32.const 4))) (i32.const 8))))
                        (local.set $t (i32.add (local.get $t) (i32.const 1)))
                        (br $lt)
                      )
                    )
                  )
                )
              )
            )
            (call $retire_node (local.get $n))
            (local.set $n (i32.load (i32.add (local.get $n) (i32.const 12))))
            (br $ln)
          )
        )

        ;; Release all channels still attached to this scope
        (local.set $ch (i32.load (i32.add (local.get $sc) (i32.const 16))))
        (block $bch
          (loop $lch
            (br_if $bch (i32.eqz (local.get $ch)))
            (if (i32.eq (i32.load (i32.add (local.get $ch) (i32.const 24))) (local.get $sc))
              (then
                (i32.store (i32.add (local.get $ch) (i32.const 16)) (i32.const 0))
                (i32.store (i32.add (local.get $ch) (i32.const 20)) (i32.const 0))
                (call $bd_release (local.get $ch))
              )
            )
            (local.set $ch (i32.load (i32.add (local.get $ch) (i32.const 28))))
            (br $lch)
          )
        )
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (br $ld)
      )
    )
  )

  ;; ============================================================================
  ;; 7. Node Instantiation Helpers (Called by Compiled Proc Blocks!)
  ;; ============================================================================

  (func $emit_const_unit (param $sc i32) (param $dst i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 1) (i32.const 0) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_out (local.get $n) (i32.const 0) (local.get $dst))
  )

  (func $emit_splice (param $sc i32) (param $src i32) (param $dst i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 2) (i32.const 1) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_in (local.get $n) (i32.const 0) (local.get $src))
    (call $node_set_out (local.get $n) (i32.const 0) (local.get $dst))
  )

  (func $emit_coerce (param $sc i32) (param $src i32) (param $dst i32) (param $sSid i32) (param $dSid i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 3) (i32.const 1) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_in (local.get $n) (i32.const 0) (local.get $src))
    (call $node_set_out (local.get $n) (i32.const 0) (local.get $dst))
    (i32.store (i32.add (local.get $n) (i32.const 32)) (local.get $sSid))
    (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $dSid))
  )

  (func $emit_wrap (param $sc i32) (param $src i32) (param $dst i32) (param $tagId i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 4) (i32.const 1) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_in (local.get $n) (i32.const 0) (local.get $src))
    (call $node_set_out (local.get $n) (i32.const 0) (local.get $dst))
    (i32.store (i32.add (local.get $n) (i32.const 32)) (local.get $tagId))
  )

  (func $emit_match (param $sc i32) (param $src i32) (param $dst i32) (param $tagId i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 5) (i32.const 1) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_in (local.get $n) (i32.const 0) (local.get $src))
    (call $node_set_out (local.get $n) (i32.const 0) (local.get $dst))
    (i32.store (i32.add (local.get $n) (i32.const 32)) (local.get $tagId))
  )

  (func $emit_drain (param $sc i32) (param $src i32) (param $schemaId i32) (param $bar i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 9) (i32.const 1) (i32.const 0)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_in (local.get $n) (i32.const 0) (local.get $src))
    (i32.store (i32.add (local.get $n) (i32.const 32)) (local.get $schemaId))
    (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $bar))
    (i32.store (i32.add (local.get $n) (i32.const 44)) (call $dpda_alloc (i32.const 0) (local.get $schemaId) (i32.const 0)))
    (if (i32.ne (local.get $bar) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $bar) (i32.const 4)) (i32.add (i32.load (i32.add (local.get $bar) (i32.const 4))) (i32.const 1)))
        (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.load (i32.add (local.get $bar) (i32.const 8))))
        (i32.store (i32.add (local.get $bar) (i32.const 8)) (local.get $n))
      )
    )
  )

  (func $emit_gate (param $sc i32) (param $bar i32) (param $src i32) (param $dst i32)
    (local $n i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 10) (i32.const 1) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $node_set_in (local.get $n) (i32.const 0) (local.get $src))
    (call $node_set_out (local.get $n) (i32.const 0) (local.get $dst))
    (i32.store (i32.add (local.get $n) (i32.const 32)) (local.get $bar))
  )

  ;; Instantiate a kernel node (regs/stacks/unshiftBufs/temps allocated from meta!)
  (func $emit_kernel (param $sc i32) (param $kernelFuncIdx i32) (param $inCount i32) (param $outCount i32) (param $numRegs i32) (param $numStacks i32) (param $numTemps i32) (param $regInitPtr i32) (result i32)
    (local $n i32)
    (local $ks i32)
    (local $arr i32)
    (local $i i32)
    (local.set $n (call $node_alloc (local.get $sc) (i32.const 15) (local.get $inCount) (local.get $outCount)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (i32.store (i32.add (local.get $n) (i32.const 32)) (local.get $kernelFuncIdx))
    (i32.store (i32.add (local.get $n) (i32.const 36)) (i32.const 0)) ;; pc = 0 (entry)

    (local.set $ks (call $alloc (i32.const 48)))
    (if (i32.eqz (local.get $ks)) (then (return (i32.const 0))))
    (i32.store (i32.add (local.get $n) (i32.const 40)) (local.get $ks))

    (if (i32.gt_s (local.get $numRegs) (i32.const 0))
      (then
        (local.set $arr (call $alloc (i32.shl (local.get $numRegs) (i32.const 2))))
        (if (i32.ne (local.get $regInitPtr) (i32.const 0))
          (then (memory.copy (local.get $arr) (local.get $regInitPtr) (i32.shl (local.get $numRegs) (i32.const 2)))))
        (i32.store (local.get $ks) (local.get $arr))
      )
    )
    (if (i32.gt_s (local.get $numStacks) (i32.const 0))
      (then
        (local.set $arr (call $alloc (i32.shl (local.get $numStacks) (i32.const 2))))
        (i32.store (i32.add (local.get $ks) (i32.const 4)) (local.get $arr))
        (i32.store (i32.add (local.get $ks) (i32.const 8)) (local.get $numStacks))
        (local.set $i (i32.const 0))
        (block $bs
          (loop $ls
            (br_if $bs (i32.ge_s (local.get $i) (local.get $numStacks)))
            (i32.store (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2))) (call $bs_alloc))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $ls)
          )
        )
      )
    )
    (if (i32.gt_s (local.get $outCount) (i32.const 0))
      (then
        (local.set $arr (call $alloc (i32.shl (local.get $outCount) (i32.const 2))))
        (i32.store (i32.add (local.get $ks) (i32.const 12)) (local.get $arr))
        (i32.store (i32.add (local.get $ks) (i32.const 16)) (local.get $outCount))
      )
    )
    (if (i32.gt_s (local.get $numTemps) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $ks) (i32.const 20)) (call $alloc (i32.shl (local.get $numTemps) (i32.const 2))))
      )
    )
    (i32.store (i32.add (local.get $ks) (i32.const 28)) (i32.const 64)) ;; yieldThreshold = 64
    (i32.store (i32.add (local.get $ks) (i32.const 32)) (call $mask32 (local.get $inCount)))
    (i32.store (i32.add (local.get $ks) (i32.const 36)) (call $mask32 (local.get $outCount)))
    (local.get $n)
  )

  ;; ============================================================================
  ;; 8. Kernel Runtime Support Helpers (Called by Compiled Kernel Functions!)
  ;; ============================================================================

  (func $k_get_unshift_buf (param $n i32) (param $outIdx i32) (result i32)
    (local $ks i32)
    (local $arr i32)
    (local $ub i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $arr (i32.load (i32.add (local.get $ks) (i32.const 12))))
    (local.set $ub (i32.load (i32.add (local.get $arr) (i32.shl (local.get $outIdx) (i32.const 2)))))
    (if (i32.eqz (local.get $ub))
      (then
        (local.set $ub (call $chan_alloc (i32.const 0) (i32.const 0)))
        (i32.store (i32.add (local.get $arr) (i32.shl (local.get $outIdx) (i32.const 2))) (local.get $ub))
      )
    )
    (local.get $ub)
  )

  (func $k_flush_unshift_buf (param $n i32) (param $outIdx i32) (param $dst i32)
    (local $ks i32)
    (local $arr i32)
    (local $ub i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $arr (i32.load (i32.add (local.get $ks) (i32.const 12))))
    (local.set $ub (i32.load (i32.add (local.get $arr) (i32.shl (local.get $outIdx) (i32.const 2)))))
    (if (i32.eqz (local.get $ub)) (then (return)))
    (i32.store (i32.add (local.get $arr) (i32.shl (local.get $outIdx) (i32.const 2))) (i32.const 0))
    (if (i32.gt_s (i32.load (i32.add (local.get $ub) (i32.const 44))) (i32.const 0))
      (then
        (if (i32.eqz (i32.load (i32.add (local.get $dst) (i32.const 44))))
          (then (call $bd_adopt_buffer (local.get $dst) (local.get $ub)))
          (else (call $bd_push_from_deque (local.get $dst) (local.get $ub)))
        )
      )
    )
    (call $bd_release (local.get $ub))
  )

  (func $k_fail (param $n i32) (result i32)
    (local $ks i32)
    (local $inMask i32)
    (local $outMask i32)
    (local $cnt i32)
    (local $i i32)
    (local $ch i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $inMask (i32.load (i32.add (local.get $ks) (i32.const 32))))
    (local.set $outMask (i32.load (i32.add (local.get $ks) (i32.const 36))))
    ;; Snapshot before retire
    (call $retire_node (local.get $n))

    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 28))))
    (local.set $i (i32.const 0))
    (block $bo
      (loop $lo
        (br_if $bo (i32.ge_s (local.get $i) (local.get $cnt)))
        (if (i32.and (i32.shr_u (local.get $outMask) (local.get $i)) (i32.const 1))
          (then
            (local.set $ch (call $node_get_out (local.get $n) (local.get $i)))
            (if (i32.ne (local.get $ch) (i32.const 0)) (then (call $bd_fail (local.get $ch))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lo)
      )
    )

    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 20))))
    (local.set $i (i32.const 0))
    (block $bi
      (loop $li
        (br_if $bi (i32.ge_s (local.get $i) (local.get $cnt)))
        (if (i32.and (i32.shr_u (local.get $inMask) (local.get $i)) (i32.const 1))
          (then
            (local.set $ch (call $node_get_in (local.get $n) (local.get $i)))
            (call $cancel_input (local.get $ch))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $li)
      )
    )
    (i32.const 0)
  )

  ;; Kernel `drain_guard`: returns 0=done, 1=needPull, 2=failed
  (func $k_drain_guard (param $n i32) (param $inIdx i32) (param $schemaId i32) (result i32)
    (local $ks i32)
    (local $ch i32)
    (local $dpda i32)
    (local $res i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $ch (call $node_get_in (local.get $n) (local.get $inIdx)))
    (local.set $dpda (i32.load (i32.add (local.get $ks) (i32.const 24))))
    (if (i32.eqz (local.get $dpda))
      (then
        (local.set $dpda (call $dpda_alloc (i32.const 0) (local.get $schemaId) (i32.const 0)))
        (i32.store (i32.add (local.get $ks) (i32.const 24)) (local.get $dpda))
      )
    )
    (if (i32.eqz (i32.load (i32.add (local.get $dpda) (i32.const 16))))
      (then
        (local.set $res (call $dpda_step_skip_copy (local.get $ch) (i32.const 0) (local.get $dpda)))
        (if (i32.eq (local.get $res) (i32.const 1))
          (then
            (if (i32.eq (i32.load (local.get $ch)) (i32.const 0))
              (then
                (global.set $g_need_pull (local.get $ch))
                (return (i32.const 1))))
            (return (i32.const 2))))
        (if (i32.eq (local.get $res) (i32.const 2)) (then (return (i32.const 2))))
        (i32.store (i32.add (local.get $dpda) (i32.const 16)) (i32.const 1))
      )
    )
    (if (i32.eq (i32.load (local.get $ch)) (i32.const 0))
      (then
        (global.set $g_need_pull (local.get $ch))
        (return (i32.const 1))))
    (if (i32.or
          (i32.eq (i32.load (local.get $ch)) (i32.const 2))
          (i32.gt_s (i32.load (i32.add (local.get $ch) (i32.const 44))) (i32.const 0)))
      (then (return (i32.const 2))))
    (i32.store (i32.add (local.get $ks) (i32.const 24)) (i32.const 0))
    ;; Mark input disowned and release
    (i32.store (i32.add (local.get $ks) (i32.const 32))
      (i32.and (i32.load (i32.add (local.get $ks) (i32.const 32))) (i32.xor (i32.shl (i32.const 1) (local.get $inIdx)) (i32.const -1))))
    (i32.store (i32.add (local.get $ch) (i32.const 20)) (i32.const 0))
    (call $bd_release (local.get $ch))
    (i32.const 0)
  )

  ;; Kernel `dpda_copy`: returns 0=done, 1=needPull, 2=failed
  (func $k_dpda_copy (param $n i32) (param $inIdx i32) (param $outIdx i32) (param $schemaId i32) (result i32)
    (local $ks i32)
    (local $src i32)
    (local $dst i32)
    (local $dpda i32)
    (local $res i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $src (call $node_get_in (local.get $n) (local.get $inIdx)))
    (local.set $dst (call $node_get_out (local.get $n) (local.get $outIdx)))
    (local.set $dpda (i32.load (i32.add (local.get $ks) (i32.const 24))))
    (if (i32.eqz (local.get $dpda))
      (then
        (local.set $dpda (call $dpda_alloc (i32.const 1) (local.get $schemaId) (i32.const 0)))
        (i32.store (i32.add (local.get $ks) (i32.const 24)) (local.get $dpda))
      )
    )
    (local.set $res (call $dpda_step_skip_copy (local.get $src) (local.get $dst) (local.get $dpda)))
    (if (i32.eq (local.get $res) (i32.const 1))
      (then
        (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
          (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
        (return (i32.const 2))))
    (if (i32.eq (local.get $res) (i32.const 2)) (then (return (i32.const 2))))
    (i32.store (i32.add (local.get $ks) (i32.const 24)) (i32.const 0))
    (i32.const 0)
  )

  ;; Kernel `dpda_coerce`: returns 0=done, 1=needPull, 2=failed
  (func $k_dpda_coerce (param $n i32) (param $inIdx i32) (param $outIdx i32) (param $sSid i32) (param $dSid i32) (result i32)
    (local $ks i32)
    (local $src i32)
    (local $dst i32)
    (local $dpda i32)
    (local $res i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $src (call $node_get_in (local.get $n) (local.get $inIdx)))
    (local.set $dst (call $node_get_out (local.get $n) (local.get $outIdx)))
    (local.set $dpda (i32.load (i32.add (local.get $ks) (i32.const 24))))
    (if (i32.eqz (local.get $dpda))
      (then
        (local.set $dpda (call $dpda_alloc (i32.const 2) (local.get $sSid) (local.get $dSid)))
        (i32.store (i32.add (local.get $ks) (i32.const 24)) (local.get $dpda))
      )
    )
    (local.set $res (call $dpda_step_coerce (local.get $src) (local.get $dst) (local.get $dpda)))
    (if (i32.eq (local.get $res) (i32.const 1))
      (then
        (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
          (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
        (return (i32.const 2))))
    (if (i32.eq (local.get $res) (i32.const 2)) (then (return (i32.const 2))))
    (i32.store (i32.add (local.get $ks) (i32.const 24)) (i32.const 0))
    (i32.const 0)
  )

  (func $k_splice (param $n i32) (param $inIdx i32) (param $outIdx i32)
    (local $ks i32)
    (local $src i32)
    (local $dst i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $src (call $node_get_in (local.get $n) (local.get $inIdx)))
    (local.set $dst (call $node_get_out (local.get $n) (local.get $outIdx)))
    (call $k_flush_unshift_buf (local.get $n) (local.get $outIdx) (local.get $dst))
    (i32.store (i32.add (local.get $ks) (i32.const 32))
      (i32.and (i32.load (i32.add (local.get $ks) (i32.const 32))) (i32.xor (i32.shl (i32.const 1) (local.get $inIdx)) (i32.const -1))))
    (i32.store (i32.add (local.get $ks) (i32.const 36))
      (i32.and (i32.load (i32.add (local.get $ks) (i32.const 36))) (i32.xor (i32.shl (i32.const 1) (local.get $outIdx)) (i32.const -1))))
    (if (i32.eq (i32.load (i32.add (local.get $src) (i32.const 20))) (local.get $n))
      (then (i32.store (i32.add (local.get $src) (i32.const 20)) (i32.const 0))))
    (if (i32.eq (i32.load (i32.add (local.get $dst) (i32.const 16))) (local.get $n))
      (then (i32.store (i32.add (local.get $dst) (i32.const 16)) (i32.const 0))))
    (call $splice (local.get $src) (local.get $dst))
  )

  (func $k_close (param $n i32) (param $outIdx i32)
    (local $ks i32)
    (local $dst i32)
    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $dst (call $node_get_out (local.get $n) (local.get $outIdx)))
    (call $k_flush_unshift_buf (local.get $n) (local.get $outIdx) (local.get $dst))
    (i32.store (i32.add (local.get $ks) (i32.const 36))
      (i32.and (i32.load (i32.add (local.get $ks) (i32.const 36))) (i32.xor (i32.shl (i32.const 1) (local.get $outIdx)) (i32.const -1))))
    (if (i32.eq (i32.load (i32.add (local.get $dst) (i32.const 16))) (local.get $n))
      (then (i32.store (i32.add (local.get $dst) (i32.const 16)) (i32.const 0))))
    (call $bd_close (local.get $dst))
  )

  ;; Exact SWAR PEXT bit compression matching `vm.mjs` and `synthesize-tables.mjs`
  (func $compress_bits (param $raw i32) (param $rawBits i32) (param $mask i32) (result i32)
    (local $out i32)
    (local $bitPos i32)
    (local $i i32)
    (if (i32.eq (local.get $mask) (i32.const -1)) (then (return (local.get $raw))))
    (local.set $out (i32.const 0))
    (local.set $bitPos (i32.const 0))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $i) (local.get $rawBits)))
        (if (i32.and (i32.shr_u (local.get $mask) (local.get $i)) (i32.const 1))
          (then
            (local.set $out
              (i32.or (local.get $out)
                (i32.shl (i32.and (i32.shr_u (local.get $raw) (local.get $i)) (i32.const 1)) (local.get $bitPos))))
            (local.set $bitPos (i32.add (local.get $bitPos) (i32.const 1)))
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (local.get $out)
  )

  ;; Hot-burst `table_step` execution:
  ;; Returns: 0 = burst done (continue), 1 = needPull, 2 = yielded, 3 = short, 4 = fail, >= 100 = exit (100 + exitId)
  (func $exec_chunk_table_step
    (param $n i32) (param $meta i32) (param $regIdx i32)
    (param $in0Idx i32) (param $in1Idx i32) (param $out0Idx i32) (param $out1Idx i32)
    (result i32)
    (local $ks i32)
    (local $regsPtr i32)
    (local $entriesPtr i32)
    (local $numEntries i32)
    (local $numIn i32)
    (local $numOut i32)
    (local $raw0 i32)
    (local $eff0 i32)
    (local $mask0 i32)
    (local $raw1 i32)
    (local $eff1 i32)
    (local $mask1 i32)
    (local $mode0 i32)
    (local $mode1 i32)
    (local $in0 i32)
    (local $in1 i32)
    (local $out0 i32)
    (local $out1 i32)
    (local $yThresh i32)
    (local $iter i32)
    (local $idx i32)
    (local $ent i32)
    (local $kind i32)
    (local $sh i32)
    (local $elen i32)
    (local $eword i32)

    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $regsPtr (i32.load (local.get $ks)))
    (local.set $yThresh (i32.load (i32.add (local.get $ks) (i32.const 28))))
    (local.set $entriesPtr (i32.load (local.get $meta)))
    (local.set $numEntries (i32.load (i32.add (local.get $meta) (i32.const 4))))
    (if (i32.le_s (local.get $numEntries) (i32.const 0)) (then (return (i32.const 3))))

    (local.set $numIn (i32.load (i32.add (local.get $meta) (i32.const 8))))
    (local.set $numOut (i32.load (i32.add (local.get $meta) (i32.const 12))))
    (local.set $raw0 (i32.load (i32.add (local.get $meta) (i32.const 16))))
    (local.set $eff0 (i32.load (i32.add (local.get $meta) (i32.const 20))))
    (local.set $mask0 (i32.load (i32.add (local.get $meta) (i32.const 24))))
    (local.set $raw1 (i32.load (i32.add (local.get $meta) (i32.const 28))))
    (local.set $eff1 (i32.load (i32.add (local.get $meta) (i32.const 32))))
    (local.set $mask1 (i32.load (i32.add (local.get $meta) (i32.const 36))))
    (local.set $mode0 (i32.load (i32.add (local.get $meta) (i32.const 40))))
    (local.set $mode1 (i32.load (i32.add (local.get $meta) (i32.const 44))))

    (local.set $in0 (call $node_get_in (local.get $n) (local.get $in0Idx)))
    (if (i32.gt_s (local.get $numIn) (i32.const 1))
      (then (local.set $in1 (call $node_get_in (local.get $n) (local.get $in1Idx)))))
    (local.set $out0 (call $node_get_out (local.get $n) (local.get $out0Idx)))
    (if (i32.gt_s (local.get $numOut) (i32.const 1))
      (then (local.set $out1 (call $node_get_out (local.get $n) (local.get $out1Idx)))))

    (local.set $iter (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $iter) (i32.const 64)))

        ;; Cooperative yield check (ONLY for push outputs with downstream consumer!)
        (if (i32.and (i32.eqz (local.get $mode0))
              (i32.and
                (i32.ne (i32.load (i32.add (local.get $out0) (i32.const 20))) (i32.const 0))
                (i32.ge_s (i32.load (i32.add (local.get $out0) (i32.const 44))) (local.get $yThresh))))
          (then (return (i32.const 2))))
        (if (i32.gt_s (local.get $numOut) (i32.const 1))
          (then
            (if (i32.and (i32.eqz (local.get $mode1))
                  (i32.and
                    (i32.ne (i32.load (i32.add (local.get $out1) (i32.const 20))) (i32.const 0))
                    (i32.ge_s (i32.load (i32.add (local.get $out1) (i32.const 44))) (local.get $yThresh))))
              (then (return (i32.const 2))))))

        ;; Check input 0 buffer
        (if (i32.lt_s (i32.load (i32.add (local.get $in0) (i32.const 44))) (local.get $raw0))
          (then
            (if (i32.eq (i32.load (local.get $in0)) (i32.const 2)) (then (return (i32.const 4))))
            (if (i32.eq (i32.load (local.get $in0)) (i32.const 0))
              (then (global.set $g_need_pull (local.get $in0)) (return (i32.const 1))))
            (return (i32.const 3))))

        ;; Check input 1 buffer
        (if (i32.gt_s (local.get $numIn) (i32.const 1))
          (then
            (if (i32.lt_s (i32.load (i32.add (local.get $in1) (i32.const 44))) (local.get $raw1))
              (then
                (if (i32.eq (i32.load (local.get $in1)) (i32.const 2)) (then (return (i32.const 4))))
                (if (i32.eq (i32.load (local.get $in1)) (i32.const 0))
                  (then (global.set $g_need_pull (local.get $in1)) (return (i32.const 1))))
                (return (i32.const 3))))))

        ;; Build flat table index
        (local.set $idx (i32.load (i32.add (local.get $regsPtr) (i32.shl (local.get $regIdx) (i32.const 2)))))
        (local.set $idx
          (i32.or
            (i32.shl (local.get $idx) (local.get $eff0))
            (call $compress_bits (call $bd_peek_bits_at (local.get $in0) (i32.const 0) (local.get $raw0)) (local.get $raw0) (local.get $mask0))))
        (if (i32.gt_s (local.get $numIn) (i32.const 1))
          (then
            (local.set $idx
              (i32.or
                (i32.shl (local.get $idx) (local.get $eff1))
                (call $compress_bits (call $bd_peek_bits_at (local.get $in1) (i32.const 0) (local.get $raw1)) (local.get $raw1) (local.get $mask1))))))

        (global.set $g_table_lookups (i32.add (global.get $g_table_lookups) (i32.const 1)))
        (if (i32.ge_u (local.get $idx) (local.get $numEntries)) (then (return (i32.const 3))))

        (local.set $ent (i32.add (local.get $entriesPtr) (i32.shl (local.get $idx) (i32.const 4))))
        (local.set $kind (i32.load8_u (local.get $ent)))
        (if (i32.eq (local.get $kind) (i32.const 2)) (then (return (i32.const 3)))) ;; NEED_MORE -> short
        (if (i32.eq (local.get $kind) (i32.const 3)) (then (return (i32.const 4)))) ;; FAIL

        ;; Apply shifts
        (local.set $sh (i32.load8_u (i32.add (local.get $ent) (i32.const 2))))
        (if (i32.gt_s (local.get $sh) (i32.const 0)) (then (drop (call $bd_shift_bits (local.get $in0) (local.get $sh)))))
        (if (i32.gt_s (local.get $numIn) (i32.const 1))
          (then
            (local.set $sh (i32.load8_u (i32.add (local.get $ent) (i32.const 3))))
            (if (i32.gt_s (local.get $sh) (i32.const 0)) (then (drop (call $bd_shift_bits (local.get $in1) (local.get $sh)))))))

        ;; Apply emits
        (local.set $elen (i32.load8_u (i32.add (local.get $ent) (i32.const 4))))
        (if (i32.gt_s (local.get $elen) (i32.const 0))
          (then
            (local.set $eword (i32.load (i32.add (local.get $ent) (i32.const 8))))
            (if (i32.eqz (local.get $mode0))
              (then (call $bd_push_bits (local.get $out0) (local.get $eword) (local.get $elen)))
              (else (call $bd_unshift_bits (call $k_get_unshift_buf (local.get $n) (local.get $out0Idx)) (local.get $eword) (local.get $elen))))))

        (if (i32.gt_s (local.get $numOut) (i32.const 1))
          (then
            (local.set $elen (i32.load8_u (i32.add (local.get $ent) (i32.const 5))))
            (if (i32.gt_s (local.get $elen) (i32.const 0))
              (then
                (local.set $eword (i32.load (i32.add (local.get $ent) (i32.const 12))))
                (if (i32.eqz (local.get $mode1))
                  (then (call $bd_push_bits (local.get $out1) (local.get $eword) (local.get $elen)))
                  (else (call $bd_unshift_bits (call $k_get_unshift_buf (local.get $n) (local.get $out1Idx)) (local.get $eword) (local.get $elen))))))))

        ;; Update reg or EXIT!
        (if (i32.eq (local.get $kind) (i32.const 1))
          (then
            (return (i32.add (i32.const 100) (i32.load8_u (i32.add (local.get $ent) (i32.const 1)))))))

        (i32.store (i32.add (local.get $regsPtr) (i32.shl (local.get $regIdx) (i32.const 2)))
          (i32.load8_u (i32.add (local.get $ent) (i32.const 1))))

        (if (call $quota_tick_step) (then (return (i32.const 0))))
        (local.set $iter (i32.add (local.get $iter) (i32.const 1)))
        (br $lp)
      )
    )
    (i32.const 0)
  )

  ;; Hot-burst `stack_table_step`:
  ;; Returns: 0=continue, 1=needPull, 2=yielded, 3=short, 4=fail, >= 100 = exit
  (func $exec_stack_table_step
    (param $n i32) (param $meta i32) (param $regIdx i32) (param $inIdx i32) (param $stackIdx i32) (param $outIdx i32)
    (result i32)
    (local $ks i32)
    (local $regsPtr i32)
    (local $st i32)
    (local $inCh i32)
    (local $outCh i32)
    (local $entriesPtr i32)
    (local $numEntries i32)
    (local $wStream i32)
    (local $wStack i32)
    (local $stEnc i32)
    (local $stStride i32)
    (local $outMode i32)
    (local $yThresh i32)
    (local $iter i32)
    (local $q i32)
    (local $sBits i32)
    (local $stLen i32)
    (local $d i32)
    (local $stCode i32)
    (local $idx i32)
    (local $ent i32)
    (local $kind i32)
    (local $sh i32)
    (local $popN i32)
    (local $pushLen i32)
    (local $elen i32)

    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))
    (local.set $regsPtr (i32.load (local.get $ks)))
    (local.set $yThresh (i32.load (i32.add (local.get $ks) (i32.const 28))))
    (local.set $st (i32.load (i32.add (i32.load (i32.add (local.get $ks) (i32.const 4))) (i32.shl (local.get $stackIdx) (i32.const 2)))))
    (local.set $inCh (call $node_get_in (local.get $n) (local.get $inIdx)))
    (local.set $outCh (call $node_get_out (local.get $n) (local.get $outIdx)))

    (local.set $entriesPtr (i32.load (local.get $meta)))
    (local.set $numEntries (i32.load (i32.add (local.get $meta) (i32.const 4))))
    (if (i32.le_s (local.get $numEntries) (i32.const 0)) (then (return (i32.const 3))))
    (local.set $wStream (i32.load (i32.add (local.get $meta) (i32.const 8))))
    (local.set $wStack (i32.load (i32.add (local.get $meta) (i32.const 12))))
    (local.set $stEnc (i32.load (i32.add (local.get $meta) (i32.const 16))))
    (local.set $stStride (i32.load (i32.add (local.get $meta) (i32.const 20))))
    (local.set $outMode (i32.load (i32.add (local.get $meta) (i32.const 24))))

    (local.set $iter (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $iter) (i32.const 64)))
        (if (i32.and (i32.eqz (local.get $outMode))
              (i32.and
                (i32.ne (i32.load (i32.add (local.get $outCh) (i32.const 20))) (i32.const 0))
                (i32.ge_s (i32.load (i32.add (local.get $outCh) (i32.const 44))) (local.get $yThresh))))
          (then (return (i32.const 2))))

        (if (i32.lt_s (i32.load (i32.add (local.get $inCh) (i32.const 44))) (local.get $wStream))
          (then
            (if (i32.eq (i32.load (local.get $inCh)) (i32.const 2)) (then (return (i32.const 4))))
            (if (i32.eq (i32.load (local.get $inCh)) (i32.const 0))
              (then (global.set $g_need_pull (local.get $inCh)) (return (i32.const 1))))
            (return (i32.const 3))))

        (local.set $q (i32.load (i32.add (local.get $regsPtr) (i32.shl (local.get $regIdx) (i32.const 2)))))
        (local.set $sBits (call $bd_peek_bits_at (local.get $inCh) (i32.const 0) (local.get $wStream)))
        (local.set $stLen (i32.load (i32.add (local.get $st) (i32.const 8))))
        (local.set $d (select (local.get $wStack) (local.get $stLen) (i32.gt_s (local.get $stLen) (local.get $wStack))))

        (if (i32.eq (local.get $stEnc) (i32.const 1))
          (then (local.set $stCode (local.get $d)))
          (else
            (if (i32.gt_s (local.get $d) (i32.const 0))
              (then
                (local.set $stCode
                  (i32.add
                    (i32.sub (i32.shl (i32.const 1) (local.get $d)) (i32.const 1))
                    (call $bs_peek_top (local.get $st) (local.get $d)))))
              (else (local.set $stCode (i32.const 0))))))

        (local.set $idx
          (i32.add
            (i32.mul (i32.or (i32.shl (local.get $q) (local.get $wStream)) (local.get $sBits)) (local.get $stStride))
            (local.get $stCode)))

        (global.set $g_table_lookups (i32.add (global.get $g_table_lookups) (i32.const 1)))
        (if (i32.ge_u (local.get $idx) (local.get $numEntries)) (then (return (i32.const 3))))

        (local.set $ent (i32.add (local.get $entriesPtr) (i32.shl (local.get $idx) (i32.const 4))))
        (local.set $kind (i32.load8_u (local.get $ent)))
        (if (i32.eq (local.get $kind) (i32.const 2)) (then (return (i32.const 3))))
        (if (i32.eq (local.get $kind) (i32.const 3)) (then (return (i32.const 4))))

        (local.set $sh (i32.load8_u (i32.add (local.get $ent) (i32.const 2))))
        (if (i32.gt_s (local.get $sh) (i32.const 0)) (then (drop (call $bd_shift_bits (local.get $inCh) (local.get $sh)))))
        (local.set $popN (i32.load8_u (i32.add (local.get $ent) (i32.const 3))))
        (if (i32.gt_s (local.get $popN) (i32.const 0)) (then (drop (call $bs_pop (local.get $st) (local.get $popN)))))
        (local.set $pushLen (i32.load8_u (i32.add (local.get $ent) (i32.const 4))))
        (if (i32.gt_s (local.get $pushLen) (i32.const 0))
          (then (call $bs_push (local.get $st) (i32.load (i32.add (local.get $ent) (i32.const 8))) (local.get $pushLen))))
        (local.set $elen (i32.load8_u (i32.add (local.get $ent) (i32.const 5))))
        (if (i32.gt_s (local.get $elen) (i32.const 0))
          (then
            (if (i32.eqz (local.get $outMode))
              (then (call $bd_push_bits (local.get $outCh) (i32.load (i32.add (local.get $ent) (i32.const 12))) (local.get $elen)))
              (else (call $bd_unshift_bits (call $k_get_unshift_buf (local.get $n) (local.get $outIdx)) (i32.load (i32.add (local.get $ent) (i32.const 12))) (local.get $elen))))))

        (if (i32.eq (local.get $kind) (i32.const 1))
          (then (return (i32.add (i32.const 100) (i32.load8_u (i32.add (local.get $ent) (i32.const 1)))))))

        (i32.store (i32.add (local.get $regsPtr) (i32.shl (local.get $regIdx) (i32.const 2)))
          (i32.load8_u (i32.add (local.get $ent) (i32.const 1))))

        (if (call $quota_tick_step) (then (return (i32.const 0))))
        (local.set $iter (i32.add (local.get $iter) (i32.const 1)))
        (br $lp)
      )
    )
    (i32.const 0)
  )

  ;; `fsm_table_step`:
  ;; Returns: 1=needPull, 3=short, 4=fail, >= 100 = exit
  (func $exec_fsm_table_step
    (param $n i32) (param $meta i32) (param $inIdx i32) (param $out0Idx i32) (param $out1Idx i32)
    (result i32)
    (local $entriesPtr i32)
    (local $numEntries i32)
    (local $wRaw i32)
    (local $numOut i32)
    (local $mode0 i32)
    (local $mode1 i32)
    (local $inCh i32)
    (local $out0 i32)
    (local $out1 i32)
    (local $idx i32)
    (local $ent i32)
    (local $kind i32)
    (local $sh i32)
    (local $elen i32)

    (local.set $entriesPtr (i32.load (local.get $meta)))
    (local.set $numEntries (i32.load (i32.add (local.get $meta) (i32.const 4))))
    (if (i32.le_s (local.get $numEntries) (i32.const 0)) (then (return (i32.const 3))))
    (local.set $wRaw (i32.load (i32.add (local.get $meta) (i32.const 8))))
    (local.set $numOut (i32.load (i32.add (local.get $meta) (i32.const 12))))
    (local.set $mode0 (i32.load (i32.add (local.get $meta) (i32.const 16))))
    (local.set $mode1 (i32.load (i32.add (local.get $meta) (i32.const 20))))

    (local.set $inCh (call $node_get_in (local.get $n) (local.get $inIdx)))
    (local.set $out0 (call $node_get_out (local.get $n) (local.get $out0Idx)))
    (if (i32.gt_s (local.get $numOut) (i32.const 1))
      (then (local.set $out1 (call $node_get_out (local.get $n) (local.get $out1Idx)))))

    (if (i32.lt_s (i32.load (i32.add (local.get $inCh) (i32.const 44))) (local.get $wRaw))
      (then
        (if (i32.eq (i32.load (local.get $inCh)) (i32.const 2)) (then (return (i32.const 4))))
        (if (i32.eq (i32.load (local.get $inCh)) (i32.const 0))
          (then (global.set $g_need_pull (local.get $inCh)) (return (i32.const 1))))
        (return (i32.const 3))))

    (local.set $idx (call $bd_peek_bits_at (local.get $inCh) (i32.const 0) (local.get $wRaw)))
    (global.set $g_table_lookups (i32.add (global.get $g_table_lookups) (i32.const 1)))
    (if (i32.ge_u (local.get $idx) (local.get $numEntries)) (then (return (i32.const 3))))
    (local.set $ent (i32.add (local.get $entriesPtr) (i32.shl (local.get $idx) (i32.const 4))))
    (local.set $kind (i32.load8_u (local.get $ent)))
    (if (i32.eq (local.get $kind) (i32.const 2)) (then (return (i32.const 3))))
    (if (i32.eq (local.get $kind) (i32.const 3)) (then (return (i32.const 4))))

    (local.set $sh (i32.load8_u (i32.add (local.get $ent) (i32.const 2))))
    (if (i32.gt_s (local.get $sh) (i32.const 0)) (then (drop (call $bd_shift_bits (local.get $inCh) (local.get $sh)))))
    (local.set $elen (i32.load8_u (i32.add (local.get $ent) (i32.const 4))))
    (if (i32.gt_s (local.get $elen) (i32.const 0))
      (then
        (if (i32.eqz (local.get $mode0))
          (then (call $bd_push_bits (local.get $out0) (i32.load (i32.add (local.get $ent) (i32.const 8))) (local.get $elen)))
          (else (call $bd_unshift_bits (call $k_get_unshift_buf (local.get $n) (local.get $out0Idx)) (i32.load (i32.add (local.get $ent) (i32.const 8))) (local.get $elen))))))
    (if (i32.gt_s (local.get $numOut) (i32.const 1))
      (then
        (local.set $elen (i32.load8_u (i32.add (local.get $ent) (i32.const 5))))
        (if (i32.gt_s (local.get $elen) (i32.const 0))
          (then
            (if (i32.eqz (local.get $mode1))
              (then (call $bd_push_bits (local.get $out1) (i32.load (i32.add (local.get $ent) (i32.const 12))) (local.get $elen)))
              (else (call $bd_unshift_bits (call $k_get_unshift_buf (local.get $n) (local.get $out1Idx)) (i32.load (i32.add (local.get $ent) (i32.const 12))) (local.get $elen))))))))

    (i32.add (i32.const 100) (i32.load8_u (i32.add (local.get $ent) (i32.const 1))))
  )

  ;; ============================================================================
  ;; 9. Primitive Node Small-Step Transitions (100% Matching `vm.mjs`)
  ;; ============================================================================
  ;; Return convention: 0 = progress, 1 = needPull ($g_need_pull), 2 = yielded, 3 = needStepNode ($g_need_step_node)

  (func $step_const_unit (param $n i32) (result i32)
    (local $out i32)
    (local.set $out (call $node_get_out (local.get $n) (i32.const 0)))
    (call $retire_node (local.get $n))
    (call $bd_close (local.get $out))
    (i32.const 0)
  )

  (func $step_splice (param $n i32) (result i32)
    (local $src i32)
    (local $dst i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
    (call $retire_node (local.get $n))
    (call $splice (local.get $src) (local.get $dst))
    (i32.const 0)
  )

  (func $step_coerce (param $n i32) (result i32)
    (local $src i32)
    (local $dst i32)
    (local $dpda i32)
    (local $res i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
    (local.set $dpda (i32.load (i32.add (local.get $n) (i32.const 40))))
    (if (i32.eqz (local.get $dpda))
      (then
        (if (i32.and
              (i32.ne (i32.load (i32.add (local.get $src) (i32.const 12))) (i32.const 0))
              (i32.eq (i32.load (i32.add (local.get $src) (i32.const 8))) (i32.load (i32.add (local.get $dst) (i32.const 4)))))
          (then
            (call $retire_node (local.get $n))
            (call $splice (local.get $src) (local.get $dst))
            (return (i32.const 0))))
        (local.set $dpda (call $dpda_alloc (i32.const 2) (i32.load (i32.add (local.get $src) (i32.const 8))) (i32.load (i32.add (local.get $dst) (i32.const 4)))))
        (i32.store (i32.add (local.get $n) (i32.const 40)) (local.get $dpda))
      )
    )
    (local.set $res (call $dpda_step_coerce (local.get $src) (local.get $dst) (local.get $dpda)))
    (if (i32.eq (local.get $res) (i32.const 1))
      (then
        (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
          (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
        (call $retire_node (local.get $n))
        (call $bd_fail (local.get $dst))
        (call $cancel_input (local.get $src))
        (return (i32.const 0))))
    (if (i32.eq (local.get $res) (i32.const 2))
      (then
        (call $retire_node (local.get $n))
        (call $bd_fail (local.get $dst))
        (call $cancel_input (local.get $src))
        (return (i32.const 0))))
    ;; DONE: wait for src CLOSED with 0 leftover bits
    (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
      (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
    (if (i32.or (i32.eq (i32.load (local.get $src)) (i32.const 2)) (i32.gt_s (i32.load (i32.add (local.get $src) (i32.const 44))) (i32.const 0)))
      (then
        (call $retire_node (local.get $n))
        (call $bd_fail (local.get $dst))
        (call $cancel_input (local.get $src))
        (return (i32.const 0))))
    (call $retire_node (local.get $n))
    (call $bd_release (local.get $src))
    (call $bd_close (local.get $dst))
    (i32.const 0)
  )

  (func $step_wrap (param $n i32) (result i32)
    (local $src i32)
    (local $dst i32)
    (local $tagId i32)
    (local $dSid i32)
    (local $ord i32)
    (local $w i32)
    (local $targetSid i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
    (local.set $tagId (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $dSid (i32.load (i32.add (local.get $dst) (i32.const 4))))
    (local.set $ord (call $schema_find_tag (local.get $dSid) (local.get $tagId)))
    (if (i32.lt_s (local.get $ord) (i32.const 0))
      (then
        (call $retire_node (local.get $n))
        (call $bd_fail (local.get $dst))
        (call $cancel_input (local.get $src))
        (return (i32.const 0))))
    (local.set $w (call $schema_width (local.get $dSid)))
    (if (i32.gt_s (local.get $w) (i32.const 0))
      (then (call $bd_push_bits (local.get $dst) (local.get $ord) (local.get $w))))
    (local.set $targetSid (call $schema_edge_target (local.get $dSid) (local.get $ord)))
    (i32.store (i32.add (local.get $dst) (i32.const 4)) (local.get $targetSid))

    (if (i32.and
          (i32.ne (i32.load (i32.add (local.get $src) (i32.const 12))) (i32.const 0))
          (i32.eq (i32.load (i32.add (local.get $src) (i32.const 8))) (local.get $targetSid)))
      (then
        (call $retire_node (local.get $n))
        (call $splice (local.get $src) (local.get $dst))
        (return (i32.const 0))))
    ;; Degrade in-place to COERCE
    (i32.store (local.get $n) (i32.const 3))
    (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 0))
    (i32.const 0)
  )

  (func $step_match (param $n i32) (result i32)
    (local $src i32)
    (local $dst i32)
    (local $tagId i32)
    (local $sSid i32)
    (local $ord i32)
    (local $w i32)
    (local $got i32)
    (local $targetSid i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
    (local.set $tagId (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $sSid (i32.load (i32.add (local.get $src) (i32.const 8))))
    (local.set $ord (call $schema_find_tag (local.get $sSid) (local.get $tagId)))
    (if (i32.lt_s (local.get $ord) (i32.const 0))
      (then
        (call $retire_node (local.get $n))
        (call $bd_fail (local.get $dst))
        (call $cancel_input (local.get $src))
        (return (i32.const 0))))
    (local.set $w (call $schema_width (local.get $sSid)))
    (if (i32.gt_s (local.get $w) (i32.const 0))
      (then
        (if (i32.lt_s (i32.load (i32.add (local.get $src) (i32.const 44))) (local.get $w))
          (then
            (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
              (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
            (call $retire_node (local.get $n))
            (call $bd_fail (local.get $dst))
            (call $cancel_input (local.get $src))
            (return (i32.const 0))))
        (local.set $got (call $bd_peek_bits_at (local.get $src) (i32.const 0) (local.get $w)))
        (if (i32.ne (local.get $got) (local.get $ord))
          (then
            (call $retire_node (local.get $n))
            (call $bd_fail (local.get $dst))
            (call $cancel_input (local.get $src))
            (return (i32.const 0))))
        (drop (call $bd_shift_bits (local.get $src) (local.get $w)))
      )
    )
    (local.set $targetSid (call $schema_edge_target (local.get $sSid) (local.get $ord)))
    (i32.store (i32.add (local.get $src) (i32.const 8)) (local.get $targetSid))
    (i32.store (i32.add (local.get $src) (i32.const 12)) (i32.const 1))

    (if (i32.eq (local.get $targetSid) (i32.load (i32.add (local.get $dst) (i32.const 4))))
      (then
        (call $retire_node (local.get $n))
        (call $splice (local.get $src) (local.get $dst))
        (return (i32.const 0))))
    ;; Degrade in-place to COERCE
    (i32.store (local.get $n) (i32.const 3))
    (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 0))
    (i32.const 0)
  )

  (func $fail_remaining_demux (param $n i32) (param $fromIdx i32)
    (local $src i32)
    (local $cnt i32)
    (local $j i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 28))))
    (call $retire_node (local.get $n))
    (local.set $j (local.get $fromIdx))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_s (local.get $j) (local.get $cnt)))
        (call $bd_fail (call $node_get_out (local.get $n) (local.get $j)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $lp)
      )
    )
    (call $cancel_input (local.get $src))
  )

  (func $step_demux (param $n i32) (result i32)
    (local $src i32)
    (local $sid i32)
    (local $fIdx i32)
    (local $nFields i32)
    (local $muxNode i32)
    (local $i i32)
    (local $dst i32)
    (local $dpda i32)
    (local $res i32)

    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $sid (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $fIdx (i32.load (i32.add (local.get $n) (i32.const 36))))
    (local.set $nFields (i32.load (i32.add (local.get $n) (i32.const 28))))

    ;; Same-scope MUX -> DEMUX O(1) bundle fusion!
    (if (i32.and (i32.eqz (local.get $fIdx))
          (i32.and (i32.eqz (i32.load (i32.add (local.get $src) (i32.const 44))))
            (i32.ne (i32.load (i32.add (local.get $src) (i32.const 12))) (i32.const 0))))
      (then
        (local.set $muxNode (i32.load (i32.add (local.get $src) (i32.const 16))))
        (if (i32.and (i32.ne (local.get $muxNode) (i32.const 0))
              (i32.and (i32.eq (i32.load (local.get $muxNode)) (i32.const 7))
                (i32.and (i32.eq (i32.load (i32.add (local.get $muxNode) (i32.const 8))) (i32.load (i32.add (local.get $n) (i32.const 8))))
                  (i32.and (i32.eqz (i32.load (i32.add (local.get $muxNode) (i32.const 36))))
                    (i32.and
                      (i32.eq (i32.load (i32.add (local.get $src) (i32.const 8))) (i32.load (i32.add (local.get $muxNode) (i32.const 32))))
                      (i32.eq (local.get $sid) (i32.load (i32.add (local.get $muxNode) (i32.const 32)))))))))
          (then
            (if (i32.or (i32.eqz (local.get $nFields))
                  (i32.eqz (i32.load (i32.add (call $node_get_out (local.get $n) (i32.const 0)) (i32.const 44)))))
              (then
                (call $retire_node (local.get $muxNode))
                (call $retire_node (local.get $n))
                (i32.store (i32.add (local.get $src) (i32.const 16)) (i32.const 0))
                (i32.store (i32.add (local.get $src) (i32.const 20)) (i32.const 0))
                (call $bd_release (local.get $src))
                (local.set $i (i32.const 0))
                (block $bf
                  (loop $lf
                    (br_if $bf (i32.ge_s (local.get $i) (local.get $nFields)))
                    (call $splice (call $node_get_in (local.get $muxNode) (local.get $i)) (call $node_get_out (local.get $n) (local.get $i)))
                    (local.set $i (i32.add (local.get $i) (i32.const 1)))
                    (br $lf)
                  )
                )
                (global.set $g_mux_demux_fusions (i32.add (global.get $g_mux_demux_fusions) (i32.const 1)))
                (return (i32.const 0))
              )
            )
          )
        )
      )
    )

    (if (i32.eqz (local.get $nFields))
      (then
        (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
          (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
        (call $retire_node (local.get $n))
        (call $bd_release (local.get $src))
        (return (i32.const 0))))

    (if (i32.eq (local.get $nFields) (i32.const 1))
      (then
        (i32.store (i32.add (local.get $src) (i32.const 8)) (call $schema_edge_target (local.get $sid) (i32.const 0)))
        (i32.store (i32.add (local.get $src) (i32.const 12)) (i32.const 1))
        (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
        (call $retire_node (local.get $n))
        (call $splice (local.get $src) (local.get $dst))
        (return (i32.const 0))))

    ;; Copy fields 0 .. nFields - 2
    (block $bm
      (loop $lm
        (local.set $fIdx (i32.load (i32.add (local.get $n) (i32.const 36))))
        (br_if $bm (i32.ge_s (local.get $fIdx) (i32.sub (local.get $nFields) (i32.const 1))))
        (local.set $dst (call $node_get_out (local.get $n) (local.get $fIdx)))
        (local.set $dpda (i32.load (i32.add (local.get $n) (i32.const 40))))
        (if (i32.eqz (local.get $dpda))
          (then
            (local.set $dpda (call $dpda_alloc (i32.const 1) (call $schema_edge_target (local.get $sid) (local.get $fIdx)) (i32.const 0)))
            (i32.store (i32.add (local.get $n) (i32.const 40)) (local.get $dpda))
          )
        )
        (local.set $res (call $dpda_step_skip_copy (local.get $src) (local.get $dst) (local.get $dpda)))
        (if (i32.eq (local.get $res) (i32.const 1))
          (then
            (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
              (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
            (call $fail_remaining_demux (local.get $n) (local.get $fIdx))
            (return (i32.const 0))))
        (if (i32.eq (local.get $res) (i32.const 2))
          (then
            (call $fail_remaining_demux (local.get $n) (local.get $fIdx))
            (return (i32.const 0))))
        (call $bd_close (local.get $dst))
        (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 0))
        (i32.store (i32.add (local.get $n) (i32.const 36)) (i32.add (local.get $fIdx) (i32.const 1)))
        (br $lm)
      )
    )

    ;; Final field nFields - 1: O(1) tail splice!
    (local.set $fIdx (i32.sub (local.get $nFields) (i32.const 1)))
    (i32.store (i32.add (local.get $src) (i32.const 8)) (call $schema_edge_target (local.get $sid) (local.get $fIdx)))
    (i32.store (i32.add (local.get $src) (i32.const 12)) (i32.const 1))
    (local.set $dst (call $node_get_out (local.get $n) (local.get $fIdx)))
    (call $retire_node (local.get $n))
    (call $splice (local.get $src) (local.get $dst))
    (i32.const 0)
  )

  (func $step_mux (param $n i32) (result i32)
    (local $dst i32)
    (local $sid i32)
    (local $fIdx i32)
    (local $nFields i32)
    (local $demuxNode i32)
    (local $i i32)
    (local $j i32)
    (local $src i32)

    (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
    (local.set $sid (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $fIdx (i32.load (i32.add (local.get $n) (i32.const 36))))
    (local.set $nFields (i32.load (i32.add (local.get $n) (i32.const 20))))

    ;; Symmetric same-scope MUX -> DEMUX O(1) fusion
    (if (i32.and (i32.eqz (local.get $fIdx))
          (i32.and (i32.eqz (i32.load (i32.add (local.get $dst) (i32.const 44))))
            (i32.ne (i32.load (i32.add (local.get $dst) (i32.const 12))) (i32.const 0))))
      (then
        (local.set $demuxNode (i32.load (i32.add (local.get $dst) (i32.const 20))))
        (if (i32.and (i32.ne (local.get $demuxNode) (i32.const 0))
              (i32.and (i32.eq (i32.load (local.get $demuxNode)) (i32.const 6))
                (i32.and (i32.eq (i32.load (i32.add (local.get $demuxNode) (i32.const 8))) (i32.load (i32.add (local.get $n) (i32.const 8))))
                  (i32.and (i32.eqz (i32.load (i32.add (local.get $demuxNode) (i32.const 36))))
                    (i32.and
                      (i32.eq (i32.load (i32.add (local.get $dst) (i32.const 8))) (local.get $sid))
                      (i32.eq (i32.load (i32.add (local.get $demuxNode) (i32.const 32))) (local.get $sid)))))))
          (then
            (if (i32.or (i32.eqz (local.get $nFields))
                  (i32.eqz (i32.load (i32.add (call $node_get_out (local.get $demuxNode) (i32.const 0)) (i32.const 44)))))
              (then
                (call $retire_node (local.get $n))
                (call $retire_node (local.get $demuxNode))
                (i32.store (i32.add (local.get $dst) (i32.const 16)) (i32.const 0))
                (i32.store (i32.add (local.get $dst) (i32.const 20)) (i32.const 0))
                (call $bd_release (local.get $dst))
                (local.set $i (i32.const 0))
                (block $bf
                  (loop $lf
                    (br_if $bf (i32.ge_s (local.get $i) (local.get $nFields)))
                    (call $splice (call $node_get_in (local.get $n) (local.get $i)) (call $node_get_out (local.get $demuxNode) (local.get $i)))
                    (local.set $i (i32.add (local.get $i) (i32.const 1)))
                    (br $lf)
                  )
                )
                (global.set $g_mux_demux_fusions (i32.add (global.get $g_mux_demux_fusions) (i32.const 1)))
                (return (i32.const 0))
              )
            )
          )
        )
      )
    )

    (if (i32.eqz (local.get $nFields))
      (then
        (call $retire_node (local.get $n))
        (call $bd_close (local.get $dst))
        (return (i32.const 0))))

    (if (i32.eq (local.get $nFields) (i32.const 1))
      (then
        (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
        (i32.store (i32.add (local.get $dst) (i32.const 4)) (call $schema_edge_target (local.get $sid) (i32.const 0)))
        (call $retire_node (local.get $n))
        (call $splice (local.get $src) (local.get $dst))
        (return (i32.const 0))))

    (block $bm
      (loop $lm
        (local.set $fIdx (i32.load (i32.add (local.get $n) (i32.const 36))))
        (br_if $bm (i32.ge_s (local.get $fIdx) (i32.sub (local.get $nFields) (i32.const 1))))
        (local.set $src (call $node_get_in (local.get $n) (local.get $fIdx)))
        (if (i32.gt_s (i32.load (i32.add (local.get $src) (i32.const 44))) (i32.const 0))
          (then (call $bd_push_from_deque (local.get $dst) (local.get $src))))
        (if (i32.eq (i32.load (local.get $src)) (i32.const 2))
          (then
            (call $retire_node (local.get $n))
            (call $bd_fail (local.get $dst))
            (local.set $j (local.get $fIdx))
            (block $bc
              (loop $lc
                (br_if $bc (i32.ge_s (local.get $j) (local.get $nFields)))
                (call $cancel_input (call $node_get_in (local.get $n) (local.get $j)))
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (br $lc)
              )
            )
            (return (i32.const 0))))
        (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
          (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
        (i32.store (i32.add (local.get $src) (i32.const 20)) (i32.const 0))
        (call $bd_release (local.get $src))
        (i32.store (i32.add (local.get $n) (i32.const 36)) (i32.add (local.get $fIdx) (i32.const 1)))
        (br $lm)
      )
    )

    ;; Final field: O(1) tail splice!
    (local.set $fIdx (i32.sub (local.get $nFields) (i32.const 1)))
    (local.set $src (call $node_get_in (local.get $n) (local.get $fIdx)))
    (i32.store (i32.add (local.get $dst) (i32.const 4)) (call $schema_edge_target (local.get $sid) (local.get $fIdx)))
    (call $retire_node (local.get $n))
    (call $splice (local.get $src) (local.get $dst))
    (i32.const 0)
  )

  (func $step_tee (param $n i32) (result i32)
    (local $src i32)
    (local $cnt i32)
    (local $i i32)
    (local $o i32)
    (local $liveCnt i32)
    (local $only i32)
    (local $burst i32)
    (local $srcLen i32)
    (local $chunk i32)
    (local $bits i32)

    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 28))))
    (local.set $liveCnt (i32.const 0))
    (local.set $only (i32.const 0))
    (local.set $i (i32.const 0))
    (block $bl
      (loop $ll
        (br_if $bl (i32.ge_s (local.get $i) (local.get $cnt)))
        (local.set $o (call $node_get_out (local.get $n) (local.get $i)))
        (if (i32.and (i32.ne (local.get $o) (i32.const 0)) (i32.eq (i32.load (local.get $o)) (i32.const 0)))
          (then
            (local.set $liveCnt (i32.add (local.get $liveCnt) (i32.const 1)))
            (local.set $only (local.get $o))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $ll)
      )
    )

    (if (i32.eqz (local.get $liveCnt))
      (then
        (call $retire_node (local.get $n))
        (call $cancel_input (local.get $src))
        (return (i32.const 0))))

    ;; Single-survivor O(1) splice degradation
    (if (i32.and (i32.eq (local.get $liveCnt) (i32.const 1))
          (i32.and (i32.ne (i32.load (i32.add (local.get $src) (i32.const 12))) (i32.const 0))
            (i32.eq (i32.load (i32.add (local.get $src) (i32.const 8))) (i32.load (i32.add (local.get $only) (i32.const 4))))))
      (then
        (call $retire_node (local.get $n))
        (call $splice (local.get $src) (local.get $only))
        (return (i32.const 0))))

    (local.set $srcLen (i32.load (i32.add (local.get $src) (i32.const 44))))
    (if (i32.gt_s (local.get $srcLen) (i32.const 0))
      (then
        (local.set $burst (i32.const 0))
        (block $bb
          (loop $lb
            (local.set $srcLen (i32.load (i32.add (local.get $src) (i32.const 44))))
            (br_if $bb (i32.or (i32.le_s (local.get $srcLen) (i32.const 0)) (i32.ge_s (local.get $burst) (i32.const 256))))
            (local.set $chunk (select (i32.const 30) (local.get $srcLen) (i32.gt_s (local.get $srcLen) (i32.const 30))))
            (local.set $bits (call $bd_shift_bits (local.get $src) (local.get $chunk)))
            (local.set $i (i32.const 0))
            (block $bp
              (loop $lp
                (br_if $bp (i32.ge_s (local.get $i) (local.get $cnt)))
                (local.set $o (call $node_get_out (local.get $n) (local.get $i)))
                (if (i32.and (i32.ne (local.get $o) (i32.const 0)) (i32.eq (i32.load (local.get $o)) (i32.const 0)))
                  (then (call $bd_push_bits (local.get $o) (local.get $bits) (local.get $chunk))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $lp)
              )
            )
            (local.set $burst (i32.add (local.get $burst) (local.get $chunk)))
            (br $lb)
          )
        )
        (return (i32.const 0))
      )
    )

    (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
      (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))

    (local.set $i (i32.load (local.get $src))) ;; 1=CLOSED, 2=FAILED
    (call $retire_node (local.get $n))
    (call $bd_release (local.get $src))
    (local.set $burst (i32.const 0))
    (block $bf
      (loop $lf
        (br_if $bf (i32.ge_s (local.get $burst) (local.get $cnt)))
        (local.set $o (call $node_get_out (local.get $n) (local.get $burst)))
        (if (i32.and (i32.ne (local.get $o) (i32.const 0)) (i32.eq (i32.load (local.get $o)) (i32.const 0)))
          (then
            (if (i32.eq (local.get $i) (i32.const 1))
              (then (call $bd_close (local.get $o)))
              (else (call $bd_fail (local.get $o))))))
        (local.set $burst (i32.add (local.get $burst) (i32.const 1)))
        (br $lf)
      )
    )
    (i32.const 0)
  )

  (func $fail_barrier_drain (param $n i32)
    (local $src i32)
    (local $bar i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $bar (i32.load (i32.add (local.get $n) (i32.const 36))))
    (call $retire_node (local.get $n))
    (call $cancel_input (local.get $src))
    (if (i32.ne (local.get $bar) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $bar) (i32.const 4)) (i32.sub (i32.load (i32.add (local.get $bar) (i32.const 4))) (i32.const 1)))
        (i32.store (local.get $bar) (i32.const 2)) ;; FAILED
      )
    )
  )

  (func $step_drain (param $n i32) (result i32)
    (local $src i32)
    (local $bar i32)
    (local $dpda i32)
    (local $res i32)
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $bar (i32.load (i32.add (local.get $n) (i32.const 36))))
    (local.set $dpda (i32.load (i32.add (local.get $n) (i32.const 44))))

    (if (i32.eqz (i32.load (i32.add (local.get $n) (i32.const 48))))
      (then
        (local.set $res (call $dpda_step_skip_copy (local.get $src) (i32.const 0) (local.get $dpda)))
        (if (i32.eq (local.get $res) (i32.const 1))
          (then
            (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
              (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
            (call $fail_barrier_drain (local.get $n))
            (return (i32.const 0))))
        (if (i32.eq (local.get $res) (i32.const 2))
          (then
            (call $fail_barrier_drain (local.get $n))
            (return (i32.const 0))))
        (i32.store (i32.add (local.get $n) (i32.const 48)) (i32.const 1))
      )
    )
    (if (i32.eq (i32.load (local.get $src)) (i32.const 0))
      (then (global.set $g_need_pull (local.get $src)) (return (i32.const 1))))
    (if (i32.or (i32.eq (i32.load (local.get $src)) (i32.const 2)) (i32.gt_s (i32.load (i32.add (local.get $src) (i32.const 44))) (i32.const 0)))
      (then
        (call $fail_barrier_drain (local.get $n))
        (return (i32.const 0))))

    (call $retire_node (local.get $n))
    (call $bd_release (local.get $src))
    (if (i32.ne (local.get $bar) (i32.const 0))
      (then
        (local.set $res (i32.sub (i32.load (i32.add (local.get $bar) (i32.const 4))) (i32.const 1)))
        (i32.store (i32.add (local.get $bar) (i32.const 4)) (local.get $res))
        (if (i32.and (i32.eqz (i32.load (local.get $bar))) (i32.le_s (local.get $res) (i32.const 0)))
          (then (i32.store (local.get $bar) (i32.const 1)))) ;; PASSED
      )
    )
    (i32.const 0)
  )

  (func $step_gate (param $n i32) (result i32)
    (local $bar i32)
    (local $src i32)
    (local $dst i32)
    (local $st i32)
    (local $g i32)
    (local.set $bar (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $src (call $node_get_in (local.get $n) (i32.const 0)))
    (local.set $dst (call $node_get_out (local.get $n) (i32.const 0)))
    (local.set $st (i32.load (local.get $bar)))

    (if (i32.eqz (local.get $st))
      (then
        ;; Find first non-retired guard drain in barrier list
        (local.set $g (i32.load (i32.add (local.get $bar) (i32.const 8))))
        (block $bg
          (loop $lg
            (br_if $bg (i32.eqz (local.get $g)))
            (if (i32.eqz (i32.load (i32.add (local.get $g) (i32.const 4))))
              (then
                (global.set $g_need_step_node (local.get $g))
                (return (i32.const 3))))
            (local.set $g (i32.load (i32.add (local.get $g) (i32.const 40))))
            (br $lg)
          )
        )
        (i32.store (local.get $bar) (i32.const 1))
        (local.set $st (i32.const 1))
      )
    )

    (if (i32.eq (local.get $st) (i32.const 1))
      (then
        (call $retire_node (local.get $n))
        (call $splice (local.get $src) (local.get $dst))
        (return (i32.const 0))))

    ;; FAILED
    (call $retire_node (local.get $n))
    (call $bd_fail (local.get $dst))
    (call $cancel_input (local.get $src))
    (i32.const 0)
  )

  (func $fail_switch (param $n i32) (result i32)
    (local $i i32)
    (local $cnt i32)
    (call $retire_node (local.get $n))
    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 28))))
    (local.set $i (i32.const 0))
    (block $bo
      (loop $lo
        (br_if $bo (i32.ge_s (local.get $i) (local.get $cnt)))
        (call $bd_fail (call $node_get_out (local.get $n) (local.get $i)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lo)
      )
    )
    (local.set $cnt (i32.load (i32.add (local.get $n) (i32.const 20))))
    (local.set $i (i32.const 0))
    (block $bi
      (loop $li
        (br_if $bi (i32.ge_s (local.get $i) (local.get $cnt)))
        (call $cancel_input (call $node_get_in (local.get $n) (local.get $i)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $li)
      )
    )
    (i32.const 0)
  )

  (func $step_switch (param $n i32) (result i32)
    (local $desc i32)
    (local $numInsp i32)
    (local $numArms i32)
    (local $defFn i32)
    (local $testedMask i32)
    (local $inspPtr i32)
    (local $tagsPtr i32)
    (local $j i32)
    (local $ch i32)
    (local $sid i32)
    (local $w i32)
    (local $ord i32)
    (local $a i32)
    (local $armPtr i32)
    (local $armStride i32)
    (local $ok i32)
    (local $pat i32)
    (local $chosenFn i32)
    (local $sc i32)
    (local $env i32)

    (local.set $desc (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $numInsp (i32.load (local.get $desc)))
    (local.set $numArms (i32.load (i32.add (local.get $desc) (i32.const 4))))
    (local.set $defFn (i32.load (i32.add (local.get $desc) (i32.const 8))))
    (local.set $testedMask (i32.load (i32.add (local.get $desc) (i32.const 12))))
    (local.set $inspPtr (i32.load (i32.add (local.get $n) (i32.const 44))))

    ;; Scratch tag array (reuse small stack/heap allocation only when needed)
    (local.set $tagsPtr (call $alloc (i32.shl (local.get $numInsp) (i32.const 2))))
    (if (i32.eqz (local.get $tagsPtr)) (then (return (i32.const 0))))

    (local.set $j (i32.const 0))
    (block $bi
      (loop $li
        (br_if $bi (i32.ge_s (local.get $j) (local.get $numInsp)))
        (if (i32.and (i32.shr_u (local.get $testedMask) (local.get $j)) (i32.const 1))
          (then
            (local.set $ch (i32.load (i32.add (local.get $inspPtr) (i32.shl (local.get $j) (i32.const 2)))))
            (local.set $sid (i32.load (i32.add (local.get $ch) (i32.const 8))))
            (if (i32.or (i32.ne (call $schema_kind (local.get $sid)) (i32.const 1))
                  (i32.le_s (call $schema_num_edges (local.get $sid)) (i32.const 0)))
              (then (return (call $fail_switch (local.get $n)))))
            (local.set $w (call $schema_width (local.get $sid)))
            (local.set $ord (i32.const 0))
            (if (i32.gt_s (local.get $w) (i32.const 0))
              (then
                (if (i32.lt_s (i32.load (i32.add (local.get $ch) (i32.const 44))) (local.get $w))
                  (then
                    (if (i32.eq (i32.load (local.get $ch)) (i32.const 0))
                      (then (global.set $g_need_pull (local.get $ch)) (return (i32.const 1))))
                    (return (call $fail_switch (local.get $n)))))
                (local.set $ord (call $bd_peek_bits_at (local.get $ch) (i32.const 0) (local.get $w)))
              )
            )
            (if (i32.ge_u (local.get $ord) (call $schema_num_edges (local.get $sid)))
              (then (return (call $fail_switch (local.get $n)))))
            (i32.store (i32.add (local.get $tagsPtr) (i32.shl (local.get $j) (i32.const 2)))
              (call $schema_edge_tag (local.get $sid) (local.get $ord)))
          )
        )
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $li)
      )
    )

    ;; Match first matching arm
    (local.set $chosenFn (i32.const -1))
    (local.set $armStride (i32.shl (i32.add (local.get $numInsp) (i32.const 1)) (i32.const 2)))
    (local.set $a (i32.const 0))
    (block $ba
      (loop $la
        (br_if $ba (i32.ge_s (local.get $a) (local.get $numArms)))
        (local.set $armPtr (i32.add (i32.add (local.get $desc) (i32.const 16)) (i32.mul (local.get $a) (local.get $armStride))))
        (local.set $ok (i32.const 1))
        (local.set $j (i32.const 0))
        (block $bp
          (loop $lp
            (br_if $bp (i32.ge_s (local.get $j) (local.get $numInsp)))
            (local.set $pat (i32.load (i32.add (i32.add (local.get $armPtr) (i32.const 4)) (i32.shl (local.get $j) (i32.const 2)))))
            (if (i32.and (i32.ge_s (local.get $pat) (i32.const 0))
                  (i32.ne (local.get $pat) (i32.load (i32.add (local.get $tagsPtr) (i32.shl (local.get $j) (i32.const 2))))))
              (then
                (local.set $ok (i32.const 0))
                (br $bp)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $lp)
          )
        )
        (if (local.get $ok)
          (then
            (local.set $chosenFn (i32.load (local.get $armPtr)))
            (br $ba)))
        (local.set $a (i32.add (local.get $a) (i32.const 1)))
        (br $la)
      )
    )

    (if (i32.lt_s (local.get $chosenFn) (i32.const 0))
      (then (local.set $chosenFn (local.get $defFn))))
    (if (i32.lt_s (local.get $chosenFn) (i32.const 0))
      (then (return (call $fail_switch (local.get $n)))))

    (local.set $sc (i32.load (i32.add (local.get $n) (i32.const 8))))
    (local.set $env (i32.load (i32.add (local.get $n) (i32.const 36))))
    (call $retire_node (local.get $n))
    (call_indirect (type $block_fn) (local.get $sc) (local.get $env) (local.get $chosenFn))
    (i32.const 0)
  )

  (func $step_tap (param $n i32) (result i32)
    (local $parentCh i32)
    (local $childCh i32)
    (local $replay i32)
    (local $len i32)
    (local $chunk i32)
    (local $bits i32)
    (local.set $parentCh (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $replay (i32.load (i32.add (local.get $n) (i32.const 36))))
    (local.set $childCh (call $node_get_out (local.get $n) (i32.const 0)))

    (local.set $len (i32.load (i32.add (local.get $parentCh) (i32.const 44))))
    (if (i32.gt_s (local.get $len) (i32.const 0))
      (then
        (local.set $chunk (select (i32.const 30) (local.get $len) (i32.gt_s (local.get $len) (i32.const 30))))
        (local.set $bits (call $bd_shift_bits (local.get $parentCh) (local.get $chunk)))
        (call $bd_push_bits (local.get $replay) (local.get $bits) (local.get $chunk))
        (call $bd_push_bits (local.get $childCh) (local.get $bits) (local.get $chunk))
        (return (i32.const 0))))

    (if (i32.eq (i32.load (local.get $parentCh)) (i32.const 0))
      (then (global.set $g_need_pull (local.get $parentCh)) (return (i32.const 1))))

    (if (i32.eq (i32.load (local.get $parentCh)) (i32.const 1))
      (then
        (call $retire_node (local.get $n))
        (call $bd_close (local.get $childCh))
        (return (i32.const 0))))

    ;; parentCh FAILED
    (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 1)) ;; sawUpstreamFail = 1
    (call $retire_node (local.get $n))
    (call $bd_fail (local.get $childCh))
    (i32.const 0)
  )

  ;; ActiveChild struct (20 bytes):
  ;;   +0 childScope, +4 tapsPtr (16B each: parentCh, childCh, replayCh, tapNode),
  ;;   +8 tapCount, +12 stagedPtr (8B each: childOut, parentOut), +16 stagedCount
  (func $step_spec (param $n i32) (result i32)
    (local $desc i32)
    (local $numBr i32)
    (local $brIdx i32)
    (local $inCnt i32)
    (local $outCnt i32)
    (local $i i32)
    (local $pIn i32)
    (local $pOut i32)
    (local $ac i32)
    (local $childSc i32)
    (local $taps i32)
    (local $staged i32)
    (local $env i32)
    (local $replay i32)
    (local $childIn i32)
    (local $tapNode i32)
    (local $childOut i32)
    (local $anyFail i32)
    (local $upFail i32)
    (local $allClosed i32)
    (local $nextOpen i32)
    (local $te i32)
    (local $se i32)
    (local $fnIdx i32)
    (local $sc i32)

    (local.set $desc (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $numBr (i32.load (local.get $desc)))
    (local.set $brIdx (i32.load (i32.add (local.get $n) (i32.const 36))))
    (local.set $inCnt (i32.load (i32.add (local.get $n) (i32.const 20))))
    (local.set $outCnt (i32.load (i32.add (local.get $n) (i32.const 28))))

    ;; Empty choice -> fail immediately
    (if (i32.le_s (local.get $numBr) (i32.const 0))
      (then
        (call $retire_node (local.get $n))
        (local.set $i (i32.const 0))
        (block $be1 (loop $le1 (br_if $be1 (i32.ge_s (local.get $i) (local.get $outCnt)))
          (call $bd_fail (call $node_get_out (local.get $n) (local.get $i)))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $le1)))
        (local.set $i (i32.const 0))
        (block $be2 (loop $le2 (br_if $be2 (i32.ge_s (local.get $i) (local.get $inCnt)))
          (call $cancel_input (call $node_get_in (local.get $n) (local.get $i)))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $le2)))
        (return (i32.const 0))))

    ;; Immediate upstream failure check
    (local.set $i (i32.const 0))
    (block $bu
      (loop $lu
        (br_if $bu (i32.ge_s (local.get $i) (local.get $inCnt)))
        (local.set $pIn (call $node_get_in (local.get $n) (local.get $i)))
        (if (i32.eq (i32.load (local.get $pIn)) (i32.const 2))
          (then
            (global.set $g_spec_upstream_aborts (i32.add (global.get $g_spec_upstream_aborts) (i32.const 1)))
            (local.set $ac (i32.load (i32.add (local.get $n) (i32.const 40))))
            (if (i32.ne (local.get $ac) (i32.const 0))
              (then (call $scope_destroy (i32.load (local.get $ac)))))
            (call $retire_node (local.get $n))
            (local.set $i (i32.const 0))
            (block $buf (loop $luf (br_if $buf (i32.ge_s (local.get $i) (local.get $outCnt)))
              (call $bd_fail (call $node_get_out (local.get $n) (local.get $i)))
              (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $luf)))
            (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lu)
      )
    )

    (local.set $ac (i32.load (i32.add (local.get $n) (i32.const 40))))
    (if (i32.eqz (local.get $ac))
      (then
        ;; Rule 3: Last-branch tail splice!
        (if (i32.eq (local.get $brIdx) (i32.sub (local.get $numBr) (i32.const 1)))
          (then
            (global.set $g_spec_tail_splices (i32.add (global.get $g_spec_tail_splices) (i32.const 1)))
            (local.set $fnIdx (i32.load (i32.add (i32.add (local.get $desc) (i32.const 4)) (i32.shl (local.get $brIdx) (i32.const 2)))))
            (local.set $sc (i32.load (i32.add (local.get $n) (i32.const 8))))
            (local.set $env (call $alloc (i32.shl (i32.add (local.get $inCnt) (local.get $outCnt)) (i32.const 2))))
            (if (i32.gt_s (local.get $inCnt) (i32.const 0))
              (then (memory.copy (local.get $env) (i32.load (i32.add (local.get $n) (i32.const 16))) (i32.shl (local.get $inCnt) (i32.const 2)))))
            (if (i32.gt_s (local.get $outCnt) (i32.const 0))
              (then (memory.copy (i32.add (local.get $env) (i32.shl (local.get $inCnt) (i32.const 2))) (i32.load (i32.add (local.get $n) (i32.const 24))) (i32.shl (local.get $outCnt) (i32.const 2)))))
            (call $retire_node (local.get $n))
            (call_indirect (type $block_fn) (local.get $sc) (local.get $env) (local.get $fnIdx))
            (return (i32.const 0))))

        ;; Speculative branch i < k - 1: create child scope + TAPs + staging outputs
        (local.set $childSc (call $scope_create (i32.load (i32.add (local.get $n) (i32.const 8)))))
        (local.set $ac (call $alloc (i32.const 20)))
        (local.set $taps (call $alloc (i32.shl (local.get $inCnt) (i32.const 4))))
        (local.set $staged (call $alloc (i32.shl (local.get $outCnt) (i32.const 3))))
        (local.set $env (call $alloc (i32.shl (i32.add (local.get $inCnt) (local.get $outCnt)) (i32.const 2))))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 0))))

        (local.set $i (i32.const 0))
        (block $bt1
          (loop $lt1
            (br_if $bt1 (i32.ge_s (local.get $i) (local.get $inCnt)))
            (local.set $pIn (call $node_get_in (local.get $n) (local.get $i)))
            (local.set $replay (call $chan_alloc (i32.const 0) (i32.load (i32.add (local.get $pIn) (i32.const 8)))))
            (local.set $childIn (call $chan_alloc (local.get $childSc) (i32.load (i32.add (local.get $pIn) (i32.const 8)))))
            (i32.store (i32.add (local.get $childIn) (i32.const 12)) (i32.load (i32.add (local.get $pIn) (i32.const 12))))
            (local.set $tapNode (call $node_alloc (local.get $childSc) (i32.const 13) (i32.const 0) (i32.const 1)))
            (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (i32.const 0))))
            (call $node_set_out (local.get $tapNode) (i32.const 0) (local.get $childIn))
            (i32.store (i32.add (local.get $tapNode) (i32.const 32)) (local.get $pIn))
            (i32.store (i32.add (local.get $tapNode) (i32.const 36)) (local.get $replay))
            (i32.store (i32.add (local.get $pIn) (i32.const 20)) (local.get $tapNode))
            (local.set $te (i32.add (local.get $taps) (i32.shl (local.get $i) (i32.const 4))))
            (i32.store (local.get $te) (local.get $pIn))
            (i32.store (i32.add (local.get $te) (i32.const 4)) (local.get $childIn))
            (i32.store (i32.add (local.get $te) (i32.const 8)) (local.get $replay))
            (i32.store (i32.add (local.get $te) (i32.const 12)) (local.get $tapNode))
            (i32.store (i32.add (local.get $env) (i32.shl (local.get $i) (i32.const 2))) (local.get $childIn))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $lt1)
          )
        )

        (local.set $i (i32.const 0))
        (block $bs1
          (loop $ls1
            (br_if $bs1 (i32.ge_s (local.get $i) (local.get $outCnt)))
            (local.set $pOut (call $node_get_out (local.get $n) (local.get $i)))
            (local.set $childOut (call $chan_alloc (local.get $childSc) (i32.load (i32.add (local.get $pOut) (i32.const 4)))))
            (local.set $se (i32.add (local.get $staged) (i32.shl (local.get $i) (i32.const 3))))
            (i32.store (local.get $se) (local.get $childOut))
            (i32.store (i32.add (local.get $se) (i32.const 4)) (local.get $pOut))
            (i32.store (i32.add (local.get $env) (i32.shl (i32.add (local.get $inCnt) (local.get $i)) (i32.const 2))) (local.get $childOut))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $ls1)
          )
        )

        (i32.store (local.get $ac) (local.get $childSc))
        (i32.store (i32.add (local.get $ac) (i32.const 4)) (local.get $taps))
        (i32.store (i32.add (local.get $ac) (i32.const 8)) (local.get $inCnt))
        (i32.store (i32.add (local.get $ac) (i32.const 12)) (local.get $staged))
        (i32.store (i32.add (local.get $ac) (i32.const 16)) (local.get $outCnt))
        (i32.store (i32.add (local.get $n) (i32.const 40)) (local.get $ac))

        (local.set $fnIdx (i32.load (i32.add (i32.add (local.get $desc) (i32.const 4)) (i32.shl (local.get $brIdx) (i32.const 2)))))
        (call_indirect (type $block_fn) (local.get $childSc) (local.get $env) (local.get $fnIdx))
      )
    )

    ;; Inspect activeChild status
    (local.set $childSc (i32.load (local.get $ac)))
    (local.set $taps (i32.load (i32.add (local.get $ac) (i32.const 4))))
    (local.set $staged (i32.load (i32.add (local.get $ac) (i32.const 12))))

    (local.set $anyFail (i32.const 0))
    (local.set $allClosed (i32.const 1))
    (local.set $nextOpen (i32.const 0))
    (local.set $i (i32.const 0))
    (block $bchk
      (loop $lchk
        (br_if $bchk (i32.ge_s (local.get $i) (local.get $outCnt)))
        (local.set $childOut (i32.load (i32.add (local.get $staged) (i32.shl (local.get $i) (i32.const 3)))))
        (if (i32.eq (i32.load (local.get $childOut)) (i32.const 2)) (then (local.set $anyFail (i32.const 1))))
        (if (i32.ne (i32.load (local.get $childOut)) (i32.const 1)) (then (local.set $allClosed (i32.const 0))))
        (if (i32.and (i32.eqz (local.get $nextOpen)) (i32.eq (i32.load (local.get $childOut)) (i32.const 0)))
          (then (local.set $nextOpen (local.get $childOut))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lchk)
      )
    )

    (if (local.get $anyFail)
      (then
        ;; Check upstream failure
        (local.set $upFail (i32.const 0))
        (local.set $i (i32.const 0))
        (block $buf2
          (loop $luf2
            (br_if $buf2 (i32.ge_s (local.get $i) (local.get $inCnt)))
            (local.set $te (i32.add (local.get $taps) (i32.shl (local.get $i) (i32.const 4))))
            (local.set $pIn (i32.load (local.get $te)))
            (local.set $tapNode (i32.load (i32.add (local.get $te) (i32.const 12))))
            (if (i32.or (i32.eq (i32.load (local.get $pIn)) (i32.const 2))
                  (i32.ne (i32.load (i32.add (local.get $tapNode) (i32.const 40))) (i32.const 0)))
              (then (local.set $upFail (i32.const 1)) (br $buf2)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $luf2)
          )
        )

        (if (local.get $upFail)
          (then
            ;; Rule 1: Upstream failure abort!
            (global.set $g_spec_upstream_aborts (i32.add (global.get $g_spec_upstream_aborts) (i32.const 1)))
            (local.set $i (i32.const 0))
            (block $bua (loop $lua (br_if $bua (i32.ge_s (local.get $i) (local.get $inCnt)))
              (local.set $te (i32.add (local.get $taps) (i32.shl (local.get $i) (i32.const 4))))
              (local.set $pIn (i32.load (local.get $te)))
              (if (i32.eq (i32.load (i32.add (local.get $pIn) (i32.const 20))) (i32.load (i32.add (local.get $te) (i32.const 12))))
                (then (i32.store (i32.add (local.get $pIn) (i32.const 20)) (i32.const 0))))
              (call $bd_release (i32.load (i32.add (local.get $te) (i32.const 8))))
              (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lua)))
            (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 0))
            (call $scope_destroy (local.get $childSc))
            (call $retire_node (local.get $n))
            (local.set $i (i32.const 0))
            (block $bua2 (loop $lua2 (br_if $bua2 (i32.ge_s (local.get $i) (local.get $outCnt)))
              (call $bd_fail (call $node_get_out (local.get $n) (local.get $i)))
              (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lua2)))
            (return (i32.const 0))))

        ;; Rule 2: Local mismatch rollback with bit-exact replay!
        (global.set $g_spec_rollbacks (i32.add (global.get $g_spec_rollbacks) (i32.const 1)))
        (local.set $i (i32.const 0))
        (block $brb1 (loop $lrb1 (br_if $brb1 (i32.ge_s (local.get $i) (local.get $inCnt)))
          (local.set $te (i32.add (local.get $taps) (i32.shl (local.get $i) (i32.const 4))))
          (local.set $pIn (i32.load (local.get $te)))
          (if (i32.eq (i32.load (i32.add (local.get $pIn) (i32.const 20))) (i32.load (i32.add (local.get $te) (i32.const 12))))
            (then (i32.store (i32.add (local.get $pIn) (i32.const 20)) (local.get $n))))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lrb1)))

        (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 0))
        (call $scope_destroy (local.get $childSc))

        (local.set $i (i32.const 0))
        (block $brb2 (loop $lrb2 (br_if $brb2 (i32.ge_s (local.get $i) (local.get $inCnt)))
          (local.set $te (i32.add (local.get $taps) (i32.shl (local.get $i) (i32.const 4))))
          (local.set $pIn (i32.load (local.get $te)))
          (local.set $replay (i32.load (i32.add (local.get $te) (i32.const 8))))
          (call $bd_unshift_from_deque (local.get $pIn) (local.get $replay))
          (call $bd_release (local.get $replay))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lrb2)))

        (i32.store (i32.add (local.get $n) (i32.const 36)) (i32.add (local.get $brIdx) (i32.const 1)))
        (return (i32.const 0))
      )
    )

    ;; Commit when all staged outputs are CLOSED
    (if (local.get $allClosed)
      (then
        (local.set $i (i32.const 0))
        (block $bcm1 (loop $lcm1 (br_if $bcm1 (i32.ge_s (local.get $i) (local.get $inCnt)))
          (local.set $te (i32.add (local.get $taps) (i32.shl (local.get $i) (i32.const 4))))
          (local.set $pIn (i32.load (local.get $te)))
          (local.set $childIn (i32.load (i32.add (local.get $te) (i32.const 4))))
          (if (i32.gt_s (i32.load (i32.add (local.get $childIn) (i32.const 44))) (i32.const 0))
            (then (call $bd_unshift_from_deque (local.get $pIn) (local.get $childIn))))
          (if (i32.eq (i32.load (i32.add (local.get $pIn) (i32.const 20))) (i32.load (i32.add (local.get $te) (i32.const 12))))
            (then (i32.store (i32.add (local.get $pIn) (i32.const 20)) (i32.const 0))))
          (call $bd_release (i32.load (i32.add (local.get $te) (i32.const 8))))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lcm1)))

        ;; Detach staged outputs from childScope so scope_destroy won't release them prematurely
        (local.set $i (i32.const 0))
        (block $bcm2 (loop $lcm2 (br_if $bcm2 (i32.ge_s (local.get $i) (local.get $outCnt)))
          (local.set $childOut (i32.load (i32.add (local.get $staged) (i32.shl (local.get $i) (i32.const 3)))))
          (i32.store (i32.add (local.get $childOut) (i32.const 24)) (i32.const 0))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lcm2)))

        (i32.store (i32.add (local.get $n) (i32.const 40)) (i32.const 0))
        (call $retire_node (local.get $n))

        (local.set $i (i32.const 0))
        (block $bcm3 (loop $lcm3 (br_if $bcm3 (i32.ge_s (local.get $i) (local.get $outCnt)))
          (local.set $se (i32.add (local.get $staged) (i32.shl (local.get $i) (i32.const 3))))
          (call $splice (i32.load (local.get $se)) (i32.load (i32.add (local.get $se) (i32.const 4))))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $lcm3)))

        (call $scope_destroy (local.get $childSc))
        (return (i32.const 0))
      )
    )

    ;; Pull first still-OPEN staged output
    (global.set $g_need_pull (local.get $nextOpen))
    (i32.const 1)
  )

  (func $step_spawn (param $n i32) (result i32)
    (local $tok i32)
    (local $tokOutPtr i32)
    (local $tokOutCnt i32)
    (local $i i32)
    (local $ch i32)
    (local $fnIdx i32)
    (local $sc i32)
    (local $inCnt i32)
    (local $outCnt i32)
    (local $env i32)

    ;; Check `after %tok` settlement first!
    (local.set $tok (i32.load (i32.add (local.get $n) (i32.const 36))))
    (if (i32.and (i32.ne (local.get $tok) (i32.const 0)) (i32.eqz (i32.load (local.get $tok))))
      (then
        (local.set $tokOutPtr (i32.load (i32.add (local.get $tok) (i32.const 4))))
        (local.set $tokOutCnt (i32.load (i32.add (local.get $tok) (i32.const 8))))
        (local.set $i (i32.const 0))
        (block $bt
          (loop $lt
            (br_if $bt (i32.ge_s (local.get $i) (local.get $tokOutCnt)))
            (local.set $ch (i32.load (i32.add (local.get $tokOutPtr) (i32.shl (local.get $i) (i32.const 2)))))
            (if (i32.eq (i32.load (local.get $ch)) (i32.const 0))
              (then
                (global.set $g_need_pull (local.get $ch))
                (return (i32.const 1))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $lt)
          )
        )
        (i32.store (local.get $tok) (i32.const 1))
        (global.set $g_after_settlements (i32.add (global.get $g_after_settlements) (i32.const 1)))
      )
    )

    (local.set $fnIdx (i32.load (i32.add (local.get $n) (i32.const 32))))
    (local.set $sc (i32.load (i32.add (local.get $n) (i32.const 8))))
    (local.set $inCnt (i32.load (i32.add (local.get $n) (i32.const 20))))
    (local.set $outCnt (i32.load (i32.add (local.get $n) (i32.const 28))))
    (local.set $env (call $alloc (i32.shl (i32.add (local.get $inCnt) (local.get $outCnt)) (i32.const 2))))
    (if (i32.gt_s (local.get $inCnt) (i32.const 0))
      (then (memory.copy (local.get $env) (i32.load (i32.add (local.get $n) (i32.const 16))) (i32.shl (local.get $inCnt) (i32.const 2)))))
    (if (i32.gt_s (local.get $outCnt) (i32.const 0))
      (then (memory.copy (i32.add (local.get $env) (i32.shl (local.get $inCnt) (i32.const 2))) (i32.load (i32.add (local.get $n) (i32.const 24))) (i32.shl (local.get $outCnt) (i32.const 2)))))

    (call $retire_node (local.get $n))
    (call_indirect (type $block_fn) (local.get $sc) (local.get $env) (local.get $fnIdx))
    (i32.const 0)
  )

  (func $step_node (param $n i32) (result i32)
    (if (call $quota_tick_step) (then (return (i32.const 0))))
    (global.set $g_need_pull (i32.const 0))
    (global.set $g_need_step_node (i32.const 0))
    (block $b15
      (block $b14
        (block $b13
          (block $b12
            (block $b11
              (block $b10
                (block $b9
                  (block $b8
                    (block $b7
                      (block $b6
                        (block $b5
                          (block $b4
                            (block $b3
                              (block $b2
                                (block $b1
                                  (block $b0
                                    (br_table $b0 $b1 $b2 $b3 $b4 $b5 $b6 $b7 $b8 $b9 $b10 $b11 $b12 $b13 $b14 $b15
                                      (i32.load (local.get $n)))
                                  )
                                  (return (i32.const 0)) ;; 0 invalid
                                )
                                (return (call $step_const_unit (local.get $n))) ;; 1
                              )
                              (return (call $step_splice (local.get $n))) ;; 2
                            )
                            (return (call $step_coerce (local.get $n))) ;; 3
                          )
                          (return (call $step_wrap (local.get $n))) ;; 4
                        )
                        (return (call $step_match (local.get $n))) ;; 5
                      )
                      (return (call $step_demux (local.get $n))) ;; 6
                    )
                    (return (call $step_mux (local.get $n))) ;; 7
                  )
                  (return (call $step_tee (local.get $n))) ;; 8
                )
                (return (call $step_drain (local.get $n))) ;; 9
              )
              (return (call $step_gate (local.get $n))) ;; 10
            )
            (return (call $step_switch (local.get $n))) ;; 11
          )
          (return (call $step_spec (local.get $n))) ;; 12
        )
        (return (call $step_tap (local.get $n))) ;; 13
      )
      (return (call $step_spawn (local.get $n))) ;; 14
    )
    ;; 15: KERNEL
    (call_indirect (type $kernel_fn) (local.get $n) (i32.load (i32.add (local.get $n) (i32.const 32))))
  )

  ;; ============================================================================
  ;; 10. Strictly Iterative Demand-Driven Pull Scheduler & Wire Framing
  ;; ============================================================================

  (func $dstack_push (param $kind i32) (param $ptr i32)
    (local $len i32)
    (local $cap i32)
    (local $p i32)
    (local $newCap i32)
    (local $newP i32)
    (local.set $len (global.get $g_dstack_len))
    (local.set $cap (global.get $g_dstack_cap))
    (local.set $p (global.get $g_dstack_ptr))
    (if (i32.ge_s (local.get $len) (local.get $cap))
      (then
        (local.set $newCap (select (i32.shl (local.get $cap) (i32.const 1)) (i32.const 256) (i32.gt_s (local.get $cap) (i32.const 0))))
        (local.set $newP (call $alloc (i32.shl (local.get $newCap) (i32.const 3))))
        (if (i32.eqz (local.get $newP)) (then (return)))
        (if (i32.gt_s (local.get $len) (i32.const 0))
          (then (memory.copy (local.get $newP) (local.get $p) (i32.shl (local.get $len) (i32.const 3)))))
        (local.set $p (local.get $newP))
        (global.set $g_dstack_ptr (local.get $p))
        (global.set $g_dstack_cap (local.get $newCap))
      )
    )
    (i32.store (i32.add (local.get $p) (i32.shl (local.get $len) (i32.const 3))) (local.get $kind))
    (i32.store (i32.add (i32.add (local.get $p) (i32.shl (local.get $len) (i32.const 3))) (i32.const 4)) (local.get $ptr))
    (global.set $g_dstack_len (i32.add (local.get $len) (i32.const 1)))
  )

  (func $drive_to_completion (param $rootOut i32)
    (local $topAddr i32)
    (local $topKind i32)
    (local $topPtr i32)
    (local $targetNode i32)
    (local $outcome i32)
    (local $pullCh i32)

    (block $bouter
      (loop $louter
        (br_if $bouter (i32.ne (global.get $g_error_code) (i32.const 0)))
        (br_if $bouter (i32.ne (i32.load (local.get $rootOut)) (i32.const 0)))
        (if (i32.eqz (i32.load (i32.add (local.get $rootOut) (i32.const 16))))
          (then
            (global.set $g_error_code (i32.const -7))
            (return)))
        (global.set $g_dstack_len (i32.const 0))
        (call $dstack_push (i32.const 0) (local.get $rootOut))

        (block $binner
          (loop $linner
            (br_if $binner (i32.ne (global.get $g_error_code) (i32.const 0)))
            (br_if $binner (i32.le_s (global.get $g_dstack_len) (i32.const 0)))
            (local.set $topAddr (i32.add (global.get $g_dstack_ptr) (i32.shl (i32.sub (global.get $g_dstack_len) (i32.const 1)) (i32.const 3))))
            (local.set $topKind (i32.load (local.get $topAddr)))
            (local.set $topPtr (i32.load (i32.add (local.get $topAddr) (i32.const 4))))

            (if (i32.eqz (local.get $topKind))
              (then
                ;; Channel frame
                (if (i32.or (i32.ne (i32.load (local.get $topPtr)) (i32.const 0))
                      (i32.eqz (i32.load (i32.add (local.get $topPtr) (i32.const 16)))))
                  (then
                    (global.set $g_dstack_len (i32.sub (global.get $g_dstack_len) (i32.const 1)))
                    (br $linner)))
                (local.set $targetNode (i32.load (i32.add (local.get $topPtr) (i32.const 16))))
              )
              (else
                ;; Node frame
                (if (i32.ne (i32.load (i32.add (local.get $topPtr) (i32.const 4))) (i32.const 0))
                  (then
                    (global.set $g_dstack_len (i32.sub (global.get $g_dstack_len) (i32.const 1)))
                    (br $linner)))
                (local.set $targetNode (local.get $topPtr))
              )
            )

            (local.set $outcome (call $step_node (local.get $targetNode)))
            (br_if $binner (i32.ne (global.get $g_error_code) (i32.const 0)))

            (if (i32.eq (local.get $outcome) (i32.const 1))
              (then
                (local.set $pullCh (global.get $g_need_pull))
                (if (i32.and (i32.eq (i32.load (local.get $pullCh)) (i32.const 0))
                      (i32.eqz (i32.load (i32.add (local.get $pullCh) (i32.const 16)))))
                  (then
                    (global.set $g_error_code (i32.const -7))
                    (return)))
                (call $dstack_push (i32.const 0) (local.get $pullCh))
                (br $linner)))

            (if (i32.eq (local.get $outcome) (i32.const 3))
              (then
                (call $dstack_push (i32.const 1) (global.get $g_need_step_node))
                (br $linner)))

            (if (i32.eq (local.get $outcome) (i32.const 2))
              (then
                (global.set $g_dstack_len (i32.sub (global.get $g_dstack_len) (i32.const 1)))
                (br $linner)))

            ;; Normal progress
            (if (i32.eqz (local.get $topKind))
              (then
                (if (i32.or (i32.ne (i32.load (local.get $topPtr)) (i32.const 0))
                      (i32.and (i32.gt_s (global.get $g_dstack_len) (i32.const 1))
                        (i32.gt_s (i32.load (i32.add (local.get $topPtr) (i32.const 44))) (i32.const 0))))
                  (then (global.set $g_dstack_len (i32.sub (global.get $g_dstack_len) (i32.const 1)))))
              )
              (else
                (if (i32.ne (i32.load (i32.add (local.get $topPtr) (i32.const 4))) (i32.const 0))
                  (then (global.set $g_dstack_len (i32.sub (global.get $g_dstack_len) (i32.const 1)))))
              )
            )
            (br $linner)
          )
        )
        (br $louter)
      )
    )
  )

  ;; Bulk load raw bytes into a BitDeque starting at `bitOffset` for `totalBits` bits
  (func $bd_load_bytes_at (param $ch i32) (param $bytePtr i32) (param $bitOff i32) (param $totalBits i32)
    (local $rem i32)
    (local $pos i32)
    (local $bIdx i32)
    (local $bOff i32)
    (local $avail i32)
    (local $take i32)
    (local $byteVal i32)
    (local $bits i32)
    (local $acc i32)
    (local $accW i32)

    ;; Grow once upfront if needed!
    (if (i32.gt_s (local.get $totalBits) (i32.shl (i32.load (i32.add (local.get $ch) (i32.const 36))) (i32.const 5)))
      (then
        (call $bd_grow (local.get $ch) (local.get $totalBits))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return)))))

    (local.set $rem (local.get $totalBits))
    (local.set $pos (local.get $bitOff))
    (local.set $acc (i32.const 0))
    (local.set $accW (i32.const 0))

    (block $brk
      (loop $lp
        (br_if $brk (i32.le_s (local.get $rem) (i32.const 0)))
        (local.set $bIdx (i32.shr_u (local.get $pos) (i32.const 3)))
        (local.set $bOff (i32.and (local.get $pos) (i32.const 7)))
        (local.set $avail (i32.sub (i32.const 8) (local.get $bOff)))
        (local.set $take (select (local.get $rem) (local.get $avail) (i32.lt_s (local.get $rem) (local.get $avail))))
        (local.set $byteVal (i32.load8_u (i32.add (local.get $bytePtr) (local.get $bIdx))))
        (local.set $bits
          (i32.and
            (i32.shr_u (local.get $byteVal) (i32.sub (local.get $avail) (local.get $take)))
            (call $mask32 (local.get $take))))
        (local.set $acc (i32.or (i32.shl (local.get $acc) (local.get $take)) (local.get $bits)))
        (local.set $accW (i32.add (local.get $accW) (local.get $take)))
        (local.set $pos (i32.add (local.get $pos) (local.get $take)))
        (local.set $rem (i32.sub (local.get $rem) (local.get $take)))
        (if (i32.ge_s (local.get $accW) (i32.const 24))
          (then
            (call $bd_push_small (local.get $ch) (local.get $acc) (local.get $accW))
            (local.set $acc (i32.const 0))
            (local.set $accW (i32.const 0))))
        (br $lp)
      )
    )
    (if (i32.gt_s (local.get $accW) (i32.const 0))
      (then (call $bd_push_small (local.get $ch) (local.get $acc) (local.get $accW))))
  )

  ;; Write BitDeque contents as zero-padded bytes to `outPtr` (returns byte length or -5 if > outCap)
  (func $bd_store_padded_bytes (param $ch i32) (param $outPtr i32) (param $outCap i32) (result i32)
    (local $totalBits i32)
    (local $nBytes i32)
    (local $i i32)
    (local $rem i32)
    (local $b i32)
    (local.set $totalBits (i32.load (i32.add (local.get $ch) (i32.const 44))))
    (local.set $nBytes (i32.shr_u (i32.add (local.get $totalBits) (i32.const 7)) (i32.const 3)))
    (if (i32.gt_s (local.get $nBytes) (local.get $outCap))
      (then (return (i32.const -5))))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (local.set $rem (i32.load (i32.add (local.get $ch) (i32.const 44))))
        (br_if $brk (i32.le_s (local.get $rem) (i32.const 0)))
        (if (i32.ge_s (local.get $rem) (i32.const 8))
          (then (local.set $b (call $bd_shift_bits (local.get $ch) (i32.const 8))))
          (else (local.set $b (i32.shl (call $bd_shift_bits (local.get $ch) (local.get $rem)) (i32.sub (i32.const 8) (local.get $rem))))))
        (i32.store8 (i32.add (local.get $outPtr) (local.get $i)) (local.get $b))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (local.get $nBytes)
  )

  ;; ============================================================================
  ;; 11. Exported Entrypoints, Quota Setters & Telemetry Getters
  ;; ============================================================================

  (func (export "ktvm_set_quotas") (param $maxSteps i32) (param $maxNodes i32) (param $maxBytes i32)
    (global.set $g_max_steps (local.get $maxSteps))
    (global.set $g_max_nodes (local.get $maxNodes))
    (global.set $g_max_bytes (local.get $maxBytes))
  )

  (func (export "ktvm_get_io_base") (result i32)
    (global.get $DATA_IO_BASE)
  )

  (func (export "ktvm_get_steps") (result i32) (global.get $g_steps))
  (func (export "ktvm_get_peak_nodes") (result i32) (global.get $g_peak_nodes))
  (func (export "ktvm_get_peak_bytes") (result i32) (global.get $g_peak_bytes))
  (func (export "ktvm_get_table_lookups") (result i32) (global.get $g_table_lookups))
  (func (export "ktvm_get_splices") (result i32) (global.get $g_splices))
  (func (export "ktvm_get_mux_demux_fusions") (result i32) (global.get $g_mux_demux_fusions))
  (func (export "ktvm_get_spec_rollbacks") (result i32) (global.get $g_spec_rollbacks))
  (func (export "ktvm_get_spec_upstream_aborts") (result i32) (global.get $g_spec_upstream_aborts))
  (func (export "ktvm_get_spec_tail_splices") (result i32) (global.get $g_spec_tail_splices))
  (func (export "ktvm_get_after_settlements") (result i32) (global.get $g_after_settlements))

  ;; Reserve `ioBytes` bytes starting at `$DATA_IO_BASE` for host input+output wire buffers,
  ;; placing `$g_heap_base` right after the I/O region and growing linear memory if needed.
  (func (export "ktvm_reserve_io") (param $ioBytes i32) (result i32)
    (local $end i32)
    (local $limit i32)
    (local $needPages i32)
    (local.set $end
      (i32.and
        (i32.add (i32.add (global.get $DATA_IO_BASE) (local.get $ioBytes)) (i32.const 15))
        (i32.const -16)))
    (local.set $limit (i32.shl (memory.size) (i32.const 16)))
    (if (i32.gt_u (i32.add (local.get $end) (i32.const 65536)) (local.get $limit))
      (then
        (local.set $needPages
          (i32.shr_u
            (i32.add (i32.sub (i32.add (local.get $end) (i32.const 65536)) (local.get $limit)) (i32.const 65535))
            (i32.const 16)))
        (if (i32.eq (memory.grow (local.get $needPages)) (i32.const -1))
          (then (return (i32.const 0))))))
    (global.set $g_heap_base (local.get $end))
    (global.get $DATA_IO_BASE)
  )

  ;; Reset arena + telemetry before each run (1ns reset!)
  (func $reset_runtime
    (if (i32.eqz (global.get $g_heap_base))
      (then (global.set $g_heap_base (global.get $DATA_HEAP_BASE))))
    (global.set $g_heap_ptr (global.get $g_heap_base))
    (global.set $g_heap_limit (i32.shl (memory.size) (i32.const 16)))
    (global.set $g_error_code (i32.const 0))
    (global.set $g_need_pull (i32.const 0))
    (global.set $g_need_step_node (i32.const 0))
    (global.set $g_steps (i32.const 0))
    (global.set $g_live_nodes (i32.const 0))
    (global.set $g_peak_nodes (i32.const 0))
    (global.set $g_buf_bytes (i32.const 0))
    (global.set $g_peak_bytes (i32.const 0))
    (global.set $g_table_lookups (i32.const 0))
    (global.set $g_splices (i32.const 0))
    (global.set $g_mux_demux_fusions (i32.const 0))
    (global.set $g_spec_rollbacks (i32.const 0))
    (global.set $g_spec_upstream_aborts (i32.const 0))
    (global.set $g_spec_tail_splices (i32.const 0))
    (global.set $g_after_settlements (i32.const 0))
    (global.set $g_dstack_ptr (i32.const 0))
    (global.set $g_dstack_cap (i32.const 0))
    (global.set $g_dstack_len (i32.const 0))
    (global.set $g_sc_stk_ptr (i32.const 0))
    (global.set $g_sc_ord_ptr (i32.const 0))
    (global.set $g_sc_cap (i32.const 0))
    (global.set $g_buf_fl_ptr (call $alloc (i32.const 64)))
  )

  ;; Run entry on raw payload bits at `(inPtr, inBitOff, inBitLen)`, optionally validating exact
  ;; DPDA payload length & zero trailing pad (`validatePad=1`), and write complete enveloped
  ;; k-wire (`[outHeaderBits][payloadBits][0-pad]`) to `(outPtr, outCap)`.
  ;; Returns: >= 0 output byte length, or negative error code (-1=FAILED, -2..-7).
  (func (export "ktvm_run_wire")
    (param $inPtr i32) (param $inBitOff i32) (param $inBitLen i32) (param $validatePad i32)
    (param $outPtr i32) (param $outCap i32) (param $frameHeader i32)
    (result i32)
    (local $rootSc i32)
    (local $rawCh i32)
    (local $rootIn i32)
    (local $rootOut i32)
    (local $dpda i32)
    (local $res i32)
    (local $rem i32)
    (local $framed i32)
    (local $n i32)

    (call $reset_runtime)
    (local.set $rootSc (call $scope_create (i32.const 0)))
    (local.set $rootIn (call $chan_alloc (local.get $rootSc) (global.get $DATA_IN_SCHEMA_ID)))
    (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (global.get $g_error_code))))

    (if (local.get $validatePad)
      (then
        ;; Load raw bits + DPDA-copy exact payload + check trailing <8 zero pad bits!
        (local.set $rawCh (call $chan_alloc (i32.const 0) (global.get $DATA_IN_SCHEMA_ID)))
        (call $bd_load_bytes_at (local.get $rawCh) (local.get $inPtr) (local.get $inBitOff) (local.get $inBitLen))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (global.get $g_error_code))))
        (local.set $dpda (call $dpda_alloc (i32.const 1) (global.get $DATA_IN_SCHEMA_ID) (i32.const 0)))
        (local.set $res (call $dpda_step_skip_copy (local.get $rawCh) (local.get $rootIn) (local.get $dpda)))
        (if (i32.ne (local.get $res) (i32.const 0)) (then (return (i32.const -6))))
        (local.set $rem (i32.load (i32.add (local.get $rawCh) (i32.const 44))))
        (if (i32.ge_s (local.get $rem) (i32.const 8)) (then (return (i32.const -6))))
        (if (i32.gt_s (local.get $rem) (i32.const 0))
          (then
            (if (i32.ne (call $bd_shift_bits (local.get $rawCh) (local.get $rem)) (i32.const 0))
              (then (return (i32.const -6))))))
        (call $bd_release (local.get $rawCh))
      )
      (else
        (call $bd_load_bytes_at (local.get $rootIn) (local.get $inPtr) (local.get $inBitOff) (local.get $inBitLen))
        (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (global.get $g_error_code))))
      )
    )
    (call $bd_close (local.get $rootIn))

    (local.set $rootOut (call $chan_alloc (i32.const 0) (global.get $DATA_OUT_SCHEMA_ID)))
    (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (global.get $g_error_code))))

    ;; Spawn entry proc or instantiate entry kernel
    (call $start_entry (local.get $rootSc) (local.get $rootIn) (local.get $rootOut))
    (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (global.get $g_error_code))))

    (call $drive_to_completion (local.get $rootOut))
    (if (i32.ne (global.get $g_error_code) (i32.const 0)) (then (return (global.get $g_error_code))))

    (if (i32.eq (i32.load (local.get $rootOut)) (i32.const 2))
      (then
        (call $scope_destroy (local.get $rootSc))
        (return (i32.const -1)))) ;; FAILED

    ;; Optionally prepend static output k-wire header bits
    (if (local.get $frameHeader)
      (then
        (local.set $framed (call $chan_alloc (i32.const 0) (i32.const 0)))
        (call $bd_load_bytes_at (local.get $framed) (global.get $DATA_OUT_HDR_PTR) (i32.const 0) (global.get $DATA_OUT_HDR_BITS))
        (call $bd_push_from_deque (local.get $framed) (local.get $rootOut))
        (local.set $res (call $bd_store_padded_bytes (local.get $framed) (local.get $outPtr) (local.get $outCap)))
        (call $bd_release (local.get $framed))
      )
      (else
        (local.set $res (call $bd_store_padded_bytes (local.get $rootOut) (local.get $outPtr) (local.get $outCap)))
      )
    )
    (call $bd_release (local.get $rootOut))
    (call $scope_destroy (local.get $rootSc))
    (local.get $res)
  )
