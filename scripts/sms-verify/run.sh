#!/usr/bin/env bash
# Signal House SDK compatibility check, with the real npm package and no
# provider call:
#   1. deno check of every function that imports _shared/signalhouse.ts, with
#      npm: specifiers resolved from the registry (the deploy path);
#   2. the same under the preview's resolution (a local node_modules from the
#      committed bun.lock), which is where the edge pin and the lockfile must
#      agree;
#   3. the unmodified wrapper driven against a local capture server with the
#      SDK version it pins (and, with COMPARE_VERSION, the same wrapper with
#      the pin swapped, to compare what each version sends).
#   DENO=/path/deno scripts/sms-verify/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DENO=${DENO:-deno}
PORT=${CAPTURE_PORT:-54451}
WORK=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
PIN=$(grep -oE 'npm:@signalhousellc/sdk@[0-9.]+' supabase/functions/_shared/signalhouse.ts | head -1)
LOCKED=$(grep -oE '"@signalhousellc/sdk": \["@signalhousellc/sdk@[0-9.]+' bun.lock | grep -oE '[0-9.]+$')
echo "== Edge pin: $PIN; bun.lock resolves @signalhousellc/sdk to $LOCKED"
status=0
FNS=(send-sms signalhouse-webhook verify-passport-document-request)
# deno.land and esm.sh are not reachable here: std's serve() is mapped to a
# Deno.serve shim and supabase-js to its npm package, the same substitutions
# as the other harnesses. The Signal House SDK is NOT substituted.
SB=$(node -p 'require("./node_modules/@supabase/supabase-js/package.json").version')
python3 - "$WORK/im.json" "$SB" "$(pwd)/scripts/sync-verify/serve-shim.ts" <<'PY'
import json, re, subprocess, sys
out, sb, shim = sys.argv[1:4]
src = subprocess.run(["grep", "-rhoE", r"https://(esm\.sh/@supabase/supabase-js@[0-9.]+|deno\.land/std@[0-9.]+/http/server\.ts)", "supabase/functions"], capture_output=True, text=True).stdout.split()
imports = {u: (f"npm:@supabase/supabase-js@{sb}" if "supabase-js" in u else shim) for u in sorted(set(src))}
json.dump({"imports": imports}, open(out, "w"), indent=1)
PY

echo; echo "== 1. deno check, npm packages from the registry"
for f in "${FNS[@]}"; do
  if (cd "$WORK" && "$DENO" check --quiet --node-modules-dir=none --import-map="$WORK/im.json" "$OLDPWD/supabase/functions/$f/index.ts" >"$WORK/check-$f.log" 2>&1); then echo "PASS  $f"; else echo "FAIL  $f"; grep -m3 -E "error|TS[0-9]+" "$WORK/check-$f.log" | sed 's/\x1b\[[0-9;]*m//g'; status=1; fi
done

echo; echo "== 2. the preview's resolution: node_modules installed from the committed bun.lock"
mkdir -p "$WORK/preview/supabase"
cp package.json bun.lock "$WORK/preview/"
cp -r supabase/functions "$WORK/preview/supabase/"
if (cd "$WORK/preview" && bun install --frozen-lockfile --ignore-scripts >"$WORK/bun.log" 2>&1); then
  echo "   installed: $(node -p "require('$WORK/preview/node_modules/@signalhousellc/sdk/package.json').version")"
  for f in "${FNS[@]}"; do
    if (cd "$WORK/preview" && "$DENO" check --quiet --import-map="$WORK/im.json" "supabase/functions/$f/index.ts" >"$WORK/pv-$f.log" 2>&1); then echo "PASS  $f"; else echo "FAIL  $f"; grep -m2 -iE "error|not find" "$WORK/pv-$f.log" | sed 's/\x1b\[[0-9;]*m//g'; status=1; fi
  done
  if [[ -n "${PREVIOUS_PIN:-}" ]]; then
    echo "-- reproduction: the same node_modules with the edge pin set back to $PREVIOUS_PIN (expected to fail, as the preview did)"
    sed -i "s|npm:@signalhousellc/sdk@[0-9.]*|npm:@signalhousellc/sdk@$PREVIOUS_PIN|" "$WORK/preview/supabase/functions/_shared/signalhouse.ts" "$WORK/preview/supabase/functions/_shared/signalhouse-sdk.d.ts"
    if (cd "$WORK/preview" && "$DENO" check --quiet --import-map="$WORK/im.json" "supabase/functions/send-sms/index.ts" >"$WORK/pv-prev.log" 2>&1); then
      echo "NOTE  send-sms checks with $PREVIOUS_PIN as well (no reproduction)"
    else
      echo "REPRODUCED  send-sms fails: $(grep -m1 -iE "error" "$WORK/pv-prev.log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-220)"
    fi
  fi
else
  echo "SKIP  bun install from the lockfile failed:"; tail -3 "$WORK/bun.log"
fi

echo; echo "== 3. the wrapper against a local capture server"
"$DENO" run --quiet --allow-net=127.0.0.1 --allow-env scripts/sms-verify/capture.ts & PIDS+=($!)
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/__seen" && break; sleep 1; done
drive() {
  SIGNALHOUSE_API_KEY=synthetic-token-not-a-key SIGNALHOUSE_FROM_NUMBER=2025550199 SIGNALHOUSE_API_BASE="http://127.0.0.1:$PORT" \
    SIGNALHOUSE_STATUS_CALLBACK_URL="http://127.0.0.1:$PORT/status" CAPTURE_URL="http://127.0.0.1:$PORT" \
    "$DENO" run --quiet --node-modules-dir=none --allow-net=127.0.0.1 --allow-env --allow-read --allow-sys "$1"
}
echo "-- pinned version ($PIN)"
CHECK_TIMEOUT=${CHECK_TIMEOUT:-1} drive scripts/sms-verify/drive.ts || status=1
if [[ -n "${COMPARE_VERSION:-}" ]]; then
  mkdir -p "$WORK/cmp/supabase/functions/_shared" "$WORK/cmp/scripts/sms-verify"
  sed "s|npm:@signalhousellc/sdk@[0-9.]*|npm:@signalhousellc/sdk@$COMPARE_VERSION|" supabase/functions/_shared/signalhouse.ts > "$WORK/cmp/supabase/functions/_shared/signalhouse.ts"
  sed "s|npm:@signalhousellc/sdk@[0-9.]*|npm:@signalhousellc/sdk@$COMPARE_VERSION|" supabase/functions/_shared/signalhouse-sdk.d.ts > "$WORK/cmp/supabase/functions/_shared/signalhouse-sdk.d.ts"
  cp scripts/sms-verify/drive.ts "$WORK/cmp/scripts/sms-verify/"
  echo; echo "-- comparison: the same wrapper pinned to $COMPARE_VERSION"
  CHECK_TIMEOUT=${CHECK_TIMEOUT:-1} drive "$WORK/cmp/scripts/sms-verify/drive.ts" || echo "      (comparison only; does not fail the check)"
fi
exit $status
