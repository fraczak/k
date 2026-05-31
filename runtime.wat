(module
  (memory (export "memory") 1)

  ;; Start allocation at byte offset 1024 to leave a safety margin and avoid returning 0 (nullptr)
  (global $arena_free (mut i32) (i32.const 1024))
  ;; Maximum address of the currently allocated pages (1 page = 64KB)
  (global $arena_max (mut i32) (i32.const 65536))

  ;; Bump allocator function: aligns allocation size to 8 bytes, grows memory if needed, and returns the pointer
  (func $alloc (export "alloc") (param $size i32) (result i32)
    (local $old_free i32)
    (local $new_free i32)
    (local $pages_needed i32)
    (local $grow_res i32)

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

    ;; 2. Check if we exceed current memory size
    local.get $new_free
    global.get $arena_max
    i32.gt_s
    if
      ;; Calculate how many additional pages we need to grow
      local.get $new_free
      global.get $arena_max
      i32.sub
      i32.const 65535
      i32.add
      i32.const 65536
      i32.div_s
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
)
