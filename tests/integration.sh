#!/usr/bin/env bash
set -euo pipefail

# This script is used to run the k.mjs interpreter with various test cases.

echo "Running './tests/integration.sh' ..."

TMP_DIR=`mktemp -d`
trap 'rm -rf "$TMP_DIR"' EXIT

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
