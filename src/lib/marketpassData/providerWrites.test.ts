import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("marketcheck-sync never writes unknown miles as 0", () => {
  const src = read("supabase/functions/marketcheck-sync/index.ts");
  it("derives miles as null when the feed has none", () => {
    expect(src).toMatch(/const miles: number \| null = typeof l\.miles === "number"/);
    expect(src).not.toMatch(/: 0;\s*\n\s*\/\/?[^\n]*\n?[^\n]*const miles/);
    expect(src).not.toMatch(/Math\.round\(l\.miles\) : 0/);
  });
  it("omits the mileage key rather than writing 0", () => {
    expect(src.match(/\.\.\.\(miles != null \? \{ mileage: miles \} : \{\}\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/mileage: miles,/);
  });
});

describe("marketcheck-title-report is never clean without evidence", () => {
  const src = read("supabase/functions/marketcheck-title-report/index.ts");
  it("requires both record lists before saying clean", () => {
    expect(src).toMatch(/Array\.isArray\(raw\?\.titleBrandReported\) && Array\.isArray\(raw\?\.junkSalvageTotalLoss\)/);
    expect(src).toMatch(/hasIssue \? "branded" : recognised \? "clean" : "unknown"/);
    expect(src).not.toMatch(/hasIssue \? "branded" : "clean"/);
  });
});
