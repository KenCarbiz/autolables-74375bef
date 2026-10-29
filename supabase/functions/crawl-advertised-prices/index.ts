// crawl-advertised-prices: PAUSE BUILD (2026-10-29, owner-authorized).
//
// The advertised-price crawl is temporarily paused for pricing verification.
// Every request, from the nightly cron, the Inventory price scrape, the
// single-vehicle re-scrape, the admin test button or a direct call, is
// answered here with 503 and the pause message. Nothing is read, rendered,
// written or charged.
//
// This build replaces the pre-fix crawler (deployed from a5ddf4b) and is not
// the corrected crawler. It is lifted by deploying the corrected crawler,
// whose own execution control defaults to paused, on a separate approval.
// Redeploying a5ddf4b would restore the defective crawler and is not a
// rollback.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const CRAWL_PAUSED_MESSAGE = "Temporarily paused for pricing verification";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({ ok: false, paused: true, error: "crawl_paused", message: CRAWL_PAUSED_MESSAGE }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "86400" } },
  );
});
