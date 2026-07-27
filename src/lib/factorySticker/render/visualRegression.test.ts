import { describe, expect, it } from "vitest";
import { adaptRenderData } from "./contract";
import { buildStickerLayout, PAGE_HEIGHT, PAGE_WIDTH, type LayoutModel } from "./layout";
import { layoutToSvg } from "./previewSvg";
import { getTheme, TEMPLATE_FAMILY_IDS, THEME_REGISTRY } from "../oem/themes";
import { resolveOem, type OemId } from "../oem/identity";
import { expectMinFontRespected, expectWithinBounds } from "./__fixtures__/layoutAsserts";
import {
  acuraRdxFixture, audiQ5Fixture, bmwFixture, buickEnvisionFixture,
  cadillacEscaladeFixture, chevroletFixture, chryslerPacificaFixture,
  dodgeDurangoFixture, genesisGv80Fixture, gmcSierraFixture, hondaPilotFixture,
  hyundaiPalisadeFixture, infinitiBenchmark, infinitiQx80NewFixture, jeepFixture,
  kiaTellurideFixture, landRoverSportFixture, lexusFixture, lincolnNautilusFixture,
  mazdaCx90Fixture, mercedesGleFixture, nissanBenchmark, porsche911Fixture, ramFixture,
  subaruOutbackFixture, teslaModelYFixture, toyotaFixture, volvoXc90Fixture,
  vwAtlasFixture, longEquipmentFixture, evFixture, noEpaFixture,
} from "./__fixtures__/renderData";
import type { FactoryStickerRenderData } from "./contract";

// Visual-regression harness.
//
// The engine is shared by every OEM template, so a change meant for one
// brand can silently move another brand's page. These snapshots capture a
// deterministic fingerprint of what each template actually draws — page
// geometry, the ink it uses, where the identity marks land, and a digest
// of the full vector output. A layout change that was not intended shows
// up here as a diff on the brand it damaged, not as a customer complaint.
//
// The fingerprint is structural rather than a raster: it survives font
// availability differences, stays diffable in review, and still fails on
// any change to a primitive's kind, position, size, colour or text.

const round = (n: number): number => Math.round(n * 100) / 100;

// FNV-1a over the canonical SVG. Any pixel-affecting change moves it.
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

interface Fingerprint {
  pages: number;
  geometry: string;
  mode: string;
  fonts: string;
  primitivesByKind: Record<string, number>;
  fills: string[];
  ruleColors: string[];
  textColors: string[];
  fontSizes: number[];
  /** Where the identity marks land — these regions must stay stable. */
  regions: Record<string, string>;
  headings: string[];
  totalBand: string | null;
  svgDigest: string[];
}

function fingerprint(model: LayoutModel): Fingerprint {
  const page = model.pages[0];
  const counts: Record<string, number> = {};
  const fills = new Set<string>();
  const ruleColors = new Set<string>();
  const textColors = new Set<string>();
  const fontSizes = new Set<number>();
  const regions: Record<string, string> = {};
  const headings: string[] = [];

  for (const p of page.primitives) {
    counts[p.kind] = (counts[p.kind] || 0) + 1;
    if (p.kind === "rect" && p.fill) fills.add(String(p.fill));
    if (p.kind === "rule") ruleColors.add(String(p.color));
    if (p.kind === "text") {
      textColors.add(String(p.color));
      fontSizes.add(round(p.size));
      if (p.weight === "bold" && p.size >= 7.5) headings.push(p.str);
    }
    if (p.kind === "barcode") {
      regions.barcode = `${round(p.x)},${round(p.y)} ${round(p.w)}x${round(p.h)}`;
    }
    if (p.kind === "qr") {
      const key = regions.qr ? "qr2" : "qr";
      regions[key] = `${round(p.x)},${round(p.y)} ${round(p.size)}`;
    }
  }

  const money = page.primitives
    .filter((p) => p.kind === "text" && /^\$[\d,]+\.\d{2}$/.test(p.str))
    .map((p) => (p.kind === "text" ? p : null))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.size - a.size)[0] ?? null;
  if (money) regions.totalMsrp = `${round(money.x)},${round(money.y)} @${round(money.size)}`;

  return {
    pages: model.pages.length,
    geometry: `${model.width}x${model.height}`,
    mode: model.mode,
    fonts: `${model.fontFamilies.heading} | ${model.fontFamilies.body} | ${model.fontFamilies.numeric}`,
    primitivesByKind: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
    fills: [...fills].sort(),
    ruleColors: [...ruleColors].sort(),
    textColors: [...textColors].sort(),
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    regions,
    headings: headings.slice(0, 24),
    totalBand: money?.str ?? null,
    svgDigest: model.pages.map((pg) => digest(layoutToSvg({ ...model, pages: [pg] }))),
  };
}

