import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { LINCOLN_REFERENCE_VIN, lincolnListing, lincolnReferenceMatchData, lincolnRenderData } from "../__fixtures__/lincoln";
import { LINCOLN_NAUTILUS_GAS_ID } from "./lincolnNautilusGas";

describeCatalogTemplate({
  title: "Lincoln Nautilus gasoline",
  templateId: LINCOLN_NAUTILUS_GAS_ID,
  make: "Lincoln",
  model: "Nautilus",
  stressLabel: "2008 MKZ Base record",
  listing: lincolnListing,
  renderData: lincolnRenderData,
  referenceMatch: lincolnReferenceMatchData,
  referenceVin: LINCOLN_REFERENCE_VIN,
  referenceStrings: ["RED CARPET", "LOUISVILLE", "53,995", "56,990", "2,295", "54,695", "369 GRAMS", "$1,750", "SMILE STATE", "BLUECRUISE", "101A", "TJ081447", "RAMP ONE", "CONVOY"],
  referenceExpect: ["24", "21", "29", "4.2", "$1,750", "$2,050", "$53,995.00", "$56,990.00", "$2,295.00", "$750.00", "$450.00", "RED CARPET MET CC", "4-YEAR OR 50,000-MILE WARRANTY."],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Reserve" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "hybrid powertrain", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Hybrid" }, epa: { ...d.epa!, fuelType: "Electricity/Gas" } }) },
    { label: "plug-in powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Plug-in Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Aviator" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
