// Source-evidenced price-component model for a dealer vehicle page, used by
// crawl-advertised-prices.
//
// A dealer page can carry several prices for one vehicle, each a stage of one
// calculation:
//
//   MSRP                       $116,750
//   Dealer Discount             -$3,000
//   <Dealer> Price             $113,750   dealer price, before incentives and fee
//   Retail Cash                -$10,000   manufacturer incentive
//   Conveyance Fee                +$895
//   Your Price                 $104,645   dealer's advertised customer total
//
// This reader:
//  - attributes each stack to the page component that contains it (the element
//    tree), never to whichever VIN is nearest in the text;
//  - names every line by role and proves the arithmetic;
//  - classifies every incentive on ITS OWN evidence (eligibility, restrictions,
//    combinability, effective and expiration dates). A label, a generic page
//    statement, or arithmetic that closes is never proof that every shopper
//    qualifies; only a verified program record can say that;
//  - keeps page-wide disclaimers apart from the vehicle's own widget;
//  - derives the generally available customer total (the public price) and a
//    fee-exclusive market-comparison basis that never include an unverified
//    incentive.
// Anything it cannot establish is left unresolved or held for review.

import { ancestorsOf, contains, deepestAt, parseTree, type El } from "./htmlTree.ts";

export type LineRole = "msrp" | "discount" | "dealer_price" | "incentive" | "fee" | "final_price" | "unknown";

export interface StackLine {
  label: string;
  /** Footnote marker printed with the label ("*", "1", "†"), if any. */
  marker: string | null;
  role: LineRole;
  amount: number;
  printedSign: -1 | 0 | 1;
  index: number;
}

export type Eligibility = "verified_general" | "stated_general_unverified" | "conditional" | "unknown";
export type Restriction =
  | "financing_required" | "lease_only" | "purchase_only" | "credit_approval" | "loyalty" | "conquest"
  | "military" | "college" | "first_responder" | "trade_in_required" | "residency";

export interface OfferEvidence {
  source: "widget_line" | "widget_footnote" | "program_record";
  text: string;
}

export interface Incentive {
  name: string;
  amount: number;
  eligibility: Eligibility;
  restrictions: Restriction[];
  combinability: "exclusive" | "combinable" | "unknown";
  effectiveDate: string | null;
  expirationDate: string | null;
  /** Null when no expiration is known. */
  expired: boolean | null;
  evidence: OfferEvidence[];
}

/** A verified offer record from an authoritative source (OEM program data or a
 *  dealer-approved program entry), the only thing that can establish general
 *  availability. Supplied by the caller; never inferred from the page. */
export interface ProgramRecord {
  name: string;
  amount: number;
  generallyAvailable: boolean;
  restrictions?: Restriction[];
  combinableWith?: string[] | "all" | "none";
  effectiveDate?: string | null;
  expirationDate?: string | null;
  source: string;
}

export interface Disclaimer {
  scope: "widget" | "page";
  text: string;
  says: "fee_excluded" | "fee_included" | "incentive_conditional" | "incentive_general" | "other";
}

export type StackStatus =
  | "reconciled"
  | "no_stack"
  | "vin_not_found"
  | "ambiguous_vin_scope"
  | "unreconciled"
  | "unknown_line"
  | "missing_final_price"
  | "fee_amount_mismatch";

export type ReviewFlag =
  | "incentive_eligibility_unverified"
  | "incentive_conditional"
  | "incentive_expired"
  | "incentives_mutually_exclusive"
  | "disclaimer_contradicts_widget_fee"
  | "widget_disclaimer_contradicts_widget_fee"
  | "duplicate_widgets_consistent";

export interface PriceStackResult {
  status: StackStatus;
  /** Reconciled and nothing held for review. */
  writable: boolean;
  flags: ReviewFlag[];
  lines: StackLine[];
  /** The dealer's advertised customer total ("Your Price") as printed. */
  advertisedTotal: { amount: number; label: string } | null;
  dealerPrice: { amount: number; label: string } | null;
  msrp: number | null;
  discounts: { label: string; amount: number }[];
  incentives: Incentive[];
  fee: { label: string; amount: number; includedIn: string } | null;
  /** Dealer price + fee - verified, unexpired, combinable incentives only. */
  generallyAvailableTotal: number | null;
  /** Fee-exclusive: dealer price - verified incentives. Never the advertised total. */
  marketComparisonBasis: number | null;
  disclaimers: Disclaimer[];
  proof: string[];
  reason: string | null;
  /** Byte range of the widget in the page, for the evidence hash. */
  widgetRange: [number, number] | null;
}

