#!/usr/bin/env bash
# Local four-node rtgip/2 staging: four separate throwaway PostgreSQL clusters (AutoLabels,
# AutoCurb, AutoFrame and a Gateway stand-in), each on its own 127.0.0.1 port and data
# directory, driven over real HTTP by src/lib/rooftopos-parked/rtgip2-staging. Every signing key
# is generated at test start and discarded with the clusters. Never connects to Supabase or any
# hosted system. The Gateway node is a stand-in built from the shared core, NOT the hosted
# Gateway (Lovable project f8ad9239), which does not implement rtgip/2 yet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
BASE="${RTGIP_STG_PORT:-55460}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
NODES=(autolabels autocurb autoframe gateway)
cleanup() {
  for n in "${NODES[@]}"; do "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/$n" -m immediate stop >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT
cp -r "$ROOT/supabase" "$WORK/sb"; chmod -R a+rX "$WORK/sb"

i=0
for n in "${NODES[@]}"; do
  port=$((BASE + i)); i=$((i + 1))
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/$n" -U postgres -A trust >/dev/null
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/$n" -o "-p $port -k $WORK -c listen_addresses=127.0.0.1 -c max_connections=100" -l "$WORK/$n.log" -w start >/dev/null
  "${RUNAS[@]}" "$PGBIN/createdb" -h 127.0.0.1 -p "$port" -U postgres "stg_$n"
  eval "PORT_$n=$port"
done
psql_on() { local port=$1 db=$2; shift 2; "${RUNAS[@]}" "$PGBIN/psql" -h 127.0.0.1 -p "$port" -U postgres -d "$db" -qAtX "$@"; }
GRANTS="ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;"
apply_twice() {
  local port=$1 db=$2 f=$3
  psql_on "$port" "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { psql_on "$port" "$db" -v ON_ERROR_STOP=1 -f "$f"; exit 1; }
  psql_on "$port" "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "FAIL  $f is not idempotent on $db"; exit 1; }
}

# AutoLabels: platform stubs, full migration history, spine, PR #46, delivery ledger, readers.
P=$PORT_autolabels; D=stg_autolabels
psql_on $P $D -v ON_ERROR_STOP=1 -f "$WORK/sb/tests/rooftopos_stubs.sql" >/dev/null
psql_on $P $D -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; GRANT USAGE ON SCHEMA extensions TO PUBLIC;
  ALTER DATABASE $D SET search_path = \"\$user\", public, extensions" >/dev/null
for f in $(ls "$WORK"/sb/migrations/*.sql | grep -v rooftopos_spine); do psql_on $P $D -f "$f" >/dev/null 2>>"$WORK/history.err" || true; done
psql_on $P $D -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/20261030000000_rooftopos_spine.sql" >/dev/null 2>&1
psql_on $P $D -c "CREATE TABLE IF NOT EXISTS public.dealer_stores (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)" >/dev/null 2>&1
psql_on $P $D -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/20261109000000_vehicle_history_foundation.sql" >/dev/null 2>&1
psql_on $P $D -c "$GRANTS" >/dev/null
apply_twice $P $D "$WORK/sb/proposed/rtgip_v2_delivery.proposed.sql"
apply_twice $P $D "$WORK/sb/proposed/rtgip_source_readers.proposed.sql"
apply_twice $P $D "$WORK/sb/tests/rtgip/staging_node.sql"

# AutoCurb and AutoFrame: Supabase role and Vault stand-ins, then the byte-identical delivery
# ledger (each app repo verifies its own source-reader SQL in its own CI).
for n in autocurb autoframe; do
  eval "P=\$PORT_$n"; D="stg_$n"
  psql_on $P $D -v ON_ERROR_STOP=1 -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text NOT NULL);
    REVOKE ALL ON SCHEMA vault FROM PUBLIC; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; GRANT USAGE ON SCHEMA extensions TO PUBLIC;" >/dev/null
  psql_on $P $D -c "$GRANTS" >/dev/null
  apply_twice $P $D "$WORK/sb/proposed/rtgip_v2_delivery.proposed.sql"
  apply_twice $P $D "$WORK/sb/tests/rtgip/staging_node.sql"
done

# Gateway stand-in: durable admissions, source-nonce claims and an append-only audit.
P=$PORT_gateway; D=stg_gateway
psql_on $P $D -v ON_ERROR_STOP=1 -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;" >/dev/null
psql_on $P $D -c "$GRANTS" >/dev/null
apply_twice $P $D "$WORK/sb/tests/rtgip/gateway_standin.sql"

echo "four clusters up (ports $PORT_autolabels-$PORT_gateway, Postgres $(psql_on $PORT_gateway stg_gateway -c 'SHOW server_version'))"
cd "$ROOT"
RTGIP_STG_AUTOLABELS="postgres://postgres@127.0.0.1:$PORT_autolabels/stg_autolabels" \
RTGIP_STG_AUTOCURB="postgres://postgres@127.0.0.1:$PORT_autocurb/stg_autocurb" \
RTGIP_STG_AUTOFRAME="postgres://postgres@127.0.0.1:$PORT_autoframe/stg_autoframe" \
RTGIP_STG_GATEWAY="postgres://postgres@127.0.0.1:$PORT_gateway/stg_gateway" \
RTGIP_STG_REPORT="${RTGIP_STG_REPORT:-}" \
  npx vitest run src/lib/rooftopos-parked/rtgip2-staging
