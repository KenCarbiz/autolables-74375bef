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

// ── Bot-challenge detection ───────────────────────────────────────
// A Cloudflare/Imperva/DataDome interstitial returns HTTP 200 with a
// "checking your browser" body. Parsing it as a real page could silently
// overwrite a correct advertised price with garbage, so detect and skip.
const looksLikeChallenge = (html: string, headers: Headers, status: number): boolean => {
  if (status === 403 || status === 503 || status === 429) return true;
  if ((headers.get("cf-mitigated") || "").includes("challenge")) return true;
  const h = html.toLowerCase();
  const markers = [
    "cdn-cgi/challenge-platform", "__cf_chl", "cf_chl_opt", "turnstile",
    "just a moment", "attention required! | cloudflare",
    "_incapsula_resource", "request unsuccessful. incapsula incident id",
    "pardon our interruption", "captcha-delivery.com",
    "please verify you are a human", "checking your browser",
  ];
  if (markers.some((m) => h.includes(m))) return true;
  if (html.length < 20000 && !h.includes("application/ld+json") && !h.includes("vehicleidentificationnumber")) {
    if (h.includes("enable javascript") || h.includes("ddos") || h.includes("are a human")) return true;
  }
  return false;
};

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/g;
const normVin = (s: unknown) => String(s || "").toUpperCase().trim();
const collectVins = (html: string, url: string): Set<string> => {
  const vins = new Set<string>();
  let m: RegExpExecArray | null;
  VIN_RE.lastIndex = 0;
  while ((m = VIN_RE.exec(`${html}\n${url}`))) vins.add(m[1].toUpperCase());
  return vins;
};

const norm = (raw: unknown): number | null => {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/[,$\s ]/g, "").replace(/usd/i, ""));
  return Number.isFinite(n) ? n : null;
};
const sane = (n: number | null): n is number => n != null && n >= 1000 && n <= 500000;

