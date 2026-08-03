import { describe, it, expect } from "vitest";
import { resolveDealerSettings, SETTINGS_LAYERS, type LayerInput } from "./resolveSettings";

type S = Record<string, unknown>;

const L = (layer: (typeof SETTINGS_LAYERS)[number], values: S, readable = true): LayerInput<S> =>
  ({ layer, values, readable });

describe("the merged value is exactly what the spread produced", () => {
  // The whole point of this module is to add provenance WITHOUT changing a
  // single rendered value. If this drifts, dealers see different documents.
  const matrix: Array<Array<LayerInput<S>>> = [
    [L("default", { a: 1, b: 2, c: 3 })],
    [L("default", { a: 1, b: 2 }), L("saved", { a: 9 })],
    [L("default", { a: 1 }), L("autocurb_mirror", { a: 2, d: 4 }), L("local_cache", { a: 3 })],
    [L("default", { a: 1, b: 2 }), L("tenant_profile", { b: 5 }), L("onboarding_profile", { b: 6 }), L("saved", { b: 7 })],
    [L("saved", { z: 1 }), L("default", { a: 0, z: 0 })],
  ];

  it.each(matrix.map((m, i) => [i, m] as const))("case %i matches a plain spread", (_i, layers) => {
    const spread = [...layers]
      .sort((a, b) => SETTINGS_LAYERS.indexOf(a.layer) - SETTINGS_LAYERS.indexOf(b.layer))
      .reduce<S>((acc, l) => ({ ...acc, ...l.values }), {});
    expect(resolveDealerSettings(layers).settings).toEqual(spread);
  });

  it("applies layers in declared precedence regardless of argument order", () => {
    const r = resolveDealerSettings([L("saved", { a: "saved" }), L("default", { a: "default" })]);
    expect(r.settings.a).toBe("saved");
    expect(r.provenance.a.layer).toBe("saved");
  });

  it("ignores an undefined a layer offers, rather than blanking the winner", () => {
    const r = resolveDealerSettings([L("default", { a: "keep" }), L("saved", { a: undefined })]);
    expect(r.settings.a).toBe("keep");
    expect(r.provenance.a.layer).toBe("default");
  });
});

describe("a value that never reached the server is flagged, not trusted", () => {
  it("marks a cache-only value unsaved", () => {
    const r = resolveDealerSettings([L("default", { phone: "" }), L("local_cache", { phone: "860-555-0100" })]);
    expect(r.provenance.phone.unsaved).toBe(true);
    expect(r.unsavedKeys).toEqual(["phone"]);
  });

  it("does not flag a cache value the DB also carries", () => {
    // The cache is a write-through mirror, so agreeing with the DB is normal.
    const r = resolveDealerSettings([L("local_cache", { phone: "x" }), L("saved", { phone: "x" })]);
    expect(r.provenance.phone.unsaved).toBe(false);
    expect(r.provenance.phone.layer).toBe("saved");
    expect(r.unsavedKeys).toEqual([]);
  });
});

describe("an unreadable layer is never reported as an origin", () => {
  it("marks a field indeterminate when a higher layer could not be read", () => {
    const r = resolveDealerSettings([L("default", { a: "d" }), L("saved", {}, false)]);
    expect(r.provenance.a.indeterminate).toBe(true);
    expect(r.anyLayerIndeterminate).toBe(true);
  });

  it("does not mark a field indeterminate when the unreadable layer is below it", () => {
    const r = resolveDealerSettings([L("autocurb_mirror", {}, false), L("saved", { a: "s" })]);
    expect(r.provenance.a.indeterminate).toBe(false);
    // The run as a whole is still degraded, even though this field is safe.
    expect(r.anyLayerIndeterminate).toBe(true);
  });

  it("never lets an unreadable layer contribute a value", () => {
    const r = resolveDealerSettings([L("default", { a: "d" }), L("saved", { a: "leaked" }, false)]);
    expect(r.settings.a).toBe("d");
    expect(r.provenance.a.contributors).toEqual(["default"]);
  });

  it("reports a clean read as fully determinate", () => {
    const r = resolveDealerSettings([L("default", { a: 1 }), L("saved", { a: 2 })]);
    expect(r.anyLayerIndeterminate).toBe(false);
    expect(r.provenance.a.indeterminate).toBe(false);
  });
});

describe("provenance records what was overridden", () => {
  it("lists every contributing layer lowest to highest", () => {
    const r = resolveDealerSettings([
      L("default", { name: "Your Dealership" }),
      L("autocurb_mirror", { name: "Harte Infiniti" }),
      L("saved", { name: "Harte INFINITI of Wallingford" }),
    ]);
    expect(r.provenance.name.contributors).toEqual(["default", "autocurb_mirror", "saved"]);
    expect(r.provenance.name.layer).toBe("saved");
  });
});

describe("a writer is reported only when one is recorded", () => {
  it("carries the stamp for a saved key", () => {
    const r = resolveDealerSettings(
      [L("saved", { a: 1 })],
      { a: { by: "user-1", at: "2026-08-01T00:00:00Z" } },
    );
    expect(r.provenance.a.savedBy).toBe("user-1");
    expect(r.provenance.a.savedAt).toBe("2026-08-01T00:00:00Z");
  });

  it("reports a stampless saved key as writer-unknown rather than guessing", () => {
    // The legacy full-blob upsert wrote all 149 keys at once with no per-key
    // stamp. Attributing those to whoever last touched the row would be a
    // fabricated audit trail.
    const r = resolveDealerSettings([L("saved", { a: 1 })]);
    expect(r.provenance.a.layer).toBe("saved");
    expect(r.provenance.a.savedBy).toBeNull();
    expect(r.provenance.a.savedAt).toBeNull();
  });

  it("never attributes a writer to a value that is not saved", () => {
    const r = resolveDealerSettings(
      [L("default", { a: 1 })],
      { a: { by: "user-1", at: "2026-08-01T00:00:00Z" } },
    );
    expect(r.provenance.a.savedBy).toBeNull();
  });
});
