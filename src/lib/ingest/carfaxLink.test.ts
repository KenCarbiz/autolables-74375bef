import { describe, it, expect } from "vitest";
import {
  findCarfaxUrls, pickReportUrl, normalizeCarfaxUrl,
} from "../../../supabase/functions/_shared/carfaxLink.ts";

// buildFactSnapshot already reads carfax_1_owner from the feed and already
// refuses to say "one owner" without listing.history_report_url -- a claim a
// shopper cannot check is a claim we do not make. In production 60 of 130 live
// vehicles are flagged one-owner and 59 lose the claim purely because no report
// URL is stored. The unlock is the URL, not scraped report content.

const VIN = "3PCAJ5BB0SF103257";

describe("finding the report link on a dealer's own VDP", () => {
  it("prefers the link that carries this VIN", () => {
    const html = `
      <a href="https://www.carfax.com/vehicle/${VIN}">CARFAX Report</a>
      <a href="https://www.carfax.com/">CARFAX</a>`;
    expect(pickReportUrl(html, VIN)).toBe(`https://www.carfax.com/vehicle/${VIN}`);
  });

  it("finds links built in inline script, not just href attributes", () => {
    // Dealer platforms commonly assemble the link in JavaScript.
    const html = `<script>var r="https://www.carfax.com/VehicleHistory/p/Report.cfx?partner=ABC&vin=${VIN}";</script>`;
    expect(pickReportUrl(html, VIN)).toContain(VIN);
  });

  it("refuses a badge, a logo or an advert", () => {
    // Storing one of these would back "one owner" with a link that proves
    // nothing -- worse than making no claim, because it looks substantiated.
    const html = `
      <img src="https://www.carfax.com/img/badges/1-owner.png">
      <a href="https://www.carfax.com/">Get a CARFAX report</a>`;
    expect(pickReportUrl(html, VIN)).toBeNull();
  });

  it("refuses another vehicle's report on the same page", () => {
    // VDPs carry similar-vehicle rails, so the page routinely holds other
    // cars' reports. Storing one would back THIS car's "one owner" with
    // ANOTHER car's history -- worse than making no claim, because it looks
    // substantiated and links to a real CARFAX report.
    const other = "1C6SRFFT2NN400176";
    const html = `<a href="https://www.carfax.com/vehicle/${other}">Report</a>`;
    expect(pickReportUrl(html, VIN)).toBeNull();
  });

  it("still accepts a report link that names no VIN", () => {
    // Some platforms key the report by an internal id.
    const html = `<a href="https://www.carfax.com/VehicleHistory/p/Report.cfx?partner=ABC">Report</a>`;
    expect(pickReportUrl(html, VIN)).toContain("Report.cfx");
  });

  it("normalizes to https and drops tracking parameters", () => {
    const u = normalizeCarfaxUrl(
      `http://www.carfax.com/vehicle/${VIN}?utm_source=dealer&gclid=x&partner=ABC#top`);
    expect(u).toBe(`https://www.carfax.com/vehicle/${VIN}?partner=ABC`);
  });

  it("decodes HTML-escaped ampersands", () => {
    const html = `<a href="https://www.carfax.com/VehicleHistory/p/Report.cfx?partner=ABC&amp;vin=${VIN}">R</a>`;
    expect(pickReportUrl(html, VIN)).toContain("partner=ABC");
    expect(pickReportUrl(html, VIN)).not.toContain("&amp;");
  });

  it("rejects a lookalike domain", () => {
    // carfax.com.evil.example is not carfax.com.
    expect(normalizeCarfaxUrl("https://carfax.com.evil.example/vehicle/x")).toBeNull();
    expect(normalizeCarfaxUrl("https://notcarfax.com/vehicle/x")).toBeNull();
    expect(normalizeCarfaxUrl("https://sub.carfax.com/vehicle/x")).not.toBeNull();
  });

  it("returns nothing on a page with no CARFAX at all", () => {
    expect(findCarfaxUrls("<html><body>no report here</body></html>")).toEqual([]);
    expect(pickReportUrl("<html></html>", VIN)).toBeNull();
  });

  it("survives junk input", () => {
    expect(pickReportUrl("", VIN)).toBeNull();
    expect(normalizeCarfaxUrl("not a url")).toBeNull();
    expect(normalizeCarfaxUrl("")).toBeNull();
  });
});
