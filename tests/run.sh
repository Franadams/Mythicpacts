#!/bin/bash
# Runs the JavaScript tests with JavaScriptCore, which ships with macOS.
cd "$(dirname "$0")/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
status=0
for t in tests/*.test.js; do
  echo "== $t"
  if [ "$t" = "tests/online.test.js" ]; then "$JSC" src/engine.js src/online.js "$t" || status=1
  else "$JSC" src/engine.js "$t" || status=1; fi
done
exit $status
