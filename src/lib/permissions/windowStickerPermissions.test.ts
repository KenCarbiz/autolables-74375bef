import { describe, expect, it } from "vitest";
import {
  WINDOW_STICKER_PERMISSIONS,
  hasWindowStickerPermission,
  windowStickerPermissions,
} from "./windowStickerPermissions";

describe("window sticker permissions", () => {
  it("gives a platform admin every permission", () => {
    const perms = windowStickerPermissions(null, true);
    for (const p of WINDOW_STICKER_PERMISSIONS) expect(perms, p).toContain(p);
  });

  it("gives an owner every permission", () => {
    const perms = windowStickerPermissions("owner");
    for (const p of WINDOW_STICKER_PERMISSIONS) expect(perms, p).toContain(p);
  });

  it("lets a used car manager approve, publish and restore but not override source data", () => {
    for (const p of [
      "window_sticker.regenerate", "window_sticker.approve", "window_sticker.publish",
      "window_sticker.unpublish", "window_sticker.restore_version", "window_sticker.refresh_neovin",
    ] as const) {
      expect(hasWindowStickerPermission("used_car_manager", p), p).toBe(true);
    }
    expect(hasWindowStickerPermission("used_car_manager", "window_sticker.override_source_data")).toBe(false);
  });

  it("lets a sales manager request a regeneration but never publish or bill the provider", () => {
    expect(hasWindowStickerPermission("sales_manager", "window_sticker.regenerate")).toBe(true);
    expect(hasWindowStickerPermission("sales_manager", "window_sticker.view_history")).toBe(true);
    for (const p of [
      "window_sticker.approve", "window_sticker.publish", "window_sticker.refresh_neovin",
      "window_sticker.restore_version", "window_sticker.override_source_data",
    ] as const) {
      expect(hasWindowStickerPermission("sales_manager", p), p).toBe(false);
    }
  });

  it("limits a salesperson to viewing and downloading approved documents", () => {
    expect(windowStickerPermissions("salesperson").sort())
      .toEqual(["window_sticker.download", "window_sticker.view"]);
  });

  it("keeps service roles away from pricing and template decisions", () => {
    for (const role of ["service_manager", "service_advisor"]) {
      for (const p of [
        "window_sticker.regenerate", "window_sticker.edit_permitted_fields",
        "window_sticker.override_source_data", "window_sticker.refresh_neovin",
        "window_sticker.approve", "window_sticker.publish",
      ] as const) {
        expect(hasWindowStickerPermission(role, p), `${role}/${p}`).toBe(false);
      }
      expect(hasWindowStickerPermission(role, "window_sticker.view"), role).toBe(true);
    }
    expect(windowStickerPermissions("detail")).toEqual([]);
    expect(windowStickerPermissions("third_party_vendor")).toEqual([]);
  });

  it("grants nothing without a role", () => {
    expect(windowStickerPermissions(null)).toEqual([]);
    expect(windowStickerPermissions("")).toEqual([]);
    expect(windowStickerPermissions(undefined)).toEqual([]);
  });

  it("is case and whitespace insensitive on the role name", () => {
    expect(hasWindowStickerPermission("  Used_Car_Manager ", "window_sticker.publish")).toBe(true);
  });

  it("defaults an unknown role to view-only rather than to full access", () => {
    expect(windowStickerPermissions("lot_porter").sort())
      .toEqual(["window_sticker.download", "window_sticker.view"]);
  });
});
