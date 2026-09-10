import { describe, it, expect } from "vitest";
import {
  VERDICT_PRESENTATION, TONE_CLASSES, presentVerdict, presentLegacyPosition,
  presentMarketView, capToneForConfidence, toneClasses,
} from "./presentation.ts";
import { LEGACY_POSITIONS } from "./surfaceCompat.ts";
import type { MarketConfidence } from "./types.ts";

const VERDICTS = Object.keys(VERDICT_PRESENTATION);
const CONFIDENCES: MarketConfidence[] = ["high", "medium", "low", "unavailable"];

describe("one presentation for every verdict", () => {
  it("covers all eight engine verdicts", () => {
    expect(VERDICTS).toHaveLength(8);
    for (const v of VERDICTS) {
      const p = VERDICT_PRESENTATION[v];
      expect(p.code, v).toBeTruthy();
      expect(p.label, v).toBeTruthy();
      expect(p.colorToken, v).toBe(`market.${p.tone}`);
      expect(p.explanation.length, v).toBeGreaterThan(20);
    }
  });

  it("gives every tone a class set", () => {
    for (const tone of ["positive", "neutral", "caution", "negative"] as const) {
      expect(TONE_CLASSES[tone].badge).toBeTruthy();
      expect(TONE_CLASSES[tone].text).toBeTruthy();
      expect(TONE_CLASSES[tone].dot).toBeTruthy();
    }
  });

  it("falls back to limited evidence, never to a positive claim", () => {
    for (const junk of [null, undefined, "", "Something Invented"]) {
      const p = presentVerdict(junk, "high");
      expect(p.code).toBe("limited");
      expect(p.tone).toBe("neutral");
    }
  });
});

describe("confidence caps tone at the pixel", () => {
  it("low and unavailable are always neutral", () => {
    for (const verdict of VERDICTS) {
      for (const confidence of ["low", "unavailable"] as const) {
        expect(presentVerdict(verdict, confidence).tone, `${verdict}/${confidence}`).toBe("neutral");
      }
    }
  });

  it("medium can never render negative", () => {
    for (const verdict of VERDICTS) {
      expect(presentVerdict(verdict, "medium").tone, verdict).not.toBe("negative");
    }
  });

  it("only high confidence reaches negative, and only for the one verdict that earns it", () => {
    const negatives = VERDICTS.filter((v) => presentVerdict(v, "high").tone === "negative");
    expect(negatives).toEqual(["Above Adjusted Market"]);
  });

  it("caps directly, too", () => {
    expect(capToneForConfidence("negative", "low")).toBe("neutral");
    expect(capToneForConfidence("negative", "medium")).toBe("caution");
    expect(capToneForConfidence("negative", "high")).toBe("negative");
    expect(capToneForConfidence("positive", "high")).toBe("positive");
  });

  it("covers every verdict × confidence combination without throwing", () => {
    for (const verdict of VERDICTS) {
      for (const confidence of CONFIDENCES) {
        const p = presentVerdict(verdict, confidence);
        expect(toneClasses(p.tone).badge).toBeTruthy();
      }
    }
  });
});

describe("legacy positions render through the same map", () => {
  it("handles every position production holds, including below_market and at_market", () => {
    for (const position of LEGACY_POSITIONS) {
      const p = presentLegacyPosition(position);
      expect(p.label, position).toBeTruthy();
      expect(p.classes.badge, position).toBeTruthy();
    }
    expect(presentLegacyPosition("below_market").tone).toBe("positive");
    expect(presentLegacyPosition("at_market").tone).toBe("neutral");
    expect(presentLegacyPosition("above_market").tone).toBe("caution");
  });

  it("renders an unknown or unrecognised position as neutral limited evidence", () => {
    for (const position of ["unknown", "invented", null, undefined]) {
      const p = presentLegacyPosition(position);
      expect(p.code, String(position)).toBe("limited");
      expect(p.tone, String(position)).toBe("neutral");
    }
  });

  it("never lets a stored legacy position render as red", () => {
    for (const position of [...LEGACY_POSITIONS, "invented", null]) {
      expect(presentLegacyPosition(position).tone, String(position)).not.toBe("negative");
    }
  });
});

describe("presentMarketView", () => {
  it("returns label, tone, colour token, icon, explanation and classes together", () => {
    const p = presentMarketView({ verdict: "Above Adjusted Market", confidence: "high" });
    expect(p.label).toBe("Above adjusted market");
    expect(p.tone).toBe("negative");
    expect(p.colorToken).toBe("market.negative");
    expect(p.iconToken).toBe("alert");
    expect(p.classes.badge).toBe(TONE_CLASSES.negative.badge);
  });

  it("neutralises the same verdict at low confidence", () => {
    const p = presentMarketView({ verdict: "Above Adjusted Market", confidence: "low" });
    expect(p.tone).toBe("neutral");
    expect(p.classes.badge).toBe(TONE_CLASSES.neutral.badge);
  });
});
