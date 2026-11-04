#!/usr/bin/env bash
# AutoLabels hosted package: ordered apply plan. Applies nothing by itself; every write needs an explicit
# per-file approval. One psql --single-transaction -v ON_ERROR_STOP=1 command per component.
#   AL_CONN       libpq connection string of the target database (required), run as the owner role (postgres)
#   PSQL          psql binary (default: psql)
#   AL_BACKUP_RECORD  path to the operator's backup record (see gate)
#   AL_APPROVED_<STEP>  the sha256 of the exact file approved for that step (S1 S2 S3 D R E)
# Usage:
#   apply-plan.sh list
#   apply-plan.sh gate
#   apply-plan.sh step <STEP> pre|apply|post|disable|run
#   apply-plan.sh verify
# Order: S1 spine, S2 store registry (independent), S3 vehicle history, D delivery (frozen, shared), R readers, E effects.
# Prerequisites between steps: S3 needs S1; R needs S1 and S3; E needs D and R. S2 and D need neither.
# Exit codes: 0 ok, 10 component already installed (skip), 1 refused or failed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SB="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:-psql}"
ORDER=(S1 S2 S3 D R E)
declare -A FILE=(
  [S1]="$SB/proposed/20261030000000_rooftopos_spine.sql"
  [S2]="$SB/proposed/20261108000000_canonical_store_registry.sql"
  [S3]="$SB/proposed/20261109000000_vehicle_history_foundation.sql"
  [D]="$SB/proposed/rtgip_v2_delivery.proposed.sql"
  [R]="$SB/proposed/rtgip_source_readers.proposed.sql"
  [E]="$SB/proposed/rtgip_labels_effects.proposed.sql"
)
q() { "$PSQL" "${AL_CONN:?set AL_CONN}" -v ON_ERROR_STOP=1 -qAtX "$@"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
checks() { # file -> prints rows, fails on any |f row
  local out; out="$(q -f "$1")"
  printf '%s\n' "$out"
  ! printf '%s\n' "$out" | grep -q '|f$'
}
cmd="${1:-list}"
case "$cmd" in
  list)
    for s in "${ORDER[@]}"; do printf '%s  %s  psql --single-transaction -v ON_ERROR_STOP=1 -f %s\n' "$s" "$(sha "${FILE[$s]}")" "${FILE[$s]#"$SB"/}"; done ;;
  gate)
    rec="${AL_BACKUP_RECORD:?set AL_BACKUP_RECORD to the operator backup record}"
    [ -s "$rec" ] || { echo "REFUSED: backup record $rec is missing or empty"; exit 1; }
    for k in pitr_or_snapshot_id taken_at restore_rehearsed operator; do
      grep -Eq "^$k=.+" "$rec" || { echo "REFUSED: backup record lacks $k="; exit 1; }
    done
    grep -Eq '^restore_rehearsed=(yes|true)$' "$rec" || { echo "REFUSED: restore has not been rehearsed"; exit 1; }
    echo "gate ok: $(grep '^pitr_or_snapshot_id=' "$rec")" ;;
  verify) checks "$HERE/verify-security.sql" ;;
  step)
    s="${2:?step}"; act="${3:?pre|apply|post|disable|run}"; [ -n "${FILE[$s]:-}" ] || { echo "unknown step $s"; exit 1; }
    pre() {
      local out state; out="$(q -f "$HERE/checks/${s}_pre.sql")"; printf '%s\n' "$out"
      if printf '%s\n' "$out" | grep -q '|f$'; then echo "REFUSED $s: a prerequisite is missing"; return 1; fi
      state="$(printf '%s\n' "$out" | sed -n 's/^component_state|//p')"
      case "$state" in
        missing) return 0 ;;
        installed) echo "SKIP $s: already installed"; return 10 ;;
        *) echo "REFUSED $s: component is $state; stop and inspect"; return 1 ;;
      esac
    }
    apply() {
      local want="AL_APPROVED_$s" f="${FILE[$s]}"
      [ "${!want:-}" = "$(sha "$f")" ] || { echo "REFUSED $s: set $want to $(sha "$f") to approve exactly this file"; return 1; }
      "$PSQL" "${AL_CONN:?set AL_CONN}" --single-transaction -v ON_ERROR_STOP=1 -qAtX -f "$f" >/dev/null
    }
    post() { checks "$HERE/checks/${s}_post.sql"; }
    case "$act" in
      pre) pre ;;
      apply) apply ;;
      post) post ;;
      disable) q --single-transaction -f "$HERE/disable/${s}_disable.sql" >/dev/null ;;
      run) rc=0; pre || rc=$?; [ "$rc" = 10 ] && exit 10; [ "$rc" = 0 ] || exit 1; apply; post ;;
      *) echo "unknown action $act"; exit 1 ;;
    esac ;;
  *) echo "usage: $0 list|gate|verify|step <STEP> pre|apply|post|disable|run"; exit 1 ;;
esac
