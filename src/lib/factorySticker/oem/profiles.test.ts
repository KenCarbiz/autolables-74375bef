import { describe, expect, it } from "vitest";
import { listProfiles, resolveThemeProfile } from "./profiles";
import { THEME_REGISTRY } from "./themes";

describe("OEM theme profiles", () => {
  it("resolves INFINITI 2025 to the approved versioned profile", () => {
    const r = resolveThemeProfile("INFINITI", 2025);
    expect(r.resolution).toBe("EXACT");
    expect(r.profile.themeVersion).toBe("infiniti-us-2025-v1");
    expect(r.profile.layoutFamily).toBe("premium-minimalist");
    expect(r.profile.status).toBe("approved");
    expect(r.theme.oemId).toBe("INFINITI");
  });

  it("resolves Nissan to the mainstream-structured reviewed profile", () => {
    const r = resolveThemeProfile("Nissan", 2025);
    expect(r.profile.themeVersion).toBe("nissan-us-2025-v1");
    expect(r.profile.layoutFamily).toBe("mainstream-structured");
    expect(r.theme.oemId).toBe("NISSAN");
  });

  it("keeps brands distinct from corporate parents", () => {
    expect(resolveThemeProfile("GMC", 2024).theme.oemId).toBe("GMC");
    expect(resolveThemeProfile("Chevrolet", 2024).theme.oemId).toBe("CHEVROLET");
    expect(resolveThemeProfile("Genesis", 2024).theme.oemId).toBe("GENESIS");
    expect(resolveThemeProfile("Ram", 2024).theme.oemId).toBe("RAM");
    expect(resolveThemeProfile("Dodge", 2024).theme.oemId).toBe("DODGE");
  });

  it("is model-year aware: years outside an authored range fall back", () => {
    const r = resolveThemeProfile("INFINITI", 2010);
    expect(r.profile.status).toBe("fallback");
    expect(r.theme.oemId).toBe("INFINITI");
  });

  it("unknown makes resolve to the AutoLabels fallback profile", () => {
    const r = resolveThemeProfile("Zoomcar", 2025);
    expect(r.resolution).toBe("FALLBACK");
    expect(r.profile.status).toBe("fallback");
  });

  it("serves a profile for every registered theme, none logo-authorized yet", () => {
    const profiles = listProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(Object.keys(THEME_REGISTRY).length);
    for (const p of profiles) {
      expect(p.logoAuthorized).toBe(false);
      expect(["approved", "reviewed", "draft", "fallback", "retired"]).toContain(p.status);
    }
  });
});

describe("governed logo assets", () => {
  it("serves recreated emblems for Chevrolet, BMW and Lexus pending authorization", async () => {
    const { getLogoAsset } = await import("./logoAssets");
    for (const id of ["CHEVROLET", "BMW", "LEXUS"]) {
      const asset = getLogoAsset(id);
      expect(asset).not.toBeNull();
      expect(asset!.status).toBe("recreated_pending_authorization");
      const m = asset!.render(24);
      expect(m.paths.length).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThanOrEqual(24);
      for (const p of m.paths) expect(p.d.length).toBeGreaterThan(10);
    }
    expect(getLogoAsset("TOYOTA")).toBeNull();
  });
});
