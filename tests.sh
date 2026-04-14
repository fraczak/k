
# This script is used to run the k.mjs interpreter with various test cases.

echo "Running './tests.sh' ..."

echo '["zebara", "ela", "kupa", ala, owca]' | ./k-encode.mjs | ./k.mjs '{.1 0,.3 1}' | ./k-decode.mjs