const OEM_IDS = (Object.keys(THEME_REGISTRY) as OemId[]).sort();

// One representative fixture per brand-specific template, plus the shape
// cases that historically broke layouts. Brands without their own fixture
// are still covered by the all-themes sweep below.
const BRAND_FIXTURES: Array<[string, () => FactoryStickerRenderData]> = [
  ["acura-rdx", acuraRdxFixture],
  ["audi-q5", audiQ5Fixture],
  ["bmw-530i", bmwFixture],
  ["buick-envision", buickEnvisionFixture],
  ["cadillac-escalade", cadillacEscaladeFixture],
  ["chevrolet-silverado", chevroletFixture],
  ["chrysler-pacifica", chryslerPacificaFixture],
  ["dodge-durango", dodgeDurangoFixture],
  ["genesis-gv80", genesisGv80Fixture],
  ["gmc-sierra", gmcSierraFixture],
  ["honda-pilot", hondaPilotFixture],
  ["hyundai-palisade", hyundaiPalisadeFixture],
  ["infiniti-qx80-new", infinitiQx80NewFixture],
  ["infiniti-qx80-used", infinitiBenchmark],
  ["jeep-wrangler", jeepFixture],
  ["kia-telluride", kiaTellurideFixture],
  ["land-rover-sport", landRoverSportFixture],
  ["lexus-gx550", lexusFixture],
  ["lincoln-nautilus", lincolnNautilusFixture],
  ["mazda-cx90", mazdaCx90Fixture],
  ["mercedes-gle450", mercedesGleFixture],
  ["nissan-pathfinder", nissanBenchmark],
  ["porsche-911", porsche911Fixture],
  ["ram-1500", ramFixture],
  ["subaru-outback", subaruOutbackFixture],
  ["tesla-model-y", teslaModelYFixture],
  ["toyota-grand-highlander", toyotaFixture],
  ["volvo-xc90", volvoXc90Fixture],
  ["vw-atlas", vwAtlasFixture],
  // Shape cases: maximum content, an EV with no gasoline panel, and a
  // vehicle with no EPA record at all.
  ["shape-max-equipment", longEquipmentFixture],
  ["shape-ev", evFixture],
  ["shape-no-epa", noEpaFixture],
];

describe("OEM visual regression", () => {
  it("covers every registered template with a snapshot", () => {
    // A brand added to the registry without a snapshot would ship
    // unguarded, so the sweep below is asserted to be exhaustive.
    expect(OEM_IDS.length).toBeGreaterThan(25);
    expect(new Set(BRAND_FIXTURES.map(([k]) => k)).size).toBe(BRAND_FIXTURES.length);
  });

  for (const oemId of OEM_IDS) {
    it(`${oemId} renders the shared benchmark identically`, async () => {
      // Same data through every template isolates template differences
      // from data differences: a diff here is a layout change, full stop.
      const model = buildStickerLayout(adaptRenderData(infinitiBenchmark()), getTheme(oemId));
      expect(model.width).toBe(PAGE_WIDTH);
      expect(model.height).toBe(PAGE_HEIGHT);
      expectWithinBounds(model);
      expectMinFontRespected(model);
      await expect(JSON.stringify(fingerprint(model), null, 2))
        .toMatchFileSnapshot(`./__snapshots__/template-${oemId.toLowerCase()}.json`);
    });
  }

  for (const [name, fixture] of BRAND_FIXTURES) {
    it(`${name} keeps its approved page`, async () => {
      const data = fixture();
      const model = buildStickerLayout(
        adaptRenderData(data),
        getTheme(resolveIdFor(data)),
      );
      expectWithinBounds(model);
      expectMinFontRespected(model);
      await expect(JSON.stringify(fingerprint(model), null, 2))
        .toMatchFileSnapshot(`./__snapshots__/vehicle-${name}.json`);
    });
  }

  it("keeps every template family exercised by a live theme", () => {
    const used = new Set(OEM_IDS.map((id) => getTheme(id).templateFamilyId));
    for (const family of TEMPLATE_FAMILY_IDS) {
      expect(used.has(family), family).toBe(true);
    }
  });
});

// The theme a fixture would actually resolve to in production — the same
// model-year-aware resolution the orchestrator performs.
function resolveIdFor(data: FactoryStickerRenderData): OemId {
  const year = Number(data.identity.year);
  const r = resolveOem(data.identity.make, Number.isFinite(year) ? year : undefined);
  return r.confidence === "UNRESOLVED" ? "AUTOLABELS_FALLBACK" : (r.identity.id as OemId);
}
