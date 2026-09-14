#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Running './backends/arm64/tests/integration.sh' ..."

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
    node "$K_ROOT/backends/arm64/bin/k-arm64.mjs" "$program" > "$TMP_DIR/arm64.kv"

  if ! cmp -s "$TMP_DIR/native.kv" "$TMP_DIR/kvm.kv" ||
     ! cmp -s "$TMP_DIR/native.kv" "$TMP_DIR/arm64.kv"; then
    echo "output envelope mismatch for $name" >&2
    exit 1
  fi
}

echo "Testing basic tag injection..."
node "$K_ROOT/codecs/unit.mjs" --parse |
  node "$K_ROOT/backends/arm64/bin/k-arm64.mjs" '|ok' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

echo "Testing record wrapping..."
printf '{"a": {}, "b": {}}\n' |
  node "$K_ROOT/codecs/k-parse.mjs" |
  node "$K_ROOT/backends/arm64/bin/k-arm64.mjs" '|ok' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '{"ok":{"a":{},"b":{}}}'

echo "Testing field projection with JSON codec..."
printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node "$K_ROOT/backends/arm64/bin/k-arm64.mjs" '.c' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '\[1,2,"alsk"\]'

echo "Testing nested array projection..."
compare_json_envelope "nested array string projection" \
  '{"a":[1,2,"kupa"], "b": 123}' \
  '.a.2'

echo "Testing JSON number projection..."
compare_json_envelope "projected JSON number" \
  '{"a":[1,2,"kupa"], "b": 123}' \
  '.b'

echo "Testing closed product filter..."
compare_json_envelope "closed product filter" \
  '{"a":[1,2,"kupa"], "b": 123}' \
  '?{X a, Y b}'

echo "Testing record construction..."
printf '{"a":[1,2,"kupa"], "b": 123}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node "$K_ROOT/backends/arm64/bin/k-arm64.mjs" '{ .a.2 word, .b number }' |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '{"number":123,"word":"kupa"}'

echo "Testing standalone executable compilation and execution..."
node "$K_ROOT/backends/arm64/bin/k-arm64-compile.mjs" -o "$TMP_DIR/dot-c" '.c'
printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node "$K_ROOT/backends/arm64/bin/k-arm64-run.mjs" "$TMP_DIR/dot-c" |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '\[1,2,"alsk"\]'

echo "Testing direct execution of compiled executable with --json..."
printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  "$TMP_DIR/dot-c" --json |
  grep -q 'exponent'

echo "Testing compilation from .ko object..."
node "$K_ROOT/objects/compile.mjs" '.c' "$TMP_DIR/dot-c.ko"
printf '{"a":123,"b":true,"c":[1,2,"alsk"]}\n' |
  node "$K_ROOT/codecs/json.mjs" --parse |
  node "$K_ROOT/backends/arm64/bin/k-arm64.mjs" "$TMP_DIR/dot-c.ko" |
  node "$K_ROOT/codecs/json.mjs" --print |
  grep -qx '\[1,2,"alsk"\]'

echo "Testing compilation to assembly (-S)..."
node "$K_ROOT/backends/arm64/bin/k-arm64-compile.mjs" -S '.c' "$TMP_DIR/dot-c.s"
test -s "$TMP_DIR/dot-c.s"
grep -q "rel___main__" "$TMP_DIR/dot-c.s"

echo "Testing library dependencies (--lib and --export)..."
node "$K_ROOT/backends/arm64/bin/k-arm64-compile.mjs" \
  --lib "$K_ROOT/Examples/arithmetics.k" \
  --export plus:+ --export succ --export int \
  '{succ int x,int y}+' \
  -o "$TMP_DIR/lib-add"

node "$K_ROOT/codecs/k-parse.mjs" <<< '{"x":{"succ":"zero"},"y":{"succ":{"succ":"zero"}}}' |
  "$TMP_DIR/lib-add" --json |
  grep -Fxq '{"+":{"1":"_"}}'

echo "==> ARM64 Integration Tests Completed Successfully!"
