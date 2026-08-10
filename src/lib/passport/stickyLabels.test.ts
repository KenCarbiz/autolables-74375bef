import { describe, it, expect } from "vitest";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";

// A dealer's saved config stores the LABEL, not just the key, and a stored
// label wins over the catalog. So a store that enabled this button before the
// rename kept showing "Reserve This Vehicle" forever — code changes could not
// reach it. Retired wording now falls back to the catalog; a genuinely custom
// label still wins.

const cfg = (label: string): StickyBottomButtons => ({
  enabled: true,
  primary_key: "reserve",
  buttons: [{ key: "reserve", label, enabled: true, order: 0 }],
});

const labelOf = (c: StickyBottomButtons) => resolveStickyButtons(c).items[0]?.label;

describe("retired CTA wording heals itself", () => {
  it("replaces a stored label that promised the car was already held", () => {
    for (const retired of ["Reserve This Vehicle", "Reserve Vehicle", "Request Hold", "Request a Hold"]) {
      expect(labelOf(cfg(retired)), retired).toBe("Request Vehicle Hold");
    }
  });

  it("matches regardless of casing or padding, since dealers typed these by hand", () => {
    for (const retired of ["reserve this vehicle", "  RESERVE VEHICLE  ", "Request  Hold".replace("  ", " ")]) {
      expect(labelOf(cfg(retired)), retired).toBe("Request Vehicle Hold");
    }
  });

  it("keeps a label the dealer actually wrote themselves", () => {
    expect(labelOf(cfg("Hold This One For Me"))).toBe("Hold This One For Me");
    expect(labelOf(cfg("Reserve Your Test Drive"))).toBe("Reserve Your Test Drive");
  });

  it("falls back to the catalog when no label was stored", () => {
    expect(labelOf(cfg(""))).toBe("Request Vehicle Hold");
  });

  it("leaves every other button alone", () => {
    const c: StickyBottomButtons = {
      enabled: true, primary_key: "call",
      buttons: [{ key: "call", label: "Ring Us", enabled: true, order: 0 }],
    };
    expect(resolveStickyButtons(c).items[0].label).toBe("Ring Us");
  });
});
