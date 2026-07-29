import { describe, it, expect } from "vitest";
import { channelAvailability, CHANNEL_META } from "./model";

// The bug this pins: vAuto is not in the default enabled_channels, but the
// Studio decided availability from the static catalog. It rendered a live
// "Generate Channel Version" button; the server regenerated the master at full
// provider cost, intersected the requested channel against the tenant's list to
// nothing, wrote no variant, and raised no error. Repeatable billing for
// nothing.

const DEFAULTS = [
  "vehicle_passport", "dealer_website", "autotrader",
  "cars_com", "cargurus", "facebook", "google_seo",
];

describe("channel availability follows the tenant, not the catalog", () => {
  it("marks vAuto not enabled under the shipped defaults", () => {
    expect(channelAvailability("vauto", DEFAULTS)).toBe("not_enabled");
  });

  it("marks vAuto available once the dealership enables it", () => {
    expect(channelAvailability("vauto", [...DEFAULTS, "vauto"])).toBe("available");
  });

  it("keeps the shipped destinations available", () => {
    for (const key of DEFAULTS) {
      expect(channelAvailability(key, DEFAULTS)).toBe("available");
    }
  });

  it("rejects a channel the catalog does not define", () => {
    expect(channelAvailability("craigslist", DEFAULTS)).toBe("unknown_channel");
  });

  it("does not blank the grid before settings load", () => {
    // An empty list is "not loaded yet", not "everything is off". Showing a
    // card the server may still refuse beats showing an empty screen.
    for (const key of DEFAULTS) {
      expect(channelAvailability(key, [])).toBe("available");
    }
    expect(channelAvailability("vauto", [])).toBe("available");
  });

  it("covers every catalog entry with a defined verdict", () => {
    for (const m of CHANNEL_META) {
      expect(["available", "not_enabled"]).toContain(channelAvailability(m.key, DEFAULTS));
    }
  });

  it("treats vAuto as a real catalog entry, not a stray key", () => {
    // vAuto must stay in the catalog even while disabled by default, or the
    // dealership has no way to turn it on.
    expect(CHANNEL_META.some((m) => m.key === "vauto")).toBe(true);
  });
});
