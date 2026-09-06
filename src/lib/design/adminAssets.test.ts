import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_ASSETS, adminAsset, adminAssetsByCategory } from "./adminAssets";

// The pack's manifest addresses icons at paths the archive does not use
// (02_ICONS_BARE vs 02_MASTER_SVG/A_BARE_NO_BACKGROUND), so a map built by
// trusting it would carry 264 paths that 404 only once a screen renders.

const root = join(__dirname, "../../..");
const assets = Object.values(ADMIN_ASSETS);

describe("every mapped asset is actually on disk", () => {
  it("installs the whole manifest", () => {
    expect(assets.length).toBe(264);
  });

  it("resolves every path", () => {
    const missing = assets
      .filter((a) => !existsSync(join(root, "public", a.path.replace(/^\//, ""))))
      .map((a) => `${a.id} ${a.path}`);
    expect(missing).toEqual([]);
  });

  it("keys each asset by its manifest id", () => {
    for (const [key, a] of Object.entries(ADMIN_ASSETS)) expect(a.id).toBe(key);
    expect(adminAsset("010A")?.name).toBe("Home");
    expect(adminAsset("999Z")).toBeUndefined();
  });

  it("carries the categories the placement map references", () => {
    for (const c of ["Navigation", "Service", "Vehicle & Inventory", "Compliance"]) {
      expect(adminAssetsByCategory(c).length, c).toBeGreaterThan(0);
    }
  });
});

const read = (path: string) => readFileSync(join(root, "public", path.replace(/^\//, "")), "utf8");

describe("icons are styleable rather than pre-coloured", () => {
  const icons = assets.filter((a) => a.path.includes("/icons/"));

  it("ships the currentColor variant, not the hardcoded blue", () => {
    // A file with stroke="#2563EB" cannot be dimmed when disabled, inverted on
    // the navy rail, or turned amber for an attention state.
    expect(icons.length).toBe(118);
    for (const a of icons) {
      const svg = read(a.path);
      expect(svg, a.id).toContain('stroke="currentColor"');
      expect(svg, a.id).not.toContain("#2563EB");
    }
  });

  it("contains no gradients, filters or glow", () => {
    // Section 6 of the pack instructions, enforced rather than trusted.
    for (const a of icons) {
      const svg = read(a.path).toLowerCase();
      for (const banned of ["<lineargradient", "<radialgradient", "<filter", "feGaussianBlur".toLowerCase()]) {
        expect(svg, `${a.id} contains ${banned}`).not.toContain(banned);
      }
    }
  });

  it("records the semantic colour it was drawn in rather than baking it", () => {
    // 31 icons shipped with a hardcoded semantic stroke. The file is now
    // styleable and the intent is data, so a component can honour it for a
    // real state and ignore it when the icon is merely a label.
    const hinted = icons.filter((a) => a.semanticHint);
    expect(hinted.length).toBe(31);
    for (const a of hinted) expect(a.semanticHint).toMatch(/^#[0-9A-F]{6}$/);
    expect(adminAsset("054A")?.semanticHint).toBe("#16A34A");
  });

  it("keeps one consistent stroke weight", () => {
    const weights = new Set(icons.map((a) => read(a.path).match(/stroke-width="([\d.]+)"/)?.[1]));
    expect([...weights]).toEqual(["1.8"]);
  });
});

describe("the brand files are untouched", () => {
  it("keeps the official lockups and marks", () => {
    const brand = adminAssetsByCategory("Brand");
    expect(brand.length).toBe(6);
    // "do not recolor" — the reverse assets legitimately carry their own
    // colours, so these are excluded from the currentColor rule above.
    for (const a of brand) expect(read(a.path)).toContain("<svg");
  });
});

describe("soft tiles stay the exception", () => {
  it("are a separate set, not the default icon", () => {
    const tiles = assets.filter((a) => a.path.includes("/tiles/"));
    expect(tiles.length).toBe(118);
    // Tiles carry a background; that is what makes them tiles and why the
    // instructions restrict them to a few high-value entry points.
    expect(read(tiles[0].path)).toMatch(/<rect|<circle/);
  });
});
