// PROPOSED, NOT DEPLOYED. Source-evidenced price-component model for a dealer
// vehicle page. Lives outside supabase/functions so no function deploy can
// pick it up; crawl-advertised-prices.patch beside this file wires it in.
//
// A dealer page can carry several prices for one vehicle, each a different
// stage of the same calculation, e.g.
//
//   MSRP                $116,750
//   Dealer Discount      -$3,000
//   Harte Price         $113,750   dealer price, before incentives and fee
//   Retail Cash         -$10,000   manufacturer incentive
//   Conveyance Fee         +$895
//   Your Price          $104,645   customer total, after incentives, with fee
//
// Reading one of these figures and guessing its fee treatment from a tenant
// setting compared the dealer-price stage against a feed that carries the
// final stage; every such "discrepancy" was a pre- versus post-incentive
// comparison. This model reads the stack scoped to the VIN's own pricing
// widget, names every line by role, proves the arithmetic, and keeps generic
// page disclaimers apart. It decides nothing it cannot reconcile.

export type LineRole = "msrp" | "discount" | "dealer_price" | "incentive" | "fee" | "final_price" | "unknown";
export type Eligibility = "stated_unconditional" | "conditional" | "unknown";

export interface StackLine {
  label: string;
  role: LineRole;
  /** Amount as printed, unsigned. */
  amount: number;
  /** Sign as printed: -1 for "-$", +1 for "+$", 0 when unsigned. */
  printedSign: -1 | 0 | 1;
  /** Order of the line inside the VIN-scoped widget. */
  index: number;
}

export interface Incentive {
  label: string;
  amount: number;
  eligibility: Eligibility;
  eligibilityEvidence: string | null;
}

