import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// crawl-advertised-prices  ·  Wave 24
//
// Scheduled edge function. For every VIN with an existing
// advertised_prices snapshot that carries a source_url, re-fetch
// the URL and try to extract the current price. If the extracted
// price differs from the latest stored snapshot by more than $1,
// insert a new snapshot row. The Wave 14.6 realtime publication
// is already turned on for advertised_prices so any open client
// updates within ~1s.
//
// Best-effort: extraction is heuristic (schema.org JSON-LD →
// regex fallback for $X,XXX patterns). A failed crawl writes
// nothing — the dealer still sees the prior snapshot. Errors
// land on the audit_log via action='advertised_price_crawl_error'
// so an admin can debug a dealer's specific source URL without
// blocking the rest of the batch.
//
// Contract:
//   POST /functions/v1/crawl-advertised-prices
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body: { limit?: number; tenant_id?: string }
//     · limit       — max URLs to crawl this invocation (default 200)
//     · tenant_id   — restrict to one tenant; default = all tenants
//   Returns: {
//     ok: true,
//     picked: number,    // URLs we attempted to crawl
//     updated: number,   // snapshots inserted because price changed
//     unchanged: number, // crawl succeeded but price matched latest
//     failed: number,    // crawl errored (network, no price found)
//   }
//
// Auth: service-role only. Cron job stores the key in Supabase
// Vault per the Wave 11.2 pattern.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LatestRow {
  id: string;
  tenant_id: string;
  store_id: string | null;
  vin: string;
  source_url: string;
  source_label: string;
  advertised_price: number;
  snapshot_at: string;
}

const PRICE_REGEX = /\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d{2})?/g;

// SSRF guard — reject private/loopback/link-local/cloud-metadata hosts.
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, /^0\./, /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/, /^fe80:/i, /^fc[0-9a-f]{2}:/i, /^fd[0-9a-f]{2}:/i,
  /metadata\.google\.internal$/i,
  /metadata\.azure\.com$/i,
];
const isUrlSafe = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname;
    if (!host) return false;
    return !BLOCKED_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
};

// Try every reasonable signal a dealer page might emit for a
// price. Falls through to the regex if nothing structured wins.
const extractPrice = (html: string): number | null => {
  // 1. JSON-LD <script type="application/ld+json"> blocks. Common
  //    on modern dealer CMS templates (DealerInspire, DealerOn,
  //    DealerOn-on-WP, etc.).
  const ldMatches = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    const inner = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try {
      const parsed = JSON.parse(inner);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of candidates) {
        // schema.org Product → offers.price
        const offers = node?.offers;
        if (offers) {
          const list = Array.isArray(offers) ? offers : [offers];
          for (const o of list) {
            const p = typeof o?.price === "number" ? o.price : parseFloat(String(o?.price || ""));
            if (Number.isFinite(p) && p > 1000) return p;
          }
        }
        // Sometimes price lives top-level
        if (typeof node?.price === "number" && node.price > 1000) return node.price;
      }
    } catch {
      // Malformed JSON-LD — move on.
    }
  }

  // 2. og:price:amount / product:price:amount meta tags.
  const metaMatch = html.match(/<meta[^>]+(?:og:price:amount|product:price:amount)[^>]+content=["']([^"']+)["']/i);
  if (metaMatch) {
    const p = parseFloat(metaMatch[1]);
    if (Number.isFinite(p) && p > 1000) return p;
  }

  // 3. Brutal regex fallback: pick the LARGEST $X,XXX number in
  //    the body — dealer pages usually display the price more
  //    prominently than any incidental currency mention.
  const found: number[] = [];
  let m: RegExpExecArray | null;
  PRICE_REGEX.lastIndex = 0;
  while ((m = PRICE_REGEX.exec(html))) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 1000 && n < 1_000_000) found.push(n);
  }
  if (found.length > 0) {
    // Largest = the sticker / vehicle price (vs. trim accessory
    // numbers that are typically lower).
    return Math.max(...found);
  }

  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth gate ────────────────────────────────────────────────
  // Service-role only. Cron jobs supply the service key in the
  // Authorization header; no other caller should reach this.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== serviceKey) {
    return new Response(JSON.stringify({ error: "service-role required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { limit?: number; tenant_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const limit = Math.max(1, Math.min(body.limit ?? 200, 1000));

  // Pull the latest snapshot per (tenant, VIN). Only consider
  // rows that have a real source_url to fetch.
  let query = admin
    .from("latest_advertised_prices")
    .select("id, tenant_id, store_id, vin, source_url, source_label, advertised_price, snapshot_at")
    .neq("source_url", "")
    .limit(limit);
  if (body.tenant_id) query = query.eq("tenant_id", body.tenant_id);

  const { data: latest, error: listErr } = await query;
  if (listErr) {
    return new Response(JSON.stringify({ error: listErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (latest || []) as LatestRow[];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!isUrlSafe(row.source_url)) {
        failed++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, reason: "url_blocked_ssrf_guard" },
        }).then(() => undefined, () => undefined);
        continue;
      }
      const res = await fetch(row.source_url, {
        method: "GET",
        headers: {
          "User-Agent": "AutoLabels-PriceCrawler/1.0 (+https://autolabels.io)",
          "Accept": "text/html",
        },
        // Short timeout — dealer pages should respond fast, and
        // we'd rather move on than block the batch.
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        failed++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, http_status: res.status },
        }).then(() => undefined, () => undefined);
        continue;
      }
      const html = await res.text();
      const newPrice = extractPrice(html);
      if (newPrice == null) {
        failed++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, reason: "no_price_extracted" },
        }).then(() => undefined, () => undefined);
        continue;
      }
      if (Math.abs(newPrice - row.advertised_price) < 1) {
        unchanged++;
        continue;
      }
      const { error: insErr } = await admin.from("advertised_prices").insert({
        tenant_id: row.tenant_id,
        store_id: row.store_id || "",
        vin: row.vin,
        source_url: row.source_url,
        source_label: row.source_label,
        advertised_price: newPrice,
        captured_by: "crawler",
        notes: `Nightly crawl · previous $${row.advertised_price.toLocaleString()} → $${newPrice.toLocaleString()}`,
      });
      if (insErr) {
        failed++;
        continue;
      }
      updated++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("audit_log").insert({
        action: "advertised_price_crawl_error",
        entity_type: "advertised_price",
        entity_id: row.vin,
        store_id: row.tenant_id,
        details: { vin: row.vin, url: row.source_url, error: msg },
      }).then(() => undefined, () => undefined);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    picked: rows.length,
    updated,
    unchanged,
    failed,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
