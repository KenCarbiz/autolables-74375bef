import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { FORESTER_REFERENCE_VIN, foresterListing, foresterReferenceMatchData, foresterRenderData } from "../__fixtures__/forester";
import { SUBARU_FORESTER_GAS_ID } from "./subaruForesterGas";

describeCatalogTemplate({
  title: "Subaru Forester gasoline",
  templateId: SUBARU_FORESTER_GAS_ID,
  make: "Subaru",
  model: "Forester",
  stressLabel: "2021 Forester Premium record",
  listing: foresterListing,
  renderData: foresterRenderData,
  referenceMatch: foresterReferenceMatchData,
  referenceVin: FORESTER_REFERENCE_VIN,
  referenceStrings: ["LAFAYETTE", "36,995", "41,699", "1,450", "JAPAN: 30%", "50%", "347 GRAMS", "$1,000", "$1,900", "WILDERNESS", "OPTION PACKAGE: 33", "HARMAN", "SMALL SUVS RANGE"],
  referenceExpect: ["26", "24", "28", "3.8", "$1,000", "$1,900", "$36,995.00", "$41,699.00", "$1,450.00", "$2,200.00", "$447.00", "50%", "JAPAN: 30%", "LAFAYETTE, IN, USA", "Not Rated"],
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Premium" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "Forester Hybrid model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Forester Hybrid" } }) },
    { label: "hybrid powertrain on the Forester model", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "hybrid trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Hybrid Limited" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Outback" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
