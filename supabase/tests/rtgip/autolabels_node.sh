# shellcheck shell=bash
# AutoLabels disposable node bootstrap for the rtgip/2 harnesses. Source this file, then call
#   autolabels_node_bootstrap <port> <db> <supabase-copy-dir>
#   autolabels_node_seed      <port> <db> <supabase-copy-dir>   (optional synthetic seed)
# Requires PGBIN and RUNAS (an array, possibly empty) from the caller. Builds an EMPTY local
# database into an AutoLabels node: platform stand-ins, the app schema (repository migration
# history, replayed with its known errors), the drizzle 0006 stand-in, the RooftopOS spine,
# PR #46, the shared delivery ledger, the source readers and the consumer effects. Throwaway
# clusters on 127.0.0.1 only; never Supabase, never hosted.

_al_psql() { local port=$1 db=$2; shift 2; "${RUNAS[@]}" "$PGBIN/psql" -h 127.0.0.1 -p "$port" -U postgres -d "$db" -qAtX "$@"; }
_al_apply_twice() {
  local port=$1 db=$2 f=$3
  _al_psql "$port" "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { _al_psql "$port" "$db" -v ON_ERROR_STOP=1 -f "$f"; return 1; }
  _al_psql "$port" "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "FAIL  $f is not idempotent on $db"; return 1; }
}

autolabels_node_bootstrap() {
  local P=$1 D=$2 SB=$3 errlog
  errlog="$(dirname "$SB")/autolabels-$D-history.err"
  # 1. Platform stand-ins (auth, roles, vault, storage) and pgcrypto in extensions, as on Supabase.
  _al_psql $P $D -v ON_ERROR_STOP=1 -f "$SB/tests/rooftopos_stubs.sql" >/dev/null || return 1
  _al_psql $P $D -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; GRANT USAGE ON SCHEMA extensions TO PUBLIC;
    ALTER DATABASE $D SET search_path = \"\$user\", public, extensions" >/dev/null || return 1
  # 2. App schema: the repository history. It does not replay cleanly (see
  #    /mnt/project-files/rooftopos/phase3d/autolabels/migration-replay-report.md); the count is reported, not hidden.
  : > "$errlog"
  for f in $(ls "$SB"/migrations/*.sql | grep -v rooftopos_spine); do _al_psql $P $D -f "$f" >/dev/null 2>>"$errlog" || true; done
  echo "autolabels[$D]: migration history replayed ($(grep -c 'ERROR:' "$errlog" || true) known replay errors)"
  # Stand-in for drizzle 0006 (multistore inventory network), which supabase/migrations does not carry.
  _al_psql $P $D -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS public.dealer_stores (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
    ALTER TABLE public.dealer_stores ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
    ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS owning_store_id uuid" >/dev/null || return 1
  # 3. App proposals: spine, PR #46 foundation.
  _al_psql $P $D -v ON_ERROR_STOP=1 -f "$SB/proposed/20261030000000_rooftopos_spine.sql" >/dev/null 2>&1 \
    || { _al_psql $P $D -v ON_ERROR_STOP=1 -f "$SB/proposed/20261030000000_rooftopos_spine.sql"; return 1; }
  _al_psql $P $D -v ON_ERROR_STOP=1 -f "$SB/proposed/20261109000000_vehicle_history_foundation.sql" >/dev/null 2>&1 \
    || { _al_psql $P $D -v ON_ERROR_STOP=1 -f "$SB/proposed/20261109000000_vehicle_history_foundation.sql"; return 1; }
  _al_psql $P $D -c "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;" >/dev/null || return 1
  # 4. Shared delivery ledger, then the AutoLabels readers and consumer effects (each applied twice).
  local f
  for f in rtgip_v2_delivery.proposed.sql rtgip_source_readers.proposed.sql rtgip_labels_effects.proposed.sql; do
    _al_apply_twice $P $D "$SB/proposed/$f" || return 1
  done
  echo "autolabels[$D]: spine, PR #46, delivery ledger, readers and consumer effects applied (proposals twice)"
}

# 5. Synthetic seed. Ids come from the caller's environment (the shared rooftop registry when the
#    four-node harness runs it) and default to fresh random values. Prints the ids as KEY=value.
autolabels_node_seed() {
  local P=$1 D=$2 SB=$3 k
  local -a vars=()
  for k in tenant other_tenant store rooftop mapper open_episode open_listing open_file delivered_episode; do
    local env="AL_SEED_${k^^}" v
    v="${!env:-}"
    if [ -z "$v" ]; then
      if [ "$k" = rooftop ]; then v="rf-stg-01"; else v="$(cat /proc/sys/kernel/random/uuid)"; fi
    fi
    vars+=(-v "$k=$v")
    echo "AL_SEED_${k^^}=$v"
  done
  _al_psql $P $D -v ON_ERROR_STOP=1 "${vars[@]}" -f "$SB/tests/rtgip/autolabels_node_seed.sql" >/dev/null || return 1
}
