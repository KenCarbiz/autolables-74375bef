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
  snapshot_at: string | null;
  // A seed row has no prior snapshot (advertised_price 0): it comes from a
  // synced vehicle_listing whose VDP url we crawl to capture a FIRST price.
  seed?: boolean;
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

// Pull the dealer's hero photo (og:image / twitter:image) off the VDP so the
// inventory thumbnail and vehicle-file hero show the real car. Handles both
// meta attribute orders and resolves a relative URL against the page.
const extractHeroImage = (html: string, baseUrl: string): string | null => {
  const m =
    html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i);
  let url = (m?.[1] || "").trim();
  if (!url) return null;
  try { url = new URL(url, baseUrl).toString(); } catch { /* keep as-is */ }
  return /^https?:\/\//i.test(url) ? url : null;
};

// Dealer-paid vehicle history report links (CARFAX Report.cfx / cfx.link
// shorts / AutoCheck FastLink) embedded on the dealer's own VDP. Only a link
// whose vin param matches the crawled row's VIN is trusted — group sites
// render sibling-store widgets with other stores' codes. cfx.link shorts are
// opaque (no vin param) so they're accepted as-is; they were served on this
// exact VDP.
const CARFAX_REPORT_RE = /https?:\/\/(?:www\.)?carfax\.com\/VehicleHistory\/p\/Report\.cfx\?[^"'<>\s\\)]+/gi;
// Modern tokenized dealer links (e.g. carfax.com/vehiclehistory/ar20/<token>,
// as served on Harte INFINITI VDPs) — opaque per-VIN tokens with no query
// params, so like cfx.link they're trusted as served on that exact VDP.
const CARFAX_TOKEN_RE = /https?:\/\/(?:www\.)?carfax\.com\/vehiclehistory\/[A-Za-z0-9]{2,10}\/[A-Za-z0-9_-]{20,}/gi;
const CFX_LINK_RE = /https?:\/\/(?:www\.)?cfx\.link\/[A-Za-z0-9_-]{4,}/gi;
const AUTOCHECK_RE = /https?:\/\/(?:www\.)?autocheck\.com\/[^"'<>\s\\)]*vin=[A-Za-z0-9]{11,17}[^"'<>\s\\)]*/gi;

const extractHistoryReportLink = (html: string, targetVin: string): string | null => {
  const t = normVin(targetVin);
  const decode = (raw: string) => raw.replace(/&amp;/gi, "&").replace(/\\u0026/g, "&");
  const vinParamMatches = (raw: string): boolean => {
    try {
      const u = new URL(decode(raw));
      let vin = "";
      u.searchParams.forEach((v, k) => { if (k.toLowerCase() === "vin") vin = normVin(v); });
      return vin === t;
    } catch { return false; }
  };
  let m: RegExpExecArray | null;
  CARFAX_REPORT_RE.lastIndex = 0;
  while ((m = CARFAX_REPORT_RE.exec(html))) if (vinParamMatches(m[0])) return decode(m[0]);
  AUTOCHECK_RE.lastIndex = 0;
  while ((m = AUTOCHECK_RE.exec(html))) if (vinParamMatches(m[0])) return decode(m[0]);
  CARFAX_TOKEN_RE.lastIndex = 0;
  const token = CARFAX_TOKEN_RE.exec(html)?.[0];
  if (token) return token;
  CFX_LINK_RE.lastIndex = 0;
  return CFX_LINK_RE.exec(html)?.[0] ?? null;
};

// One-owner badge on the dealer's own VDP. Provider context (CARFAX/
// AutoCheck within range, or badge image alt/title) is REQUIRED so loose
// marketing copy can't set the flag; absence of the badge means nothing —
// this signal is positive-only and never marks a car multi-owner.
const ONE_OWNER_RE = new RegExp(
  [
    String.raw`\b(?:carfax|autocheck)\b[\s\S]{0,160}?\b(?:1|one)[\s-]?owner\b`,
    String.raw`\b(?:1|one)[\s-]?owner\b[\s\S]{0,160}?\b(?:carfax|autocheck)\b`,
    String.raw`(?:alt|title)=["'][^"']{0,80}(?:1|one)[\s-]?owner`,
  ].join("|"),
  "i",
);
const detectOneOwnerBadge = (html: string): boolean => ONE_OWNER_RE.test(html);

// Generic selling-price labels appended after each dealer's configured labels.
// These are advertised-price brands (never MSRP/retail), so running them in the
// custom-label tier is safe and lets common sites resolve without per-dealer
// setup. Dealer-specific brands (e.g. "Harte Deal") still come from config.
const DEFAULT_PRICE_LABELS = [
  "Your Price", "Sale Price", "Selling Price", "Internet Price",
  "Special Price", "E-Price", "ePrice", "Deal Price", "Our Price",
];

const REJECT_PRICE_TYPES = ["msrp", "listprice", "invoiceprice", "strikethroughprice", "regularprice"];
const MSRP_PRICE_TYPES = ["msrp", "listprice", "regularprice", "strikethroughprice"];
// deno-lint-ignore no-explicit-any
const priceTypeOf = (o: any): string =>
  String(o?.priceType || o?.priceSpecification?.priceType || "")
    .toLowerCase().replace(/.*\//, "").replace(/[^a-z]/g, "");

interface PriceCandidate { value: number; label: string; source: string; }
interface AdResult {
  price: number | null;
  source: "jsonld" | "og_meta" | "dom_label" | "none";
  gated: boolean;
  reason: string | null;
  msrp: number | null;
  candidates: PriceCandidate[];
}

// Normalize a dealer VDP URL before fetching: strip view-mode params that
// flip the page to incentive-conditional pricing (?type=finance / ?type=lease
// / ?paymentType=... etc.) so we always read the standard advertised price.
// Harte Infiniti's canonical VDP is /viewdetails/{inventory-type}/{VIN} with
// NO query string — the bare URL renders the cash/retail total. Any ?type=
// variant flips to finance/lease pricing, so we strip all view params.
const VIEW_PARAMS = new Set([
  "type", "viewtype", "view", "paymenttype", "payment", "pricingmode", "pricetype",
  "tab", "mode", "incentive", "incentives", "lease", "finance",
]);
const normalizeVdpUrl = (raw: string): string => {
  try {
    const u = new URL(raw);
    const drop: string[] = [];
    u.searchParams.forEach((_v, k) => {
      if (VIEW_PARAMS.has(k.toLowerCase())) drop.push(k);
    });
    drop.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch { return raw; }
};


// Structured, VIN-gated, priceType-aware price extractor. Replaces the old
// "largest dollar on the page" heuristic, which grabbed the MSRP off a price
// stack and produced false "ad != sticker" drift on every discounted car.
// For Call-for-Price pages it records nothing rather than guess the MSRP.
//
// `customLabels` are dealer-configured price labels in priority order
// ("Harte Deal", "Internet Price", …). They run BEFORE the generic DOM
// heuristic and short-circuit on the first label that has a dollar amount
// adjacent — that's the dealer's brand for the advertised selling price.
const extractAdvertised = (
  html: string,
  url: string,
  targetVin: string,
  customLabels: string[] = [],
): AdResult & { matched_label?: string | null } => {
  const target = normVin(targetVin);
  const pageVins = collectVins(html, url);
  const candidates: PriceCandidate[] = [];
  let msrp: number | null = null;
  if (target && pageVins.size > 0 && !pageVins.has(target)) {
    return { price: null, source: "none", gated: false, reason: "vin_mismatch", msrp: null, candidates };
  }

  // Tier A: schema.org JSON-LD — VIN-gated, priceType-aware.
  const ldMatches = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  let jsonldPrice: number | null = null;
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
        const pt = priceTypeOf(o);
        if (o?.["@type"] === "AggregateOffer" || o?.lowPrice != null) {
          const lp = norm(o?.lowPrice);
          if (sane(lp)) { candidates.push({ value: lp, label: "AggregateOffer.lowPrice", source: "jsonld" }); if (jsonldPrice == null) jsonldPrice = lp; }
          const hp = norm(o?.highPrice);
          if (sane(hp) && msrp == null) msrp = hp;
          continue;
        }
        const p = norm(o?.price);
        if (MSRP_PRICE_TYPES.includes(pt)) {
          if (sane(p) && msrp == null) msrp = p;
          continue;
        }
        if (REJECT_PRICE_TYPES.includes(pt)) continue;
        if (sane(p)) {
          candidates.push({ value: p, label: `Offer.price${pt ? ` [${pt}]` : ""}`, source: "jsonld" });
          if (jsonldPrice == null) jsonldPrice = p;
        }
      }
    }
  }
  if (jsonldPrice != null) {
    if (msrp != null && jsonldPrice < msrp * 0.3) {
      return { price: null, source: "none", gated: false, reason: "implausible_vs_msrp", msrp, candidates };
    }
    return { price: jsonldPrice, source: "jsonld", gated: false, reason: null, msrp, candidates };
  }

  // Tier B: og:price / product:price meta (USD only).
  const curMeta = html.match(/<meta[^>]+(?:og:price:currency|product:price:currency)[^>]+content=["']([^"']+)["']/i);
  if (!curMeta || curMeta[1].toUpperCase() === "USD") {
    const meta = html.match(/<meta[^>]+(?:og:price:amount|product:price:amount)[^>]+content=["']([^"']+)["']/i);
    const v = meta ? norm(meta[1]) : null;
    if (sane(v)) {
      candidates.push({ value: v, label: "og:price:amount", source: "og_meta" });
      if (msrp != null && v < msrp * 0.3) {
        return { price: null, source: "none", gated: false, reason: "implausible_vs_msrp", msrp, candidates };
      }
      return { price: v, source: "og_meta", gated: false, reason: null, msrp, candidates };
    }
  }

  // Tier C0: dealer-configured custom labels (e.g. "Harte Deal"). First label
  // with a dollar amount within 80 chars wins — short-circuits BEFORE the
  // generic heuristic so a brand-specific label like "Harte Deal" can't lose
  // to "MSRP" or anything else on the page.
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const labels = (customLabels || [])
    .map((l) => l.trim().toLowerCase()).filter(Boolean);
  for (const lbl of labels) {
    // Escape regex metacharacters in the user-supplied label.
    const esc = lbl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}[^$]{0,80}\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d{4,6})(?:\\.\\d{2})?`, "i");
    const m = text.match(re);
    const v = m ? norm(m[1]) : null;
    if (sane(v)) {
      candidates.push({ value: v, label: `custom:${lbl}`, source: "dom_label" });
      if (msrp != null && v < msrp * 0.3) {
        return { price: null, source: "none", gated: false, reason: "implausible_vs_msrp", msrp, candidates, matched_label: lbl };
      }
      return { price: v, source: "dom_label", gated: false, reason: null, msrp, candidates, matched_label: lbl };
    }
  }

  // Tier C: labeled DOM price — the price-stack final line, by LABEL not size.
  const GATE = ["call for price", "please call", "contact us for price", "unlock price", "click for price", "sign in to see price"];
  const MONTHLY = ["/mo", "per month", "mo.", "lease", " apr", "due at signing", "est. payment", "for 24", "for 36", "for 48", "for 60", "for 72", "for 84"];
  const GOOD = ["internet price", "sale price", "final price", "your price", "e-price", "eprice", "selling price", "special price"];
  const BAD = ["msrp", "retail", " was ", "original", "list price", "sticker", "as built",
               "down payment", "down ", "savings", "save $", "you save", "off msrp", "rebate",
               "discount", "incentive", "trade-in", "cash back", " bonus", "due at", "deposit"];
  const moneyRe = /([a-z .,'-]{0,40})\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d{2})?/g;
  let best: number | null = null;
  let bestScore = -1;
  let bestLabel = "";
  let mm: RegExpExecArray | null;
  moneyRe.lastIndex = 0;
  while ((mm = moneyRe.exec(text))) {
    const ctx = mm[1];
    const val = norm(mm[2]);
    if (!sane(val)) continue;
    if (BAD.some((b) => ctx.includes(b))) {
      if (msrp == null && (ctx.includes("msrp") || ctx.includes("list price") || ctx.includes("sticker"))) msrp = val;
      continue;
    }
    if (MONTHLY.some((b) => ctx.includes(b))) continue;
    const idx = GOOD.findIndex((g) => ctx.includes(g));
    const s = idx === -1 ? 0 : 10 - idx;
    candidates.push({ value: val, label: ctx.trim() || "(unlabeled)", source: "dom_label" });
    if (s > bestScore || (s === bestScore && best != null && val < best)) {
      best = val; bestScore = s; bestLabel = ctx.trim();
    }
  }
  if (best != null) {
    if (msrp != null && best < msrp * 0.3) {
      return { price: null, source: "none", gated: false, reason: "implausible_vs_msrp", msrp, candidates };
    }
    // If we only matched an unlabeled price (score 0) without an MSRP anchor
    // to sanity-check against, that's not safe enough — flag for manual entry.
    if (bestScore === 0 && msrp == null) {
      return { price: null, source: "none", gated: false, reason: "unlabeled_price_only", msrp, candidates };
    }
    return { price: best, source: "dom_label", gated: false, reason: null, msrp, candidates, matched_label: bestLabel || null };
  }

  // Tier D: gate / give up — never guess MSRP.
  if (GATE.some((g) => text.includes(g))) return { price: null, source: "none", gated: true, reason: "price_gated", msrp, candidates };
  return { price: null, source: "none", gated: false, reason: "no_price_extracted", msrp, candidates };
};

// ── Price components: doc/conveyance fee, displayed sale price, retail cash,
// dealer discount ──────────────────────────────────────────────────────────
// Parsed SEPARATELY from the advertised price so we can store each field and
// validate the calculation (advertised + doc fee === displayed sale price).
// Fees/cash live in a different magnitude band than a car price, so they use
// their own sanity windows (a $895 fee would fail the $1k car-price floor).
const saneFee = (n: number | null): n is number => n != null && n >= 1 && n <= 10000;
const saneCash = (n: number | null): n is number => n != null && n >= 1 && n <= 60000;

// First dollar amount appearing within 0..60 chars AFTER a label match.
const valueForLabel = (text: string, labelSrc: string): number | null => {
  const re = new RegExp(`(?:${labelSrc})[^$]{0,60}\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d{1,6})(?:\\.\\d{2})?`, "i");
  const m = text.match(re);
  return m ? norm(m[1]) : null;
};

interface PriceComponents {
  docFee: number | null;
  salePrice: number | null;   // the dealer site's displayed final "Sale Price"
  retailCash: number | null;
  dealerDiscount: number | null;
}
const extractPriceComponents = (html: string): PriceComponents => {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const docRaw = valueForLabel(text, "conveyance fee|documentation fee|doc(?:ument)? fee|dealer doc(?:ument)?(?:ation)? fee|processing fee");
  const saleRaw = valueForLabel(text, "sale price|total price|price after savings|net price|final price");
  const cashRaw = valueForLabel(text, "retail cash|customer cash|consumer cash|bonus cash|cash allowance");
  const discRaw = valueForLabel(text, "dealer discount|total savings|you save|savings|discount");
  return {
    docFee: saneFee(docRaw) ? docRaw : null,
    salePrice: sane(saleRaw) ? saleRaw : null,
    retailCash: saneCash(cashRaw) ? cashRaw : null,
    dealerDiscount: saneCash(discRaw) ? discRaw : null,
  };
};

// Reconcile parsed components into the canonical breakdown. The advertised
// price is BEFORE the doc fee: if the extractor grabbed the displayed sale
// price (which already includes the fee), back the fee out so we never
// double-count it. website_sale_price = advertised_before_doc + doc_fee, added
// exactly once. Returns the fields written to vehicle_listings + a parse status.
interface PriceBreakdown {
  advertised_price_before_doc: number | null;
  doc_fee: number;
  website_sale_price: number | null;
  retail_cash: number | null;
  dealer_discount: number | null;
  price_parse_status: "ok" | "warning" | "pending";
  price_parse_notes: string;
}
const buildBreakdown = (extractedPrice: number | null, comp: PriceComponents, configuredDocFee: number): PriceBreakdown => {
  // The dealer's CONFIGURED doc fee (from admin) is authoritative for the
  // amount; the page's conveyance fee line is a parse CHECK against it. When
  // the dealer hasn't set a fee, fall back to whatever the page shows.
  const parsedFee = comp.docFee;
  const docFee = configuredDocFee > 0 ? configuredDocFee : (parsedFee ?? 0);
  let advertised = extractedPrice;
  // If the extractor picked the final sale price (== displayed sale), strip the
  // fee to recover the advertised-before-doc price.
  if (advertised != null && comp.salePrice != null && docFee > 0 && Math.abs(advertised - comp.salePrice) <= 1) {
    advertised = advertised - docFee;
  }
  if (advertised == null) {
    return { advertised_price_before_doc: null, doc_fee: docFee, website_sale_price: null, retail_cash: comp.retailCash, dealer_discount: comp.dealerDiscount, price_parse_status: "pending", price_parse_notes: "No advertised price parsed." };
  }
  const websiteSale = advertised + docFee;

  // Two reconcile checks: (1) page conveyance fee matches the configured doc
  // fee; (2) advertised + doc fee matches the page's displayed sale price.
  const issues: string[] = [];
  const verified: string[] = [];
  if (parsedFee != null && configuredDocFee > 0) {
    if (Math.abs(parsedFee - configuredDocFee) > 1) issues.push(`page conveyance fee ${parsedFee} != configured doc fee ${configuredDocFee}`);
    else verified.push(`doc fee ${docFee} matches the page`);
  }
  if (comp.salePrice != null) {
    if (Math.abs(comp.salePrice - websiteSale) > 1) issues.push(`displayed sale ${comp.salePrice} != advertised ${advertised} + doc fee ${docFee} = ${websiteSale}`);
    else verified.push(`sale price ${websiteSale} matches the page`);
  }
  const status: PriceBreakdown["price_parse_status"] = issues.length ? "warning" : "ok";
  const notes = issues.length
    ? `Price parse mismatch: ${issues.join("; ")}. Review source page.`
    : (verified.length ? `Verified: ${verified.join("; ")}.` : `Advertised ${advertised} + doc fee ${docFee} = sale ${websiteSale}.`);
  return { advertised_price_before_doc: advertised, doc_fee: docFee, website_sale_price: websiteSale, retail_cash: comp.retailCash, dealer_discount: comp.dealerDiscount, price_parse_status: status, price_parse_notes: notes };
};

// Browser-like UA shared by the seeded crawl and discovery fetches.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_HEADERS = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };

// ── Firecrawl rendering + screenshot ─────────────────────────────
// Plain fetch can't see prices on JS-walled dealer sites / marketplaces.
// When the cheap path fails, escalate to Firecrawl: it returns rendered HTML,
// a full-page screenshot (our FTC evidence image), and an LLM-extracted
// {price, vin} we accept only when the VIN matches.
const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY_1") || Deno.env.get("FIRECRAWL_API_KEY") || "";
const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

interface RenderResult {
  html: string;
  screenshotUrl: string | null;
  jsonPrice: number | null;
  jsonVin: string | null;
  ok: boolean;
  status: number | null;
  error: string | null;
}

async function firecrawlRender(url: string): Promise<RenderResult | null> {
  if (!FIRECRAWL_KEY) return null;
  try {
    const res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["html", { type: "screenshot", fullPage: true }, {
          type: "json",
          prompt: "Extract the vehicle's advertised selling/internet price in USD (not the MSRP) and its 17-character VIN.",
          schema: { type: "object", properties: { price: { type: "number" }, vin: { type: "string" }, currency: { type: "string" } } },
        }],
        onlyMainContent: false,
        waitFor: 10000,
        timeout: 90000,
      }),
      signal: AbortSignal.timeout(110000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { html: "", screenshotUrl: null, jsonPrice: null, jsonVin: null, ok: false, status: res.status, error: body.slice(0, 300) || res.statusText };
    }
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    const d = data?.data || data;
    return {
      html: d?.html || "",
      screenshotUrl: d?.screenshot || d?.screenshotUrl || d?.actions?.screenshots?.[0] || (d?.metadata?.screenshot) || null,
      jsonPrice: norm(d?.json?.price ?? null),
      jsonVin: d?.json?.vin ? normVin(d.json.vin) : null,
      ok: true,
      status: res.status,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { html: "", screenshotUrl: null, jsonPrice: null, jsonVin: null, ok: false, status: null, error: msg.slice(0, 300) };
  }
}

// Download Firecrawl's (ephemeral) screenshot and persist it to our private
// price-evidence bucket so the per-VIN defendable file holds the actual image
// of the advertised page at capture time. Returns the storage path + the
// sha256 of the bytes so the addendum row can prove the file hasn't been
// swapped after capture.
const PRICE_EVIDENCE_BUCKET = "price-evidence";
interface CapturedScreenshot { path: string; sha256: string; bucket: string; }
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
// deno-lint-ignore no-explicit-any
async function captureScreenshot(admin: any, screenshotUrl: string | null, tenantId: string, vin: string): Promise<CapturedScreenshot | null> {
  if (!screenshotUrl) return null;
  try {
    const img = await fetch(screenshotUrl, { signal: AbortSignal.timeout(20000) });
    if (!img.ok) return null;
    const bytes = new Uint8Array(await img.arrayBuffer());
    const path = `${tenantId}/${normVin(vin)}/${Date.now()}.png`;
    const { error } = await admin.storage.from(PRICE_EVIDENCE_BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) return null;
    const sha256 = await sha256Hex(bytes);
    return { path, sha256, bucket: PRICE_EVIDENCE_BUCKET };
  } catch { return null; }
}

const originOf = (u: string): string | null => { try { return new URL(u).origin; } catch { return null; } };
const vinFromUrl = (u: string): string | null => {
  const m = u.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : null;
};

// Collect candidate VDP URLs from a listing page or sitemap body: any URL
// (absolute or root-relative) that embeds a 17-char VIN — the reliable VDP
// signature on DealerOn/Apollo/DealerInspire templates.
const discoverVdpUrls = (docBody: string, origin: string): string[] => {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const absRe = /https?:\/\/[^\s"'<>]*[A-HJ-NPR-Z0-9]{17}[^\s"'<>]*/gi;
  while ((m = absRe.exec(docBody))) {
    const u = m[0].replace(/&amp;/g, "&").split("?")[0].split("#")[0];
    if (isUrlSafe(u)) found.add(u);
  }
  const relRe = /["'](\/[a-z0-9/_.\-]*[A-HJ-NPR-Z0-9]{17}[a-z0-9/_.\-]*)["']/gi;
  while ((m = relRe.exec(docBody))) {
    const u = origin + m[1].split("?")[0].split("#")[0];
    if (isUrlSafe(u)) found.add(u);
  }
  return [...found];
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

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { limit?: number; tenant_id?: string; discover?: boolean; vin?: string; test_url?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const targetVin = body.vin ? normVin(body.vin) : null;
  // Firecrawl is metered — cap renders per run. A single-VIN re-scrape (the
  // Ready-for-Signatures verify) gets a small dedicated budget, and the
  // dealer "Test" button gets exactly one render.
  let renderBudget = FIRECRAWL_KEY ? (body.test_url ? 1 : (targetVin ? 3 : 30)) : 0;

  // ── Auth gate ────────────────────────────────────────────────
  // Two callers: (1) the scheduled cron with the service-role key or the
  // shared cron secret — full batch over all tenants; (2) a signed-in
  // dealer admin clicking "Start scraping" on their inventory page —
  // restricted to their own tenant. A JWT caller MUST pass their
  // tenant_id and be a member of it (or a platform admin).
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
  const isCron = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;
  if (auth !== serviceKey && !isCron) {
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) {
      return new Response(JSON.stringify({ error: "authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tenantId = body.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId)
        .not("accepted_at", "is", null).maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: "not a member of this tenant" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Pin the batch to the caller's tenant and keep manual runs bounded.
    body.tenant_id = tenantId;
    body.limit = Math.min(body.limit ?? 300, 500);
  }

  // ── Per-tenant scrape settings ──────────────────────────────
  // dealer_profiles.settings.vdp_price_labels (comma-separated, priority
  // order) and .vdp_strip_finance_params (default true) configure the
  // extractor. Cached in a Map so the per-row loop doesn't refetch.
  const settingsCache = new Map<string, { labels: string[]; stripFinance: boolean; docFee: number }>();
  const getTenantScrapeSettings = async (tenantId: string) => {
    const cached = settingsCache.get(tenantId);
    if (cached) return cached;
    const { data } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const s: any = data?.settings || {};
    const docFee = String(s.doc_fee_enabled) === "true" ? (Number(s.doc_fee_amount) || 0) : 0;
    const custom = String(s.vdp_price_labels || "").split(",").map((x: string) => x.trim()).filter(Boolean);
    // Dealer's configured labels win priority; generic selling-price labels run
    // after so common sites still resolve. Dedupe case-insensitively.
    const seenLbl = new Set<string>();
    const labels = [...custom, ...DEFAULT_PRICE_LABELS].filter((l) => {
      const k = l.toLowerCase();
      if (seenLbl.has(k)) return false;
      seenLbl.add(k);
      return true;
    });
    const stripFinance = s.vdp_strip_finance_params !== false;
    const out = { labels, stripFinance, docFee };
    settingsCache.set(tenantId, out);
    return out;
  };
  const maybeNormalize = (url: string, stripFinance: boolean) => stripFinance ? normalizeVdpUrl(url) : url;

  // ── "Test" mode ─────────────────────────────────────────────
  // Dealer admin clicked "Test" next to the price-labels setting. Run the
  // full extractor against one URL (cheap fetch first, escalate to Firecrawl
  // if walled), return everything we found, and write nothing.
  if (body.test_url) {
    if (!body.tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required for test" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isUrlSafe(body.test_url)) {
      return new Response(JSON.stringify({ test: { error: "URL blocked by SSRF guard" } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cfg = await getTenantScrapeSettings(body.tenant_id);
    const fetchUrl = maybeNormalize(body.test_url, cfg.stripFinance);
    let html = "";
    let rendered = false;
    let renderStatus: number | null = null;
    let renderError: string | null = null;
    let httpStatus = 0;
    try {
      const r = await fetch(fetchUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
      httpStatus = r.status;
      const raw = r.ok ? await r.text() : "";
      const challenged = looksLikeChallenge(raw, r.headers, r.status);
      html = (!r.ok || challenged) ? "" : raw;
    } catch { /* fall through */ }
    let result: AdResult & { matched_label?: string | null } = html
      ? extractAdvertised(html, fetchUrl, "", cfg.labels)
      : { price: null, source: "none", gated: false, reason: "bot_challenge", msrp: null, candidates: [], matched_label: null };
    if (result.price == null && renderBudget > 0) {
      renderBudget--;
      const fr = await firecrawlRender(fetchUrl);
      renderStatus = fr?.status ?? null;
      renderError = fr?.error ?? null;
      if (fr?.ok) {
        rendered = true;
        if (fr.html) {
          result = extractAdvertised(fr.html, fetchUrl, "", cfg.labels);
        }
        if (result.price == null && fr.jsonPrice != null && sane(fr.jsonPrice)) {
          if (result.msrp != null && fr.jsonPrice < result.msrp * 0.3) {
            result = { ...result, reason: "implausible_vs_msrp" };
          } else {
            result = { ...result, price: fr.jsonPrice, source: "jsonld", reason: null };
          }
        }
      }
    }
    return new Response(JSON.stringify({
      ok: true,
      test: {
        price: result.price,
        matched_label: result.matched_label ?? null,
        source: result.source,
        reason: result.reason,
        rendered,
        render_status: renderStatus,
        render_error: renderError,
        http_status: httpStatus,
        msrp: result.msrp,
        candidates: result.candidates.slice(0, 30),
        configured_labels: cfg.labels,
        strip_finance_params: cfg.stripFinance,
        fetch_url: fetchUrl,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

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
    // Single-VIN re-scrape (Ready-for-Signatures verify) only touches that VIN.
    if (targetVin && (r.vin || "").toUpperCase() !== targetVin) continue;
    const k = r.tenant_id + "|" + (r.vin || "").toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
    if (rows.length >= limit) break;
  }

  // Seed pass: synced vehicle_listings that carry a VDP source_url but have no
  // advertised_prices snapshot yet (MarketCheck delivered the car without a feed
  // price). Crawl the dealer's own VDP to capture a FIRST advertised price.
  if (rows.length < limit) {
    const pricedKeys = new Set<string>();
    for (const r of (all || []) as LatestRow[]) {
      pricedKeys.add(r.tenant_id + "|" + (r.vin || "").toUpperCase());
    }
    let seedQuery = admin
      .from("vehicle_listings")
      .select("tenant_id, store_id, vin, source_url")
      .neq("source_url", "")
      .not("source_url", "is", null)
      .limit(2000);
    if (body.tenant_id) seedQuery = seedQuery.eq("tenant_id", body.tenant_id);
    const { data: seedRows } = await seedQuery;
    for (const s of (seedRows || []) as Array<{ tenant_id: string; store_id: string | null; vin: string; source_url: string }>) {
      const vin = (s.vin || "").toUpperCase();
      if (!vin || !s.source_url) continue;
      if (targetVin && vin !== targetVin) continue;
      const k = s.tenant_id + "|" + vin;
      if (pricedKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      rows.push({
        id: "", tenant_id: s.tenant_id, store_id: s.store_id || "", vin: s.vin,
        source_url: s.source_url, source_label: "website", advertised_price: 0,
        snapshot_at: null, seed: true,
      });
      if (rows.length >= limit) break;
    }
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;
  let discovered = 0;

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
      const cfg = await getTenantScrapeSettings(row.tenant_id);
      const fetchUrl = maybeNormalize(row.source_url, cfg.stripFinance);
      // The cheap fetch is wrapped so a hard bot-wall (connection reset / 403
      // challenge that throws) falls through to the Firecrawl escalation below
      // instead of aborting the row as a permanent failure. Firecrawl renders
      // like a real browser and gets past the wall.
      let html = "";
      let cheapStatus: number | null = null;
      try {
        const res = await fetch(fetchUrl, {
          method: "GET",
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(12000),
        });
        cheapStatus = res.status;
        const raw = res.ok ? await res.text() : "";
        html = (res.ok && !looksLikeChallenge(raw, res.headers, res.status)) ? raw : "";
      } catch { html = ""; }
      let result: AdResult & { matched_label?: string | null } = html
        ? extractAdvertised(html, fetchUrl, row.vin, cfg.labels)
        : { price: null, source: "none", gated: false, reason: "bot_challenge", msrp: null, candidates: [], matched_label: null };

      // Escalate to Firecrawl when the cheap path is walled or empty — this is
      // what makes JS-rendered dealer sites + marketplaces return a real price,
      // and it's where we capture the FTC evidence screenshot.
      let screenshot: CapturedScreenshot | null = null;
      let renderSource: string | null = null;
      let renderStatus: number | null = null;
      let renderError: string | null = null;
      const cheapFailed = result.price == null && result.reason !== "vin_mismatch" && !result.gated;
      if (cheapFailed && renderBudget > 0) {
        renderBudget--;
        const r = await firecrawlRender(fetchUrl);
        renderStatus = r?.status ?? null;
        renderError = r?.error ?? null;
        if (r?.ok) {
          renderSource = "firecrawl";
          if (r.html) {
            html = r.html;
            result = extractAdvertised(r.html, fetchUrl, row.vin, cfg.labels);
          }
          // Fall back to Firecrawl's structured extract, but only when the VIN
          // it read matches the target — never trust a price off the wrong car.
          if (result.price == null && r.jsonPrice != null && sane(r.jsonPrice)
              && (!r.jsonVin || r.jsonVin === normVin(row.vin))) {
            // Apply the same MSRP plausibility guard to the LLM-extracted price.
            if (result.msrp != null && r.jsonPrice < result.msrp * 0.3) {
              result = { ...result, reason: "implausible_vs_msrp" };
            } else {
              result = { ...result, price: r.jsonPrice, source: "jsonld", gated: false, reason: null };
            }
          }
          if (result.price != null) {
            screenshot = await captureScreenshot(admin, r.screenshotUrl, row.tenant_id, row.vin);
          }
        }
      }

      // Capture the dealer's hero photo for the vehicle file — isolated so a
      // not-yet-migrated hero_image_url column can never affect price logic.
      try {
        const hero = extractHeroImage(html, fetchUrl);
        if (hero) {
          await admin.from("vehicle_listings").update({ hero_image_url: hero })
            .eq("tenant_id", row.tenant_id).eq("vin", row.vin).is("hero_image_url", null);
        }
      } catch { /* hero_image_url column may not be migrated yet */ }

      // Harvest the dealer's own CARFAX/AutoCheck report link off their VDP —
      // website channel only (marketplace pages embed the marketplace's own
      // links, not the dealer's subscription link). First-seen wins; the
      // dealer can clear/replace it from the vehicle file.
      try {
        if (String(row.source_label || "") === "website") {
          const link = extractHistoryReportLink(html, row.vin);
          if (link) {
            await admin.from("vehicle_listings").update({ history_report_url: link })
              .eq("tenant_id", row.tenant_id).eq("vin", row.vin).is("history_report_url", null);
          }

          // One-owner badge on the dealer's VDP → the carfax_1_owner flag the
          // passport already trusts (owner chip, Why Buy, buying score). Only
          // fills the gap — never overwrites a real MarketCheck owner_count or
          // an existing flag, and only ever asserts the positive.
          if (detectOneOwnerBadge(html)) {
            const { data: cur } = await admin.from("vehicle_listings")
              .select("mc_attributes").eq("tenant_id", row.tenant_id).eq("vin", row.vin).maybeSingle();
            const mc = (cur?.mc_attributes ?? {}) as Record<string, unknown>;
            if (mc.owner_count == null && mc.carfax_1_owner !== true) {
              await admin.from("vehicle_listings")
                .update({ mc_attributes: { ...mc, carfax_1_owner: true, one_owner_source: "dealer_vdp" } })
                .eq("tenant_id", row.tenant_id).eq("vin", row.vin);
            }
          }
        }
      } catch { /* history_report_url column may not be migrated yet */ }

      if (result.reason === "bot_challenge" && result.price == null) {
        skipped++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error", entity_type: "advertised_price",
          entity_id: row.vin, store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, fetch_url: fetchUrl, http_status: cheapStatus, reason: "bot_challenge", rendered: !!renderSource, render_status: renderStatus, render_error: renderError },
        }).then(() => undefined, () => undefined);
        continue;
      }
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
          details: {
            vin: row.vin,
            url: row.source_url,
            reason: result.reason || "no_price_extracted",
            rendered: !!renderSource,
            render_status: renderStatus,
            render_error: renderError,
            msrp: result.msrp,
            candidates: result.candidates.slice(0, 12),
          },
        }).then(() => undefined, () => undefined);
        continue;
      }
      // Parse the doc/conveyance fee, displayed sale price, retail cash and
      // dealer discount off the rendered page, reconcile to the canonical
      // breakdown (advertised BEFORE doc; sale = advertised + doc fee), and
      // store each field on vehicle_listings. Isolated so a not-yet-migrated
      // column can never fail the price write. price_parse_status = 'warning'
      // when the displayed sale price disagrees with advertised + doc fee.
      try {
        const comp = extractPriceComponents(html);
        const bd = buildBreakdown(newPrice, comp, cfg.docFee);
        if (bd.advertised_price_before_doc != null) {
          await admin.from("vehicle_listings").update({
            advertised_price_before_doc: bd.advertised_price_before_doc,
            doc_fee: bd.doc_fee,
            website_sale_price: bd.website_sale_price,
            retail_cash: bd.retail_cash,
            dealer_discount: bd.dealer_discount,
            price_source_url: fetchUrl,
            price_parse_status: bd.price_parse_status,
            price_parse_notes: bd.price_parse_notes,
            price_last_verified_at: new Date().toISOString(),
          }).eq("tenant_id", row.tenant_id).eq("vin", row.vin);
        }
      } catch { /* price breakdown columns may not be migrated yet */ }

      // Skip a no-op write only when nothing changed AND we have no fresh
      // evidence screenshot to record (a render always logs its screenshot).
      if (Math.abs(newPrice - row.advertised_price) < 1 && !screenshot) {
        unchanged++;
        continue;
      }
      const insRow: Record<string, unknown> = {
        tenant_id: row.tenant_id,
        store_id: row.store_id || "",
        vin: row.vin,
        source_url: fetchUrl,
        source_channel: row.source_label,
        advertised_price: newPrice,
        captured_by: null,
        screenshot_url: screenshot?.path ?? null,
        screenshot_sha256: screenshot?.sha256 ?? null,
        screenshot_bucket: screenshot?.bucket ?? PRICE_EVIDENCE_BUCKET,
        notes: row.seed
          ? `First crawl (${result.source})${result.matched_label ? ` · ${result.matched_label}` : ""} · $${newPrice.toLocaleString()}`
          : `${renderSource ? "Rendered" : "Nightly"} crawl (${result.source}) · previous $${row.advertised_price.toLocaleString()} → $${newPrice.toLocaleString()}`,
      };
      let insErr = (await admin.from("advertised_prices").insert(insRow)).error;
      // Resilient to a not-yet-applied screenshot_url / sha256 / bucket column.
      if (insErr && /screenshot_(url|sha256|bucket)/i.test(insErr.message || "")) {
        const { screenshot_url, screenshot_sha256, screenshot_bucket, ...rest } = insRow;
        void screenshot_url; void screenshot_sha256; void screenshot_bucket;
        insErr = (await admin.from("advertised_prices").insert(rest)).error;
      }
      if (insErr) {
        failed++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, fetch_url: fetchUrl, reason: "insert_failed", error: insErr.message, extracted_price: newPrice },
        }).then(() => undefined, () => undefined);
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

  // ── Discovery: find VDPs from each tenant's configured inventory URLs ──
  // (new_inventory_url / used_inventory_url + the site's sitemap.xml), match
  // each discovered VIN to our inventory, and snapshot its advertised price.
  // Best-effort and bounded; JS-rendered/bot-walled sites yield little here
  // and need the rendering-service fetcher (future) or a feed.
  if (body.discover !== false) {
    // deno-lint-ignore no-explicit-any
    let pq: any = admin.from("dealer_profiles").select("tenant_id, settings");
    if (body.tenant_id) pq = pq.eq("tenant_id", body.tenant_id);
    const { data: profiles } = await pq;
    for (const prof of (profiles || [])) {
      const tenantId = prof.tenant_id;
      const s = prof.settings || {};

      // Each configured listing surface is crawled under its own channel so we
      // record the advertised price PER SITE for the same VIN. The dealer's
      // website is authoritative for drift; the marketplaces (CARFAX, CarGurus,
      // Cars.com, AutoTrader, Capital One) are recorded so the dealer can
      // confirm every site lists the same price. Marketplaces are frequently
      // JS-rendered / bot-walled, so a VIN-in-URL discovery yields what it can
      // and the nightly re-crawl maintains any price already captured.
      const channelSources: { channel: string; url: string; sitemap: boolean }[] = [];
      const addSrc = (channel: string, url: unknown, sitemap = false) => {
        if (typeof url === "string" && url && isUrlSafe(url)) channelSources.push({ channel, url, sitemap });
      };
      addSrc("website", s.new_inventory_url, true);
      addSrc("website", s.used_inventory_url, true);
      addSrc("carfax", s.carfax_url);
      addSrc("cargurus", s.cargurus_url);
      addSrc("cars_com", s.cars_com_url);
      addSrc("autotrader", s.autotrader_url);
      addSrc("capital_one", s.capital_one_url);
      if (channelSources.length === 0) continue;

      const { data: listings } = await admin.from("vehicle_listings").select("vin").eq("tenant_id", tenantId);
      const knownVins = new Set((listings || []).map((l: { vin: string | null }) => (l.vin || "").toUpperCase()));
      if (knownVins.size === 0) continue;

      // Latest price per (VIN, channel) — only write a new snapshot when a
      // site's price actually changes, so we keep one current entry per site.
      const { data: latestAds } = await admin.from("advertised_prices")
        .select("vin, source_channel, advertised_price, captured_at").eq("tenant_id", tenantId)
        .order("captured_at", { ascending: false }).limit(5000);
      const latestByVinChannel = new Map<string, number>();
      for (const a of (latestAds || [])) {
        const k = `${(a.vin || "").toUpperCase()}|${a.source_channel}`;
        if (!latestByVinChannel.has(k)) latestByVinChannel.set(k, a.advertised_price);
      }

      let crawledThisTenant = 0;
      for (const { channel, url, sitemap } of channelSources) {
        if (crawledThisTenant >= 300) break;

        // Discover candidate VDP URLs for this site (listing page + sitemap).
        const seeds = [url];
        if (sitemap) { const o = originOf(url); if (o) seeds.push(`${o}/sitemap.xml`); }
        const vdpUrls = new Set<string>();
        for (const src of seeds) {
          if (vdpUrls.size > 400) break;
          try {
            const r = await fetch(src, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
            if (!r.ok) continue;
            const txt = await r.text();
            if (looksLikeChallenge(txt, r.headers, r.status)) continue;
            discoverVdpUrls(txt, originOf(src) || "").forEach((u) => vdpUrls.add(u));
          } catch { /* skip source */ }
        }

        for (const vdp of vdpUrls) {
          if (crawledThisTenant >= 300) break;
          const vin = vinFromUrl(vdp);
          if (!vin || !knownVins.has(vin)) continue; // only verify our own inventory
          try {
            const cfg = await getTenantScrapeSettings(tenantId);
            const fetchVdp = maybeNormalize(vdp, cfg.stripFinance);
            const r = await fetch(fetchVdp, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
            const html = r.ok ? await r.text() : "";
            if (!r.ok || looksLikeChallenge(html, r.headers, r.status)) { crawledThisTenant++; continue; }
            const result = extractAdvertised(html, fetchVdp, vin, cfg.labels);
            if (result.gated || result.reason === "vin_mismatch" || result.price == null) { crawledThisTenant++; continue; }
            const k = `${vin}|${channel}`;
            const prev = latestByVinChannel.get(k);
            if (prev != null && Math.abs(result.price - prev) < 1) { crawledThisTenant++; continue; }
            await admin.from("advertised_prices").insert({
              tenant_id: tenantId, store_id: "", vin, source_url: vdp, source_channel: channel,
              advertised_price: result.price, captured_by: "discovery",
              notes: `Discovered on ${channel} (${result.source})${prev != null ? ` · was $${prev.toLocaleString()}` : ""}`,
            });
            latestByVinChannel.set(k, result.price);
            discovered++;
            crawledThisTenant++;
          } catch { crawledThisTenant++; }
        }
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    picked: rows.length,
    updated,
    unchanged,
    failed,
    skipped,
    discovered,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
