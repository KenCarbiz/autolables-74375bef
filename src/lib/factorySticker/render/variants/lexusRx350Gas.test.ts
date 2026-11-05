import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { LEXUS_REFERENCE_VIN, lexusListing, lexusReferenceMatchData, lexusRenderData } from "../__fixtures__/lexus";
import { LEXUS_RX350_GAS_ID } from "./lexusRx350Gas";

describeCatalogTemplate({
  title: "Lexus RX 350 gasoline",
  templateId: LEXUS_RX350_GAS_ID,
  make: "Lexus",
  model: "RX 350",
  stressLabel: "2024 Lexus GX record",
  listing: lexusListing,
  renderData: lexusRenderData,
  referenceMatch: lexusReferenceMatchData,
  referenceVin: LEXUS_REFERENCE_VIN,
  referenceStrings: ["EMINENT WHITE PEARL", "CAMBRIDGE, ONTARIO", "58,490", "63,659", "65,209", "1,550", "WHIPPANY", "LEXUS OF ROUTE 10", "5,169", "$4,500", "$2,600", "370 GRAMS"],
  referenceExpect: ["24", "21", "28", "4.2", "$4,500", "$2,600", "$58,490.00", "$63,659.00", "$1,550.00", "$65,209.00", "$1,670.00", "$1,475.00", "EMINENT WHITE PEARL", "CAMBRIDGE, ONTARIO, CANADA"],
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "F SPORT Design" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
    { label: "bare RX model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "RX", trim: "RX 350 Premium+" } }) },
  ],
  unsupported: [
    { label: "RX 350h hybrid model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "RX 350h" } }) },
    { label: "RX 450h+ plug-in model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "RX 450h+" } }) },
    { label: "RX 500h model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "RX 500h" } }) },
    { label: "hybrid listed as a trim of the RX model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "RX", trim: "RX 450h+ Luxury" } }) },
    { label: "hybrid powertrain on the RX 350 model", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "NX 350" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
