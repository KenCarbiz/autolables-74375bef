import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { RAM2500_REFERENCE_VIN, ram2500Listing, ram2500ReferenceMatchData, ram2500RenderData } from "../__fixtures__/ram2500";
import { RAM_2500_DIESEL_ID } from "./ramLimitedDiesel";

const gasoline = (d: Parameters<typeof describeCatalogTemplate>[0]["supported"][number]["patch"] extends (x: infer T) => unknown ? T : never) =>
  ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null, fuelType: "Unleaded" } });

describeCatalogTemplate({
  title: "Ram 2500 Limited diesel",
  templateId: RAM_2500_DIESEL_ID,
  make: "Ram",
  model: "2500",
  stressLabel: "2022 RAM 2500 gasoline record",
  carb: { safetyPanel: true },
  listing: ram2500Listing,
  renderData: ram2500RenderData,
  referenceMatch: ram2500ReferenceMatchData,
  referenceVin: RAM2500_REFERENCE_VIN,
  referenceStrings: ["DIAMOND BLACK","SALTILLO","76,365","98,725","20,165","2,195","CUMMINS","TORQUEFLITE"],
  referenceExpect: ["$76,365.00", "$98,725.00", "$2,195.00", "DIAMOND BLACK CRYSTAL PEARL-COAT EXTERIOR PAINT", "SALTILLO"],
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
    { label: "Ram 1500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "1500" } }) },
    { label: "Ram 3500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "3500" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
