import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdminBrandLockup } from "./AdminBrandLockup";
import { ADMIN_ASSETS } from "@/lib/design/adminAssets";

// The admin shell gets the pack's official lockup. brand/Logo keeps every
// public surface, including VehiclePassportGoverned — the customer passport is
// owner-approved and locked, and the pack's own instructions say not to put
// these assets there to make the system look uniform.

describe("AdminBrandLockup", () => {
  it("carries one accessible name, not two images announced separately", () => {
    render(<AdminBrandLockup />);
    expect(screen.getByRole("img", { name: "AutoLabels" })).toBeInTheDocument();
  });

  it("renders both cuts and swaps them in CSS", () => {
    // Choosing in JS would paint the wrong cut before hydration and would not
    // follow a theme change without a re-render.
    const { container } = render(<AdminBrandLockup />);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].className).toContain("dark:hidden");
    expect(imgs[1].className).toContain("dark:block");
  });

  it("uses the reverse cut for the dark surface", () => {
    const { container } = render(<AdminBrandLockup variant="lockup" />);
    const [light, dark] = [...container.querySelectorAll("img")];
    expect(light.getAttribute("src")).toBe(ADMIN_ASSETS["001"].path);
    expect(dark.getAttribute("src")).toBe(ADMIN_ASSETS["002"].path);
  });

  it("keeps the standalone mark available", () => {
    const { container } = render(<AdminBrandLockup variant="mark" />);
    const [light, dark] = [...container.querySelectorAll("img")];
    expect(light.getAttribute("src")).toBe(ADMIN_ASSETS["005"].path);
    expect(dark.getAttribute("src")).toBe(ADMIN_ASSETS["006"].path);
  });

  it("references files, not inline paths", () => {
    // The pack marks the lockups "do not recolor", so unlike the icons the
    // whole point is that they keep their own colours.
    for (const id of ["001", "002", "003", "004", "005", "006"]) {
      expect(ADMIN_ASSETS[id].notes.toLowerCase()).toMatch(/recolor|surfaces|mark/);
      expect(ADMIN_ASSETS[id].path).toMatch(/^\/admin-assets\/brand\//);
    }
  });

  it("leaves the locked passport on the shared logo", () => {
    const passport = readFileSync(
      join(__dirname, "../../pages/VehiclePassportGoverned.tsx"), "utf8");
    expect(passport).toMatch(/brand\/Logo/);
    expect(passport).not.toMatch(/AdminBrandLockup|admin-assets/);
  });

  it("is what the admin shell actually renders", () => {
    // Mock 01 draws the reverse wordmark with no square app mark, and the rail
    // no longer collapses, so there is one fixed variant.
    const rail = readFileSync(
      join(__dirname, "../layout/AppRail.tsx"), "utf8");
    expect(rail).toMatch(/<AdminBrandLockup variant="wordmark" surface="dark"/);
    // The shared logo is not imported by the frame, so the two cannot drift.
    for (const file of ["AppRail.tsx", "AppShell.tsx", "AppHeader.tsx"]) {
      expect(readFileSync(join(__dirname, "../layout", file), "utf8")).not.toMatch(/import Logo from/);
    }
  });

  it("uses the reverse wordmark on the dark rail", () => {
    const { container } = render(<AdminBrandLockup variant="wordmark" surface="dark" height={24} />);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe(ADMIN_ASSETS["004"].path);
  });
});
