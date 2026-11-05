import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { VOLVO_XC60_REFERENCE_VIN, volvoXc60Listing, volvoXc60ReferenceMatchData, volvoXc60RenderData } from "../__fixtures__/volvoXc60";
import { VOLVO_XC60_B5_ID } from "./volvoXc60B5";

describeCatalogTemplate({
  title: "Volvo XC60 B5 mild hybrid",
  templateId: VOLVO_XC60_B5_ID,
  make: "Volvo",
  model: "XC60",
  stressLabel: "2022 XC60 Momentum record",
  stressMatches: false,
  offYear: "2026",
  listing: volvoXc60Listing,
  renderData: volvoXc60RenderData,
  referenceMatch: volvoXc60ReferenceMatchData,
  referenceVin: VOLVO_XC60_REFERENCE_VIN,
  referenceStrings: ["DENIM BLUE", "TORSLANDA", "51,700", "54,145", "1,295", "KUNDERT", "HACKENSACK", "$2,450", "$2,750", "343 GRAMS", "SWEDEN: 40%", "MAROON BROWN"],
  referenceExpect: ["26", "23", "30", "3.8", "$2,750", "$2,450", "$51,700.00", "$54,145.00", "$1,295.00", "$750.00", "$225.00", "DENIM BLUE", "TORSLANDA, SWEDEN", "SWEDEN: 40%", "48 Month/50,000 Mile Limited Warranty Coverage"],
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "B5 AWD Core" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "XC60 Recharge model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "XC60 Recharge" } }) },
    { label: "T8 plug-in hybrid trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "T8 AWD Plus" } }) },
    { label: "plug-in powertrain on the XC60 model", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Premium Gas or Electricity" } }) },
    { label: "B6 trim (powertrain rule unverified)", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "B6 AWD Ultra" } }) },
    { label: "2026 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2026" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "XC90" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
