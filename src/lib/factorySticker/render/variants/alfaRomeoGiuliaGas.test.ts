import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { ALFA_REFERENCE_VIN, alfaListing, alfaReferenceMatchData, alfaRenderData } from "../__fixtures__/alfa";
import { ALFA_ROMEO_GIULIA_GAS_ID } from "./alfaRomeoGiuliaGas";

describeCatalogTemplate({
  title: "Alfa Romeo Giulia gasoline",
  templateId: ALFA_ROMEO_GIULIA_GAS_ID,
  make: "Alfa Romeo",
  model: "Giulia",
  stressLabel: "2020 Stelvio Ti Sport Carbon record",
  listing: alfaListing,
  renderData: alfaRenderData,
  referenceMatch: alfaReferenceMatchData,
  referenceVin: ALFA_REFERENCE_VIN,
  referenceStrings: ["VESUVIO", "CASSINO", "57,115", "3,250", "8,870", "ITALY: 42%", "GERMANY: 14%", "330 GRAMS", "$3,000", "SPRINT RWD", "8HP50", "ZAR-FAMAN9T7", "L4-VON", "FCA US"],
  referenceExpect: ["27", "24", "33", "3.7", "$3,000", "$2,300", "$44,995.00", "$57,115.00", "$3,250.00", "$1,625.00", "$2,250.00", "ITALY: 42%", "GERMANY: 14%", "CASSINO", "VESUVIO GRAY METALLIC EXTERIOR PAINT", "4-year or 50,000-mile Basic Warranty."],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "Quadrifoglio uses the same layout", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Quadrifoglio" } }) },
    { label: "all-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "AWD" } }) },
  ],
  unsupported: [
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Stelvio" } }) },
    { label: "SUV body", patch: (d) => ({ ...d, bodyClass: "SUV" }) },
    { label: "hybrid powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Electricity/Gas" } }) },
  ],
});
