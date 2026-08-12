import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The nightly crawler is already on the dealer's VDP for the price. A unit the
// dealer merchandised on their own site before it reached the syndication feed
// has a stock number on the page and none in our record — and that number is
// what the whole lot refers to the car by.
//
// Deno source, so the regexes are lifted rather than imported. The literals are
// asserted against the file so a change there fails here.

const source = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);

const literal = (name: string): RegExp => {
  const m = new RegExp(`const ${name} =\\s*\\n?\\s*(/.*?/[a-z]*);`, "s").exec(source);
  if (!m) throw new Error(`${name} not found in the crawler`);
  const body = m[1].slice(1, m[1].lastIndexOf("/"));
  const flags = m[1].slice(m[1].lastIndexOf("/") + 1);
  return new RegExp(body, flags);
};

const STOCK_LABEL_RE = literal("STOCK_LABEL_RE");
const STOCK_JSON_RE = literal("STOCK_JSON_RE");

// Mirrors extractStockNumber; the guards are what this file is really testing.
const extract = (html: string, vin: string): string | null => {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ");
  const raw = (STOCK_JSON_RE.exec(html)?.[1] || STOCK_LABEL_RE.exec(text)?.[1] || "").trim().toUpperCase();
  if (!raw) return null;
  const v = (vin || "").toUpperCase();
  if (v && raw.length >= 6 && v.includes(raw)) return null;
  if (/^(19|20)\d{2}$/.test(raw)) return null;
  return raw;
};

const VIN = "JN8AZ3CC9T9622022";

describe("the crawler reads a stock number the dealer states on their own page", () => {
  it("takes a labelled number out of the rendered markup", () => {
    expect(extract(`<span class="stk">Stock #: H4821</span>`, VIN)).toBe("H4821");
    expect(extract(`<li><strong>Stock Number:</strong> I21567</li>`, VIN)).toBe("I21567");
    expect(extract(`<div>Stk# 40821</div>`, VIN)).toBe("40821");
  });

  it("prefers a structured value over scraped text", () => {
    // The rail below a VDP is full of other cars' labels; JSON-LD is this car.
    const html = `<script>{"stockNumber":"H4821"}</script><div>Stock #: Z9999</div>`;
    expect(extract(html, VIN)).toBe("H4821");
  });

  it("is case- and separator-tolerant, and normalises to upper case", () => {
    expect(extract("stock no. h4821-a", VIN)).toBe("H4821-A");
    expect(extract("Stock Number H4821", VIN)).toBe("H4821");
  });
});

describe("what it refuses to file as a stock number", () => {
  it("never files the VIN, or its tail, as a stock number", () => {
    expect(extract(`Stock #: ${VIN}`, VIN)).toBeNull();
    expect(extract("Stock #: T9622022", VIN)).toBeNull();
  });

  it("never files a model year", () => {
    expect(extract("Stock #: 2026", VIN)).toBeNull();
  });

  it("takes nothing at all from an unlabelled page", () => {
    // A bare token near the price is as likely a trim code or an offer id, and
    // a wrong stock number is worse than none — someone walks the lot with it.
    expect(extract(`<div class="price">$102,195</div><span>ABC123</span>`, VIN)).toBeNull();
  });

  it("does not read prose as a label", () => {
    // "In stock now" is a merchandising phrase on half the VDPs out there.
    expect(extract("<p>In stock now at our Hartford showroom</p>", VIN)).toBeNull();
    expect(extract("<p>We carry livestock trailers</p>", VIN)).toBeNull();
  });
});

describe("where the crawler writes it", () => {
  it("fills only a gap, so the DMS feed always wins", () => {
    expect(source).toMatch(/from\("vehicle_files"\)\.update\(\{ stock_number: stock \}\)/);
    expect(source).toMatch(/\.or\("stock_number\.is\.null,stock_number\.eq\."\)/);
    // update, never insert: marketcheck-sync already creates the file row, and
    // a crawler-created row would have no year/make/model on it.
    expect(source).not.toMatch(/from\("vehicle_files"\)\.insert/);
  });

  it("only trusts the dealer's own site", () => {
    // A marketplace page shows the marketplace's listing id, not the store's
    // stock number.
    const block = source.slice(source.indexOf("The dealer's stock number, when their own page"));
    expect(block.slice(0, 900)).toMatch(/source_label \|\| ""\) === "website"/);
  });

  it("never fails a price run over it", () => {
    const block = source.slice(source.indexOf("const stock = extractStockNumber("));
    expect(block.slice(0, 400)).toMatch(/catch \{/);
  });
});
