import { useMemo, useState } from "react";
import { adaptRenderData } from "@/lib/factorySticker/render/contract.ts";
import { buildStickerLayout } from "@/lib/factorySticker/render/layout.ts";
import { layoutToSvg } from "@/lib/factorySticker/render/previewSvg.ts";
import { getTheme, THEME_REGISTRY } from "@/lib/factorySticker/oem/themes.ts";
import type { OemId } from "@/lib/factorySticker/oem/identity.ts";
import { listProfiles } from "@/lib/factorySticker/oem/profiles.ts";
import {
  bmwFixture,
  chevroletFixture,
  evFixture,
  jeep4xeFixture,
  genesisEvFixture,
  genesisG90LongFixture,
  genesisGv80Fixture,
  kiaEvFixture,
  kiaHybridFixture,
  kiaPhevFixture,
  kiaTellurideFixture,
  kiaTellurideLongFixture,
  acuraLongFixture,
  acuraRdxFixture,
  acuraZdxFixture,
  hyundaiIoniq5Fixture,
  hyundaiLongFixture,
  hyundaiPalisadeFixture,
  hyundaiTucsonHybridFixture,
  lincolnHybridFixture,
  lincolnLongFixture,
  lincolnNautilusFixture,
  lincolnPhevFixture,
  infinitiQx80NewFixture,
  hondaCrvHybridFixture,
  hondaLongFixture,
  hondaPilotFixture,
  hondaPrologueFixture,
  gmcEvFixture,
  gmcSierraFixture,
  cadillacEscaladeFixture,
  cadillacLyriqFixture,
  ramChassisCabFixture,
  ramFixture,
  vwAtlasFixture,
  vwId4Fixture,
  audiEtronFixture,
  audiPhevFixture,
  audiQ5Fixture,
  porsche911Fixture,
  porscheGuzzlerFixture,
  porscheMacanEvFixture,
  teslaCybertruckFixture,
  teslaModelYFixture,
  volvoEvFixture,
  volvoPhevFixture,
  volvoXc90Fixture,
  mercedesAmgLongFixture,
  mercedesEqFixture,
  mercedesGleFixture,
  mercedesPhevFixture,
  mazdaCx90Fixture,
  mazdaLongFixture,
  mazdaMiataFixture,
  mazdaPhevFixture,
  subaruAscentLongFixture,
  subaruOutbackFixture,
  subaruSolterraFixture,
  jeepFixture,
  lexusFixture,
  toyotaFixture,
  genericDecodeFixture,
  infinitiBenchmark,
  longEquipmentFixture,
  newConditionBenchmark,
  nissanBenchmark,
  noEpaFixture,
} from "@/lib/factorySticker/render/__fixtures__/renderData.ts";

// Internal OEM Theme Laboratory: exercises every registered theme against
// the benchmark fixtures through the SAME deterministic engine used for
// production PDFs. Review-only — production theme selection happens through
// the versioned profile registry, never here.

