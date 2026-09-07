import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The visual changeover reaches the app through the semantic tokens, not
// through shared components: only 8 of 113 pages import a shadcn primitive,
// while bg-card / border-border / text-muted-foreground and friends are used
// roughly 7,100 times across the hand-styled rest.
//
// So the palette is the lever -- and editing :root would have carried straight
// into the customer Vehicle Passport, which is owner-approved and locked.

const css = readFileSync(join(__dirname, "../../index.css"), "utf8");
const shell = readFileSync(
  join(__dirname, "../../components/layout/AppShell.tsx"), "utf8");
const passport = readFileSync(
  join(__dirname, "../../pages/VehiclePassportGoverned.tsx"), "utf8");

const scope = css.slice(css.indexOf(".al-admin {"), css.indexOf(".dark {"));

describe("the admin palette is scoped, not global", () => {
  it("is applied on the admin shell", () => {
    expect(shell).toMatch(/className="al-admin min-h-screen bg-background/);
  });

  it("keeps the locked passport out of reach structurally", () => {
    // Not by being careful — the passport renders outside this shell, so it
    // cannot pick the scope up even if someone edits it later.
    expect(passport).not.toMatch(/al-admin/);
    expect(scope.length).toBeGreaterThan(200);
  });

  it("overrides the tokens the hand-styled pages actually use", () => {
    for (const t of ["--background", "--card", "--foreground",
                     "--muted-foreground", "--border", "--radius"]) {
      expect(scope, `scope is missing ${t}`).toContain(`${t}:`);
    }
  });

  it("does not redefine the brand hues", () => {
    // The changeover is a ramp, not a rebrand: primary stays Autocurb blue
    // and the accent family is untouched, so badges, charts and status chips
    // keep meaning what they meant.
    expect(scope).not.toContain("--primary:");
    expect(scope).not.toContain("--destructive:");
    expect(scope).not.toContain("--navy:");
  });

  it("raises secondary text above the contrast floor", () => {
    // 46% lightness on a white card sits just under 4.5:1. Secondary text is
    // most of the words on a dense admin screen.
    const m = /--muted-foreground:\s*\d+\s+\d+%\s+(\d+)%/.exec(scope);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(43);
  });

  it("leaves :root alone so every public surface is unchanged", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".al-admin {"));
    expect(root).toMatch(/--background: 220 23% 97%/);
    expect(root).toMatch(/--border: 220 13% 91%/);
  });
});
