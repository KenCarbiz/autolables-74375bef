import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { CADILLAC_REFERENCE_VIN, cadillacListing, cadillacReferenceMatchData, cadillacRenderData } from "../__fixtures__/cadillac";
import { CADILLAC_ESCALADE_IQL_EV_ID } from "./cadillacEscaladeIqEv";

type Data = Parameters<Parameters<typeof describeCatalogTemplate>[0]["referenceMatch"]>[0];
const withFuel = (fuelType: string) => (d: Data): Data =>
  ({ ...d, epa: { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, ...(d.epa ?? {}), fuelType } });

describeCatalogTemplate({
  title: "Cadillac Escalade IQL electric",
  templateId: CADILLAC_ESCALADE_IQL_EV_ID,
  make: "Cadillac",
  model: "Escalade IQL",
  stressLabel: "2026 Tesla Model Y record",
  stressOtherMake: true,
  carb: { safetyPanel: true },
  listing: cadillacListing,
  renderData: cadillacRenderData,
  referenceMatch: cadillacReferenceMatchData,
  referenceVin: CADILLAC_REFERENCE_VIN,
  referenceStrings: ["VIBRANT WHITE","CAMELIA","MYRTLE BEACH","DETROIT","151,205","161,894","7,794","2,895","ONYX","1,325"],
  referenceExpect: ["$151,205.00", "$161,894.00", "$2,895.00", "VIBRANT WHITE TRICOAT", "MYRTLE BEACH CADILLAC"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Zeta" } }) },
    { label: "Escalade IQ", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Escalade IQ" } }) },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: withFuel("Regular Gasoline") },
    { label: "plug-in hybrid", patch: withFuel("Gasoline and Electricity") },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "gasoline Escalade", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Escalade" } }) },
    { label: "Lyriq", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Lyriq" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
