#!/usr/bin/env bash
set -euo pipefail

TMP_DIR=`mktemp -d`
trap 'rm -rf "$TMP_DIR"' EXIT

command -v clang >/dev/null || {
  echo "clang is required for k-llvm integration tests" >&2
  exit 1
}

node ../../objects/compile.mjs '()' "$TMP_DIR/id.ko"
printf '[["open-product",[]]]' > "$TMP_DIR/input.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/input.pattern.json" "$TMP_DIR/id.ko" "$TMP_DIR/id.ll"
grep -q '@k_llvm_metadata' "$TMP_DIR/id.ll"
grep -q 'define %k_result @k_main' "$TMP_DIR/id.ll"

clang -Wno-override-module -Iruntime runtime/krt.c tests/identity-driver.c "$TMP_DIR/id.ll" -o "$TMP_DIR/id"
"$TMP_DIR/id"

node ../../objects/compile.mjs '.x' "$TMP_DIR/projection.ko"
printf '[["closed-product",[["x",1]]],["closed-product",[]]]' > "$TMP_DIR/projection.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/projection.pattern.json" "$TMP_DIR/projection.ko" "$TMP_DIR/projection.ll"
grep -q 'product_fields_ptr' "$TMP_DIR/projection.ll"
! grep -q 'call ptr @k_product_get_at' "$TMP_DIR/projection.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/projection-driver.c "$TMP_DIR/projection.ll" -o "$TMP_DIR/projection"
"$TMP_DIR/projection"

node ../../objects/compile.mjs '{ .x fieldA, .y fieldB }' "$TMP_DIR/product.ko"
printf '[["closed-product",[["x",1],["y",2]]],["closed-product",[["valA",1]]],["closed-product",[["valB",2]]]]' > "$TMP_DIR/product.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/product.pattern.json" "$TMP_DIR/product.ko" "$TMP_DIR/product.ll"
grep -q 'store i32 1, ptr %i32_slot' "$TMP_DIR/product.ll"
grep -q 'store ptr %product_fields' "$TMP_DIR/product.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/product-driver.c "$TMP_DIR/product.ll" -o "$TMP_DIR/product"
"$TMP_DIR/product"

node ../../objects/compile.mjs '|tag' "$TMP_DIR/variant.ko"
printf '[["closed-product",[]]]' > "$TMP_DIR/variant.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/variant.pattern.json" "$TMP_DIR/variant.ko" "$TMP_DIR/variant.ll"
grep -q 'call ptr @k_rt_alloc' "$TMP_DIR/variant.ll"
grep -q 'store i32 2, ptr %i32_slot' "$TMP_DIR/variant.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/variant-driver.c "$TMP_DIR/variant.ll" -o "$TMP_DIR/variant"
"$TMP_DIR/variant"

node ../../objects/compile.mjs '/tag' "$TMP_DIR/variant-projection.ko"
printf '[["closed-union",[["tag",1]]],["closed-product",[]]]' > "$TMP_DIR/variant-projection.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/variant-projection.pattern.json" "$TMP_DIR/variant-projection.ko" "$TMP_DIR/variant-projection.ll"
grep -q 'tag_byte_ptr' "$TMP_DIR/variant-projection.ll"
grep -q 'payload_slot' "$TMP_DIR/variant-projection.ll"
! grep -q 'call i32 @k_variant_tag_matches' "$TMP_DIR/variant-projection.ll"
! grep -q 'call ptr @k_variant_payload' "$TMP_DIR/variant-projection.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/variant-projection-driver.c "$TMP_DIR/variant-projection.ll" -o "$TMP_DIR/variant-projection"
"$TMP_DIR/variant-projection"

node ../../objects/compile.mjs '(.x .y)' "$TMP_DIR/composition.ko"
printf '[["closed-product",[["x",1]]],["closed-product",[["y",2]]],["closed-product",[]]]' > "$TMP_DIR/composition.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/composition.pattern.json" "$TMP_DIR/composition.ko" "$TMP_DIR/composition.ll"
grep -q 'product_fields_ptr' "$TMP_DIR/composition.ll"
! grep -q 'call ptr @k_product_get_at' "$TMP_DIR/composition.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/composition-driver.c "$TMP_DIR/composition.ll" -o "$TMP_DIR/composition"
"$TMP_DIR/composition"

