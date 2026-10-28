#!/usr/bin/env bash
# Isolated run of the deployed passport-lead-escalation function.
#
# Builds a throwaway database from the db-verify pre-state and both applied
# Administration V2 migrations, adds synthetic dealerships and leads, starts a
# local PostgREST over it and a gateway that also fakes the mail sender, then
# runs supabase/functions/passport-lead-escalation/index.ts unmodified under
# Deno and drives it. The one substitution is the supabase-js import: the
# function pins it from esm.sh, which an import map points at the same
# package from npm. Nothing here contacts a hosted project or sends mail.
#
#   PGHOST=/path/to/socket PGPORT=54329 DENO=/path/deno POSTGREST=/path/postgrest \
#     scripts/escalation-verify/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${VERIFY_DB:-escalation_verify}
DENO=${DENO:-deno}
POSTGREST=${POSTGREST:-postgrest}
WORK=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
for f in scripts/db-verify/00_platform.sql scripts/db-verify/01_prestate.sql \
         supabase/migrations/20261029000000_admin_v2_policy_apply.sql \
         supabase/migrations/20261029001000_admin_v2_settings_authority.sql \
         scripts/escalation-verify/fixture.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$WORK/err" || { cat "$WORK/err"; exit 2; }
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
CRON_SECRET=local-cron-secret-$RANDOM
PGRST_PORT=${PGRST_PORT:-54400}; GATEWAY_PORT=${GATEWAY_PORT:-54401}

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
cat > "$WORK/import_map.json" <<EOF
{ "imports": { "https://esm.sh/@supabase/supabase-js@2": "npm:@supabase/supabase-js@$(node -p 'require("./node_modules/@supabase/supabase-js/package.json").version')" } }
EOF
PGRST_URL=http://127.0.0.1:$PGRST_PORT SERVICE_KEY=$SERVICE_KEY GATEWAY_PORT=$GATEWAY_PORT REFUSE_PREFIXES=refuse- \
  "$DENO" run --quiet --allow-net --allow-env scripts/escalation-verify/gateway.ts >"$WORK/gateway.log" 2>&1 & PIDS+=($!)
SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY MARKETCHECK_CRON_SECRET=$CRON_SECRET \
  "$DENO" run --quiet --allow-net --allow-env --allow-read --import-map="$WORK/import_map.json" \
  supabase/functions/passport-lead-escalation/index.ts >"$WORK/fn.log" 2>&1 & PIDS+=($!)

for i in $(seq 1 120); do
  if curl -s -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && curl -s -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/__sent" \
     && curl -s -o /dev/null -X OPTIONS http://127.0.0.1:8000/; then break; fi
  sleep 1
  [[ $i == 120 ]] && { echo "services did not start"; tail -20 "$WORK"/*.log; exit 2; }
done

echo "== Function source under test against the deployed commit (6746a95, deployed 2026-10-28 11:46 UTC)"
for f in supabase/functions/passport-lead-escalation/index.ts supabase/functions/_shared/escalation.ts \
         supabase/functions/_shared/passport-routing.ts supabase/functions/_shared/http.ts supabase/functions/_shared/supabase.ts; do
  here=$(git hash-object "$f"); deployed=$(git rev-parse "6746a95:$f" 2>/dev/null || echo missing)
  echo "$([[ $here == "$deployed" ]] && echo same || echo DIFFERENT) $here $f"
done
echo
FN_URL=http://127.0.0.1:8000/ GATEWAY_URL=http://127.0.0.1:$GATEWAY_PORT SERVICE_KEY=$SERVICE_KEY CRON_SECRET=$CRON_SECRET DB=$DB \
  python3 -I scripts/escalation-verify/drive.py
