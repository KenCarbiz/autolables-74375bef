#!/usr/bin/env bash
# Isolated run of the marketcheck-sync function against recorded synthetic
# provider responses.
#
# Builds a throwaway database from the full supabase/migrations chain on local
# platform stand-ins, aligns the columns the sync touches to the hosted
# catalogue, takes three function bodies as the hosted project defines them,
# adds synthetic dealerships and inventory, starts a local PostgREST and a
# gateway that serves the recorded provider responses, then runs
# supabase/functions/marketcheck-sync/index.ts under Deno with network access
# limited to 127.0.0.1. Three substitutions: two imports through an import map
# (supabase-js from npm; std's serve() as a Deno.serve shim, because deno.land
# cannot be fetched here) and the provider base URL, pointed at the gateway and
# printed as a diff. No provider, hosted project or mail service can
# be reached.
#
#   PGHOST=/path/to/socket PGPORT=54329 DENO=/path/deno POSTGREST=/path/postgrest \
#     scripts/sync-verify/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${VERIFY_DB:-sync_verify}
DENO=${DENO:-deno}
POSTGREST=${POSTGREST:-postgrest}
WORK=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")

# pg_cron and pg_net are not installed locally; the chain only needs CREATE
# EXTENSION to succeed, and their functions come from the stand-ins.
EXT=$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/16)/extension
for x in pg_cron pg_net; do
  [[ -f $EXT/$x.control ]] || { printf "comment = 'local stand-in'\ndefault_version = '1.0'\nrelocatable = false\n" > "$EXT/$x.control"; echo "-- stand-in" > "$EXT/$x--1.0.sql"; }
done

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
"${PSQL[@]}" -d "$DB" -f scripts/db-verify/00_platform.sql >/dev/null 2>&1
"${PSQL[@]}" -d "$DB" -f scripts/sync-verify/platform.sql >/dev/null
applied=0; failed=0
for f in supabase/migrations/*.sql; do
  if "${PSQL[@]}" -d "$DB" -1 -f "$f" >/dev/null 2>&1; then applied=$((applied+1)); else failed=$((failed+1)); fi
done
echo "== Migration chain: $applied applied, $failed did not apply on the local stand-ins"
for f in align hosted-functions fixture; do
  "${PSQL[@]}" -d "$DB" -f "scripts/sync-verify/$f.sql" >/dev/null 2>"$WORK/err" || { cat "$WORK/err"; exit 2; }
done

SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
SERVICE_KEY=$(python3 - "$SECRET" <<'EOF'
import base64, hashlib, hmac, json, sys, time
b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=")
head, body = b({"alg": "HS256", "typ": "JWT"}), b({"role": "service_role", "iss": "local-verify", "iat": int(time.time()), "exp": int(time.time()) + 3600})
sig = base64.urlsafe_b64encode(hmac.new(sys.argv[1].encode(), head + b"." + body, hashlib.sha256).digest()).rstrip(b"=")
print((head + b"." + body + b"." + sig).decode())
EOF
)
PGRST_PORT=${PGRST_PORT:-54410}; GATEWAY_PORT=${GATEWAY_PORT:-54411}; FN_PORT=8000

cat > "$WORK/pgrst.conf" <<EOF
db-uri = "postgres://authenticator@/$DB?host=${PGHOST:-/tmp}&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
log-level = "error"
EOF
"$POSTGREST" "$WORK/pgrst.conf" >"$WORK/pgrst.log" 2>&1 & PIDS+=($!)

# SYNC_SOURCE_REV runs the function as it was at a git revision (the pre-fix
# stage); by default the working tree is used.
mkdir -p "$WORK/functions"
if [[ -n "${SYNC_SOURCE_REV:-}" ]]; then
  git archive "$SYNC_SOURCE_REV" supabase/functions/_shared supabase/functions/marketcheck-sync | tar -x -C "$WORK"
  mv "$WORK/supabase/functions/_shared" "$WORK/supabase/functions/marketcheck-sync" "$WORK/functions/"
  SRC_LABEL="$SYNC_SOURCE_REV:supabase/functions/marketcheck-sync/index.ts $(git rev-parse "$SYNC_SOURCE_REV:supabase/functions/marketcheck-sync/index.ts")"
else
  cp -r supabase/functions/_shared supabase/functions/marketcheck-sync "$WORK/functions/"
  SRC_LABEL="working tree supabase/functions/marketcheck-sync/index.ts $(git hash-object supabase/functions/marketcheck-sync/index.ts)"
fi
ORIGINAL='const MC_BASE = "https://api.marketcheck.com/v2";'
REPLACED="const MC_BASE = \"http://127.0.0.1:$GATEWAY_PORT/mc/v2\";"
grep -qxF "$ORIGINAL" "$WORK/functions/marketcheck-sync/index.ts" || { echo "provider base URL line not found"; exit 2; }
sed -i "s|^$ORIGINAL\$|$REPLACED|" "$WORK/functions/marketcheck-sync/index.ts"
echo "== Function under test: $SRC_LABEL"
grep -n "^const MC_BASE" "$WORK/functions/marketcheck-sync/index.ts" | sed 's/^/   substituted: /' 
cat > "$WORK/import_map.json" <<EOF
{ "imports": {
  "https://esm.sh/@supabase/supabase-js@2.45.0": "npm:@supabase/supabase-js@$(node -p 'require("./node_modules/@supabase/supabase-js/package.json").version')",
  "https://deno.land/std@0.168.0/http/server.ts": "$(pwd)/scripts/sync-verify/serve-shim.ts" } }
EOF

PGRST_URL=http://127.0.0.1:$PGRST_PORT GATEWAY_PORT=$GATEWAY_PORT FIXTURE_DIR=$(pwd)/scripts/sync-verify/fixture \
  "$DENO" run --quiet --allow-net=127.0.0.1 --allow-env --allow-read scripts/sync-verify/gateway.ts >"$WORK/gateway.log" 2>&1 & PIDS+=($!)
SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY \
  MARKETCHECK_API_KEY=synthetic-not-a-key MARKETCHECK_CRON_SECRET=local-cron-secret ENRICH_PER_RUN=0 \
  "$DENO" run --quiet --allow-net=127.0.0.1 --allow-env --allow-read --import-map="$WORK/import_map.json" \
  "$WORK/functions/marketcheck-sync/index.ts" >"$WORK/fn.log" 2>&1 & PIDS+=($!)

for i in $(seq 1 120); do
  if curl -s -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && curl -s -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/__provider" \
     && curl -s -o /dev/null -X OPTIONS "http://127.0.0.1:$FN_PORT/"; then break; fi
  sleep 1
  [[ $i == 120 ]] && { echo "services did not start"; tail -n 20 "$WORK"/*.log; exit 2; }
done

status=0
FN_URL=http://127.0.0.1:$FN_PORT/ GATEWAY_URL=http://127.0.0.1:$GATEWAY_PORT SERVICE_KEY=$SERVICE_KEY DB=$DB \
  python3 -I scripts/sync-verify/drive.py || status=$?
if [[ -n "${SYNC_VERIFY_LOGS:-}" ]]; then cp "$WORK"/*.log "$SYNC_VERIFY_LOGS"/; fi
exit $status
