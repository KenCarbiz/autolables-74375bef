import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { F250_REFERENCE_VIN, f250Listing, f250ReferenceMatchData, f250RenderData } from "../__fixtures__/f250";
import { FORD_F250_DIESEL_ID } from "./fordF250Diesel";

const gasoline = (d: Parameters<typeof describeCatalogTemplate>[0]["supported"][number]["patch"] extends (x: infer T) => unknown ? T : never) =>
  ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null, fuelType: "Unleaded" } });

describeCatalogTemplate({
  title: "Ford F-250 Super Duty diesel",
  templateId: FORD_F250_DIESEL_ID,
  make: "Ford",
  model: "F-250 Super Duty",
  stressLabel: "2024 F-150 record",
  stressEpaConflict: true,
  carb: { safetyPanel: false, plainAmounts: true },
  listing: f250Listing,
  renderData: f250RenderData,
  referenceMatch: f250ReferenceMatchData,
  referenceVin: F250_REFERENCE_VIN,
  referenceStrings: ["BLACK ONYX","CAPITOL FORD","CERRILLOS","KENTUCKY","65,840","89,935","21,300","2,795","4,295","13,495","POWER STROKE","TORQSHIFT","LARIAT"],
  referenceExpect: ["$65,840.00", "$89,935.00", "$2,795.00", "$4,295.00", "CAPITOL FORD"],
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
    { label: "F-150", patch: (d) => ({ ...d, identity: { ...d.identity, model: "F-150" } }) },
    { label: "F-350", patch: (d) => ({ ...d, identity: { ...d.identity, model: "F-350 Super Duty" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
