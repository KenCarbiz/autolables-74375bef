import { describe, it, expect } from "vitest";
import {
  validateStickyButtons,
  resolveStickyButtons,
  DEFAULT_STICKY_BUTTONS,
  MAX_STICKY_BUTTONS,
  type StickyBottomButtons,
} from "./stickyButtons";

const cfg = (over: Partial<StickyBottomButtons> = {}): StickyBottomButtons => ({
  enabled: true,
  primary_key: "call",
  buttons: [{ key: "call", label: "Call", enabled: true, order: 1 }],
  ...over,
});

describe("validateStickyButtons", () => {
  it("accepts a valid config", () => {
    expect(validateStickyButtons(cfg())).toBeNull();
  });

  it("rejects an enabled bar with no enabled buttons", () => {
    expect(validateStickyButtons(cfg({ buttons: [{ key: "call", label: "Call", enabled: false, order: 1 }] })))
      .toMatch(/at least one/i);
  });

  it("allows zero enabled buttons when the bar itself is off", () => {
    expect(validateStickyButtons(cfg({ enabled: false, buttons: [{ key: "call", label: "Call", enabled: false, order: 1 }] })))
      .toBeNull();
  });

  it("rejects more than the max number of buttons", () => {
    const buttons = ["call", "text", "test_drive", "todays_price", "directions"].map((key, i) => ({
      key, label: key, enabled: true, order: i + 1,
    }));
    expect(validateStickyButtons(cfg({ buttons }))).toMatch(new RegExp(`${MAX_STICKY_BUTTONS}`));
  });

  it("rejects an unrecognized button key", () => {
    expect(validateStickyButtons(cfg({ buttons: [{ key: "frobnicate", label: "x", enabled: true, order: 1 }], primary_key: "frobnicate" })))
      .toMatch(/not recognized/i);
  });

  it("rejects a primary key that is not among the enabled buttons", () => {
    expect(validateStickyButtons(cfg({ primary_key: "text" }))).toMatch(/primary/i);
  });
});

describe("resolveStickyButtons", () => {
  it("falls back to the default set when given nothing", () => {
    const r = resolveStickyButtons(undefined);
    expect(r.enabled).toBe(true);
    expect(r.items).toHaveLength(4);
    expect(r.items.find((i) => i.primary)?.key).toBe("todays_price");
  });

  it("falls back to the default set for an empty config", () => {
    expect(resolveStickyButtons(null).items).toHaveLength(DEFAULT_STICKY_BUTTONS.buttons.length);
  });

  it("returns nothing when the bar is explicitly disabled", () => {
    expect(resolveStickyButtons(cfg({ enabled: false }))).toEqual({ items: [], enabled: false });
  });

  it("drops disabled and unrecognized buttons", () => {
    const r = resolveStickyButtons(cfg({
      primary_key: "call",
      buttons: [
        { key: "call", label: "Call", enabled: true, order: 1 },
        { key: "text", label: "Text", enabled: false, order: 2 },
        { key: "bogus", label: "Bogus", enabled: true, order: 3 },
      ],
    }));
    expect(r.items.map((i) => i.key)).toEqual(["call"]);
  });

  it("orders by the order field and caps at the max", () => {
    const buttons = [
      { key: "directions", label: "Directions", enabled: true, order: 5 },
      { key: "call", label: "Call", enabled: true, order: 1 },
      { key: "text", label: "Text", enabled: true, order: 2 },
      { key: "test_drive", label: "Test Drive", enabled: true, order: 3 },
      { key: "todays_price", label: "Today's Price", enabled: true, order: 4 },
    ];
    const r = resolveStickyButtons(cfg({ primary_key: "call", buttons }));
    expect(r.items).toHaveLength(MAX_STICKY_BUTTONS);
    expect(r.items.map((i) => i.key)).toEqual(["call", "text", "test_drive", "todays_price"]);
  });

  it("promotes the last button to primary when none matches the primary key", () => {
    const r = resolveStickyButtons(cfg({
      primary_key: "share_vehicle", // not among the enabled buttons
      buttons: [
        { key: "call", label: "Call", enabled: true, order: 1 },
        { key: "text", label: "Text", enabled: true, order: 2 },
      ],
    }));
    expect(r.items.filter((i) => i.primary)).toHaveLength(1);
    expect(r.items[r.items.length - 1].primary).toBe(true);
  });

  it("falls back to the catalog label when a button has no label", () => {
    const r = resolveStickyButtons(cfg({
      primary_key: "call",
      buttons: [{ key: "call", label: "", enabled: true, order: 1 }],
    }));
    expect(r.items[0].label).toBe("Call");
  });
});
