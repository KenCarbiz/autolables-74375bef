import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const greatBuy = read("src/pages/VehiclePassportGreatBuy.tsx");

describe("the Great Buy page no longer renders a price-blended score or verdict", () => {
  it("never reads the blended overall", () => {
    expect(greatBuy).not.toMatch(/rating\.overall/);
    expect(greatBuy).not.toMatch(/ratingTier|scoreTier|ScoreRing|MiniDonut|PrintRing/);
  });

  it("emits none of the tier or confidence verdict strings", () => {
    for (const s of [
      "Exceptional Buy Candidate", "Strong Buy Candidate", "Solid Buy Candidate", "Move Forward with Confidence",
      "Strong Candidate", "Exceptional Candidate", "Vehicle Score", "VEHICLE SCORE", "Buying Score Breakdown",
      "Score pending verification", "ranks among the stronger vehicles", "supports moving forward",
    ]) expect(greatBuy.includes(s), s).toBe(false);
    expect(greatBuy).not.toMatch(/\/100/);
  });

  it("does not stand per-factor numbers in for a verdict", () => {
    const card = greatBuy.slice(greatBuy.indexOf("const ScoreCard"), greatBuy.indexOf("const ratingLabel"));
    expect(card).not.toMatch(/\{score\}/);
    expect(greatBuy).not.toMatch(/\{b\.score\}/);
    expect(greatBuy).toMatch(/const ratingLabel = \(s: number \| null\) => s == null \? "Confirm" : "Measured";/);
  });

  it("keeps the per-factor evidence lines", () => {
    expect(greatBuy).toMatch(/evidence\.map\(\(e\) => <li key=\{e\}/);
    expect(greatBuy).toMatch(/Confirm Before Purchase/);
  });
});

describe("no other customer surface renders the blended overall", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { if (!/admin/i.test(rel)) walk(rel); continue; }
      if (/\.tsx$/.test(e) && !/\.test\./.test(e) && !/VehiclePassportV3\.tsx$/.test(e)) files.push(rel);
    }
  };
  walk("src/pages");
  walk("src/components");

  it("no page or component reads the unified rating overall or a tier of it", () => {
    const hits = files.filter((f) => /\b(rating|r)\.overall\b/.test(read(f)) && /deriveRating/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("no customer file labels a figure 'Confidence Score' or 'AutoLabels Confidence'", () => {
    const hits = files.filter((f) => /AutoLabels Confidence|Confidence Score/.test(read(f)) && !/saturday/i.test(f));
    expect(hits).toEqual([]);
  });
});
