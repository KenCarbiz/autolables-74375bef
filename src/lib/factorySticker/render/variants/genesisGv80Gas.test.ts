import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { GV80_REFERENCE_VIN, gv80Listing, gv80ReferenceMatchData, gv80RenderData } from "../__fixtures__/gv80";
import { GENESIS_GV80_GAS_ID } from "./genesisGv80Gas";

describeCatalogTemplate({
  title: "Genesis GV80 gasoline",
  templateId: GENESIS_GV80_GAS_ID,
  make: "Genesis",
  model: "GV80",
  stressLabel: "2024 G70 record",
  listing: gv80Listing,
  renderData: gv80RenderData,
  referenceMatch: gv80ReferenceMatchData,
  referenceVin: GV80_REFERENCE_VIN,
  referenceStrings: ["SAVILE", "BORDEAUX", "PALM SPRINGS", "CA701", "ULSAN", "82,330", "85,415", "1,495", "KOREA: 80%", "3%", "473 GRAMS", "$8,000", "$3,300", "SIDE STEPS", "NFC KEY CARD", "GENESIS EXPERIENCE", "STANDARD SUVS RANGE"],
  referenceExpect: ["19", "16", "22", "5.3", "$8,000", "$3,300", "$82,330.00", "$85,415.00", "$1,495.00", "$650.00", "$755.00", "3%", "KOREA: 80%", "ULSAN, KOREA", "GENESIS OF PALM SPRINGS", "CA701", "SAVILE SILVER", "5-year/60,000-mile New Vehicle Warranty"],
  ownExpect: [],
  supported: [
    { label: "rear-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "RWD" } }) },
    { label: "2.5T trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "2.5T Advanced" } }) },
  ],
  unsupported: [
    { label: "GV80 Coupe model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "GV80 Coupe" } }) },
    { label: "hybrid powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "GV70" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
