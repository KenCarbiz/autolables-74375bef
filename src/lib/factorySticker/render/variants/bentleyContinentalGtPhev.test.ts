import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { BENTLEY_REFERENCE_VIN, bentleyListing, bentleyReferenceMatchData, bentleyRenderData } from "../__fixtures__/bentley";
import { BENTLEY_CONTINENTAL_GT_PHEV_ID } from "./bentleyContinentalGtPhev";

type Data = Parameters<Parameters<typeof describeCatalogTemplate>[0]["referenceMatch"]>[0];
const withFuel = (fuelType: string) => (d: Data): Data =>
  ({ ...d, epa: { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, ...(d.epa ?? {}), fuelType } });

describeCatalogTemplate({
  title: "Bentley Continental GT plug-in hybrid",
  templateId: BENTLEY_CONTINENTAL_GT_PHEV_ID,
  make: "Bentley",
  model: "Continental GT",
  stressLabel: "2018 Chevrolet Volt record",
  ev: "phev",
  pageSize: [1159.29, 697.01],
  listing: bentleyListing,
  renderData: bentleyRenderData,
  referenceMatch: bentleyReferenceMatchData,
  referenceVin: BENTLEY_REFERENCE_VIN,
  referenceStrings: ["SILVER STORM","CREWE","344,400","396,330","4,150","13,655","10,525","7,615","TRUCK"],
  referenceExpect: ["$344,400.00", "$396,330.00", "$4,150.00", "$13,655.00", "46", "19", "$2,400", "$3,500"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Speed" } }) },
    { label: "plug-in hybrid from the verified EPA match", patch: withFuel("Premium Gas or Electricity") },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: withFuel("Premium Gasoline") },
    { label: "electric", patch: withFuel("Electricity") },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "Flying Spur", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Flying Spur" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