const LAB_FIXTURES = {
  used: { label: "Used (QX80 data)", data: infinitiBenchmark },
  infinitinew: { label: "INFINITI QX80 new", data: infinitiQx80NewFixture },
  nissan: { label: "Nissan Pathfinder", data: nissanBenchmark },
  jeep: { label: "Jeep Wrangler", data: jeepFixture },
  jeep4xe: { label: "Jeep 4xe PHEV", data: jeep4xeFixture },
  toyota: { label: "Toyota Grand Highlander", data: toyotaFixture },
  lexus: { label: "Lexus GX 550", data: lexusFixture },
  chevrolet: { label: "Chevrolet Silverado", data: chevroletFixture },
  bmw: { label: "BMW 530i", data: bmwFixture },
  genesis: { label: "Genesis GV80", data: genesisGv80Fixture },
  genesisev: { label: "Electrified GV70", data: genesisEvFixture },
  genesislong: { label: "Genesis G90 long", data: genesisG90LongFixture },
  kia: { label: "Kia Telluride", data: kiaTellurideFixture },
  kiahybrid: { label: "Kia Sportage Hybrid", data: kiaHybridFixture },
  kiaphev: { label: "Kia Sportage PHEV", data: kiaPhevFixture },
  kiaev: { label: "Kia EV9", data: kiaEvFixture },
  kialong: { label: "Kia Telluride X-Pro long", data: kiaTellurideLongFixture },
  mazda: { label: "Mazda CX-90", data: mazdaCx90Fixture },
  mazdaphev: { label: "Mazda CX-90 PHEV", data: mazdaPhevFixture },
  mazdamiata: { label: "Mazda MX-5 RF", data: mazdaMiataFixture },
  mazdalong: { label: "Mazda CX-90 long", data: mazdaLongFixture },
  subaru: { label: "Subaru Outback", data: subaruOutbackFixture },
  subaruev: { label: "Subaru Solterra", data: subaruSolterraFixture },
  subarulong: { label: "Subaru Ascent long", data: subaruAscentLongFixture },
  honda: { label: "Honda CR-V Hybrid", data: hondaCrvHybridFixture },
  hondapilot: { label: "Honda Pilot", data: hondaPilotFixture },
  hondaev: { label: "Honda Prologue", data: hondaPrologueFixture },
  hondalong: { label: "Honda Pilot long", data: hondaLongFixture },
  hyundai: { label: "Hyundai Palisade", data: hyundaiPalisadeFixture },
  hyundaiev: { label: "Hyundai IONIQ 5", data: hyundaiIoniq5Fixture },
  hyundaihev: { label: "Hyundai Tucson HEV", data: hyundaiTucsonHybridFixture },
  hyundailong: { label: "Hyundai Palisade long", data: hyundaiLongFixture },
  lincoln: { label: "Lincoln Nautilus", data: lincolnNautilusFixture },
  lincolnhev: { label: "Lincoln Nautilus HEV", data: lincolnHybridFixture },
  lincolnphev: { label: "Lincoln Corsair GT", data: lincolnPhevFixture },
  lincolnlong: { label: "Lincoln Navigator long", data: lincolnLongFixture },
  gmc: { label: "GMC Sierra Denali", data: gmcSierraFixture },
  gmcev: { label: "GMC Sierra EV", data: gmcEvFixture },
  cadillac: { label: "Cadillac Escalade", data: cadillacEscaladeFixture },
  cadillacev: { label: "Cadillac LYRIQ", data: cadillacLyriqFixture },
  ram: { label: "Ram 1500 Laramie", data: ramFixture },
  ramhd: { label: "Ram 3500 Chassis Cab", data: ramChassisCabFixture },
  vw: { label: "VW Atlas", data: vwAtlasFixture },
  vwev: { label: "VW ID.4", data: vwId4Fixture },
  audi: { label: "Audi Q5 Premium Plus", data: audiQ5Fixture },
  audiphev: { label: "Audi Q5 TFSI e", data: audiPhevFixture },
  audiev: { label: "Audi Q6 e-tron", data: audiEtronFixture },
  porsche: { label: "Porsche 911 GTS", data: porsche911Fixture },
  porschegt4: { label: "Porsche 718 GT4 RS", data: porscheGuzzlerFixture },
  porscheev: { label: "Porsche Macan Electric", data: porscheMacanEvFixture },
  tesla: { label: "Tesla Model Y", data: teslaModelYFixture },
  teslact: { label: "Tesla Cybertruck", data: teslaCybertruckFixture },
  volvo: { label: "Volvo XC90 B5", data: volvoXc90Fixture },
  volvophev: { label: "Volvo XC60 T8", data: volvoPhevFixture },
  volvoev: { label: "Volvo EX90", data: volvoEvFixture },
  mercedes: { label: "Mercedes GLE 450", data: mercedesGleFixture },
  mercedesphev: { label: "Mercedes GLE 450e", data: mercedesPhevFixture },
  mercedesev: { label: "Mercedes EQE SUV", data: mercedesEqFixture },
  mercedeslong: { label: "AMG GLE 63 long", data: mercedesAmgLongFixture },
  acura: { label: "Acura RDX", data: acuraRdxFixture },
  acuraev: { label: "Acura ZDX", data: acuraZdxFixture },
  acuralong: { label: "Acura MDX long", data: acuraLongFixture },
  ev: { label: "EV (Ariya)", data: evFixture },
  new: { label: "New vehicle", data: newConditionBenchmark },
  generic: { label: "Generic decode", data: genericDecodeFixture },
  noepa: { label: "Missing EPA", data: noEpaFixture },
  twopage: { label: "Two-page", data: longEquipmentFixture },
} as const;