node ../../objects/compile.mjs 'pick = .x; {.a pick left, .b pick right}' "$TMP_DIR/relation.ko"
printf '[["open-product",[["a",1],["b",2]]],["open-product",[["x",3]]],["open-product",[["x",4]]],["closed-product",[]],["closed-product",[]]]' > "$TMP_DIR/relation.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/relation.pattern.json" "$TMP_DIR/relation.ko" "$TMP_DIR/relation.ll"
grep -q 'define internal %k_result @k_rel_pick' "$TMP_DIR/relation.ll"
grep -q 'call %k_result @k_rel_pick' "$TMP_DIR/relation.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/relation-driver.c "$TMP_DIR/relation.ll" -o "$TMP_DIR/relation"
"$TMP_DIR/relation"

node ../../objects/compile.mjs '< /x |left, /y |right >' "$TMP_DIR/union.ko"
printf '[["closed-union",[["x",1],["y",2]]],["closed-product",[]],["closed-product",[]]]' > "$TMP_DIR/union.pattern.json"
node ./bin/k-llvm-compile.mjs --input-pattern "$TMP_DIR/union.pattern.json" "$TMP_DIR/union.ko" "$TMP_DIR/union.ll"
grep -q 'define internal %k_result @k_union_arm_0' "$TMP_DIR/union.ll"
grep -q 'call %k_result @k_union_arm_1' "$TMP_DIR/union.ll"
clang -Wno-override-module -Iruntime runtime/krt.c tests/union-driver.c "$TMP_DIR/union.ll" -o "$TMP_DIR/union"
"$TMP_DIR/union"

node ./bin/k-llvm-compile.mjs --help | grep -q 'Compile a k .ko/.klib object'

node ./bin/k-llvm-build.mjs --help | grep -q 'binary k pattern+value envelope'

node ./bin/k-llvm-jit.mjs --help | grep -q 'stdin binary envelope'

node ./bin/k-llvm-run.mjs --help | grep -q 'Compile and execute a k .ko/.klib object'

node ../../objects/compile.mjs '.x' "$TMP_DIR/run.ko"
printf '{"x":"left","y":"right"}' > "$TMP_DIR/run-input.kv"
printf '"left"' > "$TMP_DIR/run-expected.kv"
node ./bin/k-llvm-run.mjs --expect "$TMP_DIR/run-expected.kv" "$TMP_DIR/run.ko" "$TMP_DIR/run-input.kv" | grep -qx 'OK'
node ./bin/k-llvm-run.mjs "$TMP_DIR/run.ko" "$TMP_DIR/run-input.kv" | grep -qx '"left"'

node ../../objects/compile.mjs '{ .x fieldA, .y fieldB }' "$TMP_DIR/run-product.ko"
printf '{"x":"left","y":"right"}' > "$TMP_DIR/run-product-input.kv"
node ./bin/k-llvm-run.mjs "$TMP_DIR/run-product.ko" "$TMP_DIR/run-product-input.kv" | grep -qx '{"fieldA":"left","fieldB":"right"}'

printf '[["closed-product",[["x",1],["y",3]]],["open-union",[["left",2]]],["closed-product",[]],["open-union",[["right",2]]]]' > "$TMP_DIR/run-envelope.pattern.json"
node ./bin/k-llvm-build.mjs --input-pattern "$TMP_DIR/run-envelope.pattern.json" "$TMP_DIR/run.ko" "$TMP_DIR/run-exe"
printf '{"x":"left","y":"right"}' \
  | node ../../codecs/k-parse.mjs \
  | "$TMP_DIR/run-exe" \
  | node ../../codecs/k-print.mjs \
  | grep -qx '"left"'

printf '{"x":"left"}' | node ../../codecs/k-parse.mjs | "$TMP_DIR/run-exe" && exit 1 || test "$?" -eq 5