export interface PriceStackConfig {
  dealerPriceLabels?: string[];
  finalPriceLabels?: string[];
  configuredFee: number;
  /** When the page was captured; decides whether an offer has expired. */
  observedAt?: Date;
  /** The page address; a VDP names its own vehicle in it. */
  pageUrl?: string;
  programRecords?: ProgramRecord[];
}

const TOL = 1;
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const looksLikeVin = (s: string) => /\d/.test(s) && /[A-Z]/i.test(s);

const DEFAULT_DEALER_PRICE = ["dealer price", "sale price", "selling price", "internet price", "special price", "e-price", "our price"];
const DEFAULT_FINAL_PRICE = ["your price", "final price", "total price", "price after incentives", "net price"];
const MSRP_RE = /\b(?:msrp|total msrp|window sticker)\b/i;
const DISCOUNT_RE = /\b(?:discount|savings|dealer adjustment)\b/i;
const INCENTIVE_RE = /\b(?:rebate|incentive|loyalty|conquest|military|college|first responder|trade[- ]in assistance|cash allowance|cash(?!\s*price))\b/i;
const FEE_RE = /\b(?:conveyance|doc(?:ument(?:ation)?)?|dealer|processing|administrative|admin)\s+fees?\b/i;

const RESTRICTION_PATTERNS: [Restriction, RegExp][] = [
  ["financing_required", /\b(?:must finance|finance through|financed through|financing through|requires financing|financing required|financial services|when financ\w*|finance cash|apr cash|with (?:\w+ )?financing)\b/i],
  ["lease_only", /\b(?:lease cash|when leas\w*|lease through|on (?:a )?lease|lessees?)\b/i],
  ["purchase_only", /\b(?:cash purchase only|purchase only|not available (?:on|with) lease)\b/i],
  ["credit_approval", /\b(?:approved credit|credit approval|well[- ]qualified|tier \d)\b/i],
  ["loyalty", /\b(?:loyalty|current owners?|returning (?:owners?|customers?))\b/i],
  ["conquest", /\bconquest\b/i],
  ["military", /\bmilitary\b/i],
  ["college", /\b(?:college|recent grad\w*)\b/i],
  ["first_responder", /\bfirst responders?\b/i],
  ["trade_in_required", /\b(?:trade[- ]in required|with (?:a |qualifying )?trade)\b/i],
  ["residency", /\b(?:residents? of|must reside)\b/i],
];
const GENERAL_RE = /\b(?:available to all (?:buyers|customers|shoppers)|no qualification(?:s)? required|applies to (?:all|every) (?:buyers?|customers?|purchases?))\b/i;
const EXCLUSIVE_RE = /\b(?:cannot be combined|can ?not be combined|not combinable|may not be combined|not compatible with|in lieu of|not stackable)\b/i;
const COMBINABLE_RE = /\b(?:can be combined|combinable with|stackable with)\b/i;

const money = (s: string) => Number(s.replace(/,/g, ""));
const BLOCK_TAG = /<\/?(?:div|p|li|ul|ol|tr|td|th|dt|dd|dl|br|h[1-6]|section|article|table|tbody|header|footer|aside|main|nav)\b[^>]*>/gi;
export const stripTags = (h: string) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BLOCK_TAG, " | ").replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#8722;|&minus;/gi, "-").replace(/&dagger;/gi, "†").replace(/&sup(\d);/gi, "$1").replace(/\s+/g, " ").trim();

