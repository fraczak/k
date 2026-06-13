#!/usr/bin/env bash
set -euo pipefail

# This script is used to run the k.mjs interpreter with various test cases.

echo "Running './tests/integration.sh' ..."

TMP_DIR=`mktemp -d`
trap 'rm -rf "$TMP_DIR"' EXIT

./objects/compile.mjs 'x = |x; x x' "$TMP_DIR/inline.ko"
./objects/decompile.mjs "$TMP_DIR/inline.ko" | grep -q '^----- main -----$'
./objects/inspect.mjs "$TMP_DIR/inline.ko" | grep -q '^format: k-object$'
./objects/inspect.mjs --kir "$TMP_DIR/inline.ko" | grep -q '"format": "k-ir"'
./kir.mjs --help | grep -q 'Export the KIR-P JSON view'
./kir.mjs "$TMP_DIR/inline.ko" | grep -q '"format": "k-ir"'
./objects/validate.mjs "$TMP_DIR/inline.ko" | grep -q '^OK object$'
./kir.mjs "$TMP_DIR/inline.ko" > "$TMP_DIR/inline.kir.json"
./objects/validate.mjs --kir "$TMP_DIR/inline.kir.json" | grep -q '^OK KIR-P$'
printf '()' | ./objects/compile.mjs > "$TMP_DIR/stdin.ko"
./objects/decompile.mjs "$TMP_DIR/stdin.ko" | grep -q '^----- main -----$'
./objects/compile.mjs --format kvm '()' | grep -q '"__main__"'
./objects/compile.mjs "$TMP_DIR/stdin.ko" "$TMP_DIR/stdin.kvm"
grep -q '"__main__"' "$TMP_DIR/stdin.kvm"
./objects/compile.mjs 'id = ();' "$TMP_DIR/export.klib"
./objects/compile.mjs --lib "$TMP_DIR/export.klib" --export id:alias 'alias' "$TMP_DIR/export.ko"
./objects/decompile.mjs "$TMP_DIR/export.ko" | grep -q '^----- main -----$'
node ./codecs/unit.mjs --parse | ./k.mjs --lib "$TMP_DIR/export.klib" --export id:alias 'alias' | node ./codecs/unit.mjs --print | grep -qx '{}'
node ./codecs/unit.mjs --parse | ./kvm.mjs --lib "$TMP_DIR/export.klib" --export id:alias 'alias' | node ./codecs/unit.mjs --print | grep -qx '{}'
node ./codecs/unit.mjs --parse | ./k.mjs "$TMP_DIR/export.ko" | node ./codecs/unit.mjs --print | grep -qx '{}'
node ./codecs/unit.mjs --parse | ./kvm.mjs "$TMP_DIR/export.ko" | node ./codecs/unit.mjs --print | grep -qx '{}'
if ./k.mjs --lib "$TMP_DIR/export.klib" --lib "$TMP_DIR/export.klib" '()' > "$TMP_DIR/two-lib.out" 2> "$TMP_DIR/two-lib.err"; then
  echo "expected repeated --lib to fail" >&2
  exit 1
fi
grep -q -- '--lib may be specified at most once' "$TMP_DIR/two-lib.err"
if ./objects/compile.mjs --lib "$TMP_DIR/export.klib" --lib "$TMP_DIR/export.klib" '()' "$TMP_DIR/two-lib.ko" > "$TMP_DIR/two-lib-compile.out" 2> "$TMP_DIR/two-lib-compile.err"; then
  echo "expected repeated k-compile --lib to fail" >&2
  exit 1
fi
grep -q -- '--lib may be specified at most once' "$TMP_DIR/two-lib-compile.err"
if ./kvm.mjs --lib "$TMP_DIR/export.klib" --lib "$TMP_DIR/export.klib" '()' > "$TMP_DIR/two-lib-kvm.out" 2> "$TMP_DIR/two-lib-kvm.err"; then
  echo "expected repeated k-vm --lib to fail" >&2
  exit 1
fi
grep -q -- '--lib may be specified at most once' "$TMP_DIR/two-lib-kvm.err"
if ./objects/compile.mjs "$TMP_DIR/missing.k" > "$TMP_DIR/missing.out" 2> "$TMP_DIR/missing.err"; then
  echo "expected missing .k input to fail" >&2
  exit 1
fi
grep -q 'Input file not found:' "$TMP_DIR/missing.err"

echo '["zebara", "ela", "kupa", ala, owca]' | node ./codecs/k-parse.mjs | ./k.mjs '{.1 0,.3 1}' | node ./codecs/k-print.mjs
echo 
echo "a" | ./codecs/k-parse.mjs --input-type '?< {} a, X b, ...>' | ./k.mjs '{() i, /a o}' | ./codecs/show.mjs > "$TMP_DIR/polymorphic-relation.wire" 2> "$TMP_DIR/polymorphic-relation.show"
grep -Fqx '{{}|a i, {} o} ?{<{}=X0 a, (...) b, ...> i, X0 o}' "$TMP_DIR/polymorphic-relation.show"
./codecs/k-print.mjs "$TMP_DIR/polymorphic-relation.wire" | grep -qx '{"i":"a","o":{}}'
echo
echo '-21' | node ./codecs/int.mjs --parse | node ./codecs/int.mjs --print | grep -qx -- '-21'
echo
node ./codecs/unit.mjs --parse | node ./codecs/unit.mjs --print | grep -qx '{}'
echo 
if ./k.mjs -k Examples/byte.k > "$TMP_DIR/dash-k.out" 2> "$TMP_DIR/dash-k.err"; then
  echo "expected -k to fail" >&2
  exit 1
fi
grep -q -- '-k is no longer supported' "$TMP_DIR/dash-k.err"
if ./kvm.mjs -k Examples/byte.k > "$TMP_DIR/dash-k-kvm.out" 2> "$TMP_DIR/dash-k-kvm.err"; then
  echo "expected k-vm -k to fail" >&2
  exit 1
fi
grep -q -- '-k is no longer supported' "$TMP_DIR/dash-k-kvm.err"
printf 'A🙂\nBé~\t' | ./codecs/utf8.mjs --parse | ./k.mjs Examples/byte.k |./codecs/utf8.mjs --print
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
