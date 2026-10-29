import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyCrawlOutcome } from "../_shared/crawlOutcome.ts";
import { admitProviderCall, recordProviderCall } from "../_shared/providerBudget.ts";
import {
  classifyRenderedPage, discoverVdpUrls as discoverVdpUrlsShared, preferCrawlUrl, sameUrl,
  shouldBackoffMismatch, vinFromUrl as vinFromUrlShared,
  type CrawlUrlSource, type RenderedPageVerdictDetail,
} from "../_shared/crawlUrlPolicy.ts";
import { judgeAboveFeed, parseFeedTimestamp } from "../_shared/priceGuard.ts";
import { identitySummary, scopeToVehicle } from "../_shared/vdpIdentity.ts";
import {
  cleanWebsitePriceTerm, DEFAULT_PRICE_LABELS, extractVehiclePrice, refusedResult, stripDescriptionBlocks, visibleText,
  type VehiclePriceResult,
} from "../_shared/vdpPrice.ts";
import { decideFeeBasis, sectionAround } from "../_shared/feeBasis.ts";
import { readPriceStack, type PriceStackResult } from "../_shared/priceStack.ts";
import { buildEvidenceRecords } from "../_shared/priceEvidence.ts";
import {
  commitObservation, observationKey, revalidateEvidence, sha256OfText as sha256Text, supabaseCommitDb, type EvidenceDecision,
} from "../_shared/crawlCommit.ts";
import { fetchCreditUsage, pickRenderKey, selectRenderKey, type RenderKeyCandidate } from "../_shared/renderKey.ts";
import {
  createRenderPacer, deriveRenderBudget, parseRetryAfter, resolveRendersPerMinute,
} from "../_shared/renderPacer.ts";

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
// nothing — the dealer still sees the prior snapshot. Two audit
// actions keep real problems separate from benign outcomes:
//   • action='advertised_price_crawl_error'   — a genuine failure
//     (URL blocked, no price extracted, insert failed, exception).
//   • action='advertised_price_crawl_skipped' — an expected, benign
//     skip where the prior good snapshot is preserved (bot wall,
//     VIN mismatch, "call for price" gate, above-feed mis-parse).
// This mirrors the `failed` vs `skipped` counters so an admin isn't
// alarmed by skips that aren't errors.
//
// Contract:
//   POST /functions/v1/crawl-advertised-prices
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body: { limit?: number; tenant_id?: string; force_screenshot?: boolean }
//     · limit       — max URLs to crawl this invocation (default 200)
//     · tenant_id   — restrict to one tenant; default = all tenants
//     · force_screenshot — take an evidence screenshot for every row this
//                   run, not only on change / first capture
//   Env: FIRECRAWL_RPM — renders per minute (default 10, clamped 1..60);
//        the provider enforces 11.
//   Returns: {
//     ok: true,
//     picked: number,    // URLs we attempted to crawl
//     updated: number,   // observations recorded with a changed price
//     unchanged: number, // observations recorded with the price held (still
//                        // written, so the staleness queue keeps rotating)
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

interface TenantScrapeSettings {
  labels: string[];
  stripFinance: boolean;
  docFee: number;
  inclDocFee: boolean;
  /** The dealership's settings as stored; feeBasis.ts reads its fee interpretation from them. */
  settings: Record<string, unknown>;
  stackLabels: { dealer: string[]; final: string[] };
}

interface VehicleRead {
  result: VehiclePriceResult;
  stack: PriceStackResult;
}

interface ListingContext {
  ymm: string | null;
  condition: string | null;
  feedPrice: number | null;
  feedMsrp: number | null;
  feedLastSeen: unknown;
  feedScraped: unknown;
  feedIncludesFees: boolean | null;
  pricing: { advertised_price_before_doc: number | null; doc_fee: number | null; website_sale_price: number | null };
}

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
  // Where the address came from: discovery on the live site, the feed, or
  // the last snapshot. Carried into the ledger so a dead url can be told
  // from a dead page.
  url_source?: CrawlUrlSource;
}

