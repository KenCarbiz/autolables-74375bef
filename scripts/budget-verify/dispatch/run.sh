#!/usr/bin/env bash
# Isolated run of provider-budget-alerts: a throwaway copy of the replica with
# supabase/proposed/20261103000000 applied, a local PostgREST, and a gateway
# that records send-email and send-sms calls instead of delivering them. The
# function runs under Deno with network access limited to 127.0.0.1 (plus its
# own listening address, 0.0.0.0:8000, which Deno.serve binds); its only
# substitutions are two imports through an import map (supabase-js from npm;
# std's serve() as a Deno.serve shim). No email or text message leaves the
# machine.
#
#   PGHOST=/path/to/socket PGPORT=54329 DENO=/path/deno POSTGREST=/path/postgrest \
#     BASE_DB=crawl_verify_base scripts/budget-verify/dispatch/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
DENO=${DENO:-deno}
POSTGREST=${POSTGREST:-postgrest}
BASE=${BASE_DB:?set BASE_DB to a replica template, e.g. budget_verify_base from scripts/budget-verify/run.sh}
DB=budget_verify_dispatch
WORK=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE $BASE" >/dev/null 2>&1
"${PSQL[@]}" -d "$DB" -f supabase/proposed/20261103000000_provider_tenant_budgets.sql >/dev/null 2>&1
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
-- Replica alignment, as in checks.sql: granted on the hosted project by 20260626050347.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
INSERT INTO auth.users (id, email) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('b1000000-0000-4000-8000-000000000002', 'dealer-user@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('b1000000-0000-4000-8000-000000000001', 'admin');
SQL

SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
SERVICE_KEY=$(python3 - "$SECRET" <<'EOF'
import base64, hashlib, hmac, json, sys, time
b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=")
head, body = b({"alg": "HS256", "typ": "JWT"}), b({"role": "service_role", "iss": "local-verify", "iat": int(time.time()), "exp": int(time.time()) + 3600})
sig = base64.urlsafe_b64encode(hmac.new(sys.argv[1].encode(), head + b"." + body, hashlib.sha256).digest()).rstrip(b"=")
print((head + b"." + body + b"." + sig).decode())
EOF
)
PGRST_PORT=54430; GATEWAY_PORT=54431; FN_PORT=8000
cat > "$WORK/pgrst.conf" <<EOF
db-uri = "postgres://authenticator@/$DB?host=${PGHOST:-/tmp}&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
log-level = "error"
EOF
SB=$(node -p 'require("./node_modules/@supabase/supabase-js/package.json").version')
cat > "$WORK/import_map.json" <<EOF
{ "imports": {
  "https://esm.sh/@supabase/supabase-js@2": "npm:@supabase/supabase-js@$SB",
  "https://esm.sh/@supabase/supabase-js@2.45.0": "npm:@supabase/supabase-js@$SB",
  "https://deno.land/std@0.168.0/http/server.ts": "$(pwd)/scripts/sync-verify/serve-shim.ts" } }
EOF
echo "== Function under test: working tree supabase/functions/provider-budget-alerts/index.ts $(git hash-object supabase/functions/provider-budget-alerts/index.ts)"

"$POSTGREST" "$WORK/pgrst.conf" >"$WORK/pgrst.log" 2>&1 & PIDS+=($!)
PGRST_URL=http://127.0.0.1:$PGRST_PORT GATEWAY_PORT=$GATEWAY_PORT \
  "$DENO" run --quiet --allow-net=127.0.0.1 --allow-env scripts/budget-verify/dispatch/gateway.ts >"$WORK/gateway.log" 2>&1 & PIDS+=($!)
SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY APP_BASE_URL=https://app.example.test \
  "$DENO" run --quiet --allow-net=127.0.0.1,0.0.0.0:$FN_PORT --allow-env --allow-read --import-map="$WORK/import_map.json" \
  supabase/functions/provider-budget-alerts/index.ts >"$WORK/fn.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 120); do
  if curl -s -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && curl -s -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/__sent" \
     && curl -s -o /dev/null -X OPTIONS "http://127.0.0.1:$FN_PORT/"; then break; fi
  sleep 1
  [[ $i == 120 ]] && { echo "services did not start"; tail -n 20 "$WORK"/*.log; exit 2; }
done

status=0
FN_URL=http://127.0.0.1:$FN_PORT/ GATEWAY_URL=http://127.0.0.1:$GATEWAY_PORT SERVICE_KEY=$SERVICE_KEY DB=$DB \
  python3 -I scripts/budget-verify/dispatch/drive.py || status=$?
[[ $status != 0 ]] && tail -n 30 "$WORK/fn.log"
exit $status
