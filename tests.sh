
# This script is used to run the k.mjs interpreter with various test cases.

echo "Running './tests.sh' ..."

echo '["zebara", "ela", "kupa", ala, owca]' | node ./codecs/k-parse.mjs | ./k.mjs '{.1 0,.3 1}' | node ./codecs/k-print.mjs
echo 
echo '-21' | node ./codecs/int.mjs --parse | node ./codecs/int.mjs --print | grep -qx -- '-21'
echo
node ./codecs/unit.mjs --parse | node ./codecs/unit.mjs --print | grep -qx '{}'
echo 
printf 'A🙂\nBé~\t' | ./codecs/utf8.mjs --parse | ./k.mjs -k Examples/byte.k |./codecs/utf8.mjs --print
echo
echo "1031" | ./codecs/ieee.mjs --parse | ./k.mjs -k Examples/ieee.k | ./codecs/ieee.mjs --print
echo
