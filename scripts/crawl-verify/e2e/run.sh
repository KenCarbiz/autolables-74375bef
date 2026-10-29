#!/usr/bin/env bash
# Isolated end-to-end run of crawl-advertised-prices against synthetic dealer
# pages, in three stages on fresh copies of one replica:
#
#   prefix    the crawler as it was at CRAWL_PREFIX_REV (default 3836dc3, the
#             last commit before the fix), on the hosted schema: a deliberate
#             reproduction; the corrected-contract checks are expected to fail
#   missing   the fixed crawler with 20261101 and 20261102 but without the
#             crawl controls (20261104): paused, nothing happens
#   paused    all three applied, controls at their defaults (both off): paused
#   noschema  the controls on, but 20261101 and 20261102 not applied: nothing
#             may change any listing's pricing
#   observe   execution on, promotion off: observations and evidence stored,
#             no listing price changes
#   inflight  both on at the start; an admin hold is set during the first
#             render: the run already in flight promotes nothing
#   fixed     all three applied, both switches on
#   budget    as fixed, plus 20261103000000 (per-dealership budgets) with no
#             budget set: must behave exactly as fixed
#   refused   as budget, with the dealership's Firecrawl budget enforced at
#             zero: no render may be sent and nothing may change
# The switches are set directly as the database owner here, standing in for
# the audited admin function, which scripts/crawl-verify/control checks.
#
# The replica is the full migration chain on local stand-ins, aligned to the
# hosted catalogue, with the hosted definitions of the functions the crawler
# and the listing triggers call. A local PostgREST and a gateway stand in for
# the hosted project, the renderer and the evidence bucket. The crawler runs
# with network access limited to 127.0.0.1 and three substitutions, printed:
# the renderer's two endpoints (pointed at the gateway) and two imports through
# an import map (supabase-js from npm; std's serve() as a Deno.serve shim).
#
#   PGHOST=/path/to/socket PGPORT=54329 DENO=/path/deno POSTGREST=/path/postgrest \
#     scripts/crawl-verify/e2e/run.sh [prefix] [noschema] [fixed]
set -euo pipefail
cd "$(dirname "$0")/../../.."
DENO=${DENO:-deno}
POSTGREST=${POSTGREST:-postgrest}
PREFIX_REV=${CRAWL_PREFIX_REV:-3836dc3}
STAGES=("$@"); [[ ${#STAGES[@]} -eq 0 ]] && STAGES=(prefix missing paused noschema observe inflight fixed)
WORK=$(mktemp -d)
PIDS=()
stop() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; PIDS=(); sleep 1; }
trap 'stop; rm -rf "$WORK"' EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
BASE=crawl_verify_base

EXT=$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/16)/extension
for x in pg_cron pg_net; do
  [[ -f $EXT/$x.control ]] || { printf "comment = 'local stand-in'\ndefault_version = '1.0'\nrelocatable = false\n" > "$EXT/$x.control"; echo "-- stand-in" > "$EXT/$x--1.0.sql"; }
done

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $BASE" -c "CREATE DATABASE $BASE" >/dev/null 2>&1
"${PSQL[@]}" -d "$BASE" -f scripts/db-verify/00_platform.sql >/dev/null 2>&1
"${PSQL[@]}" -d "$BASE" -f scripts/sync-verify/platform.sql >/dev/null 2>&1
applied=0; failed=0
for f in supabase/migrations/*.sql; do
  if "${PSQL[@]}" -d "$BASE" -1 -f "$f" >/dev/null 2>&1; then applied=$((applied+1)); else failed=$((failed+1)); fi
done
echo "== Migration chain: $applied applied, $failed did not apply on the local stand-ins"
for f in scripts/sync-verify/align.sql scripts/sync-verify/hosted-functions.sql scripts/crawl-verify/e2e/hosted-functions.sql scripts/crawl-verify/e2e/fixture.sql; do
  "${PSQL[@]}" -d "$BASE" -f "$f" >/dev/null 2>"$WORK/err" || { cat "$WORK/err"; exit 2; }
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
PGRST_PORT=54420; GATEWAY_PORT=54421; FN_PORT=8000
cat > "$WORK/import_map.json" <<EOF
{ "imports": {
  "https://esm.sh/@supabase/supabase-js@2.45.0": "npm:@supabase/supabase-js@$(node -p 'require("./node_modules/@supabase/supabase-js/package.json").version')",
  "https://deno.land/std@0.168.0/http/server.ts": "$(pwd)/scripts/sync-verify/serve-shim.ts" } }
EOF

overall=0
for STAGE in "${STAGES[@]}"; do
  DB=crawl_verify_$STAGE
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE $BASE" >/dev/null
  if [[ $STAGE != prefix ]]; then
    MIGS=()
    [[ $STAGE != noschema ]] && MIGS+=(supabase/proposed/20261101000000_price_component_evidence.sql supabase/proposed/20261102000000_crawl_observation_basis.sql)
    [[ $STAGE != missing ]] && MIGS+=(supabase/proposed/20261104000000_crawl_control.sql)
    [[ $STAGE == budget || $STAGE == refused ]] && MIGS+=(supabase/proposed/20261103000000_provider_tenant_budgets.sql)
    for f in "${MIGS[@]}"; do
      "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
    done
    # The crawl_control grants are the migration's own (SELECT only); every
    # other table as the hosted service role has it.
    "${PSQL[@]}" -d "$DB" -c "DO \$\$ DECLARE t text; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'crawl_control' LOOP EXECUTE format('GRANT ALL ON public.%I TO service_role', t); END LOOP; END \$\$" >/dev/null
    case $STAGE in
      noschema|inflight|fixed|budget|refused) SWITCHES="true, true" ;;
      observe) SWITCHES="true, false" ;;
      *) SWITCHES="" ;;
    esac
    [[ -n $SWITCHES ]] && "${PSQL[@]}" -d "$DB" -c "UPDATE public.crawl_control SET (execution_enabled, promotion_enabled) = ($SWITCHES)" >/dev/null
  fi
  if [[ $STAGE == refused ]]; then
    "${PSQL[@]}" -d "$DB" -c "INSERT INTO public.provider_tenant_budgets (tenant_id, provider, mode, monthly_call_cap) VALUES ('c0000000-0000-4000-8000-000000000001', 'firecrawl', 'enforce', 0)" >/dev/null
  fi

  SRC="$WORK/src-$STAGE"; mkdir -p "$SRC/functions"
  if [[ $STAGE == prefix ]]; then
    git archive "$PREFIX_REV" supabase/functions/_shared supabase/functions/crawl-advertised-prices | tar -x -C "$SRC"
    mv "$SRC/supabase/functions/_shared" "$SRC/supabase/functions/crawl-advertised-prices" "$SRC/functions/"
    LABEL="$PREFIX_REV:supabase/functions/crawl-advertised-prices/index.ts $(git rev-parse "$PREFIX_REV:supabase/functions/crawl-advertised-prices/index.ts")"
  else
    cp -r supabase/functions/_shared supabase/functions/crawl-advertised-prices "$SRC/functions/"
    LABEL="working tree supabase/functions/crawl-advertised-prices/index.ts $(git hash-object supabase/functions/crawl-advertised-prices/index.ts)"
  fi
  sed -i "s|^const FIRECRAWL_ENDPOINT = \"https://api.firecrawl.dev/v2/scrape\";\$|const FIRECRAWL_ENDPOINT = \"http://127.0.0.1:$GATEWAY_PORT/fc/v2/scrape\";|" "$SRC/functions/crawl-advertised-prices/index.ts"
  sed -i "s|^export const CREDIT_USAGE_ENDPOINT = \"https://api.firecrawl.dev/v2/team/credit-usage\";\$|export const CREDIT_USAGE_ENDPOINT = \"http://127.0.0.1:$GATEWAY_PORT/fc/v2/team/credit-usage\";|" "$SRC/functions/_shared/renderKey.ts"
  echo
  echo "======== Stage $STAGE: $LABEL"
  grep -n "^const FIRECRAWL_ENDPOINT" "$SRC/functions/crawl-advertised-prices/index.ts" | sed 's/^/   substituted: /'
  grep -n "^export const CREDIT_USAGE_ENDPOINT" "$SRC/functions/_shared/renderKey.ts" | sed 's/^/   substituted: /'

  cat > "$WORK/pgrst-$STAGE.conf" <<EOF
db-uri = "postgres://authenticator@/$DB?host=${PGHOST:-/tmp}&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
log-level = "error"
EOF
  "$POSTGREST" "$WORK/pgrst-$STAGE.conf" >"$WORK/pgrst-$STAGE.log" 2>&1 & PIDS+=($!)
  PGRST_URL=http://127.0.0.1:$PGRST_PORT GATEWAY_PORT=$GATEWAY_PORT PAGES_JSON=$(pwd)/scripts/crawl-verify/e2e/pages.json \
    FLIP_PROMOTION_AT_RENDER=$([[ $STAGE == inflight ]] && echo 1 || echo 0) FLIP_DB=$DB \
    "$DENO" run --quiet --allow-net=127.0.0.1 --allow-env --allow-read --allow-run=psql scripts/crawl-verify/e2e/gateway.ts >"$WORK/gateway-$STAGE.log" 2>&1 & PIDS+=($!)
  SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY \
    FIRECRAWL_API_KEY=synthetic-not-a-key FIRECRAWL_RPM=60 MARKETCHECK_CRON_SECRET=local-cron-secret \
    "$DENO" run --quiet --allow-net=127.0.0.1 --allow-env --allow-read --import-map="$WORK/import_map.json" \
    "$SRC/functions/crawl-advertised-prices/index.ts" >"$WORK/fn-$STAGE.log" 2>&1 & PIDS+=($!)
  for i in $(seq 1 120); do
    if curl -s -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && curl -s -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/__renders" \
       && curl -s -o /dev/null -X OPTIONS "http://127.0.0.1:$FN_PORT/"; then break; fi
    sleep 1
    [[ $i == 120 ]] && { echo "services did not start"; tail -n 20 "$WORK"/*-$STAGE.log; exit 2; }
  done
  status=0
  STAGE=$(case $STAGE in noschema|refused|missing|paused|observe|inflight) echo $STAGE;; *) echo contract;; esac) FN_URL=http://127.0.0.1:$FN_PORT/ \
    GATEWAY_URL=http://127.0.0.1:$GATEWAY_PORT SERVICE_KEY=$SERVICE_KEY DB=$DB PAGES_JSON=$(pwd)/scripts/crawl-verify/e2e/pages.json \
    python3 -I scripts/crawl-verify/e2e/drive.py || status=$?
  if [[ -n "${CRAWL_VERIFY_LOGS:-}" ]]; then cp "$WORK"/*-$STAGE.log "$CRAWL_VERIFY_LOGS"/ 2>/dev/null || true; fi
  echo "== Stage $STAGE exit $status"
  stop
  # The pre-fix stage is a reproduction: its failures are the defects.
  [[ $STAGE != prefix && $status != 0 ]] && overall=1
done
exit $overall
