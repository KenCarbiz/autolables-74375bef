import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { SIERRA_REFERENCE_VIN, sierraListing, sierraReferenceMatchData, sierraRenderData } from "../__fixtures__/sierra3500";
import { GMC_SIERRA_3500_DIESEL_ID } from "./gmcSierra3500Diesel";

const gasoline = (d: Parameters<typeof describeCatalogTemplate>[0]["supported"][number]["patch"] extends (x: infer T) => unknown ? T : never) =>
  ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null, fuelType: "Unleaded" } });

describeCatalogTemplate({
  title: "GMC Sierra 3500 diesel",
  templateId: GMC_SIERRA_3500_DIESEL_ID,
  make: "GMC",
  model: "Sierra 3500",
  stressLabel: "2021 Yukon Denali record",
  carb: { safetyPanel: true },
  listing: sierraListing,
  renderData: sierraRenderData,
  referenceMatch: sierraReferenceMatchData,
  referenceVin: SIERRA_REFERENCE_VIN,
  referenceStrings: ["ONYX BLACK","ALPINE UMBER","DEACON JONES","SMITHFIELD","FLINT","101,700","105,665","1,170","2,795","DURAMAX"],
  referenceExpect: ["$101,700.00", "$105,665.00", "$2,795.00", "ONYX BLACK", "DEACON JONES AUTOPARK, INC."],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Zeta" } }) },
    { label: "two-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "2WD" } }) },
    { label: "diesel from the verified EPA match", patch: (d) => ({ ...d, neovin: undefined, epa: { ...(d.epa ?? { combined: null, city: null, highway: null }), fuelType: "Diesel" } as typeof d.epa }) },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: gasoline },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "Sierra 1500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Sierra 1500" } }) },
    { label: "Sierra 2500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Sierra 2500" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