const MARK = String.raw`([*†‡§¹²³⁴-⁹]{1,3}|\(\d\)|\[\d\])?`;
const AMT = String.raw`([+\-−–])?\s*\$\s?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{2})?`;
const LABEL = String.raw`([A-Za-z][A-Za-z0-9 .&'/-]{0,40}?)`;
const LINE_SEG = new RegExp(String.raw`^${LABEL}\s*${MARK}\s*:?\s*${AMT}$`);
const LABEL_SEG = new RegExp(String.raw`^${LABEL}\s*${MARK}\s*:?$`);
const AMOUNT_SEG = new RegExp(String.raw`^${AMT}$`);
const segmentsOf = (text: string) => text.split("|").map((s) => s.trim()).filter(Boolean);
const shortLabel = (s: string) => s.trim().split(/\s+/).length <= 6;
const normMarker = (m: string | undefined | null) => {
  if (!m) return null;
  const sup: Record<string, string> = { "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  return m.replace(/[()[\]]/g, "").split("").map((c) => sup[c] ?? c).join("");
};

export function classifyLabel(label: string, cfg: Pick<PriceStackConfig, "dealerPriceLabels" | "finalPriceLabels">): LineRole {
  const l = label.toLowerCase().trim();
  const has = (list: string[]) => list.some((x) => new RegExp(`\\b${esc(x.toLowerCase())}\\b`).test(l));
  if (has(cfg.finalPriceLabels ?? [])) return "final_price";
  if (has(cfg.dealerPriceLabels ?? [])) return "dealer_price";
  if (FEE_RE.test(l)) return "fee";
  if (INCENTIVE_RE.test(l)) return "incentive";
  if (DISCOUNT_RE.test(l)) return "discount";
  if (MSRP_RE.test(l)) return "msrp";
  if (has(DEFAULT_FINAL_PRICE)) return "final_price";
  if (has(DEFAULT_DEALER_PRICE)) return "dealer_price";
  return "unknown";
}

// Lines and prose of one widget's text. A price line is a short label (with an
// optional footnote marker) and one amount, in one block or a label block
// followed by an amount block; everything else is prose.
export function splitLines(text: string, cfg: PriceStackConfig): { lines: StackLine[]; prose: string[] } {
  const segs = segmentsOf(text);
  const lines: StackLine[] = [];
  const prose: string[] = [];
  const push = (label: string, marker: string | undefined, sign: string | undefined, amt: string) => {
    const l = label.replace(/\s+/g, " ").trim();
    lines.push({ label: l, marker: normMarker(marker), role: classifyLabel(l, cfg), amount: money(amt), printedSign: (sign ? (sign === "+" ? 1 : -1) : 0) as -1 | 0 | 1, index: lines.length });
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const line = s.match(LINE_SEG);
    if (line && shortLabel(line[1])) { push(line[1], line[2], line[3], line[4]); continue; }
    const lab = s.match(LABEL_SEG);
    const next = segs[i + 1]?.match(AMOUNT_SEG);
    if (lab && next && shortLabel(lab[1])) { push(lab[1], lab[2], next[1], next[2]); i++; continue; }
    prose.push(s);
  }
  return { lines, prose };
}

const sentences = (t: string) => t.replace(/\|/g, " ").split(/(?<=[.!?])\s+(?=[A-Z*†‡§¹²³\d(\[])/).map((s) => s.trim()).filter((s) => s.length > 8);

export function readDisclaimers(text: string, scope: Disclaimer["scope"]): Disclaimer[] {
  const out: Disclaimer[] = [];
  for (const s of sentences(text)) {
    const clip = s.slice(0, 280);
    if (FEE_RE.test(s)) {
      if (/\b(?:exclud\w*|not includ\w*|does not include|plus|additional|extra)\b/i.test(s)) { out.push({ scope, text: clip, says: "fee_excluded" }); continue; }
      if (/\b(?:includ\w*|inclusive)\b/i.test(s) && !/\bnot\b/i.test(s)) { out.push({ scope, text: clip, says: "fee_included" }); continue; }
    }
    if (INCENTIVE_RE.test(s) || /\b(?:offers?|rebates?)\b/i.test(s)) {
      if (GENERAL_RE.test(s)) out.push({ scope, text: clip, says: "incentive_general" });
      else if (RESTRICTION_PATTERNS.some(([, re]) => re.test(s)) || /\b(?:qualif\w*|eligib\w*|restrictions apply)\b/i.test(s)) out.push({ scope, text: clip, says: "incentive_conditional" });
    }
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function parseDate(s: string): string | null {
  let m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
const EXPIRES_RE = /\b(?:expires?|expiration|ends?|through|thru|valid (?:through|until)|until|exp\.)\s*(?:on\s*)?:?\s*([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const EFFECTIVE_RE = /\b(?:starting|starts|from|effective|begins?|valid from)\s*(?:on\s*)?:?\s*([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;

// The evidence that belongs to ONE incentive: its own line, and footnotes that
// carry its marker or name it. A footnote that names no offer and carries no
// marker is page context, not this offer's terms.
function offerEvidence(line: StackLine, footnotes: string[]): OfferEvidence[] {
  const ev: OfferEvidence[] = [{ source: "widget_line", text: `${line.label}${line.marker ?? ""} -$${line.amount}` }];
  const name = line.label.toLowerCase();
  for (const f of footnotes) {
    const lead = normMarker(f.match(/^\s*([*†‡§¹²³⁴-⁹]{1,3}|\(\d\)|\[\d\]|\d(?=\s))/)?.[1]);
    const byMarker = line.marker != null && lead === line.marker;
    const byName = f.toLowerCase().includes(name);
    if (byMarker || byName) ev.push({ source: "widget_footnote", text: f.slice(0, 280) });
  }
  return ev;
}

function classifyIncentive(line: StackLine, footnotes: string[], cfg: PriceStackConfig): Incentive {
  const evidence = offerEvidence(line, footnotes);
  const terms = evidence.filter((e) => e.source === "widget_footnote").map((e) => e.text).join(" ");
  const all = `${line.label} ${terms}`;
  const restrictions = RESTRICTION_PATTERNS.filter(([, re]) => re.test(all)).map(([r]) => r);
  const record = (cfg.programRecords ?? []).find((p) => p.name.toLowerCase() === line.label.toLowerCase() && near(p.amount, line.amount));
  if (record) evidence.push({ source: "program_record", text: `${record.source}: ${record.name} ${record.amount}${record.generallyAvailable ? " (generally available)" : ""}` });
  const expirationDate = record?.expirationDate ?? parseDate(terms.match(EXPIRES_RE)?.[1] ?? "");
  const effectiveDate = record?.effectiveDate ?? parseDate(terms.match(EFFECTIVE_RE)?.[1] ?? "");
  const day = (cfg.observedAt ?? new Date()).toISOString().slice(0, 10);
  const expired = expirationDate ? expirationDate < day : null;
  const allRestrictions = [...new Set([...restrictions, ...(record?.restrictions ?? [])])];
  const combinability: Incentive["combinability"] = record?.combinableWith === "none" ? "exclusive"
    : record?.combinableWith ? "combinable"
    : EXCLUSIVE_RE.test(terms) ? "exclusive" : COMBINABLE_RE.test(terms) ? "combinable" : "unknown";
  let eligibility: Eligibility = "unknown";
  if (allRestrictions.length) eligibility = "conditional";
  else if (record?.generallyAvailable) eligibility = "verified_general";
  else if (GENERAL_RE.test(terms)) eligibility = "stated_general_unverified";
  return {
    name: line.label, amount: line.amount, eligibility, restrictions: allRestrictions, combinability,
    effectiveDate, expirationDate, expired, evidence,
  };
}

// ── Component attribution ─────────────────────────────────────────────────

/** `el` holds the price lines; `scope` is el plus its immediate container
 *  when that container is the widget's own (its footnotes live there). */
interface Widget { el: El; scope: El; text: string; lines: StackLine[]; prose: string[] }

const STAGE_ROLES = new Set<LineRole>(["msrp", "dealer_price", "final_price"]);

// Every element whose own text forms a stack: at least one stage line and a
// customer total or a dealer price, the smallest such element per stack.
function findWidgets(html: string, root: El, cfg: PriceStackConfig): Widget[] {
  const cands: Widget[] = [];
  const visit = (el: El) => {
    if (el.tag === "script" || el.tag === "style") return;
    for (const c of el.children) visit(c);
    if (el === root) return;
    if (cands.some((w) => contains(el, w.el))) return;
    const text = stripTags(html.slice(el.start, el.end));
    if (!/\$\s?\d/.test(text)) return;
    const { lines, prose } = splitLines(text, cfg);
    const stages = lines.filter((l) => STAGE_ROLES.has(l.role));
    if (lines.length >= 2 && stages.length >= 1 && lines.some((l) => l.role === "final_price" || l.role === "dealer_price")) {
      cands.push({ el, scope: el, text, lines, prose });
    }
  };
  visit(root);
  // A widget's footnote usually sits beside the line list, in the same small
  // container. Take that container when it holds no other widget and is not
  // much more than the widget itself.
  for (const w of cands) {
    const p = w.el.parent;
    if (!p || p === root || cands.some((o) => o !== w && contains(p, o.el))) continue;
    const pText = stripTags(html.slice(p.start, p.end));
    const namesAVehicle = (pText.match(VIN_RE) ?? []).some(looksLikeVin);
    if (pText.length > Math.max(600, 3 * w.text.length) || namesAVehicle) continue;
    w.scope = p;
    w.prose = splitLines(pText, cfg).prose;
  }
  return cands;
}

interface VinMark { vin: string; at: number }

function vinMarks(html: string): VinMark[] {
  return [...html.matchAll(VIN_RE)].filter((m) => looksLikeVin(m[0])).map((m) => ({ vin: m[0].toUpperCase(), at: m.index ?? 0 }));
}

// Owner of a widget: walk up from the widget to the first element that
// mentions any VIN. One VIN there owns it. Several: VINs that already own a
// widget of their own inside that element are set aside; one left owns it.
// None at all: the page address names the vehicle of a detail page.
function assignOwners(widgets: Widget[], marks: VinMark[], urlVin: string | null): Map<Widget, string | "ambiguous" | null> {
  const owners = new Map<Widget, string | "ambiguous" | null>();
  const vinsIn = (el: El) => new Set(marks.filter((m) => el.start <= m.at && m.at < el.end).map((m) => m.vin));
  const firstWithVins = (w: Widget) => ancestorsOf(w.el).find((a) => vinsIn(a).size > 0) ?? null;
  for (const w of widgets) {
    const a = firstWithVins(w);
    const v = a ? vinsIn(a) : new Set<string>();
    owners.set(w, v.size === 1 ? [...v][0] : null);
  }
  for (const w of widgets) {
    if (owners.get(w) != null) continue;
    const a = firstWithVins(w);
    if (!a || a.tag === "#root" && vinsIn(a).size === 0) { owners.set(w, urlVin); continue; }
    const claimed = new Set(widgets.filter((o) => o !== w && contains(a, o.el) && typeof owners.get(o) === "string" && owners.get(o) !== "ambiguous").map((o) => owners.get(o) as string));
    const left = [...vinsIn(a)].filter((v) => !claimed.has(v));
    if (left.length === 1) owners.set(w, left[0]);
    else if (left.length === 0 && urlVin && !claimed.has(urlVin)) owners.set(w, urlVin);
    else owners.set(w, "ambiguous");
  }
  return owners;
}

const signature = (lines: StackLine[]) => lines.map((l) => `${l.role}:${l.amount}`).join(",");

const empty = (status: StackStatus, reason: string, extra: Partial<PriceStackResult> = {}): PriceStackResult => ({
  status, writable: false, flags: [], lines: [], advertisedTotal: null, dealerPrice: null, msrp: null, discounts: [],
  incentives: [], fee: null, generallyAvailableTotal: null, marketComparisonBasis: null, disclaimers: [], proof: [],
  reason, widgetRange: null, ...extra,
});

export function readPriceStack(html: string, vin: string, cfg: PriceStackConfig): PriceStackResult {
  const target = vin.toUpperCase();
  const root = parseTree(html);
  const marks = vinMarks(html);
  const urlVin = (cfg.pageUrl?.toUpperCase().match(VIN_RE) ?? []).find(looksLikeVin) ?? null;
  if (!marks.some((m) => m.vin === target) && urlVin !== target) return empty("vin_not_found", "the VIN is not on the page");

  const widgets = findWidgets(html, root, cfg);
  const owners = assignOwners(widgets, marks, urlVin);
  const mine = widgets.filter((w) => owners.get(w) === target);
  const contested = widgets.filter((w) => owners.get(w) === "ambiguous");
  const flags: ReviewFlag[] = [];

  // Page text outside every vehicle widget: the general disclaimers.
  const pageText = (() => {
    let t = html;
    for (const w of [...widgets].sort((a, b) => b.scope.start - a.scope.start)) t = t.slice(0, w.scope.start) + " | " + t.slice(w.scope.end);
    return stripTags(t);
  })();
  const pageDisclaimers = readDisclaimers(pageText, "page");

  if (!mine.length) {
    if (contested.length) return empty("ambiguous_vin_scope", "a price stack on the page could not be attributed to one vehicle", { disclaimers: pageDisclaimers });
    return empty("no_stack", "no price stack belongs to this VIN", { disclaimers: pageDisclaimers });
  }
  // The same widget is often rendered twice (mobile and desktop). Identical
  // copies are one stack; copies that differ cannot both be the price.
  const sigs = new Set(mine.map((w) => signature(w.lines)));
  if (sigs.size > 1) return empty("ambiguous_vin_scope", "this VIN has differing price stacks on the page", { disclaimers: pageDisclaimers });
  if (mine.length > 1) flags.push("duplicate_widgets_consistent");
  const w = mine[0];
  const lines = w.lines;
  // A footnote is a block of the widget's prose, split only where a new
  // marker begins, so an offer's terms and its dates stay together.
  const footnotes = w.prose.flatMap((b) => b.split(/(?<=[.!?])\s+(?=[*†‡§¹²³⁴-⁹]|\(\d\)|\[\d\])/)).map((s) => s.trim()).filter(Boolean);
  const disclaimers = [...readDisclaimers(w.prose.join(" | "), "widget"), ...pageDisclaimers];
  const base = { lines, disclaimers, widgetRange: [w.scope.start, w.scope.end] as [number, number] };

  const unknown = lines.filter((l) => l.role === "unknown");
  if (unknown.length) return empty("unknown_line", `unrecognised line(s): ${unknown.map((l) => l.label).join(", ")}`, base);
  const of = (role: LineRole) => lines.filter((l) => l.role === role);
  const [msrpLines, dealerLines, finalLines, feeLines] = [of("msrp"), of("dealer_price"), of("final_price"), of("fee")];
  const discountLines = of("discount"), incentiveLines = of("incentive");
  if (msrpLines.length > 1 || dealerLines.length > 1 || finalLines.length > 1 || feeLines.length > 1) {
    return empty("unreconciled", "a stage appears more than once in the widget", base);
  }
  const msrp = msrpLines[0]?.amount ?? null;
  const dealer = dealerLines[0] ?? null;
  const final = finalLines[0] ?? null;
  const feeLine = feeLines[0] ?? null;
  const discounts = discountLines.map((l) => ({ label: l.label, amount: l.amount }));
  const proof: string[] = [];
  if (feeLine && cfg.configuredFee > 0 && !near(feeLine.amount, cfg.configuredFee)) {
    return empty("fee_amount_mismatch", `widget fee ${feeLine.amount} != configured ${cfg.configuredFee}`, base);
  }
  if ([...discountLines, ...incentiveLines].some((l) => l.printedSign === 1) || (feeLine && feeLine.printedSign === -1)) {
    return empty("unreconciled", "a line's printed sign contradicts its role", base);
  }
  const sumDisc = discounts.reduce((a, d) => a + d.amount, 0);
  const sumInc = incentiveLines.reduce((a, l) => a + l.amount, 0);
  const fee = feeLine?.amount ?? 0;
  if (msrp != null && dealer) {
    if (!near(msrp - sumDisc, dealer.amount)) return empty("unreconciled", `MSRP ${msrp} - discounts ${sumDisc} != ${dealer.label} ${dealer.amount}`, base);
    proof.push(`MSRP ${msrp} - discounts ${sumDisc} = ${dealer.label} ${dealer.amount}`);
  }
  if (!final) return empty("missing_final_price", "no customer-total line in the widget", { ...base, proof });
  const start = dealer?.amount ?? (msrp != null ? msrp - sumDisc : null);
  if (start == null) return empty("unreconciled", "no dealer price or MSRP to start the stack from", { ...base, proof });
  if (!near(start - sumInc + fee, final.amount)) {
    return empty("unreconciled", `${start} - incentives ${sumInc} + fee ${fee} != ${final.label} ${final.amount}`, { ...base, proof });
  }
  proof.push(`${dealer?.label ?? "MSRP - discounts"} ${start} - incentives ${sumInc} + fee ${fee} = ${final.label} ${final.amount}`);
  if (feeLine && !(feeLine.index < final.index && (!dealer || dealer.index < feeLine.index))) {
    return empty("unreconciled", "the fee line is not between the dealer price and the customer total", { ...base, proof });
  }

  // Arithmetic proves only that the lines add up. Each offer is judged on
  // its own evidence.
  const incentives = incentiveLines.map((l) => classifyIncentive(l, footnotes, cfg));
  if (incentives.some((x) => x.eligibility === "unknown" || x.eligibility === "stated_general_unverified")) flags.push("incentive_eligibility_unverified");
  if (incentives.some((x) => x.eligibility === "conditional")) flags.push("incentive_conditional");
  if (incentives.some((x) => x.expired === true)) flags.push("incentive_expired");
  if (incentives.length > 1 && incentives.some((x) => x.combinability === "exclusive")) flags.push("incentives_mutually_exclusive");
  if (feeLine) {
    if (pageDisclaimers.some((d) => d.says === "fee_excluded")) flags.push("disclaimer_contradicts_widget_fee");
    if (disclaimers.some((d) => d.scope === "widget" && d.says === "fee_excluded")) flags.push("widget_disclaimer_contradicts_widget_fee");
  }

  const verified = incentives.filter((x) => x.eligibility === "verified_general" && x.expired !== true
    && (x.combinability !== "exclusive" || incentives.length === 1));
  const verifiedSum = verified.reduce((a, x) => a + x.amount, 0);
  const dealerStage = start;
  const holds = flags.filter((f) => f !== "duplicate_widgets_consistent");
  return {
    status: "reconciled",
    writable: holds.length === 0,
    flags,
    lines,
    advertisedTotal: { amount: final.amount, label: final.label },
    dealerPrice: dealer ? { amount: dealer.amount, label: dealer.label } : null,
    msrp,
    discounts,
    incentives,
    fee: feeLine ? { label: feeLine.label, amount: feeLine.amount, includedIn: final.label } : null,
    generallyAvailableTotal: dealerStage - verifiedSum + fee,
    marketComparisonBasis: dealerStage - verifiedSum,
    disclaimers,
    proof,
    reason: null,
    widgetRange: base.widgetRange,
  };
}

// ── Public price policy ───────────────────────────────────────────────────

export interface PublicPriceDecision {
  /** May the platform publish a price for this vehicle without review? */
  publishable: boolean;
  /** The primary advertised price: the generally available, all-in total. */
  primary: { amount: number; label: string; includesFee: true } | null;
  /** Offers shown only separately, with qualifications, after dealer approval. */
  conditionalOffers: { name: string; amount: number; priceWithOffer: number; qualifications: string[]; expires: string | null }[];
  /** The dealer's own advertised total, when it differs from the primary. */
  dealerAdvertisedTotal: { amount: number; label: string } | null;
  /** Fee-exclusive basis for market comparison and price-fairness scoring. */
  marketComparisonBasis: number | null;
  /** Scores built on this price must say confidence is limited. */
  scoreConfidence: "normal" | "limited" | "none";
  reasons: string[];
}

export function publicPriceDecision(r: PriceStackResult): PublicPriceDecision {
  if (r.status !== "reconciled" || r.generallyAvailableTotal == null) {
    return { publishable: false, primary: null, conditionalOffers: [], dealerAdvertisedTotal: null, marketComparisonBasis: null, scoreConfidence: "none", reasons: [r.reason ?? r.status] };
  }
  const reasons: string[] = [];
  const unverified = r.incentives.filter((x) => x.eligibility !== "verified_general");
  for (const x of unverified) reasons.push(`${x.name} ${x.amount}: ${x.eligibility.replace(/_/g, " ")}${x.expired ? ", expired" : ""}`);
  if (r.flags.includes("disclaimer_contradicts_widget_fee") || r.flags.includes("widget_disclaimer_contradicts_widget_fee")) {
    reasons.push("the dealer's fee disclaimer contradicts the itemised fee; dealer disclosure needs correction");
  }
  if (r.flags.includes("incentives_mutually_exclusive")) reasons.push("offers that cannot be combined are applied together");
  const differs = r.advertisedTotal && !near(r.advertisedTotal.amount, r.generallyAvailableTotal);
  if (differs) reasons.push(`dealer advertises ${r.advertisedTotal!.label} ${r.advertisedTotal!.amount}, which applies offers not verified as generally available`);
  return {
    publishable: r.writable,
    primary: { amount: r.generallyAvailableTotal, label: "Price", includesFee: true },
    conditionalOffers: r.incentives.filter((x) => x.eligibility !== "verified_general" && x.expired !== true).map((x) => ({
      name: x.name, amount: x.amount, priceWithOffer: r.generallyAvailableTotal! - x.amount,
      qualifications: x.restrictions.length ? x.restrictions : ["eligibility not verified"], expires: x.expirationDate,
    })),
    dealerAdvertisedTotal: differs ? r.advertisedTotal : null,
    marketComparisonBasis: r.marketComparisonBasis,
    scoreConfidence: unverified.length ? "limited" : "normal",
    reasons,
  };
}

// ── Feed comparison and stage naming ──────────────────────────────────────

export type FeedComparison = "agrees" | "pre_vs_post_incentive" | "genuine_difference" | "dates_not_comparable" | "unresolved";

export function compareWithFeed(
  page: PriceStackResult,
  pageAt: Date,
  feed: { total: number; at: Date },
  storedFigure: number | null,
  maxAgeMs = 3 * 86_400_000,
): { result: FeedComparison; storedStage: string | null; detail: string } {
  const storedStage = storedFigure == null ? null : stageOf(page, storedFigure);
  if (page.status !== "reconciled" || !page.advertisedTotal) return { result: "unresolved", storedStage, detail: page.reason ?? page.status };
  if (Math.abs(pageAt.getTime() - feed.at.getTime()) > maxAgeMs) {
    return { result: "dates_not_comparable", storedStage, detail: `page ${pageAt.toISOString()} vs feed ${feed.at.toISOString()}` };
  }
  if (near(feed.total, page.advertisedTotal.amount)) {
    const inc = page.incentives.reduce((a, x) => a + x.amount, 0);
    if (storedFigure != null && page.dealerPrice && near(storedFigure, page.dealerPrice.amount) && inc > 0) {
      return { result: "pre_vs_post_incentive", storedStage, detail: `feed = ${page.advertisedTotal.label}; stored figure is ${page.dealerPrice.label}, before ${inc} of incentives and the fee` };
    }
    return { result: "agrees", storedStage, detail: `feed = ${page.advertisedTotal.label}` };
  }
  return { result: "genuine_difference", storedStage, detail: `feed ${feed.total} != ${page.advertisedTotal.label} ${page.advertisedTotal.amount}` };
}

export function stageOf(r: PriceStackResult, figure: number): string | null {
  if (r.advertisedTotal && near(figure, r.advertisedTotal.amount)) return `advertised customer total (${r.advertisedTotal.label})`;
  if (r.dealerPrice && near(figure, r.dealerPrice.amount)) return `dealer price before incentives and fee (${r.dealerPrice.label})`;
  if (r.advertisedTotal && r.fee && near(figure, r.advertisedTotal.amount - r.fee.amount)) return "after incentives, before fee";
  if (r.msrp != null && near(figure, r.msrp)) return "MSRP";
  return null;
}
