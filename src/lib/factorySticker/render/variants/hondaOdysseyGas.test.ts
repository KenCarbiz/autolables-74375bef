import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { HONDA_ODYSSEY_REFERENCE_VIN, hondaOdysseyListing, hondaOdysseyReferenceMatchData, hondaOdysseyRenderData } from "../__fixtures__/honda";
import { HONDA_ODYSSEY_GAS_ID } from "./hondaOdysseyGas";

describeCatalogTemplate({
  title: "Honda Odyssey gas minivan",
  templateId: HONDA_ODYSSEY_GAS_ID,
  make: "Honda",
  model: "Odyssey",
  stressLabel: "2025 Odyssey EX-L record",
  stressMatches: false,
  pageSize: [792, 612],
  listing: hondaOdysseyListing,
  renderData: hondaOdysseyRenderData,
  referenceMatch: hondaOdysseyReferenceMatchData,
  referenceVin: HONDA_ODYSSEY_REFERENCE_VIN,
  referenceStrings: ["47,495", "48,990", "1,495", "BRAUNABILITY", "WINAMAC", "$2,250", "$2,750", "70%", "LINCOLN"],
  referenceExpect: ["22", "19", "28", "4.5", "$2,750", "$2,250", "$47,495.00", "$48,990.00", "$1,495.00", "SMOKE BLUE PEARL", "3YR/36K"],
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "EX-L" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "2027 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2027" } }) },
    { label: "hybrid powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Electricity/Gas" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Pilot" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
