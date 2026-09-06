// Finding the CARFAX report link on a dealer's own vehicle detail page.
//
// Why a link and not the report data: buildFactSnapshot already reads
// mc.carfax_1_owner from the feed, and already refuses to say "one owner"
// unless listing.history_report_url exists -- a claim a shopper cannot check
// is a claim we do not make. 60 of Harte's 130 live vehicles are flagged
// one-owner and 59 of them lose the claim purely because no report URL is
// stored. So the unlock is the URL, not scraped report content.
//
// This deliberately does NOT parse owner counts, accident counts or service
// records out of the page. Those are CARFAX's licensed report content; the
// link hands the shopper the real report instead of restating it second-hand,
// and it keeps the claim backed by a source the dealer already pays for.

/** Report URLs are canonicalised to https and stripped of tracking noise. */
const TRACKING = /^(utm_|gclid|fbclid|msclkid|_ga)/i;

export function normalizeCarfaxUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw || "").trim().replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  if (!/(^|\.)carfax\.com$/i.test(u.hostname)) return null;
  u.protocol = "https:";
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING.test(k)) u.searchParams.delete(k);
  }
  u.hash = "";
  return u.toString();
}

/**
 * Every carfax.com URL on the page, in document order, de-duplicated.
 * Matches href/src attributes and bare URLs in inline script payloads, since
 * dealer platforms commonly build the link in JavaScript.
 */
export function findCarfaxUrls(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s"'<>\\)]*carfax\.com[^\s"'<>\\)]*/gi;
  for (const m of String(html || "").matchAll(re)) {
    const url = normalizeCarfaxUrl(m[0]);
    if (url && !seen.has(url)) { seen.add(url); out.push(url); }
  }
  return out;
}

/** A link that is a REPORT for this VIN, not a generic CARFAX badge or ad. */
export function pickReportUrl(html: string, vin: string): string | null {
  const urls = findCarfaxUrls(html);
  if (!urls.length) return null;
  const v = String(vin || "").trim().toLowerCase();

  // A URL carrying this VIN is unambiguous -- it can only be this car's report.
  if (v) {
    const byVin = urls.find((u) => u.toLowerCase().includes(v));
    if (byVin) return byVin;
  }
  // Otherwise accept the well-known report paths. A bare carfax.com homepage
  // link, a logo asset or a "get a CARFAX" advert is not a report and must not
  // be stored as one: it would turn "one owner" into a claim backed by a link
  // that proves nothing.
  //
  // And a report URL carrying a DIFFERENT VIN is worse than none at all. VDPs
  // carry similar-vehicle rails, so the page routinely holds other cars'
  // reports; storing one would back this car's "one owner" with another car's
  // history. When the page names VINs and none of them is ours, we have not
  // found this vehicle's report -- we have found somebody else's.
  const REPORT = /(vehiclehistory\/p\/report|\/vehicle\/|showreport|report\.cfx)/i;
  const OTHER_VIN = /(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/i;
  return urls.find((u) => REPORT.test(u) && !OTHER_VIN.test(u)) ?? null;
}

/** Assets and adverts that must never be mistaken for a report. */
export const isReportUrl = (url: string, vin?: string): boolean =>
  pickReportUrl(`"${url}"`, vin || "") !== null;