const STATUS_TONE: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  reviewed: "bg-blue-50 text-blue-700 border-blue-200",
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  fallback: "bg-slate-100 text-slate-600 border-slate-300",
  retired: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function ThemeLab() {
  const oemIds = Object.keys(THEME_REGISTRY) as OemId[];
  const profiles = useMemo(() => listProfiles(), []);
  const [oemId, setOemId] = useState<OemId>("INFINITI");
  const [fixtureKey, setFixtureKey] = useState<keyof typeof LAB_FIXTURES>("used");
  const [grayscale, setGrayscale] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  const profile = profiles.find((p) => p.oemId === oemId) ?? null;

  const result = useMemo(() => {
    try {
      const input = adaptRenderData(LAB_FIXTURES[fixtureKey].data());
      const model = buildStickerLayout(input, getTheme(oemId));
      return { model, error: null as string | null };
    } catch (e) {
      return { model: null, error: e instanceof Error ? e.message : "render failed" };
    }
  }, [oemId, fixtureKey]);

  const pageSvg = useMemo(() => {
    if (!result.model) return null;
    const page = result.model.pages[Math.min(pageIdx, result.model.pages.length - 1)];
    return layoutToSvg({ ...result.model, pages: [page] });
  }, [result, pageIdx]);

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="max-w-[1500px] mx-auto space-y-4">
        <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-base font-bold text-slate-900">OEM Theme Laboratory</h1>
              <p className="text-[11px] text-slate-500">
                Internal review of versioned OEM theme profiles against the shared document engine. Logos render as
                approved text wordmarks until brand artwork is explicitly authorized. Production selection is
                model-year-aware via the profile registry — never this screen.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={oemId}
                onChange={(e) => { setOemId(e.target.value as OemId); setPageIdx(0); }}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold"
              >
                {oemIds.map((id) => <option key={id} value={id}>{id.replace(/_/g, " ")}</option>)}
              </select>
              <select
                value={fixtureKey}
                onChange={(e) => { setFixtureKey(e.target.value as keyof typeof LAB_FIXTURES); setPageIdx(0); }}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold"
              >
                {Object.entries(LAB_FIXTURES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setGrayscale((g) => !g)}
                className={`h-8 px-2.5 rounded-md border text-[11px] font-bold ${grayscale ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 hover:bg-slate-50"}`}
              >
                Grayscale
              </button>
              <button
                type="button"
                onClick={() => setActualSize((a) => !a)}
                className={`h-8 px-2.5 rounded-md border text-[11px] font-bold ${actualSize ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 hover:bg-slate-50"}`}
              >
                Actual print size
              </button>
              {result.model && result.model.pages.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => (i + 1) % result.model!.pages.length)}
                  className="h-8 px-2.5 rounded-md border border-slate-300 text-[11px] font-bold hover:bg-slate-50"
                >
                  Page {pageIdx + 1}/{result.model.pages.length}
                </button>
              )}
            </div>
          </div>
          {profile && (
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className={`px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide text-[10px] ${STATUS_TONE[profile.status]}`}>
                {profile.status}
              </span>
              <span className="font-mono text-slate-600">{profile.themeVersion}</span>
              <span className="text-slate-500">family: <b>{profile.layoutFamily}</b></span>
              <span className="text-slate-500">
                model years: <b>{profile.modelYearStart}–{profile.modelYearEnd ?? "present"}</b> ({profile.market})
              </span>
              <span className={`px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide text-[10px] ${profile.logoAuthorized ? STATUS_TONE.approved : STATUS_TONE.draft}`}>
                {profile.logoAuthorized ? "Logo artwork authorized" : "Text wordmark only - artwork not authorized"}
              </span>
            </div>
          )}
        </div>

        {result.error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 font-semibold">
            Render failed: {result.error}
          </div>
        ) : pageSvg ? (
          <div className={actualSize ? "overflow-auto" : ""}>
            <div
              className="border border-slate-400 bg-white shadow [&>svg]:block [&>svg]:h-auto mx-auto"
              style={{
                width: actualSize ? 1056 : undefined,
                maxWidth: actualSize ? undefined : 1160,
                filter: grayscale ? "grayscale(1)" : undefined,
              }}
              dangerouslySetInnerHTML={{
                __html: pageSvg.replace("<svg ", `<svg style="width:${actualSize ? "1056px" : "100%"}" `),
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
