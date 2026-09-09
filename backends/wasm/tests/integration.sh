#!/usr/bin/env bash
set -euo pipefail

K_ROOT=${K_ROOT:-../..}
TMP_DIR=`mktemp -d`
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Running './tests/integration.sh' ..."

compare_json_envelope() {
  local name=$1
  local input=$2
  local program=$3
  printf '%s\n' "$input" |
    node "$K_ROOT/codecs/json.mjs" --parse |
    node "$K_ROOT/k.mjs" "$program" > "$TMP_DIR/native.kv"
  printf '%s\n' "$input" |
    node "$K_ROOT/codecs/json.mjs" --parse |
    node "$K_ROOT/kvm.mjs" "$program" > "$TMP_DIR/kvm.kv"
  printf '%s\n' "$input" |
    node "$K_ROOT/codecs/json.mjs" --parse |
    node ./bin/k-wasm.mjs "$program" > "$TMP_DIR/wasm.kv"

  if ! cmp -s "$TMP_DIR/native.kv" "$TMP_DIR/kvm.kv" ||
     ! cmp -s "$TMP_DIR/native.kv" "$TMP_DIR/wasm.kv"; then
    echo "output envelope mismatch for $name" >&2
    exit 1
  fi
}

node "$K_ROOT/codecs/unit.mjs" --parse |
  node ./bin/k-wasm.mjs '|ok' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

printf '{"a": {}, "b": {}}\n' |
  node "$K_ROOT/codecs/k-parse.mjs" |
  node ./bin/k-wasm.mjs '|ok' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '{"ok":{"a":{},"b":{}}}'

printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '.c' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '\[1,2,"alsk"\]'

compare_json_envelope "nested array string projection" \
  '{"a":[1,2,"kupa"], "b": 123}' \
  '.a.2'
compare_json_envelope "projected JSON number" \
  '{"a":[1,2,"kupa"], "b": 123}' \
  '.b'
compare_json_envelope "closed product filter" \
  '{"a":[1,2,"kupa"], "b": 123}' \
  '?{X a, Y b}'
printf '{"a":[1,2,"kupa"], "b": 123}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '{ .a.2 word, .b number }' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '{"number":123,"word":"kupa"}'

printf 'a\n' |
  node "$K_ROOT/codecs/k-parse.mjs" --input-type '?< {} a, X b, ...>' |
  node ./bin/k-wasm.mjs '{() i, /a o}' |
  node "$K_ROOT/codecs/show.mjs" > "$TMP_DIR/polymorphic-relation.wire" 2> "$TMP_DIR/polymorphic-relation.show"
grep -Fqx '{{}|a i, {} o} ?{<{}=X0 a, (...) b, ...> i, X0 o}' "$TMP_DIR/polymorphic-relation.show"
node "$K_ROOT/codecs/k-print.mjs" "$TMP_DIR/polymorphic-relation.wire" |
  grep -qx '{"i":"a","o":{}}'

node ./bin/k-wasm-compile.mjs '.c' "$TMP_DIR/dot-c.wasm"
printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm-run.mjs "$TMP_DIR/dot-c.wasm" |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '\[1,2,"alsk"\]'

node "$K_ROOT/objects/compile.mjs" '.c' "$TMP_DIR/dot-c.ko"
printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs "$TMP_DIR/dot-c.ko" |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '\[1,2,"alsk"\]'

printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '?{X c, ...}' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '{"a":123,"b":true,"c":\[1,2,"alsk"\]}'

printf '{"a":123,"b":true}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '?{...}' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '{"a":123,"b":true}'

printf '"bar"\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '?<...>' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '"bar"'

printf '{"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '?{X c}' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '{"c":\[1,2,"alsk"\]}'

if printf '{"a":123,"c":1}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '?{X c}' >/dev/null 2>&1; then
  echo "closed product pattern unexpectedly accepted extra fields" >&2
  exit 1
fi

if printf '"bar"\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node ./bin/k-wasm.mjs '?<X cons>' >/dev/null 2>&1; then
  echo "closed union pattern unexpectedly accepted a wider value envelope" >&2
  exit 1
fi

node "$K_ROOT/codecs/unit.mjs" --parse |
  node "$K_ROOT/k.mjs" '|cons' |
  node ./bin/k-wasm.mjs '?<{} cons>' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"cons"'

if node ./bin/k-wasm-compile.mjs 'f = .x f; f' "$TMP_DIR/non-converged.wasm" >/dev/null 2>&1; then
  echo "non-converged type derivation unexpectedly compiled" >&2
  exit 1
fi

printf '|ok\n' > "$TMP_DIR/ok.k"
if node ./bin/k-wasm-compile.mjs -k "$TMP_DIR/ok.k" "$TMP_DIR/old-k.wasm" >/dev/null 2>&1; then
  echo "-k source-file compatibility option unexpectedly worked" >&2
  exit 1
fi

node ./bin/k-wasm-compile.mjs "$TMP_DIR/ok.k" "$TMP_DIR/ok.wasm"
node "$K_ROOT/codecs/unit.mjs" --parse > "$TMP_DIR/unit.kv"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node ./bin/k-wasm.mjs "$TMP_DIR/ok.k" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile.mjs" "$TMP_DIR/ok.k" "$TMP_DIR/ok.ko"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/ok.ko" "$TMP_DIR/ok-ko.wasm"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok-ko.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile.mjs" --input-type '?{}' "$TMP_DIR/ok.k" "$TMP_DIR/ok.kvm"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/ok.kvm" "$TMP_DIR/ok-kvm.wasm"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok-kvm.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile.mjs" --format kvm --input-type '?{<{} a> x, <{} b> y}' 'make_prod = { .x x, .y y }; proj_y = make_prod .y; proj_y' > "$TMP_DIR/project.kvm"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/project.kvm" "$TMP_DIR/project.wasm"
printf '{"x":{"a":{}},"y":{"b":{}}}\n' |
  node "$K_ROOT/codecs/k-parse.mjs" |
  node ./bin/k-wasm-run.mjs "$TMP_DIR/project.wasm" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"b"'

node "$K_ROOT/objects/compile.mjs" "$K_ROOT/Examples/ieee.k" "$TMP_DIR/ieee.klib"
if node ./bin/k-wasm-compile.mjs --lib "$TMP_DIR/ieee.klib" --lib "$TMP_DIR/ieee.klib" --export mul:times "{()x,()y} times .result" "$TMP_DIR/repeated-lib.wasm" >/dev/null 2>&1; then
  echo "--lib unexpectedly accepted more than once" >&2
  exit 1
fi
node ./bin/k-wasm-compile.mjs --lib "$TMP_DIR/ieee.klib" --export mul:times "{()x,()y} times .result" "$TMP_DIR/ieee-mul.wasm"
echo 0.12 |
  node "$K_ROOT/codecs/ieee.mjs" --parse |
  node ./bin/k-wasm-run.mjs "$TMP_DIR/ieee-mul.wasm" |
  node "$K_ROOT/codecs/ieee.mjs" --print |
  grep -qx '0.0144'

echo "Integration tests passed."
