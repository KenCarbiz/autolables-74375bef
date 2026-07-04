import { describe, it, expect } from "vitest";
import { packetVisible, PACKET_MODULES } from "./packetModules";

describe("PACKET_MODULES", () => {
  it("exposes a stable, non-empty catalog with unique ids", () => {
    expect(PACKET_MODULES.length).toBeGreaterThan(0);
    const ids = PACKET_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("photos");
    expect(ids).toContain("documents");
  });
});

describe("packetVisible", () => {
  it("shows a module by default (no config)", () => {
    expect(packetVisible({ packet_modules: null }, "photos")).toBe(true);
    expect(packetVisible({}, "photos")).toBe(true);
  });

  it("shows a module that is absent from the config map", () => {
    expect(packetVisible({ packet_modules: { videos: false } }, "photos")).toBe(true);
  });

  it("hides a module only when explicitly set to false", () => {
    expect(packetVisible({ packet_modules: { photos: false } }, "photos")).toBe(false);
  });

  it("shows a module explicitly set to true", () => {
    expect(packetVisible({ packet_modules: { photos: true } }, "photos")).toBe(true);
  });

  it("shows everything when the listing is null/undefined", () => {
    expect(packetVisible(null, "photos")).toBe(true);
    expect(packetVisible(undefined, "photos")).toBe(true);
  });

  it("falls back to the store default when the vehicle has no override", () => {
    expect(packetVisible({ packet_defaults: { photos: false } }, "photos")).toBe(false);
    expect(packetVisible({ packet_modules: {}, packet_defaults: { photos: false } }, "photos")).toBe(false);
    expect(packetVisible({ packet_defaults: { photos: true } }, "photos")).toBe(true);
  });

  it("lets a vehicle override beat the store default in both directions", () => {
    expect(packetVisible({ packet_modules: { photos: true }, packet_defaults: { photos: false } }, "photos")).toBe(true);
    expect(packetVisible({ packet_modules: { photos: false }, packet_defaults: { photos: true } }, "photos")).toBe(false);
  });
});
