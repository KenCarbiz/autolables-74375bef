// The advertised price of ONE vehicle, read from that vehicle's part of its
// dealer page, for the advertised-price crawler.
//
// Every path is identity-checked first (vdpIdentity.ts): the page must be
// this vehicle's, and reading happens only on the page with other vehicles'
// cards, related-vehicle sections and the dealer's description prose blanked
// out. When the vehicle's own pricing widget is known (priceStack.ts), labelled
// prices are read inside that widget first.
//
// A figure is accepted only when it is unambiguous: every candidate of the
// winning tier must name the same amount. The old reader took the first
// "Selling Price" in the page text, or the lowest of equally scored
// candidates, which is how a similar-vehicle card could set a vehicle's price.

import { pageIdentity, type PageIdentity, type VehicleScope, normVin } from "./vdpIdentity.ts";

export interface PriceCandidate { value: number; label: string; source: string }

export type PriceSource = "jsonld" | "og_meta" | "dom_label" | "none";

export interface VehiclePriceResult {
  price: number | null;
  source: PriceSource;
  gated: boolean;
  /**
   * null when a price was read. Otherwise vin_mismatch (another vehicle's
   * page), identity_unverified (no vehicle on the page), ambiguous_price,
   * implausible_vs_msrp, unlabeled_price_only, price_gated or
   * no_price_extracted.
   */
  reason: string | null;
  msrp: number | null;
  candidates: PriceCandidate[];
  matched_label: string | null;
  /** Where the figure was read: the vehicle's pricing widget or the scoped page. */
  section: "widget" | "page" | null;
  identity: PageIdentity;
  /** The page as read: other vehicles, related sections and description blanked. */
  scopedHtml: string;
}

export const norm = (raw: unknown): number | null => {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/[,$\s ]/g, "").replace(/usd/i, ""));
  return Number.isFinite(n) ? n : null;
};
export const sane = (n: number | null): n is number => n != null && n >= 1000 && n <= 500000;

// Generic selling-price labels appended after each dealer's configured labels.
// These are advertised-price brands (never MSRP/retail).
export const DEFAULT_PRICE_LABELS = [
  "Your Price", "Sale Price", "Selling Price", "Internet Price",
  "Special Price", "E-Price", "ePrice", "Deal Price", "Our Price",
];

