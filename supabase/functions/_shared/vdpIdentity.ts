// Which vehicle a dealer page is about, and which parts of the page belong to
// that vehicle, for the advertised-price crawler.
//
// A vehicle detail page names other vehicles too: similar-vehicle cards,
// recently viewed lists, a redirect that landed on another car whose
// "related" strip names ours. The crawler used to accept a price whenever the
// target VIN appeared anywhere, and a page with no VIN at all passed the gate.
// Here a page is the vehicle's only when:
//   - the target VIN appears on the page (any letter case; dealer URLs and
//     data attributes are lowercase);
//   - neither the final address nor the canonical address names another
//     vehicle, and a redirect did not land on an address without this VIN;
//   - the VIN appears outside every other vehicle's card and every
//     related-listings section.
// Everything else is refused with a reason. Observations that do not decide
// identity, such as an unexpected document title, are recorded as findings.

import { parseTree, type El } from "./htmlTree.ts";

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5,
  P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export const normVin = (v: unknown): string => String(v ?? "").trim().toUpperCase();

export function vinCheckDigitOk(vin: string): boolean {
  const v = normVin(vin);
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (/\d/.test(v[i]) ? Number(v[i]) : TRANSLIT[v[i]]) * WEIGHTS[i];
  const r = sum % 11;
  return v[8] === (r === 10 ? "X" : String(r));
}

const TOKEN = /(?<![A-Za-z0-9])([A-HJ-NPR-Za-hj-npr-z0-9]{17})(?![A-Za-z0-9])/g;

export interface VinMark { vin: string; at: number }

// Another vehicle's VIN counts only with a valid check digit, so a 17-character
// token, hash or id is not mistaken for a car. The target counts as written.
export function vinMarks(s: string, target?: string | null): VinMark[] {
  const t = target ? normVin(target) : null;
  const out: VinMark[] = [];
  for (const m of s.matchAll(TOKEN)) {
    const v = m[1].toUpperCase();
    if (v === t || (/\d/.test(v) && /[A-Z]/.test(v) && vinCheckDigitOk(v))) out.push({ vin: v, at: m.index ?? 0 });
  }
  return out;
}

export const vinsIn = (s: string, target?: string | null): Set<string> => new Set(vinMarks(s, target).map((m) => m.vin));

const RELATED_RE = new RegExp(
  String.raw`(?:^|[\s_-])(?:similar|related|recommend(?:ed|ations?)?|recently[-_ ]?viewed|also[-_ ]?viewed|` +
    String.raw`you[-_ ]?may[-_ ]?(?:also[-_ ]?)?like|more[-_ ]?vehicles|other[-_ ]?vehicles|comparable|` +
    String.raw`inventory[-_ ]?(?:list|grid|results)|srp)(?:$|[\s_-])`,
  "i",
);
const NEVER_REMOVED = new Set(["#root", "html", "head", "body", "main"]);

const attrText = (attrs: string): string =>
  [...attrs.matchAll(/\b(?:class|id|aria-label|data-[\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3] ?? "").join(" ");

export interface RemovedSection {
  start: number;
  end: number;
  reason: "other_vehicle" | "related_listings";
  vins: string[];
}

export interface VehicleScope {
  /** The page with every removed section blanked to spaces, so offsets hold. */
  html: string;
  removed: RemovedSection[];
}

// Blanks out what belongs to other vehicles:
//  - each other vehicle's card: the largest element around that VIN that names
//    no other vehicle and not the target (never html, head, body or main);
//  - any element marked as a related-listings section (similar, recommended,
//    recently viewed...).
export function scopeToVehicle(html: string, targetVin: string): VehicleScope {
  const target = normVin(targetVin);
  const root = parseTree(html);
  const marks = vinMarks(html, target);
  const starts = marks.map((m) => m.at);
  const vinsWithin = (el: El): Set<string> => {
    let lo = 0, hi = starts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] < el.start) lo = mid + 1; else hi = mid; }
    const out = new Set<string>();
    for (let i = lo; i < marks.length && marks[i].at < el.end; i++) out.add(marks[i].vin);
    return out;
  };
  const removed: RemovedSection[] = [];
  const covered = (pos: number) => removed.some((r) => r.start <= pos && pos < r.end);

  const visit = (el: El) => {
    for (const c of el.children) {
      // Always removed, even when it names this vehicle: a related strip that
      // names only our VIN is what another car's page looks like after a
      // redirect. A main section wrongly marked fails closed (nothing read).
      if (!NEVER_REMOVED.has(c.tag) && RELATED_RE.test(attrText(c.attrs))) {
        removed.push({ start: c.start, end: c.end, reason: "related_listings", vins: [...vinsWithin(c)].filter((x) => x !== target) });
        continue;
      }
      visit(c);
    }
  };
  visit(root);

  const deepest = (pos: number): El => {
    let cur = root;
    for (;;) {
      const next = cur.children.find((c) => c.start <= pos && pos < c.end);
      if (!next) return cur;
      cur = next;
    }
  };
  for (const m of marks) {
    if (m.vin === target || covered(m.at)) continue;
    let card: El | null = null;
    for (let e: El | null = deepest(m.at); e && !NEVER_REMOVED.has(e.tag); e = e.parent) {
      const v = vinsWithin(e);
      if (v.size === 1 && v.has(m.vin)) card = e; else break;
    }
    if (card && !covered(card.start)) removed.push({ start: card.start, end: card.end, reason: "other_vehicle", vins: [m.vin] });
  }

  let out = html;
  for (const r of [...removed].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + " ".repeat(r.end - r.start) + out.slice(r.end);
  }
  return { html: out, removed };
}