const REJECT_PRICE_TYPES = ["msrp", "listprice", "invoiceprice", "strikethroughprice", "regularprice"];
// deno-lint-ignore no-explicit-any
const priceTypeOf = (o: any): string =>
  String(o?.priceType || o?.priceSpecification?.priceType || "")
    .toLowerCase().replace(/.*\//, "").replace(/[^a-z]/g, "");

interface AdResult {
  price: number | null;
  source: "jsonld" | "og_meta" | "dom_label" | "none";
  gated: boolean;
  reason: string | null;
}

// Structured, VIN-gated, priceType-aware price extractor. Replaces the old
// "largest dollar on the page" heuristic, which grabbed the MSRP off a price
// stack and produced false "ad != sticker" drift on every discounted car.
// For Call-for-Price pages it records nothing rather than guess the MSRP.
const extractAdvertised = (html: string, url: string, targetVin: string): AdResult => {
  const target = normVin(targetVin);
  const pageVins = collectVins(html, url);
  if (target && pageVins.size > 0 && !pageVins.has(target)) {
    return { price: null, source: "none", gated: false, reason: "vin_mismatch" };
  }

  // Tier A: schema.org JSON-LD — VIN-gated, priceType-aware.
  const ldMatches = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    const inner = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try { parsed = JSON.parse(inner); } catch { continue; }
    // deno-lint-ignore no-explicit-any
    const nodes: any[] = [];
    // deno-lint-ignore no-explicit-any
    const push = (x: any) => { if (x && typeof x === "object") nodes.push(x); };
    // deno-lint-ignore no-explicit-any
    (Array.isArray(parsed) ? parsed : [parsed]).forEach((p: any) => {
      push(p);
      if (Array.isArray(p?.["@graph"])) p["@graph"].forEach(push);
    });
    for (const node of nodes) {
      const nodeVin = normVin(node?.vehicleIdentificationNumber);
      if (target && nodeVin && nodeVin !== target) continue;
      const offers = node?.offers;
      if (!offers) continue;
      const list = Array.isArray(offers) ? offers : [offers];
      for (const o of list) {
        const cur = String(o?.priceCurrency || "USD").toUpperCase();
        if (cur && cur !== "USD") continue;
        if (o?.["@type"] === "AggregateOffer" || o?.lowPrice != null) {
          const lp = norm(o?.lowPrice);
          if (sane(lp)) return { price: lp, source: "jsonld", gated: false, reason: null };
          continue;
        }
        if (REJECT_PRICE_TYPES.includes(priceTypeOf(o))) continue;
        const p = norm(o?.price);
        if (sane(p)) return { price: p, source: "jsonld", gated: false, reason: null };
      }
    }
  }

  // Tier B: og:price / product:price meta (USD only).
  const curMeta = html.match(/<meta[^>]+(?:og:price:currency|product:price:currency)[^>]+content=["']([^"']+)["']/i);
  if (!curMeta || curMeta[1].toUpperCase() === "USD") {
    const meta = html.match(/<meta[^>]+(?:og:price:amount|product:price:amount)[^>]+content=["']([^"']+)["']/i);
    const v = meta ? norm(meta[1]) : null;
    if (sane(v)) return { price: v, source: "og_meta", gated: false, reason: null };
  }

  // Tier C: labeled DOM price — the price-stack final line, by LABEL not size.
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const GATE = ["call for price", "please call", "contact us for price", "unlock price", "click for price", "sign in to see price"];
  const MONTHLY = ["/mo", "per month", "mo.", "lease", " apr", "due at signing", "est. payment", "for 24", "for 36", "for 48", "for 60", "for 72", "for 84"];
  const GOOD = ["internet price", "sale price", "final price", "your price", "e-price", "eprice", "selling price", "special price"];
  const BAD = ["msrp", "retail", " was ", "original", "list price", "sticker", "as built"];
  const moneyRe = /([a-z .,'-]{0,40})\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d{2})?/g;
  let best: number | null = null;
  let bestScore = -1;
  let mm: RegExpExecArray | null;
  moneyRe.lastIndex = 0;
  while ((mm = moneyRe.exec(text))) {
    const ctx = mm[1];
    const val = norm(mm[2]);
    if (!sane(val)) continue;
    if (BAD.some((b) => ctx.includes(b))) continue;
    if (MONTHLY.some((b) => ctx.includes(b))) continue;
    const idx = GOOD.findIndex((g) => ctx.includes(g));
    const s = idx === -1 ? 0 : 10 - idx;
    if (s > bestScore || (s === bestScore && best != null && val < best)) { best = val; bestScore = s; }
  }
  if (best != null) return { price: best, source: "dom_label", gated: false, reason: null };

  // Tier D: gate / give up — never guess MSRP.
  if (GATE.some((g) => text.includes(g))) return { price: null, source: "none", gated: true, reason: "price_gated" };
  return { price: null, source: "none", gated: false, reason: "no_price_extracted" };
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

  // Pull rows with a real source_url, newest first, and dedupe to the
  // latest per (tenant, VIN). Reads the real table with column aliases —
  // the live schema uses source_channel/captured_at, and there is no
  // latest_advertised_prices view.
  let query = admin
    .from("advertised_prices")
    .select("id, tenant_id, store_id, vin, source_url, source_label:source_channel, advertised_price, snapshot_at:captured_at")
    .neq("source_url", "")
    .order("captured_at", { ascending: false })
    .limit(2000);
  if (body.tenant_id) query = query.eq("tenant_id", body.tenant_id);

  const { data: all, error: listErr } = await query;
  if (listErr) {
    return new Response(JSON.stringify({ error: listErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const seen = new Set<string>();
  const rows: LatestRow[] = [];
  for (const r of (all || []) as LatestRow[]) {
    const k = r.tenant_id + "|" + (r.vin || "").toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
    if (rows.length >= limit) break;
  }
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;

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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(12000),
      });
      const html = res.ok ? await res.text() : "";
      // Bot-challenge guard: a 403/503 OR a 200 interstitial. Skip without
      // writing — never overwrite a good price with a challenge page.
      if (!res.ok || looksLikeChallenge(html, res.headers, res.status)) {
        skipped++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, http_status: res.status, reason: "bot_challenge" },
        }).then(() => undefined, () => undefined);
        continue;
      }
      const result = extractAdvertised(html, row.source_url, row.vin);
      // vin_mismatch (redirect / wrong car) or price_gated ("call for price"):
      // record the reason but DO NOT write — preserve the prior good snapshot.
      if (result.reason === "vin_mismatch" || result.gated) {
        skipped++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, reason: result.reason },
        }).then(() => undefined, () => undefined);
        continue;
      }
      const newPrice = result.price;
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
        source_channel: row.source_label,
        advertised_price: newPrice,
        captured_by: "crawler",
        notes: `Nightly crawl (${result.source}) · previous $${row.advertised_price.toLocaleString()} → $${newPrice.toLocaleString()}`,
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
    skipped,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
