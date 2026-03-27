#!/bin/bash -eu

cd $SRC/termbeam
npm install --ignore-scripts

compile_javascript_fuzzer termbeam fuzz/fuzz_ws_message.js fuzz_ws_message
compile_javascript_fuzzer termbeam fuzz/fuzz_auth.js fuzz_auth
