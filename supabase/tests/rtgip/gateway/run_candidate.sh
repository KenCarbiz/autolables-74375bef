#!/usr/bin/env bash
# Rebuilds the vendored Gateway candidate (PROVENANCE.json) from empty on a throwaway local
# PostgreSQL and runs its own suites plus the acceptance checks in acceptance/.
# Socket-only, synthetic data, ephemeral keys. Never reads PG* and never touches a hosted database.
#
# The vendored scripts hardcode /tmp/gateway-final, superuser "lovable" and an unprivileged uid 1000,
# so this needs root and that uid. The cluster there is destroyed and rebuilt on every run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
BASE=/tmp/gateway-final
[ "$(id -u)" = 0 ] || { echo "run as root (the vendored bootstrap drops to uid 1000)"; exit 2; }
getent passwd 1000 >/dev/null || { echo "uid 1000 is required by the vendored bootstrap"; exit 2; }
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL binaries not found; set PGBIN"; exit 2; }
for c in bun python3 psql setpriv; do command -v "$c" >/dev/null || { echo "missing $c"; exit 2; }; done

WS="$(mktemp -d /tmp/gw-candidate-ws.XXXXXX)"
SHIM="$(mktemp -d /tmp/gw-candidate-bin.XXXXXX)"
cleanup() {
  [ -f "$BASE/data/PG_VERSION" ] && setpriv --reuid=1000 --regid=1000 --clear-groups "$PGBIN/pg_ctl" -D "$BASE/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$WS" "$SHIM"
}
trap cleanup EXIT

# Lay the vendored files back out at their upstream paths so every import and script path is unchanged.
python3 - "$REPO" "$WS" <<'PY'
import hashlib, json, os, shutil, sys
repo, ws = sys.argv[1], sys.argv[2]
prov = json.load(open(os.path.join(repo, "supabase/tests/rtgip/gateway/PROVENANCE.json")))
want = {f["vendored"]: f["sha256"] for f in prov["files"]}
for a in prov["amendments"]:
    for f in a["files"]:
        want[f["vendored"]] = f["sha256_after"]
for f in prov["files"]:
    src = os.path.join(repo, f["vendored"])
    if hashlib.sha256(open(src, "rb").read()).hexdigest() != want[f["vendored"]]:
        raise SystemExit("provenance mismatch: " + f["vendored"])
    dst = os.path.join(ws, f["source"])
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
print(f"workspace: {len(prov['files'])} files at {prov['commit'][:7]} + {len(prov['amendments'])} amendments")
PY
mkdir -p "$WS/scripts/acceptance" "$WS/docs/releases/evidence/final-execution"
cp "$HERE"/acceptance/*.ts "$WS/scripts/acceptance/"
ln -s "$REPO/node_modules" "$WS/node_modules"
git -C "$WS" init -q && git -C "$WS" add -A && git -C "$WS" -c user.name=disposable -c user.email=disposable@localhost commit -qm workspace
chmod -R o+rX "$WS"

printf '#!/bin/sh\nexec "%s/initdb" -U lovable "$@"\n' "$PGBIN" > "$SHIM/initdb"
chmod +x "$SHIM/initdb"
ln -s "$PGBIN/pg_ctl" "$SHIM/pg_ctl"
chmod -R o+rX "$SHIM"

if [ -f "$BASE/data/PG_VERSION" ]; then
  setpriv --reuid=1000 --regid=1000 --clear-groups "$PGBIN/pg_ctl" -D "$BASE/data" -m fast stop >/dev/null 2>&1 || true
fi
rm -rf "$BASE"

cd "$WS"
export AL_REPO="$REPO"
echo "== from-empty bootstrap: migrations 0000-0042, fixtures, rtgip2.sql, reconciliation-v3.sql"
PATH="$SHIM:$PATH" python3 scripts/bootstrap-gateway-disposable.py >"$WS/bootstrap.log" 2>&1 || { tail -20 "$WS/bootstrap.log"; exit 1; }
tail -1 "$WS/bootstrap.log"

PSQL=(psql -X -q -h "$BASE/socket" -U lovable -v ON_ERROR_STOP=1)
fresh() { "${PSQL[@]}" -d postgres -c "CREATE DATABASE $1 TEMPLATE gateway_template" ; }

echo "== candidate SQL suites"
python3 scripts/test-gateway-disposable.py >"$WS/sql.log" 2>&1 || { cat "$WS/sql.log"; exit 1; }
python3 -c "import json;r=json.load(open('$BASE/sql-results.json'));print(f'{sum(x[\"pass\"] for x in r)}/{len(r)} suites, {sum(x[\"assertions\"] for x in r)} assertions')"

echo "== candidate disposable checks"
fresh gw_candidate_base
bun scripts/test-rtgip2-disposable.ts gw_candidate_base

status=0
for t in scripts/acceptance/*.check.ts; do
  name="$(basename "$t" .check.ts | tr -c 'a-z0-9\n' '_')"
  echo "== acceptance: $(basename "$t")"
  fresh "gw_candidate_$name"
  bun "$t" "gw_candidate_$name" || status=1
done
exit $status
