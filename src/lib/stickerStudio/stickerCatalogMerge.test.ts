import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_SATURDAY_TEMPLATES } from "./saturdayTemplates";

// A dealer could not find the New Car SaaS addendum in the Sticker Studio even
// though its renderer shipped in the build. The catalog hook replaced the
// entire built-in list the moment sticker_templates returned any active row, so
// a template with no row was silently dropped from the picker — invisible, with
// nothing to indicate it existed.
//
// The DB is allowed to OVERRIDE a built-in and to ADD to the list. It is not
// allowed to remove one that has a live renderer.

const hook = readFileSync(join(__dirname, "useStickerCatalog.ts"), "utf8");

describe("the template catalog merges, never replaces", () => {
  it("keeps built-ins that have no database row", () => {
    expect(hook).toMatch(/new Map\(BUILT_IN_TEMPLATES\.map/);
    expect(hook).toMatch(/for \(const t of built\) byKey\.set\(t\.config\.id, t\)/);
    // The old behaviour: setTemplates(built) with no merge.
    expect(hook).not.toMatch(/setTemplates\(built\)/);
  });

  it("lets a database row win for the same template id", () => {
    // built is applied AFTER the built-ins are seeded into the map, so a row
    // with a matching id overwrites rather than duplicating.
    expect(hook.indexOf("BUILT_IN_TEMPLATES.map")).toBeLessThan(hook.indexOf("for (const t of built)"));
  });
});

describe("both V2 addendums are registered and pickable", () => {
  for (const [id, name] of [
    ["addendum-saturday-premium", "Saturday Premium Addendum V2"],
    ["addendum-new-car-saas", "New Car SaaS Template V2"],
  ] as const) {
    it(`${id} is in the built-in registry as "${name}"`, () => {
      const t = STUDIO_SATURDAY_TEMPLATES.find((x) => x.config.id === id);
      expect(t, `${id} missing from the studio registry`).toBeDefined();
      expect(t!.config.name).toBe(name);
      // The registry and the printed sheet must agree on the page size; they
      // disagreed for months (config 4.5x11, component 4.25in).
      expect(t!.config.size).toBe("4.5x11");
      expect(t!.config.widthIn).toBe(4.5);
      expect(t!.config.heightIn).toBe(11);
    });
  }

  it("seeds both rows in the dealer-visible catalog", () => {
    const sql = readFileSync(
      join(__dirname, "../../../supabase/migrations/20260811090000_seed_addendum_v2_templates.sql"),
      "utf8",
    );
    for (const key of ["addendum-saturday-premium", "addendum-new-car-saas"]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toContain("ON CONFLICT (template_key) DO UPDATE");
    // A stale row must not be able to re-hide the template.
    expect(sql).toMatch(/is_active\s*=\s*true/);
    expect(sql).not.toMatch(/'size',\s*'4\.25x11'/);
    expect((sql.match(/'4\.5x11'/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
