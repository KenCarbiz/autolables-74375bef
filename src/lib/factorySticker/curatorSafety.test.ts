import { describe, it, expect } from "vitest";
import { curateEquipment } from "./equipmentNoise";
import { findTechnology, findForeignTechnology } from "./oemTechnology";
import { technologyOwners } from "./oemTerminology";

// The August 3 audit's validation matrix, executable.
//
// Two failure modes were being conflated. Printing a rival's system verbatim
// ("AKG Studio Reference" on a GMC) is obvious once you look. Renaming it into
// the local marque's vocabulary ("ProPILOT Assist" arriving on a Lexus and
// printing as that Lexus's own cruise term) is the same false claim, but it
// looks correct — which makes it the more dangerous of the two. Both are
// asserted here, and the second is asserted by NAME: it is not enough that the
// foreign string is gone, its inferred local replacement must be gone too.

const names = (make: string, rows: string[]) =>
  curateEquipment(rows, { make }).items.map((i) => i.name);
const printed = (make: string, rows: string[]) => names(make, rows).join(" | ");

describe("a rival's technology is quarantined, not printed and not translated", () => {
  it("drops Cadillac audio from a GMC", () => {
    const r = curateEquipment(["AKG Studio Reference"], { make: "GMC" });
    expect(r.items).toHaveLength(0);
    expect(r.quarantined).toContain("AKG Studio Reference");
    expect(r.foreign[0].owner).toBe("cadillac");
  });

  it("drops Nissan ProPILOT from a Lexus WITHOUT renaming it", () => {
    const out = printed("Lexus", ["ProPILOT Assist"]);
    expect(out).not.toMatch(/propilot/i);
    // The laundering path: ProPILOT matches the adaptive-cruise concept, so a
    // foreign row that reached concept matching came out as the Lexus term.
    expect(out).not.toMatch(/cruise/i);
    expect(out).toBe("");
  });

  it("drops a GM trailering system from a Lexus without inventing a substitute", () => {
    const out = printed("Lexus", ["Advanced Trailering System"]);
    expect(out).not.toMatch(/trailer/i);
    expect(out).not.toMatch(/straight path/i);
    expect(out).toBe("");
  });

  it("drops Mark Levinson from an Infiniti without demoting it to a generic claim", () => {
    const out = printed("INFINITI", ["Mark Levinson Premium Audio"]);
    expect(out).not.toMatch(/mark levinson/i);
    expect(out).not.toMatch(/premium audio/i);
  });

  it("reports quarantine so the sticker can be held for review", () => {
    const r = curateEquipment(["ProPILOT Assist", "Heated Seats"], { make: "Lexus" });
    expect(r.quarantined).toEqual(["ProPILOT Assist"]);
    expect(r.items.map((i) => i.name)).toContain("Heated Seats");
  });
});

describe("corporate ownership is not permission to print a sibling's name", () => {
  it("does not let Lexus inherit Toyota naming", () => {
    expect(technologyOwners("lexus")).not.toContain("toyota");
    expect(findTechnology("Toyota Safety Sense", "lexus")).toBeUndefined();
    expect(printed("Lexus", ["Toyota Safety Sense"])).not.toMatch(/toyota/i);
    expect(printed("Lexus", ["Toyota Audio Multimedia"])).not.toMatch(/toyota/i);
  });

  it("does not let Infiniti inherit Nissan naming", () => {
    expect(technologyOwners("infiniti")).not.toContain("nissan");
    expect(printed("INFINITI", ["Nissan Safety Shield 360"])).not.toMatch(/nissan/i);
  });

  it("still lets a GM marque print GM-tier technology", () => {
    // The counterweight. GMC genuinely prints OnStar and IntelliBeam, so
    // narrowing ownership must not quarantine a marque's own equipment.
    expect(technologyOwners("gmc")).toContain("gm");
    for (const n of ["OnStar", "IntelliBeam", "Super Cruise"]) {
      expect(findForeignTechnology(n, "gmc"), `${n} wrongly foreign on GMC`).toBeUndefined();
    }
    expect(printed("GMC", ["OnStar"])).toMatch(/onstar/i);
  });
});

describe("a source may only support an equal-or-weaker claim", () => {
  const cases: Array<[string, string, RegExp, RegExp]> = [
    // make, source row, must contain, must NOT contain
    ["GMC", "Forward Collision Warning", /forward collision warning/i, /emergency brak/i],
    ["Lexus", "Lane Departure Warning", /lane departure/i, /(keep|steering assist|intervention)/i],
    ["INFINITI", "Lane Departure Warning", /lane departure/i, /intelligent lane intervention/i],
    ["GMC", "Dusk Sensor", /headlamp/i, /(intellibeam|high beam)/i],
    ["GMC", "Headlights-Low Beam", /headlamp/i, /\bLED\b/],
    ["GMC", "Illuminated Step", /running boards/i, /(power|retract)/i],
    ["GMC", "Speed Limiter", /speed limiter/i, /cruise/i],
  ];
  it.each(cases)("%s: %s never strengthens", (make, row, want, unwanted) => {
    const out = printed(make, [row]);
    expect(out).toMatch(want);
    expect(out).not.toMatch(unwanted);
  });

  it("still prints the strong claim when the row genuinely evidences it", () => {
    expect(printed("GMC", ["Automatic Emergency Braking"])).toMatch(/emergency brak/i);
    expect(printed("GMC", ["Forward Collision Warning with Automatic Braking"])).toMatch(/brak/i);
    expect(printed("Lexus", ["Lane Keep Assist"])).toMatch(/lane keep|lane departure alert/i);
    expect(printed("GMC", ["Power-Retractable Assist Steps"])).toMatch(/power|retract/i);
  });

  it("keeps a warning row and a braking row as separate claims", () => {
    // Bucketing on the rule rather than the evidence level let whichever row
    // arrived first decide the label for both.
    const out = names("GMC", ["Forward Collision Warning", "Automatic Emergency Braking"]);
    expect(out.some((n) => /warning/i.test(n))).toBe(true);
    expect(out.some((n) => /brak/i.test(n))).toBe(true);
  });
});

describe("Apple CarPlay does not imply Android Auto", () => {
  it("prints only the platform the source names", () => {
    const out = printed("GMC", ["Apple CarPlay"]);
    expect(out).not.toMatch(/android/i);
  });
});

describe("ordinary equipment is unharmed", () => {
  it("still curates a normal list", () => {
    const out = names("GMC", [
      "Heated Front Seats", "Blind Spot Monitor", "Blind-Spot Monitoring", "Rear View Camera",
    ]);
    expect(out).toContain("Heated Front Seats");
    // The duplicate spelling still collapses to one row.
    expect(out.filter((n) => /blind/i.test(n))).toHaveLength(1);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves an uncatalogued row alone rather than dropping it", () => {
    expect(printed("GMC", ["Front Bucket Seats"])).toMatch(/front bucket seats/i);
  });
});
