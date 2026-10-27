// Which page the advertised-price crawler should visit for a vehicle, and
// what the page it got back actually is.
//
// On 2026-10-27 every website attempt since Oct 11 had failed the same way:
// the dealer's site had been rebuilt after Oct 3, the direct fetch answered
// 403, and the rendered fallback came back as some other page (a model
// line-up with five "starting at" prices, or a different car's "your price").
// The crawler read those as "VIN mismatch" and tried the same dead URL up to
// 66 times, because the queue only ever knew the URL captured months before.
//
// Three rules, each pure so they can be tested:
//   preferCrawlUrl        the freshest address wins: a URL the crawler itself
//                         discovered on the live site, then the feed's current
//                         VDP url on the listing, then the snapshot's.
//   classifyRenderedPage  a rendered page is a challenge, the vehicle, another
//                         vehicle, or a page with no vehicle on it at all.
//   shouldBackoffMismatch a URL that keeps answering with the wrong vehicle is
//                         left alone for a while instead of being rendered
//                         again every night.

export type CrawlUrlSource = "scrape" | "listing" | "snapshot" | "none";

export interface CrawlUrlInputs {
  snapshotUrl: string | null | undefined;
  listingUrl: string | null | undefined;
  scrapeUrl: string | null | undefined;
}

const clean = (u: unknown): string => String(u ?? "").trim();

export function preferCrawlUrl(i: CrawlUrlInputs): { url: string; source: CrawlUrlSource } {
  const scrape = clean(i.scrapeUrl);
  if (scrape) return { url: scrape, source: "scrape" };
  const listing = clean(i.listingUrl);
  if (listing) return { url: listing, source: "listing" };
  const snapshot = clean(i.snapshotUrl);
  if (snapshot) return { url: snapshot, source: "snapshot" };
  return { url: "", source: "none" };
}

// Host case, a trailing slash, a fragment and the finance/lease view params
// do not make a different page.
const VIEW_PARAMS = new Set([
  "type", "viewtype", "view", "paymenttype", "payment", "pricingmode", "pricetype",
  "tab", "mode", "incentive", "incentives", "lease", "finance",
]);
export function normalizeCrawlUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (VIEW_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export const sameUrl = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && normalizeCrawlUrl(a) === normalizeCrawlUrl(b);

export function vinFromUrl(u: string): string | null {
  const m = u.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : null;
}

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/g;
export function collectPageVins(html: string, url: string): Set<string> {
  const vins = new Set<string>();
  let m: RegExpExecArray | null;
  VIN_RE.lastIndex = 0;
  while ((m = VIN_RE.exec(`${html}\n${url}`))) vins.add(m[1].toUpperCase());
  return vins;
}

// Candidate VDP URLs on a listing page or sitemap: any absolute or
// root-relative URL that embeds a 17-character VIN.
export function discoverVdpUrls(docBody: string, origin: string, isSafe: (u: string) => boolean = () => true): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const absRe = /https?:\/\/[^\s"'<>]*[A-HJ-NPR-Z0-9]{17}[^\s"'<>]*/gi;
  while ((m = absRe.exec(docBody))) {
    const u = m[0].replace(/&amp;/g, "&").split("?")[0].split("#")[0];
    if (isSafe(u)) found.add(u);
  }
  const relRe = /["'](\/[a-z0-9/_.\-]*[A-HJ-NPR-Z0-9]{17}[a-z0-9/_.\-]*(?:[?#][^"'<>\s]*)?)["']/gi;
  while ((m = relRe.exec(docBody))) {
    const u = origin + m[1].replace(/&amp;/g, "&").split("?")[0].split("#")[0];
    if (isSafe(u)) found.add(u);
  }
  return [...found];
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 120) : null;
}

export type RenderedPageVerdict = "challenge" | "vehicle" | "other_vehicle" | "no_vehicle";

export interface RenderedPageInput {
  html: string;
  requestedUrl: string;
  finalUrl: string | null | undefined;
  pageStatus: number | null | undefined;
  targetVin: string | null | undefined;
  isChallenge: (html: string, status: number) => boolean;
}

export interface RenderedPageVerdictDetail {
  verdict: RenderedPageVerdict;
  redirected: boolean;
  pageVins: number;
  title: string | null;
  note: string;
}

const pathOf = (u: string | null | undefined): string | null => {
  try { return u ? new URL(u).pathname.replace(/\/+$/, "").toLowerCase() : null; } catch { return null; }
};

// The render provider follows redirects, so the page it hands back may not be
// the page that was asked for. A page that carries VINs but not the target is
// another vehicle; a page with no VIN at all is a landing or search page.
// Both are "the URL is dead", never "the vehicle has no price".
export function classifyRenderedPage(i: RenderedPageInput): RenderedPageVerdictDetail {
  const status = i.pageStatus ?? 200;
  const title = pageTitle(i.html);
  const requestedPath = pathOf(i.requestedUrl);
  const finalPath = pathOf(i.finalUrl);
  const redirected = !!finalPath && !!requestedPath && finalPath !== requestedPath;
  if (i.isChallenge(i.html, status)) {
    return { verdict: "challenge", redirected, pageVins: 0, title, note: `challenge page (status ${status})` };
  }
  const vins = collectPageVins(i.html, i.finalUrl || "");
  const target = String(i.targetVin || "").toUpperCase().trim();
  if (target && vins.has(target)) {
    return { verdict: "vehicle", redirected, pageVins: vins.size, title, note: redirected ? "vehicle page, reached through a redirect" : "vehicle page" };
  }
  if (vins.size === 0) {
    return {
      verdict: "no_vehicle", redirected, pageVins: 0, title,
      note: redirected ? `redirected to a page with no vehicle on it (${finalPath})` : "page carries no VIN",
    };
  }
  return {
    verdict: target ? "other_vehicle" : "vehicle", redirected, pageVins: vins.size, title,
    note: target
      ? (redirected ? `redirected to another vehicle (${finalPath})` : `page shows ${vins.size} other VIN(s), not the target`)
      : "vehicle page (no target VIN to check)",
  };
}

export interface MismatchBackoffInput {
  attempts: number | null | undefined;
  ledgerUrl: string | null | undefined;
  candidateUrl: string;
  lastAttemptAt: string | Date | null | undefined;
  now: number;
  windowMs: number;
  threshold: number;
}

// Back off only when it is the SAME dead URL: a refreshed address is tried at
// once, however many times the old one failed.
export function shouldBackoffMismatch(i: MismatchBackoffInput): boolean {
  const attempts = Number(i.attempts ?? 0);
  if (!Number.isFinite(attempts) || attempts < i.threshold) return false;
  if (!sameUrl(i.ledgerUrl, i.candidateUrl)) return false;
  const last = i.lastAttemptAt ? new Date(i.lastAttemptAt).getTime() : NaN;
  if (!Number.isFinite(last)) return false;
  return i.now - last < i.windowMs;
}