const REJECT_PRICE_TYPES = ["msrp", "listprice", "invoiceprice", "strikethroughprice", "regularprice"];
const MSRP_PRICE_TYPES = ["msrp", "listprice", "regularprice", "strikethroughprice"];
// deno-lint-ignore no-explicit-any
const priceTypeOf = (o: any): string =>
  String(o?.priceType || o?.priceSpecification?.priceType || "")
    .toLowerCase().replace(/.*\//, "").replace(/[^a-z]/g, "");

// A VDP's description block is the dealer's (often our own syndicated) prose.
// It talks about money ("the original window sticker lists $56,945") and must
// never be read as a price.
const DESCRIPTION_BLOCK_RE = new RegExp(
  String.raw`<(div|section|article|p)\b[^>]*(?:class|id)=["'][^"']*\b` +
    String.raw`(?:vehicle-description|vdp-description|inventory-description|` +
    String.raw`description-(?:text|content|body|section)|vehicle-comments?|seller-comments?)` +
    String.raw`\b[^"']*["'][^>]*>[\s\S]{0,20000}?</\1>`,
  "gi",
);
export const stripDescriptionBlocks = (html: string): string =>
  html.replace(DESCRIPTION_BLOCK_RE, (m) => " ".repeat(m.length));

export const visibleText = (html: string): string =>
  html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ").replace(/&amp;/gi, "&").replace(/&#36;|&dollar;/gi, "$")
    .replace(/\s+/g, " ").toLowerCase();

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const distinct = (values: number[]): number[] => values.reduce<number[]>((acc, v) => (acc.some((x) => near(x, v)) ? acc : [...acc, v]), []);

export interface ExtractInput {
  targetVin: string | null | undefined;
  requestedUrl: string;
  finalUrl?: string | null;
  /** Dealer-configured labels first, then DEFAULT_PRICE_LABELS. */
  labels?: string[];
  ymm?: string | null;
  /** The vehicle's own pricing widget, as priceStack.ts located it. */
  widgetRange?: [number, number] | null;
  scope?: VehicleScope;
}

type Tier = Omit<VehiclePriceResult, "identity" | "scopedHtml" | "section">;

function readJsonLd(html: string, target: string | null): { prices: number[]; msrp: number | null; candidates: PriceCandidate[] } {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  // deno-lint-ignore no-explicit-any
  const nodes: any[] = [];
  for (const block of blocks) {
    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try { parsed = JSON.parse(block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim()); } catch { continue; }
    // deno-lint-ignore no-explicit-any
    const push = (x: any) => { if (x && typeof x === "object") nodes.push(x); };
    // deno-lint-ignore no-explicit-any
    (Array.isArray(parsed) ? parsed : [parsed]).forEach((p: any) => { push(p); if (Array.isArray(p?.["@graph"])) p["@graph"].forEach(push); });
  }
  const offerNodes = nodes.filter((n) => n?.offers);
  const anyOtherVin = offerNodes.some((n) => { const v = normVin(n?.vehicleIdentificationNumber); return !!v && v !== target; });
  // A node is this vehicle's when it names this VIN, or, naming none, it is
  // the page's only offer and no offer on the page names another vehicle.
  const mine = offerNodes.filter((n) => {
    const v = normVin(n?.vehicleIdentificationNumber);
    if (v) return v === target;
    return offerNodes.length === 1 && !anyOtherVin;
  });
  const prices: number[] = [];
  const candidates: PriceCandidate[] = [];
  let msrp: number | null = null;
  for (const node of mine) {
    const list = Array.isArray(node.offers) ? node.offers : [node.offers];
    for (const o of list) {
      const cur = String(o?.priceCurrency || "USD").toUpperCase();
      if (cur && cur !== "USD") continue;
      const pt = priceTypeOf(o);
      if (o?.["@type"] === "AggregateOffer" || o?.lowPrice != null) {
        const lp = norm(o?.lowPrice);
        if (sane(lp)) { candidates.push({ value: lp, label: "AggregateOffer.lowPrice", source: "jsonld" }); prices.push(lp); }
        const hp = norm(o?.highPrice);
        if (sane(hp) && msrp == null) msrp = hp;
        continue;
      }
      const p = norm(o?.price);
      if (MSRP_PRICE_TYPES.includes(pt)) { if (sane(p) && msrp == null) msrp = p; continue; }
      if (REJECT_PRICE_TYPES.includes(pt)) continue;
      if (sane(p)) { candidates.push({ value: p, label: `Offer.price${pt ? ` [${pt}]` : ""}`, source: "jsonld" }); prices.push(p); }
    }
  }
  return { prices, msrp, candidates };
}

function readLabelled(text: string, labels: string[]): { value: number | null; label: string | null; values: number[]; candidates: PriceCandidate[] } {
  for (const raw of labels) {
    const lbl = raw.trim().toLowerCase();
    if (!lbl) continue;
    const esc = lbl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}[^$]{0,80}\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d{4,6})(?:\\.\\d{2})?`, "gi");
    const found = [...text.matchAll(re)].map((m) => norm(m[1])).filter(sane);
    if (!found.length) continue;
    const values = distinct(found);
    const candidates = found.map((v) => ({ value: v, label: `label:${lbl}`, source: "dom_label" }));
    return { value: values.length === 1 ? values[0] : null, label: lbl, values, candidates };
  }
  return { value: null, label: null, values: [], candidates: [] };
}

const GATE = ["call for price", "please call", "contact us for price", "unlock price", "click for price", "sign in to see price"];
const MONTHLY = ["/mo", "per month", "mo.", "lease", " apr", "due at signing", "est. payment", "for 24", "for 36", "for 48", "for 60", "for 72", "for 84"];
const GOOD = ["internet price", "sale price", "final price", "your price", "e-price", "eprice", "selling price", "special price"];
const BAD = ["msrp", "retail", " was ", "original", "list price", "sticker", "as built",
  "down payment", "down ", "savings", "save $", "you save", "off msrp", "rebate",
  "discount", "incentive", "trade-in", "cash back", " bonus", "due at", "deposit"];

function readTiers(scoped: string, original: string, target: string | null, labels: string[], widgetText: string | null): Tier & { section: "widget" | "page" | null } {
  const candidates: PriceCandidate[] = [];
  // JSON-LD names its own vehicle per node, so it is judged on the whole page:
  // removing another vehicle's block would make an offer without a VIN look
  // like the page's only one.
  const ld = readJsonLd(original, target);
  let msrp = ld.msrp;
  candidates.push(...ld.candidates);
  const plausible = (v: number) => !(msrp != null && v < msrp * 0.3);
  const ok = (price: number, source: PriceSource, label: string | null, section: "widget" | "page"): Tier & { section: "widget" | "page" } =>
    plausible(price)
      ? { price, source, gated: false, reason: null, msrp, candidates, matched_label: label, section }
      : { price: null, source: "none", gated: false, reason: "implausible_vs_msrp", msrp, candidates, matched_label: label, section };
  const ambiguous = (section: "widget" | "page", label: string | null): Tier & { section: "widget" | "page" } =>
    ({ price: null, source: "none", gated: false, reason: "ambiguous_price", msrp, candidates, matched_label: label, section });

  // Inside the vehicle's own pricing widget, its labels decide.
  if (widgetText) {
    const w = readLabelled(widgetText, labels);
    candidates.push(...w.candidates);
    if (w.values.length > 1) return ambiguous("widget", w.label);
    if (w.value != null) return ok(w.value, "dom_label", w.label, "widget");
  }

  const ldValues = distinct(ld.prices);
  if (ldValues.length > 1) return ambiguous("page", "jsonld");
  if (ldValues.length === 1) return ok(ldValues[0], "jsonld", null, "page");

  const curMeta = scoped.match(/<meta[^>]+(?:og:price:currency|product:price:currency)[^>]+content=["']([^"']+)["']/i);
  if (!curMeta || curMeta[1].toUpperCase() === "USD") {
    const metas = [...scoped.matchAll(/<meta[^>]+(?:og:price:amount|product:price:amount)[^>]+content=["']([^"']+)["']/gi)].map((m) => norm(m[1])).filter(sane);
    const mv = distinct(metas);
    for (const v of metas) candidates.push({ value: v, label: "og:price:amount", source: "og_meta" });
    if (mv.length > 1) return ambiguous("page", "og:price:amount");
    if (mv.length === 1) return ok(mv[0], "og_meta", null, "page");
  }

  const text = visibleText(scoped);
  const lab = readLabelled(text, labels);
  candidates.push(...lab.candidates);
  if (lab.values.length > 1) return ambiguous("page", lab.label);
  if (lab.value != null) return ok(lab.value, "dom_label", lab.label, "page");

  // Generic scoring: the best-labelled figure, but only when every figure with
  // that best label agrees.
  const moneyRe = /([a-z .,'-]{0,40})\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d{2})?/g;
  let bestScore = -1;
  let best: { value: number; label: string }[] = [];
  for (const mm of text.matchAll(moneyRe)) {
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
    if (s > bestScore) { bestScore = s; best = [{ value: val, label: ctx.trim() }]; } else if (s === bestScore) best.push({ value: val, label: ctx.trim() });
  }
  if (best.length) {
    if (bestScore === 0 && msrp == null) return { price: null, source: "none", gated: false, reason: "unlabeled_price_only", msrp, candidates, matched_label: null, section: "page" };
    const values = distinct(best.map((b) => b.value));
    if (values.length > 1) return ambiguous("page", best[0].label || null);
    return ok(values[0], "dom_label", best[0].label || null, "page");
  }
  if (GATE.some((g) => text.includes(g))) return { price: null, source: "none", gated: true, reason: "price_gated", msrp, candidates, matched_label: null, section: null };
  return { price: null, source: "none", gated: false, reason: "no_price_extracted", msrp, candidates, matched_label: null, section: null };
}

export function extractVehiclePrice(html: string, input: ExtractInput): VehiclePriceResult {
  const labels = [...(input.labels ?? []), ...DEFAULT_PRICE_LABELS]
    .filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i);
  const id = pageIdentity({ html, targetVin: input.targetVin, requestedUrl: input.requestedUrl, finalUrl: input.finalUrl, ymm: input.ymm }, input.scope);
  const { scope, ...identity } = id;
  const scopedHtml = stripDescriptionBlocks(scope?.html ?? html);
  const refused = (reason: string): VehiclePriceResult => ({
    price: null, source: "none", gated: false, reason, msrp: null, candidates: [], matched_label: null, section: null, identity, scopedHtml,
  });
  if (identity.verdict === "other_vehicle") return refused("vin_mismatch");
  if (identity.verdict === "no_vehicle") return refused("identity_unverified");
  const target = input.targetVin ? normVin(input.targetVin) : null;
  const widgetText = input.widgetRange ? visibleText(scopedHtml.slice(input.widgetRange[0], input.widgetRange[1])) : null;
  const t = readTiers(scopedHtml, html, target, labels, widgetText);
  return { ...t, identity, scopedHtml };
}

// The label the dealer's page printed beside the figure, cleaned for display
// ("SALE PRICE:" -> "Sale Price"). null when it is not a sensible term.
export const cleanWebsitePriceTerm = (raw: string | null | undefined): string | null => {
  const s = String(raw ?? "").replace(/^label:/, "").replace(/[:\s]+$/, "").replace(/\s+/g, " ").trim();
  if (!s || !/[A-Za-z]/.test(s) || /^\$?[\d,.]+$/.test(s)) return null;
  return s.split(" ").map((w) =>
    /[A-Z]/.test(w) && w === w.toUpperCase() && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ").slice(0, 24).trim();
};

// The result for a page that was never read (no html, a challenge page).
export function refusedResult(reason: string, requestedUrl: string): VehiclePriceResult {
  return {
    price: null, source: "none", gated: false, reason, msrp: null, candidates: [], matched_label: null, section: null,
    identity: {
      verdict: "unchecked", reason: `the page was not read (${requestedUrl})`, targetOnPage: false, targetInScope: false, otherVins: [],
      redirected: false, finalUrl: null, finalUrlVin: null, canonicalVin: null, documentTitle: null, embeddedTitles: [], findings: [],
      removedSections: 0,
    },
    scopedHtml: "",
  };
}
