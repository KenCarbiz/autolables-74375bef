#!/usr/bin/env bash
# Runs the advertised-price crawler's own extraction, fee breakdown, rendered-
# page check and above-feed guard against synthetic pages. The crawler's
# extraction code is not exported, so the blocks under test are cut out of
# supabase/functions/crawl-advertised-prices/index.ts by their declarations
# and run unmodified; the shared modules are imported as they are. No network.
#
#   DENO=/path/deno scripts/crawl-verify/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DENO=${DENO:-deno}
SRC=supabase/functions/crawl-advertised-prices/index.ts
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cut_block() { awk -v start="$1" -v stop="$2" 'index($0, start) == 1 { on = 1 } on { print } on && index($0, stop) == 1 { exit }' "$SRC"; }
{
  cut_block 'const VIN_RE = ' 'const sane = '
  cut_block 'const DESCRIPTION_BLOCK_RE = ' '  html.replace(DESCRIPTION_BLOCK_RE'
  cut_block 'const priceEvidenceHtml = ' 'const priceEvidenceHtml = '
  cut_block 'const DEFAULT_PRICE_LABELS = ' 'const cleanWebsitePriceTerm = '
  echo 'export { extractAdvertised, extractPriceComponents, buildBreakdown, priceEvidenceHtml };'
} | grep -v '^const cleanWebsitePriceTerm = ' > "$WORK/extract.ts"
cp supabase/functions/_shared/priceGuard.ts supabase/functions/_shared/crawlUrlPolicy.ts "$WORK/"
cp scripts/crawl-verify/checks.ts "$WORK/"
echo "== Code under test: $SRC $(git hash-object "$SRC"), $(wc -l < "$WORK/extract.ts") lines cut"
"$DENO" run --quiet "$WORK/checks.ts"
