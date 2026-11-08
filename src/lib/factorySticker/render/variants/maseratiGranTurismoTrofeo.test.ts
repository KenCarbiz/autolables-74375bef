import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { MASERATI_REFERENCE_VIN, maseratiListing, maseratiReferenceMatchData, maseratiRenderData } from "../__fixtures__/maserati";
import { MASERATI_GRANTURISMO_GAS_ID } from "./maseratiGranTurismoTrofeo";

describeCatalogTemplate({
  title: "Maserati GranTurismo gasoline",
  templateId: MASERATI_GRANTURISMO_GAS_ID,
  make: "Maserati",
  model: "GranTurismo",
  stressLabel: "2024 Lexus GX record (other make)",
  listing: maseratiListing,
  renderData: maseratiRenderData,
  referenceMatch: maseratiReferenceMatchData,
  referenceVin: MASERATI_REFERENCE_VIN,
  referenceStrings: ["NIGHT INTERACTION", "TURIN", "166,000", "179,345", "2,195", "10,850", "ITALY: 65%", "412 GRAMS", "$6,250", "PORT NEWARK", "ADAS PACKAGE", "PEGASO", "Q4 ALL-WHEEL"],
  referenceExpect: ["21", "18", "27", "4.8", "$6,250", "$2,950", "$166,000.00", "$179,345.00", "$2,195.00", "$5,180.00", "$1,240.00", "ITALY: 65%", "NIGHT INTERACTION (QBJ)", "Transferrable four year/50,000 mile"],
  referenceGap: 300,
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Modena" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "Folgore electric", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Folgore" }, epa: { ...d.epa!, fuelType: "Electricity" } }) },
    { label: "plug-in powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Plug-in Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Grecale" } }) },
    { label: "SUV body", patch: (d) => ({ ...d, bodyClass: "SUV" }) },
  ],
});
