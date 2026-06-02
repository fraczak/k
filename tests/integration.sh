#!/usr/bin/env bash
set -euo pipefail

# This script is used to run the k.mjs interpreter with various test cases.

echo "Running './tests/integration.sh' ..."

TMP_DIR=`mktemp -d`
trap 'rm -rf "$TMP_DIR"' EXIT

./objects/compile.mjs 'x = |x; x x' "$TMP_DIR/inline.ko"
./objects/decompile.mjs "$TMP_DIR/inline.ko" | grep -q '^----- main -----$'
printf '()' | ./objects/compile.mjs > "$TMP_DIR/stdin.ko"
./objects/decompile.mjs "$TMP_DIR/stdin.ko" | grep -q '^----- main -----$'
./objects/compile.mjs --format kvm '()' | grep -q '"__main__"'
./objects/compile.mjs "$TMP_DIR/stdin.ko" "$TMP_DIR/stdin.kvm"
grep -q '"__main__"' "$TMP_DIR/stdin.kvm"
./objects/compile.mjs 'id = ();' "$TMP_DIR/export.klib"
./objects/compile.mjs --lib "$TMP_DIR/export.klib" --export id:alias 'alias' "$TMP_DIR/export.ko"
./objects/decompile.mjs "$TMP_DIR/export.ko" | grep -q '^----- main -----$'
node ./codecs/unit.mjs --parse | ./k.mjs --lib "$TMP_DIR/export.klib" --export id:alias 'alias' | node ./codecs/unit.mjs --print | grep -qx '{}'
if ./objects/compile.mjs "$TMP_DIR/missing.k" > "$TMP_DIR/missing.out" 2> "$TMP_DIR/missing.err"; then
  echo "expected missing .k input to fail" >&2
  exit 1
fi
grep -q 'Input file not found:' "$TMP_DIR/missing.err"

echo '["zebara", "ela", "kupa", ala, owca]' | node ./codecs/k-parse.mjs | ./k.mjs '{.1 0,.3 1}' | node ./codecs/k-print.mjs
echo 
echo '-21' | node ./codecs/int.mjs --parse | node ./codecs/int.mjs --print | grep -qx -- '-21'
echo
node ./codecs/unit.mjs --parse | node ./codecs/unit.mjs --print | grep -qx '{}'
echo 
printf 'A🙂\nBé~\t' | ./codecs/utf8.mjs --parse | ./k.mjs -k Examples/byte.k |./codecs/utf8.mjs --print
echo
./objects/compile.mjs Examples/ieee.k "$TMP_DIR/ieee.klib"
MUL=`./objects/extract-aliases.mjs "$TMP_DIR/ieee.klib" | grep '^mul = @' | sed 's/^mul = \(@[^;]*\);.*$/\1/'`
DIV=`./objects/extract-aliases.mjs "$TMP_DIR/ieee.klib" | grep '^div = @' | sed 's/^div = \(@[^;]*\);.*$/\1/'`
ARG=0.12
printf "$ARG * $ARG = "
echo $ARG | ./codecs/ieee.mjs --parse | ./k.mjs --lib "$TMP_DIR/ieee.klib" "{()x,()y} $MUL .result" | ./codecs/ieee.mjs --print
printf "$ARG / $ARG = "
DIV_RESULT=`echo $ARG | ./codecs/ieee.mjs --parse | ./k.mjs --lib "$TMP_DIR/ieee.klib" "{()x,()y} $DIV .result" | ./codecs/ieee.mjs --print`
echo "$DIV_RESULT"
test "$DIV_RESULT" = "1"
echo