printf '[["open-union",[["left",1],["right",1]]],["closed-product",[]]]' > "$TMP_DIR/identity-variant.pattern.json"
node ./bin/k-llvm-build.mjs --input-pattern "$TMP_DIR/identity-variant.pattern.json" "$TMP_DIR/id.ko" "$TMP_DIR/id-exe"
node --input-type=module -e "import { stdout } from 'node:process'; import { encodeToWire } from '../../codecs/runtime/prefix-codec.mjs'; import { Value } from '../../Value.mjs'; const pattern = [[\"open-union\",[[\"left\",1],[\"right\",1]]],[\"closed-product\",[]]]; stdout.write(encodeToWire(Value.variant(\"left\", Value.product({}), pattern), pattern));" \
  | "$TMP_DIR/id-exe" \
  | node --input-type=module -e "import { stdin } from 'node:process'; import { decodeWire } from '../../codecs/runtime/prefix-codec.mjs'; const chunks = []; stdin.on('data', (chunk) => chunks.push(chunk)); stdin.on('end', () => console.log(JSON.stringify(decodeWire(Buffer.concat(chunks)).pattern)));" \
  | grep -Fqx '[["open-union",[["left",1],["right",1]]],["closed-product",[]]]'

printf '[["closed-union",[["+",1],["-",1]]],["closed-union",[["0",1],["1",1],["_",2]]],["closed-product",[]]]' > "$TMP_DIR/identity-int.pattern.json"
node ./bin/k-llvm-build.mjs --input-pattern "$TMP_DIR/identity-int.pattern.json" "$TMP_DIR/id.ko" "$TMP_DIR/id-int-exe"
printf '2' \
  | node ../../codecs/int.mjs --parse \
  | "$TMP_DIR/id-int-exe" \
  | node ../../codecs/int.mjs --print \
  | grep -qx '2'

node --input-type=module -e "import assert from 'node:assert/strict'; import { spawn } from 'node:child_process'; import { encodeToWire, decodeWire } from '../../codecs/runtime/prefix-codec.mjs'; import { parse, INT_PATTERN } from '../../codecs/int.mjs'; const input = encodeToWire(parse('2'), INT_PATTERN); const header = Buffer.alloc(4); header.writeUInt32BE(input.length); const child = spawn(process.argv[1], ['--server']); const chunks = []; const stderr = []; child.stdout.on('data', (chunk) => chunks.push(chunk)); child.stderr.on('data', (chunk) => stderr.push(chunk)); child.stdin.end(Buffer.concat([header, input])); const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); assert.equal(status, 0, Buffer.concat(stderr).toString('utf8')); const output = Buffer.concat(chunks); const length = output.readUInt32BE(0); assert.equal(output.length, 4 + length); assert.deepEqual(decodeWire(output.subarray(4)).value.toJSON(), parse('2').toJSON());" "$TMP_DIR/id-int-exe"

printf '{"x":"left","y":"right"}' \
  | node ../../codecs/k-parse.mjs \
  | node ./bin/k-llvm-jit.mjs --cache-dir "$TMP_DIR/jit-cache" "$TMP_DIR/run.ko" \
  | node ../../codecs/k-print.mjs \
  | grep -qx '"left"'

node --input-type=module -e "import { stdout } from 'node:process'; import { encodeToWire } from '../../codecs/runtime/prefix-codec.mjs'; import { Value } from '../../Value.mjs'; const pattern = [[\"open-union\",[[\"left\",1],[\"right\",1]]],[\"closed-product\",[]]]; stdout.write(encodeToWire(Value.variant(\"left\", Value.product({}), pattern), pattern));" \
  | node ./bin/k-llvm-jit.mjs --cache-dir "$TMP_DIR/jit-cache" "$TMP_DIR/id.ko" \
  | node --input-type=module -e "import { stdin } from 'node:process'; import { decodeWire } from '../../codecs/runtime/prefix-codec.mjs'; const chunks = []; stdin.on('data', (chunk) => chunks.push(chunk)); stdin.on('end', () => console.log(JSON.stringify(decodeWire(Buffer.concat(chunks)).pattern)));" \
  | grep -Fqx '[["open-union",[["left",1],["right",1]]],["closed-product",[]]]'

