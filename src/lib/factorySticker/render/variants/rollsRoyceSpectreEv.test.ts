import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { SPECTRE_REFERENCE_VIN, spectreListing, spectreReferenceMatchData, spectreRenderData } from "../__fixtures__/spectre";
import { ROLLS_ROYCE_SPECTRE_EV_ID } from "./rollsRoyceSpectreEv";

type Data = Parameters<Parameters<typeof describeCatalogTemplate>[0]["referenceMatch"]>[0];
const withFuel = (fuelType: string) => (d: Data): Data =>
  ({ ...d, epa: { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, ...(d.epa ?? {}), fuelType } });

describeCatalogTemplate({
  title: "Rolls-Royce Spectre electric",
  templateId: ROLLS_ROYCE_SPECTRE_EV_ID,
  make: "Rolls-Royce",
  model: "Spectre",
  stressLabel: "2023 Subaru Solterra record",
  ev: "ev",
  referenceGap: 38100,
  listing: spectreListing,
  renderData: spectreRenderData,
  referenceMatch: spectreReferenceMatchData,
  referenceVin: SPECTRE_REFERENCE_VIN,
  referenceStrings: ["395,000","474,050","2,750","13,500","13,700","2,600","5,000","2,400","PALMYRA"],
  referenceExpect: ["$395,000.00", "$474,050.00", "$2,750.00", "$13,500.00", "$13,700.00", "70", "253", "$1,200", "$2,500"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Black Badge" } }) },
    { label: "electric from the verified EPA match", patch: withFuel("Electricity") },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: withFuel("Premium Gasoline") },
    { label: "plug-in hybrid", patch: withFuel("Premium Gas or Electricity") },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "Ghost", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Ghost" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