const pathOf = (u: string | null | undefined): string | null => {
  try { return u ? new URL(u).pathname.replace(/\/+$/, "").toLowerCase() : null; } catch { return null; }
};
const firstVin = (s: string | null | undefined, target: string): string | null => {
  const v = vinsIn(s ?? "", target);
  return v.has(target) ? target : ([...v][0] ?? null);
};

// The document's own title, from <head>. A <title> inside the body belongs to
// an embedded SVG or widget (dealer pages embed third-party vehicle-history
// panels), not to the page, and is recorded separately.
export function documentTitles(html: string): { document: string | null; embedded: string[] } {
  const clean = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const bodyAt = html.search(/<body\b/i);
  const all = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => ({ at: m.index ?? 0, t: clean(m[1]) })).filter((x) => x.t);
  const head = all.find((x) => bodyAt < 0 || x.at < bodyAt);
  return { document: head?.t ?? null, embedded: all.filter((x) => x !== head).map((x) => x.t).slice(0, 5) };
}

const canonicalUrl = (html: string): string | null =>
  /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1]
  ?? /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html)?.[1]
  ?? /<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
  ?? null;

export type IdentityVerdict = "vehicle" | "other_vehicle" | "no_vehicle" | "unchecked";

export interface PageIdentity {
  verdict: IdentityVerdict;
  reason: string;
  targetOnPage: boolean;
  targetInScope: boolean;
  otherVins: string[];
  redirected: boolean;
  finalUrl: string | null;
  finalUrlVin: string | null;
  canonicalVin: string | null;
  documentTitle: string | null;
  embeddedTitles: string[];
  /** Recorded, never decisive: e.g. page_title_unrecognized. */
  findings: string[];
  removedSections: number;
}

export interface PageIdentityInput {
  html: string;
  targetVin: string | null | undefined;
  requestedUrl: string;
  finalUrl?: string | null;
  /** "2023 Jeep Wrangler": lets an unexpected document title be noted. */
  ymm?: string | null;
}

export function pageIdentity(i: PageIdentityInput, scope?: VehicleScope): PageIdentity & { scope: VehicleScope | null } {
  const titles = documentTitles(i.html);
  const finalUrl = i.finalUrl ?? null;
  const reqPath = pathOf(i.requestedUrl);
  const finPath = pathOf(finalUrl);
  const redirected = !!finPath && !!reqPath && finPath !== reqPath;
  const base = {
    redirected, finalUrl, documentTitle: titles.document, embeddedTitles: titles.embedded,
  };
  const target = normVin(i.targetVin);
  if (!target) {
    return {
      ...base, verdict: "unchecked", reason: "no target VIN supplied", targetOnPage: false, targetInScope: false,
      otherVins: [], finalUrlVin: null, canonicalVin: null, findings: [], removedSections: 0, scope: null,
    };
  }
  const s = scope ?? scopeToVehicle(i.html, target);
  const pageVins = vinsIn(i.html, target);
  const targetOnPage = pageVins.has(target);
  const targetInScope = vinsIn(s.html, target).has(target);
  const otherVins = [...pageVins].filter((v) => v !== target).slice(0, 10);
  const finalUrlVin = firstVin(finalUrl ?? i.requestedUrl, target);
  const canonicalVin = firstVin(canonicalUrl(i.html), target);

  const findings: string[] = [];
  if (redirected) findings.push(finalUrlVin === target ? "redirected_same_vehicle" : "redirected");
  if (titles.embedded.length) findings.push("embedded_title_present");
  const ymmTokens = String(i.ymm ?? "").toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (ymmTokens.length) {
    const t = (titles.document ?? "").toLowerCase();
    if (!t) findings.push("page_title_missing");
    else if (!ymmTokens.some((tok) => t.includes(tok))) findings.push("page_title_unrecognized");
  }

  const done = (verdict: IdentityVerdict, reason: string) => ({
    ...base, verdict, reason, targetOnPage, targetInScope, otherVins, finalUrlVin, canonicalVin, findings,
    removedSections: s.removed.length, scope: s,
  });
  if (finalUrlVin && finalUrlVin !== target) return done("other_vehicle", "the final address names another vehicle");
  if (canonicalVin && canonicalVin !== target) return done("other_vehicle", "the page's canonical address names another vehicle");
  if (redirected && finalUrlVin !== target && canonicalVin !== target) {
    return done(otherVins.length ? "other_vehicle" : "no_vehicle", "redirected to an address that does not name this vehicle");
  }
  if (!targetOnPage) {
    return done(otherVins.length ? "other_vehicle" : "no_vehicle", otherVins.length ? "the page names other vehicles, not this one" : "the page names no vehicle");
  }
  if (!targetInScope) return done("other_vehicle", "this VIN appears only inside another vehicle's card or a related-vehicles section");
  return done("vehicle", "the VIN is on the page outside every other vehicle's section");
}

// What an observation or audit row keeps of the identity check.
export const identitySummary = (i: PageIdentity) => ({
  verdict: i.verdict,
  reason: i.reason,
  redirected: i.redirected,
  final_url: i.finalUrl,
  document_title: i.documentTitle,
  embedded_titles: i.embeddedTitles,
  findings: i.findings,
  other_vins: i.otherVins.length,
  removed_sections: i.removedSections,
});