// A feed row names the dealer's inventory system as its channel. The crawler
// only ever observes a page, so whatever channel a queue row carried in, what
// it writes back is an observation on the website channel. The queue function
// stopped handing out feed rows (20260909020000); this is the belt to that
// suspender, so a feed row can never become a "feed" observation with
// captured_method dealer_vdp_observation.
const FEED_CHANNELS = new Set(["feed", "marketcheck", "marketcheck_syndication"]);
function observationChannel(label: string | null | undefined): string {
  const l = String(label || "").trim();
  if (!l || FEED_CHANNELS.has(l.toLowerCase())) return "website";
  return l;
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

const normVin = (s: unknown) => String(s || "").toUpperCase().trim();

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

// The dealer's own stock number, off their own VDP.
//
// The syndication feed carries stock_no for most cars but not all — a unit the
// dealer merchandised on their site before it reached the feed has one on the
// page and none in our record, and the whole lot refers to that car by it.
// The crawler is already on the page every night, so it reads it.
//
// Deliberately narrow: only an explicitly LABELLED number is taken. A bare
// alphanumeric token near the price is as likely to be a trim code, a lease
// offer id, or another car in a "similar vehicles" rail, and a wrong stock
// number is worse than none — it is what someone walks the lot with.
// The label must carry a real delimiter (":" / "#") or the word number/no —
// "in stock now" is prose, not a label, and a pattern loose enough to read it
// files whatever word follows.
const STOCK_LABEL_RE =
  /\b(?:stock|stk)\s*(?:(?:number|no\.?|#)\s*[:#]?|[:#])\s*([A-Z0-9][A-Z0-9-]{1,11})\b/i;
const STOCK_JSON_RE =
  /"(?:stock_?number|stockNum|sku)"\s*:\s*"([A-Z0-9][A-Z0-9-]{1,11})"/i;

export const extractStockNumber = (html: string, vin: string): string | null => {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ");
  const raw = (STOCK_JSON_RE.exec(html)?.[1] || STOCK_LABEL_RE.exec(text)?.[1] || "").trim().toUpperCase();
  if (!raw) return null;
  // Some sites put the VIN — or its last 8 — in the stock slot. That is the
  // VIN, not a stock number, and filing it as one makes the two look
  // inconsistent on every document that prints both. Containment rather than
  // equality: the capture is length-capped, so a full VIN arrives truncated.
  const v = (vin || "").toUpperCase();
  if (v && raw.length >= 6 && v.includes(raw)) return null;
  // A pure model year, or a number long enough to be a price or a phone
  // number, is a mis-read of the surrounding page rather than a stock number.
  if (/^(19|20)\d{2}$/.test(raw)) return null;
  return raw;
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

// Site chrome asserts nothing about the car in front of you. Every dealer
// platform puts "Certified Pre-Owned Vehicles" in its inventory nav, and
// Harte's real VDP for a non-certified 2022 Ram carries that footer link, so a
// detector reading the whole document certifies the entire lot. An anchor
// pointing at a listing or search page is navigation by construction, so its
// label is dropped before any badge is read.
//
// Applied to all three badge detectors rather than only the CPO one: the same
// nav can advertise "One-Owner Specials" or "Clean Title Guarantee", and a
// missed badge is the right way for a compliance claim to fail.
const LISTING_HREF_RE =
  /(?:\/|[?&])(?:inventory|showroom|search|vehicles?|cpo|certified|certified-pre-owned|pre-owned|preowned|used|new|specials)(?:[/?#&=]|$)/i;
const stripNavigationLinks = (html: string): string =>
  html.replace(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi, (whole, attrs: string) => {
    const href = /href=["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    return href && LISTING_HREF_RE.test(href) ? " " : whole;
  });

// A VDP's description block is not third-party evidence, and on these pages it
// is not even the dealer's: it is OUR OWN generated copy syndicated back to the
// dealer site, unrendered markdown and all ("## 2022 Ram 1500 Big Horn Crew Cab
// 4x4", "**VIN:** ..."). Reading a CARFAX fact out of that and writing it back
// as a verified flag would launder our own output into a source of truth --
// precisely the fabrication this pipeline exists to prevent.
//
// It is not hypothetical. On the RAM 1500 fixture, "no title brands" appears in
// the description and nowhere else, so the clean-title flag was reading a
// sentence we wrote. What survives the strip is genuinely third-party: CARFAX's
// own badge art (partnerstatic.carfax.com, alt="carfax-oneowner"), CARFAX's
// embedded snapshot module, and CarStory's independent "CARFAX One-Owner" panel.
//
// The lazy close means a description container with nested elements leaves a
// tail behind. That is the tolerable direction of failure for a strip whose
// purpose is to REMOVE evidence, and the detectors it feeds are positive-only.

// Everything a badge detector is allowed to read: the published page minus its
// own navigation and minus any free-text description block.
const evidenceHtml = (html: string): string =>
  stripDescriptionBlocks(stripNavigationLinks(html));


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
const detectOneOwnerBadge = (html: string): boolean =>
  ONE_OWNER_RE.test(evidenceHtml(html));

// Manufacturer certification on the dealer's own VDP. The description engine
// refuses CPO language on a feed flag alone, and rightly so: `condition` is
// itself derived from MarketCheck's is_certified, so that single field cannot
// corroborate itself. The dealer's published page IS an independent assertion,
// and it is the one a shopper actually sees.
//
// A manufacturer word must appear next to the certification wording, so a
// generic "certified technicians" or "certified dealer" footer cannot set it.
// Positive-only, exactly like the one-owner badge: absence proves nothing.
const CPO_RE = new RegExp(
  [
    String.raw`\bcertified\s+pre[-\s]?owned\b`,
    String.raw`\b(?:manufacturer|factory)[\s-]?certified\b`,
    String.raw`\bcpo\b[\s\S]{0,80}?\bwarrant`,
  ].join("|"),
  "i",
);
const GENERIC_CERT_RE = /certified\s+(?:technician|mechanic|dealer|service|collision|staff)/i;
const detectCpoBadge = (rawHtml: string): boolean => {
  const html = evidenceHtml(rawHtml);
  return CPO_RE.test(html) && !(GENERIC_CERT_RE.test(html) && !/certified\s+pre[-\s]?owned/i.test(html));
};

// Clean-title confirmation on the dealer's own VDP. MarketCheck's feed never
// supplies carfax_clean_title — it is null on every active vehicle — yet the
// passport title module, the TrustStrip chip ("No salvage, flood, or lemon")
// and the buying score all read it, so the dealer's published page is the only
// source we have.
//
// Title-specific and adjacent by construction: "clean title", a "Title Status:
// Clean" row, or an explicit "Title Brand: None". A bare "clean CARFAX" is NOT
// accepted — that is a claim about the history report, not about the title
// brand, and this flag prints as a title-brand claim.
//
// Positive-only, exactly like the one-owner and CPO badges: absence of the
// badge is not evidence of a brand and must never write false.
const CLEAN_TITLE_RE = new RegExp(
  [
    String.raw`\bclean(?:\s+(?:carfax|autocheck|nmvtis|vehicle))?\s+title\b`,
    String.raw`\btitle\s+(?:status|history|record|check|brand)\s*[:\-]?\s*clean\b`,
    String.raw`\btitle\s*[:\-]\s*clean\b`,
    String.raw`\btitle\s+brands?\s*[:\-]?\s*(?:none|no)\b`,
    String.raw`\bno\s+title\s+brands?\b`,
  ].join("|"),
  "gi",
);
// The same two words appear on a dealer page without asserting anything about
// this car: a financing condition ("approval requires a clean title"), a
// negation, or the title desk ("we handle clean title transfers"). A match is
// trusted only when neither guard fires in its immediate context — "clean" and
// "title" are ordinary words, and a false clean-title claim on a compliance
// product is far worse than a missed one.
const CLEAN_TITLE_CONDITION_RE =
  /\b(?:must|needs?|needed|require[sd]?|subject\s+to|unless|if|provided|assum\w+|guarantee\w*|qualif\w+|eligib\w+|cannot|can't|not|loans?|liens?|pawn|apply|application)\b/i;
const CLEAN_TITLE_PROCESS_RE =
  /^\W{0,3}(?:paperwork|transfers?|processing|services?|fees?|loans?|liens?|department|clerk|required|only|necessary|guaranteed|unless|except)\b/i;

const detectCleanTitleBadge = (rawHtml: string): boolean => {
  // Badge art carries the claim in alt/title text, so those values are searched
  // alongside the rendered text; the pipe keeps one attribute's words from
  // forming a phrase with the next one's.
  const html = evidenceHtml(rawHtml);
  const attrs = [...html.matchAll(/(?:alt|title)=["']([^"']{0,120})["']/gi)].map((m) => m[1]);
  const text = `${html.replace(/<[^>]+>/g, " ")} | ${attrs.join(" | ")}`
    .replace(/&nbsp;?/gi, " ").replace(/\s+/g, " ");
  CLEAN_TITLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLEAN_TITLE_RE.exec(text))) {
    const end = m.index + m[0].length;
    if (CLEAN_TITLE_CONDITION_RE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    if (CLEAN_TITLE_PROCESS_RE.test(text.slice(end, end + 28))) continue;
    return true;
  }
  return false;
};


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



// Browser-like UA shared by the seeded crawl and discovery fetches.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_HEADERS = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };

// ── Firecrawl rendering + screenshot ─────────────────────────────
// Plain fetch can't see prices on JS-walled dealer sites / marketplaces.
// When the cheap path fails, escalate to Firecrawl for the rendered HTML.
//
// The routine render asks for html only. It used to bundle a full-page
// screenshot and an LLM json extract into every request; that bundle was
// what the provider refused at 402 on 2026-09-08 ("try changing the request
// limit to a lower value") while the balance was healthy and a plain html
// scrape of the same page cost one credit. The json extract was a fallback of
// a fallback that never decided a Harte price -- the label ladder resolves
// "Sale Price" deterministically -- so it is gone. jsonPrice / jsonVin stay on
// the shape, always null, so the consumers still compile.
//
// The screenshot (our evidence image) is its own render, requested only when
// there is something new to evidence: see shouldCaptureEvidence below.
const FIRECRAWL_KEYS: RenderKeyCandidate[] = [
  { env: "FIRECRAWL_API_KEY_1", key: Deno.env.get("FIRECRAWL_API_KEY_1") || "" },
  { env: "FIRECRAWL_API_KEY", key: Deno.env.get("FIRECRAWL_API_KEY") || "" },
].filter((c) => !!c.key);
const FIRECRAWL_KEY = FIRECRAWL_KEYS[0]?.key || "";
// The key a run spends. Chosen per run by selectRenderKey from the provider's
// own balance report (see _shared/renderKey.ts); module state because the
// renderer and the pacer are module functions. Two overlapping runs in one
// isolate would at worst share the same sensible choice.
let activeRenderKey = FIRECRAWL_KEY;
const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const RENDERS_PER_MINUTE = resolveRendersPerMinute(Deno.env.get("FIRECRAWL_RPM"));
const MAX_RATE_LIMIT_RETRIES = 2;
// A render is not started unless it can finish inside the link's budget. On
// 2026-09-09 06:00 the fifth render of a run was fired at 213 s of a 220 s
// budget, paid for, and lost when the run ended; a full-page render of a
// dealer page takes 20-45 s.
const RENDER_HEADROOM_MS = 40_000;
// One cron request cannot hold the whole list: the edge gateway closes a
// request that has sent nothing for 150 s, and a paced, screenshot-backed
// visit takes 30-60 s. Each link works inside RUN_BUDGET_MS, then hands the
// rest of its list to a fresh request, at most this many times.
const MAX_CHAIN_DEPTH = 12;
// A vehicle whose page price the misparse guard refused writes no row, so its
// clock never advances and it comes back first on every run. On 2026-09-09
// the same new QX60 was rendered and refused at 06:37 and again at 06:41;
// with 71 new vehicles reading above their feed price, every run would have
// spent its whole budget refusing the same pages. A refused vehicle waits
// this long before it is visited again; the fix for the refusal itself is
// the new-car price labels, not more visits.
const REJECTED_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;
// A url that has answered with another vehicle, or no vehicle, this many
// times in the window above is dead; it rests until the window passes or the
// address changes. One vehicle had been rendered 66 times on a dead url.
const MISMATCH_BACKOFF_ATTEMPTS = 3;
// Listing pages and the sitemap rendered per run when the plain fetch is
// refused, so discovery can still learn the live VDP addresses.
const DISCOVERY_RENDER_CAP_DEFAULT = 3;
// A feed price older than this is a stale baseline for the above-feed guard;
// see priceGuard.ts.
const FEED_FRESH_MS = 3 * 24 * 60 * 60 * 1000;

type RenderFormat = string | { type: string; fullPage?: boolean };
const HTML_ONLY_FORMATS: RenderFormat[] = ["html"];
const EVIDENCE_FORMATS: RenderFormat[] = ["html", { type: "screenshot", fullPage: true }];

interface RenderResult {
  html: string;
  screenshotUrl: string | null;
  jsonPrice: number | null;
  jsonVin: string | null;
  ok: boolean;
  status: number | null;
  error: string | null;
  retryAfterHeader?: string | null;
  // The provider follows redirects; this is where it ended up and what that
  // page answered, so a landing page is not mistaken for the vehicle.
  finalUrl: string | null;
  pageStatus: number | null;
}

async function firecrawlRender(url: string, formats: RenderFormat[] = HTML_ONLY_FORMATS): Promise<RenderResult | null> {
  if (!activeRenderKey) return null;
  try {
    const res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${activeRenderKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats,
        onlyMainContent: false,
        waitFor: 4000,
        timeout: 60000,
      }),
      signal: AbortSignal.timeout(70000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        html: "", screenshotUrl: null, jsonPrice: null, jsonVin: null, ok: false, status: res.status, finalUrl: null, pageStatus: null,
        error: body.slice(0, 300) || res.statusText, retryAfterHeader: res.headers.get("retry-after"),
      };
    }
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    const d = data?.data || data;
    return {
      html: d?.html || "",
      screenshotUrl: d?.screenshot || d?.screenshotUrl || d?.actions?.screenshots?.[0] || (d?.metadata?.screenshot) || null,
      jsonPrice: null,
      jsonVin: null,
      ok: true,
      status: res.status,
      error: null,
      finalUrl: (typeof d?.metadata?.url === "string" && d.metadata.url) || (typeof d?.metadata?.sourceURL === "string" && d.metadata.sourceURL) || null,
      pageStatus: Number(d?.metadata?.statusCode) || null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { html: "", screenshotUrl: null, jsonPrice: null, jsonVin: null, ok: false, status: null, error: msg.slice(0, 300), finalUrl: null, pageStatus: null };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface PacedRender {
  render: RenderResult | null;
  formats: RenderFormat[];
  pacedWaitMs: number;
  rateLimitRetries: number;
  gaveUp: "out_of_time" | "rate_limited" | "budget_refused" | null;
}

// The dealership a render is spent for. Each paced render asks the provider
// budget first (the dealership's budget, then the platform's); a refusal
// spends nothing and is named in the ledger.
interface RenderBudget {
  // deno-lint-ignore no-explicit-any
  admin: any;
  tenantId: string | null;
  vin?: string | null;
  caller: string;
}

// One render, paced. Waits for the pacer's slot, retries a 429 for the wait
// the provider names (at most MAX_RATE_LIMIT_RETRIES times), and gives up
// rather than sleep past the run's deadline. Every request -- refused ones
// included -- counts against the provider's per-minute window, so each is
// recorded with the pacer before it is sent.
const pacer = createRenderPacer({ rpm: RENDERS_PER_MINUTE });
async function pacedRender(url: string, formats: RenderFormat[], deadlineAt: number, budget?: RenderBudget): Promise<PacedRender> {
  let pacedWaitMs = 0;
  let rateLimitRetries = 0;
  let last: RenderResult | null = null;
  let eventId: number | null = null;
  if (budget && activeRenderKey) {
    const gate = await admitProviderCall(budget.admin, {
      url, caller: budget.caller, provider: "firecrawl",
      product: formats.some((f) => typeof f !== "string" && f.type === "screenshot") ? "scrape_screenshot" : "scrape",
      tenantId: budget.tenantId, vin: budget.vin ?? null,
    });
    if (!gate.admitted) return { render: null, formats, pacedWaitMs, rateLimitRetries, gaveUp: "budget_refused" };
    eventId = gate.eventId;
  }
  const done = async (r: PacedRender): Promise<PacedRender> => {
    if (budget) await recordProviderCall(budget.admin, eventId, r.render ? r.render.status : null, r.render?.error ?? null);
    return r;
  };
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const now = Date.now();
    const wait = pacer.waitBeforeRender(now);
    if (now + wait + RENDER_HEADROOM_MS > deadlineAt) return done({ render: last, formats, pacedWaitMs, rateLimitRetries, gaveUp: "out_of_time" });
    if (wait > 0) { await sleep(wait); pacedWaitMs += wait; }
    pacer.noteRenderStarted(Date.now());
    last = await firecrawlRender(url, formats);
    if (last?.ok) {
      pacer.noteSuccess();
      return done({ render: last, formats, pacedWaitMs, rateLimitRetries, gaveUp: null });
    }
    if (last?.status !== 429) return done({ render: last, formats, pacedWaitMs, rateLimitRetries, gaveUp: null });
    const retryAfterMs = parseRetryAfter(last.retryAfterHeader, last.error, Date.now());
    const backoff = pacer.noteRateLimited(retryAfterMs);
    if (attempt === MAX_RATE_LIMIT_RETRIES) return done({ render: last, formats, pacedWaitMs, rateLimitRetries, gaveUp: "rate_limited" });
    if (Date.now() + backoff > deadlineAt) return done({ render: last, formats, pacedWaitMs, rateLimitRetries, gaveUp: "out_of_time" });
    await sleep(backoff);
    pacedWaitMs += backoff;
    rateLimitRetries++;
  }
  return done({ render: last, formats, pacedWaitMs, rateLimitRetries, gaveUp: "rate_limited" });
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
const vinFromUrl = (u: string): string | null => vinFromUrlShared(u);
// Candidate VDP URLs on a listing page or sitemap: any absolute or
// root-relative url that embeds a 17-character VIN (crawlUrlPolicy.ts).
const discoverVdpUrls = (docBody: string, origin: string): string[] => discoverVdpUrlsShared(docBody, origin, isUrlSafe);

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

  let body: {
    limit?: number; tenant_id?: string; discover?: boolean; vin?: string; test_url?: string;
    force_screenshot?: boolean; credit_check?: boolean; depth?: number;
    // Platform callers only: run discovery alone (no pricing pass), seed it
    // from explicit urls, and cap its renders.
    discover_only?: boolean; discover_seed_urls?: string[]; discover_render_cap?: number;
    // Platform callers only: lift the week's rest on vehicles whose page
    // price the guard refused, e.g. once after the guard itself changes.
    ignore_rejected_backoff?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const targetVin = body.vin ? normVin(body.vin) : null;
  // Each row is a serial fetch with a 12s timeout, optionally a Firecrawl
  // render on top. 500 of those cannot finish inside an edge function's wall
  // clock, so the run used to be killed mid-loop — no summary, no audit row,
  // and no signal that the tail of the list had not been touched. Stopping
  // deliberately keeps the reporting honest; the staleness ordering means
  // whatever is left is simply first in line tomorrow.
  // 120 s, not 220: the gateway's idle limit is 150 s, and the 06:00 run on
  // 2026-09-09 kept working past it -- four vehicles written, the summary
  // answered to nobody (504), the tail of the list never reached. A link
  // that runs out of time chains the remainder to a fresh request instead.
  const RUN_BUDGET_MS = 120_000;
  const startedAt = Date.now();
  const deadlineAt = startedAt + RUN_BUDGET_MS;
  const depth = Math.max(0, Math.min(Number(body.depth) || 0, MAX_CHAIN_DEPTH));
  // Firecrawl is metered and rate limited — cap renders per run at what the
  // paced rate can actually fit inside the wall clock, so the loop never plans
  // a burst it would have to fire all at once. A single-VIN re-scrape (the
  // Ready-for-Signatures verify) gets a small dedicated budget, and the
  // dealer "Test" button gets exactly one render.
  const pacedBudget = deriveRenderBudget(RUN_BUDGET_MS, RENDERS_PER_MINUTE);
  let renderBudget = FIRECRAWL_KEY ? (body.test_url ? 1 : (targetVin ? 3 : pacedBudget)) : 0;
  const renderBudgetStart = renderBudget;

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

  const platformCaller = auth === serviceKey || isCron;

  // ── Credit check ───────────────────────────────────────────
  // Reports the renderer account's balance as the provider states it, for
  // the key this function actually holds, so a 402 can be told apart from a
  // key that belongs to a different team than the dashboard being read.
  // Platform callers only (cron secret or service role): a dealer's session
  // has no business with the platform's provider balance. Names the env var
  // that supplied each key; the key itself never leaves the function. Writes
  // nothing and renders nothing.
  if (body.credit_check === true) {
    if (auth !== serviceKey && !isCron) {
      return new Response(JSON.stringify({ error: "platform callers only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const checks: Array<Record<string, unknown>> = [];
    for (const k of FIRECRAWL_KEYS) {
      const u = await fetchCreditUsage(k.key);
      checks.push({
        env: k.env, key_length: k.key.length,
        status: u.status, remaining_credits: u.remaining, plan_credits: u.plan, period_end: u.periodEnd, error: u.error,
      });
    }
    // Which key the next run would spend, decided the same way a run decides.
    const pick = pickRenderKey(checks.map((c) => ({ env: String(c.env), remaining: c.remaining_credits as number | null })));
    return new Response(JSON.stringify({
      ok: true,
      credit_check: checks,
      selected: pick.index >= 0 ? { env: checks[pick.index].env, reason: pick.reason } : null,
      keys_configured: FIRECRAWL_KEYS.length,
      renders_per_minute: RENDERS_PER_MINUTE,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── Renderer key selection ─────────────────────────────────
  // Before anything renders, ask the provider which configured key can pay.
  // Free call; recorded by env name in the run summary so a 402 can never
  // again hide behind a dashboard that is showing a different team.
  const renderKey = await selectRenderKey(FIRECRAWL_KEYS);
  if (renderKey.key) activeRenderKey = renderKey.key;
  const renderKeyReport = {
    env: renderKey.env, reason: renderKey.reason, remaining_credits: renderKey.remaining, checked: renderKey.checked,
  };

  // ── Per-tenant scrape settings ──────────────────────────────
  // dealer_profiles.settings.vdp_price_labels (comma-separated, priority
  // order) and .vdp_strip_finance_params (default true) configure the
  // extractor. Cached in a Map so the per-row loop doesn't refetch.
  const settingsCache = new Map<string, TenantScrapeSettings>();
  const getTenantScrapeSettings = async (tenantId: string) => {
    const cached = settingsCache.get(tenantId);
    if (cached) return cached;
    const { data } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const s: any = data?.settings || {};
    const docFee = String(s.doc_fee_enabled) === "true" ? (Number(s.doc_fee_amount) || 0) : 0;
    // Dealer's advertised/VDP price already includes the doc fee (Harte: yes).
    const inclDocFee = String(s.advertised_includes_doc_fee) === "true";
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
    // The dealer's own names for the price-widget stages (proposed setting
    // price_stack_labels: { dealer_price: [...], final_price: [...] }).
    const listOf = (v: unknown) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    const stackLabels = { dealer: listOf(s.price_stack_labels?.dealer_price), final: listOf(s.price_stack_labels?.final_price) };
    const out: TenantScrapeSettings = { labels, stripFinance, docFee, inclDocFee, settings: s, stackLabels };
    settingsCache.set(tenantId, out);
    return out;
  };
  const maybeNormalize = (url: string, stripFinance: boolean) => stripFinance ? normalizeVdpUrl(url) : url;

  // One vehicle page, read once: the page scoped to this vehicle, the
  // vehicle's own price widget if it has one, and the price read inside that
  // scope (widget first).
  const readVehiclePage = (pageHtml: string, vin: string, requestedUrl: string, finalUrl: string | null, cfg: TenantScrapeSettings, ymm: string | null): VehicleRead => {
    const scope = scopeToVehicle(pageHtml, vin);
    const stack = readPriceStack(stripDescriptionBlocks(scope.html), vin, {
      dealerPriceLabels: cfg.stackLabels.dealer, finalPriceLabels: cfg.stackLabels.final, configuredFee: cfg.docFee,
      observedAt: new Date(), pageUrl: finalUrl ?? requestedUrl,
      // Verified offer records are the only source of general availability;
      // none exist until that intake is approved, so every offer is unverified.
      programRecords: [],
    });
    const result = extractVehiclePrice(pageHtml, {
      targetVin: vin, requestedUrl, finalUrl, labels: cfg.labels, ymm, scope, widgetRange: stack.widgetRange,
    });
    return { result, stack };
  };

  // What the crawler needs to know about the listing it is pricing, read once
  // per row: description fields for the identity finding, the feed baseline
  // for the guard, and the pricing fields a promotion would change.
  const readListingContext = async (tenantId: string, vin: string): Promise<ListingContext | null> => {
    try {
      const { data } = await admin.from("vehicle_listings")
        .select("ymm, condition, price, advertised_price_before_doc, doc_fee, website_sale_price, feed_msrp:mc_raw->>msrp, feed_last_seen:mc_raw->>last_seen_at, feed_scraped:mc_raw->>scraped_at, feed_includes:mc_raw->>price_includes_fees")
        .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
      if (!data) return null;
      // deno-lint-ignore no-explicit-any
      const d = data as any;
      return {
        ymm: d.ymm ?? null,
        condition: d.condition ?? null,
        feedPrice: Number(d.price) || null,
        feedMsrp: Number(d.feed_msrp) || null,
        feedLastSeen: d.feed_last_seen ?? null,
        feedScraped: d.feed_scraped ?? null,
        feedIncludesFees: d.feed_includes === "true" ? true : d.feed_includes === "false" ? false : null,
        pricing: { advertised_price_before_doc: d.advertised_price_before_doc, doc_fee: d.doc_fee, website_sale_price: d.website_sale_price },
      };
    } catch { return null; }
  };
  const runId = crypto.randomUUID();
  const commitDb = supabaseCommitDb(admin);
  const listingOutcomes: Record<string, number> = {};

  // When the feed last answered for a tenant, for the above-feed guard: a
  // listing that carries no provider timestamp borrows the tenant's last
  // successful syndication run.
  const feedRunCache = new Map<string, number | null>();
  const lastFeedSuccessAt = async (tenantId: string): Promise<number | null> => {
    if (feedRunCache.has(tenantId)) return feedRunCache.get(tenantId) ?? null;
    let at: number | null = null;
    try {
      const { data } = await admin.from("inventory_sync_runs").select("started_at")
        .eq("tenant_id", tenantId).eq("status", "success")
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      const parsed = data?.started_at ? Date.parse(String(data.started_at)) : NaN;
      at = Number.isFinite(parsed) ? parsed : null;
    } catch { at = null; }
    feedRunCache.set(tenantId, at);
    return at;
  };

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
    // The dealer's "Test" button checks labels on any page: identity is
    // checked only when the caller names the vehicle.
    const testVin = body.vin ? normVin(body.vin) : null;
    const testRead = (pageHtml: string, finalUrl: string | null) => testVin
      ? readVehiclePage(pageHtml, testVin, fetchUrl, finalUrl, cfg, null).result
      : extractVehiclePrice(pageHtml, { targetVin: null, requestedUrl: fetchUrl, finalUrl, labels: cfg.labels });
    let result: VehiclePriceResult = html ? testRead(html, null) : refusedResult("bot_challenge", fetchUrl);
    let pacedWaitMs = 0;
    let rateLimitRetries = 0;
    let testPage: RenderedPageVerdictDetail | null = null;
    let finalUrl: string | null = null;
    if (result.price == null && renderBudget > 0) {
      renderBudget--;
      const pr = await pacedRender(fetchUrl, HTML_ONLY_FORMATS, deadlineAt,
        { admin, tenantId: body.tenant_id ?? null, vin: testVin, caller: "crawl-advertised-prices:test" });
      if (pr.gaveUp === "budget_refused") renderError = "dealership provider budget refused the render";
      const fr = pr.render;
      pacedWaitMs = pr.pacedWaitMs;
      rateLimitRetries = pr.rateLimitRetries;
      renderStatus = fr?.status ?? null;
      renderError = fr?.error ?? null;
      finalUrl = fr?.finalUrl ?? null;
      if (fr?.ok) {
        rendered = true;
        if (fr.html) {
          testPage = classifyRenderedPage({
            html: fr.html, requestedUrl: fetchUrl, finalUrl: fr.finalUrl, pageStatus: fr.pageStatus,
            targetVin: body.vin ? normVin(body.vin) : null,
            isChallenge: (h, s) => looksLikeChallenge(h, new Headers(), s),
          });
          result = testPage.verdict === "challenge"
            ? refusedResult("bot_challenge", fetchUrl)
            : testRead(fr.html, fr.finalUrl ?? null);
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
        render_formats: HTML_ONLY_FORMATS,
        paced_wait_ms: pacedWaitMs,
        rate_limit_retries: rateLimitRetries,
        renders_per_minute: RENDERS_PER_MINUTE,
        render_key: renderKeyReport,
        http_status: httpStatus,
        msrp: result.msrp,
        candidates: result.candidates.slice(0, 30),
        configured_labels: cfg.labels,
        strip_finance_params: cfg.stripFinance,
        fetch_url: fetchUrl,
        final_url: finalUrl,
        page: testPage,
        identity: identitySummary(result.identity),
        section: result.section,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const limit = Math.max(1, Math.min(body.limit ?? 200, 1000));

  // ── The work list ───────────────────────────────────────────────────
  // Ordered by STALENESS, least recently crawled first. It used to be ordered
  // newest-captured_at first and cut at `limit`; crawling a vehicle writes a
  // snapshot, which lifted that VIN straight back to the top, so the same head
  // of the list was re-crawled every night and every vehicle past the cut was
  // never reached again. A dealer with more inventory than `limit` had a fixed
  // set of cars that were silently never scraped.
  //
  // advertised_price_crawl_queue does the latest-per-VIN pick server-side over
  // the WHOLE table, because a vehicle whose last snapshot has aged out of a
  // client-side window is exactly the vehicle that needs finding.
  const seen = new Set<string>();
  const rows: LatestRow[] = [];
  const pricedKeys = new Set<string>();

  const { data: queued, error: listErr } = await admin.rpc("advertised_price_crawl_queue", {
    _tenant_id: body.tenant_id ?? null,
    // Over-fetch so pricedKeys can tell a never-priced vehicle from one that is
    // simply below today's cut — a seed row must not be created for a VIN that
    // already has a snapshot.
    _limit: Math.max(limit * 4, 2000),
  });
  if (listErr) {
    return new Response(JSON.stringify({ error: listErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  type QueueRow = {
    id: string; tenant_id: string; store_id: string | null; vin: string;
    source_url: string | null; source_channel: string | null;
    advertised_price: number | null; captured_at: string | null;
  };
  // Retired listings leave the rotation. advertised_price_crawl_queue reads
  // only advertised_prices, so a car that left the dealer's feed kept its
  // place in the queue and kept spending renders on a page that no longer
  // exists. A single-VIN re-check is still honoured for a retired car: the
  // caller named it.
  const archivedKeys = new Set<string>();
  try {
    let archivedQuery = admin
      .from("vehicle_listings")
      .select("tenant_id, vin")
      .or("archived_at.not.is.null,status.eq.archived")
      .limit(5000);
    if (body.tenant_id) archivedQuery = archivedQuery.eq("tenant_id", body.tenant_id);
    const { data: archivedRows } = await archivedQuery;
    for (const a of (archivedRows || []) as Array<{ tenant_id: string; vin: string | null }>) {
      archivedKeys.add(a.tenant_id + "|" + (a.vin || "").toUpperCase());
    }
  } catch { /* an unreadable archive list must not stop the run; it only widens it */ }

  // The freshest address per vehicle. The queue hands out the url captured
  // with the last snapshot, which on 2026-10-27 was months old on every row
  // while the dealer's site had been rebuilt. The listing carries the feed's
  // current VDP url and scrape_source_url the one discovery last saw live.
  const listingUrls = new Map<string, { source_url: string | null; scrape_source_url: string | null }>();
  try {
    let urlQuery = admin.from("vehicle_listings")
      .select("tenant_id, vin, source_url, scrape_source_url")
      .is("archived_at", null).limit(5000);
    if (body.tenant_id) urlQuery = urlQuery.eq("tenant_id", body.tenant_id);
    const { data: urlRows } = await urlQuery;
    for (const l of (urlRows || []) as Array<{ tenant_id: string; vin: string | null; source_url: string | null; scrape_source_url: string | null }>) {
      listingUrls.set(l.tenant_id + "|" + (l.vin || "").toUpperCase(), { source_url: l.source_url, scrape_source_url: l.scrape_source_url });
    }
  } catch { /* without it the snapshot url is used, as before */ }

  // Recent "another vehicle / no vehicle" answers per VIN, with the url that
  // produced them. shouldBackoffMismatch rests a url only when it is the same
  // one; a refreshed address is tried at once.
  const mismatchLedger = new Map<string, { attempts: number; source_url: string | null; last_attempt_at: string | null }>();
  let mismatchBackoffSkipped = 0;
  try {
    let mq = admin.from("advertised_price_crawl_attempts")
      .select("tenant_id, vin, attempts, source_url, last_attempt_at")
      .in("outcome", ["vin_mismatch", "identity_unverified"])
      .gte("last_attempt_at", new Date(Date.now() - REJECTED_BACKOFF_MS).toISOString())
      .limit(5000);
    if (body.tenant_id) mq = mq.eq("tenant_id", body.tenant_id);
    const { data: mrows } = await mq;
    for (const r of (mrows || []) as Array<{ tenant_id: string; vin: string | null; attempts: number | null; source_url: string | null; last_attempt_at: string | null }>) {
      mismatchLedger.set(r.tenant_id + "|" + (r.vin || "").toUpperCase(), { attempts: Number(r.attempts || 0), source_url: r.source_url, last_attempt_at: r.last_attempt_at });
    }
  } catch { /* an unreadable ledger widens the run; it never stops it */ }
  const restingOnDeadUrl = async (tenantId: string, vin: string, url: string): Promise<boolean> => {
    if (targetVin || !url) return false;
    const led = mismatchLedger.get(tenantId + "|" + normVin(vin));
    if (!led) return false;
    const cfg = await getTenantScrapeSettings(tenantId);
    return shouldBackoffMismatch({
      attempts: led.attempts, ledgerUrl: led.source_url, candidateUrl: maybeNormalize(url, cfg.stripFinance),
      lastAttemptAt: led.last_attempt_at, now: Date.now(), windowMs: REJECTED_BACKOFF_MS, threshold: MISMATCH_BACKOFF_ATTEMPTS,
    });
  };

  const rejectedKeys = new Set<string>();
  let backoffSkipped = 0;
  const liftRejectedBackoff = platformCaller && body.ignore_rejected_backoff === true;
  try {
    if (!liftRejectedBackoff) {
      let rejectedQuery = admin
        .from("advertised_price_crawl_attempts")
        .select("tenant_id, vin")
        .eq("outcome", "price_rejected")
        .gte("last_attempt_at", new Date(Date.now() - REJECTED_BACKOFF_MS).toISOString())
        .limit(5000);
      if (body.tenant_id) rejectedQuery = rejectedQuery.eq("tenant_id", body.tenant_id);
      const { data: rejectedRows } = await rejectedQuery;
      for (const r of (rejectedRows || []) as Array<{ tenant_id: string; vin: string | null }>) {
        rejectedKeys.add(r.tenant_id + "|" + (r.vin || "").toUpperCase());
      }
    }
  } catch { /* an unreadable ledger widens the run; it never stops it */ }

  for (const q of (queued || []) as QueueRow[]) {
    const key = q.tenant_id + "|" + (q.vin || "").toUpperCase();
    if (!targetVin && archivedKeys.has(key)) continue;
    if (!targetVin && rejectedKeys.has(key)) { backoffSkipped++; continue; }
    pricedKeys.add(key);
    // Single-VIN re-scrape (Ready-for-Signatures verify) only touches that VIN.
    if (targetVin && (q.vin || "").toUpperCase() !== targetVin) continue;
    if (seen.has(key) || rows.length >= limit) continue;
    // Website rows take the freshest known address; a marketplace row keeps
    // its own, since the listing's url is the dealer's page, not that site's.
    const channel = observationChannel(q.source_channel);
    const known = channel === "website" ? listingUrls.get(key) : undefined;
    const pref = preferCrawlUrl({ snapshotUrl: q.source_url, listingUrl: known?.source_url, scrapeUrl: known?.scrape_source_url });
    const crawlUrl = pref.url || q.source_url || "";
    if (await restingOnDeadUrl(q.tenant_id, q.vin, crawlUrl)) { mismatchBackoffSkipped++; continue; }
    seen.add(key);
    rows.push({
      id: q.id, tenant_id: q.tenant_id, store_id: q.store_id || "", vin: q.vin,
      source_url: crawlUrl, source_label: observationChannel(q.source_channel),
      advertised_price: q.advertised_price ?? 0, snapshot_at: q.captured_at, url_source: pref.source,
    });
  }

  // Seed pass: synced vehicle_listings that carry a VDP source_url but have no
  // advertised_prices snapshot yet (MarketCheck delivered the car without a feed
  // price). Crawl the dealer's own VDP to capture a FIRST advertised price.
  //
  // Runs unconditionally, and seeds go to the FRONT. It used to be gated on
  // `rows.length < limit`, so once there were `limit` priced VINs a car that
  // had never been priced could never enter the queue at all — no snapshot, so
  // nothing to age, so no way in. A vehicle with no price at all is the most
  // urgent thing on the list, not the least.
  {
    let seedQuery = admin
      .from("vehicle_listings")
      .select("tenant_id, store_id, vin, source_url, scrape_source_url")
      .neq("source_url", "")
      .not("source_url", "is", null)
      .is("archived_at", null)
      .neq("status", "archived")
      .limit(2000);
    if (body.tenant_id) seedQuery = seedQuery.eq("tenant_id", body.tenant_id);
    const { data: seedRows } = await seedQuery;
    const seeds: LatestRow[] = [];
    for (const s of (seedRows || []) as Array<{ tenant_id: string; store_id: string | null; vin: string; source_url: string; scrape_source_url?: string | null }>) {
      const vin = (s.vin || "").toUpperCase();
      if (!vin || !s.source_url) continue;
      if (targetVin && vin !== targetVin) continue;
      const k = s.tenant_id + "|" + vin;
      if (pricedKeys.has(k) || seen.has(k)) continue;
      if (!targetVin && rejectedKeys.has(k)) { backoffSkipped++; continue; }
      const pref = preferCrawlUrl({ snapshotUrl: null, listingUrl: s.source_url, scrapeUrl: s.scrape_source_url });
      if (await restingOnDeadUrl(s.tenant_id, vin, pref.url)) { mismatchBackoffSkipped++; continue; }
      seen.add(k);
      seeds.push({
        id: "", tenant_id: s.tenant_id, store_id: s.store_id || "", vin: s.vin,
        source_url: pref.url, source_label: "website", advertised_price: 0,
        snapshot_at: null, seed: true, url_source: pref.source,
      });
    }
    rows.unshift(...seeds);
    if (rows.length > limit) rows.length = limit;
    // Discovery alone: learn the live addresses, price nothing this run.
    if (body.discover_only === true && !targetVin) rows.length = 0;
  }

  // A single-VIN re-scrape that matched nothing means the vehicle has no
  // address to crawl — no advertised_prices row carrying a source_url and no
  // source_url on the listing. Reported plainly: "picked 0" looked identical to
  // a successful no-op, which is how a car sits un-scraped for weeks while the
  // nightly run reports success.
  if (targetVin && rows.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      picked: 0,
      vin: targetVin,
      reason: "no_source_url",
      detail: "This VIN has no VDP url to crawl. Seed one from Admin > Price Integrity (\"Seed website URLs\"), or set vehicle_listings.source_url for it.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const queueDepth = pricedKeys.size + rows.filter((r) => r.seed).length;

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;
  let discovered = 0;
  // Discovery's own account of each seed page it read, and the live
  // addresses it recorded or confirmed on vehicle_listings.
  const discoveryReport: Array<Record<string, unknown>> = [];
  let discoveryRenders = 0;
  let urlsRecorded = 0;
  let urlsConfirmed = 0;
  let processed = 0;
  let ranOutOfTime = false;
  let evidenceRenders = 0;

  // Whether this row needs an evidence screenshot before we know its price:
  // the caller demanded one, this is the pre-signature single-VIN re-check
  // (which promises a timestamped picture), or no screenshot-backed
  // observation exists for this VIN on this channel yet. A price or fee change
  // found after parsing is the third trigger, decided below.
  const hasEvidenceScreenshot = async (tenantId: string, vin: string, channel: string): Promise<boolean> => {
    try {
      const { data, error } = await admin.from("advertised_prices")
        .select("id").eq("tenant_id", tenantId).eq("vin", normVin(vin)).eq("source_channel", channel)
        .not("screenshot_sha256", "is", null).limit(1);
      // A query that failed cannot prove there is no screenshot. The cheap
      // mistake is to skip one render; the expensive one is a render for
      // every VIN on the night the table is unreachable.
      if (error) return true;
      return (data?.length ?? 0) > 0;
    } catch { return true; }
  };
  const shouldCaptureEvidence = async (row: LatestRow): Promise<boolean> => {
    if (body.force_screenshot === true || targetVin) return true;
    return !(await hasEvidenceScreenshot(row.tenant_id, row.vin, observationChannel(row.source_label)));
  };

  for (const row of rows) {
    if (Date.now() - startedAt > RUN_BUDGET_MS - RENDER_HEADROOM_MS) { ranOutOfTime = true; break; }
    processed++;
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
      let cheapFinalUrl: string | null = null;
      try {
        const res = await fetch(fetchUrl, {
          method: "GET",
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(12000),
        });
        cheapStatus = res.status;
        cheapFinalUrl = res.url || null;
        const raw = res.ok ? await res.text() : "";
        html = (res.ok && !looksLikeChallenge(raw, res.headers, res.status)) ? raw : "";
      } catch { html = ""; }
      // Identity first, on every path: the page must be this vehicle's, and it
      // is read only with other vehicles' cards, related-vehicle sections and
      // description prose blanked out (vdpIdentity.ts, vdpPrice.ts).
      const listingCtx = await readListingContext(row.tenant_id, row.vin);
      let read: VehicleRead | null = html ? readVehiclePage(html, row.vin, fetchUrl, cheapFinalUrl, cfg, listingCtx?.ymm ?? null) : null;
      let result: VehiclePriceResult = read?.result ?? refusedResult("bot_challenge", fetchUrl);
      let pageFinalUrl: string | null = read ? cheapFinalUrl : null;

      // Escalate to Firecrawl when the cheap path is walled or empty — this is
      // what makes JS-rendered dealer sites + marketplaces return a real price.
      // Html only, unless this row is already known to need an evidence
      // screenshot, in which case the one render carries both: the screenshot
      // is then of the same page state the price is read from.
      let screenshot: CapturedScreenshot | null = null;
      let screenshotFromPriceRender = false;
      let renderSource: string | null = null;
      let renderStatus: number | null = null;
      let renderError: string | null = null;
      let pacedWaitMs = 0;
      let rateLimitRetries = 0;
      let renderFormats: RenderFormat[] | null = null;
      let evidenceDue = false;
      // Set when the html+screenshot bundle was refused and the price was
      // taken from a plain html retry instead. The second stage then does not
      // spend another render asking for the same refused picture.
      let evidenceRefused: { status: number | null; error: string | null } | null = null;
      let renderBudgetRefused = false;
      const cheapFailed = result.price == null && result.reason !== "vin_mismatch" && !result.gated;
      if (cheapFailed && renderBudget > 0) {
        renderBudget--;
        evidenceDue = await shouldCaptureEvidence(row);
        const renderGate: RenderBudget = { admin, tenantId: row.tenant_id, vin: row.vin, caller: "crawl-advertised-prices" };
        let pr = await pacedRender(fetchUrl, evidenceDue ? EVIDENCE_FORMATS : HTML_ONLY_FORMATS, deadlineAt, renderGate);
        renderBudgetRefused = pr.gaveUp === "budget_refused";
        pacedWaitMs += pr.pacedWaitMs;
        rateLimitRetries += pr.rateLimitRetries;
        // The price must never depend on the screenshot. When the bundle is
        // refused for any reason other than a rate limit (a 402 on the
        // screenshot format, a provider error), one plain html retry still
        // makes the observation; only the picture is lost, and the refusal
        // is recorded so the ledger shows why there is none.
        if (evidenceDue && pr.render && !pr.render.ok && pr.render.status !== 429 && pr.gaveUp == null && renderBudget > 0) {
          evidenceRefused = { status: pr.render.status, error: pr.render.error };
          evidenceDue = false;
          renderBudget--;
          pr = await pacedRender(fetchUrl, HTML_ONLY_FORMATS, deadlineAt, renderGate);
          pacedWaitMs += pr.pacedWaitMs;
          rateLimitRetries += pr.rateLimitRetries;
        }
        const r = pr.render;
        renderFormats = pr.formats;
        renderStatus = r?.status ?? null;
        renderError = r?.error ?? null;
        if (r?.ok) {
          renderSource = "firecrawl";
          if (evidenceDue) {
            // On render success, not parse success: a page we could not read
            // is exactly the one a person needs to look at. It becomes the
            // observation's evidence only if this same page passes identity.
            screenshot = await captureScreenshot(admin, r.screenshotUrl, row.tenant_id, row.vin);
            if (screenshot) { evidenceRenders++; screenshotFromPriceRender = true; }
          }
          if (r.html) {
            if (looksLikeChallenge(r.html, new Headers(), r.pageStatus ?? 200)) {
              result = refusedResult("bot_challenge", fetchUrl);
            } else {
              html = r.html;
              pageFinalUrl = r.finalUrl ?? null;
              read = readVehiclePage(r.html, row.vin, fetchUrl, pageFinalUrl, cfg, listingCtx?.ymm ?? null);
              result = read.result;
            }
          }
        }
      }
      const identity = result.identity;
      const pacing = {
        paced_wait_ms: pacedWaitMs,
        rate_limit_retries: rateLimitRetries,
        render_formats: renderFormats,
        renders_per_minute: RENDERS_PER_MINUTE,
        evidence_refused: evidenceRefused,
      };

      // Ledger every attempt, won or lost. advertised_prices records only
      // successes, so before this a total outage looked exactly like a quiet
      // market. Wrapped and best-effort — a ledger that can fail a price run
      // would be worse than no ledger.
      try {
        const cls = classifyCrawlOutcome({
          captured: result.price != null,
          reason: result.reason,
          cheapStatus,
          renderAttempted: renderStatus != null || renderError != null,
          renderStatus,
          renderError,
          renderConfigured: !!FIRECRAWL_KEY,
          renderBudgetRefused,
        });
        // The page's identity verdict, the document title and any recorded
        // finding (an embedded widget title, an unrecognised title) ride on
        // the ledger detail.
        const pageNote = identity.verdict !== "unchecked"
          ? `page=${identity.verdict}${identity.redirected ? " redirected" : ""}${identity.documentTitle ? ` title="${identity.documentTitle.slice(0, 60)}"` : ""}${identity.findings.length ? ` findings=${identity.findings.join(",")}` : ""} url_source=${row.url_source || "snapshot"}`
          : (row.url_source ? `url_source=${row.url_source}` : null);
        const pacingNote = renderFormats
          ? `[paced_wait_ms=${pacedWaitMs} rate_limit_retries=${rateLimitRetries} formats=${renderFormats.map((f) => typeof f === "string" ? f : f.type).join("+")}${evidenceRefused ? ` evidence_refused=${evidenceRefused.status ?? "err"}` : ""}]`
          : null;
        await admin.rpc("record_advertised_price_crawl_attempt", {
          _tenant_id: row.tenant_id,
          _vin: row.vin,
          _source_label: String(row.source_label || "website"),
          _source_url: fetchUrl,
          _outcome: cls.outcome,
          _http_status: cheapStatus,
          _render_status: renderStatus,
          _detail: [pacingNote, cls.detail, pageNote].filter(Boolean).join(" ") || null,
        });
      } catch { /* never fail a price run over telemetry */ }

      // Hero photo, stock number, history link and badges are read only from
      // a page that passed the identity check: before, a cheap fetch that
      // landed on another car's page could give this vehicle that car's
      // photo, report link or certification.
      if (identity.verdict === "vehicle") {
        // Capture the dealer's hero photo for the vehicle file — isolated so a
        // not-yet-migrated hero_image_url column can never affect price logic.
        try {
          const hero = extractHeroImage(html, fetchUrl);
          if (hero) {
            await admin.from("vehicle_listings").update({ hero_image_url: hero })
              .eq("tenant_id", row.tenant_id).eq("vin", row.vin).is("hero_image_url", null);
          }
        } catch { /* hero_image_url column may not be migrated yet */ }

        // The dealer's stock number, when their own page states one and our
        // record doesn't. Website channel only. Gap-fill only: the DMS number
        // on the syndication feed always wins over a scrape.
        try {
          if (String(row.source_label || "") === "website") {
            const stock = extractStockNumber(html, row.vin);
            if (stock) {
              await admin.from("vehicle_files").update({ stock_number: stock })
                .eq("tenant_id", row.tenant_id).eq("vin", row.vin)
                .or("stock_number.is.null,stock_number.eq.");
            }
          }
        } catch { /* stock number is a nicety — never fail a price run over it */ }

        // The dealer's own CARFAX/AutoCheck link and the certification,
        // one-owner and clean-title badges, website channel only, gap-fill
        // and positive-only (see detectCpoBadge, detectOneOwnerBadge,
        // detectCleanTitleBadge).
        try {
          if (String(row.source_label || "") === "website") {
            const link = extractHistoryReportLink(html, row.vin);
            if (link) {
              await admin.from("vehicle_listings").update({ history_report_url: link })
                .eq("tenant_id", row.tenant_id).eq("vin", row.vin).is("history_report_url", null);
            }
            // `program` stays unset: the page says certified, not which
            // program, and naming one we did not read would be fabrication.
            if (detectCpoBadge(html)) {
              const { data: curCert } = await admin.from("vehicle_listings")
                .select("certification").eq("tenant_id", row.tenant_id).eq("vin", row.vin).maybeSingle();
              const cert = (curCert?.certification ?? {}) as Record<string, unknown>;
              if (!cert.source) {
                await admin.from("vehicle_listings")
                  .update({ certification: { ...cert, certified: true, source: "dealer_vdp", verified_at: new Date().toISOString() } })
                  .eq("tenant_id", row.tenant_id).eq("vin", row.vin);
              }
            }
            // Gap-fill only: an absent value is a gap; a feed `false` is not.
            if (detectOneOwnerBadge(html)) {
              const { data: cur } = await admin.from("vehicle_listings")
                .select("mc_attributes").eq("tenant_id", row.tenant_id).eq("vin", row.vin).maybeSingle();
              const mc = (cur?.mc_attributes ?? {}) as Record<string, unknown>;
              if (mc.owner_count == null && mc.carfax_1_owner == null) {
                await admin.from("vehicle_listings")
                  .update({ mc_attributes: { ...mc, carfax_1_owner: true, one_owner_source: "dealer_vdp" } })
                  .eq("tenant_id", row.tenant_id).eq("vin", row.vin);
              }
            }
            // Positive-only: a feed `false`, or a title brand that is not
            // clean, contradicts the page and wins.
            if (detectCleanTitleBadge(html)) {
              const { data: curTitle } = await admin.from("vehicle_listings")
                .select("mc_attributes").eq("tenant_id", row.tenant_id).eq("vin", row.vin).maybeSingle();
              const mct = (curTitle?.mc_attributes ?? {}) as Record<string, unknown>;
              const brand = String(mct.title_brand ?? mct.title_status ?? "").trim();
              const contradicted = mct.carfax_clean_title === false
                || (brand !== "" && !/^(?:clean|clear|none|no\b)/i.test(brand));
              if (mct.carfax_clean_title !== true && !contradicted) {
                await admin.from("vehicle_listings")
                  .update({ mc_attributes: { ...mct, carfax_clean_title: true, clean_title_source: "dealer_vdp" } })
                  .eq("tenant_id", row.tenant_id).eq("vin", row.vin);
              }
            }
          }
        } catch { /* history_report_url column may not be migrated yet */ }
      }

      if (result.reason === "bot_challenge" && result.price == null) {
        skipped++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_skipped", entity_type: "advertised_price",
          entity_id: row.vin, store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, fetch_url: fetchUrl, http_status: cheapStatus, reason: "bot_challenge", rendered: !!renderSource, render_status: renderStatus, render_error: renderError, ...pacing, screenshot_path: screenshot?.path ?? null },
        }).then(() => undefined, () => undefined);
        continue;
      }
      // Another vehicle's page, no vehicle on the page, conflicting prices for
      // this vehicle, or "call for price": record the reason and write nothing.
      if (result.reason === "vin_mismatch" || result.reason === "identity_unverified" || result.reason === "ambiguous_price" || result.gated) {
        skipped++;
        // A discovered address that keeps answering with the wrong page is
        // dropped, so the queue falls back to the feed's url for this VIN.
        if ((result.reason === "vin_mismatch" || result.reason === "identity_unverified") && row.url_source === "scrape") {
          const led = mismatchLedger.get(row.tenant_id + "|" + normVin(row.vin));
          const prior = led && sameUrl(led.source_url, fetchUrl) ? led.attempts : 0;
          if (prior + 1 >= MISMATCH_BACKOFF_ATTEMPTS) {
            await admin.from("vehicle_listings").update({ scrape_source_url: null })
              .eq("tenant_id", row.tenant_id).eq("vin", row.vin).then(() => undefined, () => undefined);
          }
        }
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_skipped",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: {
            vin: row.vin, url: row.source_url, reason: result.reason, identity: identitySummary(identity),
            candidates: result.reason === "ambiguous_price" ? result.candidates.slice(0, 12) : undefined,
            screenshot_path: screenshot?.path ?? null,
          },
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
            ...pacing,
            // A failed parse still leaves a picture a person can read.
            screenshot_path: screenshot?.path ?? null,
            screenshot_sha256: screenshot?.sha256 ?? null,
            msrp: result.msrp,
            candidates: result.candidates.slice(0, 12),
          },
        }).then(() => undefined, () => undefined);
        continue;
      }

      // ── Fee basis: four parts kept apart (feeBasis.ts) ─────────────────
      // The figure and label as read; the dealership's configured
      // interpretation; what the page itself shows about the fee (the
      // vehicle's widget, or the text around the figure); and the values
      // derived from one of them, with the basis named. Only a page-verified
      // basis may change the listing.
      const stack = read?.stack ?? null;
      const scoped = result.scopedHtml;
      const widget = stack?.widgetRange ?? null;
      const texts = widget
        ? { section: visibleText(scoped.slice(widget[0], widget[1])), rest: visibleText(scoped.slice(0, widget[0]) + " " + scoped.slice(widget[1])) }
        : (() => { const t = visibleText(scoped); const s = sectionAround(t, newPrice); return { section: s.section, rest: s.rest }; })();
      const websiteTerm = cleanWebsitePriceTerm(result.matched_label);
      const basis = decideFeeBasis({
        observed: { amount: newPrice, label: websiteTerm, source: result.source, section: result.section },
        settings: cfg.settings,
        pageUrl: fetchUrl,
        listingCondition: listingCtx?.condition ?? null,
        sectionText: texts.section,
        pageText: texts.rest,
        stack,
        feed: { price: listingCtx?.feedPrice ?? null, includesFees: listingCtx?.feedIncludesFees ?? null },
      });
      // Every component of the vehicle's own widget is appended to the
      // evidence ledger, whether or not anything is written.
      if (stack && (stack.lines.length || stack.disclaimers.length)) {
        try {
          const records = await buildEvidenceRecords(scoped, stack, {
            tenantId: row.tenant_id, vin: row.vin, sourceUrl: fetchUrl, capturedAt: new Date().toISOString(),
            screenshotSha256: screenshotFromPriceRender ? screenshot?.sha256 ?? null : null,
          });
          await admin.from("price_component_evidence").upsert(records, { onConflict: "record_sha256", ignoreDuplicates: true })
            .then(() => undefined, () => undefined);
        } catch { /* the evidence table may not be migrated yet */ }
      }

      // FTC-critical guard: the advertised price must never land ABOVE the
      // dealer's own feed price; above it the extractor read a sticker, MSRP
      // or lease figure (priceGuard.ts, aware of how old the feed is). On a
      // mis-parse nothing is stored and the listing is left alone.
      const feedSeenAt = parseFeedTimestamp(listingCtx?.feedLastSeen) ?? parseFeedTimestamp(listingCtx?.feedScraped)
        ?? await lastFeedSuccessAt(row.tenant_id);
      const guardFigure = basis.derived?.advertised_price_before_doc ?? newPrice;
      const guard = judgeAboveFeed({
        scraped: guardFigure, feedPrice: listingCtx?.feedPrice ?? null, feedMsrp: listingCtx?.feedMsrp ?? null,
        feedAgeMs: feedSeenAt != null ? Date.now() - feedSeenAt : null, freshMs: FEED_FRESH_MS,
      });
      if (guard.misparse) {
        skipped++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_skipped", entity_type: "advertised_price",
          entity_id: row.vin, store_id: row.tenant_id,
          details: {
            vin: row.vin, reason: "advertised_above_feed", scraped: guardFigure, observed: newPrice, feed: listingCtx?.feedPrice ?? null, url: fetchUrl,
            guard_reason: guard.reason, feed_msrp: listingCtx?.feedMsrp ?? null, feed_stale: guard.feedStale,
            feed_age_days: feedSeenAt != null ? Math.round((Date.now() - feedSeenAt) / 86_400_000) : null,
            fee_basis_status: basis.status,
            screenshot_path: screenshot?.path ?? null,
          },
        }).then(() => undefined, () => undefined);
        try {
          await admin.rpc("record_advertised_price_crawl_attempt", {
            _tenant_id: row.tenant_id, _vin: row.vin, _source_label: observationChannel(row.source_label),
            _source_url: fetchUrl, _outcome: "price_rejected", _http_status: cheapStatus, _render_status: renderStatus,
            _detail: `advertised_above_feed scraped=${guardFigure} feed=${listingCtx?.feedPrice ?? null} reason=${guard.reason}${guard.feedStale ? " feed_stale" : ""}`,
          });
        } catch { /* never fail a price run over telemetry */ }
        continue;
      }
      if (guard.feedStale) basis.reasons.push(guard.note);
      // A figure at the feed's MSRP reads as the sticker unless the page's own
      // stack or fee statement says otherwise. It never promotes then anyway;
      // the finding is recorded so a reviewer sees it.
      if (listingCtx?.feedMsrp && newPrice >= listingCtx.feedMsrp * 0.995 && basis.status !== "page_verified") {
        basis.reasons.push(`the observed figure ${newPrice} is at or above the feed MSRP ${listingCtx.feedMsrp}`);
      }

      // ── Evidence ──────────────────────────────────────────────────────
      // The screenshot counts as evidence when it is of the very render the
      // price was read from, or of a second render that independently shows
      // the same vehicle, address, figure and label (crawlCommit.ts).
      const priceChanged = Math.abs(newPrice - row.advertised_price) >= 1;
      const pricing = listingCtx?.pricing ?? null;
      const differs = (a: unknown, b: unknown) => (a == null) !== (b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) >= 1);
      const listingWouldChange = !!basis.derived && (!pricing
        || differs(pricing.advertised_price_before_doc, basis.derived.advertised_price_before_doc)
        || differs(pricing.doc_fee, basis.derived.doc_fee)
        || differs(pricing.website_sale_price, basis.derived.website_sale_price));
      let evidence: EvidenceDecision = screenshotFromPriceRender && screenshot
        ? { status: "same_render", reason: null }
        : { status: "not_captured", reason: evidenceRefused ? `the renderer refused the screenshot (${evidenceRefused.status ?? evidenceRefused.error ?? "error"})` : null };
      let evidenceShot: CapturedScreenshot | null = evidence.status === "same_render" ? screenshot : null;
      // A listing change wants evidence only when it could actually be
      // applied: a held fee basis never promotes, so it spends no render.
      const wantEvidence = priceChanged || (basis.promote && listingWouldChange) || evidenceDue || (!cheapFailed && await shouldCaptureEvidence(row));
      if (!evidenceShot && !evidenceRefused && renderBudget > 0 && wantEvidence) {
        renderBudget--;
        const ev = await pacedRender(fetchUrl, EVIDENCE_FORMATS, deadlineAt,
          { admin, tenantId: row.tenant_id, vin: row.vin, caller: "crawl-advertised-prices:evidence" });
        pacedWaitMs += ev.pacedWaitMs;
        rateLimitRetries += ev.rateLimitRetries;
        if (ev.render?.ok && ev.render.html) {
          const second = looksLikeChallenge(ev.render.html, new Headers(), ev.render.pageStatus ?? 200)
            ? null
            : readVehiclePage(ev.render.html, row.vin, fetchUrl, ev.render.finalUrl ?? null, cfg, listingCtx?.ymm ?? null).result;
          evidence = revalidateEvidence(result, pageFinalUrl, second, ev.render.finalUrl ?? null);
          if (evidence.status === "revalidated_render") {
            evidenceShot = await captureScreenshot(admin, ev.render.screenshotUrl, row.tenant_id, row.vin);
            if (evidenceShot) evidenceRenders++;
            else evidence = { status: "not_captured", reason: "the evidence screenshot could not be stored" };
          }
        } else {
          evidence = { status: "not_captured", reason: ev.gaveUp ? `the evidence render gave up (${ev.gaveUp})` : `the evidence render failed (${ev.render?.status ?? ev.render?.error ?? "no response"})` };
        }
        await admin.from("audit_log").insert({
          action: "advertised_price_evidence_render",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: {
            vin: row.vin, fetch_url: fetchUrl,
            trigger: priceChanged ? "price_changed" : listingWouldChange ? "components_changed" : evidenceDue ? "no_prior_screenshot_or_forced" : "no_prior_screenshot",
            render_status: ev.render?.status ?? null, render_error: ev.render?.error ?? null,
            paced_wait_ms: ev.pacedWaitMs, rate_limit_retries: ev.rateLimitRetries, gave_up: ev.gaveUp,
            render_formats: ev.formats, renders_per_minute: RENDERS_PER_MINUTE,
            evidence_status: evidence.status, evidence_reason: evidence.reason,
            screenshot_path: evidenceShot?.path ?? null,
          },
        }).then(() => undefined, () => undefined);
      } else if (!evidenceShot && evidence.reason == null) {
        evidence = { status: "not_captured", reason: renderBudget <= 0 ? "no render budget left for evidence" : "no evidence render was needed" };
      }
      const evidenceOk = !!evidenceShot && (evidence.status === "same_render" || evidence.status === "revalidated_render");

      // ── Store, then promote ───────────────────────────────────────────
      // The observation (with its fee basis record, identity and evidence) is
      // stored first. The listing changes only after that, only on a
      // page-verified basis with accepted evidence, and only if its pricing
      // did not move meanwhile. An unchanged price is still an observation:
      // the work queue is ordered by the latest captured_at.
      const promote = basis.promote && (evidenceOk || !listingWouldChange);
      const holdAs = !basis.promote ? "held_fee_basis" as const : !promote ? "held_evidence" as const : null;
      const holdDetail = holdAs === "held_fee_basis"
        ? `${basis.status}: ${basis.reasons.join("; ")}`.slice(0, 500)
        : holdAs === "held_evidence" ? (evidence.reason ?? "no accepted evidence") : null;
      const baseRow: Record<string, unknown> = {
        tenant_id: row.tenant_id,
        store_id: row.store_id || "",
        vin: row.vin,
        source_url: fetchUrl,
        source_channel: observationChannel(row.source_label),
        // We fetched the dealer's page and read this number off it: a
        // different act from the feed reporting a price.
        captured_method: "dealer_vdp_observation",
        advertised_price: newPrice,
        captured_by: null,
        screenshot_url: evidenceShot?.path ?? null,
        screenshot_sha256: evidenceShot?.sha256 ?? null,
        screenshot_bucket: evidenceShot?.bucket ?? PRICE_EVIDENCE_BUCKET,
        notes: (row.seed
          ? `First crawl (${result.source})${websiteTerm ? ` · ${websiteTerm}` : ""} · $${newPrice.toLocaleString()}`
          : priceChanged
            ? `${renderSource ? "Rendered" : "Nightly"} crawl (${result.source}) · previous $${row.advertised_price.toLocaleString()} → $${newPrice.toLocaleString()}`
            : `${renderSource ? "Rendered" : "Nightly"} crawl (${result.source}) · unchanged $${newPrice.toLocaleString()}`)
          + ` · fee basis ${basis.status}`,
      };
      const observation = {
        run_id: runId,
        fee_basis: basis,
        identity: identitySummary(identity),
        extraction: { source: result.source, section: result.section, matched_label: result.matched_label, candidates: result.candidates.slice(0, 12) },
        evidence: { status: evidence.status, reason: evidence.reason, screenshot_sha256: evidenceShot?.sha256 ?? null, screenshot_path: evidenceShot?.path ?? null },
      };
      const key = await observationKey({
        tenantId: row.tenant_id, vin: row.vin, url: `${runId}|${fetchUrl}`, amount: newPrice, label: websiteTerm,
        basisStatus: basis.status, derived: basis.derived, screenshotSha256: evidenceShot?.sha256 ?? null,
        pageSha256: await sha256Text(texts.section || visibleText(scoped)),
      });
      const patch: Record<string, unknown> = basis.derived ? {
        advertised_price_before_doc: basis.derived.advertised_price_before_doc,
        doc_fee: basis.derived.doc_fee,
        website_sale_price: basis.derived.website_sale_price,
        ...(basis.derivedFrom === "stack" ? { retail_cash: basis.derived.retail_cash ?? null, dealer_discount: basis.derived.dealer_discount ?? null } : {}),
        price_source_url: fetchUrl,
        price_parse_status: "ok",
        price_parse_notes: `Fee basis verified by the page (${basis.derivedFrom}): ${basis.reasons.join("; ")}`.slice(0, 500),
        price_last_verified_at: new Date().toISOString(),
        ...(websiteTerm ? { website_price_term: websiteTerm } : {}),
      } : {};
      const commit = await commitObservation(commitDb, {
        tenantId: row.tenant_id, vin: row.vin, key,
        row: { ...baseRow, observation }, legacyRow: baseRow,
        promote, holdAs, holdDetail, patch,
      });
      listingOutcomes[commit.outcome] = (listingOutcomes[commit.outcome] ?? 0) + 1;
      await admin.from("audit_log").insert({
        action: "advertised_price_observation_committed", entity_type: "advertised_price",
        entity_id: row.vin, store_id: row.tenant_id,
        details: {
          vin: row.vin, url: fetchUrl, outcome: commit.outcome, detail: commit.detail, observation_id: commit.observationId,
          fee_basis_status: basis.status, derived_from: basis.derivedFrom, evidence_status: evidence.status,
          identity_findings: identity.findings,
        },
      }).then(() => undefined, () => undefined);
      if (commit.outcome === "observation_failed") {
        failed++;
        await admin.from("audit_log").insert({
          action: "advertised_price_crawl_error",
          entity_type: "advertised_price",
          entity_id: row.vin,
          store_id: row.tenant_id,
          details: { vin: row.vin, url: row.source_url, fetch_url: fetchUrl, reason: "insert_failed", error: commit.detail, extracted_price: newPrice },
        }).then(() => undefined, () => undefined);
        continue;
      }
      // Held and failed promotions are named in the attempt ledger, so a
      // vehicle whose price was read but not applied never reads "captured".
      if (commit.outcome !== "promoted" && commit.outcome !== "unchanged" && commit.outcome !== "duplicate") {
        try {
          await admin.rpc("record_advertised_price_crawl_attempt", {
            _tenant_id: row.tenant_id, _vin: row.vin, _source_label: observationChannel(row.source_label),
            _source_url: fetchUrl, _outcome: commit.outcome, _http_status: cheapStatus, _render_status: renderStatus,
            _detail: commit.detail,
          });
        } catch { /* never fail a price run over telemetry */ }
      }
      if (priceChanged) updated++; else unchanged++;
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
    const seedOverride = platformCaller && Array.isArray(body.discover_seed_urls)
      ? body.discover_seed_urls.filter((u): u is string => typeof u === "string" && isUrlSafe(u)).slice(0, 8)
      : [];
    const capAsked = Number(body.discover_render_cap);
    const discoveryRenderCap = platformCaller && Number.isFinite(capAsked)
      ? Math.max(0, Math.min(6, Math.floor(capAsked)))
      : DISCOVERY_RENDER_CAP_DEFAULT;
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
      // Platform callers may point discovery at explicit pages of the
      // dealer's site (a diagnostic, or a site whose inventory pages moved).
      if (seedOverride.length && body.tenant_id === tenantId) {
        channelSources.length = 0;
        for (const u of seedOverride) addSrc("website", u, false);
      }
      if (channelSources.length === 0) continue;

      const { data: listings } = await admin.from("vehicle_listings")
        .select("vin, source_url, scrape_source_url").eq("tenant_id", tenantId);
      const knownVins = new Set((listings || []).map((l: { vin: string | null }) => (l.vin || "").toUpperCase()));
      const knownUrls = new Map<string, { source_url: string | null; scrape_source_url: string | null }>();
      for (const l of (listings || []) as Array<{ vin: string | null; source_url: string | null; scrape_source_url: string | null }>) {
        knownUrls.set((l.vin || "").toUpperCase(), { source_url: l.source_url, scrape_source_url: l.scrape_source_url });
      }
      if (knownVins.size === 0) continue;
      const seedSeen = new Set<string>();

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
          if (seedSeen.has(src)) continue;
          seedSeen.add(src);
          const seedReport: Record<string, unknown> = {
            channel, url: src, direct_status: null, rendered: false, render_status: null, final_url: null, challenge: false, urls_found: 0,
          };
          let txt = "";
          try {
            const r = await fetch(src, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
            seedReport.direct_status = r.status;
            const raw = r.ok ? await r.text() : "";
            if (r.ok && !looksLikeChallenge(raw, r.headers, r.status)) txt = raw;
            else if (r.ok) seedReport.challenge = true;
          } catch { /* the render below is the fallback */ }
          // The dealer's site has refused the plain fetch since 2026-10-11.
          // Its listing pages and sitemap are rendered instead, a few per run,
          // so discovery can still learn the live VDP addresses.
          if (!txt && channel === "website" && discoveryRenders < discoveryRenderCap && renderBudget > 0
              && Date.now() + RENDER_HEADROOM_MS < deadlineAt) {
            discoveryRenders++;
            renderBudget--;
            const pr = await pacedRender(src, HTML_ONLY_FORMATS, deadlineAt,
              { admin, tenantId, caller: "crawl-advertised-prices:discovery" });
            seedReport.budget_refused = pr.gaveUp === "budget_refused";
            const fr = pr.render;
            seedReport.rendered = !!fr?.ok;
            seedReport.render_status = fr?.status ?? null;
            seedReport.final_url = fr?.finalUrl ?? null;
            if (fr?.ok && fr.html) {
              if (looksLikeChallenge(fr.html, new Headers(), fr.pageStatus ?? 200)) seedReport.challenge = true;
              else txt = fr.html;
            }
          }
          if (txt) {
            const before = vdpUrls.size;
            discoverVdpUrls(txt, originOf(src) || "").forEach((u) => vdpUrls.add(u));
            seedReport.urls_found = vdpUrls.size - before;
          }
          discoveryReport.push(seedReport);
        }

        // Record the live address of every known vehicle before any pricing
        // attempt, so the nightly crawl, which can render, stops visiting the
        // snapshot's stale url. Website channel only: a marketplace url is
        // that marketplace's page, not the dealer's.
        if (channel === "website") {
          for (const vdp of vdpUrls) {
            const vin = vinFromUrl(vdp);
            if (!vin || !knownVins.has(vin)) continue;
            const cur = knownUrls.get(vin);
            if (cur && (sameUrl(cur.scrape_source_url, vdp) || sameUrl(cur.source_url, vdp))) { urlsConfirmed++; continue; }
            try {
              const { error } = await admin.from("vehicle_listings").update({ scrape_source_url: vdp })
                .eq("tenant_id", tenantId).eq("vin", vin);
              if (!error) { urlsRecorded++; knownUrls.set(vin, { source_url: cur?.source_url ?? null, scrape_source_url: vdp }); }
            } catch { /* best-effort */ }
          }
        }
        if (body.discover_only === true) continue;

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
            // Same identity check and scoping as the nightly pass. Discovery
            // stores an observation only; it never has evidence, so it never
            // changes a listing.
            const result = readVehiclePage(html, vin, fetchVdp, r.url || null, cfg, null).result;
            if (result.gated || result.price == null) { crawledThisTenant++; continue; }
            const k = `${vin}|${channel}`;
            const prev = latestByVinChannel.get(k);
            if (prev != null && Math.abs(result.price - prev) < 1) { crawledThisTenant++; continue; }
            // captured_by is a user id; discovery is not a person.
            const discoveryRow: Record<string, unknown> = {
              tenant_id: tenantId, store_id: "", vin, source_url: vdp, source_channel: channel,
              advertised_price: result.price, captured_by: null, captured_method: "dealer_vdp_observation",
              notes: `Discovered on ${channel} (${result.source})${prev != null ? ` · was $${prev.toLocaleString()}` : ""}`,
            };
            const { error: discErr } = await admin.from("advertised_prices").insert({
              ...discoveryRow,
              observation: { run_id: runId, identity: identitySummary(result.identity), extraction: { source: result.source, section: result.section, matched_label: result.matched_label }, evidence: { status: "not_captured", reason: "discovery takes no screenshot" } },
              listing_promotion: "held_evidence", listing_promotion_detail: "discovery observation without evidence",
            });
            if (discErr) await commitDb.insertLegacyObservation(discoveryRow);
            latestByVinChannel.set(k, result.price);
            discovered++;
            crawledThisTenant++;
          } catch { crawledThisTenant++; }
        }
      }
    }
  }

  // ── Chain the remainder ────────────────────────────────────────────
  // The rows this link did not reach keep their old captured_at, so the next
  // link's queue read puts them first. `limit` shrinks by what was processed,
  // so a chain never visits more than the caller asked for. Single-VIN and
  // test-button calls never chain.
  const remaining = Math.max(rows.length - processed, 0);
  let nextLink: Record<string, unknown> | null = null;
  if (ranOutOfTime && remaining > 0 && !targetVin && !body.test_url && depth < MAX_CHAIN_DEPTH && supabaseUrl && serviceKey) {
    const nextBody = { ...body, depth: depth + 1, limit: remaining };
    nextLink = { depth: depth + 1, limit: remaining, status: "fired" };
    try {
      // The next link answers only when it is done, minutes from now; a short
      // wait here confirms the request left, nothing more.
      await fetch(`${supabaseUrl}/functions/v1/crawl-advertised-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(nextBody),
        signal: AbortSignal.timeout(3000),
      });
    } catch (e) {
      const msg = String(e);
      if (!/abort|timeout/i.test(msg)) nextLink = { depth: depth + 1, limit: remaining, status: `failed: ${msg.slice(0, 160)}` };
    }
  } else if (ranOutOfTime && remaining > 0) {
    nextLink = { depth: depth + 1, limit: remaining, status: depth >= MAX_CHAIN_DEPTH ? "max_depth_reached" : "not_chained" };
  }

  const renderPacing = {
    renders_per_minute: RENDERS_PER_MINUTE,
    render_budget: renderBudgetStart,
    render_budget_left: renderBudget,
    evidence_renders: evidenceRenders,
    render_key: renderKeyReport,
    ...pacer.snapshot(),
  };

  // The cron's response can be lost to the gateway; the run summary is
  // written where it can always be read.
  await admin.from("audit_log").insert({
    action: "advertised_price_crawl_run",
    entity_type: "advertised_price",
    entity_id: body.tenant_id || "all",
    store_id: body.tenant_id || null,
    details: {
      depth, picked: rows.length, processed, queue_depth: queueDepth, unvisited: Math.max(queueDepth - processed, 0),
      ran_out_of_time: ranOutOfTime, updated, unchanged, failed, skipped, discovered,
      listing_outcomes: listingOutcomes, run_id: runId,
      backoff_skipped: backoffSkipped, mismatch_backoff_skipped: mismatchBackoffSkipped,
      urls_recorded: urlsRecorded, urls_confirmed: urlsConfirmed, discovery_renders: discoveryRenders, discovery: discoveryReport,
      elapsed_ms: Date.now() - startedAt, render_pacing: renderPacing, next_link: nextLink,
    },
  }).then(() => undefined, () => undefined);

  return new Response(JSON.stringify({
    ok: true,
    depth,
    next_link: nextLink,
    picked: rows.length,
    processed,
    // Coverage, stated plainly. "picked 500, updated 40" never said whether the
    // other vehicles were fine or simply never looked at.
    queue_depth: queueDepth,
    unvisited: Math.max(queueDepth - processed, 0),
    ran_out_of_time: ranOutOfTime,
    updated,
    unchanged,
    failed,
    skipped,
    discovered,
    // What each stored observation did to its listing: promoted, unchanged,
    // held (fee basis, evidence, schema) or failed (promotion, conflict).
    listing_outcomes: listingOutcomes,
    // Vehicles left alone because the guard refused their page price inside
    // the backoff window.
    backoff_skipped: backoffSkipped,
    // Vehicles whose url keeps answering with another page, resting until
    // the window passes or discovery records a new address.
    mismatch_backoff_skipped: mismatchBackoffSkipped,
    rejected_backoff_lifted: liftRejectedBackoff,
    // Discovery: live addresses written to vehicle_listings.scrape_source_url,
    // addresses already current, renders spent, and each seed page's outcome.
    urls_recorded: urlsRecorded,
    urls_confirmed: urlsConfirmed,
    discovery_renders: discoveryRenders,
    discovery: discoveryReport,
    // What the renderer was allowed to do and how it was held back, so a
    // canary run can prove pacing from the response alone.
    render_pacing: renderPacing,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