node ../../objects/compile.mjs '/"ह" |"😀"' "$TMP_DIR/unicode-variant.ko"
node --input-type=module -e "import { stdout } from 'node:process'; import { encodeToWire } from '../../codecs/runtime/prefix-codec.mjs'; import { Value } from '../../Value.mjs'; const pattern = [[\"closed-union\", [[\"ह\", 1]]], [\"closed-product\", []]]; stdout.write(encodeToWire(Value.variant('ह', Value.product({}), pattern), pattern));" \
  | node ./bin/k-llvm-jit.mjs --cache-dir "$TMP_DIR/jit-cache" "$TMP_DIR/unicode-variant.ko" \
  | node ../../codecs/k-print.mjs \
  | grep -qx '"😀"'

node ../../objects/compile.mjs '/"a\u0000b" |"nul-ok"' "$TMP_DIR/nul-variant.ko"
node --input-type=module -e "import { stdout } from 'node:process'; import { encodeToWire } from '../../codecs/runtime/prefix-codec.mjs'; import { Value } from '../../Value.mjs'; const tag = 'a\u0000b'; const pattern = [[\"closed-union\", [[tag, 1]]], [\"closed-product\", []]]; stdout.write(encodeToWire(Value.variant(tag, Value.product({}), pattern), pattern));" \
  | node ./bin/k-llvm-jit.mjs --cache-dir "$TMP_DIR/jit-cache" "$TMP_DIR/nul-variant.ko" \
  | node ../../codecs/k-print.mjs \
  | grep -qx '"nul-ok"'

node --input-type=module -e "import { stdout } from 'node:process'; import { encodeToWire } from '../../codecs/runtime/prefix-codec.mjs'; import { Value } from '../../Value.mjs'; const labels = ['a', 'é', 'ह', '\uE000', '😀', '𠀀', 'a\u0000b']; const pattern = [[\"closed-product\", labels.map((label) => [label, 1])], [\"closed-product\", []]]; const value = Value.product(Object.fromEntries(labels.map((label) => [label, Value.product({})])), pattern); stdout.write(encodeToWire(value, pattern));" \
  | node ./bin/k-llvm-jit.mjs --cache-dir "$TMP_DIR/jit-cache" "$TMP_DIR/id.ko" \
  | node --input-type=module -e "import assert from 'node:assert/strict'; import { stdin } from 'node:process'; import { decodeWire } from '../../codecs/runtime/prefix-codec.mjs'; const chunks = []; for await (const chunk of stdin) chunks.push(chunk); const labels = ['a', 'é', 'ह', '\uE000', '😀', '𠀀', 'a\u0000b']; const { pattern } = decodeWire(Buffer.concat(chunks)); assert.equal(pattern[0][0], 'closed-product'); assert.deepEqual(new Set(pattern[0][1].map(([label]) => label)), new Set(labels));"

node --input-type=module -e "import { stdout } from 'node:process'; import { encodeToWire } from '../../codecs/runtime/prefix-codec.mjs'; import { Value } from '../../Value.mjs'; const labels = ['a', 'é', 'ह', '\uE000', '😀', '𠀀', 'a\u0000b']; const pattern = [[\"open-union\", labels.map((label) => [label, 1])], [\"closed-product\", []]]; stdout.write(encodeToWire(Value.variant('a\u0000b', Value.product({}), pattern), pattern));" \
  | node ./bin/k-llvm-jit.mjs --cache-dir "$TMP_DIR/jit-cache" "$TMP_DIR/id.ko" \
  | node --input-type=module -e "import assert from 'node:assert/strict'; import { stdin } from 'node:process'; import { decodeWire } from '../../codecs/runtime/prefix-codec.mjs'; const chunks = []; for await (const chunk of stdin) chunks.push(chunk); const labels = ['a', 'é', 'ह', '\uE000', '😀', '𠀀', 'a\u0000b']; const { pattern, value } = decodeWire(Buffer.concat(chunks)); assert.equal(pattern[0][0], 'open-union'); assert.deepEqual(new Set(pattern[0][1].map(([label]) => label)), new Set(labels)); assert.equal(value.tag, 'a\u0000b');"
