(module
  (memory (export "memory") 1)

  ;; Start allocation at byte offset 1024 to leave a safety margin and avoid returning 0 (nullptr)
  (global $arena_free (export "arena_free") (mut i32) (i32.const 1024))
  ;; Maximum address of the currently allocated pages (1 page = 64KB)
  (global $arena_max (export "arena_max") (mut i32) (i32.const 65536))
  ;; Out-of-memory status flags
  (global $oom_flag (export "oom_flag") (mut i32) (i32.const 0))
  (global $oom_size (export "oom_size") (mut i32) (i32.const 0))

  ;; Bump allocator function: aligns allocation size to 8 bytes, grows memory if needed, and returns the pointer
  (func $alloc (export "alloc") (param $size i32) (result i32)
    (local $old_free i32)
    (local $new_free i32)
    (local $pages_needed i32)
    (local $grow_res i32)

    ;; Check if size exceeds maximum allocatable size
    local.get $size
    i32.const -8
    i32.gt_u
    if
      i32.const 1
      global.set $oom_flag
      local.get $size
      global.set $oom_size
      unreachable
    end

    ;; 1. Align size to 8 bytes: size = (size + 7) & ~8
    local.get $size
    i32.const 7
    i32.add
    i32.const -8
    i32.and
    local.set $size

    ;; Get current free pointer
    global.get $arena_free
    local.set $old_free

    ;; Calculate proposed new free pointer
    local.get $old_free
    local.get $size
    i32.add
    local.set $new_free

    ;; Check for 32-bit unsigned overflow
    local.get $new_free
    local.get $old_free
    i32.lt_u
    if
      i32.const 1
      global.set $oom_flag
      local.get $size
      global.set $oom_size
      unreachable
    end

    ;; 2. Check if we exceed current memory size
    local.get $new_free
    global.get $arena_max
    i32.gt_u
    if
      ;; Calculate how many additional pages we need to grow
      local.get $new_free
      global.get $arena_max
      i32.sub
      i32.const 65535
      i32.add
      i32.const 65536
      i32.div_u
      local.set $pages_needed

      ;; Try to grow memory by $pages_needed
      local.get $pages_needed
      memory.grow
      local.set $grow_res

      ;; If grow returns -1, we are out of memory
      local.get $grow_res
      i32.const -1
      i32.eq
      if
        i32.const 1
        global.set $oom_flag
        local.get $size
        global.set $oom_size
        unreachable
      end

      ;; Update arena_max: arena_max = arena_max + pages_needed * 65536
      global.get $arena_max
      local.get $pages_needed
      i32.const 65536
      i32.mul
      i32.add
      global.set $arena_max
    end

    ;; 3. Perform the allocation
    local.get $new_free
    global.set $arena_free

    local.get $old_free
  )

  ;; Return a checkpoint that can be restored after a temporary result is consumed.
  (func $arena_mark (export "arena_mark") (result i32)
    global.get $arena_free
  )

  ;; Bulk-free allocations made after a checkpoint. Memory pages remain available for reuse.
  (func $arena_reset (export "arena_reset") (param $mark i32)
    local.get $mark
    i32.const 1024
    i32.lt_u
    if
      unreachable
    end

    local.get $mark
    global.get $arena_free
    i32.gt_u
    if
      unreachable
    end

    local.get $mark
    global.set $arena_free
  )

  ;; Compaction staging globals
  (global $compact_buf_start (mut i32) (i32.const 0))
  (global $compact_buf_free (mut i32) (i32.const 0))

  ;; Ensure memory capacity in staging buffer
  (func $ensure_buf_capacity (param $size i32)
    (local $needed i32)
    (local $pages i32)
    (local $grow_res i32)

    global.get $compact_buf_free
    local.get $size
    i32.add
    local.set $needed

    ;; Check for 32-bit overflow
    local.get $needed
    global.get $compact_buf_free
    i32.lt_u
    if
      i32.const 1
      global.set $oom_flag
      local.get $size
      global.set $oom_size
      unreachable
    end

    local.get $needed
    global.get $arena_max
    i32.gt_u
    if
      local.get $needed
      global.get $arena_max
      i32.sub
      i32.const 65535
      i32.add
      i32.const 65536
      i32.div_u
      local.set $pages

      local.get $pages
      memory.grow
      local.set $grow_res

      local.get $grow_res
      i32.const -1
      i32.eq
      if
        i32.const 1
        global.set $oom_flag
        local.get $size
        global.set $oom_size
        unreachable
      end

      global.get $arena_max
      local.get $pages
      i32.const 65536
      i32.mul
      i32.add
      global.set $arena_max
    end
  )

  ;; Initialize compaction staging buffer at current arena top
  (func $compact_start (export "compact_start")
    global.get $arena_free
    global.set $compact_buf_start
    global.get $arena_free
    global.set $compact_buf_free
  )

  ;; Compact an object graph reachable from $root down toward $mark
  (func $compact_obj (export "compact_obj") (param $root i32) (param $mark i32) (result i32)
    (local $curr i32)
    (local $first_final i32)
    (local $prev_dest i32)
    (local $dest i32)
    (local $final_ptr i32)
    (local $tag i32)
    (local $payload i32)
    (local $size i32)
    (local $alignedSize i32)
    (local $N i32)
    (local $i i32)
    (local $offsetVal i32)
    (local $fieldPtr i32)
    (local $child_final i32)

    local.get $root
    local.set $curr
    i32.const 0
    local.set $prev_dest

    (block $break_chain
      (loop $chain_loop
        ;; 1. Check null / empty
        local.get $curr
        i32.eqz
        if
          local.get $prev_dest
          if
            local.get $prev_dest
            i32.const 0
            i32.store offset=8
          end
          br $break_chain
        end

        ;; 2. Check if < mark
        local.get $curr
        local.get $mark
        i32.lt_u
        if
          local.get $prev_dest
          if
            local.get $prev_dest
            local.get $curr
            i32.store offset=8
          end
          local.get $first_final
          i32.eqz
          if
            local.get $curr
            local.set $first_final
          end
          br $break_chain
        end

        ;; 3. Check if forwarded
        local.get $curr
        i32.load offset=0
        local.set $size

        local.get $size
        i32.const -1
        i32.eq
        if
          local.get $curr
          i32.load offset=4
          local.set $final_ptr
          local.get $prev_dest
          if
            local.get $prev_dest
            local.get $final_ptr
            i32.store offset=8
          end
          local.get $first_final
          i32.eqz
          if
            local.get $final_ptr
            local.set $first_final
          end
          br $break_chain
        end

        ;; 4. Compute final_ptr = mark + (compact_buf_free - compact_buf_start)
        local.get $mark
        global.get $compact_buf_free
        global.get $compact_buf_start
        i32.sub
        i32.add
        local.set $final_ptr

        local.get $first_final
        i32.eqz
        if
          local.get $final_ptr
          local.set $first_final
        end

        ;; If prev_dest != 0, patch its payload to final_ptr
        local.get $prev_dest
        if
          local.get $prev_dest
          local.get $final_ptr
          i32.store offset=8
        end

        ;; 5. Check if Variant (size == 12)
        local.get $size
        i32.const 12
        i32.eq
        if
          i32.const 16
          call $ensure_buf_capacity

          local.get $curr
          i32.load offset=4
          local.set $tag
          local.get $curr
          i32.load offset=8
          local.set $payload

          local.get $curr
          i32.const -1
          i32.store offset=0
          local.get $curr
          local.get $final_ptr
          i32.store offset=4

          global.get $compact_buf_free
          local.set $dest
          global.get $compact_buf_free
          i32.const 16
          i32.add
          global.set $compact_buf_free

          local.get $dest
          i32.const 12
          i32.store offset=0
          local.get $dest
          local.get $tag
          i32.store offset=4

          local.get $dest
          local.set $prev_dest
          local.get $payload
          local.set $curr
          br $chain_loop
        end

        ;; 6. Product handling (size != 12)
        local.get $size
        i32.const 7
        i32.add
        i32.const -8
        i32.and
        local.set $alignedSize

        local.get $alignedSize
        call $ensure_buf_capacity

        local.get $curr
        i32.load offset=4
        local.set $N

        local.get $curr
        i32.const -1
        i32.store offset=0
        local.get $curr
        local.get $final_ptr
        i32.store offset=4

        global.get $compact_buf_free
        local.set $dest
        global.get $compact_buf_free
        local.get $alignedSize
        i32.add
        global.set $compact_buf_free

        local.get $dest
        local.get $size
        i32.store offset=0
        local.get $dest
        local.get $N
        i32.store offset=4

        i32.const 0
        local.set $i
        (block $break_prod
          (loop $loop_prod
            local.get $i
            local.get $N
            i32.ge_u
            br_if $break_prod

            local.get $curr
            i32.const 8
            local.get $i
            i32.const 4
            i32.mul
            i32.add
            i32.add
            i32.load
            local.set $offsetVal

            local.get $dest
            i32.const 8
            local.get $i
            i32.const 4
            i32.mul
            i32.add
            i32.add
            local.get $offsetVal
            i32.store

            local.get $curr
            local.get $offsetVal
            i32.add
            i32.load
            local.set $fieldPtr

            local.get $fieldPtr
            local.get $mark
            call $compact_obj
            local.set $child_final

            local.get $dest
            local.get $offsetVal
            i32.add
            local.get $child_final
            i32.store

            local.get $i
            i32.const 1
            i32.add
            local.set $i
            br $loop_prod
          )
        )
        br $break_chain
      )
    )

    local.get $first_final
  )

  ;; Finalize compaction by copying staging buffer into mark and resetting arena_free
  (func $compact_finish (export "compact_finish") (param $mark i32)
    (local $total_size i32)
    global.get $compact_buf_free
    global.get $compact_buf_start
    i32.sub
    local.set $total_size

    local.get $total_size
    i32.const 0
    i32.gt_u
    if
      local.get $mark
      global.get $compact_buf_start
      local.get $total_size
      memory.copy
    end

    local.get $mark
    local.get $total_size
    i32.add
    global.set $arena_free
  )
)
