#!/usr/bin/env bash
# Before and after, on the same synthetic pages:
#   before  the crawler's extraction, fee breakdown, rendered-page check and
#           above-feed guard as they were at CRAWL_PREFIX_REV (default 3836dc3,
#           the last commit before the fix), cut out of that revision's
#           index.ts by their declarations and run unmodified (checks.ts);
#   after   the same cases through the current shared modules (after.ts).
# No network.
#
#   DENO=/path/deno scripts/crawl-verify/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DENO=${DENO:-deno}
REV=${CRAWL_PREFIX_REV:-3836dc3}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SRC=$WORK/index.prefix.ts
git show "$REV:supabase/functions/crawl-advertised-prices/index.ts" > "$SRC"
for f in priceGuard crawlUrlPolicy; do git show "$REV:supabase/functions/_shared/$f.ts" > "$WORK/$f.ts"; done
cut_block() { awk -v start="$1" -v stop="$2" 'index($0, start) == 1 { on = 1 } on { print } on && index($0, stop) == 1 { exit }' "$SRC"; }
{
  cut_block 'const VIN_RE = ' 'const sane = '
  cut_block 'const DESCRIPTION_BLOCK_RE = ' '  html.replace(DESCRIPTION_BLOCK_RE'
  cut_block 'const priceEvidenceHtml = ' 'const priceEvidenceHtml = '
  cut_block 'const DEFAULT_PRICE_LABELS = ' 'const cleanWebsitePriceTerm = '
  echo 'export { extractAdvertised, extractPriceComponents, buildBreakdown, priceEvidenceHtml };'
} | grep -v '^const cleanWebsitePriceTerm = ' > "$WORK/extract.ts"
cp scripts/crawl-verify/checks.ts "$WORK/"
echo "== Before: $REV:supabase/functions/crawl-advertised-prices/index.ts $(git rev-parse "$REV:supabase/functions/crawl-advertised-prices/index.ts"), $(wc -l < "$WORK/extract.ts") lines cut"
"$DENO" run --quiet "$WORK/checks.ts"
echo
echo "== After: working tree supabase/functions/_shared (vdpIdentity, vdpPrice, feeBasis, priceGuard)"
"$DENO" run --quiet scripts/crawl-verify/after.ts