export interface Disclaimer {
  scope: "widget" | "page";
  text: string;
  says: "fee_excluded" | "fee_included" | "incentive_conditional" | "incentive_unconditional" | "other";
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
  | "disclaimer_contradicts_widget_fee"
  | "widget_disclaimer_contradicts_widget_fee";

export interface PriceStackResult {
  status: StackStatus;
  /** Ready for an automatic write: reconciled and no review flag. */
  writable: boolean;
  flags: ReviewFlag[];
  lines: StackLine[];
  /** The exact advertised customer total (e.g. "Your Price") and its label. */
  customerTotal: { amount: number; label: string } | null;
  /** The total less the fee: the price after incentives, before the fee. */
  beforeFeeAfterIncentives: number | null;
  /** The dealer's own price before incentives and fee (e.g. "Harte Price"). */
  dealerPrice: { amount: number; label: string } | null;
  msrp: number | null;
  discounts: { label: string; amount: number }[];
  incentives: Incentive[];
  fee: { label: string; amount: number; includedIn: string } | null;
  disclaimers: Disclaimer[];
  /** Which arithmetic checks held, for the audit row. */
  proof: string[];
  reason: string | null;
}

export interface PriceStackConfig {
  /** Dealer-specific label for the pre-incentive dealer price, e.g. "Harte Price". */
  dealerPriceLabels?: string[];
  /** Dealer-specific label for the customer total, e.g. "Your Price". */
  finalPriceLabels?: string[];
  /** The configured document fee; the fee line must state this amount. */
  configuredFee: number;
}

const TOL = 1;
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

const DEFAULT_DEALER_PRICE = ["dealer price", "sale price", "selling price", "internet price", "special price", "e-price", "our price"];
const DEFAULT_FINAL_PRICE = ["your price", "final price", "total price", "price after incentives", "net price"];
const MSRP_RE = /\b(?:msrp|total msrp|window sticker)\b/i;
const DISCOUNT_RE = /\b(?:discount|savings|dealer adjustment)\b/i;
const INCENTIVE_RE = /\b(?:rebate|incentive|loyalty|conquest|military|college|first responder|trade[- ]in assistance|cash allowance|cash(?!\s*price))\b/i;
const FEE_RE = /\b(?:conveyance|doc(?:ument(?:ation)?)?|dealer|processing|administrative|admin)\s+fees?\b/i;

const CONDITIONAL_RE = /\b(?:financial services|finance cash|lease cash|apr cash|must finance|finance through|financed through|lease through|when financ|when leas|with approved credit|on approved credit|qualif\w*|eligib\w*|loyalty|conquest|current owners?|lessees?|military|college|first responder|restrictions apply|not all (?:buyers|customers)|see dealer for details|in lieu of|trade[- ]in required)\b/i;
const UNCONDITIONAL_RE = /\b(?:available to all (?:buyers|customers)|no qualification(?:s)? required|applies to (?:all|every) (?:buyers?|customers?|purchases?))\b/i;

const money = (s: string) => Number(s.replace(/,/g, ""));
// Block-level boundaries become " | " so a price line ("Retail Cash -$10,000")
// stays one segment and a sentence of prose stays apart from it.
const BLOCK_TAG = /<\/?(?:div|p|li|ul|ol|tr|td|th|dt|dd|dl|br|h[1-6]|section|article|table|tbody|header|footer)\b[^>]*>/gi;
const stripTags = (h: string) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(BLOCK_TAG, " | ").replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ")
    .replace(/&#8722;|&minus;/gi, "-").replace(/\s+/g, " ").trim();

// The widget for one vehicle: the stretch of the page around this VIN that
// contains no other VIN. A similar-vehicle card or another car's widget is
// bounded out by its own VIN; a VIN that appears in two separate places with
// price lines in both is ambiguous and left for review.
export function vinScope(html: string, vin: string): { scoped: string; outside: string; status: "ok" | "vin_not_found" | "ambiguous_vin_scope" } {
  const target = vin.toUpperCase();
  // A VIN inside a tag (data-vin="...") marks from the start of that tag.
  const tagStart = (at: number) => {
    const lt = html.lastIndexOf("<", at);
    return lt >= 0 && html.lastIndexOf(">", at) < lt ? lt : at;
  };
  const marks = [...html.matchAll(VIN_RE)].map((m) => ({ at: tagStart(m.index ?? 0), vin: m[0].toUpperCase() }));
  const own = marks.filter((m) => m.vin === target);
  if (!own.length) return { scoped: "", outside: stripTags(html), status: "vin_not_found" };
  // A vehicle's region runs forward from its own VIN to the next different
  // VIN (a card or widget names its vehicle first). Consecutive mentions of
  // the same VIN with no other VIN between them form one region.
  const regions: { start: number; end: number }[] = [];
  let open: { start: number } | null = null;
  for (const m of marks) {
    if (m.vin === target) { if (!open) open = { start: m.at }; continue; }
    if (open) { regions.push({ start: open.start, end: m.at }); open = null; }
  }
  if (open) regions.push({ start: open.start, end: html.length });
  const withPrices = regions.filter((r) => /\$\s?\d/.test(stripTags(html.slice(r.start, r.end))));
  if (withPrices.length > 1) return { scoped: "", outside: stripTags(html), status: "ambiguous_vin_scope" };
  const r = withPrices[0] ?? regions[0];
  return {
    scoped: stripTags(html.slice(r.start, r.end)),
    outside: stripTags(html.slice(0, r.start) + " | " + html.slice(r.end)),
    status: "ok",
  };
}

const AMT = String.raw`([+\-−–])?\s*\$\s?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{2})?`;
const LABEL = String.raw`([A-Za-z][A-Za-z0-9 .&'/-]{0,40}?)`;
const LINE_SEG = new RegExp(String.raw`^${LABEL}\s*:?\s*${AMT}$`);
const LABEL_SEG = new RegExp(String.raw`^${LABEL}\s*:?$`);
const AMOUNT_SEG = new RegExp(String.raw`^${AMT}$`);
const segmentsOf = (text: string) => text.split("|").map((s) => s.trim()).filter(Boolean);
const shortLabel = (s: string) => s.trim().split(/\s+/).length <= 6;

export function classifyLabel(label: string, cfg: PriceStackConfig): LineRole {
  const l = label.toLowerCase().trim();
  const has = (list: string[]) => list.some((x) => new RegExp(`\\b${esc(x.toLowerCase())}\\b`).test(l));
  if (has(cfg.finalPriceLabels ?? []) ) return "final_price";
  if (has(cfg.dealerPriceLabels ?? [])) return "dealer_price";
  if (FEE_RE.test(l)) return "fee";
  if (INCENTIVE_RE.test(l)) return "incentive";
  if (DISCOUNT_RE.test(l)) return "discount";
  if (MSRP_RE.test(l)) return "msrp";
  if (has(DEFAULT_FINAL_PRICE)) return "final_price";
  if (has(DEFAULT_DEALER_PRICE)) return "dealer_price";
  return "unknown";
}

// A price line is a short label and one amount, in one segment or a label
// segment followed by an amount segment. Everything else is prose, read only
// for disclaimers.
// The stack is the run of price lines with at most MAX_GAP prose segments
// between them; prose within NEAR segments of the run is the widget's own
// footnote, anything further is page text. When the VIN's region holds more
// than one run that carries a customer total, the widget is ambiguous.
const MAX_GAP = 2;
const NEAR = 2;

export function splitWidget(scopedText: string, cfg: PriceStackConfig):
  { lines: StackLine[]; widgetProse: string; pageProse: string; ambiguous: boolean } {
  const segs = segmentsOf(scopedText);
  type Seg = { kind: "line"; label: string; sign?: string; amt: string; at: number } | { kind: "prose"; text: string; at: number };
  const parsed: Seg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const line = s.match(LINE_SEG);
    if (line && shortLabel(line[1])) { parsed.push({ kind: "line", label: line[1], sign: line[2], amt: line[3], at: i }); continue; }
    const lab = s.match(LABEL_SEG);
    const next = segs[i + 1]?.match(AMOUNT_SEG);
    if (lab && next && shortLabel(lab[1])) { parsed.push({ kind: "line", label: lab[1], sign: next[1], amt: next[2], at: i }); i++; continue; }
    parsed.push({ kind: "prose", text: s, at: i });
  }
  const runs: { from: number; to: number }[] = [];
  for (const p of parsed) {
    if (p.kind !== "line") continue;
    const last = runs[runs.length - 1];
    const gap = last ? parsed.filter((q) => q.kind === "prose" && q.at > last.to && q.at < p.at).length : Infinity;
    if (last && gap <= MAX_GAP) last.to = p.at; else runs.push({ from: p.at, to: p.at });
  }
  const toLine = (p: Extract<Seg, { kind: "line" }>, index: number): StackLine => {
    const label = p.label.replace(/\s+/g, " ").trim();
    return { label, role: classifyLabel(label, cfg), amount: money(p.amt), printedSign: (p.sign ? (p.sign === "+" ? 1 : -1) : 0) as -1 | 0 | 1, index };
  };
  const linesIn = (r: { from: number; to: number }) =>
    parsed.filter((p): p is Extract<Seg, { kind: "line" }> => p.kind === "line" && p.at >= r.from && p.at <= r.to).map(toLine);
  const withTotal = runs.filter((r) => linesIn(r).some((l) => l.role === "final_price"));
  const chosen = withTotal.length === 1 ? withTotal[0] : withTotal.length === 0 && runs.length === 1 ? runs[0] : null;
  const prose = parsed.filter((p): p is Extract<Seg, { kind: "prose" }> => p.kind === "prose");
  if (!chosen) {
    return { lines: [], widgetProse: "", pageProse: prose.map((p) => p.text).join(" "), ambiguous: runs.length > 0 };
  }
  const near = (p: { at: number }) => p.at >= chosen.from - NEAR && p.at <= chosen.to + NEAR;
  return {
    lines: linesIn(chosen),
    widgetProse: prose.filter(near).map((p) => p.text).join(" "),
    pageProse: prose.filter((p) => !near(p)).map((p) => p.text).join(" "),
    ambiguous: false,
  };
}

const sentences = (t: string) => t.replace(/\|/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12);

export function readDisclaimers(text: string, scope: Disclaimer["scope"]): Disclaimer[] {
  const out: Disclaimer[] = [];
  for (const s of sentences(text)) {
    if (/\$\s?\d/.test(s) && !/\b(?:fee|incentive|rebate|cash|offer|qualif|eligib)\b/i.test(s)) continue;
    if (FEE_RE.test(s) || /\bfees?\b/i.test(s)) {
      if (/\b(?:exclud\w*|not includ\w*|does not include|plus|additional|extra)\b/i.test(s) && FEE_RE.test(s)) {
        out.push({ scope, text: s.slice(0, 240), says: "fee_excluded" });
        continue;
      }
      if (/\b(?:includ\w*|inclusive)\b/i.test(s) && FEE_RE.test(s) && !/\bnot\b/i.test(s)) {
        out.push({ scope, text: s.slice(0, 240), says: "fee_included" });
        continue;
      }
    }
    if (INCENTIVE_RE.test(s) || /\boffers?\b/i.test(s)) {
      if (UNCONDITIONAL_RE.test(s)) out.push({ scope, text: s.slice(0, 240), says: "incentive_unconditional" });
      else if (CONDITIONAL_RE.test(s)) out.push({ scope, text: s.slice(0, 240), says: "incentive_conditional" });
    }
  }
  return out;
}

const empty = (status: StackStatus, reason: string, extra: Partial<PriceStackResult> = {}): PriceStackResult => ({
  status, writable: false, flags: [], lines: [], customerTotal: null, beforeFeeAfterIncentives: null,
  dealerPrice: null, msrp: null, discounts: [], incentives: [], fee: null, disclaimers: [], proof: [], reason, ...extra,
});

export function readPriceStack(html: string, vin: string, cfg: PriceStackConfig): PriceStackResult {
  const scope = vinScope(html, vin);
  if (scope.status !== "ok") return empty(scope.status, scope.status === "vin_not_found" ? "the VIN is not on the page" : "the VIN has price lines in more than one place");
  const { lines, widgetProse, pageProse, ambiguous } = splitWidget(scope.scoped, cfg);
  const disclaimers = [
    ...readDisclaimers(widgetProse, "widget"),
    ...readDisclaimers(`${pageProse} ${scope.outside.replace(/\|/g, " ")}`, "page"),
  ];
  const base = { lines, disclaimers };
  if (ambiguous) return empty("ambiguous_vin_scope", "more than one price stack in the VIN's region", base);
  if (!lines.length) return empty("no_stack", "no price lines inside the VIN's widget", base);

  const unknown = lines.filter((l) => l.role === "unknown");
  if (unknown.length) return empty("unknown_line", `unrecognised line(s): ${unknown.map((l) => l.label).join(", ")}`, base);

  const one = (role: LineRole) => lines.filter((l) => l.role === role);
  const msrpLines = one("msrp"), dealerLines = one("dealer_price"), finalLines = one("final_price");
  const discountLines = one("discount"), incentiveLines = one("incentive"), feeLines = one("fee");
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
  // Signs: a discount or incentive printed with "+" is not a reduction; a fee
  // printed with "-" is not a charge. Either is a stack this model does not know.
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
  // Order matters: the fee must sit between the dealer price and the total,
  // so the total is the figure that carries it.
  if (feeLine && !(feeLine.index < final.index && (!dealer || dealer.index < feeLine.index))) {
    return empty("unreconciled", "the fee line is not between the dealer price and the customer total", { ...base, proof });
  }

  const widgetConditional = disclaimers.find((d) => d.scope === "widget" && d.says === "incentive_conditional");
  const widgetUnconditional = disclaimers.find((d) => d.scope === "widget" && d.says === "incentive_unconditional");
  const incentives: Incentive[] = incentiveLines.map((l) => {
    if (CONDITIONAL_RE.test(l.label)) return { label: l.label, amount: l.amount, eligibility: "conditional", eligibilityEvidence: `label: ${l.label}` };
    if (widgetConditional) return { label: l.label, amount: l.amount, eligibility: "conditional", eligibilityEvidence: widgetConditional.text };
    if (widgetUnconditional) return { label: l.label, amount: l.amount, eligibility: "stated_unconditional", eligibilityEvidence: widgetUnconditional.text };
    return { label: l.label, amount: l.amount, eligibility: "unknown", eligibilityEvidence: null };
  });

  const flags: ReviewFlag[] = [];
  if (incentives.some((x) => x.eligibility === "unknown")) flags.push("incentive_eligibility_unverified");
  if (incentives.some((x) => x.eligibility === "conditional")) flags.push("incentive_conditional");
  if (feeLine) {
    if (disclaimers.some((d) => d.scope === "page" && d.says === "fee_excluded")) flags.push("disclaimer_contradicts_widget_fee");
    if (disclaimers.some((d) => d.scope === "widget" && d.says === "fee_excluded")) flags.push("widget_disclaimer_contradicts_widget_fee");
  }

  return {
    status: "reconciled",
    writable: flags.length === 0,
    flags,
    lines,
    customerTotal: { amount: final.amount, label: final.label },
    beforeFeeAfterIncentives: final.amount - fee,
    dealerPrice: dealer ? { amount: dealer.amount, label: dealer.label } : null,
    msrp,
    discounts,
    incentives,
    fee: feeLine ? { label: feeLine.label, amount: feeLine.amount, includedIn: final.label } : null,
    disclaimers,
    proof,
    reason: null,
  };
}

export type FeedComparison =
  | "agrees"
  | "pre_vs_post_incentive"
  | "genuine_difference"
  | "dates_not_comparable"
  | "unresolved";

// Compare the feed's total with the page's stack for the same VIN. Only
// observations taken within `maxAgeMs` of each other are compared; a page read
// today says nothing about the feed of a month ago. The page figure the
// crawler stored is named by stage so a pre-incentive figure is never reported
// as a price discrepancy.
export function compareWithFeed(
  page: PriceStackResult,
  pageAt: Date,
  feed: { total: number; at: Date },
  storedFigure: number | null,
  maxAgeMs = 3 * 86_400_000,
): { result: FeedComparison; storedStage: string | null; detail: string } {
  const storedStage = storedFigure == null ? null : stageOf(page, storedFigure);
  if (page.status !== "reconciled" || !page.customerTotal) {
    return { result: "unresolved", storedStage, detail: page.reason ?? page.status };
  }
  if (Math.abs(pageAt.getTime() - feed.at.getTime()) > maxAgeMs) {
    return { result: "dates_not_comparable", storedStage, detail: `page ${pageAt.toISOString()} vs feed ${feed.at.toISOString()}` };
  }
  if (near(feed.total, page.customerTotal.amount)) {
    const incentives = page.incentives.reduce((a, x) => a + x.amount, 0);
    if (storedFigure != null && page.dealerPrice && near(storedFigure, page.dealerPrice.amount) && incentives > 0) {
      return { result: "pre_vs_post_incentive", storedStage, detail: `feed = ${page.customerTotal.label}; stored figure is ${page.dealerPrice.label}, before ${incentives} of incentives and the fee` };
    }
    return { result: "agrees", storedStage, detail: `feed = ${page.customerTotal.label}` };
  }
  return { result: "genuine_difference", storedStage, detail: `feed ${feed.total} != ${page.customerTotal.label} ${page.customerTotal.amount}` };
}

// Which stage of a reconciled stack a single extracted figure is. Used to say
// exactly what an existing observation captured.
export function stageOf(result: PriceStackResult, figure: number): string | null {
  if (result.customerTotal && near(figure, result.customerTotal.amount)) return `customer total (${result.customerTotal.label})`;
  if (result.dealerPrice && near(figure, result.dealerPrice.amount)) return `dealer price before incentives and fee (${result.dealerPrice.label})`;
  if (result.beforeFeeAfterIncentives != null && near(figure, result.beforeFeeAfterIncentives)) return "after incentives, before fee";
  if (result.msrp != null && near(figure, result.msrp)) return "MSRP";
  return null;
}
