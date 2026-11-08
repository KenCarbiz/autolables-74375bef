import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { URUS_REFERENCE_VIN, urusListing, urusReferenceMatchData, urusRenderData } from "../__fixtures__/lamborghini";
import { LAMBORGHINI_URUS_PHEV_ID } from "./lamborghiniUrusPhev";

type Data = Parameters<Parameters<typeof describeCatalogTemplate>[0]["referenceMatch"]>[0];
const withFuel = (fuelType: string) => (d: Data): Data =>
  ({ ...d, epa: { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, ...(d.epa ?? {}), fuelType } });

describeCatalogTemplate({
  title: "Lamborghini Urus plug-in hybrid",
  templateId: LAMBORGHINI_URUS_PHEV_ID,
  make: "Lamborghini",
  model: "Urus",
  stressLabel: "2018 Chevrolet Volt record",
  ev: "phev",
  listing: urusListing,
  renderData: urusRenderData,
  referenceMatch: urusReferenceMatchData,
  referenceVin: URUS_REFERENCE_VIN,
  referenceStrings: ["ARANCIO BOREALIS","NERO ADE","SANT'AGATA","276,741","346,293","3,995","9,999","8,682","7,990","BOLOGNESE"],
  referenceExpect: ["$276,741.00", "$346,293.00", "$3,995.00", "$9,999.00", "48", "20", "$2,300", "$3,000"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Performante" } }) },
    { label: "plug-in hybrid from the verified EPA match", patch: withFuel("Premium Gas or Electricity") },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: withFuel("Premium Gasoline") },
    { label: "electric", patch: withFuel("Electricity") },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "Huracan", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Flying Spur" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
